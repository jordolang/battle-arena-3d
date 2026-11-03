// Shared camera that keeps every living fighter in frame. Its yaw is fixed
// during a fight so "up" on the keyboard always means the same direction.
//
// Focus mode (focus.js decides when): while a fight is at its most intense the camera
// eases in close on one fighter and swings slowly to either side of them, then eases
// back out. It only changes what is drawn: the controls keep the fixed fight yaw, so
// "up" still means the same direction on the floor while the view moves.
import * as THREE from 'three';

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.1, 400);
    this.focus = new THREE.Vector3(0, 1, 0);
    this.distance = 22;
    this.yaw = 0;            // radians around Y; 0 = camera south of the arena looking north
    this.pitch = 0.78;       // radians down from horizontal
    this.shakeAmt = 0;
    this.mode = 'fight';     // 'fight' | 'orbit' | 'winner'
    this.orbitAngle = 0;
    this.winner = null;
    this.follow = null;      // on the big map a player's camera stays on their own fight
    this.maxDistance = 36;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this._target = new THREE.Vector3();
    this.baseFov = 46;
    this.focusTarget = null;   // the fighter the focus camera holds on (null = off)
    this.focusBlend = 0;       // 0 = normal framing, 1 = full focus shot
    this.focusTime = 0;        // seconds into the current focus shot (drives the swing)
    this.focusSide = 1;        // which way the swing starts
    this._focusAt = new THREE.Vector3();
    this._eff = new THREE.Vector3();
    this.updateBasis();
    this.place(1);
  }

  updateBasis() {
    // ground-plane basis for camera-relative controls
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  shake(a) { this.shakeAmt = Math.min(1, this.shakeAmt + a); }

  // Start (or keep) the focus shot on `fighter`, or let it ease out with null.
  setFocus(fighter) {
    if (fighter && !this.focusTarget && this.focusBlend < 0.05) {
      this.focusTime = 0;
      this.focusSide = Math.random() < 0.5 ? -1 : 1;
      this._focusAt.set(fighter.pos.x, 1.15 + fighter.pos.y * 0.5, fighter.pos.z);
    }
    this.focusTarget = fighter || null;
  }

  frame(fighters, dt) {
    const alive = fighters.filter((f) => f.alive);
    let set = alive.length ? alive : fighters;
    const me = this.follow;
    if (me && me.alive) set = set.filter((f) => f === me || Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z) < 14);
    if (!set.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const f of set) {
      minX = Math.min(minX, f.pos.x); maxX = Math.max(maxX, f.pos.x);
      minZ = Math.min(minZ, f.pos.z); maxZ = Math.max(maxZ, f.pos.z);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const spread = Math.max(maxX - minX, (maxZ - minZ) * 1.35);
    const aspect = this.camera.aspect;
    const want = THREE.MathUtils.clamp(7.5 + spread * (aspect < 1 ? 1.9 : 1.05), 9.5, this.maxDistance);
    const k = 1 - Math.exp(-dt * 3);
    this._target.set(cx, 1.0, cz + 1.2);
    this.focus.lerp(this._target, k);
    this.distance += (want - this.distance) * (1 - Math.exp(-dt * 2));
  }

  update(dt, fighters) {
    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.08;
      this.yaw = this.orbitAngle;
      this.pitch = 0.42;
      this.focus.lerp(new THREE.Vector3(0, 1.5, 0), 1 - Math.exp(-dt * 2));
      this.distance += (27 - this.distance) * (1 - Math.exp(-dt * 1.5));
    } else if (this.mode === 'winner' && this.winner) {
      this.orbitAngle += dt * 0.35;
      const w = this.winner.pos;
      this.focus.lerp(new THREE.Vector3(w.x, 1.2, w.z), 1 - Math.exp(-dt * 4));
      this.distance += (5.5 - this.distance) * (1 - Math.exp(-dt * 2.5));
      this.pitch += (0.3 - this.pitch) * (1 - Math.exp(-dt * 2));
      this.yaw = this.orbitAngle;
    } else if (this.mode === 'fight') {
      this.frame(fighters, dt);
      this.pitch += (0.78 - this.pitch) * (1 - Math.exp(-dt * 3));
      // settle back to the fixed fight yaw (shortest way round)
      let dy = (0 - this.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * (1 - Math.exp(-dt * 4));
    }
    this.updateFocus(dt);
    this.updateBasis();
    this.place(dt);
  }

  updateFocus(dt) {
    const f = this.focusTarget;
    const on = this.mode === 'fight' && !!f && f.alive;
    if (this.mode !== 'fight') { this.focusBlend = 0; this.focusTarget = null; return; }
    // ease in a little faster than out, smoothstepped in place()
    this.focusBlend = THREE.MathUtils.clamp(this.focusBlend + dt * (on ? 0.9 : -0.7), 0, 1);
    if (this.focusBlend > 0) this.focusTime += dt;
    if (on) {
      const k = 1 - Math.exp(-dt * 6);
      this._focusAt.x += (f.pos.x - this._focusAt.x) * k;
      this._focusAt.z += (f.pos.z - this._focusAt.z) * k;
      this._focusAt.y += (1.15 + f.pos.y * 0.5 - this._focusAt.y) * k;
    }
  }

  place(dt) {
    // blend the normal framing toward the focus shot: close, low, swinging to either side of the fighter
    const b0 = this.mode === 'fight' ? this.focusBlend : 0, b = b0 * b0 * (3 - 2 * b0);
    let focus = this.focus, distance = this.distance, pitch = this.pitch, yaw = this.yaw;
    if (b > 0) {
      const swing = this.focusSide * Math.sin(this.focusTime * 0.5) * 1.05; // up to about 60 degrees each way
      focus = this._eff.copy(this.focus).lerp(this._focusAt, b);
      distance += (6.4 - distance) * b;
      pitch += (0.32 - pitch) * b;
      yaw += swing * b;
    }
    const fov = this.baseFov - 6 * b;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const off = new THREE.Vector3(Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp).multiplyScalar(distance);
    this.camera.position.copy(focus).add(off);
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * this.shakeAmt * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
    this.camera.lookAt(focus);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
