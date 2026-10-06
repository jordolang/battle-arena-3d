// Special moves, projectiles and delayed hazards (lightning).
import * as THREE from 'three';
import { wrapAngle, spared } from './fighter.js';
import { SKILLS } from './config.js';

const projGeo = new THREE.SphereGeometry(0.26, 16, 12);
const tipGeo = new THREE.ConeGeometry(0.1, 0.4, 10).rotateX(Math.PI / 2);
let nextProjectileId = 1;

export class Projectile {
  constructor(world, owner, opts) {
    this.id = nextProjectileId++;
    this.owner = owner;
    this.kind = opts.kind;
    this.pos = new THREE.Vector3(opts.x, opts.y, opts.z);
    this.dir = new THREE.Vector3(opts.dx, 0, opts.dz);
    this.speed = opts.speed;
    this.life = opts.life;
    this.radius = opts.radius;
    this.hit = opts.hit;
    this.dead = false;
    this.color = opts.color;
    if (this.kind === 'spear') {
      this.mesh = new THREE.Mesh(tipGeo, new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.9, roughness: 0.3 }));
      const chainGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      this.chain = new THREE.Line(chainGeo, new THREE.LineBasicMaterial({ color: 0x8a8d94 }));
      world.scene.add(this.chain);
    } else {
      this.mesh = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: opts.color }));
      this.glow = world.effects.makeGlow(opts.glow ?? opts.color, 1.6);
      this.mesh.add(this.glow);
      this.size = opts.size ?? 1;
      this.mesh.scale.setScalar(this.size);
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = Math.atan2(opts.dx, opts.dz);
    world.scene.add(this.mesh);
  }

  update(dt, world) {
    this.life -= dt;
    this.pos.addScaledVector(this.dir, this.speed * dt);
    this.visual(dt, world);
    if (this.life <= 0 || world.arena.blocksProjectile(this.pos.x, this.pos.z)) {
      this.burst(world);
      return;
    }
    for (const f of world.fighters) {
      if (f === this.owner || !f.alive || spared(this.owner, f, world) || f.vanish > 0) continue;
      const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z;
      if (Math.hypot(dx, dz) < this.radius + f.radius && Math.abs(f.pos.y + 1 - this.pos.y) < 1.2) {
        this.hit(f, this, world);
        this.burst(world);
        return;
      }
    }
  }

  // Mesh, chain and trail only. Online clients call this with positions from the host.
  visual(dt, world) {
    this.mesh.position.copy(this.pos);
    if (this.chain) {
      const p = this.chain.geometry.attributes.position;
      const o = this.owner.model.root.position;
      p.setXYZ(0, o.x, 1.35 * this.owner.def.scale, o.z);
      p.setXYZ(1, this.pos.x, this.pos.y, this.pos.z);
      p.needsUpdate = true;
    } else {
      this.mesh.scale.setScalar((this.size ?? 1) * (1 + Math.sin(world.time * 40) * 0.08));
      if (Math.random() < dt * 60) world.effects.trail(this.pos.x, this.pos.y, this.pos.z, this.color);
    }
  }

  burst(world) {
    if (this.kind !== 'spear') world.effects.sparks(this.pos.x, this.pos.y, this.pos.z, this.color, 24, 6);
    this.dispose(world);
  }

  dispose(world) {
    this.dead = true;
    world.scene.remove(this.mesh);
    if (this.chain) { world.scene.remove(this.chain); this.chain.geometry.dispose(); this.chain.material.dispose(); }
    this.glow?.material.dispose();
    this.mesh.material.dispose();
  }
}

function hitAll(f, world, radius, cb) {
  for (const o of world.fighters) {
    if (o === f || !o.alive || spared(f, o, world)) continue;
    const dx = o.pos.x - f.pos.x, dz = o.pos.z - f.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= radius + o.radius) cb(o, d, d > 1e-3 ? dx / d : 1, d > 1e-3 ? dz / d : 0);
  }
}

export function executeSpecial(f, world) {
  const fw = f.forward();
  const pow = f.dmgMult();
  const kind = f.def.special;
  world.events.emit('special', { fighter: f, special: kind });
  const s = f.def.scale;

  switch (kind) {
    case 'fireball': {
      world.projectiles.push(new Projectile(world, f, {
        kind: 'fireball', x: f.pos.x + fw.x * 0.8, y: 1.3 * s, z: f.pos.z + fw.z * 0.8, dx: fw.x, dz: fw.z,
        speed: 17, life: 1.5, radius: 0.45, color: 0xff7a1c, glow: 0xff5a00,
        hit: (o, p, w) => o.receiveHit(f, { damage: 14 * pow, knock: 8, hitstun: 0.55, heavy: true, dx: p.dir.x, dz: p.dir.z, kind: 'fire', color: 0xff8a2a }, w),
      }));
      break;
    }
    case 'spear': {
      world.projectiles.push(new Projectile(world, f, {
        kind: 'spear', x: f.pos.x + fw.x * 0.6, y: 1.3 * s, z: f.pos.z + fw.z * 0.6, dx: fw.x, dz: fw.z,
        speed: 22, life: 0.5, radius: 0.4, color: 0xc0c4cc,
        hit: (o, p, w) => {
          // drag the victim to just in front of Kane
          const dx = f.pos.x + fw.x * 1.3 - o.pos.x, dz = f.pos.z + fw.z * 1.3 - o.pos.z;
          const d = Math.max(0.01, Math.hypot(dx, dz));
          const res = o.receiveHit(f, { damage: 8 * pow, knock: Math.min(16, d * 3.2), hitstun: 0.95, pull: true, unblockable: true, dx: dx / d, dz: dz / d, kind: 'spear', color: 0xff3030 }, w);
          if (res === 'hit') w.events.emit('spearPull', { fighter: o, by: f });
        },
      }));
      break;
    }
    case 'frost': {
      world.effects.cone(f.pos.x, 1.2 * s, f.pos.z, f.facing, 4.8, 0x9fe8ff);
      hitAll(f, world, 4.8, (o, d, nx, nz) => {
        const da = Math.abs(wrapAngle(Math.atan2(nx, nz) - f.facing));
        if (da > 0.65) return;
        o.receiveHit(f, { damage: 8 * pow, knock: 2, hitstun: 0.3, freeze: 1.5, dx: nx, dz: nz, kind: 'ice', color: 0x9fe8ff }, world);
      });
      break;
    }
    case 'slam': {
      world.effects.ring(f.pos.x, 0.1, f.pos.z, 0xffcc66, 4.5);
      world.effects.dust(f.pos.x, f.pos.z, 4);
      world.shake(0.55);
      hitAll(f, world, 4.2, (o, d, nx, nz) => {
        const fall = 1 - Math.min(1, d / 4.6) * 0.5;
        o.receiveHit(f, { damage: 15 * pow * fall, knock: 9 * fall, hitstun: 0.6, knockdown: true, heavy: true, unblockable: d < 1.6, dx: nx, dz: nz, kind: 'slam', color: 0xffcc66 }, world);
      });
      break;
    }
    case 'ironwill': {
      f.armor = 5;
      world.effects.ring(f.pos.x, 0.8, f.pos.z, 0xd0e4ff, 2.8);
      hitAll(f, world, 2.4, (o, d, nx, nz) => {
        o.receiveHit(f, { damage: 4 * pow, knock: 7, hitstun: 0.35, dx: nx, dz: nz, kind: 'shock', color: 0xd0e4ff }, world);
      });
      break;
    }
    case 'venom': {
      // dash forward, poisoning everyone along the path
      const sx = f.pos.x, sz = f.pos.z;
      let dist = 7.5;
      // stop short of walls/pillars
      for (let d = 0.5; d <= 7.5; d += 0.5) {
        if (world.arena.blocksProjectile(sx + fw.x * d, sz + fw.z * d)) { dist = Math.max(0, d - 0.8); break; }
      }
      const ex = sx + fw.x * dist, ez = sz + fw.z * dist;
      world.effects.streak(sx, sz, ex, ez, 0x9dff3a);
      for (const o of world.fighters) {
        if (o === f || !o.alive) continue;
        // distance from segment
        const vx = ex - sx, vz = ez - sz, wx = o.pos.x - sx, wz = o.pos.z - sz;
        const L = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / L));
        const px = sx + vx * t, pz = sz + vz * t;
        if (Math.hypot(o.pos.x - px, o.pos.z - pz) < 1.1 + o.radius) {
          const side = Math.sign(fw.x * (o.pos.z - pz) - fw.z * (o.pos.x - px)) || 1;
          o.receiveHit(f, { damage: 9 * pow, knock: 5, hitstun: 0.5, poison: 3, heavy: true, dx: fw.x * 0.5 - fw.z * side * 0.8, dz: fw.z * 0.5 + fw.x * side * 0.8, kind: 'venom', color: 0x9dff3a }, world);
        }
      }
      f.pos.x = ex; f.pos.z = ez;
      f.vel.set(fw.x * 3, 0, fw.z * 3);
      break;
    }
    case 'shadow': {
      const target = f.findTarget(world, 11, Math.PI);
      world.effects.puff(f.pos.x, f.pos.z, 0xb070ff);
      if (target) {
        const tf = target.forward();
        let bx = target.pos.x - tf.x * 1.1, bz = target.pos.z - tf.z * 1.1;
        if (world.arena.blocksProjectile(bx, bz)) { bx = target.pos.x + tf.x * 1.1; bz = target.pos.z + tf.z * 1.1; }
        f.pos.x = bx; f.pos.z = bz;
        f.faceToward(target);
        world.effects.puff(f.pos.x, f.pos.z, 0xb070ff);
        const d = Math.max(0.01, Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z));
        target.receiveHit(f, { damage: 12 * pow, knock: 7, hitstun: 0.7, heavy: true, dx: (target.pos.x - f.pos.x) / d, dz: (target.pos.z - f.pos.z) / d, kind: 'shadow', color: 0xc080ff }, world);
      } else {
        let dist = 5;
        for (let d = 0.5; d <= 5; d += 0.5) if (world.arena.blocksProjectile(f.pos.x + fw.x * d, f.pos.z + fw.z * d)) { dist = d - 0.8; break; }
        f.pos.x += fw.x * dist; f.pos.z += fw.z * dist;
        world.effects.puff(f.pos.x, f.pos.z, 0xb070ff);
      }
      break;
    }
    case 'storm': {
      const target = f.findTarget(world, 13, Math.PI);
      const tx = target ? target.pos.x : f.pos.x + fw.x * 5;
      const tz = target ? target.pos.z : f.pos.z + fw.z * 5;
      const marker = world.effects.telegraph(tx, tz, 1.7, 0xfff27a, 0.55);
      world.delayed.push({
        at: world.time + 0.55,
        run: (w) => {
          w.effects.lightning(tx, tz);
          w.shake(0.3);
          w.events.emit('thunder', { fighter: f, x: tx, z: tz });
          for (const o of w.fighters) {
            if (o === f || !o.alive) continue;
            const dx = o.pos.x - tx, dz = o.pos.z - tz, d = Math.hypot(dx, dz);
            if (d < 1.7 + o.radius) {
              const n = d > 1e-3 ? 1 / d : 0;
              o.receiveHit(f, { damage: 16 * pow, knock: 6, hitstun: 0.6, knockdown: true, heavy: true, unblockable: true, dx: dx * n || 1, dz: dz * n, kind: 'lightning', color: 0xfff27a }, w);
            }
          }
          marker.done = true;
        },
      });
      break;
    }
  }
}


// Skills (three per fighter, see SKILLS in config.js).
function skillHit(sk, pow, dx, dz, extra = {}) {
  return {
    damage: sk.damage * pow, knock: sk.knock ?? 4, hitstun: 0.45, heavy: sk.damage >= 10, knockdown: !!sk.knockdown,
    stun: sk.stun, slow: sk.slow, freeze: sk.freeze, unblockable: !!sk.unblockable, drain: sk.drain,
    poison: sk.poison || sk.burn || sk.bleed, poisonColor: sk.burn ? 0xff7a1c : sk.bleed ? 0xff2a2a : undefined,
    dx, dz, kind: 'skill', melee: sk.type === 'wave' || sk.type === 'leap', color: sk.color, ...extra,
  };
}

export function executeSkill(f, id, world) {
  const sk = SKILLS[id];
  if (!sk) return;
  const fw = f.forward();
  const pow = f.dmgMult();
  const s = f.def.scale;
  world.events.emit('skill', { fighter: f, skill: id });

  switch (sk.type) {
    case 'bolt': {
      const n = sk.count || 1;
      for (let i = 0; i < n; i++) {
        const a = f.facing + (i - (n - 1) / 2) * (sk.spread || 0);
        const dx = Math.sin(a), dz = Math.cos(a);
        world.projectiles.push(new Projectile(world, f, {
          kind: id, x: f.pos.x + dx * 0.8, y: 1.3 * s, z: f.pos.z + dz * 0.8, dx, dz,
          speed: sk.speed, life: sk.life, radius: 0.3 + 0.18 * (sk.size || 1), color: sk.color, glow: sk.glow, size: sk.size,
          hit: (o, p, w) => o.receiveHit(f, skillHit(sk, pow, p.dir.x, p.dir.z), w),
        }));
      }
      break;
    }
    case 'nova': {
      world.effects.ring(f.pos.x, 0.6, f.pos.z, sk.color, sk.radius);
      world.effects.sparks(f.pos.x, 1.0, f.pos.z, sk.color, 30, 7);
      world.shake(0.2);
      hitAll(f, world, sk.radius, (o, d, nx, nz) => o.receiveHit(f, skillHit(sk, pow, nx, nz, { unblockable: !!sk.unblockable || d < 1.4 }), world));
      break;
    }
    case 'wave': {
      world.effects.cone(f.pos.x, 0.5, f.pos.z, f.facing, sk.length, sk.color);
      world.effects.dust(f.pos.x + fw.x * 2, f.pos.z + fw.z * 2, 2);
      world.shake(0.3);
      hitAll(f, world, sk.length, (o, d, nx, nz) => {
        if (Math.abs(wrapAngle(Math.atan2(nx, nz) - f.facing)) > sk.arc) return;
        o.receiveHit(f, skillHit(sk, pow, nx, nz), world);
      });
      break;
    }
    case 'leap': {
      // lunge to just in front of the target (or a fixed distance), striking on arrival
      const target = f.findTarget(world, sk.range, 0.9) || f.findTarget(world, sk.range * 0.6, Math.PI);
      let dist = sk.range * 0.6;
      if (target) { f.faceToward(target); dist = Math.max(0, Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z) - 1.1); }
      const dir = f.forward();
      for (let d = 0.5; d <= dist; d += 0.5) {
        if (world.arena.blocksProjectile(f.pos.x + dir.x * d, f.pos.z + dir.z * d)) { dist = Math.max(0, d - 0.8); break; }
      }
      const sx = f.pos.x, sz = f.pos.z;
      f.pos.x += dir.x * dist; f.pos.z += dir.z * dist;
      world.effects.streak(sx, sz, f.pos.x, f.pos.z, sk.color);
      f.vel.set(dir.x * 2, 0, dir.z * 2);
      if (target && Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z) < 2.2) {
        const d = Math.max(0.01, Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z));
        target.receiveHit(f, skillHit(sk, pow, (target.pos.x - f.pos.x) / d, (target.pos.z - f.pos.z) / d), world);
      }
      break;
    }
    case 'beam': {
      // instant line from the hands, stopped by walls and pillars, piercing every foe on it
      let len = sk.length;
      for (let d = 0.5; d <= sk.length; d += 0.5) {
        if (world.arena.blocksProjectile(f.pos.x + fw.x * d, f.pos.z + fw.z * d)) { len = d; break; }
      }
      const sx = f.pos.x + fw.x * 0.6, sz = f.pos.z + fw.z * 0.6;
      const ex = f.pos.x + fw.x * len, ez = f.pos.z + fw.z * len;
      world.effects.streak(sx, sz, ex, ez, sk.color);
      world.effects.streak(sx, sz, ex, ez, sk.color);
      world.effects.sparks(ex, 1.2, ez, sk.color, 18, 5);
      for (const o of world.fighters) {
        if (o === f || !o.alive || spared(f, o, world) || o.vanish > 0) continue;
        const wx = o.pos.x - f.pos.x, wz = o.pos.z - f.pos.z;
        const t = wx * fw.x + wz * fw.z;
        if (t < 0 || t > len + o.radius) continue;
        if (Math.abs(wx * fw.z - wz * fw.x) > sk.width + o.radius) continue;
        o.receiveHit(f, skillHit(sk, pow, fw.x, fw.z), world);
      }
      break;
    }
    case 'smite': {
      // mark the nearest foe's spot, then strike it: dodge out of the circle in time to avoid it
      const target = f.findTarget(world, sk.range, Math.PI);
      const tx = target ? target.pos.x : f.pos.x + fw.x * 6;
      const tz = target ? target.pos.z : f.pos.z + fw.z * 6;
      const marker = world.effects.telegraph(tx, tz, sk.radius, sk.color, sk.delay);
      world.delayed.push({
        at: world.time + sk.delay,
        run: (w) => {
          marker.done = true;
          if (sk.fx === 'lightning') w.effects.lightning(tx, tz);
          w.effects.ring(tx, 0.1, tz, sk.color, sk.radius * 1.3, 0.4);
          w.effects.sparks(tx, sk.fx === 'meteor' ? 2.5 : 0.8, tz, sk.color, 40, 9);
          if (sk.fx === 'meteor') w.effects.dust(tx, tz, 3);
          w.shake(0.35);
          for (const o of w.fighters) {
            if (o === f || !o.alive || spared(f, o, w) || o.vanish > 0) continue;
            const dx = o.pos.x - tx, dz = o.pos.z - tz, d = Math.hypot(dx, dz);
            if (d < sk.radius + o.radius) {
              const n = d > 1e-3 ? 1 / d : 0;
              o.receiveHit(f, skillHit(sk, pow, dx * n || 1, dz * n), w);
            }
          }
        },
      });
      break;
    }
    case 'heal':
      f.healLeft = sk.heal;
      f.healRate = sk.heal / sk.duration;
      world.effects.ring(f.pos.x, 0.2, f.pos.z, sk.color, 1.8, 0.7);
      world.effects.sparks(f.pos.x, 1.2, f.pos.z, sk.color, 20, 3);
      break;
    case 'shield':
      f.shield = sk.shield;
      f.shieldTime = sk.duration;
      world.effects.ring(f.pos.x, 1.0, f.pos.z, sk.color, 1.6, 0.5);
      break;
    case 'buff':
      if (sk.buff === 'power') { f.power = sk.duration; if (sk.stamina) { f.stamina = Math.min(100, f.stamina + sk.stamina); f.exhausted = false; } world.shake(0.15); }
      if (sk.buff === 'haste') f.haste = sk.duration;
      if (sk.buff === 'lifesteal') f.lifesteal = sk.duration;
      if (sk.buff === 'vanish') { f.vanish = sk.duration; f.haste = Math.max(f.haste, sk.duration); world.effects.puff(f.pos.x, f.pos.z, sk.color); }
      world.effects.ring(f.pos.x, 0.8, f.pos.z, sk.color, 2.2, 0.5);
      break;
  }
  f.updateBuffVisuals();
}
