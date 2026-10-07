// The Sky Bridge: a long stone bridge over a bottomless chasm, gated at both ends.
// From the 18th second of each round its slabs start to crack (they glow and shudder for three seconds)
// and then drop away, ends first, until only the middle span is left. Anyone standing on a slab when
// it goes falls with it, and so does anyone knocked or walking off an edge: a fall is a knockout,
// credited to whoever hit them last.
import * as THREE from 'three';
import { Stage, seeded } from './stage.js';
import { rockGeometry } from './battleground.js';

const HW = 7;        // half width of the deck
const HL = 21;       // half length, gate to gate
const ROW = 3;       // slab length along the bridge
const ROWS = (2 * HL) / ROW;
const T0 = 18;       // first slab cracks
const EVERY = 3.4;   // then another every few seconds
const WARN = 3;      // seconds a slab glows before it drops
const FALL_KO = -2.5;

function paverTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = seeded(311);
  g.fillStyle = '#5d5a58'; g.fillRect(0, 0, size, size);
  const n = 4;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const off = (y % 2) * (size / n / 2);
      g.fillStyle = `hsl(${210 + rand() * 30}, ${4 + rand() * 6}%, ${30 + rand() * 12}%)`;
      g.fillRect(x * (size / n) + off + 3, y * (size / n) + 3, size / n - 6, size / n - 6);
    }
  }
  g.strokeStyle = 'rgba(20,20,26,0.5)';
  for (let i = 0; i < 40; i++) {
    let x = rand() * size, y = rand() * size;
    g.lineWidth = 0.6 + rand();
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.15)' : 'rgba(200,220,255,0.05)';
    g.fillRect(rand() * size, rand() * size, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Glowing fracture lines for a slab about to drop.
function crackTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const rand = seeded(77);
  g.strokeStyle = '#fff';
  for (let i = 0; i < 9; i++) {
    let x = size / 2 + (rand() - 0.5) * 60, y = size / 2 + (rand() - 0.5) * 60;
    g.lineWidth = 1.5 + rand() * 2.5;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (rand() - 0.5) * 70; y += (rand() - 0.5) * 70; g.lineTo(x, y); }
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class SkyBridge extends Stage {
  constructor(scene, quality) {
    super(scene, 'bridge', HL);
    this.camDistance = 40;
    this.background = new THREE.Color(0x141a2c);
    this.fog = new THREE.Fog(0x232c48, 34, 150);
    this.pads = [[-3.5, -1.5], [3.5, 1.5], [3.5, -1.5], [-3.5, 1.5]].map(([x, z]) => ({ x, z }));

    // slabs: two per row (left and right of the centre line)
    this.tiles = [];
    for (let r = 0; r < ROWS; r++) {
      for (let s = 0; s < 2; s++) {
        const z = -HL + ROW * (r + 0.5), x = (s ? 1 : -1) * HW / 2;
        this.tiles.push({ r, s, x, z, safe: Math.abs(z) < ROW, crackAt: Infinity, fallAt: Infinity, shown: '' });
      }
    }

    this.buildSky();
    this.buildLights(quality);
    this.buildDeck();
    this.buildGates();
    this.buildChasm();
    this.addParticles(220, 30, 14, 0x9ab8ff, 0.35);
    this.buildFireRing();
    this.newRound(0);
  }

  buildSky() {
    this.addSky(`
      varying vec3 vDir; uniform float time;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){
        float h = vDir.y;
        vec3 low = vec3(0.10,0.12,0.22), mid = vec3(0.16,0.20,0.38), top = vec3(0.02,0.03,0.08);
        vec3 col = mix(low, mid, smoothstep(-0.4, 0.05, h));
        col = mix(col, top, smoothstep(0.05, 0.8, h));
        vec3 cell = floor(vDir * 200.0);
        float s = hash(cell);
        col += vec3(step(0.997, s) * smoothstep(0.1, 0.5, h) * (0.6 + 0.4 * sin(time * 2.0 + s * 90.0)));
        vec3 md = normalize(vec3(0.5, 0.42, -0.75));
        float m = max(dot(vDir, md), 0.0);
        col += vec3(0.85,0.9,1.0) * smoothstep(0.9982, 0.999, m);
        col += vec3(0.3,0.4,0.7) * pow(m, 60.0) * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }`, 240);
  }

  buildLights(quality) {
    this.group.add(new THREE.HemisphereLight(0x8aa0e0, 0x1a1420, 1.0));
    this.addSun(0xd8e4ff, 2.3, [16, 26, -18], quality, HL + 3);
    const rim = new THREE.DirectionalLight(0xff9a5a, 0.5);
    rim.position.set(-18, 8, 20);
    this.group.add(rim);
    for (const z of [-HL - 0.6, HL + 0.6]) this.addFlicker(0xff8a3a, 24, 18, 0, 4.2, z);
  }

  buildDeck() {
    const tex = paverTexture();
    this.slabMat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.4, roughness: 0.9 });
    this.crackMat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.4, roughness: 0.9,
      emissive: 0xff5a1a, emissiveMap: crackTexture(), emissiveIntensity: 1.2 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x45434a, roughness: 0.95 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x6a6670, roughness: 0.8 });
    // two draws a slab: the deck stone and its stretch of parapet
    const slabGeo = new THREE.BoxGeometry(HW - 0.06, 1.8, ROW - 0.06);
    const railGeo = new THREE.BoxGeometry(0.55, 0.95, ROW - 0.02);
    for (const t of this.tiles) {
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.z);
      const slab = new THREE.Mesh(slabGeo, this.slabMat);
      slab.position.y = -0.9;
      const out = (t.s ? 1 : -1) * (HW / 2 + 0.25);
      const rail = new THREE.Mesh(railGeo, capMat);
      rail.position.set(out, 0.47, 0);
      for (const m of [slab, rail]) { m.castShadow = true; m.receiveShadow = true; }
      g.add(slab, rail);
      this.group.add(g);
      t.group = g;
      t.slab = slab;
    }
    // a hidden sample so the cracking material's shader is compiled with the rest, not on the first crack
    const sample = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), this.crackMat);
    sample.visible = false;
    this.group.add(sample);
    // the middle span stands on a pier that runs down into the dark
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 5, 60, 10), sideMat);
    pier.position.set(0, -31.5, 0);
    this.group.add(pier);
  }

  buildGates() {
    const stone = new THREE.MeshStandardMaterial({ color: 0x55525a, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1a20, roughness: 0.6, metalness: 0.6 });
    const flame = this.flameMaterial();
    const flameGeo = new THREE.ConeGeometry(0.4, 1.3, 10, 1, true);
    for (const side of [-1, 1]) {
      const z = side * (HL + 1.1);
      for (const x of [-HW - 1.3, HW + 1.3]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(2.6, 9, 2.6), stone);
        tower.position.set(x, 3.5, z);
        tower.castShadow = true; tower.receiveShadow = true;
        const top = new THREE.Mesh(new THREE.ConeGeometry(2.1, 2.4, 4), dark);
        top.position.set(x, 9.2, z); top.rotation.y = Math.PI / 4;
        this.group.add(tower, top);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 5, 1.6, 2.2), stone);
      lintel.position.set(0, 6.4, z);
      lintel.castShadow = true;
      // the gates are barred: the only way off the bridge is down
      const bars = new THREE.Mesh(new THREE.BoxGeometry(2 * HW, 5.6, 0.25), dark);
      bars.position.set(0, 2.8, z);
      bars.receiveShadow = true;
      this.group.add(lintel, bars);
      for (const x of [-HW + 0.6, HW - 0.6]) {
        const f = new THREE.Mesh(flameGeo, flame);
        f.position.set(x, 7.8, z - side * 0.2);
        this.group.add(f);
      }
      // the cliffs the bridge is anchored to
      const cliff = new THREE.Mesh(new THREE.BoxGeometry(90, 50, 30), new THREE.MeshStandardMaterial({ color: 0x2c2a34, roughness: 1 }));
      cliff.position.set(0, -25.6, side * (HL + 16.6));
      cliff.receiveShadow = true;
      this.group.add(cliff);
    }
    // jagged peaks behind each cliff
    const rocks = new THREE.InstancedMesh(rockGeometry(23, 1), new THREE.MeshStandardMaterial({ color: 0x34313c, roughness: 1, flatShading: true }), 28);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const rand = seeded(9);
    for (let i = 0; i < 28; i++) {
      const side = i % 2 ? 1 : -1;
      p.set((rand() - 0.5) * 80, -2 + rand() * 6, side * (HL + 6 + rand() * 20));
      if (Math.abs(p.x) < HW + 5 && Math.abs(p.z) < HL + 9) p.x += Math.sign(p.x || 1) * 12;
      s.set(4 + rand() * 5, 5 + rand() * 9, 4 + rand() * 5);
      q.setFromEuler(e.set(rand() * 0.3, rand() * 6, rand() * 0.3));
      rocks.setMatrixAt(i, m.compose(p, q, s));
    }
    rocks.castShadow = true;
    this.group.add(rocks);
  }

  // Sea of cloud far below, drifting.
  buildChasm() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float time;
        float n(vec2 p){ return sin(p.x*0.11+time*0.05)*sin(p.y*0.13-time*0.04) + 0.5*sin(p.x*0.27-time*0.09+p.y*0.21); }
        void main(){
          float d = length(vP) / 160.0;
          float c = 0.5 + 0.35 * n(vP) + 0.15 * n(vP * 2.3 + 7.0);
          vec3 col = mix(vec3(0.05,0.06,0.12), vec3(0.28,0.32,0.5), c);
          gl_FragColor = vec4(col, (1.0 - smoothstep(0.6, 1.0, d)) * 0.92);
        }`,
    });
    this.uniforms.push(mat.uniforms.time);
    const clouds = new THREE.Mesh(new THREE.CircleGeometry(160, 48), mat);
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = -16;
    this.group.add(clouds);
    const abyss = new THREE.Mesh(new THREE.CircleGeometry(200, 32), new THREE.MeshBasicMaterial({ color: 0x05060c }));
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.y = -40;
    this.group.add(abyss);
  }

  // Each round crumbles in a different order: roughly from the gates inward, never the middle span.
  newRound(round) {
    const rand = seeded(round * 7919 + 13);
    const doomed = this.tiles.filter((t) => !t.safe).map((t) => ({ t, k: Math.abs(t.z) + rand() * 7 })).sort((a, b) => b.k - a.k);
    doomed.forEach(({ t }, i) => { t.crackAt = T0 + i * EVERY; t.fallAt = t.crackAt + WARN; });
    this.dropped = new Set();
    this.cracked = new Set();
  }

  tileAt(x, z) {
    const r = Math.min(ROWS - 1, Math.max(0, Math.floor((z + HL) / ROW)));
    return this.tiles[r * 2 + (x < 0 ? 0 : 1)];
  }

  // Solid ground at 0, nothing at all where a slab has gone.
  floorAt(x, z, game) {
    return this.clock(game) >= this.tileAt(x, z).fallAt ? -Infinity : 0;
  }

  bound(x, z, r) {
    const cx = Math.max(-HW + r, Math.min(HW - r, x)), cz = Math.max(-HL + r, Math.min(HL - r, z));
    return cx !== x || cz !== z ? { x: cx, z: cz, hit: true } : null;
  }

  hazardSpots(game, x, z) {
    const t = this.clock(game), out = [];
    for (const tile of this.tiles) {
      if (t < tile.crackAt) continue;
      // nearest point of the slab
      const px = Math.max(tile.x - HW / 2, Math.min(tile.x + HW / 2, x)), pz = Math.max(tile.z - ROW / 2, Math.min(tile.z + ROW / 2, z));
      if (Math.hypot(px - x, pz - z) < 2.5) out.push({ x: px, z: pz, r: 0 });
    }
    return out;
  }

  // On a slab about to go: head for the nearest one that will hold.
  danger(x, z, game) {
    const t = this.clock(game);
    if (t < this.tileAt(x, z).crackAt) return null;
    let best = null, bd = Infinity;
    for (const tile of this.tiles) {
      if (t >= tile.crackAt) continue;
      const d = Math.hypot(tile.x - x, tile.z - z);
      if (d < bd) { bd = d; best = tile; }
    }
    if (!best) return null;
    return { x: (best.x - x) / bd, z: (best.z - z) / bd };
  }

  tickHazards(dt, game) {
    const t = this.clock(game);
    for (const tile of this.tiles) {
      // (only fresh ones: a guest who takes over a running match as host doesn't replay the old cracks)
      if (t >= tile.crackAt && !this.cracked.has(tile)) {
        this.cracked.add(tile);
        if (t - tile.crackAt > 0.5) continue;
        game.effects.dust(tile.x, tile.z, 0.8);
        game.events.emit('hazard', { kind: 'crack', x: tile.x, z: tile.z });
        this.tell(game, 'crack', '<b class="fire">The bridge</b> <span>is crumbling. Stay off the glowing stones.</span>');
      }
      if (t >= tile.fallAt && !this.dropped.has(tile)) {
        this.dropped.add(tile);
        if (t - tile.fallAt > 0.5) continue;
        game.effects.dust(tile.x, tile.z, 2);
        game.shake(0.18);
        game.events.emit('hazard', { kind: 'collapse', x: tile.x, z: tile.z });
      }
    }
    for (const f of game.fighters) {
      if (f.alive && f.pos.y < FALL_KO) {
        game.events.emit('hazard', { kind: 'fall', x: f.pos.x, z: f.pos.z });
        this.hurt(f, game, f.hp + 1, 'The fall');
        f.downed = 0; // nobody can pull you back up from the bottom of the chasm
      }
    }
  }

  animate(dt, game, t) {
    const pulse = 0.9 + 0.7 * Math.sin(this.time * 9);
    this.crackMat.emissiveIntensity = pulse;
    for (const tile of this.tiles) {
      const g = tile.group;
      if (t < tile.crackAt) {
        if (tile.shown !== 'solid') { tile.shown = 'solid'; g.visible = true; g.position.set(tile.x, 0, tile.z); g.rotation.set(0, 0, 0); tile.slab.material = this.slabMat; }
      } else if (t < tile.fallAt) {
        if (tile.shown !== 'crack') { tile.shown = 'crack'; g.visible = true; g.rotation.set(0, 0, 0); tile.slab.material = this.crackMat; }
        const k = (t - tile.crackAt) / WARN;
        const j = 0.015 + k * k * 0.06;
        g.position.set(tile.x + (Math.random() - 0.5) * j, -k * 0.08, tile.z + (Math.random() - 0.5) * j);
      } else {
        tile.shown = 'gone';
        const d = t - tile.fallAt;
        g.visible = d < 4;
        if (!g.visible) continue;
        g.position.set(tile.x, -7 * d * d, tile.z);
        g.rotation.set((tile.r % 2 ? 1 : -1) * d * 0.5, 0, (tile.s ? 1 : -1) * d * 0.35);
      }
    }
  }

  spawnPoints(list) {
    const n = list.length;
    const len = n <= 2 ? 6 : n <= 4 ? 9 : 12;
    return list.map((f, i) => {
      const a = Math.PI / 2 + (n === 2 ? 0 : Math.PI / n) + (i / n) * Math.PI * 2;
      const x = Math.cos(a) * 4.2, z = Math.sin(a) * len;
      return { x, z, facing: Math.atan2(-x, -z) };
    });
  }
}
