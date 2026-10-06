// Game controllers through the browser Gamepad API. Up to four pads are polled every
// frame; like the keyboard, presses are counted so a fixed-step simulation never misses
// a tap. Pads also drive the menus (D-pad or stick to move, A to pick, B to go back,
// Start to pause) and rumble when their fighter gets hit.
import { ACTIONS } from './config.js';
import { PAD_DEFAULTS, PAD_RESERVED, padFamily, padName } from './padmap.js';

const MAP_KEY = 'battle-arena.padmap.v1';
const SEAT_KEY = 'battle-arena.padseats.v1';
const RUMBLE_KEY = 'battle-arena.padrumble.v1';
const ON = 0.55, OFF = 0.35;      // a stick or trigger counts as pressed past ON and released below OFF
const DEAD = 0.2;                 // radial dead zone for moving with a stick
const REPEAT_DELAY = 380, REPEAT_RATE = 120;
const NAV = { b12: 'ArrowUp', b13: 'ArrowDown', b14: 'ArrowLeft', b15: 'ArrowRight', 'a1-': 'ArrowUp', 'a1+': 'ArrowDown', 'a0-': 'ArrowLeft', 'a0+': 'ArrowRight' };

export function loadPadMap() {
  const map = { ...PAD_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_KEY) || 'null');
    if (saved) for (const a of ACTIONS) if (typeof saved[a] === 'string' && !PAD_RESERVED.has(saved[a])) map[a] = saved[a];
  } catch { /* storage unavailable */ }
  return map;
}

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; }
}
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

export class Gamepads {
  constructor() {
    this.supported = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
    this.slots = [null, null, null, null];   // slot -> pad state, in the order the pads connected
    this.map = loadPadMap();                 // action -> pad code, shared by every pad
    const seats = load(SEAT_KEY, [0, 1, 2, 3]);
    this.seats = [0, 1, 2, 3].map((i) => (Number.isInteger(seats[i]) && seats[i] >= 0 && seats[i] < 4 ? seats[i] : i));
    this.rumbleOn = load(RUMBLE_KEY, true) !== false;
    this.capture = null;                     // set while the Controls screen waits for a button to bind
    this.menuMode = () => 'menu';            // 'menu' | 'pause' | 'game' | 'spectate'
    this.emitKey = () => {};                 // turns pad presses into menu keys
    this.onChange = () => {};                // a pad connected or left
    this.onUse = () => {};                   // any press, with the slot that made it
    if (!this.supported) return;
    window.addEventListener('gamepadconnected', () => this.poll());
    window.addEventListener('gamepaddisconnected', () => this.poll());
    const loop = () => { this.poll(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  poll() {
    if (!this.supported) return;
    let list;
    try { list = navigator.getGamepads() || []; } catch { return; }
    const live = new Set();
    for (const gp of list) if (gp && gp.connected !== false) live.add(gp.index);
    const changes = [];
    for (let s = 0; s < 4; s++) {
      if (this.slots[s] && !live.has(this.slots[s].index)) { this.slots[s] = null; changes.push({ slot: s, on: false }); }
    }
    const now = performance.now();
    for (const gp of list) {
      if (!gp || gp.connected === false) continue;
      let s = this.slots.findIndex((x) => x && x.index === gp.index);
      if (s < 0) {
        s = this.slots.indexOf(null);
        if (s < 0) continue;
        this.slots[s] = { index: gp.index, id: gp.id, family: padFamily(gp.id), name: padName(gp.id), born: now, held: new Set(), presses: new Map(), values: new Map(), rep: new Map() };
        changes.push({ slot: s, on: true });
      }
      this.read(s, gp, now);
    }
    for (const c of changes) this.onChange(c);
  }

  read(s, gp, now) {
    const st = this.slots[s];
    for (let i = 0; i < gp.buttons.length; i++) {
      const b = gp.buttons[i];
      const trigger = i === 6 || i === 7;
      const v = typeof b === 'object' ? Math.max(b.value || 0, b.pressed && !trigger ? 1 : 0) : +b || 0;
      this.set(s, st, 'b' + i, v);
    }
    for (let i = 0; i < gp.axes.length && i < 8; i++) {
      const a = gp.axes[i] || 0;
      this.set(s, st, `a${i}+`, a > 0 ? a : 0);
      this.set(s, st, `a${i}-`, a < 0 ? -a : 0);
    }
    // held directions repeat in the menus
    const mode = this.menuMode();
    if (mode !== 'menu' && mode !== 'pause' && mode !== 'spectate') return;
    for (const [code, at] of st.rep) {
      if (!st.held.has(code)) { st.rep.delete(code); continue; }
      if (now >= at && !this.capture) { st.rep.set(code, now + REPEAT_RATE); this.emitKey(NAV[code]); }
    }
  }

  set(s, st, code, v) {
    st.values.set(code, v);
    const was = st.held.has(code);
    const down = was ? v > OFF : v > ON;
    if (down === was) return;
    if (!down) { st.held.delete(code); return; }
    st.held.add(code);
    this.pressed(s, st, code);
  }

  pressed(s, st, code) {
    this.onUse(s);
    if (this.capture) {
      const done = this.capture;
      // Start or View cancels; anything else becomes the new binding
      if (PAD_RESERVED.has(code)) { this.capture = null; done(null); return; }
      this.capture = null;
      done(code);
      return;
    }
    const mode = this.menuMode();
    const inMenu = mode === 'menu' || mode === 'pause';
    // presses that drive a menu are not counted for the fight, so picking Resume with A does not also jump
    if (!inMenu) st.presses.set(code, (st.presses.get(code) || 0) + 1);
    if (code === 'b9') { this.emitKey(mode === 'menu' ? 'Enter' : 'Escape'); return; }
    if (code === 'b8') { this.emitKey('Escape'); return; }
    if (inMenu || mode === 'spectate') {
      if (NAV[code]) { st.rep.set(code, performance.now() + REPEAT_DELAY); this.emitKey(NAV[code]); return; }
    }
    if (!inMenu) return;
    if (code === 'b0') this.emitKey('Enter');
    else if (code === 'b1') this.emitKey('Escape');
    else if (code === 'b4') this.emitKey('ArrowLeft');
    else if (code === 'b5') this.emitKey('ArrowRight');
  }

  // ---- reading, for HumanController ----
  seatOf(slot) { return this.seats[slot] ?? slot; }
  slotsFor(player) {
    const out = [];
    for (let s = 0; s < 4; s++) if (this.slots[s] && this.seatOf(s) === player) out.push(s);
    return out;
  }
  state(slot) { return this.slots[slot]; }
  isDown(slot, code) { return !!code && !!this.slots[slot]?.held.has(code); }
  pressCount(slot, code) { return (code && this.slots[slot]?.presses.get(code)) || 0; }
  anyDown(code) { return this.slots.some((st) => st?.held.has(code)); }
  get count() { return this.slots.filter(Boolean).length; }

  // Movement from the stick (or whatever the move actions are bound to), with a round dead zone.
  // x is right, y is forward; the length runs 0..1 so a half-tilted stick walks.
  vector(slot) {
    const st = this.slots[slot];
    if (!st) return { x: 0, y: 0 };
    const v = (a) => (this.map[a] ? st.values.get(this.map[a]) || 0 : 0);
    const x = v('right') - v('left'), y = v('up') - v('down');
    const m = Math.hypot(x, y);
    if (m < DEAD) return { x: 0, y: 0 };
    const k = Math.min(1, ((m - DEAD) / (1 - DEAD)) * 1.15) / m;
    return { x: x * k, y: y * k };
  }

  // ---- settings ----
  bind(action, code) {
    // the button moves here; whatever action had it takes this action's old button
    const old = this.map[action];
    for (const a of ACTIONS) if (a !== action && this.map[a] === code) this.map[a] = old || '';
    this.map[action] = code;
    save(MAP_KEY, this.map);
  }
  resetMap() { this.map = { ...PAD_DEFAULTS }; save(MAP_KEY, this.map); }
  setSeat(slot, player) { this.seats[slot] = player; save(SEAT_KEY, this.seats); }
  setRumble(on) { this.rumbleOn = on; save(RUMBLE_KEY, on); }

  // A short shake. strong is the low heavy motor, weak the high buzzy one, both 0..1.
  rumble(slot, strong, weak, ms) {
    if (!this.rumbleOn || !this.slots[slot]) return;
    let gp;
    try { gp = navigator.getGamepads()[this.slots[slot].index]; } catch { return; }
    if (!gp) return;
    const act = gp.vibrationActuator;
    if (act?.playEffect) {
      act.playEffect(act.type || 'dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
    } else if (gp.hapticActuators?.[0]?.pulse) {
      gp.hapticActuators[0].pulse(Math.min(1, Math.max(strong, weak)), ms).catch?.(() => {});
    }
  }
}
