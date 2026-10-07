// The Foundry: an iron fighting pit in the heart of a forge, ringed by a moat of molten metal.
// Nine fire vents are set into the floor. Every few seconds some of them wake: the grate glows and
// hisses for a moment, then a column of flame bursts out, throwing anyone on it into the air and
// burning whoever stays. The longer a round runs, the more vents fire at once.
import * as THREE from 'three';
import { Stage, seeded } from './stage.js';

const R = 17;
const WALL_H = 1.2;
const VENT_R = 1.7;
const T0 = 6;        // first vents wake
const PERIOD = 3;    // a new set every few seconds
const WARN = 1.3;    // glow before the burst
const BURST = 1.5;   // how long the flame column stands
const VENTS = [
  ...[0, 1, 2, 3, 4, 5].map((i) => { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; return [Math.cos(a) * 8.2, Math.sin(a) * 8.2]; }),
  ...[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2; return [Math.cos(a) * 13.6, Math.sin(a) * 13.6]; }),
];
const COLUMNS = [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; return [Math.cos(a) * 11.2, Math.sin(a) * 11.2]; });

function plateTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = seeded(2024);
  g.fillStyle = '#2a2624'; g.fillRect(0, 0, size, size);
  const n = 8, w = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const l = 15 + rand() * 9;
      g.fillStyle = `hsl(${18 + rand() * 16}, ${8 + rand() * 10}%, ${l}%)`;
      g.fillRect(x * w + 3, y * w + 3, w - 6, w - 6);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      for (const [rx, ry] of [[10, 10], [w - 14, 10], [10, w - 14], [w - 14, w - 14]]) { g.beginPath(); g.arc(x * w + rx + 2, y * w + ry + 2, 4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,230,200,0.12)';
      for (const [rx, ry] of [[10, 10], [w - 14, 10], [10, w - 14], [w - 14, w - 14]]) { g.beginPath(); g.arc(x * w + rx, y * w + ry, 3, 0, Math.PI * 2); g.fill(); }
    }
  }
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = rand() > 0.6 ? 'rgba(120,50,20,0.12)' : 'rgba(0,0,0,0.2)';
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 3, 1 + rand() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Thin seams of molten metal between some plates.
function seamTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const rand = seeded(55);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    let x = rand() * size, y = rand() * size;
    g.lineWidth = 1 + rand() * 3;
    g.globalAlpha = 0.4 + rand() * 0.6;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (rand() - 0.5) * 90; y += (rand() - 0.5) * 90; g.lineTo(x, y); }
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

const VENT_FRAG = `varying vec2 vUv; uniform float time; uniform float heat;
  void main(){
    float k = vUv.y;
    float n = sin(vUv.x * 40.0 + time * 14.0 - k * 9.0) * 0.5 + sin(vUv.x * 17.0 - time * 9.0 + k * 5.0) * 0.5;
    float a = (1.0 - k) * (0.65 + 0.35 * n) * smoothstep(1.0, 0.75, k) * heat;
    vec3 c = mix(vec3(1.0,0.85,0.45), vec3(1.0,0.22,0.02), k);
    gl_FragColor = vec4(c * a * 1.4, a);
  }`;

export class Foundry extends Stage {
  constructor(scene, quality) {
    super(scene, 'foundry', R);
    this.background = new THREE.Color(0x120806);
    this.fog = new THREE.FogExp2(0x1a0a06, 0.016);
    this.pads = [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2; return { x: Math.cos(a) * 4.6, z: Math.sin(a) * 4.6 }; });
    this.vents = VENTS.map(([x, z]) => ({ x, z, r: VENT_R }));

    this.buildSky();
    this.buildLights(quality);
    this.buildFloor();
    this.buildWall();
    this.buildColumns();
    this.buildVents();
    this.buildMoat();
    this.addParticles(300, 30, 14, 0xff6a1c, 1);
    this.buildFireRing();
    this.newRound(0);
  }

  buildSky() {
    this.addSky(`
      varying vec3 vDir; uniform float time;
      void main(){
        float h = vDir.y;
        vec3 col = mix(vec3(0.32,0.08,0.02), vec3(0.06,0.02,0.02), smoothstep(-0.05, 0.35, h));
        col = mix(col, vec3(0.01,0.0,0.0), smoothstep(0.35, 0.9, h));
        float smoke = sin(vDir.x * 9.0 + time * 0.08) * sin(vDir.z * 7.0 - time * 0.06) * 0.5 + 0.5;
        col *= 0.75 + 0.25 * smoke;
        gl_FragColor = vec4(col, 1.0);
      }`);
  }

  buildLights(quality) {
    this.group.add(new THREE.HemisphereLight(0xc07050, 0x200805, 0.75));
    this.addSun(0xffb080, 1.8, [-10, 26, 8], quality, 21);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
      this.addFlicker(0xff5a1a, 24, 24, Math.cos(a) * (R + 2.5), 2.4, Math.sin(a) * (R + 2.5));
    }
    // a few lights follow whichever vents are erupting (one light per vent would cost every material dearly)
    this.ventLights = [0, 1, 2].map(() => { const L = new THREE.PointLight(0xff6a1a, 0, 13, 1.7); this.group.add(L); return L; });
  }

  buildFloor() {
    this.floorMat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.6, metalness: 0.55,
      emissive: 0xff4a10, emissiveMap: seamTexture(), emissiveIntensity: 0.8 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.6, 96), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  buildWall() {
    const count = 64, Rw = R + 0.55;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.5, metalness: 0.7 });
    const segLen = (2 * Math.PI * Rw) / count;
    const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(segLen * 0.96, WALL_H, 1.0), mat, count);
    const rivet = new THREE.InstancedMesh(new THREE.BoxGeometry(segLen * 1.02, 0.18, 1.15), new THREE.MeshStandardMaterial({ color: 0x5a4a40, roughness: 0.4, metalness: 0.8 }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      q.setFromAxisAngle(up, -a + Math.PI / 2);
      p.set(Math.cos(a) * Rw, WALL_H / 2, Math.sin(a) * Rw);
      wall.setMatrixAt(i, m.compose(p, q, s));
      p.y = WALL_H + 0.09;
      rivet.setMatrixAt(i, m.compose(p, q, s));
    }
    wall.castShadow = true; wall.receiveShadow = true;
    this.group.add(wall, rivet);
    // smokestacks and chains beyond the moat
    const stackMat = new THREE.MeshStandardMaterial({ color: 0x241e1c, roughness: 0.7, metalness: 0.5 });
    const flame = this.flameMaterial();
    const flameGeo = new THREE.ConeGeometry(0.9, 2.6, 10, 1, true);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * (R + 11), z = Math.sin(a) * (R + 11);
      const h = 12 + (i % 3) * 4;
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.8, h, 10), stackMat);
      stack.position.set(x, h / 2 - 2, z);
      stack.castShadow = true;
      const f = new THREE.Mesh(flameGeo, flame);
      f.position.set(x, h - 0.6, z);
      this.group.add(stack, f);
    }
  }

  buildColumns() {
    const iron = new THREE.MeshStandardMaterial({ color: 0x4a403a, roughness: 0.45, metalness: 0.75 });
    const hot = new THREE.MeshStandardMaterial({ color: 0x200500, emissive: 0xff4a10, emissiveIntensity: 1.4 });
    this.hotMat = hot;
    for (const [x, z] of COLUMNS) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.6, 8), iron);
      base.position.y = 0.3;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 7, 8), iron);
      shaft.position.y = 3.8;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.07, 6, 24), hot);
      band.rotation.x = Math.PI / 2; band.position.y = 1.6;
      const band2 = band.clone(); band2.position.y = 3.2;
      for (const o of [base, shaft]) { o.castShadow = true; o.receiveShadow = true; }
      g.add(base, shaft, band, band2);
      this.addPillar(x, z, 0.9, g);
    }
  }

  buildVents() {
    const grateMat = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.5, metalness: 0.8 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x5a4c44, roughness: 0.4, metalness: 0.8 });
    const barGeo = new THREE.BoxGeometry(VENT_R * 1.9, 0.06, 0.16);
    const colGeo = new THREE.CylinderGeometry(VENT_R * 0.9, VENT_R * 0.75, 7, 24, 1, true);
    colGeo.translate(0, 3.5, 0);
    const bars = new THREE.InstancedMesh(barGeo, grateMat, this.vents.length * 5);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    this.group.add(bars);
    for (const v of this.vents) {
      const pit = new THREE.Mesh(new THREE.CircleGeometry(VENT_R, 32), new THREE.MeshBasicMaterial({ color: 0x0a0302 }));
      pit.rotation.x = -Math.PI / 2; pit.position.set(v.x, 0.015, v.z);
      v.glowMat = new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const glow = new THREE.Mesh(new THREE.CircleGeometry(VENT_R * 1.25, 32), v.glowMat);
      glow.rotation.x = -Math.PI / 2; glow.position.set(v.x, 0.03, v.z);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(VENT_R, 0.12, 6, 32), rimMat);
      rim.rotation.x = Math.PI / 2; rim.position.set(v.x, 0.05, v.z);
      rim.receiveShadow = true;
      this.group.add(pit, glow, rim);
      for (let b = -2; b <= 2; b++) {
        p.set(v.x, 0.06, v.z + b * VENT_R * 0.36);
        s.set(Math.sqrt(Math.max(0.05, 1 - (b * 0.36) ** 2)), 1, 1);
        bars.setMatrixAt(n++, m.compose(p, q, s));
      }
      v.colMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { time: { value: 0 }, heat: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: VENT_FRAG,
      });
      this.uniforms.push(v.colMat.uniforms.time);
      v.col = new THREE.Mesh(colGeo, v.colMat);
      v.col.position.set(v.x, 0, v.z);
      v.col.visible = false;
      this.group.add(v.col);
    }
  }

  buildMoat() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float time;
        void main(){
          float a = atan(vP.y, vP.x), r = length(vP);
          float n = sin(a * 14.0 + time * 0.6 + r * 0.8) * 0.5 + sin(a * 31.0 - time * 0.9 - r * 1.7) * 0.3 + sin(r * 3.0 - time * 1.3) * 0.2;
          vec3 col = mix(vec3(0.55,0.08,0.0), vec3(1.0,0.55,0.1), smoothstep(-0.2, 0.9, n));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.uniforms.push(mat.uniforms.time);
    const moat = new THREE.Mesh(new THREE.RingGeometry(R + 1.1, R + 7, 96, 1), mat);
    moat.rotation.x = -Math.PI / 2; moat.position.y = -0.3;
    const bank = new THREE.Mesh(new THREE.RingGeometry(R + 7, 140, 48, 1), new THREE.MeshStandardMaterial({ color: 0x1e1412, roughness: 1 }));
    bank.rotation.x = -Math.PI / 2; bank.position.y = -0.05;
    bank.receiveShadow = true;
    this.group.add(moat, bank);
  }

  newRound(round) { this.round = round; this.picks = new Map(); this.fired = new Set(); this.launched = new Set(); }

  // Which vents wake in wave w (fixed per round, so everyone sees the same eruptions).
  wave(w) {
    let p = this.picks.get(w);
    if (!p) {
      const rand = seeded((this.round + 1) * 104729 + w * 31 + 7);
      const n = Math.min(5, 2 + (w >= 8 ? 1 : 0) + (w >= 16 ? 1 : 0) + (w >= 24 ? 1 : 0));
      const order = this.vents.map((v, i) => ({ i, k: rand() })).sort((a, b) => a.k - b.k);
      p = new Set(order.slice(0, n).map((o) => o.i));
      this.picks.set(w, p);
    }
    return p;
  }

  // 'idle', or { w, phase: 'warn'|'burst', k: 0..1 } for vent i at fight time t.
  ventState(i, t) {
    if (t < T0) return null;
    const w = Math.floor((t - T0) / PERIOD), local = t - T0 - w * PERIOD;
    if (local >= WARN + BURST || !this.wave(w).has(i)) return null;
    return local < WARN ? { w, phase: 'warn', k: local / WARN } : { w, phase: 'burst', k: (local - WARN) / BURST };
  }

  hazardSpots(game) {
    const t = this.clock(game), out = [];
    this.vents.forEach((v, i) => { if (this.ventState(i, t)) out.push(v); });
    return out;
  }

  danger(x, z, game) {
    const t = this.clock(game);
    for (let i = 0; i < this.vents.length; i++) {
      const v = this.vents[i];
      const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz);
      if (d < v.r + 1 && this.ventState(i, t)) return d > 1e-3 ? { x: dx / d, z: dz / d } : { x: 1, z: 0 };
    }
    return null;
  }

  tickHazards(dt, game) {
    const t = this.clock(game);
    this.vents.forEach((v, i) => {
      const s = this.ventState(i, t);
      if (!s || s.phase !== 'burst') return;
      const key = `${s.w}:${i}`;
      if (!this.fired.has(key)) {
        this.fired.add(key);
        game.effects.ring(v.x, 0.2, v.z, 0xff7a2a, v.r * 1.5, 0.4);
        game.events.emit('hazard', { kind: 'vent', x: v.x, z: v.z });
        this.tell(game, 'vent', '<b class="fire">The vents</b> <span>are waking. Get off a grate when it glows.</span>');
        if (this.fired.size > 64) this.fired = new Set([key]);
      }
      for (const f of game.fighters) {
        if (!f.alive || Math.hypot(f.pos.x - v.x, f.pos.z - v.z) > v.r + f.radius * 0.5 || f.pos.y > 4) continue;
        const hk = `${key}:${f.slot}`;
        if (!this.launched.has(hk)) {
          this.launched.add(hk);
          if (this.launched.size > 128) this.launched = new Set([hk]);
          this.hurt(f, game, 14, 'The vents');
          this.launch(f, v.x, v.z, 8, 4.5);
          game.effects.sparks(f.pos.x, 0.8, f.pos.z, 0xffa040, 18, 6);
        } else this.hurt(f, game, dt * 12, 'The vents');
      }
    });
  }

  animate(dt, game, t) {
    this.floorMat.emissiveIntensity = 0.6 + 0.25 * Math.sin(this.time * 1.7) + this.excitement * 0.3;
    this.hotMat.emissiveIntensity = 1.2 + 0.4 * Math.sin(this.time * 2.3);
    let li = 0;
    const light = (v, intensity) => { const L = this.ventLights[li++]; if (L) { L.position.set(v.x, 2, v.z); L.intensity = intensity; } };
    this.vents.forEach((v, i) => {
      const s = this.ventState(i, t);
      if (!s) {
        v.glowMat.opacity = 0.06 + 0.03 * Math.sin(this.time * 3 + i);
        v.col.visible = false;
      } else if (s.phase === 'warn') {
        v.glowMat.opacity = 0.2 + s.k * 0.55 * (0.7 + 0.3 * Math.sin(this.time * 30));
        v.col.visible = false;
        light(v, s.k * 10);
      } else {
        const rise = Math.min(1, s.k * 6), fade = 1 - Math.max(0, (s.k - 0.75) / 0.25);
        v.glowMat.opacity = 0.9 * fade;
        v.col.visible = true;
        v.col.scale.set(0.8 + 0.2 * rise, rise * (0.9 + 0.1 * Math.sin(this.time * 25 + i)), 0.8 + 0.2 * rise);
        v.colMat.uniforms.heat.value = fade;
        light(v, 40 * fade);
      }
    });
    while (li < this.ventLights.length) this.ventLights[li++].intensity = 0;
  }
}
