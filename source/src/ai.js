// CPU opponents. Each AI reads the same world state a player sees and
// produces the same intent a keyboard would, so it can be swapped for a
// network-driven controller later without touching fighter code.
import { DIFFICULTY, SPECIAL_COST, SKILLS, COMBAT } from './config.js';
import { wrapAngle, allies } from './fighter.js';

const PREFERRED_SPECIAL_RANGE = {
  fireball: [3, 12], spear: [3, 9.5], frost: [1, 4.2], slam: [0, 3.2], venom: [2, 7],
  storm: [2, 12], shadow: [3, 11], ironwill: [0, 2.6],
};

export class AIController {
  constructor(difficulty = 'normal') {
    this.isHuman = false;
    this.p = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.target = null;
    this.targetUntil = 0;
    this.nextThink = 0;
    this.plan = 'approach';
    this.planUntil = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.blockUntil = 0;
    this.comboLeft = 0;
    this.pressQueue = [];
    this.bias = new Map();
    this.wantMove = { x: 0, z: 0 };
    this.sprint = false;
    this.flank = Math.random() < 0.3 + this.p.combo * 0.4; // some CPUs like to circle behind
  }

  pickTarget(me, world) {
    let best = null, bestScore = Infinity;
    for (const o of world.fighters) {
      if (o === me || !o.alive || allies(me, o) || o.vanish > 0) continue;
      if (!this.bias.has(o.id)) this.bias.set(o.id, Math.random() * 4);
      const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
      let score = d + this.bias.get(o.id) + (o.hp / o.maxHp) * 3;
      if (o === me.lastAttacker && world.time - me.lastHitTime < 3) score -= 5;
      // avoid everyone piling onto the same victim
      let crowd = 0;
      for (const f of world.fighters) if (f !== me && f.alive && f.controller?.target === o) crowd++;
      score += crowd * 2.2;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  getIntent(me, world) {
    const now = world.time;
    this._now = now;
    const intent = { mx: 0, mz: 0, block: false, punch: false, kick: false, special: false, jump: false };

    // queued button presses from an earlier decision
    if (this.pressQueue.length && this.pressQueue[0].at <= now) {
      const p = this.pressQueue.shift();
      intent[p.action] = true;
    }

    if (now >= this.nextThink) {
      this.nextThink = now + this.p.reaction * (0.7 + Math.random() * 0.6);
      this.think(me, world);
    }
    intent.block = now < this.blockUntil;
    intent.mx = this.wantMove.x;
    intent.mz = this.wantMove.z;
    intent.dashHeld = this.sprint && !intent.block;
    return intent;
  }

  think(me, world) {
    const now = world.time;
    if (!this.target || !this.target.alive || now > this.targetUntil) {
      this.target = this.pickTarget(me, world);
      this.targetUntil = now + 2.5 + Math.random() * 3;
    }
    const T = this.target;
    this.wantMove = { x: 0, z: 0 };
    this.sprint = false;
    if (!T) return;

    const dx = T.pos.x - me.pos.x, dz = T.pos.z - me.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;

    // 1) escape the fire ring
    const myR = Math.hypot(me.pos.x, me.pos.z);
    if (world.ringRadius < 90 && myR > world.ringRadius - 1.6) {
      const l = myR || 1;
      this.wantMove = { x: -me.pos.x / l, z: -me.pos.z / l };
      return;
    }

    // 1b) team play: revive a downed teammate, grab power-ups, heal at a spring
    if (this.support(me, world, dist)) return;

    // 2) defend against an incoming attack or projectile
    const threat = this.findThreat(me, world);
    if (threat && Math.random() < this.p.block) {
      if (!me.exhausted && me.stamina > 35 && Math.random() < 0.3 * this.p.accuracy) {
        // roll out of the way
        this.wantMove = { x: -threat.dz * this.strafe, z: threat.dx * this.strafe };
        this.press('dash', 0);
        return;
      }
      if (threat.type === 'projectile' && Math.random() < 0.45) {
        // sidestep instead of blocking
        this.wantMove = { x: -threat.dz * this.strafe, z: threat.dx * this.strafe };
        return;
      }
      if (threat.type === 'melee' && Math.random() < 0.15 * this.p.accuracy) {
        this.press('jump', 0);
      } else {
        this.blockUntil = now + 0.3 + Math.random() * 0.35;
        return;
      }
    }

    // only act when free
    if (!me.canAct() && me.state !== 'block') return;
    if (now < this.blockUntil) return;

    // 3) special when it makes sense
    const sp = me.def.special;
    if (me.energy >= SPECIAL_COST && Math.random() < this.p.special * 0.55) {
      const [lo, hi] = PREFERRED_SPECIAL_RANGE[sp];
      let ok = dist >= lo && dist <= hi;
      if (sp === 'slam' || sp === 'ironwill') {
        let near = 0;
        for (const o of world.fighters) if (o !== me && o.alive && !allies(me, o) && Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) < 3.4) near++;
        ok = near >= 2 || (near >= 1 && Math.random() < 0.5);
      }
      if (ok && (sp === 'fireball' || sp === 'spear') && this.lineBlocked(me, T, world)) ok = false;
      if (ok && world.friendlyFire && (sp === 'slam' || sp === 'frost' || sp === 'ironwill') && this.allyNear(me, world, 4.4, sp === 'frost' ? 0.7 : Math.PI)) ok = false;
      if (ok) {
        // aim then fire
        this.wantMove = { x: nx * 0.01, z: nz * 0.01 };
        me.facing = Math.atan2(nx, nz) + (Math.random() - 0.5) * (1 - this.p.accuracy) * 0.6;
        this.press('special', 0);
        return;
      }
    }

    // 3b) skills
    if (Math.random() < this.p.special * 0.5 && this.trySkill(me, T, dist, nx, nz, world)) return;

    const lowHp = me.hp / me.maxHp < 0.25;
    const reach = 1.55 * me.def.scale + T.radius;

    // out of breath: back off and let stamina recover
    if (me.exhausted && now >= this.planUntil && Math.random() < 0.6) {
      this.plan = 'retreat'; this.planUntil = now + 1.0 + Math.random() * 0.8;
      return;
    }

    // 4) back off sometimes when hurt, or after a combo
    if (now < this.planUntil && this.plan === 'retreat') {
      this.wantMove = { x: -nx * 0.7 + -nz * this.strafe * 0.7, z: -nz * 0.7 + nx * this.strafe * 0.7 };
      return;
    }
    if (lowHp && Math.random() < 0.25 * (1.2 - this.p.aggression)) {
      this.plan = 'retreat'; this.planUntil = now + 0.8 + Math.random();
      return;
    }

    // 5) close in or attack
    if (dist > reach * 0.95) {
      // approach with some circling; separate from other fighters
      let mx = nx, mz = nz;
      // flank: when the target is busy with someone else, circle round to its back for a backstab
      const busy = T.controller?.target && T.controller.target !== me;
      if (dist < 9 && (busy || T.state === 'attack' || T.state === 'block') && this.flank) {
        const tf = T.forward();
        const bx = T.pos.x - tf.x * 1.4 - me.pos.x, bz = T.pos.z - tf.z * 1.4 - me.pos.z, bl = Math.hypot(bx, bz) || 1;
        mx = bx / bl; mz = bz / bl;
      }
      if (dist < 5) { mx += -nz * this.strafe * 0.45; mz += nx * this.strafe * 0.45; }
      for (const o of world.fighters) {
        if (o === me || o === T || !o.alive) continue;
        const ox = me.pos.x - o.pos.x, oz = me.pos.z - o.pos.z, od = Math.hypot(ox, oz);
        if (od < 2.2 && od > 0.01) { mx += (ox / od) * (2.2 - od) * 0.6; mz += (oz / od) * (2.2 - od) * 0.6; }
      }
      // steer round pillars, boulders and walls
      const av = world.arena.avoid(me.pos.x, me.pos.z, this.strafe);
      mx += av.x; mz += av.z;
      const l = Math.hypot(mx, mz) || 1;
      const hesitate = Math.random() > this.p.aggression ? 0.35 : 1;
      this.wantMove = { x: (mx / l) * hesitate, z: (mz / l) * hesitate };
      this.sprint = dist > 7 && hesitate === 1 && !me.exhausted && me.stamina > 45;
      if (Math.random() < 0.04) this.strafe *= -1;
      // occasional jump-in kick
      if (dist < 4 && dist > 2.6 && Math.random() < 0.05 * this.p.aggression) {
        this.press('jump', 0); this.press('kick', 0.22);
      }
      return;
    }

    // in range: face and attack (careful not to swing through a teammate when friendly fire is on)
    me.facing += wrapAngle(Math.atan2(nx, nz) - me.facing) * 0.8;
    if (world.friendlyFire && this.allyNear(me, world, reach + 0.6, 0.9, Math.atan2(nx, nz)) && Math.random() < this.p.accuracy) {
      this.wantMove = { x: -nz * this.strafe, z: nx * this.strafe };
      return;
    }
    if (Math.random() < this.p.aggression) {
      const r = Math.random();
      if (r < 0.55) {
        const hits = Math.random() < this.p.combo ? 3 : 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < hits; i++) this.press('punch', i * 0.2);
        if (hits === 3 && Math.random() < this.p.combo * 0.3) { /* hook ends it */ }
        else if (Math.random() < this.p.combo * 0.5) this.press('kick', hits * 0.2);
      } else if (r < 0.85) {
        this.press('kick', 0);
        if (Math.random() < this.p.combo) this.press('kick', 0.32);
      } else {
        this.blockUntil = now + 0.4;
      }
      this.nextThink = now + 0.55 + this.p.reaction;
      if (Math.random() < 0.3) { this.plan = 'retreat'; this.planUntil = now + 0.9 + 0.4 * Math.random(); }
    } else {
      this.wantMove = { x: -nz * this.strafe, z: nx * this.strafe };
    }
  }

  // Pick one of this fighter's three skills when the situation suits it. Returns true if cast.
  trySkill(me, T, dist, nx, nz, world) {
    let near = 0;
    for (const o of world.fighters) if (o !== me && o.alive && !allies(me, o) && Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) < 3.6) near++;
    const hurt = me.hp / me.maxHp;
    const start = Math.floor(Math.random() * 3);
    for (let k = 0; k < me.skillIds.length; k++) {
      const i = (start + k) % me.skillIds.length;
      const sk = SKILLS[me.skillIds[i]];
      if (!sk || me.cooldowns[i] > 0 || me.energy < sk.cost) continue;
      let ok = false;
      switch (sk.type) {
        case 'bolt': ok = dist > 2.5 && dist < sk.speed * sk.life * 0.9 && !this.lineBlocked(me, T, world); break;
        case 'nova': ok = (near >= 2 || (near >= 1 && dist < sk.radius * 0.8)) && !(world.friendlyFire && this.allyNear(me, world, sk.radius + 0.5, Math.PI)); break;
        case 'wave': ok = dist < sk.length * 0.85 && !(world.friendlyFire && this.allyNear(me, world, sk.length, sk.arc + 0.2, Math.atan2(nx, nz))); break;
        case 'leap': ok = dist > 3 && dist < sk.range; break;
        case 'beam': ok = dist > 2 && dist < sk.length * 0.9 && !this.lineBlocked(me, T, world); break;
        case 'smite': ok = dist > 2.5 && dist < sk.range * 0.95; break;
        case 'heal': ok = hurt < 0.55 && me.healLeft <= 0; break;
        case 'shield': ok = near >= 1 && me.shield <= 0; break;
        case 'buff':
          if (sk.buff === 'haste') ok = dist > 6 || hurt < 0.3;
          else if (sk.buff === 'vanish') ok = hurt < 0.4 && near >= 1;
          else ok = dist < 4 || (sk.stamina && me.exhausted);
          break;
      }
      if (!ok) continue;
      if (sk.type === 'bolt' || sk.type === 'wave' || sk.type === 'leap' || sk.type === 'beam') {
        this.wantMove = { x: nx * 0.01, z: nz * 0.01 };
        me.facing = Math.atan2(nx, nz) + (Math.random() - 0.5) * (1 - this.p.accuracy) * 0.6;
      }
      this.press('skill' + (i + 1), 0);
      return true;
    }
    return false;
  }

  // Living teammate within `range`, inside `arc` radians of `dir` (default: facing).
  allyNear(me, world, range, arc, dir = me.facing) {
    for (const o of world.fighters) {
      if (o === me || !o.alive || !allies(me, o)) continue;
      const dx = o.pos.x - me.pos.x, dz = o.pos.z - me.pos.z, d = Math.hypot(dx, dz);
      if (d > range + o.radius) continue;
      if (arc >= Math.PI || Math.abs(wrapAngle(Math.atan2(dx, dz) - dir)) < arc) return true;
    }
    return false;
  }

  nearestEnemy(me, world) {
    let best = Infinity;
    for (const o of world.fighters) {
      if (o === me || !o.alive || allies(me, o)) continue;
      best = Math.min(best, Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z));
    }
    return best;
  }

  moveTo(x, z, me, world, sprint) {
    let mx = x - me.pos.x, mz = z - me.pos.z;
    const l = Math.hypot(mx, mz) || 1;
    mx /= l; mz /= l;
    const av = world.arena.avoid(me.pos.x, me.pos.z, this.strafe);
    mx += av.x; mz += av.z;
    const l2 = Math.hypot(mx, mz) || 1;
    this.wantMove = { x: mx / l2, z: mz / l2 };
    this.sprint = sprint && !me.exhausted && me.stamina > 40;
  }

  // Team-minded choices that come before fighting. Returns true when one was taken.
  support(me, world, distT) {
    if (!me.canAct() && me.state !== 'block') return false;
    const hurt = me.hp / me.maxHp;
    const enemy = this.nearestEnemy(me, world);
    // pull a downed teammate back up when nobody is right on top of us
    if (world.reviveOn && enemy > 3.2) {
      let best = null, bd = 13;
      for (const o of world.fighters) {
        if (o.alive || o.downed < 0.6 || !allies(me, o)) continue;
        const d = Math.hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        if (bd > COMBAT.reviveRange * 0.6) this.moveTo(best.pos.x, best.pos.z, me, world, bd > 5);
        else this.wantMove = { x: 0, z: 0 };
        return true;
      }
    }
    // power-ups: go out of the way for healing when hurt, grab anything close otherwise
    const pk = world.pickups;
    if (pk?.enabled) {
      const n = hurt < 0.5 ? pk.nearest(me.pos.x, me.pos.z, 15, ['heal', 'shield']) : pk.nearest(me.pos.x, me.pos.z, distT > 4 ? 6 : 2.5);
      if (n && (enemy > 2.5 || n.d < 2)) { this.moveTo(n.pad.x, n.pad.z, me, world, n.d > 5); return true; }
    }
    // healing springs: retreat to one when badly hurt and nobody is close
    if (hurt < 0.38 && world.arena.zones.length && enemy > 4.5) {
      let best = null, bd = 18;
      for (const z of world.arena.zones) { const d = Math.hypot(z.x - me.pos.x, z.z - me.pos.z); if (d < bd) { bd = d; best = z; } }
      if (best) {
        if (bd > best.r * 0.6) this.moveTo(best.x, best.z, me, world, true);
        else this.wantMove = { x: 0, z: 0 };
        return true;
      }
    }
    return false;
  }

  press(action, delay) {
    this.pressQueue.push({ action, at: this._now + delay });
  }

  findThreat(me, world) {
    for (const o of world.fighters) {
      if (o === me || !o.alive || allies(me, o)) continue;
      const dx = me.pos.x - o.pos.x, dz = me.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d > 3) continue;
      const attacking = (o.state === 'attack' && o.attackPhase < 1.6) || (o.state === 'special' && o.specialPhase < 1);
      if (!attacking) continue;
      const da = Math.abs(wrapAngle(Math.atan2(dx, dz) - o.facing));
      if (da < 0.8) return { type: 'melee', dx: dx / d, dz: dz / d };
    }
    for (const p of world.projectiles) {
      if (p.owner === me || allies(me, p.owner)) continue;
      const rx = me.pos.x - p.pos.x, rz = me.pos.z - p.pos.z, d = Math.hypot(rx, rz);
      if (d > 8) continue;
      if ((rx * p.dir.x + rz * p.dir.z) / d > 0.85) return { type: 'projectile', dx: p.dir.x, dz: p.dir.z };
    }
    return null;
  }

  lineBlocked(me, T, world) {
    for (let t = 0.1; t < 1; t += 0.1) {
      if (world.arena.blocksProjectile(me.pos.x + (T.pos.x - me.pos.x) * t, me.pos.z + (T.pos.z - me.pos.z) * t)) return true;
    }
    return false;
  }
}
