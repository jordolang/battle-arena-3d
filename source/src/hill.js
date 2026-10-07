// King of the hill. A glowing ring stands on the arena floor; whoever holds it alone (or with only
// teammates) scores a point a second, and the first to HILL.target takes the round. The ring moves to a
// new spot every so often, and knocked-out fighters come back after a few seconds, so nobody sits out.
// The host (or a local match) runs tick(); online clients get state() through the snapshots.
import * as THREE from 'three';
import { HILL } from './config.js';
import { events } from './events.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const NEUTRAL = 0xffd23d, CONTESTED = 0xff3a2a;

export class Hill {
  static RADIUS_INSIDE = HILL.radius * 0.6; // where a CPU stops walking and starts fighting
  constructor(game) {
    this.game = game;
    this.scores = new Map();   // owner key (team index in team matches, else fighter slot) -> points
    this.spot = 0;
    this.time = 0;
    this.owner = -1;           // -1 nobody, -2 contested, else the owner key
    this.moveAt = HILL.moveEvery;
    this.pos = new THREE.Vector3();
    this.buildVisual(game.scene);
    this.board = document.createElement('div');
    this.board.id = 'hill-board';
    this.board.hidden = true;
    (game.hud.root.querySelector('#topbar') || game.hud.root).appendChild(this.board); // under the round timer
  }

  get active() { return !!this.game.rules?.hill && this.game.mode === 'match'; }

  buildVisual(scene) {
    const g = new THREE.Group();
    const mat = (o) => new THREE.MeshBasicMaterial({ color: NEUTRAL, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...o });
    this.ringMat = mat({ opacity: 0.9 });
    this.discMat = mat({ opacity: 0.12 });
    this.beamMat = mat({ opacity: 0.16 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(HILL.radius - 0.22, HILL.radius, 72), this.ringMat);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(HILL.radius - 0.22, 72), this.discMat);
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06; disc.position.y = 0.05;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(HILL.radius, HILL.radius, 7, 48, 1, true), this.beamMat);
    beam.position.y = 3.5;
    g.add(ring, disc, beam);
    g.visible = false;
    scene.add(g);
    this.group = g;
    this.beam = beam;
  }

  // A new round: scores back to zero, the ring on its first spot.
  reset() {
    this.scores.clear();
    this.spot = 0;
    this.time = 0;
    this.owner = -1;
    this.moveAt = HILL.moveEvery;
    this.announced = false;
    const [x, z] = HILL.spots[0];
    this.pos.set(x, 0, z);
    this.group.position.copy(this.pos);
    for (const f of this.game.fighters) f.respawnAt = null;
    this.show(this.active);
  }

  show(on) {
    this.group.visible = on;
    this.board.hidden = !on;
    if (!on) this.board.innerHTML = '';
  }

  keyOf(f) { return this.game.teamMode && f.team >= 0 ? f.team : f.slot; }
  inside(f) { return f.alive && Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) < HILL.radius; }
  get target() { return this.game.rules.hillTarget || HILL.target; }

  // One simulation step during the fight. Returns undefined while the round goes on, otherwise the
  // fighter who takes it (null for a draw).
  tick(dt) {
    const g = this.game;
    this.time += dt;
    // the ring moves on; a heads-up first
    if (!this.announced && this.time > this.moveAt - 5) { this.announced = true; g.hud.feed('<span>The hill moves in 5 seconds</span>'); }
    if (this.time >= this.moveAt) {
      this.spot = (this.spot + 1 + Math.floor(Math.random() * (HILL.spots.length - 1))) % HILL.spots.length;
      const [x, z] = HILL.spots[this.spot];
      this.pos.set(x, 0, z);
      this.moveAt = this.time + HILL.moveEvery;
      this.announced = false;
      g.hud.announce('The hill moves!', 'round', 1100);
      events.emit('hillMove', { x, z });
    }
    // knocked-out fighters come back on the far side of the arena, briefly untouchable
    for (const f of g.fighters) {
      if (f.alive) continue;
      if (f.respawnAt == null) { f.respawnAt = g.time + HILL.respawn; continue; }
      if (g.time < f.respawnAt) continue;
      f.respawnAt = null;
      const a = Math.atan2(-this.pos.z, -this.pos.x) + (Math.random() - 0.5) * 1.6;
      const r = g.arena.radius * 0.78;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      f.reset(new THREE.Vector3(x, 0, z), Math.atan2(-x, -z));
      f.invuln = HILL.invuln;
      g.effects.ring(x, 0.2, z, f.teamColor ?? f.def.eyes, 2.2, 0.5);
      events.emit('respawn', { fighter: f });
    }
    // who holds the hill
    const keys = new Set();
    for (const f of g.fighters) if (this.inside(f)) keys.add(this.keyOf(f));
    const was = this.owner;
    this.owner = keys.size === 0 ? -1 : keys.size === 1 ? [...keys][0] : -2;
    if (this.owner >= 0) {
      const s = (this.scores.get(this.owner) || 0) + dt;
      this.scores.set(this.owner, s);
      if (s >= this.target) return this.leader(this.owner);
      if (was !== this.owner && Math.floor(s) > 0) events.emit('hillTaken', { key: this.owner });
    }
    if (this.time >= (g.rules.hillLimit || HILL.limit)) {
      const best = [...this.scores.entries()].sort((a, b) => b[1] - a[1]);
      if (!best.length || (best[1] && Math.floor(best[0][1]) === Math.floor(best[1][1]))) return null;
      return this.leader(best[0][0]);
    }
    return undefined;
  }

  // The fighter standing for an owner key (a living teammate if there is one).
  leader(key) {
    const list = this.game.fighters.filter((f) => this.keyOf(f) === key);
    return list.find((f) => f.alive) || list[0] || null;
  }

  // Snapshot for online clients: [spot, time, owner, moveAt, key, score, key, score, ...]
  state() {
    const out = [this.spot, Math.round(this.time * 10) / 10, this.owner, Math.round(this.moveAt * 10) / 10];
    for (const [k, v] of this.scores) out.push(k, Math.round(v * 10) / 10);
    return out;
  }

  applyState(s) {
    if (!Array.isArray(s)) return;
    if (this.group.visible !== this.active) this.show(this.active);
    const spot = s[0] | 0;
    if (HILL.spots[spot]) this.pos.set(HILL.spots[spot][0], 0, HILL.spots[spot][1]);
    this.spot = spot;
    this.time = +s[1] || 0;
    this.owner = Number.isInteger(s[2]) ? s[2] : -1;
    this.moveAt = +s[3] || HILL.moveEvery;
    this.scores.clear();
    for (let i = 4; i + 1 < s.length; i += 2) if (Number.isInteger(s[i])) this.scores.set(s[i], +s[i + 1] || 0);
  }

  ownerColor(key) {
    const g = this.game;
    if (g.teamMode) return g.teams[key]?.color ?? NEUTRAL;
    const f = g.fighters[key];
    return f ? (f.netColor ? parseInt(f.netColor.slice(1), 16) : f.def.eyes) : NEUTRAL;
  }

  ownerName(key) {
    const g = this.game;
    if (g.teamMode) return g.teams[key]?.name || `Team ${key + 1}`;
    const f = g.fighters[key];
    return f ? (f.netName || f.name) : '?';
  }

  // Every frame: the ring glides to its spot and takes the holder's colour; the board shows the scores.
  animate(dt) {
    if (!this.active) { if (this.group.visible) this.show(false); return; }
    if (!this.group.visible) this.show(true);
    const k = Math.min(1, dt * 3);
    this.group.position.x += (this.pos.x - this.group.position.x) * k;
    this.group.position.z += (this.pos.z - this.group.position.z) * k;
    const color = this.owner === -2 ? CONTESTED : this.owner >= 0 ? this.ownerColor(this.owner) : NEUTRAL;
    for (const m of [this.ringMat, this.discMat, this.beamMat]) m.color.setHex(color);
    const pulse = 0.5 + Math.sin(performance.now() / 180) * 0.5;
    this.beamMat.opacity = this.owner === -2 ? 0.1 + pulse * 0.16 : 0.14;
    this.discMat.opacity = this.owner >= 0 ? 0.2 : 0.1;
    this.beam.rotation.y += dt * 0.6;
    this.renderBoard();
  }

  renderBoard() {
    const t = this.target;
    const rows = [...this.scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const status = this.owner === -2 ? '<em class="contested">Contested</em>'
      : this.owner >= 0 ? `<em style="color:${hex(this.ownerColor(this.owner))}">${esc(this.ownerName(this.owner))} holds it</em>` : '<em>Nobody holds it</em>';
    const moveIn = Math.max(0, Math.ceil(this.moveAt - this.time));
    const html = `<div class="hill-h"><b>King of the hill</b>${status}</div>${rows.map(([key, v]) =>
      `<div class="hill-row"><i style="background:${hex(this.ownerColor(key))}"></i><span>${esc(this.ownerName(key))}</span>
        <div class="hill-bar"><u style="width:${Math.min(100, (v / t) * 100)}%;background:${hex(this.ownerColor(key))}"></u></div><b>${Math.floor(v)}</b></div>`).join('')}
      <div class="hill-foot">First to ${t} · ${moveIn <= 5 ? `<b>moves in ${moveIn}</b>` : 'the ring moves every so often'}</div>`;
    if (html !== this.lastHtml) { this.board.innerHTML = html; this.lastHtml = html; }
  }
}
