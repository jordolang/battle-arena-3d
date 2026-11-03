// Focus mode and the combo counter.
//
// The director keeps a "heat" score for the local player's fighter from what happens around
// them: blows landed and taken, long combos, perfect links, specials, parries, knockouts
// nearby, low health and being crowded. When the heat boils over, the camera (camera.js)
// eases in close on that fighter and swings slowly around them, then eases back out once
// things calm down. Nothing about the fight changes: the simulation runs at full speed and
// the controls keep their usual directions. It only runs when one person on this device is
// fighting (not couch play, not spectating, not during the knockout replay), and the
// Focus camera option in Fight setup turns it off.
//
// The combo counter shows the local fighter's running string of hits, its damage, and a
// PERFECT flash for each link pressed on the beat.
import { COMBO } from './config.js';
import { events } from './events.js';

export const FOCUS = {
  enter: 1,          // heat that starts a focus shot
  leave: 0.35,       // heat under which a shot (past its minimum) ends
  minTime: 2.5,      // seconds a shot lasts at least
  maxTime: 8,        // and at most
  cooldown: 6,       // seconds before the next shot can start
  decay: 0.22,       // heat lost per second
  max: 1.6,
};

export class FocusDirector {
  constructor(game, root) {
    this.game = game;
    this.enabled = true;
    this.vignette = document.createElement('div');
    this.vignette.id = 'focus-vignette';
    this.comboEl = document.createElement('div');
    this.comboEl.id = 'combo';
    this.comboEl.setAttribute('aria-live', 'off');
    root.appendChild(this.vignette);
    root.appendChild(this.comboEl);
    this.reset();
    const on = (name, fn) => events.on(name, (d) => { if (!d?.replay) fn(d || {}); });
    on('roundStart', () => this.reset());
    on('hit', (d) => this.onHit(d));
    on('perfect', (d) => {
      if (d.fighter !== this.target()) return;
      this.add(0.2);
      this.flashPerfect();
    });
    on('specialStart', (d) => { if (d.fighter === this.target()) this.add(0.35); });
    on('skillStart', (d) => { if (d.fighter === this.target()) this.add(0.1); });
    on('parry', (d) => { const t = this.target(); if (d.fighter === t || d.by === t) this.add(0.3); });
    on('guardBreak', (d) => { const t = this.target(); if (d.fighter === t || d.by === t) this.add(0.25); });
    on('backstab', (d) => { const t = this.target(); if (d.fighter === t || d.by === t) this.add(0.2); });
    on('ko', (d) => {
      const t = this.target();
      if (!t || d.fighter === t) return;
      if (d.by === t || near(t, d.fighter, 8)) this.add(0.45);
    });
  }

  reset() {
    this.heat = 0;
    this.active = false;
    this.activeTime = 0;
    this.cooldown = 3; // never right as a round opens
    this.clock = 0;
    this.combo = { count: 0, dmg: 0, at: -99, perfects: 0 };
    this.game.rig.setFocus(null);
    this.vignette.classList.remove('on');
    this.comboEl.className = '';
    this.comboEl.innerHTML = '';
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.stop();
  }

  // The fighter the focus camera and combo counter follow: the one person fighting on this device.
  target() {
    const g = this.game;
    if (g.mode !== 'match') return null;
    if (g.online) return g.localFighter || null;
    let found = null;
    for (const f of g.fighters) {
      if (!f.isHuman) continue;
      if (found) return null; // couch play shares one screen: no close-ups
      found = f;
    }
    return found;
  }

  add(n) { this.heat = Math.min(FOCUS.max, this.heat + n); }

  onHit(d) {
    const t = this.target();
    if (!t) return;
    if (d.by === t && d.fighter !== t) {
      const c = this.combo;
      if (this.clock - c.at < COMBO.window) { c.count++; c.dmg += d.damage || 0; } else { c.count = 1; c.dmg = d.damage || 0; c.perfects = 0; }
      c.at = this.clock;
      if (d.perfect) c.perfects++;
      this.add(0.12 + (d.heavy ? 0.12 : 0) + Math.min(0.24, Math.max(0, c.count - 2) * 0.08) + (d.juggle ? 0.2 : 0));
      this.renderCombo();
    } else if (d.fighter === t) {
      this.add(0.1 + (d.heavy ? 0.1 : 0));
      if (this.combo.count) { this.combo.count = 0; this.renderCombo(); }
    }
  }

  renderCombo() {
    const c = this.combo, el = this.comboEl;
    if (c.count < 2) { el.className = ''; return; }
    el.innerHTML = `<b>${c.count}</b><span>hits</span><small>${Math.round(c.dmg)} damage</small>`;
    el.className = '';
    void el.offsetWidth; // restart the pop
    el.className = 'on' + (c.count >= 5 ? ' hot' : '');
  }

  flashPerfect() {
    const el = document.createElement('i');
    el.className = 'perfect';
    el.textContent = 'Perfect';
    this.comboEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
    if (!this.comboEl.classList.contains('on')) this.comboEl.classList.add('flash');
  }

  stop() {
    this.active = false;
    this.activeTime = 0;
    this.game.rig.setFocus(null);
    this.vignette.classList.remove('on');
  }

  update(dt) {
    const g = this.game;
    this.clock += dt;
    if (this.combo.count && this.clock - this.combo.at > COMBO.window) {
      this.combo.count = 0;
      this.comboEl.classList.remove('on', 'hot', 'flash');
    }
    const t = this.target();
    const live = this.enabled && !!t && t.alive && g.phase === 'fight' && !g.paused && !g.replay?.playing;
    if (!live) {
      if (this.active) { this.stop(); this.cooldown = FOCUS.cooldown; }
      this.heat = Math.max(0, this.heat - dt * FOCUS.decay * 2);
      return;
    }
    // pressure that builds while it lasts: low health, and more than one foe close by
    if (t.hp / t.maxHp < 0.3) this.add(dt * 0.12);
    let crowd = 0;
    for (const o of g.fighters) if (o !== t && o.alive && !(t.team >= 0 && o.team === t.team) && near(t, o, 4.5)) crowd++;
    if (crowd >= 2) this.add(dt * 0.08 * (crowd - 1));
    this.heat = Math.max(0, this.heat - dt * FOCUS.decay);
    if (this.cooldown > 0) this.cooldown -= dt;

    if (!this.active) {
      if (this.heat >= FOCUS.enter && this.cooldown <= 0) {
        this.active = true;
        this.activeTime = 0;
        g.rig.setFocus(t);
        this.vignette.classList.add('on');
      }
      return;
    }
    this.activeTime += dt;
    if ((this.activeTime > FOCUS.minTime && this.heat < FOCUS.leave) || this.activeTime > FOCUS.maxTime) {
      this.stop();
      this.heat = Math.min(this.heat, FOCUS.leave);
      this.cooldown = FOCUS.cooldown;
    } else {
      g.rig.setFocus(t);
    }
  }

  stats() { return { enabled: this.enabled, heat: +this.heat.toFixed(2), active: this.active, activeTime: +this.activeTime.toFixed(1), cooldown: +Math.max(0, this.cooldown).toFixed(1), combo: this.combo.count, blend: +this.game.rig.focusBlend.toFixed(2) }; }
}

function near(a, b, r) { return !!a && !!b && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < r; }
