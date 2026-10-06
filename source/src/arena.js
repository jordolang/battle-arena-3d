// The arena: a moonlit stone coliseum with braziers, pillars, a crowd and
// the sudden-death ring of fire. Also owns static collision.
import * as THREE from 'three';
import { ARENA } from './config.js';

function stoneTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#4a4440';
  g.fillRect(0, 0, size, size);
  // radial flagstones: rings of slabs around the centre
  const cx = size / 2, cy = size / 2;
  let rnd = 1337;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const rings = 11;
  for (let r = 0; r < rings; r++) {
    const r0 = (r / rings) * size * 0.5, r1 = ((r + 1) / rings) * size * 0.5;
    const count = Math.max(6, Math.round((r + 0.5) * 7));
    const off = rand() * Math.PI * 2;
    for (let s = 0; s < count; s++) {
      const a0 = off + (s / count) * Math.PI * 2, a1 = off + ((s + 1) / count) * Math.PI * 2;
      const l = 30 + rand() * 16;
      g.fillStyle = `hsl(${22 + rand() * 14}, ${8 + rand() * 8}%, ${l}%)`;
      g.beginPath();
      g.arc(cx, cy, r1 - 2, a0 + 0.004, a1 - 0.004);
      g.arc(cx, cy, Math.max(0, r0 + 2), a1 - 0.004, a0 + 0.004, true);
      g.closePath();
      g.fill();
    }
  }
  // centre seal
  g.strokeStyle = 'rgba(120,30,20,0.55)';
  g.lineWidth = 10;
  g.beginPath(); g.arc(cx, cy, size * 0.09, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * size * 0.09, cy + Math.sin(a) * size * 0.09);
    g.lineTo(cx + Math.cos(a) * size * 0.2, cy + Math.sin(a) * size * 0.2); g.stroke();
  }
  // grime, cracks and stains
  for (let i = 0; i < 2600; i++) {
    const x = rand() * size, y = rand() * size, rr = rand() * 3 + 0.5;
    g.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,240,220,0.06)';
    g.fillRect(x, y, rr, rr);
  }
  for (let i = 0; i < 26; i++) {
    const x = rand() * size, y = rand() * size;
    const grd = g.createRadialGradient(x, y, 0, x, y, 20 + rand() * 50);
    grd.addColorStop(0, 'rgba(60,8,8,0.35)'); grd.addColorStop(1, 'rgba(60,8,8,0)');
    g.fillStyle = grd; g.fillRect(x - 80, y - 80, 160, 160);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
  for (let i = 0; i < 60; i++) {
    let x = rand() * size, y = rand() * size;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function blockTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5c544c'; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.05)';
    g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
  g.strokeRect(1, 1, 254, 126);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Arena {
  constructor(scene, quality) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.excitement = 0;
    this.name = 'coliseum';
    this.radius = ARENA.radius;
    this.pillars = [];
    this.segments = [];
    this.zones = [];
    this.flames = [];
    this.lights = [];
    // power-up pads sit between the pillars
    this.pads = [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2; return { x: Math.cos(a) * 7, z: Math.sin(a) * 7 }; });
    this.background = new THREE.Color(0x07070b);
    this.fog = new THREE.FogExp2(0x0b0a10, 0.018);
    this.show(true);

    this.buildSky();
    this.buildLights(quality);
    this.buildFloor();
    this.buildWall();
    this.buildPillars();
    this.buildBraziers();
    this.buildCrowd();
    this.buildEmbers();
    this.buildFireRing();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(200, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform float time;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){
          float h = vDir.y;
          vec3 horizon = vec3(0.32,0.10,0.06);
          vec3 mid = vec3(0.07,0.04,0.09);
          vec3 top = vec3(0.01,0.01,0.03);
          vec3 col = mix(horizon, mid, smoothstep(-0.05, 0.25, h));
          col = mix(col, top, smoothstep(0.25, 0.9, h));
          vec3 cell = floor(vDir * 180.0);
          float s = hash(cell);
          float star = step(0.9965, s) * smoothstep(0.05, 0.4, h) * (0.6 + 0.4 * sin(time * 2.0 + s * 100.0));
          col += vec3(star);
          // blood moon
          vec3 md = normalize(vec3(-0.55, 0.38, -0.75));
          float m = dot(vDir, md);
          col += vec3(0.9,0.25,0.12) * smoothstep(0.9985, 0.9992, m);
          col += vec3(0.5,0.12,0.05) * pow(max(m,0.0), 120.0) * 0.8;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.group.add(this.sky);
  }

  buildLights(quality) {
    const hemi = new THREE.HemisphereLight(0x8a7fb0, 0x2a160e, 0.9);
    this.group.add(hemi);
    const moon = new THREE.DirectionalLight(0xffd6c4, 2.4);
    moon.position.set(-14, 24, -10);
    moon.castShadow = quality !== 'low';
    const sm = quality === 'high' ? 2048 : 1024;
    moon.shadow.mapSize.set(sm, sm);
    const d = 21;
    Object.assign(moon.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 70 });
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.03;
    this.group.add(moon);
    this.moon = moon;
    const rim = new THREE.DirectionalLight(0x6a8cff, 0.7);
    rim.position.set(16, 10, 18);
    this.group.add(rim);
  }

  buildFloor() {
    const tex = stoneTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 2.2, roughness: 0.88, metalness: 0.02 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA.radius + 0.6, 96), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    // outer sand
    const sand = new THREE.Mesh(new THREE.RingGeometry(ARENA.radius + 0.5, 140, 64, 1),
      new THREE.MeshStandardMaterial({ color: 0x2a1f19, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2; sand.position.y = -0.02;
    sand.receiveShadow = true;
    this.group.add(sand);
  }

  buildWall() {
    const count = 72;
    const R = ARENA.radius + 0.55;
    const tex = blockTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const segLen = (2 * Math.PI * R) / count;
    const geo = new THREE.BoxGeometry(segLen * 0.98, ARENA.wallHeight, 1.0);
    const wall = new THREE.InstancedMesh(geo, mat, count);
    const capGeo = new THREE.BoxGeometry(segLen * 1.02, 0.14, 1.2);
    const cap = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0x3a332e, roughness: 0.7 }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      p.set(Math.cos(a) * R, ARENA.wallHeight / 2, Math.sin(a) * R);
      wall.setMatrixAt(i, m.compose(p, q, s));
      p.y = ARENA.wallHeight + 0.07;
      cap.setMatrixAt(i, m.compose(p, q, s));
    }
    wall.castShadow = true; wall.receiveShadow = true; cap.receiveShadow = true;
    this.group.add(wall, cap);
  }

  buildPillars() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b625a, roughness: 0.75 });
    const darker = new THREE.MeshStandardMaterial({ color: 0x3d3632, roughness: 0.8 });
    const runeMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3a1a, emissiveIntensity: 1.6 });
    this.runeMat = runeMat;
    for (let i = 0; i < ARENA.pillarCount; i++) {
      const a = (i / ARENA.pillarCount) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * ARENA.pillarRadius, z = Math.sin(a) * ARENA.pillarRadius;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.5, 8), darker);
      base.position.y = 0.25;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 5.2, 8), mat);
      shaft.position.y = 3.0;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.8, 0.5, 8), darker);
      top.position.y = 5.85;
      const rune = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.04, 6, 32), runeMat);
      rune.rotation.x = Math.PI / 2; rune.position.y = 2.2;
      const rune2 = rune.clone(); rune2.position.y = 3.9;
      for (const m of [base, shaft, top]) { m.castShadow = true; m.receiveShadow = true; }
      g.add(base, shaft, top, rune, rune2);
      this.group.add(g);
      this.pillars.push({ x, z, r: ARENA.pillarSize });
    }
  }

  buildBraziers() {
    const count = 8;
    const R = ARENA.radius + 0.55;
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0x2b2a2a, roughness: 0.4, metalness: 0.8 });
    const flameGeo = new THREE.ConeGeometry(0.35, 1.2, 10, 1, true);
    this.flameMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 } },
      vertexShader: `varying vec2 vUv; uniform float time; void main(){ vUv = uv; vec3 p = position; float k = uv.y; p.x += sin(time*9.0 + p.y*6.0) * 0.06 * k; p.z += cos(time*7.0 + p.y*5.0) * 0.06 * k; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float time; void main(){ float k = 1.0 - vUv.y; float flick = 0.75 + 0.25*sin(time*23.0 + vUv.x*30.0); vec3 c = mix(vec3(1.0,0.25,0.02), vec3(1.0,0.85,0.4), k*k); float edge = 1.0 - abs(vUv.x * 2.0 - 1.0); float a = smoothstep(0.0,0.6,k) * (1.0 - smoothstep(0.8,1.0,k)) * flick * 0.55; gl_FragColor = vec4(c * a, a); }`,
    });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.4, 8), bowlMat);
      stand.position.set(x, ARENA.wallHeight + 0.85, z);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.35, 12), bowlMat);
      bowl.position.set(x, ARENA.wallHeight + 1.65, z);
      stand.castShadow = true;
      const flame = new THREE.Mesh(flameGeo, this.flameMat);
      flame.position.set(x, ARENA.wallHeight + 2.35, z);
      const inner = flame.clone(); inner.scale.set(0.6, 0.75, 0.6); inner.position.y -= 0.12;
      this.group.add(stand, bowl, flame, inner);
      this.flames.push({ x, y: ARENA.wallHeight + 2.0, z });
      // only every other brazier gets a real light to keep the light count low
      if (i % 2 === 0) {
        const L = new THREE.PointLight(0xff7a2a, 26, 22, 1.7);
        L.position.set(x * 0.94, ARENA.wallHeight + 2.4, z * 0.94);
        this.group.add(L);
        this.lights.push({ light: L, base: 26, seed: Math.random() * 10 });
      }
    }
  }

  buildCrowd() {
    // tiered stands
    const standMat = new THREE.MeshStandardMaterial({ color: 0x26201c, roughness: 0.95 });
    for (let t = 0; t < 5; t++) {
      const r0 = ARENA.radius + 3 + t * 2.2;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 2.2, r0 + 2.2, 1.4 + t * 1.3, 64, 1, true), standMat);
      ring.position.y = (1.4 + t * 1.3) / 2;
      ring.material.side = THREE.BackSide;
      this.group.add(ring);
      const top = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 2.2, 64).rotateX(-Math.PI / 2), standMat);
      top.position.y = 1.4 + t * 1.3;
      this.group.add(top);
    }
    // spectators: instanced capsules that bob in the vertex shader
    const N = 1400;
    const geo = new THREE.CapsuleGeometry(0.28, 0.6, 3, 6);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.crowdUniforms = { time: { value: 0 }, excite: { value: 0 } };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.time = this.crowdUniforms.time;
      shader.uniforms.excite = this.crowdUniforms.excite;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float time; uniform float excite;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = ip.x * 1.7 + ip.z * 2.3;
          transformed.y += (sin(time * (2.0 + excite * 6.0) + ph) * 0.5 + 0.5) * (0.04 + excite * 0.35);
          transformed.x += sin(time * 1.3 + ph) * 0.03;`);
    };
    const crowd = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const palette = [0x5a3a2a, 0x3a2a22, 0x6a4a32, 0x2a2a3a, 0x4a2020, 0x2f3a2a, 0x6a5a40, 0x302830];
    let n = 0;
    for (let t = 0; t < 5 && n < N; t++) {
      const r = ARENA.radius + 4.1 + t * 2.2;
      const count = Math.floor(N / 5);
      for (let i = 0; i < count && n < N; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.02;
        const rr = r + (Math.random() - 0.5) * 0.7;
        m.makeTranslation(Math.cos(a) * rr, 1.4 + t * 1.3 + 0.58, Math.sin(a) * rr);
        crowd.setMatrixAt(n, m);
        crowd.setColorAt(n, c.set(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.6 + Math.random() * 0.6));
        n++;
      }
    }
    crowd.count = n;
    this.group.add(crowd);
  }

  buildEmbers() {
    const N = 260;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 30;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 12; pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.emberMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute float seed; uniform float time; varying float vA;
        void main(){ vec3 p = position; float t = time * (0.3 + seed * 0.5) + seed * 40.0;
          p.y = mod(p.y + t, 12.0); p.x += sin(t * 1.3 + seed * 9.0) * 0.8; p.z += cos(t * 1.1 + seed * 7.0) * 0.8;
          vA = (1.0 - p.y / 12.0) * (0.5 + 0.5 * sin(time * 6.0 + seed * 50.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (2.0 + seed * 3.0) * 30.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * vA; gl_FragColor = vec4(vec3(1.0,0.45,0.12) * a, a); }`,
    });
    const pts = new THREE.Points(geo, this.emberMat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  buildFireRing() {
    const geo = new THREE.CylinderGeometry(1, 1, 2.2, 96, 1, true);
    this.fireMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, intensity: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float intensity;
        float n(vec2 p){ return sin(p.x*1.0+time*3.0)*0.5 + sin(p.x*2.3 - time*4.7)*0.3 + sin(p.x*5.1 + time*7.3)*0.2; }
        void main(){
          float x = vUv.x * 96.0;
          float h = 0.45 + 0.35 * n(vec2(x, 0.0));
          float a = smoothstep(h, h - 0.35, vUv.y) * intensity;
          vec3 c = mix(vec3(1.0,0.2,0.02), vec3(1.0,0.8,0.3), smoothstep(0.4, 0.0, vUv.y));
          gl_FragColor = vec4(c * a * 1.6, a);
        }`,
    });
    this.fireRing = new THREE.Mesh(geo, this.fireMat);
    this.fireRing.position.y = 1.1;
    this.fireRing.visible = false;
    this.group.add(this.fireRing);
    const glowGeo = new THREE.RingGeometry(0.97, 1.0, 96).rotateX(-Math.PI / 2);
    this.fireGlow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
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

  // Only one battleground is on screen at a time.
  show(on) {
    this.group.visible = on;
    if (on) { this.scene.background = this.background; this.scene.fog = this.fog; }
  }

  // Starting spots: a ring around the centre, teammates side by side (`list` is already ordered by team).
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

  // Steering push away from nearby obstacles for CPU fighters; `strafe` picks which way to slide round them.
  avoid(x, z, strafe) {
    let mx = 0, mz = 0;
    for (const p of this.pillars) {
      const px = x - p.x, pz = z - p.z, pd = Math.hypot(px, pz);
      if (pd < p.r + 1.6 && pd > 1e-3) { mx += (px / pd) * 0.8 + (-pz / pd) * strafe * 0.8; mz += (pz / pd) * 0.8 + (px / pd) * strafe * 0.8; }
    }
    return { x: mx, z: mz };
  }

  resetFireRing() { this.fireMat.uniforms.intensity.value = 0; this.setFireRing(99); }

  // Push a circle (x, z, r) out of walls and pillars. Returns {x, z, hitWall}.
  collide(x, z, r) {
    let hitWall = false;
    const d = Math.hypot(x, z);
    const max = ARENA.radius - r;
    if (d > max) { x *= max / d; z *= max / d; hitWall = true; }
    for (const p of this.pillars) {
      const dx = x - p.x, dz = z - p.z, dd = Math.hypot(dx, dz), min = p.r + r;
      if (dd < min && dd > 1e-4) { x = p.x + (dx / dd) * min; z = p.z + (dz / dd) * min; hitWall = true; }
    }
    return { x, z, hitWall };
  }

  blocksProjectile(x, z) {
    if (Math.hypot(x, z) > ARENA.radius) return true;
    for (const p of this.pillars) if (Math.hypot(x - p.x, z - p.z) < p.r) return true;
    return false;
  }

  update(dt) {
    this.time += dt;
    this.sky.material.uniforms.time.value = this.time;
    this.flameMat.uniforms.time.value = this.time;
    this.emberMat.uniforms.time.value = this.time;
    this.fireMat.uniforms.time.value = this.time;
    this.excitement = Math.max(0, this.excitement - dt * 0.35);
    this.crowdUniforms.time.value = this.time;
    this.crowdUniforms.excite.value = Math.min(1, this.excitement);
    for (const l of this.lights) {
      l.light.intensity = l.base * (0.82 + 0.12 * Math.sin(this.time * 13 + l.seed) + 0.06 * Math.sin(this.time * 31 + l.seed * 3));
    }
    this.runeMat.emissiveIntensity = 1.2 + 0.6 * Math.sin(this.time * 2) + this.excitement * 2;
  }
}
