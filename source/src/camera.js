// Shared camera that keeps every living fighter in frame. Its yaw is fixed
// during a fight so "up" on the keyboard always means the same direction.
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
    this.updateBasis();
    this.place(1);
  }

  updateBasis() {
    // ground-plane basis for camera-relative controls
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  shake(a) { this.shakeAmt = Math.min(1, this.shakeAmt + a); }

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
    } else {
      this.frame(fighters, dt);
      this.pitch += (0.78 - this.pitch) * (1 - Math.exp(-dt * 3));
      // settle back to the fixed fight yaw (shortest way round)
      let dy = (0 - this.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * (1 - Math.exp(-dt * 4));
    }
    this.updateBasis();
    this.place(dt);
  }

  place(dt) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const off = new THREE.Vector3(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).multiplyScalar(this.distance);
    this.camera.position.copy(this.focus).add(off);
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * this.shakeAmt * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    }
    this.camera.lookAt(this.focus);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
