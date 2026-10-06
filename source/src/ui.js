// Keyboard-first menus: title, fight setup, controls/rebinding, pause, results.
import { ROSTER, DIFFICULTY, ACTIONS, ACTION_LABELS, PLAYER_COLORS, DEFAULT_BINDINGS, SPECIALS, SKILLS, keyLabel,
  TEAM_COLORS, TEAM_DEFAULT_NAMES, TEAM_COUNTS, cleanTeamName } from './config.js';
import { saveBindings } from './input.js';

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

export class Menus {
  constructor({ keyboard, bindings, onStart, onResume, onRestart, onQuit, onQualityChange, onVolumeChange, onAct, onOpt, onShow }) {
    this.kb = keyboard;
    this.bindings = bindings;
    this.setup = loadSetup();
    this.cb = { onStart, onResume, onRestart, onQuit, onQualityChange, onVolumeChange, onAct, onOpt, onShow };
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
      if (t && this.active && this.screens[this.active].contains(t)) this.activate(t);
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

  // true when a fundraising group has been entered; otherwise points the player at the field
  requireGroup() {
    if (this.group) return true;
    this.groupErr.textContent = 'Enter your fundraising group to join the fight.';
    this.groupEl.classList.add('bad');
    this.groupEl.focus();
    return false;
  }

  runAct(act, el) {
    if ((act === 'to-setup' || act === 'to-online') && this.active === 'title' && !this.requireGroup()) return;
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
      case 'reset-keys':
        DEFAULT_BINDINGS.forEach((b, i) => Object.assign(this.bindings[i], b));
        saveBindings(this.bindings); this.renderControls(); this.focusAct('reset-keys'); break;
      default: this.cb.onAct?.(act, el);
    }
  }

  focusAct(act) { this.screens[this.active]?.querySelector(`[data-act="${act}"]`)?.focus(); }

  buildMatchSetup() {
    const s = this.setup;
    const tc = s.teams.count;
    return {
      winsNeeded: s.winsNeeded, difficulty: s.difficulty, suddenDeath: s.suddenDeath, quality: s.quality,
      teams: { count: tc, names: s.teams.names.slice(0, tc).map((n, i) => cleanTeamName(n, i)) },
      slots: s.slots.slice(0, s.count).map((x) => ({ ...x, team: tc ? x.team % tc : -1 })),
    };
  }

  change(el, d) {
    const s = this.setup;
    const key = el.dataset.opt, i = +el.dataset.i;
    const cyc = (arr, v) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
    if (!['count', 'wins', 'diff', 'sudden', 'quality', 'music', 'sfx', 'control', 'fighter', 'teams', 'team'].includes(key)) { this.cb.onOpt?.(key, el, d); return; }
    switch (key) {
      case 'count': s.count = Math.min(8, Math.max(2, s.count + d)); break;
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
      opt('count', 'Fighters', s.count),
      opt('wins', 'Rounds to win', s.winsNeeded),
      opt('diff', 'CPU skill', DIFFICULTY[s.difficulty].label),
      opt('sudden', 'Sudden death', s.suddenDeath ? `after ${s.suddenDeath}s` : 'Off'),
      opt('teams', 'Teams', s.teams.count ? `${s.teams.count} teams` : 'Free-for-all'),
      opt('quality', 'Graphics', { auto: 'Auto', high: 'High', low: 'Low' }[s.quality]),
      opt('music', 'Music', s.music ? `${s.music}%` : 'Off'),
      opt('sfx', 'Sound effects', s.sfx ? `${s.sfx}%` : 'Off'),
    ].join('');
    this.renderTeamNames();
    const tc = s.teams.count;
    const slots = this.screens.setup.querySelector('.slots');
    slots.innerHTML = s.slots.slice(0, s.count).map((slot, i) => {
      const def = slot.fighter >= 0 ? ROSTER[slot.fighter] : null;
      const who = slot.control === 'cpu' ? 'CPU' : `Player ${slot.control + 1}`;
      const whoColor = slot.control === 'cpu' ? '' : `style="color:${PLAYER_COLORS[slot.control]}"`;
      const sw = def ? hex(def.eyes) : '#888';
      const t = tc ? slot.team % tc : -1;
      const teamBtn = tc ? `<button class="nav opt team" data-opt="team" data-i="${i}" style="--tc:${hex(TEAM_COLORS[t])}"><span>${esc(cleanTeamName(s.teams.names[t], t))}</span></button>` : '';
      return `<div class="slot" style="--fc:${sw}">
        <span class="slot-n">${i + 1}</span>
        <button class="nav opt who" data-opt="control" data-i="${i}"><span ${whoColor}>${who}</span></button>
        <button class="nav opt fighter" data-opt="fighter" data-i="${i}">
          <span class="fname">${def ? esc(def.name) : 'Random'}</span>
          <span class="ftitle">${def ? `${esc(def.title)} · ${esc(moveSummary(def))}` : 'Any of the eight'}</span>
        </button>${teamBtn}
      </div>`;
    }).join('');
    slots.classList.toggle('teamed', !!tc);
    const humans = s.slots.slice(0, s.count).filter((x) => x.control !== 'cpu').length;
    const goal = tc ? 'Last team standing takes the round. Teammates cannot hurt each other.' : 'Last one standing takes the round.';
    this.screens.setup.querySelector('.setup-note').textContent = humans
      ? `${humans} on the keyboard, ${s.count - humans} CPU. ${goal}`
      : `Everyone is CPU. Sit back and watch, or set a slot to a player. ${goal}`;
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
    const sorted = [...fighters].sort((a, b) => (teamed ? (b.team === champ.team) - (a.team === champ.team) : 0) ||
      b.stats.wins - a.stats.wins || b.stats.kos - a.stats.kos || b.stats.damage - a.stats.damage);
    el.querySelector('thead').innerHTML = `<tr><th>Fighter</th><th>Played by</th>${teamed ? '<th>Team</th>' : ''}<th>Rounds</th><th>KOs</th><th>Damage</th></tr>`;
    el.querySelector('tbody').innerHTML = sorted.map((f) => `<tr>
      <td><i class="sw" style="background:${hex(f.def.eyes)}"></i>${esc(f.name)}</td>
      <td>${esc(f.label)}</td>${teamed ? `<td style="color:${hex(f.teamColor ?? 0xffffff)}">${esc(f.teamName)}</td>` : ''}<td>${f.stats.wins}</td><td>${f.stats.kos}</td><td>${Math.round(f.stats.damage)}</td></tr>`).join('');
    this.show('results');
  }
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
    let main, cross;
    if (dir === 'up') { main = -dy; cross = dx; } else if (dir === 'down') { main = dy; cross = dx; }
    else if (dir === 'left') { main = -dx; cross = dy; } else { main = dx; cross = dy; }
    if (main <= 2) continue;
    const score = main + Math.abs(cross) * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best && (dir === 'down' || dir === 'up')) {
    // wrap around
    const i = items.indexOf(cur);
    best = dir === 'down' ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
  }
  return best;
}
