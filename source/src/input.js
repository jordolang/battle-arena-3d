// Keyboard state shared by every local player. Presses are counted so a
// fixed-step simulation never misses a tap that happened between ticks.
import { ACTIONS, DEFAULT_BINDINGS } from './config.js';

// v2: new default layout (J K I H attacks, = - 0 skills), so older saved keys are not carried over
const STORAGE_KEY = 'battle-arena.bindings.v2';

export class Keyboard {
  constructor() {
    this.held = new Set();
    this.presses = new Map();   // code -> total press count
    this.listeners = new Set(); // raw keydown listeners (menus, rebinding)
    this.gameKeys = new Set();
    this.captureGameKeys = false;

    window.addEventListener('keydown', (e) => {
      // typing in the chat box never reaches the game or the menus
      if (e.target?.closest?.('[data-typing]')) return;
      if (!e.repeat) {
        this.held.add(e.code);
        this.presses.set(e.code, (this.presses.get(e.code) || 0) + 1);
      }
      for (const fn of [...this.listeners]) {
        if (fn(e) === true) { e.preventDefault(); return; }
      }
      // Stop arrows/space from scrolling the page while fighting.
      if (this.captureGameKeys && this.gameKeys.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.held.delete(e.code); });
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.held.clear(); });
  }
  isDown(code) { return this.held.has(code); }
  pressCount(code) { return this.presses.get(code) || 0; }
  onKey(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  setGameKeys(bindings) {
    this.gameKeys = new Set();
    for (const b of bindings) for (const a of ACTIONS) if (b[a]) this.gameKeys.add(b[a]);
  }
}

export function loadBindings() {
  const fresh = DEFAULT_BINDINGS.map((b) => ({ ...b }));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw);
    const merged = fresh.map((b, i) => ({ ...b, ...(saved[i] || {}) }));
    // actions added after the bindings were saved get their default key, unless a saved binding already uses it
    const used = new Set();
    merged.forEach((b, i) => { for (const a of ACTIONS) if (saved[i]?.[a] !== undefined && b[a]) used.add(b[a]); });
    merged.forEach((b, i) => { for (const a of ACTIONS) if (saved[i]?.[a] === undefined && used.has(b[a])) b[a] = ''; });
    return merged;
  } catch { return fresh; }
}

export function saveBindings(bindings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch { /* storage unavailable */ }
}

// Turns a player's key bindings into a per-tick intent. Movement is relative
// to the camera so "up" always means "away from the viewer".
export class HumanController {
  constructor(keyboard, binding, playerIndex) {
    this.kb = keyboard;
    this.binding = binding;
    this.playerIndex = playerIndex;
    this.isHuman = true;
    this.seen = {};
    for (const a of NET_TAPS) this.seen[a] = keyboard.pressCount(binding[a]);
  }
  edge(action) {
    if (!this.binding[action]) return false;
    const n = this.kb.pressCount(this.binding[action]);
    const hit = n > this.seen[action];
    this.seen[action] = n;
    return hit;
  }
  getIntent(fighter, world) {
    const b = this.binding, kb = this.kb;
    let fx = 0, fz = 0;
    if (kb.isDown(b.up)) fz += 1;
    if (kb.isDown(b.down)) fz -= 1;
    if (kb.isDown(b.right)) fx += 1;
    if (kb.isDown(b.left)) fx -= 1;
    // camera basis on the ground plane
    const f = world.cameraForward, r = world.cameraRight;
    let mx = f.x * fz + r.x * fx;
    let mz = f.z * fz + r.z * fx;
    const len = Math.hypot(mx, mz);
    if (len > 1e-4) { mx /= len; mz /= len; }
    return {
      mx, mz,
      block: kb.isDown(b.block),
      punch: this.edge('punch'),
      kick: this.edge('kick'),
      special: this.edge('special'),
      jump: this.edge('jump'),
      dash: this.edge('dash'),
      dashHeld: kb.isDown(b.dash),
      skill1: this.edge('skill1'),
      skill2: this.edge('skill2'),
      skill3: this.edge('skill3'),
      use: this.edge('use'),
      cycle: this.edge('cycle'),
      slot1: this.edge('slot1'),
      slot2: this.edge('slot2'),
      slot3: this.edge('slot3'),
      slot4: this.edge('slot4'),
    };
  }
}

// Online each browser has one fighter, steered with either the P1 or the P2 keys.
export class OnlineKeyboardController {
  constructor(keyboard, bindings, isBlocked = () => false) {
    this.isHuman = true;
    this.playerIndex = 0;
    this.parts = [new HumanController(keyboard, bindings[0], 0), new HumanController(keyboard, bindings[1], 1)];
    this.isBlocked = isBlocked;
  }
  getIntent(fighter, world) {
    const [a, b] = this.parts.map((p) => p.getIntent(fighter, world));
    if (this.isBlocked()) return { mx: 0, mz: 0, block: false, dashHeld: false };
    let mx = a.mx + b.mx, mz = a.mz + b.mz;
    const len = Math.hypot(mx, mz);
    if (len > 1e-4) { mx /= Math.max(1, len); mz /= Math.max(1, len); }
    const it = { mx, mz, block: a.block || b.block, dashHeld: a.dashHeld || b.dashHeld };
    for (const t of NET_TAPS) it[t] = a[t] || b[t];
    return it;
  }
}

// Host side of a remote player: replays the latest input that arrived over the network.
// Taps travel as running totals, so a lost or reordered packet never drops a punch.
export const NET_TAPS = ['punch', 'kick', 'special', 'jump', 'dash', 'skill1', 'skill2', 'skill3', 'use', 'cycle', 'slot1', 'slot2', 'slot3', 'slot4'];
export class NetController {
  constructor(playerIndex) {
    this.isHuman = true;
    this.playerIndex = playerIndex;
    this.seq = -1;
    this.mx = 0; this.mz = 0; this.block = false; this.dashHeld = false;
    this.counts = null;
    this.seen = null;
    this.heardAt = 0;
  }
  receive(msg, now) {
    if (msg.s <= this.seq) return;
    this.seq = msg.s;
    this.heardAt = now;
    const len = Math.hypot(msg.mx, msg.mz);
    const k = len > 1 ? 1 / len : 1;
    this.mx = (+msg.mx || 0) * k; this.mz = (+msg.mz || 0) * k;
    this.block = !!msg.b;
    this.dashHeld = !!msg.d;
    if (!Array.isArray(msg.c)) return;
    if (!this.seen) this.seen = msg.c.slice();
    this.counts = msg.c.slice();
  }
  getIntent() {
    // a player whose input stops arriving stands still instead of running forever
    const stale = performance.now() - this.heardAt > 600;
    const it = { mx: stale ? 0 : this.mx, mz: stale ? 0 : this.mz, block: !stale && this.block, dashHeld: !stale && this.dashHeld };
    NET_TAPS.forEach((a, i) => {
      const n = this.counts?.[i] ?? 0, seen = this.seen?.[i] ?? 0;
      it[a] = n > seen;
      if (this.seen && n > seen) this.seen[i] = seen + 1;
    });
    return it;
  }
}
