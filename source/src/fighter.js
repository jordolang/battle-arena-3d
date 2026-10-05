// Fighter simulation: state machine, movement, attacks and taking hits.
import * as THREE from 'three';
import { MOVES, SPECIALS, SKILLS, BASE_SPEED, GRAVITY, ENERGY_MAX, SPECIAL_COST, GUARD_MAX, PLAYER_COLORS,
  STAMINA, STAMINA_MAX, DODGE } from './config.js';
import { buildFighterModel, computePose, applyPose, applyTeamOutfit } from './fighterModel.js';
import { executeSpecial, executeSkill } from './specials.js';

const FREE_STATES = new Set(['idle']);
const TAU = Math.PI * 2;

export function angleTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); }
export function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
// Teammates never hurt or target each other. Fighters without a team (free-for-all) have team -1.
export function allies(a, b) { return !!a && !!b && a !== b && a.team >= 0 && a.team === b.team; }

let nextId = 1;

export class Fighter {
  constructor(def, slot, controller) {
    this.id = nextId++;
    this.def = def;
    this.slot = slot;
    this.controller = controller;
    this.name = def.name;
    this.model = buildFighterModel(def);
    this.radius = 0.42 * def.scale;
    this.maxHp = def.health;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.stats = { kos: 0, damage: 0, wins: 0 };
    this.team = -1;
    this.teamName = '';
    this.teamColor = null;
    this.skillIds = def.skills || [];
    const shieldSkill = this.skillIds.map((id) => SKILLS[id]).find((sk) => sk?.type === 'shield');
    if (shieldSkill) this.model.shell.material.color.setHex(shieldSkill.color);
    this.reset(new THREE.Vector3(), 0);
  }

  // Team outfit: gi dyed in the team colour, team pauldrons and a team-coloured floor ring.
  setTeam(index, name, color) {
    this.team = index;
    this.teamName = name;
    this.teamColor = color;
    applyTeamOutfit(this.model, color);
  }

  get isHuman() { return !!this.controller?.isHuman; }
  // Online matches name each fighter after the person playing it (netName/netColor).
  get label() { return this.netName || (this.isHuman ? `P${this.controller.playerIndex + 1}` : 'CPU'); }
  get labelColor() { return this.netColor || (this.isHuman ? PLAYER_COLORS[this.controller.playerIndex] : ''); }
  get isPlayer() { return !!this.netName || this.isHuman; }

  reset(pos, facing) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.hp = this.maxHp;
    this.displayHp = this.maxHp;
    this.energy = 20;
    this.guard = GUARD_MAX;
    this.alive = true;
    this.grounded = true;
    this.state = 'idle';
    this.stateTime = 0;
    this.stateDuration = 0;
    this.animTime = Math.random() * 10;
    this.runPhase = 0;
    this.moveAmount = 0;
    this.move = null;
    this.moveName = null;
    this.attackSide = 1;
    this.attackPhase = 0;
    this.hitSet = new Set();
    this.buffer = null;
    this.hitstop = 0;
    this.invuln = 0;
    this.poison = 0;
    this.poisonBy = null;
    this.armor = 0;
    this.lastAttacker = null;
    this.lastHitTime = -10;
    this.specialPhase = 0;
    this.specialDone = false;
    this.airAttackUsed = false;
    this.fallAngle = 0;
    this.guardRegenDelay = 0;
    this.stamina = STAMINA_MAX;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.sprinting = false;
    this.cooldowns = [0, 0, 0];
    this.skill = null;
    this.skillId = null;
    this.skillIdx = -1;
    this.shield = 0;
    this.shieldTime = 0;
    this.haste = 0;
    this.power = 0;
    this.lifesteal = 0;
    this.vanish = 0;
    this.slow = 0;
    this.healLeft = 0;
    this.healRate = 0;
    this.poisonColor = 0x9dff3a;
    this.intent = { mx: 0, mz: 0, block: false };
    this.model.root.position.copy(pos);
    this.model.root.rotation.y = facing;
    this.model.body.rotation.set(0, 0, 0);
    this.model.body.position.y = 0;
    this.model.ice.visible = false;
    this.model.aura.visible = false;
    this.model.shell.visible = false;
    this.model.body.visible = true;
    this.model.ring.visible = true;
    this.model.root.visible = true;
  }

  setState(state, duration = 0) {
    this.state = state;
    this.stateTime = 0;
    this.stateDuration = duration;
  }

  forward() { return { x: Math.sin(this.facing), z: Math.cos(this.facing) }; }

  // Nearest living enemy within `range` and roughly in front of `dirAngle`.
  findTarget(world, range, maxAngle, dirAngle = this.facing) {
    let best = null, bestScore = Infinity;
    for (const o of world.fighters) {
      if (o === this || !o.alive || allies(this, o) || o.vanish > 0) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const da = Math.abs(wrapAngle(Math.atan2(dx, dz) - dirAngle));
      if (da > maxAngle) continue;
      const score = d + da * 1.2;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  faceToward(target) {
    if (target) this.facing = angleTo(this.pos.x, this.pos.z, target.pos.x, target.pos.z);
  }

  canAct() { return this.alive && FREE_STATES.has(this.state); }

  update(dt, world) {
    if (!this.alive && this.state !== 'ko') return;
    this.animTime += dt;

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.syncVisual(0);
      return;
    }
    this.stateTime += dt;
    if (this.invuln > 0) this.invuln -= dt;

    if (this.alive) {
      this.updateStatus(dt, world);
      this.readInput(world);
    }

    switch (this.state) {
      case 'idle': this.tickFree(dt, world); break;
      case 'attack': this.tickAttack(dt, world); break;
      case 'special': this.tickSpecial(dt, world); break;
      case 'block': this.tickBlock(dt, world); break;
      case 'dodge': this.tickDodge(dt, world); break;
      case 'skill': this.tickSkill(dt, world); break;
      case 'blockstun': case 'hitstun': case 'guardbreak': case 'frozen':
        if (this.stateTime >= this.stateDuration) {
          if (this.state === 'frozen') this.model.ice.visible = false;
          this.setState(this.intent.block && this.state !== 'guardbreak' ? 'block' : 'idle');
        }
        break;
      case 'knockdown':
        if (this.stateTime >= this.stateDuration && this.grounded) this.setState('getup', 0.45);
        break;
      case 'getup':
        if (this.stateTime >= this.stateDuration) { this.setState('idle'); this.invuln = 0.45; }
        break;
      case 'victory': break;
      case 'ko': break;
    }

    this.integrate(dt, world);
    this.syncVisual(dt);
  }

  updateStatus(dt, world) {
    // passive meters
    this.energy = Math.min(ENERGY_MAX, this.energy + dt * 3.2);
    if (this.state !== 'block' && this.state !== 'blockstun') {
      this.guardRegenDelay -= dt;
      if (this.guardRegenDelay <= 0) this.guard = Math.min(GUARD_MAX, this.guard + dt * 22);
    }
    // stamina: sprinting drains it, everything else pauses the refill for a moment
    if (this.sprinting) this.spendStamina(STAMINA.sprint * dt, world);
    else if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else {
      const blocking = this.state === 'block' || this.state === 'blockstun';
      const rate = (blocking ? STAMINA.regenBlocking : STAMINA.regen) * (this.haste > 0 ? 2 : 1);
      this.stamina = Math.min(STAMINA_MAX, this.stamina + rate * dt);
    }
    if (this.exhausted && this.stamina >= STAMINA.recoverAt) this.exhausted = false;
    for (let i = 0; i < this.cooldowns.length; i++) if (this.cooldowns[i] > 0) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    // timed effects
    if (this.armor > 0) this.armor -= dt;
    if (this.power > 0) this.power -= dt;
    if (this.lifesteal > 0) this.lifesteal -= dt;
    if (this.vanish > 0) this.vanish -= dt;
    if (this.slow > 0) {
      this.slow -= dt;
      if (Math.random() < dt * 8) world.effects.sparks(this.pos.x, 0.5, this.pos.z, 0x9fe8ff, 1, 1);
    }
    if (this.haste > 0) {
      this.haste -= dt;
      if (Math.random() < dt * 14) world.effects.trail(this.pos.x, 0.25, this.pos.z, 0xc6ff4a);
    }
    if (this.shieldTime > 0) {
      this.shieldTime -= dt;
      if (this.shieldTime <= 0) this.shield = 0;
    }
    if (this.healLeft > 0) {
      const h = Math.min(this.healLeft, this.healRate * dt);
      this.healLeft -= h;
      this.hp = Math.min(this.maxHp, this.hp + h);
      if (Math.random() < dt * 10) world.effects.sparks(this.pos.x, 1.0, this.pos.z, 0xffd27a, 2, 2);
    }
    this.updateBuffVisuals();
    if (this.poison > 0) {
      const tick = Math.min(this.poison, dt);
      this.poison -= tick;
      this.applyDamage(tick * 2.4, this.poisonBy, world, true);
      if (Math.random() < dt * 12) world.effects.sparks(this.pos.x, 1.2, this.pos.z, this.poisonColor, 2, 1.5);
    }
    // fire ring (sudden death)
    if (world.ringRadius < 30) {
      const d = Math.hypot(this.pos.x, this.pos.z);
      if (d > world.ringRadius) {
        this.applyDamage(dt * 9, null, world, true);
        if (Math.random() < dt * 20) world.effects.sparks(this.pos.x, 0.6, this.pos.z, 0xff7a2a, 3, 3);
      }
    }
  }

  // Aura, shield shell and vanish flicker follow the timed effects. Online clients call this too.
  updateBuffVisuals() {
    const m = this.model;
    m.aura.visible = this.alive && (this.armor > 0 || this.power > 0 || this.lifesteal > 0);
    if (m.aura.visible) m.aura.material.opacity = 0.14 + Math.sin(this.animTime * 14) * 0.06;
    m.shell.visible = this.alive && this.shield > 0;
    if (m.shell.visible) m.shell.material.opacity = 0.16 + Math.sin(this.animTime * 6) * 0.05;
    m.body.visible = !(this.vanish > 0) || Math.sin(this.animTime * 40) > 0.85;
  }

  // Damage multiplier for everything this fighter deals.
  dmgMult() {
    return this.def.power * (this.armor > 0 ? 1.25 : 1) * (this.power > 0 ? 1.3 : 1) * (this.exhausted ? STAMINA.exhaustedDamage : 1);
  }

  spendStamina(n, world) {
    this.stamina -= n;
    this.staminaDelay = STAMINA.delay;
    if (this.stamina <= 0) {
      this.stamina = 0;
      this.sprinting = false;
      if (!this.exhausted) {
        this.exhausted = true;
        world.events.emit('exhausted', { fighter: this });
      }
    }
  }

  readInput(world) {
    const intent = this.controller ? this.controller.getIntent(this, world) : null;
    if (!intent || world.locked) { this.intent = { mx: 0, mz: 0, block: false }; this.buffer = null; this.sprinting = false; return; }
    this.intent = intent;
    for (const a of ['dash', 'special', 'skill1', 'skill2', 'skill3', 'punch', 'kick', 'jump']) {
      if (intent[a]) { this.buffer = { action: a, time: world.time }; break; }
    }
    if (this.buffer && world.time - this.buffer.time > 0.22) this.buffer = null;
  }

  consumeBuffer() { const b = this.buffer; this.buffer = null; return b?.action; }

  tickFree(dt, world) {
    const it = this.intent;
    const action = this.buffer?.action;
    if (action === 'dash' && this.grounded) { this.consumeBuffer(); if (this.startDodge(world)) return; }
    if (it.block && this.grounded) { this.setState('block'); return; }
    if (action) {
      if (action === 'jump') {
        this.consumeBuffer();
        if (this.grounded) {
          this.vel.y = 9.2; this.grounded = false; this.airAttackUsed = false;
          this.spendStamina(STAMINA.jump, world);
          world.events.emit('jump', { fighter: this });
        }
      } else if (action === 'skill1' || action === 'skill2' || action === 'skill3') {
        if (this.grounded) { this.consumeBuffer(); if (this.startSkill(+action.slice(5) - 1, world)) return; }
      } else if (action === 'punch' || action === 'kick') {
        if (this.grounded) { this.consumeBuffer(); this.startAttack(action === 'punch' ? 'jab1' : 'kick1', world); return; }
        if (!this.airAttackUsed && this.pos.y > 0.4) { this.consumeBuffer(); this.airAttackUsed = true; this.startAttack('airkick', world); return; }
      } else if (action === 'special') {
        this.consumeBuffer();
        if (this.energy >= SPECIAL_COST && this.grounded) { this.startSpecial(world); return; }
        world.events.emit('specialFail', { fighter: this });
      }
    }
    // movement and facing; holding dash while moving sprints
    const len = Math.hypot(it.mx, it.mz);
    this.sprinting = !!it.dashHeld && len > 0.1 && this.grounded && !this.exhausted && this.stamina > 0;
    if (len > 0.1) {
      const want = Math.atan2(it.mx, it.mz);
      this.facing += wrapAngle(want - this.facing) * Math.min(1, dt * 14);
    }
  }

  startAttack(name, world) {
    const move = MOVES[name];
    this.move = move;
    this.moveName = name;
    this.sprinting = false;
    this.setState('attack');
    this.spendStamina(move.stamina || 0, world);
    this.hitSet.clear();
    this.attackSide = name === 'jab1' || name === 'kick1' || name === 'hook' ? 1 : name === 'jab2' || name === 'kick2' ? -1 : 1;
    // soft lock-on toward whoever is closest in front (or in the input direction)
    const it = this.intent;
    const moving = Math.hypot(it.mx, it.mz) > 0.1;
    const dir = moving ? Math.atan2(it.mx, it.mz) : this.facing;
    const target = this.findTarget(world, 3.6, 1.9, dir) || this.findTarget(world, 2.2, Math.PI, dir);
    if (target) this.faceToward(target); else if (moving) this.facing = dir;
    world.events.emit('swing', { fighter: this, move: name, heavy: !!move.heavy, kind: move.kind });
  }

  tickAttack(dt, world) {
    const m = this.move;
    const t = this.stateTime;
    const activeEnd = m.startup + m.active;
    if (m.air) {
      // dive kick: active until landing
      if (t < m.startup) this.attackPhase = t / m.startup;
      else if (!this.grounded) {
        this.attackPhase = 1 + Math.min(1, (t - m.startup) / 0.08);
        const f = this.forward();
        this.vel.x = f.x * 7; this.vel.z = f.z * 7;
        if (this.vel.y > -6) this.vel.y -= dt * 30;
        this.checkHits(world);
      } else {
        if (!this.landTime) this.landTime = t;
        this.attackPhase = 2 + Math.min(1, (t - this.landTime) / m.recovery);
        if (t - this.landTime >= m.recovery) { this.landTime = 0; this.setState('idle'); }
      }
      return;
    }
    if (t < m.startup) {
      this.attackPhase = t / m.startup;
    } else if (t < activeEnd) {
      this.attackPhase = 1 + (t - m.startup) / m.active;
      this.checkHits(world);
    } else {
      this.attackPhase = 2 + Math.min(1, (t - activeEnd) / m.recovery);
    }
    // lunge forward through windup and strike
    if (t < activeEnd && m.lunge) {
      const f = this.forward();
      const k = m.lunge * (1 - t / activeEnd);
      this.vel.x = f.x * k; this.vel.z = f.z * k;
    }
    // chaining into the next hit
    const b = this.buffer?.action;
    if (b && (b === 'punch' || b === 'kick') && t > m.startup + m.active * 0.5 && m.chain[b]) {
      this.consumeBuffer();
      this.startAttack(m.chain[b], world);
      return;
    }
    if (t >= activeEnd + m.recovery) this.setState('idle');
  }

  checkHits(world) {
    const m = this.move;
    const power = this.dmgMult();
    for (const o of world.fighters) {
      if (o === this || !o.alive || this.hitSet.has(o.id) || allies(this, o)) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > m.range * this.def.scale + o.radius) continue;
      if (Math.abs(o.pos.y - this.pos.y) > 1.3) continue;
      const da = Math.abs(wrapAngle(Math.atan2(dx, dz) - this.facing));
      if (da > m.arc / 2 && d > o.radius * 1.6) continue;
      this.hitSet.add(o.id);
      const nx = d > 1e-3 ? dx / d : Math.sin(this.facing), nz = d > 1e-3 ? dz / d : Math.cos(this.facing);
      const res = o.receiveHit(this, {
        damage: m.damage * power, knock: m.knock, hitstun: m.hitstun, knockdown: !!m.knockdown,
        heavy: !!m.heavy, dx: nx, dz: nz, kind: m.kind, move: this.moveName,
      }, world);
      if (res !== 'ignored') this.hitstop = Math.max(this.hitstop, m.heavy ? 0.09 : 0.05);
    }
  }

  startSpecial(world) {
    this.energy -= SPECIAL_COST;
    this.sprinting = false;
    this.setState('special');
    this.specialPhase = 0;
    this.specialDone = false;
    const target = this.findTarget(world, 14, 1.2) || this.findTarget(world, 14, Math.PI);
    if (target && this.def.special !== 'venom') this.faceToward(target);
    else if (target) this.faceToward(target);
    world.events.emit('specialStart', { fighter: this, special: this.def.special });
  }

  tickSpecial(dt, world) {
    const sp = SPECIALS[this.def.special];
    const t = this.stateTime;
    if (t < sp.startup) {
      this.specialPhase = t / sp.startup;
      if (this.def.special === 'slam') {
        // hop up during the windup
        if (this.grounded && t > sp.startup * 0.25) { this.vel.y = 8.5; this.grounded = false; }
      }
    } else {
      if (!this.specialDone) {
        this.specialDone = true;
        executeSpecial(this, world);
      }
      this.specialPhase = 1 + Math.min(1, (t - sp.startup) / sp.recovery);
      if (t >= sp.startup + sp.recovery && (this.grounded || this.def.special !== 'slam')) this.setState('idle');
    }
  }

  // Tap dash: a quick roll with a moment of invulnerability, in the held direction (backwards if none).
  startDodge(world) {
    if (this.exhausted) { world.events.emit('dodgeFail', { fighter: this }); return false; }
    const it = this.intent;
    const len = Math.hypot(it.mx, it.mz);
    const f = this.forward();
    const dx = len > 0.1 ? it.mx / len : -f.x, dz = len > 0.1 ? it.mz / len : -f.z;
    this.dodgeDir = { x: dx, z: dz };
    this.sprinting = false;
    this.spendStamina(STAMINA.dodge, world);
    this.setState('dodge', DODGE.duration);
    this.invuln = Math.max(this.invuln, DODGE.invuln);
    world.effects.dust(this.pos.x, this.pos.z, 0.6);
    world.events.emit('dodge', { fighter: this });
    return true;
  }

  tickDodge(dt, world) {
    const k = 1 - this.stateTime / this.stateDuration;
    const sp = DODGE.speed * (0.35 + 0.65 * k);
    this.vel.x = this.dodgeDir.x * sp; this.vel.z = this.dodgeDir.z * sp;
    if (this.stateTime >= this.stateDuration) this.setState(this.intent.block ? 'block' : 'idle');
  }

  // Skills cost mana (the blue bar) and go on cooldown.
  startSkill(idx, world) {
    const id = this.skillIds[idx];
    const sk = SKILLS[id];
    if (!sk) return false;
    if (this.cooldowns[idx] > 0 || this.energy < sk.cost) {
      world.events.emit('skillFail', { fighter: this, skill: id, reason: this.cooldowns[idx] > 0 ? 'cooldown' : 'mana' });
      return false;
    }
    this.energy -= sk.cost;
    this.cooldowns[idx] = sk.cooldown;
    this.skill = sk;
    this.skillId = id;
    this.skillIdx = idx;
    this.sprinting = false;
    this.setState('skill');
    this.specialPhase = 0;
    this.specialDone = false;
    if (sk.type === 'bolt' || sk.type === 'wave' || sk.type === 'leap' || sk.type === 'beam') {
      const it = this.intent;
      const moving = Math.hypot(it.mx, it.mz) > 0.1;
      const dir = moving ? Math.atan2(it.mx, it.mz) : this.facing;
      const target = this.findTarget(world, 14, 1.2, dir) || this.findTarget(world, 14, Math.PI, dir);
      if (target) this.faceToward(target); else if (moving) this.facing = dir;
    }
    world.events.emit('skillStart', { fighter: this, skill: id, slot: idx });
    return true;
  }

  tickSkill(dt, world) {
    const sk = this.skill;
    const t = this.stateTime;
    if (t < sk.startup) {
      this.specialPhase = t / sk.startup;
      return;
    }
    if (!this.specialDone) {
      this.specialDone = true;
      executeSkill(this, this.skillId, world);
    }
    this.specialPhase = 1 + Math.min(1, (t - sk.startup) / sk.recovery);
    if (t >= sk.startup + sk.recovery) this.setState('idle');
  }

  tickBlock(dt, world) {
    if (this.buffer?.action === 'dash') { this.consumeBuffer(); if (this.startDodge(world)) return; }
    if (!this.intent.block) { this.setState('idle'); return; }
    const threat = this.findTarget(world, 5, Math.PI);
    if (threat) {
      const want = angleTo(this.pos.x, this.pos.z, threat.pos.x, threat.pos.z);
      this.facing += wrapAngle(want - this.facing) * Math.min(1, dt * 10);
    }
    this.guardRegenDelay = 0.6;
  }

  // Returns 'hit', 'block' or 'ignored'.
  receiveHit(src, h, world) {
    if (!this.alive || this.invuln > 0 || this.vanish > 0) return 'ignored';
    if (allies(src, this)) return 'ignored';
    if (this.state === 'knockdown' || this.state === 'getup') return 'ignored';
    const blocking = (this.state === 'block' || this.state === 'blockstun') && !h.unblockable;
    const toSrcX = -h.dx, toSrcZ = -h.dz;
    const f = this.forward();
    const facingSrc = f.x * toSrcX + f.z * toSrcZ > 0.2;
    this.lastAttacker = src;
    this.lastHitTime = world.time;

    if (blocking && facingSrc) {
      const chip = h.damage * 0.12;
      this.guard -= h.damage * 2.6 * (this.exhausted ? 1.5 : 1);
      this.spendStamina(h.damage * STAMINA.blockPerDamage, world);
      this.guardRegenDelay = 0.8;
      this.vel.x = h.dx * h.knock * 0.45; this.vel.z = h.dz * h.knock * 0.45;
      this.applyDamage(chip, src, world, true);
      if (src) src.energy = Math.min(ENERGY_MAX, src.energy + h.damage * 0.4);
      this.energy = Math.min(ENERGY_MAX, this.energy + h.damage * 0.5);
      if (this.guard <= 0 && this.alive) {
        this.guard = 0;
        this.setState('guardbreak', 1.1);
        world.events.emit('guardBreak', { fighter: this, by: src });
        world.effects.ring(this.pos.x, 1.0, this.pos.z, 0xffffff, 2.2);
      } else if (this.alive) {
        this.setState('blockstun', 0.16);
        world.events.emit('block', { fighter: this, by: src, damage: h.damage, heavy: h.heavy });
        world.effects.sparks(this.pos.x - h.dx * 0.35, 1.3, this.pos.z - h.dz * 0.35, 0xbfe6ff, 10, 4);
      }
      this.hitstop = 0.05;
      return 'block';
    }

    let dmg = h.damage;
    const armored = this.armor > 0 || this.shield > 0;
    if (this.armor > 0) dmg *= 0.6;
    if (this.shield > 0) {
      // the barrier soaks damage first and stops the flinch while it holds
      const soak = Math.min(this.shield, dmg);
      this.shield -= soak;
      dmg -= soak;
      world.effects.sparks(this.pos.x - h.dx * 0.5, 1.2, this.pos.z - h.dz * 0.5, this.model.shell.material.color.getHex(), 8, 4);
      if (this.shield <= 0) { this.shield = 0; this.shieldTime = 0; world.events.emit('shieldBreak', { fighter: this }); }
    }
    this.applyDamage(dmg, src, world, false);
    if (src && src !== this) {
      src.energy = Math.min(ENERGY_MAX, src.energy + dmg * 1.1);
      src.stats.damage += dmg;
      const steal = (src.lifesteal > 0 ? 0.5 : 0) + (h.drain || 0);
      if (steal > 0 && src.alive && dmg > 0) {
        src.hp = Math.min(src.maxHp, src.hp + dmg * steal);
        world.effects.sparks(src.pos.x, 1.3, src.pos.z, 0xff4a5a, 6, 2);
      }
    }
    this.energy = Math.min(ENERGY_MAX, this.energy + dmg * 0.7);
    this.hitstop = h.heavy ? 0.09 : 0.05;
    const px = this.pos.x - h.dx * 0.25, pz = this.pos.z - h.dz * 0.25;
    world.effects.impact(px, h.kind === 'kick' ? 1.1 : 1.35, pz, h.heavy ? 1.6 : 1, h.color);
    world.events.emit('hit', { fighter: this, by: src, damage: dmg, heavy: !!h.heavy, kind: h.kind, move: h.move, ko: !this.alive });
    if (h.heavy) world.shake(h.knockdown ? 0.35 : 0.22);

    if (h.poison) { this.poison = Math.max(this.poison, h.poison); this.poisonBy = src; this.poisonColor = h.poisonColor || 0x9dff3a; }
    if (h.slow) this.slow = Math.max(this.slow, h.slow);
    if (!this.alive) {
      this.vel.x = h.dx * (h.knock + 4); this.vel.z = h.dz * (h.knock + 4); this.vel.y = 5; this.grounded = false;
      return 'hit';
    }
    if (armored && !h.freeze && !h.pull) {
      this.vel.x += h.dx * h.knock * 0.2; this.vel.z += h.dz * h.knock * 0.2;
      return 'hit';
    }
    if (h.stun && !h.knockdown) {
      this.vel.x = h.dx * h.knock; this.vel.z = h.dz * h.knock;
      this.setState('hitstun', h.stun);
      world.effects.sparks(this.pos.x, 1.7, this.pos.z, 0xfff27a, 10, 3);
      return 'hit';
    }
    if (h.freeze) {
      this.setState('frozen', h.freeze);
      this.model.ice.visible = true;
      this.vel.set(h.dx * 1.5, this.vel.y, h.dz * 1.5);
      return 'hit';
    }
    if (h.pull) {
      this.vel.set(h.dx * h.knock, 2.5, h.dz * h.knock);
      this.grounded = false;
      this.setState('hitstun', h.hitstun);
      return 'hit';
    }
    this.vel.x = h.dx * h.knock; this.vel.z = h.dz * h.knock;
    if (h.knockdown) {
      this.facing = Math.atan2(-h.dx, -h.dz); // fall away from the hit
      this.vel.y = 4.5; this.grounded = false;
      this.setState('knockdown', 0.9);
    } else {
      this.setState('hitstun', h.hitstun);
    }
    return 'hit';
  }

  applyDamage(amount, src, world, quiet) {
    if (!this.alive || amount <= 0) return;
    // once a round is decided nothing (fire ring, poison, a stray projectile) can hurt the survivors
    if (world.phase === 'roundOver' || world.phase === 'matchOver') return;
    this.hp -= amount;
    if (src && src !== this && quiet) src.stats.damage += amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.model.ice.visible = false;
      this.model.aura.visible = false;
      this.armor = 0; this.poison = 0; this.shield = 0; this.power = 0; this.lifesteal = 0; this.vanish = 0; this.haste = 0; this.slow = 0; this.healLeft = 0;
      this.sprinting = false;
      this.updateBuffVisuals();
      const killer = src && src !== this ? src : (this.lastAttacker && world.time - this.lastHitTime < 6 ? this.lastAttacker : null);
      if (killer) killer.stats.kos++;
      this.facing = src ? angleTo(this.pos.x, this.pos.z, src.pos.x, src.pos.z) : this.facing;
      this.setState('ko');
      world.events.emit('ko', { fighter: this, by: killer });
      world.onKO?.(this, killer);
    }
  }

  integrate(dt, world) {
    const free = this.state === 'idle' && this.alive;
    const it = this.intent;
    const speed = BASE_SPEED * this.def.speed * this.speedMult();
    if (free) {
      const tx = it.mx * speed, tz = it.mz * speed;
      const a = Math.min(1, dt * (this.grounded ? 16 : 3.5));
      this.vel.x += (tx - this.vel.x) * a;
      this.vel.z += (tz - this.vel.z) * a;
    } else if (this.state === 'block') {
      const tx = it.mx * 1.3, tz = it.mz * 1.3;
      const a = Math.min(1, dt * 12);
      this.vel.x += (tx - this.vel.x) * a;
      this.vel.z += (tz - this.vel.z) * a;
    } else if (this.state === 'dodge') {
      // velocity is set by tickDodge
    } else if (this.state !== 'attack' || this.stateTime > this.move.startup + this.move.active) {
      if (this.grounded) {
        const fr = Math.exp(-dt * (this.state === 'frozen' ? 2.5 : 7));
        this.vel.x *= fr; this.vel.z *= fr;
      }
    }
    // gravity
    if (!this.grounded || this.vel.y > 0) {
      this.vel.y -= GRAVITY * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        const impact = this.vel.y;
        this.vel.y = 0;
        if (!this.grounded) {
          this.grounded = true;
          world.events.emit('land', { fighter: this, impact, down: this.state === 'knockdown' || this.state === 'ko' });
          if (this.state === 'knockdown' || this.state === 'ko') {
            world.effects.dust(this.pos.x, this.pos.z, 1.4);
          }
        }
      } else {
        this.grounded = false;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // locomotion animation params
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const base = BASE_SPEED * this.def.speed;
    this.moveAmount += ((free && this.grounded ? Math.min(1, hs / base) : 0) - this.moveAmount) * Math.min(1, dt * 10);
    if (this.sprinting && this.grounded && Math.random() < dt * 8) world.effects.dust(this.pos.x, this.pos.z, 0.35);
    this.runPhase += dt * (4 + hs * 1.7);
  }

  speedMult() {
    return (this.sprinting ? STAMINA.sprintSpeed : 1) * (this.haste > 0 ? 1.35 : 1) * (this.slow > 0 ? 0.6 : 1) * (this.exhausted ? STAMINA.exhaustedSpeed : 1);
  }

  syncVisual(dt) {
    const m = this.model;
    m.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    m.root.rotation.y = this.facing;
    // whole-body fall for knockdowns and KOs
    let fall = 0;
    if (this.state === 'knockdown' || this.state === 'ko') fall = Math.min(1, this.stateTime / 0.32);
    else if (this.state === 'getup') fall = 1 - Math.min(1, this.stateTime / this.stateDuration);
    const ang = -Math.PI / 2 * (fall * fall * (3 - 2 * fall));
    m.body.rotation.x = ang;
    m.body.position.y = 0.16 * fall;
    if (this.state === 'frozen' || this.hitstop > 0 && this.state !== 'attack') { if (dt === 0) return; }
    if (this.state !== 'frozen' && dt > 0) {
      const sharp = this.state === 'attack' || this.state === 'hitstun' || this.state === 'special' || this.state === 'skill' || this.state === 'dodge';
      applyPose(m, computePose(this), dt, sharp);
    }
    // ring fades out when KO'd
    if (this.state === 'ko') {
      m.ring.material.opacity = Math.max(0, 0.75 - this.stateTime);
      m.ring.visible = m.ring.material.opacity > 0.01;
    } else {
      m.ring.material.opacity = this.invuln > 0 ? 0.3 + 0.4 * Math.abs(Math.sin(this.animTime * 20)) : 0.75;
    }
  }
}
