// Power-ups: a glowing gem floats over each pad on the arena floor. Walk through it to take it;
// the pad then stays empty for a while before something new appears. The host (or local game)
// owns the state; online clients only mirror which gem sits on which pad.
// Weapons and guns float over their pad as the real thing; spell tomes and armor show as a gem.
import * as THREE from 'three';
import { POWERUPS, POWERUP_IDS } from './config.js';
import { buildGear } from './items.js';

const gemGeo = new THREE.OctahedronGeometry(0.32, 0);
const padGeo = new THREE.RingGeometry(0.55, 0.75, 28).rotateX(-Math.PI / 2);
const RESPAWN = [9, 16];   // seconds a pad stays empty
const FIRST = [3, 7];      // first spawn after the round starts
const TOTAL_SHARE = POWERUP_IDS.reduce((n, id) => n + POWERUPS[id].share, 0);

function pickType() {
  let r = Math.random() * TOTAL_SHARE;
  for (const id of POWERUP_IDS) { r -= POWERUPS[id].share; if (r <= 0) return id; }
  return POWERUP_IDS[0];
}

export class Pickups {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.pads = [];
    this.enabled = false;
  }

  // Lays out pads for the current battleground (rebuilt when the map changes).
  setPads(list) {
    for (const p of this.pads) { this.group.remove(p.gem, p.ring, p.show); p.gem.material.dispose(); p.glow.material.dispose(); p.ring.material.dispose(); }
    this.pads = list.map(({ x, z }) => {
      const ring = new THREE.Mesh(padGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.set(x, 0.04, z);
      const gem = new THREE.Mesh(gemGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.3 }));
      gem.position.set(x, 1.0, z);
      const glow = this.world.effects.makeGlow(0xffffff, 1.6);
      gem.add(glow);
      gem.visible = false;
      const show = new THREE.Group();
      show.position.set(x, 1.0, z);
      this.group.add(ring, gem, show);
      return { x, z, type: null, timer: 0, gem, glow, ring, show, models: {} };
    });
  }

  // New round: every pad starts empty and fills after a few seconds.
  reset(enabled) {
    this.enabled = enabled;
    this.group.visible = enabled;
    for (const p of this.pads) { this.setType(p, null); p.timer = FIRST[0] + Math.random() * (FIRST[1] - FIRST[0]); }
  }

  setType(p, type) {
    p.type = type;
    const model = type ? POWERUPS[type].weapon || (POWERUPS[type].item?.startsWith('gun_') ? POWERUPS[type].item.slice(4) : null) : null;
    for (const [k, m] of Object.entries(p.models)) m.visible = k === model;
    if (model && !p.models[model]) {
      const m = buildGear(model);
      // stand it upright, a little larger than in the hand, so it reads from the camera
      if (POWERUPS[type].weapon) m.position.y = -0.45; else m.rotation.set(0, 0, 0);
      m.scale.setScalar(POWERUPS[type].weapon ? 1.15 : 1.6);
      p.show.add(m);
      p.models[model] = m;
    }
    p.gem.visible = !!type;
    p.gem.scale.setScalar(model ? 0.45 : 1);
    if (!type) { p.ring.material.opacity = 0.12; return; }
    const c = POWERUPS[type].color;
    p.gem.material.color.setHex(c);
    p.gem.material.emissive.setHex(c);
    p.glow.material.color.setHex(c);
    p.ring.material.color.setHex(c);
    p.ring.material.opacity = 0.45;
  }

  // Simulation side (local games and the online host).
  update(dt, world) {
    if (!this.enabled) return;
    for (const p of this.pads) {
      if (!p.type) {
        if (world.phase !== 'fight') continue;
        p.timer -= dt;
        if (p.timer <= 0) { this.setType(p, pickType()); world.effects.ring(p.x, 0.2, p.z, POWERUPS[p.type].color, 1.4, 0.5); }
        continue;
      }
      for (const f of world.fighters) {
        if (!f.alive || f.pos.y > 1.2) continue;
        if (Math.hypot(f.pos.x - p.x, f.pos.z - p.z) > 0.75 + f.radius) continue;
        const type = p.type;
        applyPowerup(f, type, world);
        world.effects.ring(p.x, 0.6, p.z, POWERUPS[type].color, 2, 0.5);
        world.effects.sparks(p.x, 1.1, p.z, POWERUPS[type].color, 24, 4);
        world.events.emit('pickup', { fighter: f, type });
        this.setType(p, null);
        p.timer = RESPAWN[0] + Math.random() * (RESPAWN[1] - RESPAWN[0]);
        break;
      }
    }
  }

  // Online clients: [typeIndex or -1] per pad from the host's snapshot.
  applyState(list) {
    if (!Array.isArray(list)) return;
    if (!this.enabled) { this.enabled = true; this.group.visible = true; }
    this.pads.forEach((p, i) => {
      const t = POWERUP_IDS[list[i]] || null;
      if (t !== p.type) this.setType(p, t);
    });
  }

  state() { return this.pads.map((p) => (p.type ? POWERUP_IDS.indexOf(p.type) : -1)); }

  // Spin and bob the gems (both sides).
  animate(time) {
    if (!this.group.visible) return;
    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i];
      if (!p.gem.visible) continue;
      p.gem.rotation.y = time * 2.2 + i;
      p.gem.position.y = 1.0 + Math.sin(time * 3 + i) * 0.15;
      p.show.rotation.y = time * 1.6 + i;
      p.show.position.y = 1.05 + Math.sin(time * 3 + i) * 0.15;
    }
  }

  // Nearest pad holding a power-up, for CPU fighters ({ pad, d } or null). `want` filters by type.
  nearest(x, z, maxD, want = null) {
    let best = null;
    for (const p of this.pads) {
      if (!p.type || (want && !want.includes(p.type))) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < maxD && (!best || d < best.d)) best = { pad: p, d };
    }
    return best;
  }
}

export function applyPowerup(f, type, world) {
  switch (type) {
    case 'heal': f.healLeft = Math.max(f.healLeft, f.maxHp * 0.4); f.healRate = f.healLeft / 2; break;
    case 'shield': f.shield = Math.max(f.shield, f.maxHp * 0.35); f.shieldTime = 14; f.model.shell.material.color.setHex(POWERUPS.shield.color); break;
    case 'rage': f.power = Math.max(f.power, 10); break;
    case 'haste': f.haste = Math.max(f.haste, 10); f.stamina = 100; f.exhausted = false; break;
    case 'mana': f.energy = 100; break;
    case 'cloak': f.vanish = Math.max(f.vanish, 5); world.effects.puff(f.pos.x, f.pos.z, POWERUPS.cloak.color); break;
    case 'vamp': f.lifesteal = Math.max(f.lifesteal, 10); break;
    default: {
      const pu = POWERUPS[type];
      if (pu?.weapon) f.equipWeapon(pu.weapon);
      else if (pu?.armor) f.wearArmor();
      else if (pu?.item) f.addItem(pu.item);
    }
  }
  f.updateBuffVisuals();
}
