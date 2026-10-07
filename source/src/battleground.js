// The Badlands: the tournament battleground. A sunset canyon more than three times the size of the
// coliseum, with a walled base for each team, a ruined shrine in the middle, boulders and broken walls
// to flank around, healing springs to fight over and power-up pads across the field.
// Same interface as Arena (collide, blocksProjectile, avoid, spawnPoints, pads, zones, fire ring).
import * as THREE from 'three';

const R = 33;            // playable radius
const WALL_H = 1.7;      // chest-high: blocks projectiles and beams, fighters can't jump it
const WALL_T = 0.45;     // half thickness

// Walls as segments [ax, az, bx, bz]; mirrored north/south and east/west below.
const BASE_WALLS = [
  [-10, 17, -3.2, 17], [3.2, 17, 10, 17],   // front wall with a gate in the middle
  [-10, 17, -10, 25], [10, 17, 10, 25],     // sides
];
const FIELD_WALLS = [
  [-19, -4, -19, 4], [19, -4, 19, 4],       // screens in front of the flank springs
  [-9, -6.5, -4, -6.5], [4, 6.5, 9, 6.5],   // broken walls near the shrine
];
const BOULDERS = [
  [13, 8, 1.8], [-13, 8, 1.8], [13, -8, 1.8], [-13, -8, 1.8],
  [6, 12, 1.3], [-6, 12, 1.3], [6, -12, 1.3], [-6, -12, 1.3],
  [24, 14, 1.6], [-24, 14, 1.6], [24, -14, 1.6], [-24, -14, 1.6],
];
const SHRINE_PILLARS = [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; return [Math.cos(a) * 5.2, Math.sin(a) * 5.2, 0.85]; });
const SPRINGS = [[0, 22.5, 2.2], [0, -22.5, 2.2], [-23, 0, 2.0], [23, 0, 2.0]];
const PADS = [[0, 0], [11, 0], [-11, 0], [0, 11], [0, -11], [20, 11], [-20, 11], [20, -11], [-20, -11]];

function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

function earthTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = seeded(4242);
  g.fillStyle = '#7a4a32';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) {
    const x = rand() * size, y = rand() * size, r = 4 + rand() * 26;
    g.fillStyle = `hsla(${16 + rand() * 14}, ${30 + rand() * 20}%, ${24 + rand() * 18}%, 0.18)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // dried-mud cracks
  g.strokeStyle = 'rgba(40,18,10,0.55)';
  for (let i = 0; i < 70; i++) {
    let x = rand() * size, y = rand() * size;
    g.lineWidth = 0.8 + rand() * 1.6;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 60; y += (rand() - 0.5) * 60; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(255,220,180,0.07)';
    g.fillRect(rand() * size, rand() * size, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  t.anisotropy = 8;
  return t;
}

function brickTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const rand = seeded(99);
  g.fillStyle = '#8a6a50'; g.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const x = col * 56 - (row % 2) * 28, y = row * 32;
      g.fillStyle = `hsl(${20 + rand() * 12}, ${22 + rand() * 12}%, ${34 + rand() * 12}%)`;
      g.fillRect(x + 2, y + 2, 52, 28);
    }
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.06)';
    g.fillRect(rand() * 256, rand() * 128, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// A lumpy rock: an icosahedron pushed about by a few sine waves.
export function rockGeometry(seed, detail = 1) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position;
  const rand = seeded(seed);
  const a = rand() * 6, b = rand() * 6, c = rand() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.18 * Math.sin(x * 3 + a) + 0.14 * Math.sin(y * 4 + b) + 0.12 * Math.sin(z * 5 + c);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function mirror4(list) {
  const out = [];
  for (const [ax, az, bx, bz] of list) {
    out.push([ax, az, bx, bz], [ax, -az, bx, -bz]);
  }
  return out;
}

export class Badlands {
  constructor(scene, quality) {
    this.scene = scene;
    this.name = 'badlands';
    this.radius = R;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.time = 0;
    this.excitement = 0;
    this.lights = [];
    this.background = new THREE.Color(0x2a1420);
    this.fog = new THREE.Fog(0x6a3a3a, 40, 140);

    this.segments = [...mirror4(BASE_WALLS), ...FIELD_WALLS].map(([ax, az, bx, bz]) => ({ ax, az, bx, bz, t: WALL_T }));
    this.pillars = [...BOULDERS, ...SHRINE_PILLARS].map(([x, z, r]) => ({ x, z, r }));
    this.zones = SPRINGS.map(([x, z, r]) => ({ x, z, r, heal: 0.04 }));
    this.pads = PADS.map(([x, z]) => ({ x, z }));

    this.buildSky();
    this.buildLights(quality);
    this.buildGround();
    this.buildCliffs();
    this.buildWalls();
    this.buildRocks();
    this.buildShrine();
    this.buildSprings();
    this.buildBanners();
    this.buildDust();
    this.buildFireRing();
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vDir; uniform float time;
        void main(){
          float h = vDir.y;
          vec3 horizon = vec3(1.0,0.45,0.18);
          vec3 mid = vec3(0.55,0.18,0.28);
          vec3 top = vec3(0.08,0.05,0.16);
          vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.22, h));
          col = mix(col, top, smoothstep(0.22, 0.85, h));
          // setting sun in the west
          vec3 sd = normalize(vec3(-0.9, 0.08, -0.35));
          float m = max(dot(vDir, sd), 0.0);
          col += vec3(1.0,0.75,0.4) * smoothstep(0.9975, 0.999, m);
          col += vec3(1.0,0.42,0.15) * pow(m, 40.0) * 0.9;
          // thin cloud bands
          float band = sin(h * 60.0 + vDir.x * 4.0 + time * 0.05) * 0.5 + 0.5;
          col = mix(col, col * vec3(0.8,0.6,0.7), band * smoothstep(0.05, 0.3, h) * (1.0 - smoothstep(0.3, 0.6, h)) * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 16), mat);
    this.group.add(this.sky);
  }

  buildLights(quality) {
    this.group.add(new THREE.HemisphereLight(0xffc4a0, 0x4a2418, 1.1));
    const sun = new THREE.DirectionalLight(0xffb27a, 2.6);
    sun.position.set(-40, 26, -14);
    sun.castShadow = quality !== 'low';
    const sm = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    const d = R + 4;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 120 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    this.group.add(sun);
    this.moon = sun; // the quality toggle in main.js flips shadows on this light
    const fill = new THREE.DirectionalLight(0x8a7aff, 0.55);
    fill.position.set(30, 18, 24);
    this.group.add(fill);
    // braziers by each base gate and the shrine
    for (const [x, z] of [[0, 15.5], [0, -15.5], [0, 0]]) {
      const L = new THREE.PointLight(0xff7a2a, 22, 16, 1.6);
      L.position.set(x, 3.2, z);
      this.group.add(L);
      this.lights.push({ light: L, base: 22, seed: Math.random() * 10 });
    }
  }

  buildGround() {
    const tex = earthTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.6, roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R + 14, 96), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    const far = new THREE.Mesh(new THREE.RingGeometry(R + 13.5, 200, 48, 1), new THREE.MeshStandardMaterial({ color: 0x5a3020, roughness: 1 }));
    far.rotation.x = -Math.PI / 2; far.position.y = -0.03;
    this.group.add(far);
    // worn paths from each base to the shrine and between the springs
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xa8704c, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false });
    for (const [w, l, rot] of [[5, 2 * R - 6, 0], [4, 2 * R - 14, Math.PI / 2]]) {
      const path = new THREE.Mesh(new THREE.PlaneGeometry(w, l), pathMat);
      path.rotation.set(-Math.PI / 2, 0, rot);
      path.position.y = 0.01;
      path.receiveShadow = true;
      this.group.add(path);
    }
  }

  buildCliffs() {
    const count = 54;
    const geo = rockGeometry(7, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a4a30, roughness: 0.92, flatShading: true });
    const rocks = new THREE.InstancedMesh(geo, mat, count * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const rand = seeded(17);
    let n = 0;
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand() * 0.05 + ring * 0.06;
        const rr = R + 3.2 + ring * 5 + rand() * 1.5;
        p.set(Math.cos(a) * rr, ring ? 3 + rand() * 4 : 1 + rand() * 2, Math.sin(a) * rr);
        s.set(3 + rand() * 2.5, ring ? 7 + rand() * 7 : 3.5 + rand() * 3.5, 3 + rand() * 2.5);
        q.setFromEuler(e.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4));
        rocks.setMatrixAt(n++, m.compose(p, q, s));
      }
    }
    rocks.castShadow = true; rocks.receiveShadow = true;
    this.group.add(rocks);
  }

  buildWalls() {
    const tex = brickTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.8 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const walls = new THREE.InstancedMesh(box, mat, this.segments.length);
    const caps = new THREE.InstancedMesh(box, capMat, this.segments.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    this.segments.forEach((w, i) => {
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
      q.setFromAxisAngle(up, -Math.atan2(w.bz - w.az, w.bx - w.ax));
      p.set((w.ax + w.bx) / 2, WALL_H / 2, (w.az + w.bz) / 2);
      walls.setMatrixAt(i, m.compose(p, q, s.set(len + w.t * 2, WALL_H, w.t * 2)));
      p.y = WALL_H + 0.08;
      caps.setMatrixAt(i, m.compose(p, q, s.set(len + w.t * 2 + 0.2, 0.16, w.t * 2 + 0.25)));
    });
    walls.castShadow = true; walls.receiveShadow = true; caps.castShadow = true;
    this.group.add(walls, caps);
  }

  buildRocks() {
    const geo = rockGeometry(31, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a5a3a, roughness: 0.9, flatShading: true });
    const boulders = new THREE.InstancedMesh(geo, mat, BOULDERS.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const rand = seeded(5);
    BOULDERS.forEach(([x, z, r], i) => {
      p.set(x, r * 0.55, z);
      s.set(r * 1.05, r * (0.9 + rand() * 0.5), r * 1.05);
      q.setFromEuler(e.set(0, rand() * Math.PI * 2, 0));
      boulders.setMatrixAt(i, m.compose(p, q, s));
    });
    boulders.castShadow = true; boulders.receiveShadow = true;
    this.group.add(boulders);
    // pebbles for texture, no collision
    const pebbles = new THREE.InstancedMesh(rockGeometry(9, 0), mat, 160);
    for (let i = 0; i < 160; i++) {
      const a = rand() * Math.PI * 2, rr = 3 + rand() * (R - 4);
      p.set(Math.cos(a) * rr, 0.05, Math.sin(a) * rr);
      const k = 0.12 + rand() * 0.3;
      s.set(k, k * 0.6, k);
      q.setFromEuler(e.set(0, rand() * 6, 0));
      pebbles.setMatrixAt(i, m.compose(p, q, s));
    }
    pebbles.receiveShadow = true;
    this.group.add(pebbles);
  }

  buildShrine() {
    const stone = new THREE.MeshStandardMaterial({ color: 0xb08a6a, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x5a4434, roughness: 0.9 });
    this.runeMat = new THREE.MeshStandardMaterial({ color: 0x220a00, emissive: 0xffa040, emissiveIntensity: 1.4 });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.12, 24), dark);
    dais.position.y = 0.06; dais.receiveShadow = true;
    this.group.add(dais);
    const glyph = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.05, 6, 48), this.runeMat);
    glyph.rotation.x = Math.PI / 2; glyph.position.y = 0.14;
    this.group.add(glyph);
    SHRINE_PILLARS.forEach(([x, z], i) => {
      const h = [4.4, 2.6, 3.6, 1.8][i];
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.78, h, 8), stone);
      shaft.position.set(x, h / 2, z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.4, 8), dark);
      base.position.set(x, 0.2, z);
      const rune = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.04, 6, 24), this.runeMat);
      rune.rotation.x = Math.PI / 2; rune.position.set(x, Math.min(h - 0.3, 1.6), z);
      for (const o of [shaft, base]) { o.castShadow = true; o.receiveShadow = true; }
      this.group.add(shaft, base, rune);
    });
    // braziers at each base gate
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0x2b2a2a, roughness: 0.4, metalness: 0.8 });
    this.flameMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; uniform float time; void main(){ vUv = uv; vec3 p = position; float k = uv.y; p.x += sin(time*9.0 + p.y*6.0) * 0.06 * k; p.z += cos(time*7.0 + p.y*5.0) * 0.06 * k; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform float time; void main(){ float k = 1.0 - vUv.y; float flick = 0.75 + 0.25*sin(time*23.0 + vUv.x*30.0); vec3 c = mix(vec3(1.0,0.25,0.02), vec3(1.0,0.85,0.4), k*k); float a = smoothstep(0.0,0.6,k) * (1.0 - smoothstep(0.8,1.0,k)) * flick * 0.55; gl_FragColor = vec4(c * a, a); }',
    });
    const flameGeo = new THREE.ConeGeometry(0.35, 1.2, 10, 1, true);
    for (const [x, z] of [[-4.2, 15.6], [4.2, 15.6], [-4.2, -15.6], [4.2, -15.6]]) {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 8), bowlMat);
      stand.position.set(x, 0.8, z);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.28, 0.32, 12), bowlMat);
      bowl.position.set(x, 1.7, z);
      const flame = new THREE.Mesh(flameGeo, this.flameMat);
      flame.position.set(x, 2.35, z);
      stand.castShadow = true;
      this.group.add(stand, bowl, flame);
    }
  }

  buildSprings() {
    this.springMats = [];
    for (const z of this.zones) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(z.r, 40), new THREE.MeshStandardMaterial({
        color: 0x0e4a40, emissive: 0x18a07a, emissiveIntensity: 0.5, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.9,
      }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(z.x, 0.03, z.z);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(z.r + 0.1, 0.18, 6, 32), new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.9 }));
      rim.rotation.x = Math.PI / 2; rim.position.set(z.x, 0.08, z.z);
      rim.receiveShadow = true;
      const glow = new THREE.Mesh(new THREE.RingGeometry(z.r * 0.4, z.r, 32), new THREE.MeshBasicMaterial({
        color: 0x3affa0, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(z.x, 0.06, z.z);
      this.springMats.push(pool.material, glow.material);
      this.group.add(pool, rim, glow);
    }
  }

  // A banner in each team's colour flies over its base (team 0 south, team 1 north).
  buildBanners() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8 });
    this.bannerMats = [new THREE.MeshStandardMaterial({ color: 0xd23a2a, side: THREE.DoubleSide, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x2f6fe0, side: THREE.DoubleSide, roughness: 0.8 })];
    const cloth = new THREE.PlaneGeometry(1.6, 2.4, 6, 6);
    this.banners = [];
    for (const [side, mat] of [[1, this.bannerMats[0]], [-1, this.bannerMats[1]]]) {
      for (const x of [-10, 10]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), poleMat);
        pole.position.set(x, 3, 17 * side);
        pole.castShadow = true;
        const flag = new THREE.Mesh(cloth, mat);
        flag.position.set(x + 0.85 * Math.sign(-x), 4.6, 17 * side);
        flag.castShadow = true;
        this.group.add(pole, flag);
        this.banners.push(flag);
      }
    }
  }

  setTeams(teams) {
    if (!teams) return;
    teams.slice(0, 2).forEach((t, i) => this.bannerMats[i].color.setHex(t.color));
  }

  buildDust() {
    const N = 320;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (R + 6);
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 8; pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 } },
      vertexShader: `attribute float seed; uniform float time; varying float vA;
        void main(){ vec3 p = position; float t = time * (0.6 + seed * 0.8) + seed * 50.0;
          p.x = mod(p.x + t * 1.5 + 40.0, 80.0) - 40.0; p.y += sin(t + seed * 9.0) * 0.6; p.z += cos(t * 0.7 + seed * 7.0) * 0.8;
          vA = 0.35 * (0.5 + 0.5 * sin(time + seed * 30.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (2.0 + seed * 3.0) * 30.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: 'varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)) * vA; gl_FragColor = vec4(vec3(1.0,0.8,0.6), a); }',
    });
    const pts = new THREE.Points(geo, this.dustMat);
    pts.frustumCulled = false;
    this.group.add(pts);
  }

  buildFireRing() {
    const geo = new THREE.CylinderGeometry(1, 1, 2.2, 128, 1, true);
    this.fireMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, intensity: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float intensity;
        float n(vec2 p){ return sin(p.x*1.0+time*3.0)*0.5 + sin(p.x*2.3 - time*4.7)*0.3 + sin(p.x*5.1 + time*7.3)*0.2; }
        void main(){
          float x = vUv.x * 160.0;
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

  // Teams start in their own bases (team 0 south, team 1 north, more teams on the flanks);
  // free-for-all spreads everyone round a wide ring.
  spawnPoints(list) {
    const teamed = list.some((f) => f.team >= 0);
    if (!teamed) {
      const n = list.length;
      return list.map((f, i) => {
        const a = Math.PI / 2 + (i / n) * Math.PI * 2;
        const x = Math.cos(a) * 18, z = Math.sin(a) * 18;
        return { x, z, facing: Math.atan2(-x, -z) };
      });
    }
    const bases = [[0, 21], [0, -21], [-24, 0], [24, 0]];
    const seen = new Map();
    const sizes = new Map();
    for (const f of list) sizes.set(f.team, (sizes.get(f.team) || 0) + 1);
    return list.map((f) => {
      const t = Math.max(0, f.team) % 4;
      const k = seen.get(t) || 0;
      seen.set(t, k + 1);
      const n = sizes.get(f.team);
      const [bx, bz] = bases[t];
      const off = (k - (n - 1) / 2) * 2.2;
      const x = t < 2 ? bx + off : bx, z = t < 2 ? bz : bz + off;
      return { x, z, facing: Math.atan2(-x, -z) };
    });
  }

  // Push a circle out of the canyon edge, walls, boulders and pillars.
  collide(x, z, r) {
    let hitWall = false;
    const d = Math.hypot(x, z);
    const max = R - r;
    if (d > max) { x *= max / d; z *= max / d; hitWall = true; }
    for (const p of this.pillars) {
      const dx = x - p.x, dz = z - p.z, dd = Math.hypot(dx, dz), min = p.r + r;
      if (dd < min && dd > 1e-4) { x = p.x + (dx / dd) * min; z = p.z + (dz / dd) * min; hitWall = true; }
    }
    for (const w of this.segments) {
      const c = closest(w, x, z);
      const dx = x - c.x, dz = z - c.z, dd = Math.hypot(dx, dz), min = w.t + r;
      if (dd < min) {
        if (dd > 1e-4) { x = c.x + (dx / dd) * min; z = c.z + (dz / dd) * min; } else { x += min; }
        hitWall = true;
      }
    }
    return { x, z, hitWall };
  }

  blocksProjectile(x, z) {
    if (Math.hypot(x, z) > R) return true;
    for (const p of this.pillars) if (Math.hypot(x - p.x, z - p.z) < p.r) return true;
    for (const w of this.segments) { const c = closest(w, x, z); if (Math.hypot(x - c.x, z - c.z) < w.t + 0.1) return true; }
    return false;
  }

  avoid(x, z, strafe) {
    let mx = 0, mz = 0;
    const push = (px, pz, pd, reach) => {
      if (pd >= reach || pd < 1e-3) return;
      const k = (reach - pd) / reach + 0.4;
      mx += (px / pd) * k + (-pz / pd) * strafe * k * 1.2;
      mz += (pz / pd) * k + (px / pd) * strafe * k * 1.2;
    };
    for (const p of this.pillars) { const px = x - p.x, pz = z - p.z; push(px, pz, Math.hypot(px, pz), p.r + 1.8); }
    for (const w of this.segments) { const c = closest(w, x, z); const px = x - c.x, pz = z - c.z; push(px, pz, Math.hypot(px, pz), w.t + 1.8); }
    return { x: mx, z: mz };
  }

  update(dt) {
    this.time += dt;
    this.sky.material.uniforms.time.value = this.time;
    this.flameMat.uniforms.time.value = this.time;
    this.dustMat.uniforms.time.value = this.time;
    this.fireMat.uniforms.time.value = this.time;
    this.excitement = Math.max(0, this.excitement - dt * 0.35);
    for (const l of this.lights) l.light.intensity = l.base * (0.82 + 0.12 * Math.sin(this.time * 13 + l.seed) + 0.06 * Math.sin(this.time * 31 + l.seed * 3));
    this.runeMat.emissiveIntensity = 1.1 + 0.5 * Math.sin(this.time * 2) + this.excitement * 1.5;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.4);
    for (let i = 0; i < this.springMats.length; i += 2) {
      this.springMats[i].emissiveIntensity = 0.35 + pulse * 0.3;
      this.springMats[i + 1].opacity = 0.08 + pulse * 0.12;
    }
    for (let i = 0; i < this.banners.length; i++) this.banners[i].rotation.y = Math.sin(this.time * 1.7 + i) * 0.25;
  }
}

function closest(w, x, z) {
  const vx = w.bx - w.ax, vz = w.bz - w.az;
  const L = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - w.ax) * vx + (z - w.az) * vz) / L));
  return { x: w.ax + vx * t, z: w.az + vz * t };
}
