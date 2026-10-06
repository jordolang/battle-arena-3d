// On-screen controls for phones and tablets. A floating thumbstick appears wherever the
// left thumb lands; the right thumb has punch, kick, jump, block, dodge, special, the
// three skills and the item bar. Thumbs can slide from one button to the next, several
// fingers work at once, and presses are counted like keys so no tap is lost between ticks.
import { SKILLS, SPECIALS, SPECIAL_COST } from './config.js';
import { itemIcon } from './items.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const STICK_R = 58;   // how far the knob travels, in CSS pixels at size 1

// Each button: action, label, centre measured from the bottom-right corner, radius (all at size 1).
const BUTTONS = [
  { a: 'punch', label: 'Punch', x: 80, y: 80, r: 46, cls: 'main' },
  { a: 'kick', label: 'Kick', x: 176, y: 54, r: 33 },
  { a: 'jump', label: 'Jump', x: 80, y: 174, r: 33 },
  { a: 'block', label: 'Block', x: 166, y: 138, r: 31, cls: 'hold' },
  { a: 'dash', label: 'Dodge', x: 254, y: 92, r: 29, cls: 'hold' },
  { a: 'special', label: 'Special', x: 160, y: 222, r: 29, cls: 'special' },
  { a: 'skill1', label: 'Skill 1', x: 246, y: 176, r: 25, cls: 'skill' },
  { a: 'skill2', label: 'Skill 2', x: 236, y: 242, r: 25, cls: 'skill' },
  { a: 'skill3', label: 'Skill 3', x: 76, y: 252, r: 25, cls: 'skill' },
  { a: 'use', label: 'Use', x: 340, y: 50, r: 28, cls: 'item' },
  { a: 'cycle', label: 'Next', x: 334, y: 116, r: 21, cls: 'item small' },
];

export function isTouchDevice() {
  try { return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0; } catch { return false; }
}

export class TouchControls {
  constructor({ onPause, onUsed, getFighter }) {
    this.onPause = onPause;
    this.onUsed = onUsed || (() => {});
    this.getFighter = getFighter || (() => null);
    this.held = new Map();     // action -> number of fingers on it
    this.presses = new Map();  // action -> total presses
    this.fingers = new Map();  // pointerId -> action under that finger
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.visible = false;
    this.size = 1;
    this.lastFighter = null;
    this.vibrate = true;
    this.build();
  }

  build() {
    const el = document.createElement('div');
    el.id = 'touch';
    el.hidden = true;
    el.innerHTML = `
      <div class="t-zone"><div class="t-stick"><div class="t-knob"></div></div></div>
      <div class="t-sys">
        <button class="t-sysbtn" data-sys="pause" aria-label="Pause"><svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/></svg></button>
        <button class="t-sysbtn" data-sys="fs" aria-label="Full screen"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg></button>
      </div>
      <div class="t-pad">${BUTTONS.map((b) => `<div class="t-btn ${b.cls || ''}" data-a="${b.a}" style="--x:${b.x};--y:${b.y};--r:${b.r}">
        <i class="cd"></i><span class="ico"></span><span class="tl">${b.label}</span></div>`).join('')}</div>
      <div class="t-ff" data-a="ff" hidden>Hold to fast-forward</div>
      <div class="t-rotate" hidden>Turn your phone sideways for the best view</div>`;
    document.getElementById('app').appendChild(el);
    this.el = el;
    this.zone = el.querySelector('.t-zone');
    this.base = el.querySelector('.t-stick');
    this.knob = el.querySelector('.t-knob');
    this.pad = el.querySelector('.t-pad');
    this.ffEl = el.querySelector('.t-ff');
    this.rotateEl = el.querySelector('.t-rotate');
    this.btns = Object.fromEntries([...el.querySelectorAll('.t-btn')].map((b) => [b.dataset.a, b]));

    // thumbstick: a finger anywhere in the left zone becomes the stick's centre
    this.zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onUsed();
      if (this.stick.id !== null) return;
      this.zone.setPointerCapture?.(e.pointerId);
      const zr = this.zone.getBoundingClientRect();
      const R = STICK_R * this.size;
      // keep the whole ring on screen even when the thumb lands at the edge
      this.stick = { id: e.pointerId, ox: Math.max(zr.left + R, Math.min(e.clientX, zr.right - R)), oy: Math.max(zr.top + R, Math.min(e.clientY, zr.bottom - R)), x: 0, y: 0 };
      this.base.style.left = `${this.stick.ox - zr.left}px`;
      this.base.style.top = `${this.stick.oy - zr.top}px`;
      this.base.classList.add('on');
      this.moveStick(e);
    });
    this.zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stick.id) this.moveStick(e); });
    const endStick = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
      this.knob.style.transform = '';
      this.base.classList.remove('on');
      this.base.style.left = this.base.style.top = '';
    };
    this.zone.addEventListener('pointerup', endStick);
    this.zone.addEventListener('pointercancel', endStick);

    // buttons: each finger presses whatever button is under it, and can slide across to another
    const track = (e) => {
      e.preventDefault();
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#touch [data-a]');
      this.setFinger(e.pointerId, hit && !hit.hidden ? hit.dataset.a : null);
    };
    for (const zoneEl of [this.pad, this.ffEl]) {
      // capture on the button that was touched, so the finger keeps reporting as it slides off it
      zoneEl.addEventListener('pointerdown', (e) => { this.onUsed(); (e.target.closest('[data-a]') || zoneEl).setPointerCapture?.(e.pointerId); track(e); });
      zoneEl.addEventListener('pointermove', (e) => { if (this.fingers.has(e.pointerId)) track(e); });
      const end = (e) => this.setFinger(e.pointerId, null, true);
      zoneEl.addEventListener('pointerup', end);
      zoneEl.addEventListener('pointercancel', end);
    }
    // pointerup rather than click: a browser may not turn a tap into a click while the other thumb is on the stick
    el.querySelector('[data-sys=pause]').addEventListener('pointerup', () => this.onPause?.());
    el.querySelector('[data-sys=fs]').addEventListener('pointerup', () => toggleFullscreen());

    // tapping a slot of your item bar fires it, like 1-4 on the keyboard
    document.addEventListener('pointerdown', (e) => {
      if (!this.visible) return;
      const slot = e.target.closest?.('#belts .belt:first-child .slot.item');
      if (!slot) return;
      e.preventDefault();
      this.tap('slot' + (+slot.dataset.i + 1));
    });
    // no long-press menu or pinch-zoom while fighting
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => { if (this.visible) e.preventDefault(); });
  }

  moveStick(e) {
    const R = STICK_R * this.size;
    let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
    const m = Math.hypot(dx, dy);
    if (m > R) { dx *= R / m; dy *= R / m; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // small dead zone, and a little headroom so a firm push reaches full speed
    const n = Math.min(1, m / R);
    const k = n < 0.12 ? 0 : Math.min(1, (n - 0.12) / 0.78) / Math.max(1e-6, n);
    this.stick.x = (dx / R) * k;
    this.stick.y = (-dy / R) * k;
  }

  setFinger(id, action, lifted = false) {
    const prev = this.fingers.get(id) || null;
    if (prev === action) { if (lifted) this.fingers.delete(id); return; }
    if (prev) {
      const n = (this.held.get(prev) || 1) - 1;
      if (n > 0) this.held.set(prev, n); else this.held.delete(prev);
      this.btns[prev]?.classList.remove('down');
      if (prev === 'ff') this.ffEl.classList.remove('down');
    }
    if (lifted || !action) { if (lifted) this.fingers.delete(id); else this.fingers.set(id, null); return; }
    this.fingers.set(id, action);
    this.held.set(action, (this.held.get(action) || 0) + 1);
    this.presses.set(action, (this.presses.get(action) || 0) + 1);
    this.btns[action]?.classList.add('down');
    if (action === 'ff') this.ffEl.classList.add('down');
    if (this.vibrate && action !== 'ff') navigator.vibrate?.(8);
  }

  tap(action) {
    this.presses.set(action, (this.presses.get(action) || 0) + 1);
    if (this.vibrate) navigator.vibrate?.(8);
  }

  isDown(action) { return this.held.has(action); }
  pressCount(action) { return this.presses.get(action) || 0; }
  vector() { return { x: this.stick.x, y: this.stick.y }; }

  setSize(s) {
    this.size = s;
    this.el.style.setProperty('--ts', s);
  }

  // Shown during a fight on touch screens; everything is released when it hides.
  setVisible(on, { spectating = false, ff = true } = {}) {
    if (on !== this.visible) {
      this.visible = on;
      this.el.hidden = !on;
      document.body.classList.toggle('touch-fight', on);
      // the item bar moves up under the fighter cards, clear of both thumbs
      if (on) requestAnimationFrame(() => {
        const bar = document.getElementById('topbar')?.getBoundingClientRect();
        if (bar) document.body.style.setProperty('--belt-top', `${Math.round(bar.bottom + 6)}px`);
      });
      if (!on) {
        for (const id of [...this.fingers.keys()]) this.setFinger(id, null, true);
        this.held.clear();
        this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
        this.knob.style.transform = '';
        this.base.classList.remove('on');
      }
    }
    if (!on) return;
    this.el.classList.toggle('out', spectating);
    this.ffEl.hidden = !(spectating && ff);
    const portrait = innerHeight > innerWidth * 1.15 && innerWidth < 700;
    this.rotateEl.hidden = !portrait;
    this.el.classList.toggle('portrait', portrait);
    this.refresh();
  }

  // Skill names, cooldown sweeps, mana and the selected gun or spell, read from your fighter.
  refresh() {
    const f = this.getFighter();
    if (!f) return;
    if (f !== this.lastFighter) {
      this.lastFighter = f;
      f.skillIds?.forEach((id, i) => {
        const b = this.btns['skill' + (i + 1)];
        const sk = SKILLS[id];
        if (!b || !sk) return;
        b.querySelector('.tl').textContent = shortName(sk.label);
        b.style.setProperty('--glow', sk.color != null ? hex(sk.color) : '#9fd0ff');
      });
      const sp = SPECIALS[f.def?.special];
      if (sp) this.btns.special.querySelector('.tl').textContent = shortName(sp.label);
      this.lastItem = undefined;
    }
    f.skillIds?.forEach((id, i) => {
      const b = this.btns['skill' + (i + 1)];
      const sk = SKILLS[id];
      if (!b || !sk) return;
      const cd = f.cooldowns?.[i] || 0;
      b.style.setProperty('--cd', sk.cooldown ? Math.min(1, cd / sk.cooldown) : 0);
      b.classList.toggle('dim', cd > 0 || (f.energy ?? 0) < sk.cost);
    });
    this.btns.special.classList.toggle('dim', (f.energy ?? 0) < SPECIAL_COST);
    const it = f.items?.[f.sel];
    const key = it ? it.id : '';
    if (key !== this.lastItem) {
      this.lastItem = key;
      const sk = it && SKILLS[it.id];
      this.btns.use.querySelector('.ico').innerHTML = sk ? itemIcon(it.id, hex(sk.color)) : '';
      this.btns.use.querySelector('.tl').textContent = sk ? (sk.spell ? 'Cast' : 'Fire') : 'Use';
      this.btns.use.classList.toggle('dim', !sk);
    }
    this.btns.cycle.classList.toggle('dim', (f.items?.length || 0) < 2);
  }
}

function shortName(label) {
  const s = String(label);
  return (s.length > 9 ? s.split(' ').sort((a, b) => b.length - a.length)[0].slice(0, 9) : s);
}

export function toggleFullscreen() {
  const d = document;
  const el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen)?.call(d); return; }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}
