// Client-side prediction for an online guest's own fighter. Without it a guest
// sees their own moves only after the input has gone to the host and the host's
// snapshot has come back (and then another 100 ms of interpolation delay).
//
// While the host says your fighter is free to act (standing, moving, blocking,
// punching, kicking, jumping or dodging), this browser runs your fighter's own
// simulation ahead of the host, straight from your keys. It never decides
// anything that touches someone else: hits, damage, skills, specials and gear stay
// with the host. Every snapshot carries the last input the host has applied for
// you and for how long it has applied it; we compare the host's fighter with where
// we had it the same number of steps into that input, and shift the prediction by
// the difference, smoothing the visible jump away. When the host
// shows something we can't predict (you got hit, knocked down, cast a skill) your
// fighter is drawn from snapshots like everyone else until it is free again.
import * as THREE from 'three';
import { MOVES, SIM_DT } from '../config.js';
import { events } from '../events.js';
import { wrapAngle } from '../fighter.js';

const PREDICTED = new Set(['idle', 'block', 'attack', 'dodge']);
// played at once on this machine; the host's copy of the same event is skipped when it arrives
const LOCAL_EVENTS = new Set(['swing', 'jump', 'land', 'dodge', 'dodgeFail']);
// taps that start things only the host decides (skills, specials, gear): they still go to the host
const HOST_ONLY = ['special', 'skill1', 'skill2', 'skill3', 'use', 'cycle', 'slot1', 'slot2', 'slot3', 'slot4'];
const SNAP_ERROR = 3;      // metres off: jump straight to the host's position instead of easing there
const MISMATCH_SNAPS = 3;  // snapshots in a row that disagree about the state before we give in to the host
const SMOOTH = 12;         // how fast a correction fades out (1/s)

const NOOP = () => null;
const NO_EFFECTS = new Proxy({}, { get: () => NOOP });

export class Predictor {
  // `states` and `moves` decode the snapshot's state and move indexes.
  constructor(game, fighter, { states, moves }) {
    this.g = game;
    this.f = fighter;
    this.states = states;
    this.moves = moves;
    this.active = false;
    this.paused = false;
    this.hist = [];            // [{ seq, x, y, z, facing, state, move }] after each simulation step
    this.offset = new THREE.Vector3();
    this.lastDrawn = null;
    this.jumped = false;
    this.acc = 0;
    this.mismatch = 0;
    this.seen = null;
    this.local = new Map();    // event name -> times we played it ahead of the host
    this.intent = { mx: 0, mz: 0, block: false };
    // the world our fighter steps in: the real match, minus effects, hits and every other side effect
    const world = Object.create(game);
    const self = this;
    Object.defineProperties(world, {
      predict: { value: true },
      effects: { value: NO_EFFECTS },
      ringRadius: { value: 99 },
      locked: { get: () => game.phase !== 'fight' },
      events: { value: { emit: (name, data) => self.emitLocal(name, data), on: () => NOOP } },
    });
    this.world = world;
    fighter.controller = { isHuman: true, playerIndex: 0, getIntent: () => this.intent };
  }

  emitLocal(name, data) {
    if (!LOCAL_EVENTS.has(name)) return;
    const now = performance.now();
    const list = this.local.get(name) || [];
    list.push(now);
    this.local.set(name, list);
    events.emit(name, data);
  }

  // The host's copy of an event about our fighter arrived: true when we already played it.
  claim(name) {
    const list = this.local.get(name);
    if (!list) return false;
    const now = performance.now();
    while (list.length && now - list[0] > 2000) list.shift();
    if (!list.length) return false;
    list.shift();
    return true;
  }

  // Called once a frame with the newest snapshot: decides whether we predict this frame and
  // corrects the prediction against what the host says. Returns true while we draw the fighter.
  update(s) {
    const f = this.f, g = this.g;
    if (!s) return (this.active = false);
    const sf = s.f[f.slot];
    if (!sf) return (this.active = false);
    const state = this.states[sf[4]];
    const free = !this.paused && s.ph === 2 && !!(sf[9] & 1) && PREDICTED.has(state);
    if (!free) {
      if (this.active) { this.active = false; this.jumped = true; }
      return false;
    }
    if (!this.active) {
      // only take over from a calm moment: standing, walking or blocking
      if (state !== 'idle' && state !== 'block') return false;
      this.active = true;
      this.resync(s);
      return true;
    }
    if (s === this.seen) return true;
    this.seen = s;
    const ack = s.a?.[f.slot];
    if (!(ack >= 0)) return true;
    // where we had the fighter after as many steps of that input as the host has run
    const i = this.hist.findIndex((e) => e.seq === ack);
    if (i < 0) return true;
    if (i > 0) this.hist.splice(0, i);
    const steps = Math.max(1, Math.round((s.ah?.[f.slot] || 0) / SIM_DT));
    const h = this.hist[Math.min(steps, this.hist.length) - 1];
    const move = this.moves[sf[10]] || null;
    const same = state === h.state && (state !== 'attack' || move === h.move);
    if (!same) {
      // blows that land make the host pause the attacker for a moment; give it a few snapshots to agree
      if (++this.mismatch >= MISMATCH_SNAPS) this.resync(s);
      return true;
    }
    this.mismatch = 0;
    const ex = sf[0] - h.x, ey = sf[1] - h.y, ez = sf[2] - h.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > SNAP_ERROR) { this.resync(s); return true; }
    if (err > 0.04) {
      f.pos.x += ex; f.pos.y = Math.max(0, f.pos.y + ey); f.pos.z += ez;
      for (const e of this.hist) { e.x += ex; e.y += ey; e.z += ez; }
      this.offset.x -= ex; this.offset.y -= ey; this.offset.z -= ez;
    }
    const ef = wrapAngle(sf[3] - h.facing);
    if (Math.abs(ef) > 0.05) {
      f.facing += ef;
      for (const e of this.hist) e.facing += ef;
    }
    return true;
  }

  // Start again from the host's newest word on our fighter.
  resync(s) {
    const f = this.f;
    const sf = s.f[f.slot];
    f.pos.set(sf[0], sf[1], sf[2]);
    f.vel.set(sf[35] || 0, sf[36] || 0, sf[37] || 0);
    f.facing = sf[3];
    f.state = this.states[sf[4]] || 'idle';
    f.stateTime = sf[5];
    f.stateDuration = sf[6];
    f.grounded = !!(sf[9] & 2);
    f.moveName = this.moves[sf[10]] || null;
    f.move = f.moveName ? MOVES[f.moveName] : null;
    if (f.state === 'attack' && !f.move) f.state = 'idle';
    f.attackPhase = sf[11];
    f.attackSide = sf[12];
    f.hitstop = 0;
    f.buffer = null;
    f.landTime = 0;
    f.airAttackUsed = !f.grounded && f.state === 'attack';
    if (f.state === 'dodge') {
      const v = Math.hypot(f.vel.x, f.vel.z);
      f.dodgeDir = v > 0.1 ? { x: f.vel.x / v, z: f.vel.z / v } : { x: -Math.sin(f.facing), z: -Math.cos(f.facing) };
    }
    this.hist.length = 0;
    this.mismatch = 0;
    this.acc = 0;
    this.jumped = true;
  }

  // Step our fighter with this frame's input. `seq` is the newest input number sent to the host.
  simulate(dt, it, seq) {
    const f = this.f, w = this.world;
    this.acc += dt;
    let first = true;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 24) {
      const intent = { mx: it.mx, mz: it.mz, block: it.block, dashHeld: it.dashHeld };
      // a tap counts once, on the first step of the frame it happened in
      if (first) for (const k of Object.keys(it)) if (it[k] === true && !(k in intent) && !HOST_ONLY.includes(k)) intent[k] = true;
      this.intent = intent;
      f.update(SIM_DT, w);
      // remember where each step left us, to check against the host later
      this.hist.push({ seq, x: f.pos.x, y: f.pos.y, z: f.pos.z, facing: f.facing, state: f.state, move: f.state === 'attack' ? f.moveName : null });
      this.acc -= SIM_DT;
      first = false;
      steps++;
    }
    if (steps >= 24) this.acc = 0;
    if (first) f.syncVisual(0, w);
    this.intent = { mx: it.mx, mz: it.mz, block: it.block, dashHeld: it.dashHeld };
    if (this.hist.length > 600) this.hist.splice(0, this.hist.length - 600);
  }

  // After the fighter was drawn (by us or from snapshots): ease away any jump a correction or a
  // hand-over between the two made, so the fighter glides instead of teleporting.
  afterDraw(dt) {
    const root = this.f.model.root;
    if (this.jumped && this.lastDrawn) {
      this.offset.copy(this.lastDrawn).sub(this.f.pos);
      if (this.offset.length() > SNAP_ERROR * 1.5) this.offset.set(0, 0, 0);
    }
    this.jumped = false;
    this.offset.multiplyScalar(Math.exp(-dt * SMOOTH));
    if (this.offset.lengthSq() < 1e-6) this.offset.set(0, 0, 0);
    root.position.set(this.f.pos.x + this.offset.x, Math.max(0, this.f.pos.y + this.offset.y), this.f.pos.z + this.offset.z);
    (this.lastDrawn ||= new THREE.Vector3()).copy(root.position);
  }

  pause(p) {
    this.paused = p;
    if (p && this.active) { this.active = false; this.jumped = true; }
  }
}
