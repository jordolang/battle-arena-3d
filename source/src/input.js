// Keyboard state shared by every local player. Presses are counted so a
// fixed-step simulation never misses a tap that happened between ticks.
import { ACTIONS, DEFAULT_BINDINGS } from './config.js';
import { EMOTE_IDS } from './social.js';

// Gamepads and the touch overlay register here at boot; every HumanController reads
// them next to its keyboard keys. `kind[p]` is the device player p used last, which
// decides whether hints show keys, pad buttons or nothing (touch).
export const devices = {
  pads: null, touch: null, comms: null, last: 'keyboard', kind: ['keyboard', 'keyboard', 'keyboard', 'keyboard'],
  listeners: new Set(),
  used(kind, player = -1) {
    const before = this.last + this.kind.join();
    this.last = kind;
    if (player >= 0 && player < 4) this.kind[player] = kind;
    if (before !== this.last + this.kind.join()) for (const fn of this.listeners) fn(kind, player);
  },
  // What a hint should show for player p: their keys, or their pad's buttons as "Pad:<code>:<family>".
  display(p, binding) {
    const pads = this.pads, slot = pads?.slotsFor(p)[0];
    if (this.kind[p] !== 'pad' || slot === undefined) return binding;
    const fam = pads.state(slot).family;
    const out = {};
    for (const a of ACTIONS) out[a] = pads.map[a] ? `Pad:${pads.map[a]}:${fam}` : '';
    return out;
  },
};

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
        devices.used('keyboard', this.playerFor(e.code));
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
  // which local player a key belongs to, so the hints follow whoever is on the keyboard
  playerFor(code) {
    return this.bindings ? this.bindings.findIndex((b) => ACTIONS.some((a) => b[a] === code)) : -1;
  }
  // Menus and the pause screen run on the same listeners; gamepads and touch buttons send keys through here.
  dispatch(code) {
    const target = document.activeElement || document.body;
    const e = { code, key: code, repeat: false, target, synthetic: true, preventDefault() {} };
    for (const fn of [...this.listeners]) if (fn(e) === true) return true;
    return false;
  }
  setGameKeys(bindings) {
    this.bindings = bindings;
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
  // `allPads` lets every connected controller steer this player (online, where each browser has one fighter).
  // `commsSeat` is whose emote menu this player's keys drive (online both key sets drive yours).
  constructor(keyboard, binding, playerIndex, { allPads = false, commsSeat = playerIndex } = {}) {
    this.kb = keyboard;
    this.binding = binding;
    this.playerIndex = playerIndex;
    this.commsSeat = commsSeat;
    this.allPads = allPads;
    this.isHuman = true;
    this.seen = {};
    for (const a of [...NET_TAPS, ...SOCIAL_TAPS]) this.seen[a] = keyboard.pressCount(binding[a]);
    this.padSeen = new WeakMap(); // pad state -> { action: presses already acted on }
    this.born = performance.now();
    this.touchSeen = {};
    const t = devices.touch;
    if (t && playerIndex === 0) for (const a of [...NET_TAPS, ...SOCIAL_TAPS]) this.touchSeen[a] = t.pressCount(a);
  }
  padSlots() {
    const pads = devices.pads;
    if (!pads) return [];
    if (this.allPads) return [0, 1, 2, 3].filter((s) => pads.state(s));
    return pads.slotsFor(this.playerIndex);
  }
  edge(action) { return this.taps(action) > 0; }
  // New presses of `action` since the last look, from every device (the emote menu counts them).
  taps(action) {
    let hit = 0;
    if (this.binding[action]) {
      const n = this.kb.pressCount(this.binding[action]);
      hit += Math.max(0, n - this.seen[action]);
      this.seen[action] = n;
    }
    const pads = devices.pads, code = pads?.map[action];
    if (code) {
      for (const s of this.padSlots()) {
        const st = pads.state(s);
        let seen = this.padSeen.get(st);
        if (!seen) { seen = {}; this.padSeen.set(st, seen); }
        const n = pads.pressCount(s, code);
        // every press of a pad that connected after this fight began counts; an older pad
        // (say one just moved over to this player) starts fresh instead of replaying old presses
        const base = seen[action] ?? (st.born > this.born ? 0 : n);
        hit += Math.max(0, n - base);
        seen[action] = n;
      }
    }
    const t = devices.touch;
    if (t && this.playerIndex === 0) {
      const n = t.pressCount(action);
      hit += Math.max(0, n - (this.touchSeen[action] ?? n));
      this.touchSeen[action] = n;
    }
    return hit;
  }
  held(action) {
    if (this.kb.isDown(this.binding[action])) return true;
    const pads = devices.pads, code = pads?.map[action];
    if (code) for (const s of this.padSlots()) if (pads.isDown(s, code)) return true;
    return this.playerIndex === 0 && !!devices.touch?.isDown(action);
  }
  // Stick or thumb movement, x right and y forward, length 0..1.
  analog() {
    let best = { x: 0, y: 0 }, bm = 0;
    const consider = (v) => { const m = Math.hypot(v.x, v.y); if (m > bm) { bm = m; best = v; } };
    for (const s of this.padSlots()) consider(devices.pads.vector(s));
    if (this.playerIndex === 0 && devices.touch) consider(devices.touch.vector());
    return best;
  }
  getIntent(fighter, world) {
    const b = this.binding, kb = this.kb;
    let fx = 0, fz = 0, mag = 1;
    if (kb.isDown(b.up)) fz += 1;
    if (kb.isDown(b.down)) fz -= 1;
    if (kb.isDown(b.right)) fx += 1;
    if (kb.isDown(b.left)) fx -= 1;
    // keys win; otherwise a stick or the touch thumbstick, where a light push walks
    if (!fx && !fz) { const a = this.analog(); fx = a.x; fz = a.y; mag = Math.min(1, Math.hypot(fx, fz)); }
    // camera basis on the ground plane
    const f = world.cameraForward, r = world.cameraRight;
    let mx = f.x * fz + r.x * fx;
    let mz = f.z * fz + r.z * fx;
    const len = Math.hypot(mx, mz);
    if (len > 1e-4) { mx = (mx / len) * mag; mz = (mz / len) * mag; }
    const it = {
      mx, mz,
      block: this.held('block'),
      punch: this.edge('punch'),
      kick: this.edge('kick'),
      special: this.edge('special'),
      jump: this.edge('jump'),
      dash: this.edge('dash'),
      dashHeld: this.held('dash'),
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
    // the emote menu (social.js): while it is open the bar-slot buttons pick from it instead
    const comms = devices.comms, seat = this.commsSeat;
    const taunt = this.edge('taunt');
    for (let n = this.taps('comms'); n > 0; n--) comms?.toggle(seat);
    if (comms?.isOpen(seat)) {
      for (let k = 1; k <= 4; k++) if (it[`slot${k}`]) { it[`slot${k}`] = false; comms.pick(seat, k - 1); }
    }
    it.emote = taunt ? 'taunt' : comms?.takeEmote(seat) || null;
    return it;
  }
}

// Social keys never travel as taps: an emote travels by name (see NetController).
const SOCIAL_TAPS = ['taunt', 'comms'];

// Online each browser has one fighter, steered with either the P1 or the P2 keys.
export class OnlineKeyboardController {
  constructor(keyboard, bindings, isBlocked = () => false) {
    this.isHuman = true;
    this.playerIndex = 0;
    this.parts = [new HumanController(keyboard, bindings[0], 0, { allPads: true }), new HumanController(keyboard, bindings[1], 1, { commsSeat: 0 })];
    this.isBlocked = isBlocked;
  }
  getIntent(fighter, world) {
    const [a, b] = this.parts.map((p) => p.getIntent(fighter, world));
    if (this.isBlocked()) return { mx: 0, mz: 0, block: false, dashHeld: false };
    let mx = a.mx + b.mx, mz = a.mz + b.mz;
    const len = Math.hypot(mx, mz);
    if (len > 1e-4) { mx /= Math.max(1, len); mz /= Math.max(1, len); }
    const it = { mx, mz, block: a.block || b.block, dashHeld: a.dashHeld || b.dashHeld, emote: a.emote || b.emote };
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
    this.emoteSeen = 0;
    this.emote = null;
  }
  receive(msg, now) {
    if (msg.s <= this.seq) return;
    this.seq = msg.s;
    this.heardAt = now;
    this.from = null;
    const len = Math.hypot(msg.mx, msg.mz);
    const k = len > 1 ? 1 / len : 1;
    this.mx = (+msg.mx || 0) * k; this.mz = (+msg.mz || 0) * k;
    this.block = !!msg.b;
    this.dashHeld = !!msg.d;
    // emotes travel as [running count, emote index]; a new count is a new emote
    if (Array.isArray(msg.e) && Number.isInteger(msg.e[0])) {
      if (msg.e[0] > this.emoteSeen) this.emote = EMOTE_IDS[msg.e[1]] || null;
      this.emoteSeen = msg.e[0];
    }
    if (!Array.isArray(msg.c)) return;
    if (!this.seen) this.seen = msg.c.slice();
    this.counts = msg.c.slice();
  }
  getIntent(fighter, world) {
    // the simulation time this input was first applied, so the player's own prediction can line up with us
    if (this.from == null && world) this.from = world.time;
    // a player whose input stops arriving stands still instead of running forever
    const stale = performance.now() - this.heardAt > 600;
    const it = { mx: stale ? 0 : this.mx, mz: stale ? 0 : this.mz, block: !stale && this.block, dashHeld: !stale && this.dashHeld, emote: this.emote };
    this.emote = null;
    NET_TAPS.forEach((a, i) => {
      const n = this.counts?.[i] ?? 0, seen = this.seen?.[i] ?? 0;
      it[a] = n > seen;
      if (this.seen && n > seen) this.seen[i] = seen + 1;
    });
    return it;
  }
}
