// Keyboard-first menus: title, fight setup, controls/rebinding, pause, results.
import { shareOnFacebook, shareAnywhere } from './share.js';
import { ROSTER, DIFFICULTY, ACTIONS, ACTION_LABELS, PLAYER_COLORS, DEFAULT_BINDINGS, SPECIALS, SKILLS, keyLabel,
  TEAM_COLORS, TEAM_DEFAULT_NAMES, TEAM_COUNTS, cleanTeamName } from './config.js';
import { saveBindings, devices } from './input.js';
import { padLabel, PAD_RESERVED } from './padmap.js';

const SETUP_KEY = 'battle-arena.setup.v1';
const GROUP_KEY = 'battle-arena.fundraiser-group.v1';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
// "Mage · Hellfire Orb · Meteor · Flame Lance · Ember Spray"
export function moveSummary(def) {
  return [def.role, SPECIALS[def.special].label, ...(def.skills || []).map((id) => SKILLS[id].label)].filter(Boolean).join(' · ');
}

export function defaultSetup() {
  return {
    count: 4, winsNeeded: 2, difficulty: 'normal', suddenDeath: 75, quality: 'auto', music: 70, sfx: 90,
    players: 1, touch: 'auto', touchSize: 1,
    teams: { count: 0, names: [...TEAM_DEFAULT_NAMES] },
    slots: Array.from({ length: 8 }, (_, i) => ({ control: i === 0 ? 0 : 'cpu', fighter: i % ROSTER.length, team: i % 4 })),
  };
}

export function loadSetup() {
  const d = defaultSetup();
  try {
    const s = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
    if (!s) return d;
    const teams = { ...d.teams, ...(s.teams || {}) };
    teams.names = d.teams.names.map((n, i) => cleanTeamName(teams.names?.[i] ?? n, i));
    if (!TEAM_COUNTS.includes(teams.count)) teams.count = 0;
    return { ...d, ...s, teams, slots: d.slots.map((slot, i) => ({ ...slot, ...(s.slots?.[i] || {}) })) };
  } catch { return d; }
}
function saveSetup(s) { try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

const SUDDEN = [0, 45, 60, 75, 90, 120];
const DIFFS = Object.keys(DIFFICULTY);
const CONTROLS = [0, 1, 2, 3, 'cpu'];
const QUALITY = ['auto', 'high', 'low'];
const TOUCH = ['auto', 'on', 'off'];
const TOUCH_SIZES = [0.85, 1, 1.18];

export class Menus {
  constructor({ keyboard, bindings, pads, onStart, onResume, onRestart, onQuit, onQualityChange, onVolumeChange, onTouchChange, onAct, onOpt, onShow }) {
    this.kb = keyboard;
    this.pads = pads;
    this.bindings = bindings;
    this.setup = loadSetup();
    this.cb = { onStart, onResume, onRestart, onQuit, onQualityChange, onVolumeChange, onTouchChange, onAct, onOpt, onShow };
    this.active = null;
    this.back = {};
    this.rebinding = null;
    this.screens = {};
    for (const el of document.querySelectorAll('.screen')) this.screens[el.id.replace('screen-', '')] = el;
    // team name fields sit under the rules and are only rebuilt when the number of teams changes, so typing keeps focus
    this.teamNamesEl = document.createElement('div');
    this.teamNamesEl.className = 'team-names';
    this.screens.setup.querySelector('.rules').after(this.teamNamesEl);
    this.teamNamesEl.addEventListener('input', (e) => {
      const i = +e.target.dataset.team;
      if (!Number.isInteger(i)) return;
      this.setup.teams.names[i] = e.target.value;
      saveSetup(this.setup);
      this.updateTeamLabels();
    });
    this.teamNamesEl.addEventListener('focusout', (e) => {
      const i = +e.target.dataset.team;
      if (!Number.isInteger(i)) return;
      this.setup.teams.names[i] = e.target.value = cleanTeamName(e.target.value, i);
      saveSetup(this.setup);
      this.updateTeamLabels();
    });
    // players must belong to a fundraising group: the name or code is asked for on the title screen
    // and kept in this browser; nothing checks it against the fundraiser system yet
    this.groupEl = document.getElementById('fr-group');
    this.groupErr = this.screens.title.querySelector('.fr-error');
    try { this.groupEl.value = localStorage.getItem(GROUP_KEY) || ''; } catch { /* ignore */ }
    this.groupEl.addEventListener('input', () => {
      this.groupErr.textContent = '';
      this.groupEl.classList.remove('bad');
      try { localStorage.setItem(GROUP_KEY, this.groupEl.value.trim()); } catch { /* ignore */ }
    });
    keyboard.onKey((e) => this.onKey(e));
    document.addEventListener('click', (e) => {
      if (e.detail === 0) return; // keyboard-generated click; onKey already handled it
      const t = e.target.closest('[data-act],[data-opt]');
      if (t && t.tagName === 'INPUT') return; // clicking a text field only focuses it
      if (!t || !this.active || !this.screens[this.active].contains(t)) return;
      // on a touch screen the ‹ arrow of an option steps back, the › arrow and the rest step forward
      if (t.dataset.opt && e.target.closest('.val i') && e.target.closest('.val i') === t.querySelector('.val i')) { this.change(t, -1); return; }
      this.activate(t);
    });
    document.addEventListener('mousemove', (e) => {
      const t = e.target.closest?.('.nav');
      if (t && this.active && this.screens[this.active].contains(t) && document.activeElement !== t) t.focus({ preventScroll: true });
    });
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.hidden = k !== name;
    this.active = name;
    if (!name) return;
    if (name === 'setup') this.renderSetup();
    if (name === 'controls') this.renderControls();
    this.cb.onShow?.(name);
    // on the title, start on Fight once a fundraising group is filled in, otherwise on the group field
    const first = name === 'title' && this.group ? this.screens.title.querySelector('.menu-list .nav') : this.screens[name].querySelector('.nav');
    first?.focus({ preventScroll: true });
  }

  hideAll() { this.show(null); }

  navItems() {
    if (!this.active) return [];
    return [...this.screens[this.active].querySelectorAll('.nav')].filter((el) => el.offsetParent !== null);
  }

  onKey(e) {
    if (this.rebinding) return this.captureRebind(e);
    if (this.padRebinding) {
      // waiting for a controller button: Esc cancels, other keys are ignored
      if (e.code === 'Escape' && !e.synthetic) { this.pads.capture = null; this.endPadRebind(null); }
      return true;
    }
    if (!this.active) return false;
    const items = this.navItems();
    const cur = document.activeElement && items.includes(document.activeElement) ? document.activeElement : null;
    const k = e.code;
    // text fields keep their keys, except the ones that move between items
    if (cur && cur.tagName === 'INPUT') {
      if (k === 'Enter' || k === 'NumpadEnter') {
        if (cur.dataset.act) this.activate(cur);
        else {
          const next = cur.dataset.next ? this.screens[this.active].querySelector(cur.dataset.next) : spatialNext(cur, items, 'down');
          next?.focus();
        }
        return true;
      }
      if (k === 'Escape') { cur.blur(); const back = this.screens[this.active].dataset.back; if (back) this.runAct(back); return true; }
      if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'Tab') return false;
      if (k === 'Tab') return false;
    }
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[k];
    if (dir) {
      if (!cur) { items[0]?.focus(); return true; }
      if ((dir === 'left' || dir === 'right') && cur.dataset.opt) { this.change(cur, dir === 'left' ? -1 : 1); return true; }
      const next = spatialNext(cur, items, dir);
      if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
      return true;
    }
    if (k === 'Enter' || k === 'Space' || k === 'NumpadEnter') {
      if (cur) this.activate(cur);
      return true;
    }
    if (k === 'Escape' || k === 'Backspace') {
      const back = this.screens[this.active].dataset.back;
      if (back) this.runAct(back);
      return true;
    }
    return false;
  }

  activate(el) {
    if (el.dataset.opt) { this.change(el, 1); return; }
    if (el.dataset.act) this.runAct(el.dataset.act, el);
  }

  get group() { return this.groupEl.value.trim(); }

  // true when a fundraising group has been entered; otherwise sends the player back to the field on the title
  requireGroup() {
    if (this.group) return true;
    if (this.active !== 'title') this.show('title');
    this.groupErr.textContent = 'Type your fundraising group in the box above first, then press the button again.';
    this.groupEl.classList.add('bad');
    // replay the shake so a second press is noticed too
    const box = this.groupEl.closest('.fundraiser');
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.groupEl.focus({ preventScroll: true });
    return false;
  }

  runAct(act, el) {
    const gated = act === 'net-host' || act === 'net-join' || act === 'net-queue' || act === 't-join-fight' ||
      (act === 'to-online' && this.active === 'title');
    if (gated && !this.requireGroup()) return;
    switch (act) {
      case 'to-setup': this.show('setup'); break;
      case 'to-title': this.show('title'); break;
      case 'to-controls': this.controlsReturn = this.active; this.show('controls'); break;
      case 'controls-back': this.show(this.controlsReturn || 'title'); break;
      case 'start': saveSetup(this.setup); this.cb.onStart(this.buildMatchSetup()); break;
      case 'resume': this.cb.onResume(); break;
      case 'restart': this.cb.onRestart(); break;
      case 'quit': this.cb.onQuit(); break;
      case 'rematch': this.cb.onStart(this.buildMatchSetup()); break;
      case 'rebind': this.beginRebind(el); break;
      case 'padbind': this.beginPadRebind(el); break;
      case 'reset-pad': this.pads?.resetMap(); this.renderControls(); this.focusAct('reset-pad'); break;
      case 'share-fb': shareOnFacebook(this.shareContext()); break;
      case 'share-link': {
        const msg = this.screens[this.active]?.querySelector('.share-msg');
        shareAnywhere(this.shareContext()).then((text) => {
          if (!msg) return;
          msg.textContent = text;
          clearTimeout(this.shareMsgTimer);
          this.shareMsgTimer = setTimeout(() => { msg.textContent = ''; }, 4000);
        });
        break;
      }
      case 'reset-keys':
        DEFAULT_BINDINGS.forEach((b, i) => Object.assign(this.bindings[i], b));
        saveBindings(this.bindings); this.renderControls(); this.focusAct('reset-keys'); break;
      default: this.cb.onAct?.(act, el);
    }
  }

  // What a share button posts: the last match from the results screen, plus the online room to join
  // when one is open (main.js sets shareRoom); the title screen shares the game itself.
  shareContext() {
    if (this.active !== 'results') return {};
    return { result: this.lastResult, room: this.shareRoom?.() || '' };
  }

  focusAct(act) { this.screens[this.active]?.querySelector(`[data-act="${act}"]`)?.focus(); }

  // Fight is you against CPU fighters, free-for-all. Up to four people on one device
  // (keyboard sections and controllers) can join in as P1-P4.
  get players() { return Math.min(4, Math.max(1, this.setup.players || 1), this.setup.count); }

  buildMatchSetup() {
    const s = this.setup;
    return {
      mode: 'cpu', winsNeeded: s.winsNeeded, difficulty: s.difficulty, suddenDeath: s.suddenDeath, quality: s.quality,
      teams: { count: 0, names: [] },
      slots: s.slots.slice(0, s.count).map((x, i) => ({ ...x, control: i < this.players ? i : 'cpu', team: -1 })),
    };
  }

  change(el, d) {
    const s = this.setup;
    const key = el.dataset.opt, i = +el.dataset.i;
    const cyc = (arr, v) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
    if (['touch', 'touchsize', 'rumble', 'seat'].includes(key)) { this.changeDevice(el, d); return; }
    if (!['count', 'wins', 'diff', 'sudden', 'quality', 'music', 'sfx', 'control', 'fighter', 'teams', 'team', 'players'].includes(key)) { this.cb.onOpt?.(key, el, d); return; }
    switch (key) {
      case 'count': s.count = Math.min(8, Math.max(2, s.players, s.count + d)); break;
      case 'players': s.players = Math.min(4, Math.max(1, s.players + d)); s.count = Math.max(s.count, s.players, 2); break;
      case 'wins': s.winsNeeded = Math.min(5, Math.max(1, s.winsNeeded + d)); break;
      case 'diff': s.difficulty = cyc(DIFFS, s.difficulty); break;
      case 'sudden': s.suddenDeath = cyc(SUDDEN, s.suddenDeath); break;
      case 'quality': s.quality = cyc(QUALITY, s.quality); this.cb.onQualityChange?.(s.quality); break;
      case 'music': s.music = Math.min(100, Math.max(0, s.music + d * 10)); this.cb.onVolumeChange?.({ music: s.music / 100 }); break;
      case 'sfx': s.sfx = Math.min(100, Math.max(0, s.sfx + d * 10)); this.cb.onVolumeChange?.({ sfx: s.sfx / 100 }); break;
      case 'teams': s.teams.count = cyc(TEAM_COUNTS, s.teams.count); break;
      case 'team': { const n = s.teams.count || 2; s.slots[i].team = ((s.slots[i].team % n) + d + n) % n; break; }
      case 'control': {
        const v = cyc(CONTROLS, s.slots[i].control);
        // a keyboard player can only own one slot: swap with whoever had it
        if (v !== 'cpu') {
          const other = s.slots.findIndex((x, j) => j !== i && j < s.count && x.control === v);
          if (other >= 0) s.slots[other].control = s.slots[i].control;
        }
        s.slots[i].control = v;
        break;
      }
      case 'fighter': {
        const n = ROSTER.length;
        s.slots[i].fighter = ((s.slots[i].fighter + 1 + d + n + 1) % (n + 1)) - 1; // -1 = random
        break;
      }
    }
    saveSetup(s);
    const focusKey = `${key}:${el.dataset.i ?? ''}`;
    this.renderSetup();
    const again = [...this.screens.setup.querySelectorAll('.nav')].find((x) => `${x.dataset.opt}:${x.dataset.i ?? ''}` === focusKey);
    again?.focus({ preventScroll: true });
  }

  renderSetup() {
    const s = this.setup;
    const opt = (key, label, value, extra = '') =>
      `<button class="nav opt row" data-opt="${key}" ${extra}><span class="lbl">${label}</span><span class="val"><i>‹</i>${value}<i>›</i></span></button>`;
    const rules = this.screens.setup.querySelector('.rules');
    rules.innerHTML = [
      opt('players', 'Players here', this.players === 1 ? 'Just you' : `${this.players} players`),
      opt('count', 'CPU opponents', s.count - this.players),
      opt('wins', 'Rounds to win', s.winsNeeded),
      opt('diff', 'CPU skill', DIFFICULTY[s.difficulty].label),
      opt('sudden', 'Sudden death', s.suddenDeath ? `after ${s.suddenDeath}s` : 'Off'),
      opt('quality', 'Graphics', { auto: 'Auto', high: 'High', low: 'Low' }[s.quality]),
      opt('music', 'Music', s.music ? `${s.music}%` : 'Off'),
      opt('sfx', 'Sound effects', s.sfx ? `${s.sfx}%` : 'Off'),
    ].join('');
    this.teamNamesEl.hidden = true;
    const tc = 0;
    const slots = this.screens.setup.querySelector('.slots');
    slots.innerHTML = s.slots.slice(0, s.count).map((slot, i) => {
      const def = slot.fighter >= 0 ? ROSTER[slot.fighter] : null;
      const human = i < this.players;
      const who = !human ? 'CPU' : this.players === 1 ? 'You' : `P${i + 1}`;
      const whoColor = human ? `style="color:${PLAYER_COLORS[i]}"` : '';
      const how = human ? `<small class="how">${esc(this.deviceText(i))}</small>` : '';
      const sw = def ? hex(def.eyes) : '#888';
      const t = tc ? slot.team % tc : -1;
      const teamBtn = tc ? `<button class="nav opt team" data-opt="team" data-i="${i}" style="--tc:${hex(TEAM_COLORS[t])}"><span>${esc(cleanTeamName(s.teams.names[t], t))}</span></button>` : '';
      return `<div class="slot" style="--fc:${sw}">
        <span class="slot-n">${i + 1}</span>
        <div class="who"><span ${whoColor}>${who}</span>${how}</div>
        <button class="nav opt fighter" data-opt="fighter" data-i="${i}">
          <span class="fname">${def ? esc(def.name) : 'Random'}</span>
          <span class="ftitle">${def ? `${esc(def.title)} · ${esc(moveSummary(def))}` : 'Any of the eight'}</span>
        </button>${teamBtn}
      </div>`;
    }).join('');
    slots.classList.toggle('teamed', !!tc);
    const cpus = s.count - this.players;
    this.screens.setup.querySelector('.setup-note').textContent = (this.players === 1
      ? `You against ${cpus} CPU ${cpus === 1 ? 'fighter' : 'fighters'}`
      : `${this.players} players${cpus ? ` and ${cpus} CPU ${cpus === 1 ? 'fighter' : 'fighters'}` : ''}, everyone for themselves`) +
      ', last one standing takes the round. Grab the power-ups and hit them from behind.';
  }

  updateTeamLabels() {
    const tc = this.setup.teams.count;
    for (const btn of this.screens.setup.querySelectorAll('button.team')) {
      const t = this.setup.slots[+btn.dataset.i].team % tc;
      btn.querySelector('span').textContent = cleanTeamName(this.setup.teams.names[t], t);
    }
  }

  renderTeamNames() {
    const tc = this.setup.teams.count;
    if (this.teamNamesCount === tc) return;
    this.teamNamesCount = tc;
    this.teamNamesEl.hidden = !tc;
    this.teamNamesEl.innerHTML = tc ? `<div class="col-h">Team names</div>${Array.from({ length: tc }, (_, i) => `
      <label class="field team-field" style="--tc:${hex(TEAM_COLORS[i])}"><span class="lbl">Team ${i + 1}</span>
      <input class="nav" data-team="${i}" maxlength="18" autocomplete="off" spellcheck="false" value="${esc(cleanTeamName(this.setup.teams.names[i], i))}"></label>`).join('')}` : '';
  }

  renderControls() {
    const el = this.screens.controls.querySelector('.keys');
    const head = `<div class="kh"></div>${[0, 1, 2, 3].map((p) => `<div class="kh" style="color:${PLAYER_COLORS[p]}">P${p + 1}</div>`).join('')}`;
    const rows = ACTIONS.map((a) => `<div class="ka">${ACTION_LABELS[a]}</div>${[0, 1, 2, 3].map((p) =>
      `<button class="nav key" data-act="rebind" data-p="${p}" data-a="${a}">${esc(keyLabel(this.bindings[p][a]))}</button>`).join('')}`).join('');
    el.innerHTML = head + rows;
    this.renderPads();
  }

  // Controllers: who each connected pad plays as, its button layout (rebindable), rumble; and the touch options.
  renderPads() {
    const scr = this.screens.controls;
    const list = scr.querySelector('.pads-list');
    if (!list) return;
    const pads = this.pads;
    const live = pads ? [0, 1, 2, 3].filter((i) => pads.state(i)) : [];
    list.innerHTML = !pads?.supported ? '<div class="none">This browser does not support game controllers.</div>'
      : !live.length ? '<div class="none">No controller found. Plug one in or pair it, then press any button on it.</div>'
        : live.map((i) => `<button class="nav opt row" data-opt="seat" data-i="${i}"><span class="lbl">${esc(pads.state(i).name)}</span>
          <span class="val"><i>‹</i><b style="color:${PLAYER_COLORS[pads.seatOf(i)]}">plays as P${pads.seatOf(i) + 1}</b><i>›</i></span></button>`).join('');
    const fam = live.length ? pads.state(live[0]).family : 'xbox';
    const grid = scr.querySelector('.pad-grid');
    if (pads?.supported) {
      grid.innerHTML = ACTIONS.map((a) => `<div class="ka">${ACTION_LABELS[a]}</div>
        <button class="nav key" data-act="padbind" data-a="${a}">${padKbd(pads.map[a], fam)}</button>`).join('') +
        '<div class="ka">Pause</div><div class="ka">Start or View (fixed)</div>';
    } else grid.innerHTML = '';
    const opts = scr.querySelector('.touch-opts');
    const s = this.setup;
    const o = (key, label, value) => `<button class="nav opt row" data-opt="${key}"><span class="lbl">${label}</span><span class="val"><i>‹</i>${value}<i>›</i></span></button>`;
    opts.innerHTML = (pads?.supported ? o('rumble', 'Controller rumble', pads.rumbleOn ? 'On' : 'Off') : '') +
      o('touch', 'On-screen touch controls', { auto: 'Auto (touch screens)', on: 'Always on', off: 'Off' }[s.touch || 'auto']) +
      o('touchsize', 'Touch button size', { 0.85: 'Small', 1: 'Medium', 1.18: 'Large' }[s.touchSize] || 'Medium');
  }

  changeDevice(el, d) {
    const s = this.setup, key = el.dataset.opt;
    if (key === 'rumble') { this.pads.setRumble(!this.pads.rumbleOn); if (this.pads.rumbleOn) [0, 1, 2, 3].forEach((i) => this.pads.rumble(i, 0.5, 0.6, 160)); }
    if (key === 'seat') { const i = +el.dataset.i; this.pads.setSeat(i, (this.pads.seatOf(i) + d + 4) % 4); }
    if (key === 'touch') s.touch = TOUCH[(TOUCH.indexOf(s.touch || 'auto') + d + TOUCH.length) % TOUCH.length];
    if (key === 'touchsize') { const i = Math.max(0, TOUCH_SIZES.indexOf(s.touchSize)); s.touchSize = TOUCH_SIZES[(i + d + TOUCH_SIZES.length) % TOUCH_SIZES.length]; }
    saveSetup(s);
    this.cb.onTouchChange?.(s);
    const focusKey = `${key}:${el.dataset.i ?? ''}`;
    this.renderPads();
    [...this.screens.controls.querySelectorAll('.nav')].find((x) => `${x.dataset.opt}:${x.dataset.i ?? ''}` === focusKey)?.focus({ preventScroll: true });
  }

  beginPadRebind(el) {
    if (!this.pads?.supported) return;
    this.padRebinding = el;
    el.classList.add('listening');
    el.textContent = 'Press a button';
    this.pads.capture = (code) => this.endPadRebind(code);
  }

  endPadRebind(code) {
    const el = this.padRebinding;
    this.padRebinding = null;
    if (!el) return;
    if (code && !PAD_RESERVED.has(code)) this.pads.bind(el.dataset.a, code);
    this.renderPads();
    this.screens.controls.querySelector(`[data-act="padbind"][data-a="${el.dataset.a}"]`)?.focus();
  }

  // Refresh whatever lists controllers when one connects or leaves.
  padsChanged() {
    if (this.active === 'controls' && !this.padRebinding) this.renderPads();
    if (this.active === 'setup') this.renderSetup();
  }

  // "Xbox controller", "arrow keys", "touch screen": how player i plays, for the fighter list.
  deviceText(i) {
    const slot = this.pads?.slotsFor(i)[0];
    const keys = ['W A S D keys', 'arrow keys', 'number pad', 'Y B N M keys'][i];
    if (slot !== undefined) return this.pads.state(slot).name;
    if (i === 0 && devices.last === 'touch') return 'touch screen';
    return keys;
  }

  beginRebind(el) {
    this.rebinding = el;
    el.classList.add('listening');
    el.textContent = 'Press a key';
  }

  captureRebind(e) {
    const el = this.rebinding;
    this.rebinding = null;
    el.classList.remove('listening');
    if (e.code !== 'Escape') {
      const p = +el.dataset.p, a = el.dataset.a;
      // clear the key anywhere else it is bound, so no two actions share it
      for (const b of this.bindings) for (const k of ACTIONS) if (b[k] === e.code) b[k] = '';
      this.bindings[p][a] = e.code;
      saveBindings(this.bindings);
    }
    this.renderControls();
    this.screens.controls.querySelector(`[data-p="${el.dataset.p}"][data-a="${el.dataset.a}"]`)?.focus();
    return true;
  }

  showResults(champ, fighters) {
    const el = this.screens.results;
    const teamed = champ.team >= 0 && champ.teamColor != null;
    if (teamed) {
      el.querySelector('.eyebrow').textContent = 'Champions of the arena';
      el.querySelector('.champ').innerHTML = `<span style="color:${hex(champ.teamColor)}">${esc(champ.teamName)}</span>`;
      el.querySelector('.champ-sub').textContent = fighters.filter((f) => f.team === champ.team).map((f) => `${f.name} (${f.label})`).join(' · ');
    } else {
      el.querySelector('.eyebrow').textContent = 'Champion of the arena';
      el.querySelector('.champ').innerHTML = `<span style="color:${hex(champ.def.eyes)}">${esc(champ.name)}</span>`;
      el.querySelector('.champ-sub').textContent = `${champ.label === 'CPU' ? 'CPU' : champ.label} · ${champ.def.title}`;
    }
    this.lastResult = teamed
      ? { winner: champ.teamName, team: true, fighters: fighters.length }
      : { winner: champ.name, by: champ.label, title: champ.def.title, fighters: fighters.length };
    const sorted = [...fighters].sort((a, b) => (teamed ? (b.team === champ.team) - (a.team === champ.team) : 0) ||
      b.stats.wins - a.stats.wins || b.stats.kos - a.stats.kos || b.stats.damage - a.stats.damage);
    el.querySelector('thead').innerHTML = `<tr><th>Fighter</th><th>Played by</th>${teamed ? '<th>Team</th>' : ''}<th>Rounds</th><th>KOs</th><th>Damage</th></tr>`;
    el.querySelector('tbody').innerHTML = sorted.map((f) => `<tr>
      <td><i class="sw" style="background:${hex(f.def.eyes)}"></i>${esc(f.name)}</td>
      <td>${esc(f.label)}</td>${teamed ? `<td style="color:${hex(f.teamColor ?? 0xffffff)}">${esc(f.teamName)}</td>` : ''}<td>${f.stats.wins}</td><td>${f.stats.kos}</td><td>${Math.round(f.stats.damage)}</td></tr>`).join('');
    this.show('results');
  }
}

// A controller button as a coloured glyph: the four face buttons keep their usual colours.
export function padKbd(code, fam = 'xbox') {
  const n = /^b([0-3])$/.exec(code || '');
  const color = n ? (fam === 'nintendo' ? ['f1', 'f0', 'f3', 'f2'] : ['f0', 'f1', 'f2', 'f3'])[+n[1]] : '';
  return `<kbd class="pad ${fam === 'xbox' || fam === 'nintendo' ? color : ''}">${esc(padLabel(code, fam))}</kbd>`;
}

// Pick the closest focusable element in an arrow direction.
function spatialNext(cur, items, dir) {
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const q = el.getBoundingClientRect();
    const x = q.left + q.width / 2, y = q.top + q.height / 2;
    const dx = x - cx, dy = y - cy;
    // sideways distance counts from the edges, so a wide field above a short button still leads to it
    const gapX = Math.max(0, q.left - r.right, r.left - q.right), gapY = Math.max(0, q.top - r.bottom, r.top - q.bottom);
    let main, cross;
    if (dir === 'up') { main = -dy; cross = gapX + Math.abs(dx) * 0.1; } else if (dir === 'down') { main = dy; cross = gapX + Math.abs(dx) * 0.1; }
    else if (dir === 'left') { main = -dx; cross = gapY + Math.abs(dy) * 0.1; } else { main = dx; cross = gapY + Math.abs(dy) * 0.1; }
    if (main <= 2) continue;
    const score = main + cross * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best && (dir === 'down' || dir === 'up')) {
    // wrap around
    const i = items.indexOf(cur);
    best = dir === 'down' ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
  }
  return best;
}
