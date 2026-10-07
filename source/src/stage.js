// Shared base for the hazard arenas (Sky Bridge, Foundry, Eye of the Storm).
// Same interface as Arena and Badlands (collide, blocksProjectile, avoid, spawnPoints, pads, zones, fire ring),
// plus the hazard hooks the game, fighters and CPU fighters call:
//   hazards(dt, game)   host/offline only: applies hazard damage during a fight
//   danger(x, z, game)  a direction to flee in when standing somewhere about to hurt, or null
//   floorAt(x, z, game) ground height under a point (-Infinity over a hole), Sky Bridge only
// Every hazard is a pure function of the round number and the fight clock (game.round, game.fightTime),
// so online clients and replays draw exactly what the host simulates without any extra network traffic.
import * as THREE from 'three';

export function seeded(seed) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export const FLAME_VERT = 'varying vec2 vUv; uniform float time; void main(){ vUv = uv; vec3 p = position; float k = uv.y; p.x += sin(time*9.0 + p.y*6.0) * 0.06 * k; p.z += cos(time*7.0 + p.y*5.0) * 0.06 * k; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }';
export const FLAME_FRAG = 'varying vec2 vUv; uniform float time; void main(){ float k = 1.0 - vUv.y; float flick = 0.75 + 0.25*sin(time*23.0 + vUv.x*30.0); vec3 c = mix(vec3(1.0,0.25,0.02), vec3(1.0,0.85,0.4), k*k); float a = smoothstep(0.0,0.6,k) * (1.0 - smoothstep(0.8,1.0,k)) * flick * 0.55; gl_FragColor = vec4(c * a, a); }';

export class Stage {
  constructor(scene, name, radius) {
    this.scene = scene;
    this.name = name;
    this.radius = radius;
    this.camDistance = 36;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.time = 0;
    this.excitement = 0;
    this.lights = [];
    this.pillars = [];
    this.segments = [];
    this.zones = [];
    this.pads = [];
    this.uniforms = [];        // shader time uniforms ticked in update
    this.lastRound = -1;
    this.told = new Set();     // hazard warnings already shown this round
  }

  // Hazard clock: seconds of fighting in the current round (0 during the intro).
  clock(game) { return game?.fightTime || 0; }

  addSky(fragment, radius = 210) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: fragment,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
    this.uniforms.push(mat.uniforms.time);
    this.group.add(this.sky);
  }

  // Main shadow-casting light. this.moon is what the quality toggle and auto quality switch off.
  addSun(color, intensity, pos, quality, extent) {
    const sun = new THREE.DirectionalLight(color, intensity);
    sun.position.set(...pos);
    sun.castShadow = quality !== 'low';
    const sm = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 120 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    this.group.add(sun);
    this.moon = sun;
    return sun;
  }

  addFlicker(color, intensity, distance, x, y, z) {
    const L = new THREE.PointLight(color, intensity, distance, 1.6);
    L.position.set(x, y, z);
    this.group.add(L);
    this.lights.push({ light: L, base: intensity, seed: Math.random() * 10 });
    return L;
  }

  flameMaterial() {
    if (!this.flameMat) {
      this.flameMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { time: { value: 0 } }, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      });
      this.uniforms.push(this.flameMat.uniforms.time);
    }
    return this.flameMat;
  }

  // Drifting particles (embers, ash, rain) as one Points draw.
  addParticles(count, spread, height, color, rise, additive = true) {
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * height; pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const c = new THREE.Color(color);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute float seed; uniform float time; varying float vA;
        void main(){ vec3 p = position; float t = time * (0.3 + seed * 0.5) + seed * 40.0;
          p.y = mod(p.y + t * ${rise.toFixed(2)}, ${height.toFixed(1)}); p.x += sin(t * 1.3 + seed * 9.0) * 0.8; p.z += cos(t * 1.1 + seed * 7.0) * 0.8;
          vA = (1.0 - p.y / ${height.toFixed(1)}) * (0.5 + 0.5 * sin(time * 6.0 + seed * 50.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (2.0 + seed * 3.0) * 30.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * vA; gl_FragColor = vec4(vec3(${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}) * ${additive ? 'a' : '1.0'}, a); }`,
    });
    this.uniforms.push(mat.uniforms.time);
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    return pts;
  }

  // Standing stones / columns: collision circles plus their meshes.
  addPillar(x, z, r, mesh) {
    this.pillars.push({ x, z, r });
    if (mesh) { mesh.position.x += x; mesh.position.z += z; this.group.add(mesh); }
  }

  // The sudden-death ring of fire, same look as the coliseum's.
  buildFireRing() {
    const geo = new THREE.CylinderGeometry(1, 1, 2.2, 128, 1, true);
    this.fireMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, intensity: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float intensity;
        float n(vec2 p){ return sin(p.x*1.0+time*3.0)*0.5 + sin(p.x*2.3 - time*4.7)*0.3 + sin(p.x*5.1 + time*7.3)*0.2; }
        void main(){
          float x = vUv.x * 120.0;
          float h = 0.45 + 0.35 * n(vec2(x, 0.0));
          float a = smoothstep(h, h - 0.35, vUv.y) * intensity;
          vec3 c = mix(vec3(1.0,0.2,0.02), vec3(1.0,0.8,0.3), smoothstep(0.4, 0.0, vUv.y));
          gl_FragColor = vec4(c * a * 1.6, a);
        }`,
    });
    this.uniforms.push(this.fireMat.uniforms.time);
    this.fireRing = new THREE.Mesh(geo, this.fireMat);
    this.fireRing.position.y = 1.1;
    this.fireRing.visible = false;
    this.group.add(this.fireRing);
    this.fireGlow = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.0, 128).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fireGlow.position.y = 0.04;
    this.fireGlow.visible = false;
    this.group.add(this.fireGlow);
  }

  setFireRing(radius) {
    const on = radius < 90;
    this.fireRing.visible = on; this.fireGlow.visible = on;
    if (!on) return;
    this.fireRing.scale.set(radius, 1, radius);
    this.fireGlow.scale.set(radius, 1, radius);
    this.fireMat.uniforms.intensity.value = Math.min(1, this.fireMat.uniforms.intensity.value + 0.02);
  }

  resetFireRing() { this.fireMat.uniforms.intensity.value = 0; this.setFireRing(99); }

  show(on) {
    this.group.visible = on;
    if (on) { this.scene.background = this.background; this.scene.fog = this.fog; }
  }

  // Starting spots: a ring around the centre, teammates side by side.
  spawnPoints(list) {
    const n = list.length;
    const spawnR = n <= 2 ? 4 : n <= 4 ? 6 : 7.5;
    const offset = Math.PI / 2 + (n === 2 ? 0 : Math.PI / n);
    return list.map((f, i) => {
      const a = offset + (i / n) * Math.PI * 2;
      const x = Math.cos(a) * spawnR, z = Math.sin(a) * spawnR;
      return { x, z, facing: Math.atan2(-x, -z) };
    });
  }

  // Inside the playable area? Circle by default; the bridge overrides.
  bound(x, z, r) {
    const d = Math.hypot(x, z), max = this.radius - r;
    if (d > max) return { x: (x * max) / d, z: (z * max) / d, hit: true };
    return null;
  }

  collide(x, z, r) {
    let hitWall = false;
    const b = this.bound(x, z, r);
    if (b) { x = b.x; z = b.z; hitWall = true; }
    for (const p of this.pillars) {
      const dx = x - p.x, dz = z - p.z, dd = Math.hypot(dx, dz), min = p.r + r;
      if (dd < min && dd > 1e-4) { x = p.x + (dx / dd) * min; z = p.z + (dz / dd) * min; hitWall = true; }
    }
    return { x, z, hitWall };
  }

  blocksProjectile(x, z) {
    if (this.bound(x, z, 0)) return true;
    for (const p of this.pillars) if (Math.hypot(x - p.x, z - p.z) < p.r) return true;
    return false;
  }

  // Steering push for CPU fighters: away from pillars and from any hazard the arena reports (hazardSpots).
  avoid(x, z, strafe, game) {
    let mx = 0, mz = 0;
    const push = (px, pz, pd, reach, k0) => {
      if (pd >= reach || pd < 1e-3) return;
      const k = ((reach - pd) / reach + 0.4) * k0;
      mx += (px / pd) * k + (-pz / pd) * strafe * k; mz += (pz / pd) * k + (px / pd) * strafe * k;
    };
    for (const p of this.pillars) { const px = x - p.x, pz = z - p.z; push(px, pz, Math.hypot(px, pz), p.r + 1.6, 0.8); }
    if (game) for (const h of this.hazardSpots(game, x, z)) { const px = x - h.x, pz = z - h.z; push(px, pz, Math.hypot(px, pz), h.r + 1.4, 1.6); }
    return { x: mx, z: mz };
  }

  hazardSpots() { return []; }
  danger() { return null; }

  // Called from the game tick during a fight; arenas put their damage in tickHazards.
  hazards(dt, game) {
    this.sync(game);
    this.tickHazards(dt, game);
  }

  tickHazards() {}

  // A new round rebuilds the hazard schedule (seeded by the round number) and re-arms the warnings.
  sync(game) {
    const round = game?.round ?? 0;
    if (round === this.lastRound) return;
    this.lastRound = round;
    this.told.clear();
    this.newRound(round);
  }

  // Host-side hazard damage. `label` names the hazard in the kill feed when it finishes someone off.
  hurt(f, game, amount, label) {
    f.diedTo = label;
    f.applyDamage(amount, null, game, true);
    f.diedTo = null;
  }

  // Throws a fighter off their feet, away from (x, z).
  launch(f, x, z, up, out) {
    if (!f.alive || f.invuln > 0) return;
    const dx = f.pos.x - x, dz = f.pos.z - z, d = Math.hypot(dx, dz) || 1;
    f.vel.x = (dx / d) * out; f.vel.z = (dz / d) * out; f.vel.y = up;
    f.grounded = false;
    f.facing = Math.atan2(-dx / d, -dz / d);
    f.setState('knockdown', 0.9);
  }

  // One line in the kill feed the first time a hazard wakes up each round (host/offline only).
  tell(game, key, html) {
    if (this.told.has(key) || game.mode !== 'match') return;
    this.told.add(key);
    game.hud.feed(html);
  }

  update(dt, game) {
    this.time += dt;
    for (const u of this.uniforms) u.value = this.time;
    this.excitement = Math.max(0, this.excitement - dt * 0.35);
    for (const l of this.lights) l.light.intensity = l.base * (0.82 + 0.12 * Math.sin(this.time * 13 + l.seed) + 0.06 * Math.sin(this.time * 31 + l.seed * 3));
    this.sync(game);
    this.animate(dt, game, this.clock(game));
  }

  newRound() {}
  animate() {}
}
