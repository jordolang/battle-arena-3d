// Character select and locker room: a roster of fighters with portraits, a turning 3D preview on a
// pedestal, each fighter's stats and moves, and the wardrobe (outfit, headgear, back piece, victory
// pose). Hovering an item tries it on; Enter or a click wears it if it is unlocked.
// Keyboard-first like every other screen: arrows move, Enter picks, Esc goes back.
import * as THREE from 'three';
import { ROSTER, SPECIALS, SKILLS } from './config.js';
import { buildFighterModel, computePose, applyPose, animateLife } from './fighterModel.js';
import { dressFighter } from './wardrobeModels.js';
import { wardrobe, bodyDef, BODY, BODY_KEYS, ITEMS, SLOTS, SLOT_LABELS, RARITY, DEFAULT_LOOK, ITEM_COUNT, outfitColors, sanitizeLook } from './cosmetics.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

// small line icons for items that are not colours
const ICONS = {
  none: '<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>',
  bandana: '<path d="M4 11c3-2 13-2 16 0"/><path d="M4 11v2c3-1.5 13-1.5 16 0v-2"/><path d="M19 12l2 5M18 13l0 5"/>',
  luchador: '<path d="M12 3c-5 0-7 4-7 8 0 5 3 9 7 10 4-1 7-5 7-10 0-4-2-8-7-8z"/><path d="M7.5 11c1-1.5 3-1.5 3.5 0M13 11c.5-1.5 2.5-1.5 3.5 0"/><path d="M10 17h4"/>',
  sombrero: '<ellipse cx="12" cy="16" rx="10" ry="2.5"/><path d="M8.5 15.5c0-6 1.5-9 3.5-9s3.5 3 3.5 9"/><path d="M8.7 13h6.6"/>',
  jinete: '<ellipse cx="12" cy="14" rx="9" ry="1.8"/><path d="M8 13.5V9h8v4.5"/><path d="M6 19h12" stroke-dasharray="2 2"/>',
  chiliCrown: '<path d="M5 18h14"/><path d="M6 17c-1-4 0-8 2-10M10 17c-.5-4 .5-9 2-11M14 17c.5-4 1-8 3-10M18 17c.5-3 1-6 2-7"/>',
  jmBandana: '<path d="M4 11c3-2 13-2 16 0"/><path d="M4 11v2c3-1.5 13-1.5 16 0v-2"/><circle cx="12" cy="9" r="1.6"/><path d="M19 12l2 5"/>',
  kingCrown: '<path d="M4 18h16l1-10-5 4-4-6-4 6-5-4z"/><circle cx="12" cy="15" r="1"/>',
  cape: '<path d="M8 4h8l4 16H4z"/><path d="M8 4c1 2 7 2 8 0"/>',
  chiliBanner: '<path d="M6 3v18"/><path d="M6 4h12v9H6"/><path d="M11 7c2 0 3 2 2 4"/>',
  salsaJar: '<rect x="7" y="7" width="10" height="13" rx="2"/><rect x="8" y="3.5" width="8" height="3.5" rx="1"/><path d="M7 12h10M7 16h10"/>',
  jmStandard: '<path d="M6 3v18"/><path d="M6 4h12v9H6"/><path d="M9 7h6v3H9z"/>',
  goldMantle: '<path d="M8 4h8l4 16H4z"/><path d="M8 4l-1 16M16 4l1 16M12 5v15"/>',
  gi: '<path d="M7 4l5 3 5-3 3 5-3 2v9H7v-9L4 9z"/><path d="M12 7l-3 7"/>',
  tee: '<path d="M8 4h8l4 4-3 2v10H7V10L4 8z"/>',
  tank: '<path d="M9 3v4c0 2 6 2 6 0V3M9 7L7 10v10h10V10l-2-3"/>',
  hoodie: '<path d="M8 6c0-3 8-3 8 0l4 3-3 2v9H7v-9L4 9z"/><path d="M9 15h6v3H9z"/>',
  poncho: '<path d="M10 4h4l7 12H3z"/><path d="M5 12h14M7 9h10M4 14h16"/>',
  apron: '<path d="M9 3h6v5l3 1v12H6V9l3-1z"/><path d="M6 11h12"/>',
  leather: '<path d="M8 4h8l4 4-3 2v10H7V10L4 8z"/><path d="M12 6v14M9 4l3 4 3-4"/>',
  charro: '<path d="M7 4h10l3 5-3 1v4H7v-4L4 9z"/><circle cx="10" cy="9" r=".6"/><circle cx="14" cy="9" r=".6"/><circle cx="10" cy="12" r=".6"/><circle cx="14" cy="12" r=".6"/>',
  jmTee: '<path d="M8 4h8l4 4-3 2v10H7V10L4 8z"/><path d="M11 10c2 0 3 2 1 5"/>',
  matador: '<path d="M7 4h10l3 5-3 1v4H7v-4L4 9z"/><path d="M3 6h4M17 6h4"/>',
  shorts: '<path d="M6 5h12l1 10h-6l-1-5-1 5H5z"/>',
  jeans: '<path d="M7 3h10l1 18h-4l-2-12-2 12H6z"/>',
  cargo: '<path d="M7 3h10l1 18h-4l-2-12-2 12H6z"/><path d="M5.5 11h2v3h-2M16.5 11h2v3h-2"/>',
  jmJoggers: '<path d="M7 3h10l1 18h-4l-2-12-2 12H6z"/><path d="M7 4l-1 16M17 4l1 16"/>',
  wraps: '<path d="M6 8c3-2 9-2 12 0M6 12c3-2 9-2 12 0M6 16c3-2 9-2 12 0"/>',
  sneakers: '<path d="M4 17h17v2H4zM5 17v-6l5-1 3 3 7 2v2"/>',
  huaraches: '<path d="M4 18h16"/><path d="M7 18c0-3 1-5 3-6M12 18c0-3 2-5 4-6"/>',
  boots: '<path d="M8 3h6v10l6 3v3H8z"/><path d="M8 19h2"/>',
  goldBoots: '<path d="M8 3h6v10l6 3v3H8z"/><path d="M8 7h6"/>',
  mma: '<path d="M7 9h10v8a3 3 0 01-3 3h-4a3 3 0 01-3-3z"/><path d="M9 9V6M12 9V5M15 9V6"/>',
  boxing: '<path d="M7 9a5 5 0 0110 0v6a3 3 0 01-3 3h-4a3 3 0 01-3-3z"/><path d="M8 18h8v3H8z"/>',
  gauntlets: '<path d="M8 12h8l1 8H7z"/><path d="M8 12l1-6h6l1 6M9 9h6"/>',
  mitts: '<path d="M8 20V10a4 4 0 018 0v10z"/><path d="M16 12l3-2"/><path d="M8 17h8"/>',
  fist: '<path d="M8 21v-6M16 21v-6"/><circle cx="12" cy="7" r="2"/><path d="M12 9v6M12 10l5-6M12 10l-4 3"/>',
  salsa: '<circle cx="12" cy="5" r="2"/><path d="M12 7l-1 7 -3 6M11 14l4 6"/><path d="M12 9l-5-2M12 9l5 1"/>',
  flex: '<circle cx="12" cy="6" r="2"/><path d="M12 8v7l-3 6M12 15l3 6"/><path d="M5 6v4h7h7V6"/>',
  beckon: '<circle cx="10" cy="5" r="2"/><path d="M10 7v8l-3 6M10 15l3 6"/><path d="M10 9l7 1 1-3"/>',
  bow: '<circle cx="15" cy="9" r="2"/><path d="M13 9l-5 3v9M8 12l2 9"/><path d="M12 10l-6-1M12 10l5 4"/>',
};
const PANTS = '<path d="M7 3h10l1 18h-4l-2-12-2 12H6z"/>';
Object.assign(ICONS, {
  'legs:gi': '<path d="M6 3h12l2 18h-5l-3-11-3 11H4z"/><path d="M6 6h12"/>',
  'legs:charro': PANTS + '<circle cx="6.8" cy="9" r=".6"/><circle cx="6.5" cy="13" r=".6"/><circle cx="17.2" cy="9" r=".6"/><circle cx="17.5" cy="13" r=".6"/>',
  'legs:matador': '<path d="M7 3h10l1 11h-4l-2-6-2 6H6z"/><path d="M7 14l1 7M17 14l-1 7"/>',
  'hands:wraps': '<path d="M7 7h10M7 11h10M7 15h10"/><path d="M7 5v14M17 5v14"/>',
});
const icon = (id, slot) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[`${slot}:${id}`] || ICONS[id] || ICONS.none}</svg>`;

// roster ranges, so a stat bar reads "how this fighter compares"
const RANGE = (k) => { const v = ROSTER.map((d) => d[k]); return [Math.min(...v), Math.max(...v)]; };
const STATS = [['health', 'Health'], ['power', 'Power'], ['speed', 'Speed']].map(([k, label]) => ({ k, label, range: RANGE(k) }));

export class CharacterSelect {
  constructor({ menus }) {
    this.menus = menus;
    this.el = menus.screens.select;
    this.q = (s) => this.el.querySelector(s);
    this.canvas = this.q('.cs-canvas');
    this.portraits = new Map(); // `${index}|${look}` -> data URL
    this.opts = null;
    this.fighter = 0;
    this.tab = 'top';
    this.tryOn = null;          // { slot, id } shown on the model while hovered
    this.yaw = 0.35;
    this.yawGoal = null;
    this.dragging = null;
    this.running = false;

    // hovering or arrowing onto a card previews that fighter; onto an item tries it on
    this.el.addEventListener('focusin', (e) => {
      const t = e.target.closest('.nav');
      if (!t) return;
      if (t.dataset.act === 'cs-pick') this.setFighter(+t.dataset.i);
      else if (t.dataset.act === 'cs-tab') this.setTab(t.dataset.slot);
      else if (t.dataset.act === 'cs-item') this.preview(t.dataset.slot, t.dataset.id);
      if (t.dataset.act !== 'cs-item' && this.tryOn) this.preview(null);
    });
    // drag (mouse or finger) to turn the fighter
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, yaw: this.yaw };
      this.yawGoal = null;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.yaw = this.dragging.yaw + (e.clientX - this.dragging.x) * 0.012;
    });
    const drop = () => { this.dragging = null; this.idleFor = 0; };
    this.canvas.addEventListener('pointerup', drop);
    this.canvas.addEventListener('pointercancel', drop);
    wardrobe.onChange(() => { if (this.menus.active === 'select') this.renderWardrobe(); });
  }

  // opts: { context, fighter, wardrobe (show cosmetics), random (offer the random card), confirm (button text),
  //         note (shown instead of the wardrobe), onChange() after the wardrobe changes, onConfirm(index), onClose(index, confirmed), back (screen to return to) }
  open(opts) {
    this.opts = { wardrobe: true, random: true, ...opts };
    this.ensureRenderer();
    const start = Number.isInteger(opts.fighter) ? opts.fighter : 0;
    this.fighter = start < 0 && !this.opts.random ? 0 : start;
    this.tab = 'body';
    this.tryOn = null;
    this.q('.cs-context').textContent = opts.context || 'Fighters';
    this.q('.cs-head h2').textContent = opts.heading || 'Choose your fighter';
    this.renderRoster();
    this.menus.show('select');
    this.setFighter(this.fighter, true);
    this.focusCard(this.fighter);
    this.start();
  }

  close(confirmed) {
    const o = this.opts;
    if (!o) return;
    this.opts = null;
    this.preview(null);
    if (confirmed) o.onConfirm?.(this.fighter);
    if (o.back) this.menus.show(o.back);
    o.onClose?.(this.fighter, confirmed);
  }

  onAct(act, el) {
    switch (act) {
      case 'cs-pick':
        // Enter on a card moves on to the wardrobe (or straight to the confirm button)
        this.setFighter(+el.dataset.i);
        (this.opts?.wardrobe && this.fighter >= 0 ? this.q(`.cs-tab[data-slot="${this.tab}"]`) : this.q('[data-act="cs-confirm"]'))?.focus();
        break;
      case 'cs-tab':
        this.setTab(el.dataset.slot);
        this.q('.cs-items .nav, .cs-body-opts .nav')?.focus();
        break;
      case 'cs-item': this.equip(el.dataset.slot, el.dataset.id, el); break;
      case 'cs-confirm': this.close(true); break;
      case 'cs-cancel': this.close(false); break;
      case 'cs-reset':
        if (this.fighter >= 0) { wardrobe.setLook(this.fighter, DEFAULT_LOOK); this.opts?.onChange?.(); this.updateModel(); this.refreshPortrait(this.fighter); this.flash('Back to their original look.'); }
        break;
    }
  }

  // ------------------------------------------------------------- state
  setFighter(i, force = false) {
    if (!force && i === this.fighter && this.model) return;
    this.fighter = i;
    this.tryOn = null;
    for (const c of this.el.querySelectorAll('.cs-card')) c.classList.toggle('on', +c.dataset.i === i);
    this.renderInfo();
    this.renderWardrobe();
    this.renderActions();
    this.updateModel(true);
  }

  setTab(slot) {
    if ((slot !== 'body' && !SLOTS.includes(slot)) || slot === this.tab) return;
    this.tab = slot;
    this.renderWardrobe();
    this.cameraFor(slot);
  }

  get look() { return this.fighter >= 0 ? wardrobe.lookFor(this.fighter) : { ...DEFAULT_LOOK }; }

  preview(slot, id) {
    const next = slot ? { slot, id } : null;
    if (JSON.stringify(next) === JSON.stringify(this.tryOn)) return;
    this.tryOn = next;
    this.renderDetail();
    if (slot) this.cameraFor(slot);
    this.updateModel();
  }

  equip(slot, id, el) {
    if (this.fighter < 0) return;
    if (!wardrobe.isUnlocked(slot, id)) {
      el?.classList.remove('nope'); void el?.offsetWidth; el?.classList.add('nope');
      this.flash(`Locked. ${wardrobe.progress(slot, id).text} to earn it.`);
      return;
    }
    wardrobe.setLook(this.fighter, { ...this.look, [slot]: id });
    this.opts?.onChange?.();
    this.tryOn = null;
    this.updateModel();
    this.refreshPortrait(this.fighter);
    this.renderWardrobe();
    this.q(`.cs-item[data-slot="${slot}"][data-id="${id}"]`)?.focus({ preventScroll: true });
    if (slot === 'victory') this.cheer();
  }

  flash(text) {
    const m = this.q('.cs-msg');
    m.textContent = text;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => { m.textContent = ''; }, 3500);
  }

  focusCard(i) { this.q(`.cs-card[data-i="${i}"]`)?.focus({ preventScroll: true }); }

  // ------------------------------------------------------------- DOM
  renderRoster() {
    const cards = ROSTER.map((def, i) => `<button class="nav cs-card" data-act="cs-pick" data-i="${i}" style="--fc:${hex(def.eyes)}">
        <img class="cs-portrait" alt="" data-i="${i}">
        <span class="cs-cname">${esc(def.name)}</span><span class="cs-role">${esc(def.role || '')}</span></button>`);
    if (this.opts.random) cards.push(`<button class="nav cs-card random" data-act="cs-pick" data-i="-1" style="--fc:#a3968a">
        <span class="cs-portrait q">?</span><span class="cs-cname">Random</span><span class="cs-role">Any of the eight</span></button>`);
    this.q('.cs-roster').innerHTML = cards.join('');
    ROSTER.forEach((_, i) => this.refreshPortrait(i));
    const st = wardrobe.stats;
    this.q('.cs-record').innerHTML = this.opts.wardrobe
      ? `<span><b>${st.wins}</b> wins</span><span><b>${st.kos}</b> KOs</span><span><b>${st.matches}</b> matches</span><span class="cs-owned"><b>${wardrobe.unlockedCount}</b>/${ITEM_COUNT} unlocked</span>`
      : '';
  }

  renderInfo() {
    const el = this.q('.cs-info');
    const def = ROSTER[this.fighter];
    this.q('.cs-name').textContent = def ? def.name : 'Random';
    this.q('.cs-title').textContent = def ? def.title : 'A different fighter every match';
    this.q('.cs-stage').style.setProperty('--fc', def ? hex(def.eyes) : '#a3968a');
    if (!def) {
      el.innerHTML = `<p class="cs-blurb">Leave it to fate: you get one of the eight at random when the fight starts${this.opts.wardrobe ? ', wearing the look you saved for them' : ''}.</p>`;
      return;
    }
    const bars = STATS.map(({ k, label, range: [lo, hi] }) => {
      const pct = Math.round(30 + 70 * ((def[k] - lo) / (hi - lo || 1)));
      return `<div class="cs-stat"><span>${label}</span><div class="cs-bar"><i style="width:${pct}%"></i></div></div>`;
    }).join('');
    const sp = SPECIALS[def.special];
    const moves = [`<li><b>Special · ${esc(sp.label)}</b><span>${esc(sp.hint)}</span></li>`,
      ...(def.skills || []).map((id, n) => `<li><b>Skill ${n + 1} · ${esc(SKILLS[id].label)}</b><span>${esc(SKILLS[id].hint)}</span></li>`)].join('');
    el.innerHTML = `<div class="cs-class"><span class="cs-badge">${esc(def.role || 'Fighter')}</span></div>
      <div class="cs-stats">${bars}</div><ul class="cs-moves">${moves}</ul>`;
  }

  renderWardrobe() {
    const box = this.q('.cs-wardrobe');
    if (!this.opts) return;
    if (!this.opts.wardrobe) {
      box.hidden = !this.opts.note;
      box.innerHTML = `<p class="cs-blurb">${esc(this.opts.note || '')}</p>`;
      return;
    }
    if (this.fighter < 0) {
      box.hidden = false;
      box.innerHTML = '<p class="cs-blurb">Pick a fighter to change their outfit. Every fighter keeps their own look.</p>';
      return;
    }
    box.hidden = false;
    const look = this.look;
    const def = ROSTER[this.fighter];
    const tabs = ['body', ...SLOTS].map((s) => `<button class="nav cs-tab${s === this.tab ? ' on' : ''}" data-act="cs-tab" data-slot="${s}">${s === 'body' ? 'Body' : SLOT_LABELS[s]}</button>`).join('');
    const focused = document.activeElement;
    const keep = box.contains(focused) ? `${focused.dataset.act}|${focused.dataset.slot}|${focused.dataset.id || ''}` : null;
    if (this.tab === 'body') {
      // body customisation: a row of choices per feature, all free
      const rows = BODY_KEYS.map((k) => {
        const opts = Object.entries(BODY[k].options).map(([id, o]) => {
          const on = look[k] === id;
          const own = id === 'own';
          let face;
          if (k === 'hairStyle') face = `<span class="cs-otext">${esc(own ? 'Own' : o.label)}</span>`;
          else if (k === 'beard') face = `<span class="cs-otext">${esc(own ? 'Own' : o.value ? 'Beard' : 'None')}</span>`;
          else {
            const col = own ? (k === 'skin' ? def.skin : k === 'eyes' ? def.eyes : def.hair) : o.value;
            face = `<span class="cs-dot${own ? ' own' : ''}" style="--d:${hex(col)}"></span>`;
          }
          return `<button class="nav cs-opt${on ? ' worn' : ''}" data-act="cs-item" data-slot="${k}" data-id="${id}" title="${esc(o.label)}">${face}</button>`;
        }).join('');
        return `<div class="cs-orow"><div class="cs-olabel">${esc(BODY[k].label)}</div><div class="cs-opts">${opts}</div></div>`;
      }).join('');
      box.innerHTML = `<div class="cs-tabs">${tabs}</div><div class="cs-body-opts">${rows}</div><div class="cs-detail"></div>`;
      if (keep) [...box.querySelectorAll('.nav')].find((x) => `${x.dataset.act}|${x.dataset.slot}|${x.dataset.id || ''}` === keep)?.focus({ preventScroll: true });
      this.renderDetail();
      return;
    }
    const items = Object.entries(ITEMS[this.tab]).map(([id, it]) => {
      const owned = wardrobe.isUnlocked(this.tab, id);
      const worn = look[this.tab] === id;
      const r = RARITY[it.rarity];
      let face;
      if (this.tab === 'outfit' || ITEMS[this.tab][id].color) {
        // colour schemes and dyed clothes show their colours (clothes over their icon)
        const c = outfitColors(def, this.tab === 'outfit' ? id : look.outfit);
        const it2 = ITEMS[this.tab][id];
        face = this.tab === 'outfit'
          ? `<span class="cs-swatch fin-${c.finish}" style="--a:${hex(c.gi)};--b:${hex(c.trim)};--c:${hex(c.accent)}"></span>`
          : `<span class="cs-ico" style="color:${hex(c[it2.color] ?? 0xcccccc)}">${icon(id, this.tab)}</span>`;
      } else face = `<span class="cs-ico">${icon(id, this.tab)}</span>`;
      const p = owned ? null : wardrobe.progress(this.tab, id);
      const bar = p && p.need > 1 ? `<span class="cs-prog"><i style="width:${Math.round((100 * p.have) / p.need)}%"></i></span>` : '';
      return `<button class="nav cs-item${owned ? '' : ' locked'}${worn ? ' worn' : ''}" data-act="cs-item" data-slot="${this.tab}" data-id="${id}" style="--rc:${r.color}" title="${esc(it.label)}">
        ${face}<span class="cs-iname">${esc(it.label)}</span>${owned ? '' : '<span class="cs-lock" aria-label="Locked">🔒</span>'}${bar}</button>`;
    }).join('');
    box.innerHTML = `<div class="cs-tabs">${tabs}</div><div class="cs-items">${items}</div><div class="cs-detail"></div>`;
    if (keep) [...box.querySelectorAll('.nav')].find((x) => `${x.dataset.act}|${x.dataset.slot}|${x.dataset.id || ''}` === keep)?.focus({ preventScroll: true });
    this.renderDetail();
  }

  renderDetail() {
    const el = this.q('.cs-detail');
    if (!el || this.fighter < 0) return;
    const slot = this.tryOn?.slot || this.tab;
    if (slot === 'body' || BODY[slot]) {
      const k = BODY[slot] ? slot : null;
      const o = k && BODY[k].options[this.tryOn?.id || this.look[k]];
      el.innerHTML = k
        ? `<div class="cs-dname">${esc(BODY[k].label)}: ${esc(o.label)}</div><p>Free. Every fighter keeps their own body choices.</p><p class="cs-state">${this.look[k] === (this.tryOn?.id || this.look[k]) ? 'Chosen' : 'Press Enter to choose'}</p>`
        : '<div class="cs-dname">Make them yours</div><p>Skin tone, hair, beard and eye glow. All free, saved for each fighter.</p>';
      return;
    }
    const id = this.tryOn?.id || this.look[slot];
    const it = ITEMS[slot][id];
    const r = RARITY[it.rarity];
    const p = wardrobe.progress(slot, id);
    const owned = wardrobe.isUnlocked(slot, id);
    const worn = this.look[slot] === id;
    const state = worn ? 'Wearing' : owned ? 'Press Enter to wear' : `Locked · ${p.text}${p.need > 1 ? ` (${p.have}/${p.need})` : ''}`;
    el.innerHTML = `<div class="cs-dname" style="--rc:${r.color}">${esc(it.label)} <small>${r.label}</small></div>
      <p>${esc(it.hint)}</p><p class="cs-state${owned ? '' : ' locked'}">${esc(state)}</p>`;
  }

  renderActions() {
    const o = this.opts;
    if (!o) return;
    const def = ROSTER[this.fighter];
    const label = o.confirm ? o.confirm(def) : def ? `Fight as ${def.name}` : 'Fight as a random fighter';
    this.q('.cs-actions').innerHTML = `<button class="nav big primary" data-act="cs-confirm">${esc(label)}</button>
      ${o.wardrobe && def ? '<button class="nav big" data-act="cs-reset">Reset look</button>' : ''}
      <button class="nav big" data-act="cs-cancel">Back</button><span class="cs-msg" role="status"></span>`;
  }

  // ------------------------------------------------------------- 3D preview
  ensureRenderer() {
    if (this.renderer) return;
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    this.renderer = r;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.cam = { pos: new THREE.Vector3(0, 1.3, 6.0), look: new THREE.Vector3(0, 0.86, 0) };
    this.camGoal = { pos: this.cam.pos.clone(), look: this.cam.look.clone() };

    scene.add(new THREE.HemisphereLight(0xffe2c4, 0x2a1410, 1.1));
    const key = new THREE.DirectionalLight(0xffd2a0, 2.6);
    key.position.set(2.5, 4.5, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 1, far: 12 });
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff6a2a, 2.2);
    rim.position.set(-3, 2.5, -3);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x8fb8ff, 0.6);
    fill.position.set(-3, 1.5, 3);
    scene.add(fill);

    // a basalt pedestal with an ember ring
    const stone = new THREE.MeshStandardMaterial({ color: 0x2a2226, roughness: 0.85 });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.18, 0.22, 48), stone);
    ped.position.y = -0.11; ped.receiveShadow = true; scene.add(ped);
    const top = new THREE.Mesh(new THREE.CircleGeometry(1.02, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3034, roughness: 0.7 }));
    top.position.y = 0.002; top.receiveShadow = true; scene.add(top);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.85 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.09, 0.018, 8, 64).rotateX(Math.PI / 2), this.ringMat);
    ring.position.y = 0.01; scene.add(ring);
    this.holder = new THREE.Group();
    scene.add(this.holder);
  }

  // Rebuilds the preview model for the current fighter, wearing their look plus whatever is being tried on.
  updateModel(swap = false) {
    if (!this.renderer) return;
    const index = this.fighter >= 0 ? this.fighter : this.randomShow ?? 0;
    const look = { ...(this.fighter >= 0 ? this.look : wardrobe.lookFor(index)) };
    if (this.tryOn) look[this.tryOn.slot] = this.tryOn.id;
    const key = `${index}|${JSON.stringify(look)}`;
    if (this.modelKey === key) return;
    this.modelKey = key;
    this.disposeModel();
    const def = ROSTER[index];
    const model = dressFighter(buildFighterModel(bodyDef(def, look)), def, look);
    model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    model.ring.visible = false;
    this.model = model;
    this.def = def;
    this.ringMat.color.setHex(this.fighter >= 0 ? def.eyes : 0xa3968a);
    this.holder.add(model.root);
    // stand-in for the fighter state the pose code reads
    this.puppet = { state: 'idle', animTime: this.puppet?.animTime || 0, stateTime: 0, runPhase: 0, moveAmount: 0, grounded: true, alive: true,
      exhausted: false, facing: 0, vel: { x: 0, z: 0 }, def, model, specialPhase: 0 };
    for (const k of Object.keys(model.current)) if (typeof model.current[k] === 'object') Object.assign(model.current[k], { x: 0, y: 0, z: 0 });
    if (swap) this.pop = 0;
    if (this.tryOn?.slot === 'victory') this.cheer(99);
    if (this.fighter < 0) model.mats.forEach((m) => { m.color?.multiplyScalar(0.12); m.emissive?.setHex(0x110805); });
    this.cameraFor(this.tryOn?.slot || null);
  }

  disposeModel() {
    if (!this.model) return;
    this.holder.remove(this.model.root);
    for (const m of this.model.mats) m.dispose();
    for (const m of [this.model.eyeMat, this.model.ring.material, this.model.ice.material, this.model.aura.material, this.model.shell.material]) m.dispose();
    this.model = null;
  }

  // plays the victory pose for a few seconds (`secs` 99 = while it is being tried on)
  cheer(secs = 3.2) { this.cheerFor = secs; }

  // camera presets: close on the head for headgear, round the back for back pieces
  cameraFor(slot) {
    const s = this.def?.scale || 1;
    if (!this.camGoal) return;
    if (slot === 'top' || slot === 'hands') { this.camGoal.pos.set(0, 1.5 * s, 3.1); this.camGoal.look.set(0, 1.25 * s, 0); this.yawGoal = 0.45; }
    else if (slot === 'legs') { this.camGoal.pos.set(0, 1.0 * s, 3.6); this.camGoal.look.set(0, 0.6 * s, 0); this.yawGoal = 0.45; }
    else if (slot === 'feet') { this.camGoal.pos.set(0, 0.75 * s, 2.4); this.camGoal.look.set(0, 0.22 * s, 0); this.yawGoal = 0.55; }
    else if (slot === 'head' || slot === 'hairStyle' || slot === 'hairColor' || slot === 'beard' || slot === 'eyes') { this.camGoal.pos.set(0, 1.85 * s, 2.3); this.camGoal.look.set(0, 1.62 * s, 0); this.yawGoal = 0.3; }
    else if (slot === 'back') { this.camGoal.pos.set(0, 1.6 * s, 4.4); this.camGoal.look.set(0, 1.1 * s, 0); this.yawGoal = Math.PI - 0.6; }
    else { this.camGoal.pos.set(0, 1.3 * s, 6.0 + (s - 1) * 3); this.camGoal.look.set(0, 0.86 * s, 0); if (slot) this.yawGoal = 0.35; }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.idleFor = 0;
    const tick = (now) => {
      if (this.menus.active !== 'select') { this.running = false; return; }
      const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); // rAF time can trail performance.now()
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  frame(dt) {
    const r = this.renderer;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.size !== `${w}x${h}@${pr}`) {
      this.size = `${w}x${h}@${pr}`;
      r.setPixelRatio(pr);
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    // random: flick through the roster in silhouette
    if (this.fighter < 0) {
      this.randomT = (this.randomT || 0) + dt;
      if (this.randomT > 0.7) { this.randomT = 0; this.randomShow = ((this.randomShow ?? 0) + 1) % ROSTER.length; this.updateModel(); }
    }
    const f = this.puppet;
    if (f) {
      f.animTime += dt;
      if (this.cheerFor > 0) {
        this.cheerFor -= dt;
        if (f.state !== 'victory') { f.state = 'victory'; f.stateTime = 0; }
      } else f.state = 'idle';
      f.stateTime += dt;
      applyPose(this.model, computePose(f), dt, false);
      animateLife(this.model, f, dt, null);
      // a little pop when a new fighter steps up
      this.pop = Math.min(1, (this.pop ?? 1) + dt * 4);
      const p = 1 - Math.pow(1 - this.pop, 3);
      this.model.root.scale.setScalar(0.92 + 0.08 * p);
    }
    // turning: drag, ease to a preset, or a slow showroom spin
    if (!this.dragging) {
      if (this.yawGoal != null) {
        let d = (this.yawGoal - this.yaw) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
        this.yaw += d * Math.min(1, dt * 5);
        if (Math.abs(d) < 0.01) this.yawGoal = null;
      } else this.yaw += dt * 0.32;
    }
    this.holder.rotation.y = this.yaw;
    const k = Math.min(1, dt * 5);
    this.cam.pos.lerp(this.camGoal.pos, k);
    this.cam.look.lerp(this.camGoal.look, k);
    this.camera.position.copy(this.cam.pos);
    this.camera.lookAt(this.cam.look);
    this.ringMat.opacity = 0.65 + Math.sin(performance.now() / 400) * 0.2;
    r.render(this.scene, this.camera);
  }

  // Portraits: a head-and-shoulders shot of each fighter in their saved look, rendered once and cached.
  refreshPortrait(i) {
    const img = this.q(`.cs-portrait[data-i="${i}"]`);
    if (!img || !this.renderer) return;
    const look = wardrobe.lookFor(i);
    const key = `${i}|${JSON.stringify(look)}`;
    if (!this.portraits.has(key)) this.portraits.set(key, this.shoot(i, look));
    img.src = this.portraits.get(key);
  }

  shoot(i, look) {
    const def = ROSTER[i];
    const r = this.renderer;
    const model = dressFighter(buildFighterModel(bodyDef(def, look)), def, sanitizeLook(look));
    model.ring.visible = false;
    // the guard pose, so fists are up in the shot
    const f = { state: 'idle', animTime: 0.4, runPhase: 0, moveAmount: 0, grounded: true, alive: true, def, model };
    applyPose(model, computePose(f), 1, true);
    model.root.rotation.y = 0.45;
    const keepModel = this.model?.root.visible;
    if (this.model) this.model.root.visible = false;
    this.holder.add(model.root);
    const s = def.scale;
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    cam.position.set(0.05, 1.62 * s, 1.55 * s);
    cam.lookAt(0, 1.5 * s, 0);
    const prevSize = r.getSize(new THREE.Vector2());
    const prevPr = r.getPixelRatio();
    const hold = this.holder.rotation.y;
    this.holder.rotation.y = 0;
    r.setPixelRatio(1);
    r.setSize(128, 128, false);
    r.render(this.scene, cam);
    const url = this.canvas.toDataURL('image/png');
    // put everything back
    this.holder.rotation.y = hold;
    this.holder.remove(model.root);
    for (const m of [...model.mats, model.eyeMat, model.ring.material, model.ice.material, model.aura.material, model.shell.material]) m.dispose();
    if (this.model) this.model.root.visible = keepModel ?? true;
    r.setPixelRatio(prevPr);
    r.setSize(prevSize.x || 1, prevSize.y || 1, false);
    this.size = null;
    return url;
  }
}

