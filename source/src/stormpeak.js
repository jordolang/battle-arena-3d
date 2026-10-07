// Eye of the Storm: a mountaintop ring of standing stones above a sea of cloud.
// A wall of storm surrounds the summit and closes in three times a round, each time onto a smaller
// circle somewhere inside the last one. The next circle is marked on the ground before the wall moves.
// Standing in the storm burns, and lightning strikes inside it.
import * as THREE from 'three';
import { Stage, seeded } from './stage.js';
import { rockGeometry } from './battleground.js';

const R = 18;
const R0 = R + 1.2;                  // where the wall starts: just outside the summit
// [shrink starts, shrink ends, new radius]; the marker shows MARK seconds before each shrink
const STAGES = [[14, 24, 12.5], [38, 48, 8.5], [62, 72, 5]];
const MARK = 8;
const BURN = 8;                      // health per second inside the storm
const STONES = [[9.4, 0.35, 1.0], [9.4, 1.92, 0.9], [9.4, 3.5, 1.0], [9.4, 5.07, 0.9], [14.2, 1.1, 0.75], [14.2, 4.25, 0.75]];

function summitTexture() {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = seeded(808);
  g.fillStyle = '#3e4450'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2400; i++) {
    const x = rand() * size, y = rand() * size, r = 4 + rand() * 30;
    g.fillStyle = rand() > 0.75 ? `hsla(${110 + rand() * 30}, 18%, ${22 + rand() * 10}%, 0.25)` : `hsla(${210 + rand() * 20}, ${8 + rand() * 8}%, ${24 + rand() * 18}%, 0.2)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // the old carved circle in the middle of the summit
  g.strokeStyle = 'rgba(150,190,255,0.25)';
  g.lineWidth = 8;
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.14, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.24, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(size / 2 + Math.cos(a) * size * 0.14, size / 2 + Math.sin(a) * size * 0.14);
    g.lineTo(size / 2 + Math.cos(a) * size * 0.24, size / 2 + Math.sin(a) * size * 0.24); g.stroke();
  }
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(220,230,255,0.06)';
    g.fillRect(rand() * size, rand() * size, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class StormPeak extends Stage {
  constructor(scene, quality) {
    super(scene, 'storm', R);
    this.background = new THREE.Color(0x10131c);
    this.fog = new THREE.Fog(0x1c2030, 30, 120);
    this.pads = [0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2 + 1.13; return { x: Math.cos(a) * 5, z: Math.sin(a) * 5 }; });

    this.buildSky();
    this.buildLights(quality);
    this.buildSummit();
    this.buildStones();
    this.buildStorm();
    this.addParticles(260, 26, 12, 0x9ac8ff, 0.5);
    this.buildFireRing();
    this.newRound(0);
  }

  buildSky() {
    this.addSky(`
      varying vec3 vDir; uniform float time; uniform float flash;
      void main(){
        float h = vDir.y;
        vec3 col = mix(vec3(0.16,0.18,0.26), vec3(0.05,0.06,0.10), smoothstep(-0.1, 0.5, h));
        float a = atan(vDir.z, vDir.x);
        float cl = sin(a * 5.0 + time * 0.07 + h * 8.0) * sin(a * 3.0 - time * 0.05 - h * 5.0) * 0.5 + 0.5;
        col = mix(col, vec3(0.22,0.24,0.34), cl * smoothstep(0.0, 0.25, h) * 0.6);
        col += vec3(0.5,0.55,0.9) * flash * (0.4 + 0.6 * cl) * smoothstep(-0.05, 0.3, h);
        gl_FragColor = vec4(col, 1.0);
      }`);
    this.sky.material.uniforms.flash = { value: 0 };
  }

  buildLights(quality) {
    this.hemi = new THREE.HemisphereLight(0x9ab0e8, 0x20242c, 1.0);
    this.group.add(this.hemi);
    this.addSun(0xc8d8ff, 2.2, [12, 28, 10], quality, 22);
    const rim = new THREE.DirectionalLight(0x9a6aff, 0.6);
    rim.position.set(-16, 8, -18);
    this.group.add(rim);
  }

  buildSummit() {
    const tex = summitTexture();
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R + 1.6, 96),
      new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.8, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    // the summit's broken rim: rocks all round the edge, and the mountain falling away below it
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5060, roughness: 0.95, flatShading: true });
    const n = 70;
    const rim = new THREE.InstancedMesh(rockGeometry(61, 1), rockMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const rand = seeded(12);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.04;
      const rr = R + 1.1 + rand() * 0.9;
      p.set(Math.cos(a) * rr, 0.2 + rand() * 0.4, Math.sin(a) * rr);
      s.set(0.8 + rand() * 0.9, 0.5 + rand() * 1.1, 0.8 + rand() * 0.9);
      q.setFromEuler(e.set(rand() * 0.5, rand() * 6, rand() * 0.5));
      rim.setMatrixAt(i, m.compose(p, q, s));
    }
    rim.castShadow = true; rim.receiveShadow = true;
    const mountain = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.6, R + 26, 40, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c303a, roughness: 1 }));
    mountain.position.y = -20.05;
    this.group.add(rim, mountain);
    // far peaks poking through the clouds
    const peaks = new THREE.InstancedMesh(rockGeometry(3, 1), new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 1, flatShading: true }), 14);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rand();
      const rr = 70 + rand() * 50;
      p.set(Math.cos(a) * rr, -6 + rand() * 8, Math.sin(a) * rr);
      s.set(8 + rand() * 10, 14 + rand() * 18, 8 + rand() * 10);
      q.setFromEuler(e.set(0, rand() * 6, 0));
      peaks.setMatrixAt(i, m.compose(p, q, s));
    }
    this.group.add(peaks);
    const clouds = new THREE.Mesh(new THREE.RingGeometry(R + 8, 200, 48, 1), new THREE.MeshBasicMaterial({ color: 0x2a3044, transparent: true, opacity: 0.85 }));
    clouds.rotation.x = -Math.PI / 2; clouds.position.y = -8;
    this.group.add(clouds);
  }

  buildStones() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.85, flatShading: true });
    this.glyphMat = new THREE.MeshStandardMaterial({ color: 0x050a20, emissive: 0x6aa8ff, emissiveIntensity: 1.2 });
    const geo = rockGeometry(44, 1);
    STONES.forEach(([d, a, r], i) => {
      const h = [4.2, 3.2, 4.6, 2.8, 2.4, 2.6][i];
      const g = new THREE.Group();
      const stone = new THREE.Mesh(geo, mat);
      stone.scale.set(r * 0.95, h / 2, r * 0.75);
      stone.position.y = h / 2 - 0.1;
      stone.rotation.y = a;
      stone.castShadow = true; stone.receiveShadow = true;
      const glyph = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55, 0.05, 6, 20), this.glyphMat);
      glyph.position.y = Math.min(h - 0.5, 1.7);
      glyph.rotation.y = a;
      g.add(stone, glyph);
      this.addPillar(Math.cos(a) * d, Math.sin(a) * d, r, g);
    });
  }

  buildStorm() {
    // the wall: an open cylinder scaled to the current circle
    this.wallMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, surge: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float time; uniform float surge;
        void main(){
          float x = vUv.x * 60.0, y = vUv.y;
          float n = sin(x * 1.3 + time * 1.7 + y * 6.0) * 0.5 + sin(x * 3.1 - time * 2.3 - y * 9.0) * 0.3 + sin(x * 7.7 + time * 4.1) * 0.2;
          float bolt = smoothstep(0.92, 1.0, sin(x * 0.7 + time * 0.9 + sin(y * 20.0 + time * 13.0) * 0.6));
          float a = (0.22 + 0.18 * n) * (1.0 - smoothstep(0.35, 1.0, y)) + bolt * 0.5 * (1.0 - y);
          a *= 0.8 + surge * 0.8;
          vec3 c = mix(vec3(0.35,0.25,0.9), vec3(0.7,0.85,1.0), bolt + n * 0.2);
          gl_FragColor = vec4(c * a, a);
        }`,
    });
    this.uniforms.push(this.wallMat.uniforms.time);
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 14, 128, 1, true).translate(0, 7, 0), this.wallMat);
    this.group.add(this.wall);
    // the storm floor: dark and crackling everywhere outside the circle
    this.floorMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 }, center: { value: new THREE.Vector2() }, radius: { value: R0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = vec2(position.x, -position.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float time; uniform vec2 center; uniform float radius;
        void main(){
          float d = length(vP - center);
          float out_ = smoothstep(radius - 0.2, radius + 0.5, d);
          float n = sin(vP.x * 1.7 + time * 2.0) * sin(vP.y * 1.9 - time * 1.6) * 0.5 + 0.5;
          float edge = smoothstep(0.6, 0.0, abs(d - radius)) ;
          vec3 c = mix(vec3(0.12,0.06,0.3), vec3(0.3,0.2,0.8), n);
          float a = out_ * (0.45 + 0.15 * n) + edge * 0.6;
          gl_FragColor = vec4(c + edge * vec3(0.4,0.5,1.0), a);
        }`,
    });
    this.uniforms.push(this.floorMat.uniforms.time);
    const overlay = new THREE.Mesh(new THREE.CircleGeometry(R + 1.6, 96), this.floorMat);
    overlay.rotation.x = -Math.PI / 2; overlay.position.y = 0.03;
    this.group.add(overlay);
    // where the storm is going next
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2), this.markMat);
    this.mark.position.y = 0.05;
    this.mark.visible = false;
    this.group.add(this.mark);
  }

  // Each round's circles: every new one sits somewhere inside the one before.
  newRound(round) {
    const rand = seeded(round * 6151 + 3);
    let cx = 0, cz = 0, r = R0;
    this.circles = [{ x: 0, z: 0, r: R0 }];
    for (const [, , nr] of STAGES) {
      const slack = Math.max(0, Math.min(r - nr, R - nr) * 0.7);
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * slack;
      let nx = cx + Math.cos(a) * d, nz = cz + Math.sin(a) * d;
      const out = Math.hypot(nx, nz) + nr - R;
      if (out > 0) { const l = Math.hypot(nx, nz) || 1; nx -= (nx / l) * out; nz -= (nz / l) * out; }
      cx = nx; cz = nz; r = nr;
      this.circles.push({ x: cx, z: cz, r });
    }
    this.strikeAt = 0;
    this.closing = new Set();
  }

  // The storm's circle at fight time t, and the one it is heading for (if a shrink is coming or under way).
  zone(t) {
    let cur = this.circles[0], next = null, moving = false;
    for (let i = 0; i < STAGES.length; i++) {
      const [t0, t1] = STAGES[i], a = this.circles[i], b = this.circles[i + 1];
      if (t >= t1) { cur = b; continue; }
      if (t >= t0) {
        const k = smooth(t0, t1, t);
        cur = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, r: a.r + (b.r - a.r) * k };
        next = b; moving = true;
      } else if (t >= t0 - MARK) next = b;
      break;
    }
    return { ...cur, next, moving };
  }

  // Never linger in the storm, and get inside the coming circle shortly before the wall moves.
  danger(x, z, game) {
    const t = this.clock(game), zn = this.zone(t);
    const toward = (c) => { const d = Math.hypot(c.x - x, c.z - z); return d > 1e-3 ? { x: (c.x - x) / d, z: (c.z - z) / d } : null; };
    if (Math.hypot(x - zn.x, z - zn.z) > zn.r - 1.6) return toward(zn);
    const n = zn.next;
    if (n && (zn.moving || this.nextShrink(t) - t < 4) && Math.hypot(x - n.x, z - n.z) > n.r - 1.2) return toward(n);
    return null;
  }

  nextShrink(t) { for (const [t0] of STAGES) if (t0 > t) return t0; return Infinity; }

  tickHazards(dt, game) {
    const t = this.clock(game);
    const zn = this.zone(t);
    STAGES.forEach(([t0], i) => {
      if (t >= t0 && !this.closing.has(i)) {
        this.closing.add(i);
        if (t - t0 > 1) return;
        game.events.emit('hazard', { kind: 'storm', x: zn.x, z: zn.z });
        this.tell(game, `storm${i}`, '<b class="fire">The storm</b> <span>closes in. Get inside the ring.</span>');
      }
    });
    for (const f of game.fighters) {
      if (!f.alive || Math.hypot(f.pos.x - zn.x, f.pos.z - zn.z) <= zn.r) continue;
      this.hurt(f, game, dt * BURN * (zn.r < 9 ? 1.4 : 1), 'The storm');
      if (Math.random() < dt * 3) game.effects.sparks(f.pos.x, 1, f.pos.z, 0x9ab0ff, 4, 3);
    }
    // lightning strikes somewhere in the storm, and on anyone caught standing in it
    if (t > 2 && t >= this.strikeAt) {
      this.strikeAt = t + 1.4 + Math.random() * 1.8;
      const outside = game.fighters.filter((f) => f.alive && Math.hypot(f.pos.x - zn.x, f.pos.z - zn.z) > zn.r + 0.5);
      let x, z;
      if (outside.length && Math.random() < 0.5) {
        const f = outside[(Math.random() * outside.length) | 0];
        x = f.pos.x + (Math.random() - 0.5) * 2; z = f.pos.z + (Math.random() - 0.5) * 2;
      } else {
        const a = Math.random() * Math.PI * 2, d = zn.r + 1 + Math.random() * 6;
        x = zn.x + Math.cos(a) * d; z = zn.z + Math.sin(a) * d;
        if (Math.hypot(x, z) > R) return;
      }
      game.effects.lightning(x, z);
      game.events.emit('hazard', { kind: 'strike', x, z });
      for (const f of game.fighters) {
        if (!f.alive || Math.hypot(f.pos.x - x, f.pos.z - z) > 1.8 || Math.hypot(f.pos.x - zn.x, f.pos.z - zn.z) <= zn.r) continue;
        this.hurt(f, game, 10, 'The storm');
        this.launch(f, x, z, 5, 4);
      }
    }
  }

  animate(dt, game, t) {
    const zn = this.zone(t);
    this.wall.position.set(zn.x, 0, zn.z);
    this.wall.scale.set(zn.r, 1, zn.r);
    this.wallMat.uniforms.surge.value = zn.moving ? 1 : 0;
    this.floorMat.uniforms.center.value.set(zn.x, zn.z);
    this.floorMat.uniforms.radius.value = zn.r;
    if (zn.next) {
      this.mark.visible = true;
      this.mark.position.set(zn.next.x, 0.05, zn.next.z);
      this.mark.scale.set(zn.next.r, 1, zn.next.r);
      this.markMat.opacity = 0.35 + 0.3 * Math.sin(this.time * 6);
    } else this.mark.visible = false;
    // sheet lightning in the clouds
    const f = Math.max(0, Math.sin(this.time * 0.9) * Math.sin(this.time * 2.3) * Math.sin(this.time * 5.1) - 0.55) * 3;
    this.sky.material.uniforms.flash.value = f;
    this.hemi.intensity = 1.0 + f * 1.2;
    this.glyphMat.emissiveIntensity = 1 + 0.5 * Math.sin(this.time * 2) + (zn.moving ? 1 : 0);
  }
}
