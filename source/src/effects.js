// Pooled visual effects: sparks, rings, glows, lightning. Everything is
// allocated once up front so combat never triggers garbage-collection spikes.
import * as THREE from 'three';
import { RealFx } from './realFx.js';

function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MAX_PARTICLES = 1400;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.dot = softDotTexture();

    // --- particles (one draw call) ---
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pBase = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    this.pDrag = new Float32Array(MAX_PARTICLES);
    this.pColBase = new Float32Array(MAX_PARTICLES * 3);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -999;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.dot }, scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute vec3 color; varying vec3 vColor;
        uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor * t.a, t.a); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.pCursor = 0;

    // --- expanding rings ---
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = 4;
      scene.add(m);
      this.rings.push({ mesh: m, t: 1, dur: 0.4, r: 1 });
    }

    // --- lightning bolts / streaks (line segments) ---
    this.bolts = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xfffbe0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
      line.visible = false; line.frustumCulled = false;
      scene.add(line);
      this.bolts.push({ line, t: 1, dur: 0.25 });
    }
    this.flashLight = new THREE.PointLight(0xfff2b0, 0, 18, 1.6);
    scene.add(this.flashLight);
    this.flashT = 0;

    // --- telegraph markers ---
    this.telegraphs = [];
    const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.renderOrder = 3;
      scene.add(m);
      this.telegraphs.push({ mesh: m, t: 0, dur: 1, done: true });
    }

    // --- frost cone ---
    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.cones = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      scene.add(m);
      this.cones.push({ mesh: m, t: 1, dur: 0.45, len: 1 });
    }
    this.tmpColor = new THREE.Color();
    // real fire, smoke, dust clouds and rock chips (realFx.js)
    this.real = new RealFx(scene);
  }

  emit(x, y, z, vx, vy, vz, color, size, life, grav = 9, drag = 2.5) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    const c = this.tmpColor.set(color);
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pColBase[i * 3] = c.r; this.pColBase[i * 3 + 1] = c.g; this.pColBase[i * 3 + 2] = c.b;
    this.pLife[i] = life; this.pMax[i] = life; this.pBase[i] = size; this.pGrav[i] = grav; this.pDrag[i] = drag;
  }

  sparks(x, y, z, color, count = 12, speed = 5) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u), s = speed * (0.4 + Math.random() * 0.8);
      this.emit(x, y, z, Math.cos(a) * r * s, Math.abs(u) * s + 1.5, Math.sin(a) * r * s, color, 0.12 + Math.random() * 0.12, 0.25 + Math.random() * 0.35);
    }
  }

  impact(x, y, z, scale = 1, color = 0xffd9a0) {
    this.sparks(x, y, z, color, Math.round(14 * scale), 6 * scale);
    // a few dark-red droplets for weight
    for (let k = 0; k < 6 * scale; k++) {
      this.emit(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 4 + 1, (Math.random() - 0.5) * 5, 0x7a0a0a, 0.09, 0.6, 16, 0.5);
    }
    this.emit(x, y, z, 0, 0, 0, color, 0.9 * scale, 0.09, 0, 0); // flash
    if (scale > 1.2) this.ring(x, y, z, color, 1.6 * scale, 0.25);
  }

  trail(x, y, z, color) {
    this.emit(x + (Math.random() - 0.5) * 0.2, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5), Math.random() * 1.5, (Math.random() - 0.5), color, 0.35, 0.3, -2, 3);
  }

  // Ground disturbed at (x, z): footsteps and dodges kick up a little dust; landings, slams and
  // wall hits (scale 1 and up) also throw out rock chips.
  dust(x, z, scale = 1) {
    if (scale < 0.9) this.real.dustCloud(x, z, scale * 0.6);
    else this.real.groundBlast(x, z, scale);
  }

  // Burning: a few flames licking up from a point (a fireball, a burning fighter).
  fire(x, y, z, size = 0.5, count = 1, spread = 0.2) {
    for (let k = 0; k < count; k++) {
      this.real.flame(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread,
        size * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 0.6, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.25);
    }
  }

  smoke(x, y, z, size = 0.8) { this.real.smokePuff(x, y, z, size); }

  // A fireball going off, with chips and dust too when it hits the ground.
  explode(x, y, z, scale = 1, grounded = false) {
    this.real.explode(x, y, z, scale, grounded);
    this.sparks(x, y, z, 0xffb35a, Math.round(16 * scale), 7 * scale);
  }

  // Flames along a line at chest height (a flame ray).
  fireLine(sx, sz, ex, ez, y = 1.2) {
    const n = Math.round(Math.hypot(ex - sx, ez - sz) * 6);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const j = (Math.random() - 0.5) * 0.35;
      this.real.flame(sx + (ex - sx) * t + j, y + (Math.random() - 0.5) * 0.5, sz + (ez - sz) * t - j, 0.35 + Math.random() * 0.35 + t * 0.25,
        (ex - sx) / n * 3, 0.8 + Math.random(), (ez - sz) / n * 3, 0.3 + t * 0.35);
      if (k % 4 === 0) this.real.smokePuff(sx + (ex - sx) * t, y + 0.4, sz + (ez - sz) * t, 0.5, 0, 1.2, 0, 1.2, 0x241e1a, 0.35);
    }
  }

  puff(x, z, color) {
    for (let k = 0; k < 26; k++) {
      this.emit(x + (Math.random() - 0.5) * 0.6, Math.random() * 1.9, z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 2.5, Math.random() * 1.5, (Math.random() - 0.5) * 2.5, color, 0.45, 0.5, -1, 3);
    }
  }

  streak(sx, sz, ex, ez, color) {
    const n = 40;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      this.emit(sx + (ex - sx) * t, 0.6 + Math.random() * 1.0, sz + (ez - sz) * t, (Math.random() - 0.5), Math.random(), (Math.random() - 0.5), color, 0.4, 0.45 + t * 0.2, 0, 2);
    }
  }

  makeGlow(color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(size);
    return s;
  }

  ring(x, y, z, color, radius, dur = 0.45) {
    const r = this.rings.find((q) => q.t >= 1) || this.rings[0];
    r.t = 0; r.dur = dur; r.r = radius;
    r.mesh.position.set(x, y, z);
    r.mesh.material.color.set(color);
    r.mesh.visible = true;
  }

  cone(x, y, z, facing, len, color) {
    const c = this.cones.find((q) => q.t >= 1) || this.cones[0];
    c.t = 0; c.len = len;
    c.mesh.position.set(x, y, z);
    c.mesh.rotation.set(0, facing, 0);
    c.mesh.material.color.set(color);
    c.mesh.visible = true;
    for (let k = 0; k < 40; k++) {
      const a = facing + (Math.random() - 0.5) * 1.1, s = 6 + Math.random() * 6;
      this.emit(x, y, z, Math.sin(a) * s, (Math.random() - 0.4) * 1.5, Math.cos(a) * s, 0xdff6ff, 0.3, 0.45, 0, 2);
    }
  }

  telegraph(x, z, radius, color, dur) {
    const t = this.telegraphs.find((q) => q.done) || this.telegraphs[0];
    t.t = 0; t.dur = dur; t.done = false;
    t.mesh.position.set(x, 0.04, z);
    t.mesh.scale.setScalar(radius);
    t.mesh.material.color.set(color);
    t.mesh.visible = true;
    return t;
  }

  lightning(x, z) {
    const b = this.bolts.find((q) => q.t >= 1) || this.bolts[0];
    const p = b.line.geometry.attributes.position;
    let px = x + (Math.random() - 0.5) * 2, pz = z + (Math.random() - 0.5) * 2;
    for (let i = 0; i < 40; i++) {
      const y = 22 - (i / 39) * 22;
      const tt = i / 39;
      px += (Math.random() - 0.5) * 1.1; pz += (Math.random() - 0.5) * 1.1;
      p.setXYZ(i, px * (1 - tt) + x * tt, y, pz * (1 - tt) + z * tt);
    }
    p.needsUpdate = true;
    b.t = 0; b.dur = 0.28;
    b.line.visible = true;
    this.flashLight.position.set(x, 3, z);
    this.flashLight.intensity = 60;
    this.flashT = 0.25;
    this.sparks(x, 0.3, z, 0xfff6a8, 40, 9);
    this.ring(x, 0.05, z, 0xfff27a, 2.6, 0.35);
    this.dust(x, z, 1.5);
  }

  update(dt) {
    this.real.update(dt);
    // particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) { this.pPos[i3 + 1] = -999; this.pSize[i] = 0; continue; }
      const drag = Math.exp(-this.pDrag[i] * dt);
      this.pVel[i3] *= drag; this.pVel[i3 + 2] *= drag;
      this.pVel[i3 + 1] = this.pVel[i3 + 1] * drag - this.pGrav[i] * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      if (this.pPos[i3 + 1] < 0.02) { this.pPos[i3 + 1] = 0.02; this.pVel[i3 + 1] *= -0.3; }
      const k = this.pLife[i] / this.pMax[i];
      this.pSize[i] = this.pBase[i] * (0.4 + 0.6 * k);
      this.pCol[i3] = this.pColBase[i3] * k; this.pCol[i3 + 1] = this.pColBase[i3 + 1] * k; this.pCol[i3 + 2] = this.pColBase[i3 + 2] * k;
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true; g.color.needsUpdate = true; g.size.needsUpdate = true;

    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.dur);
      const e = 1 - Math.pow(1 - r.t, 3);
      r.mesh.scale.setScalar(0.2 + r.r * e);
      r.mesh.material.opacity = (1 - r.t) * 0.9;
      if (r.t >= 1) r.mesh.visible = false;
    }
    for (const c of this.cones) {
      if (c.t >= 1) continue;
      c.t = Math.min(1, c.t + dt / c.dur);
      const e = Math.min(1, c.t * 3);
      c.mesh.scale.set(c.len * 0.45 * e, c.len * 0.45 * e, c.len * e);
      c.mesh.material.opacity = (1 - c.t) * 0.28;
      if (c.t >= 1) c.mesh.visible = false;
    }
    for (const b of this.bolts) {
      if (b.t >= 1) continue;
      b.t = Math.min(1, b.t + dt / b.dur);
      b.line.material.opacity = (1 - b.t) * (Math.random() > 0.3 ? 1 : 0.3);
      if (b.t >= 1) b.line.visible = false;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity = Math.max(0, this.flashT / 0.25) * 60;
    }
    for (const t of this.telegraphs) {
      if (t.done) { if (t.mesh.visible) { t.mesh.material.opacity *= 0.8; if (t.mesh.material.opacity < 0.02) t.mesh.visible = false; } continue; }
      t.t += dt;
      t.mesh.material.opacity = 0.15 + 0.25 * Math.abs(Math.sin(t.t * 18));
    }
  }
}
