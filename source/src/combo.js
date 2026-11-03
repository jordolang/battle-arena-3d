// The combo counter: the local fighter's running string of hits, its damage, and a PERFECT
// flash for each link pressed on the beat. It shows only when one person on this device is
// fighting (online, or a single human offline), never in couch play or while spectating.
import { COMBO } from './config.js';
import { events } from './events.js';

export class ComboCounter {
  constructor(game, root) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.id = 'combo';
    this.el.setAttribute('aria-live', 'off');
    root.appendChild(this.el);
    this.clock = 0;
    this.reset();
    const on = (name, fn) => events.on(name, (d) => { if (!d?.replay) fn(d || {}); });
    on('roundStart', () => this.reset());
    on('hit', (d) => this.onHit(d));
    on('perfect', (d) => { if (d.fighter === this.target()) this.flashPerfect(); });
  }

  reset() {
    this.combo = { count: 0, dmg: 0, at: -99 };
    this.el.className = '';
    this.el.innerHTML = '';
  }

  // The one person fighting on this device.
  target() {
    const g = this.game;
    if (g.mode !== 'match') return null;
    if (g.online) return g.localFighter || null;
    let found = null;
    for (const f of g.fighters) {
      if (!f.isHuman) continue;
      if (found) return null; // couch play shares one screen
      found = f;
    }
    return found;
  }

  onHit(d) {
    const t = this.target();
    if (!t) return;
    const c = this.combo;
    if (d.by === t && d.fighter !== t) {
      if (this.clock - c.at < COMBO.window) { c.count++; c.dmg += d.damage || 0; } else { c.count = 1; c.dmg = d.damage || 0; }
      c.at = this.clock;
      this.render();
    } else if (d.fighter === t && c.count) {
      c.count = 0;
      this.render();
    }
  }

  render() {
    const c = this.combo, el = this.el;
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
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 900);
    if (!this.el.classList.contains('on')) this.el.classList.add('flash');
  }

  update(dt) {
    this.clock += dt;
    if (this.combo.count && this.clock - this.combo.at > COMBO.window) {
      this.combo.count = 0;
      this.el.classList.remove('on', 'hot', 'flash');
    }
  }

  stats() { return { combo: this.combo.count }; }
}
