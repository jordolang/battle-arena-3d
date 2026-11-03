// Realistic fire, smoke, dust clouds and rock debris for effects.js. Flames and smoke are
// animated, rotating billboards cut from noise-painted texture atlases (made once at load, so
// the single-file build carries no image files); debris is instanced, lit rock chunks that
// tumble, bounce and settle. Everything is pooled: three draw calls for sprites plus one per
// chunk shape, and no allocation during a fight.
import * as THREE from 'three';

// ---- value noise for painting the atlases ----
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1) ? x : -x) + ((h & 2) ? y : -y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const a = perm[xi] + yi, b = perm[xi + 1] + yi;
    const l1 = grad(perm[a], xf, yf) + u * (grad(perm[b], xf - 1, yf) - grad(perm[a], xf, yf));
    const l2 = grad(perm[a + 1], xf, yf - 1) + u * (grad(perm[b + 1], xf - 1, yf - 1) - grad(perm[a + 1], xf, yf - 1));
    return l1 + v * (l2 - l1); // about -1..1
  };
}
function fbm(n, x, y, oct = 4) {
  let a = 0.5, f = 1, sum = 0;
  for (let i = 0; i < oct; i++) { sum += a * n(x * f, y * f); f *= 2.03; a *= 0.5; }
  return sum;
}

const GRID = 4; // 4x4 frames per atlas
const CELL = 64;

// Flame tongues: a teardrop that narrows upward, eaten away by rising turbulence. Each of the
// 16 frames is a later moment of the same flame, so stepping through them makes it flicker.
function flameAtlas() {
  const size = GRID * CELL;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const n = makeNoise(7);
  for (let f = 0; f < GRID * GRID; f++) {
    const ox = (f % GRID) * CELL, oy = Math.floor(f / GRID) * CELL, t = f * 0.21;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const u = (x + 0.5) / CELL * 2 - 1, v = 1 - (y + 0.5) / CELL; // v 0 at the base, 1 at the tip
        const width = 0.58 * Math.pow(1 - v, 0.6) + 0.04;
        const turb = fbm(n, u * 1.6 + f * 3.7, v * 2.4 - t * 3) * 0.7;
        const edge = 1 - Math.abs(u + turb * 0.45 * v) / width;
        const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
        let d = smooth(0, 0.75, edge) * smooth(0, 0.18, v) * (1 - smooth(0.55, 1, v));
        d *= 0.7 + 0.5 * (fbm(n, u * 3 + 50 + f, v * 4 - t * 5, 3) + 0.5);
        d = Math.min(1, Math.max(0, d * 1.25));
        const i = ((oy + y) * size + ox + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(d * 255);
      }
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Billowing smoke and dust: lumpy puffs with soft, broken edges, sixteen different shapes.
function smokeAtlas() {
  const size = GRID * CELL;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const n = makeNoise(31);
  for (let f = 0; f < GRID * GRID; f++) {
    const ox = (f % GRID) * CELL, oy = Math.floor(f / GRID) * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const u = (x + 0.5) / CELL * 2 - 1, v = (y + 0.5) / CELL * 2 - 1;
        const r = Math.hypot(u, v);
        const lump = fbm(n, u * 2.4 + f * 5.1, v * 2.4 + f * 2.3, 5);
        let d = 1 - r / (0.75 + lump * 0.45);
        d = Math.max(0, d) * (0.65 + 0.7 * (fbm(n, u * 6 + f * 9, v * 6, 3) + 0.5));
        // shading: lit from above, so puffs read as round volumes
        const shade = 0.72 + 0.28 * Math.max(0, -v + 0.2);
        const i = ((oy + y) * size + ox + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * shade);
        img.data[i + 3] = Math.round(Math.min(1, d * 1.6) * 255);
      }
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// ---- billboard sprite layer ----
const SPRITE_VERT = `
  attribute float size; attribute float age; attribute float rot; attribute float frame; attribute vec4 tint;
  uniform float scale;
  varying float vAge; varying float vRot; varying float vFrame; varying vec4 vTint;
  void main() {
    vAge = age; vRot = rot; vFrame = frame; vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const atlasUv = `
  vec2 atlasUv(vec2 pc, float rot, float frame) {
    vec2 p = pc - 0.5;
    float c = cos(rot), s = sin(rot);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    p = clamp(p, 0.0, 1.0);
    float f = mod(floor(frame), 16.0);
    vec2 cell = vec2(mod(f, 4.0), 3.0 - floor(f / 4.0));
    return (cell + vec2(p.x, 1.0 - p.y)) / 4.0;
  }`;
// Fire colours by age: white-hot core, yellow, orange, deep red, then gone.
const FIRE_FRAG = `
  uniform sampler2D map; varying float vAge; varying float vRot; varying float vFrame; varying vec4 vTint;
  ${atlasUv}
  void main() {
    float a = texture2D(map, atlasUv(gl_PointCoord, vRot, vFrame)).a;
    float t = vAge;
    vec3 hot = vec3(1.0, 0.82, 0.45), mid = vec3(1.0, 0.45, 0.08), cool = vec3(0.6, 0.08, 0.01);
    vec3 col = t < 0.2 ? mix(hot, mid, t / 0.2) : mix(mid, cool, (t - 0.2) / 0.8);
    col = mix(col, vTint.rgb, vTint.a);
    float fade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 1.0, t));
    float k = a * fade;
    gl_FragColor = vec4(col * k * 0.9, k);
  }`;
// Smoke and dust: tinted, normally blended (so it can darken the scene), thinning as it spreads.
const SMOKE_FRAG = `
  uniform sampler2D map; varying float vAge; varying float vRot; varying float vFrame; varying vec4 vTint;
  ${atlasUv}
  void main() {
    vec4 t = texture2D(map, atlasUv(gl_PointCoord, vRot, vFrame));
    float fade = smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.35, 1.0, vAge));
    float a = t.a * fade * vTint.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint.rgb * t.r, a);
  }`;

class SpriteLayer {
  constructor(scene, max, map, frag, blending, renderOrder, upright = false) {
    this.max = max;
    this.upright = upright; // flames stay pointing up; smoke tumbles
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.age = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.frame = new Float32Array(max);
    this.tint = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.dur = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.rise = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.fps = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.pos, 3));
    geo.setAttribute('size', dyn(this.size, 1));
    geo.setAttribute('age', dyn(this.age, 1));
    geo.setAttribute('rot', dyn(this.rot, 1));
    geo.setAttribute('frame', dyn(this.frame, 1));
    geo.setAttribute('tint', dyn(this.tint, 4));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: 600 } },
      vertexShader: SPRITE_VERT, fragmentShader: frag,
      blending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    scene.add(this.points);
    this.cursor = 0;
    this.live = 0;
  }

  // `tint` is a THREE.Color-like {r,g,b} and an alpha (for fire, how far to pull toward the tint).
  spawn(x, y, z, vx, vy, vz, s0, s1, dur, tint, alpha, rise = 0, drag = 1.5, fps = 18) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.s0[i] = s0; this.s1[i] = s1; this.size[i] = s0;
    this.dur[i] = this.life[i] = dur; this.age[i] = 0;
    this.rot[i] = this.upright ? (Math.random() - 0.5) * 0.35 : Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * (this.upright ? 0.3 : 2.4);
    this.frame[i] = Math.floor(Math.random() * 16);
    this.tint[i4] = tint.r; this.tint[i4 + 1] = tint.g; this.tint[i4 + 2] = tint.b; this.tint[i4 + 3] = alpha;
    this.rise[i] = rise; this.drag[i] = drag; this.fps[i] = fps;
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) { this.pos[i3 + 1] = -999; this.size[i] = 0; continue; }
      live++;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 2] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.rise[i] * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] = Math.max(0.05, this.pos[i3 + 1] + this.vel[i3 + 1] * dt);
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.dur[i];
      this.age[i] = t;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));
      this.rot[i] += this.spin[i] * dt;
      this.frame[i] += this.fps[i] * dt;
    }
    this.live = live;
    const a = this.points.geometry.attributes;
    if (live || this.wasLive) {
      a.position.needsUpdate = a.size.needsUpdate = a.age.needsUpdate = a.rot.needsUpdate = a.frame.needsUpdate = a.tint.needsUpdate = true;
    }
    this.wasLive = live > 0;
  }
}

// ---- rock debris ----
// A few lumpy rock shapes: an icosahedron pushed in and out by a noise field, flat shaded.
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const n = makeNoise(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.72 + 0.45 * (n(v.x * 1.7 + seed, v.y * 1.7 + v.z) * 0.5 + 0.5);
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y * (0.6 + (seed % 3) * 0.15), v.z);
  }
  g.computeVertexNormals();
  return g;
}

const ROCK_SHAPES = 3, ROCKS_PER_SHAPE = 56;

class Debris {
  constructor(scene) {
    this.meshes = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, flatShading: true });
    const n = ROCK_SHAPES * ROCKS_PER_SHAPE;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.axis = new Float32Array(n * 3);
    this.spin = new Float32Array(n);
    this.angle = new Float32Array(n);
    this.scale = new Float32Array(n);
    this.life = new Float32Array(n);
    this.rest = new Uint8Array(n);
    for (let s = 0; s < ROCK_SHAPES; s++) {
      const m = new THREE.InstancedMesh(rockGeometry(11 + s * 17), mat, ROCKS_PER_SHAPE);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      const hide = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < ROCKS_PER_SHAPE; i++) { m.setMatrixAt(i, hide); m.setColorAt(i, new THREE.Color(0x777777)); }
      scene.add(m);
      this.meshes.push(m);
    }
    this.cursor = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._a = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  spawn(x, y, z, vx, vy, vz, size, color) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % (ROCK_SHAPES * ROCKS_PER_SHAPE);
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this._a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.axis[i3] = this._a.x; this.axis[i3 + 1] = this._a.y; this.axis[i3 + 2] = this._a.z;
    this.spin[i] = 6 + Math.random() * 14;
    this.angle[i] = Math.random() * 6.28;
    this.scale[i] = size;
    this.life[i] = 2.2 + Math.random() * 1.4;
    this.rest[i] = 0;
    const mesh = this.meshes[i % ROCK_SHAPES], k = Math.floor(i / ROCK_SHAPES);
    // each chunk a slightly different shade of the ground it came from
    mesh.setColorAt(k, this._c.set(color).multiplyScalar(0.7 + Math.random() * 0.5));
    mesh.instanceColor.needsUpdate = true;
    mesh.count = ROCKS_PER_SHAPE;
  }

  update(dt) {
    const n = ROCK_SHAPES * ROCKS_PER_SHAPE;
    let any = false;
    for (let i = 0; i < n; i++) {
      const mesh = this.meshes[i % ROCK_SHAPES], k = Math.floor(i / ROCK_SHAPES);
      if (this.life[i] <= 0) {
        if (this.scale[i] !== 0) { this.scale[i] = 0; mesh.setMatrixAt(k, this._m.makeScale(0, 0, 0)); mesh.instanceMatrix.needsUpdate = true; }
        continue;
      }
      any = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      const sz = this.scale[i];
      if (!this.rest[i]) {
        this.vel[i3 + 1] -= 22 * dt;
        this.pos[i3] += this.vel[i3] * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
        this.angle[i] += this.spin[i] * dt;
        const floor = sz * 0.55;
        if (this.pos[i3 + 1] < floor) {
          this.pos[i3 + 1] = floor;
          // bounce, lose speed and spin; settle once slow
          this.vel[i3 + 1] *= -0.32;
          this.vel[i3] *= 0.55; this.vel[i3 + 2] *= 0.55;
          this.spin[i] *= 0.5;
          if (Math.abs(this.vel[i3 + 1]) < 1.1) this.rest[i] = 1;
        }
      }
      // sink into the floor at the end of its life
      const fade = Math.min(1, this.life[i] / 0.5);
      this._a.set(this.axis[i3], this.axis[i3 + 1], this.axis[i3 + 2]);
      this._q.setFromAxisAngle(this._a, this.angle[i]);
      this._v.set(this.pos[i3], this.pos[i3 + 1] - (1 - fade) * sz, this.pos[i3 + 2]);
      this._s.setScalar(sz * (0.4 + 0.6 * fade));
      mesh.setMatrixAt(k, this._m.compose(this._v, this._q, this._s));
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (!any) for (const m of this.meshes) m.count = 0;
  }
}

const _tint = new THREE.Color();
const NO_TINT = { r: 1, g: 1, b: 1 };

export class RealFx {
  constructor(scene) {
    const flames = flameAtlas(), puffs = smokeAtlas();
    this.smoke = new SpriteLayer(scene, 360, puffs, SMOKE_FRAG, THREE.NormalBlending, 4);
    this.fireLayer = new SpriteLayer(scene, 520, flames, FIRE_FRAG, THREE.AdditiveBlending, 6, true);
    this.debris = new Debris(scene);
    // the colour of loose ground: dust clouds and rock chips take it on
    this.ground = new THREE.Color(0x9a8068);
    this.light = new THREE.PointLight(0xff8a30, 0, 14, 1.8);
    scene.add(this.light);
    this.lightT = 0;
  }

  // One licking flame at a point, drifting up. `tint` pulls the flame toward another colour
  // (strength 0..1) for coloured fire.
  flame(x, y, z, size = 0.6, vx = 0, vy = 1.4, vz = 0, life = 0.5, tint = null, tintAmt = 0) {
    const k = 0.6 + Math.random() * 0.8; // no two tongues the same height
    this.fireLayer.spawn(x, y, z, vx, vy, vz, size * k, size * k * 1.6, life * (0.75 + Math.random() * 0.5), tint || NO_TINT, tintAmt, 3.5, 2.2, 22 + Math.random() * 10);
  }

  smokePuff(x, y, z, size = 0.8, vx = 0, vy = 0.8, vz = 0, life = 1.6, color = 0x2a2522, alpha = 0.55) {
    _tint.set(color);
    this.smoke.spawn(x, y, z, vx, vy, vz, size * 0.6, size * 2.2, life * (0.8 + Math.random() * 0.4), _tint, alpha, 0.6, 1.4, 2);
  }

  // A fireball going off: a burst of flame, a rising column of smoke and a flash of firelight.
  explode(x, y, z, scale = 1, grounded = false) {
    const n = Math.round(12 + 6 * scale);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u);
      const s = (2 + Math.random() * 4.5) * scale;
      this.flame(x, y, z, (0.6 + Math.random() * 0.6) * scale, Math.cos(a) * r * s, Math.abs(u) * s * 0.8 + 1, Math.sin(a) * r * s, 0.55 + Math.random() * 0.3);
    }
    for (let k = 0; k < 10 * scale; k++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 1.6 * scale;
      this.smokePuff(x + Math.cos(a) * 0.3, y + 0.2, z + Math.sin(a) * 0.3, (0.9 + Math.random() * 0.6) * scale, Math.cos(a) * s, 1 + Math.random() * 1.5, Math.sin(a) * s, 1.8 + Math.random(), 0x3a332e, 0.42);
    }
    if (grounded) this.groundBlast(x, z, scale * 0.8);
    this.light.position.set(x, y + 0.6, z);
    this.light.intensity = Math.max(this.light.intensity, 30 * scale);
    this.lightT = 0.35;
  }

  // Ground struck hard: a ring of rock chips thrown out, and a low cloud of dust rolling outward.
  groundBlast(x, z, scale = 1, chips = true) {
    const g = this.ground;
    if (chips) {
      const n = Math.round(Math.min(44, 16 * scale));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, s = (2.5 + Math.random() * 5) * Math.sqrt(scale);
        const size = (0.025 + Math.random() * Math.random() * 0.085) * Math.min(1.3, 0.7 + scale * 0.2);
        this.debris.spawn(x + Math.cos(a) * 0.3, 0.15, z + Math.sin(a) * 0.3, Math.cos(a) * s, 3 + Math.random() * 6 * Math.sqrt(scale), Math.sin(a) * s, size, g);
      }
    }
    this.dustCloud(x, z, scale);
  }

  // A low, rolling cloud of dust in the ground's colour.
  dustCloud(x, z, scale = 1) {
    const g = this.ground;
    _tint.copy(g).multiplyScalar(1.35);
    const n = Math.round(Math.min(18, 3 + 6 * scale));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = (1 + Math.random() * 2.5) * Math.sqrt(scale);
      this.smoke.spawn(x + Math.cos(a) * 0.2, 0.25 + Math.random() * 0.3, z + Math.sin(a) * 0.2, Math.cos(a) * s, 0.3 + Math.random() * 0.6, Math.sin(a) * s,
        (0.5 + Math.random() * 0.4) * Math.sqrt(scale), (1.6 + Math.random()) * Math.sqrt(scale), 1.1 + Math.random() * 0.9, _tint, 0.38, 0.25, 2.2, 1.5);
    }
  }

  update(dt) {
    this.fireLayer.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    if (this.lightT > 0) {
      this.lightT -= dt;
      this.light.intensity *= Math.exp(-8 * dt);
      if (this.lightT <= 0) this.light.intensity = 0;
    }
  }
}
