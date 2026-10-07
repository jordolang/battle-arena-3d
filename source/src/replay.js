// Instant replay of the final knockout, and a short video clip of it to share.
// During a match the last few seconds of every fighter's pose, the projectiles in flight, the effects
// drawn and the sounds heard are kept in a small rolling buffer (a few floats per fighter, 30 times a
// second). When the match ends that buffer is frozen around the deciding KO. Playing it drives the real
// fighters through the recorded poses under a cinematic camera, slowing down for the knockout itself,
// and only while it plays is the picture (and the game's sound) recorded into a video file.
import { MOVES, SKILLS, SKILL_IDS, WEAPON_IDS } from './config.js';
import { Effects } from './effects.js';
import { Projectile } from './specials.js';
import { events } from './events.js';
import { GAME_URL } from './share.js';
import { STATES } from './net/session.js';

const HZ = 30;                       // poses kept per second of match time
const KEEP = 14;                     // seconds of history held
const BEFORE = 4.2, AFTER = 2.4;     // the clip: this long before the final KO and after it
const SLOW = 0.3;                    // replay speed through the knockout itself
const END_CARD = 1.6;                // seconds of title card closing the video
const CLIP_EDGE = 1280;              // longest side of the recorded video, in pixels
const MOVE_NAMES = Object.keys(MOVES);
const FX = ['sparks', 'impact', 'dust', 'puff', 'streak', 'ring', 'cone', 'lightning'];
// events that only make sound; the replay re-emits them so the audio pass plays them again
const SOUND_EVENTS = ['hazard', 'swing', 'hit', 'block', 'guardBreak', 'shieldBreak', 'wallHit', 'special', 'thunder', 'spearPull',
  'skill', 'dodge', 'jump', 'land', 'ko', 'weaponBreak', 'armorBreak'];
const K = 26;                        // floats per fighter per frame (see poseOf)
// fields a replay overwrites, put back exactly when it ends
const LIVE_FIELDS = ['facing', 'state', 'stateTime', 'stateDuration', 'hp', 'maxHp', 'alive', 'grounded', 'moveName', 'move',
  'attackPhase', 'attackSide', 'specialPhase', 'moveAmount', 'runPhase', 'invuln', 'armor', 'power', 'lifesteal', 'vanish',
  'haste', 'slow', 'sprinting', 'exhausted', 'weapon', 'plate', 'downed', 'shield', 'skillId', 'skill', 'hitstop'];

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Effects calls are seen at the prototype, so effects drawn from a host's stream on an online client count too.
let fxTap = null;
for (const name of FX) {
  const orig = Effects.prototype[name];
  Effects.prototype[name] = function (...args) { fxTap?.(name, args); return orig.apply(this, args); };
}

function poseOf(f, out, o) {
  const flags = (f.alive ? 1 : 0) | (f.grounded ? 2 : 0) | (f.model.ice.visible ? 4 : 0) | (f.hitstop > 0 ? 8 : 0) | (f.exhausted ? 16 : 0) | (f.sprinting ? 32 : 0);
  const buffs = (f.armor > 0 ? 1 : 0) | (f.power > 0 ? 2 : 0) | (f.lifesteal > 0 ? 4 : 0) | (f.vanish > 0 ? 8 : 0) | (f.haste > 0 ? 16 : 0) | (f.slow > 0 ? 32 : 0);
  out[o] = f.pos.x; out[o + 1] = f.pos.y; out[o + 2] = f.pos.z; out[o + 3] = f.facing;
  out[o + 4] = STATES.indexOf(f.state); out[o + 5] = f.stateTime; out[o + 6] = f.stateDuration; out[o + 7] = f.hp;
  out[o + 8] = flags; out[o + 9] = f.moveName ? MOVE_NAMES.indexOf(f.moveName) : -1; out[o + 10] = f.attackPhase;
  out[o + 11] = f.attackSide; out[o + 12] = f.specialPhase; out[o + 13] = f.moveAmount; out[o + 14] = f.runPhase;
  out[o + 15] = Math.max(0, f.invuln); out[o + 16] = buffs; out[o + 17] = f.weapon ? WEAPON_IDS.indexOf(f.weapon) : -1;
  out[o + 18] = f.plate; out[o + 19] = f.downed; out[o + 20] = f.shield; out[o + 21] = f.skillId ? SKILL_IDS.indexOf(f.skillId) : -1;
  out[o + 22] = f.maxHp; out[o + 23] = f.vel?.x || 0; out[o + 24] = f.vel?.z || 0; out[o + 25] = f.vel?.y || 0;
}

// Fighters in event payloads are stored by slot so the frozen clip holds no live references.
function pack(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v && typeof v === 'object') { if (Number.isInteger(v.slot) && v.model) out[k] = { $f: v.slot }; }
    else out[k] = v;
  }
  return out;
}

function pickMime() {
  const R = window.MediaRecorder;
  if (!R?.isTypeSupported) return '';
  // MP4 first: it is what Facebook, phones and messaging apps take most readily
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => R.isTypeSupported(m)) || '';
}

export class Replay {
  constructor(game) {
    this.game = game;
    this.frames = [];          // { t, f: Float32Array, p: [...projectiles], rr }
    this.fx = [];              // { t, name, args }
    this.ev = [];              // { t, name, data }
    this.lastT = -Infinity;
    this.lastKo = null;        // { t, victim, by } slots
    this.clip = null;          // the frozen final knockout
    this.video = null;         // { blob, url, type, name, seconds } once recorded
    this.playing = false;
    this.audioStream = null;   // () => MediaStream | null, set by main.js
    this.onVideo = null;       // called when a new clip file is ready
    fxTap = (name, args) => {
      if (this.playing || this.game.mode !== 'match') return;
      this.fx.push({ t: this.game.time, name, args: args.map((a) => (typeof a === 'number' ? a : null)) });
    };
    for (const name of SOUND_EVENTS) {
      events.on(name, (data) => {
        if (this.playing || this.game.mode !== 'match' || data?.replay) return;
        this.ev.push({ t: this.game.time, name, data: pack(data) });
        if (name === 'ko' && data?.fighter) this.lastKo = { t: this.game.time, victim: data.fighter.slot, by: data.by ? data.by.slot : -1 };
      });
    }
  }

  // A new match (or the lobby): drop the history and stop anything playing.
  reset() {
    if (this.playing) this.finish(true);
    this.frames = []; this.fx = []; this.ev = [];
    this.lastT = -Infinity;
    this.lastKo = null;
    this.clip = null;
  }

  // Called once per rendered frame of a match; samples poses HZ times per second of match time.
  record() {
    const g = this.game;
    if (g.mode !== 'match' || this.playing || !g.fighters.length) return;
    const t = g.time;
    if (t - this.lastT < 1 / HZ) return;
    this.lastT = t;
    const f = new Float32Array(g.fighters.length * K);
    g.fighters.forEach((ft, i) => poseOf(ft, f, i * K));
    const p = [];
    for (const pr of g.projectiles) if (!pr.dead) p.push([pr.id, pr.kind, pr.pos.x, pr.pos.y, pr.pos.z, pr.dir.x, pr.dir.z, pr.owner?.slot ?? 0, pr.color, pr.size ?? 1, pr.stretch ?? 1]);
    for (const pr of g.net?.clientProjectiles?.values() || []) p.push([pr.id, pr.kind, pr.pos.x, pr.pos.y, pr.pos.z, pr.dir.x, pr.dir.z, pr.owner?.slot ?? 0, pr.color, pr.size ?? 1, pr.stretch ?? 1]);
    this.frames.push({ t, f, p, rr: g.ringRadius, ft: g.fightTime, rd: g.round });
    const cut = t - KEEP;
    while (this.frames.length && this.frames[0].t < cut) this.frames.shift();
    while (this.fx.length && this.fx[0].t < cut) this.fx.shift();
    while (this.ev.length && this.ev[0].t < cut) this.ev.shift();
  }

  // The match is over: keep the seconds around the deciding knockout. Returns whether there is one.
  capture(caption = '') {
    const g = this.game;
    this.clip = null;
    // a new match's clip replaces the last one, so the results never offer the previous fight's video
    if (this.video) { URL.revokeObjectURL(this.video.url); this.video = null; }
    if (this.frames.length < 2) return false;
    const end = this.frames[this.frames.length - 1].t;
    const ko = this.lastKo && this.lastKo.t > end - KEEP ? this.lastKo : null;
    const koT = ko ? ko.t : end - AFTER;
    const from = Math.max(this.frames[0].t, koT - BEFORE), to = Math.min(end, koT + AFTER);
    const frames = this.frames.filter((fr) => fr.t >= from - 0.05 && fr.t <= to + 0.05);
    if (frames.length < 8) return false;
    this.clip = {
      frames, koT, from: frames[0].t, to: frames[frames.length - 1].t, caption,
      victim: ko ? ko.victim : -1, by: ko ? ko.by : -1, fighters: g.fighters,
      fx: this.fx.filter((x) => x.t >= from && x.t <= to),
      ev: this.ev.filter((x) => x.t >= from && x.t <= to),
    };
    return true;
  }

  // The clip can be watched while its fighters are still on the field.
  get canPlay() { return !!this.clip && this.clip.fighters === this.game.fighters && this.game.fighters.length > 0; }

  play({ record = true, onDone = null } = {}) {
    if (this.playing || !this.canPlay) return false;
    const g = this.game, c = this.clip;
    this.onDone = onDone;
    this.playing = true;
    this.skipped = false;
    this.clock = c.from;
    this.idx = 0; this.fxIdx = 0; this.evIdx = 0;
    this.projs = new Map();
    // put back afterwards: every fighter's live state, the camera and the live projectiles
    this.saved = {
      fighters: g.fighters.map((f) => {
        const s = { pos: f.pos.clone(), ice: f.model.ice.visible, ring: f.model.ring.visible };
        for (const k of LIVE_FIELDS) s[k] = f[k];
        return s;
      }),
      rig: { mode: g.rig.mode, yaw: g.rig.yaw, pitch: g.rig.pitch, distance: g.rig.distance, focus: g.rig.focus.clone(), orbitAngle: g.rig.orbitAngle },
      ring: g.ringRadius, fightTime: g.fightTime, round: g.round,
    };
    for (const p of g.projectiles) p.mesh.visible = false;
    g.rig.mode = 'replay';
    // the camera sweeps in from the arena's open side toward the fighters
    const focus = this.koFocus();
    this.camYaw = Math.atan2(-focus.x, -focus.z);
    if (Math.hypot(focus.x, focus.z) < 2) this.camYaw = g.rig.yaw;
    this.camAt = null;
    document.body.classList.add('replaying');
    if (record) this.startRecorder();
    return true;
  }

  skip() { if (this.playing) { this.skipped = true; this.finish(false); } }

  // Where the knockout happened (between the two fighters involved).
  koFocus() {
    const c = this.clip;
    const fr = this.frameAt(c.koT);
    const at = (slot) => (slot >= 0 && slot < c.fighters.length ? { x: fr.f[slot * K], z: fr.f[slot * K + 2] } : null);
    const v = at(c.victim), k = at(c.by);
    if (v && k && Math.hypot(v.x - k.x, v.z - k.z) < 12) return { x: (v.x + k.x) / 2, z: (v.z + k.z) / 2 };
    return v || k || { x: 0, z: 0 };
  }

  frameAt(t) {
    const fr = this.clip.frames;
    let i = 0;
    while (i < fr.length - 1 && fr[i + 1].t <= t) i++;
    return fr[i];
  }

  // One rendered frame of playback, in place of the simulation.
  step(dt) {
    const g = this.game, c = this.clip;
    // full speed, easing into slow motion for the knockout and back out after it
    const speed = c.victim >= 0 ? lerp(1, SLOW, smooth(c.koT - 0.9, c.koT - 0.35, this.clock) * (1 - smooth(c.koT + 0.8, c.koT + 1.4, this.clock))) : 1;
    const sdt = dt * speed;
    this.clock += sdt;
    if (this.clock >= c.to) { this.finish(false); return; }
    const fr = c.frames;
    while (this.idx < fr.length - 2 && fr[this.idx + 1].t <= this.clock) this.idx++;
    const a = fr[this.idx], b = fr[this.idx + 1] || a;
    const t = b === a ? 0 : Math.min(1, Math.max(0, (this.clock - a.t) / (b.t - a.t)));
    g.fighters.forEach((f, i) => this.applyPose(f, a.f, b.f, i * K, t, sdt));
    g.ringRadius = lerp(a.rr, b.rr, t);
    if (g.ringRadius < 90) g.arena.setFireRing(g.ringRadius); else g.arena.resetFireRing();
    // arena hazards (crumbling slabs, vents, the storm) follow the round clock
    g.round = a.rd ?? g.round;
    g.fightTime = lerp(a.ft ?? 0, a.rd === b.rd ? b.ft ?? 0 : a.ft ?? 0, t);
    this.stepProjectiles(a, b, t, sdt);
    while (this.fxIdx < c.fx.length && c.fx[this.fxIdx].t <= this.clock) {
      const x = c.fx[this.fxIdx++];
      try { g.effects[x.name](...x.args.map((v) => (v === null ? undefined : v))); } catch { /* skip a bad effect */ }
    }
    while (this.evIdx < c.ev.length && c.ev[this.evIdx].t <= this.clock) {
      const x = c.ev[this.evIdx++];
      const data = { replay: true };
      for (const [k, v] of Object.entries(x.data)) data[k] = v && typeof v === 'object' ? g.fighters[v.$f] || null : v;
      if (x.name === 'ko') g.rig.shake(0.5);
      events.emit(x.name, data);
    }
    g.effects.update(sdt);
    g.arena.update(sdt, g);
    this.camera(dt);
  }

  applyPose(f, A, B, o, t, dt) {
    const same = A[o + 4] === B[o + 4];
    f.animTime += dt;
    f.pos.set(lerp(A[o], B[o], t), lerp(A[o + 1], B[o + 1], t), lerp(A[o + 2], B[o + 2], t));
    f.facing = lerpAngle(A[o + 3], B[o + 3], t);
    f.state = STATES[A[o + 4]] || 'idle';
    f.stateTime = same ? lerp(A[o + 5], B[o + 5], t) : A[o + 5];
    f.stateDuration = A[o + 6];
    f.hp = lerp(A[o + 7], B[o + 7], t);
    const flags = A[o + 8], buffs = A[o + 16];
    f.alive = !!(flags & 1);
    f.grounded = !!(flags & 2);
    f.model.ice.visible = !!(flags & 4);
    f.exhausted = !!(flags & 16);
    f.sprinting = !!(flags & 32);
    f.moveName = MOVE_NAMES[A[o + 9]] || null;
    f.move = f.moveName ? MOVES[f.moveName] : null;
    f.attackPhase = same && A[o + 9] === B[o + 9] ? lerp(A[o + 10], B[o + 10], t) : A[o + 10];
    f.attackSide = A[o + 11];
    f.specialPhase = same ? lerp(A[o + 12], B[o + 12], t) : A[o + 12];
    f.moveAmount = lerp(A[o + 13], B[o + 13], t);
    f.runPhase = B[o + 14] >= A[o + 14] ? lerp(A[o + 14], B[o + 14], t) : B[o + 14];
    f.invuln = A[o + 15];
    f.armor = buffs & 1 ? 1 : 0; f.power = buffs & 2 ? 1 : 0; f.lifesteal = buffs & 4 ? 1 : 0;
    f.vanish = buffs & 8 ? 1 : 0; f.haste = buffs & 16 ? 1 : 0; f.slow = buffs & 32 ? 1 : 0;
    f.weapon = WEAPON_IDS[A[o + 17]] || null;
    f.plate = A[o + 18];
    f.downed = A[o + 19];
    f.shield = A[o + 20];
    f.skillId = SKILL_IDS[A[o + 21]] || null;
    f.skill = f.skillId ? SKILLS[f.skillId] : null;
    f.maxHp = A[o + 22] || f.maxHp;
    if (f.vel) f.vel.set(lerp(A[o + 23], B[o + 23], t), lerp(A[o + 25], B[o + 25], t), lerp(A[o + 24], B[o + 24], t));
    f.hitstop = 0;
    if (f.alive) f.model.ring.visible = true;
    f.updateBuffVisuals();
    f.syncVisual(flags & 8 ? 0 : dt, this.game);
  }

  stepProjectiles(a, b, t, dt) {
    const g = this.game;
    const live = new Set();
    const prev = new Map(a.p.map((p) => [p[0], p]));
    for (const p of b.p) {
      const [id, kind, x, y, z, dx, dz, owner, color, size, stretch] = p;
      live.add(id);
      let proj = this.projs.get(id);
      if (!proj) {
        const ownerF = g.fighters[owner];
        if (!ownerF) continue;
        proj = new Projectile(g, ownerF, { kind, x, y, z, dx, dz, speed: 0, life: Infinity, radius: 0, color, glow: color, size, stretch, hit: null });
        this.projs.set(id, proj);
      }
      const q = prev.get(id) || p;
      proj.pos.set(lerp(q[2], x, t), lerp(q[3], y, t), lerp(q[4], z, t));
      proj.visual(dt, g);
    }
    for (const [id, proj] of this.projs) if (!live.has(id)) { proj.dispose(g); this.projs.delete(id); }
  }

  // Wide at first, pushing in on the knockout while slowly circling it.
  camera(dt) {
    const g = this.game, c = this.clip, rig = g.rig;
    const at = this.frameAt(this.clock);
    const pos = (slot) => ({ x: at.f[slot * K], z: at.f[slot * K + 2] });
    let fx = 0, fz = 0;
    const pair = [c.victim, c.by].filter((s) => s >= 0 && s < g.fighters.length);
    if (pair.length) {
      const ps = pair.map(pos);
      if (ps.length === 2 && Math.hypot(ps[0].x - ps[1].x, ps[0].z - ps[1].z) > 12) ps.pop();
      fx = ps.reduce((s, p) => s + p.x, 0) / ps.length; fz = ps.reduce((s, p) => s + p.z, 0) / ps.length;
    } else {
      const alive = g.fighters.filter((f) => f.alive);
      const set = alive.length ? alive : g.fighters;
      fx = set.reduce((s, f) => s + f.pos.x, 0) / set.length; fz = set.reduce((s, f) => s + f.pos.z, 0) / set.length;
    }
    const near = smooth(c.koT - 2.2, c.koT - 0.2, this.clock);
    const k = this.camAt === null ? 1 : 1 - Math.exp(-dt * 3);
    this.camAt = true;
    rig.focus.x += (fx - rig.focus.x) * k;
    rig.focus.z += (fz - rig.focus.z) * k;
    rig.focus.y += (1.1 - rig.focus.y) * k;
    const want = lerp(11, 5.8, near);
    rig.distance += (want - rig.distance) * k;
    rig.pitch += (lerp(0.5, 0.26, near) - rig.pitch) * k;
    rig.yaw = this.camYaw + (this.clock - c.from) * 0.12 - 0.35;
    rig.updateBasis();
    rig.place(dt);
  }

  finish(aborted) {
    if (!this.playing) return;
    const g = this.game, s = this.saved;
    this.playing = false;
    for (const proj of this.projs.values()) proj.dispose(g);
    this.projs.clear();
    for (const p of g.projectiles) p.mesh.visible = true;
    if (s && this.clip?.fighters === g.fighters) {
      g.fighters.forEach((f, i) => {
        const v = s.fighters[i];
        f.pos.copy(v.pos);
        for (const k of LIVE_FIELDS) f[k] = v[k];
        f.model.ice.visible = v.ice;
        f.model.ring.visible = v.ring;
        f.updateBuffVisuals();
        f.syncVisual(0, g);
      });
      g.ringRadius = s.ring;
      g.fightTime = s.fightTime; g.round = s.round;
      if (s.ring < 90) g.arena.setFireRing(s.ring); else g.arena.resetFireRing();
      Object.assign(g.rig, { mode: s.rig.mode, yaw: s.rig.yaw, pitch: s.rig.pitch, distance: s.rig.distance, orbitAngle: s.rig.orbitAngle });
      g.rig.focus.copy(s.rig.focus);
    }
    this.saved = null;
    // an online client skipped the host's stream while it watched; don't burst through it all at once
    if (g.online === 'client' && g.net?.fxQueue) g.net.fxQueue.length = 0;
    document.body.classList.remove('replaying');
    this.stopRecorder(aborted);
    const done = this.onDone;
    this.onDone = null;
    if (!aborted) done?.();
  }

  // ------------------------------------------------------------ the video file
  startRecorder() {
    const src = this.game.renderer.domElement;
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream || !src.width) return;
    const scale = Math.min(1, CLIP_EDGE / Math.max(src.width, src.height));
    const cv = this.canvas || (this.canvas = document.createElement('canvas'));
    cv.width = Math.round(src.width * scale / 2) * 2;
    cv.height = Math.round(src.height * scale / 2) * 2;
    this.ctx2d = cv.getContext('2d');
    this.paintCard(0); // a first frame so the stream starts with a picture
    const stream = cv.captureStream(30);
    let audio = null;
    try { audio = this.audioStream?.(); } catch { audio = null; }
    for (const tr of audio?.getAudioTracks() || []) stream.addTrack(tr);
    const mimeType = pickMime();
    let rec;
    try { rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 4_000_000 }); } catch { return; }
    const chunks = [];
    const started = performance.now();
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => {
      for (const tr of stream.getVideoTracks()) tr.stop();
      try { this.audioStream && this.releaseStream?.(); } catch { /* ignore */ }
      const seconds = (performance.now() - started) / 1000;
      // a skipped replay still counts when there is no clip yet and it caught enough to show something
      if (!chunks.length || rec.discard || (rec.partial && (this.video || seconds < 2))) return;
      const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
      if (this.video) URL.revokeObjectURL(this.video.url);
      const blob = new Blob(chunks, { type });
      this.video = { blob, type, url: URL.createObjectURL(blob), seconds, name: `jose-madrid-battle-arena-ko.${type.includes('mp4') ? 'mp4' : 'webm'}` };
      this.onVideo?.(this.video);
    };
    try { rec.start(1000); } catch { return; }
    this.rec = rec;
    this.endCard = 0;
  }

  stopRecorder(aborted) {
    const rec = this.rec;
    if (!rec) return;
    if (aborted) { rec.discard = true; this.rec = null; try { rec.stop(); } catch { /* already stopped */ } return; }
    if (this.skipped) { rec.partial = true; this.rec = null; try { rec.stop(); } catch { /* already stopped */ } return; }
    // close the video on a title card while the results come up
    this.endCard = END_CARD;
  }

  // Called right after each render, while the WebGL picture is still readable.
  afterRender(dt) {
    if (!this.rec) return;
    if (this.playing) { this.paintFrame(); return; }
    this.endCard -= dt;
    this.paintCard(1 - Math.max(0, this.endCard) / END_CARD);
    if (this.endCard <= 0) { const rec = this.rec; this.rec = null; try { rec.stop(); } catch { /* already stopped */ } }
  }

  paintFrame() {
    const ctx = this.ctx2d, cv = this.canvas, src = this.game.renderer.domElement;
    const w = cv.width, h = cv.height, u = Math.max(w, h) / 1280;
    ctx.drawImage(src, 0, 0, w, h);
    // cinematic bars, the replay badge, and the game's name
    const bar = Math.round(h * 0.07);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar);
    ctx.fillStyle = '#c4212f';
    ctx.fillRect(Math.round(18 * u), Math.round(bar + 16 * u), Math.round(118 * u), Math.round(34 * u));
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(24 * u)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('● REPLAY', Math.round(28 * u), Math.round(bar + 33 * u));
    ctx.font = `600 ${Math.round(Math.min(bar * 0.5, 26 * u))}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    ctx.fillStyle = '#ffc861';
    ctx.fillText('JOSÉ MADRID SALSA BATTLE ARENA', Math.round(18 * u), Math.round(h - bar / 2));
    if (this.clip?.caption) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#efe4d2';
      ctx.fillText(this.clip.caption, Math.round(w - 18 * u), Math.round(h - bar / 2));
    }
  }

  // The closing title card: the crest, who won, and where to play.
  paintCard(k) {
    const ctx = this.ctx2d, cv = this.canvas;
    const w = cv.width, h = cv.height, u = Math.min(w, h) / 720;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#120c0a';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, k * 3);
    const logo = document.querySelector('.logo img');
    const size = Math.round(Math.min(w, h) * 0.46);
    if (logo?.complete && logo.naturalWidth) { try { ctx.drawImage(logo, (w - size) / 2, h * 0.08, size, size); } catch { /* not drawable */ } }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#efe4d2';
    ctx.font = `700 ${Math.round(40 * u)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    if (this.clip?.caption) ctx.fillText(this.clip.caption, w / 2, h * 0.08 + size + 44 * u);
    ctx.fillStyle = '#ffc861';
    ctx.font = `600 ${Math.round(28 * u)}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    ctx.fillText('Think you can do better? Play free in your browser', w / 2, h * 0.08 + size + 92 * u);
    ctx.fillStyle = '#a3968a';
    ctx.fillText(GAME_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''), w / 2, h * 0.08 + size + 132 * u);
    ctx.globalAlpha = 1;
  }

  stats() {
    return { frames: this.frames.length, fx: this.fx.length, ev: this.ev.length, clip: this.clip ? { frames: this.clip.frames.length, seconds: +(this.clip.to - this.clip.from).toFixed(2), koAt: +(this.clip.koT - this.clip.from).toFixed(2), victim: this.clip.victim, by: this.clip.by } : null, playing: this.playing, recording: !!this.rec, video: this.video ? { type: this.video.type, kb: Math.round(this.video.blob.size / 1024), seconds: +this.video.seconds.toFixed(1) } : null };
  }
}
