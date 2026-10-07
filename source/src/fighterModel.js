// Procedural articulated fighter: a jointed hierarchy of sculpted body parts driven by
// motion-captured clips (mocapData.js) plus hand-made poses for the moves no clip covers. Faces, hands and muscled limbs
// are built from lathed profiles and merged per material, so each fighter stays at about
// thirty draw calls however much detail it carries.
import * as THREE from 'three';
import { buildGear, buildArmor } from './items.js';
import { swayCape } from './wardrobeModels.js';
import { MOCAP, MOCAP_FPS } from './mocapData.js';

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const capsule = (r, len) => geo(`cap${r}_${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 12));
const sphere = (r) => geo(`sph${r}`, () => new THREE.SphereGeometry(r, 20, 14));
const box = (x, y, z) => geo(`box${x}_${y}_${z}`, () => new THREE.BoxGeometry(x, y, z));
// coarser shapes for small features, to keep eight detailed fighters cheap to draw
const sphereLo = (r) => geo(`sphLo${r}`, () => new THREE.SphereGeometry(r, 12, 8));
const capLo = (r, len) => geo(`capLo${r}_${len}`, () => new THREE.CapsuleGeometry(r, len, 3, 8));
// A limb segment from a [radius, y] profile, pivot at y=0 and hanging down -Y.
const lathe = (key, pts, seg = 14) => geo(`lathe_${key}`, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));

// Bakes several placed geometries into one (they all share a material), so a detailed
// head or hand costs a single draw call. Cached by `key`.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function merged(key, parts) {
  return geo(`merged_${key}`, () => {
    const pos = [], nor = [], uv = [];
    for (const [g, p = [0, 0, 0], r = [0, 0, 0], sc = [1, 1, 1]] of parts) {
      const src = g.index ? g.toNonIndexed() : g.clone();
      _m.compose(_v.set(...p), _q.setFromEuler(_e.set(...r)), _s.set(...sc));
      src.applyMatrix4(_m);
      pos.push(...src.attributes.position.array);
      nor.push(...src.attributes.normal.array);
      if (src.attributes.uv) uv.push(...src.attributes.uv.array);
      else uv.push(...new Float32Array(src.attributes.position.count * 2));
      src.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  });
}

// Joint names used by poses.
export const JOINTS = ['hips', 'spine', 'chest', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR'];

import { UPPER_ARM, SLEEVE, FOREARM, THIGH, SHIN } from './bodyShapes.js';
const NECK = [[0, -0.02], [0.058, -0.015], [0.055, 0.08], [0.05, 0.13], [0, 0.135]];

// Hair styles: [geometry, position, rotation, scale] parts merged into one mesh.
function hairParts(style) {
  const cap = (s = 1) => [geo('haircap', () => new THREE.SphereGeometry(0.133, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52)), [0, 0.165, -0.008], [-0.18, 0, 0], [0.96 * s, 1.0 * s, 1.04 * s]];
  switch (style) {
    case 'short': return [cap()];
    case 'topknot': return [cap(), [sphereLo(0.05), [0, 0.31, -0.05]], [capLo(0.022, 0.16), [0, 0.24, -0.17], [1.1, 0, 0]]];
    case 'long': return [cap(1.02), [capsule(0.1, 0.2), [0, 0.06, -0.08], [0.15, 0, 0], [1.2, 1, 0.45]]];
    case 'mohawk': return [[box(0.05, 0.13, 0.28), [0, 0.3, -0.01], [-0.15, 0, 0]], [box(0.045, 0.1, 0.12), [0, 0.22, -0.14], [-0.9, 0, 0]]];
    case 'spiky': {
      const spike = geo('spike', () => new THREE.ConeGeometry(0.035, 0.12, 5));
      const out = [cap()];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        out.push([spike, [Math.sin(a) * 0.08, 0.27, Math.cos(a) * 0.08 - 0.02], [Math.cos(a) * 0.6 - 0.2, 0, -Math.sin(a) * 0.6]]);
      }
      out.push([spike, [0, 0.31, -0.02], [-0.2, 0, 0]]);
      return out;
    }
    case 'braids': {
      const out = [cap()];
      for (const x of [-0.07, 0, 0.07]) out.push([capLo(0.022, 0.26), [x, 0.07, -0.13], [0.25, 0, x * 2]]);
      return out;
    }
    default: return []; // bald
  }
}

function buildHead(def, head, skinMat, hairMat, giMat, eyeMat) {
  // skull, jaw, cheekbones, nose, brow and ears in one skin mesh
  const skin = new THREE.Mesh(merged(`head_${def.id}`, [
    [lathe('neck', NECK, 12), [0, 0, 0]],
    [sphere(0.125), [0, 0.165, 0], [0, 0, 0], [0.9, 1.05, 1.0]],
    [sphere(0.095), [0, 0.095, 0.032], [0, 0, 0], [0.92, 0.78, 1.0]],
    [sphereLo(0.04), [0.058, 0.135, 0.075], [0, 0, 0], [1, 0.7, 0.8]],
    [sphereLo(0.04), [-0.058, 0.135, 0.075], [0, 0, 0], [1, 0.7, 0.8]],
    [geo('nose', () => new THREE.ConeGeometry(0.022, 0.06, 4)), [0, 0.148, 0.122], [1.35, Math.PI / 4, 0], [1, 1, 0.8]],
    [box(0.17, 0.026, 0.04), [0, 0.19, 0.103], [0.2, 0, 0]],
    [sphereLo(0.032), [0.118, 0.155, -0.005], [0, 0, 0], [0.45, 1, 0.75]],
    [sphereLo(0.032), [-0.118, 0.155, -0.005], [0, 0, 0], [0.45, 1, 0.75]],
  ]), skinMat);
  skin.castShadow = true;
  head.add(skin);
  // eyes: white globes with a coloured, faintly glowing iris; the group squashes to blink
  const eyes = new THREE.Group();
  eyes.position.set(0, 0.165, 0.1);
  const white = new THREE.Mesh(merged('sclera', [[sphereLo(0.019), [0.042, 0, 0]], [sphereLo(0.019), [-0.042, 0, 0]]]),
    geo('scleraMat', () => new THREE.MeshStandardMaterial({ color: 0xf2ece4, roughness: 0.25 })));
  const iris = new THREE.Mesh(merged('iris', [[sphereLo(0.0105), [0.042, 0, 0.013]], [sphereLo(0.0105), [-0.042, 0, 0.013]]]), eyeMat);
  eyes.add(white, iris);
  head.add(eyes);
  const mouth = new THREE.Mesh(box(0.048, 0.008, 0.012), geo('mouthMat', () => new THREE.MeshStandardMaterial({ color: 0x3a1a16, roughness: 0.8 })));
  mouth.position.set(0, 0.088, 0.118);
  head.add(mouth);
  const hp = hairParts(def.hairStyle);
  // a short beard along the jaw line, leaving the mouth clear
  if (def.beard) hp.push([geo('beard', () => new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI, Math.PI * 0.6, Math.PI * 0.32)), [0, 0.1, 0.03], [0, 0, 0], [0.97, 1.0, 1.04]]);
  let hair = null;
  if (hp.length) {
    hair = new THREE.Mesh(merged(`hair_${def.hairStyle}_${def.beard ? 1 : 0}`, hp), hairMat);
    hair.castShadow = true;
    head.add(hair);
  }
  if (def.mask) {
    const mask = new THREE.Mesh(geo('mask', () => new THREE.SphereGeometry(0.108, 16, 8, -Math.PI * 0.05, Math.PI * 1.1, Math.PI * 0.45, Math.PI * 0.4)), giMat);
    mask.position.set(0, 0.15, 0.02);
    mask.scale.set(0.98, 1.1, 1.06);
    head.add(mask);
  }
  return { eyes, hair };
}

function buildHand(side) {
  // a clenched fist: palm, a row of knuckles and a thumb wrapped across the front
  const sx = side === 'L' ? 1 : -1;
  return merged(`fist_${side}`, [
    [sphereLo(0.05), [0, 0, 0], [0, 0, 0], [0.95, 1.1, 0.95]],
    [capLo(0.026, 0.06), [0, -0.045, 0.028], [0, 0, Math.PI / 2], [1, 1, 1.05]],
    [capLo(0.024, 0.055), [0, -0.02, 0.05], [0, 0, Math.PI / 2], [1, 1, 1]],
    [capLo(0.018, 0.04), [-sx * 0.035, -0.03, 0.045], [0.3, 0, sx * 0.6]],
  ]);
}

export function buildFighterModel(def) {
  const giMat = new THREE.MeshStandardMaterial({ color: def.gi, roughness: 0.78, metalness: 0.02 });
  const trimMat = new THREE.MeshStandardMaterial({ color: def.trim, roughness: 0.8, metalness: 0.05 });
  const skinMat = new THREE.MeshStandardMaterial({ color: def.skin ?? 0x8a5a3c, roughness: 0.58, metalness: 0.0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xa8b0bc, roughness: 0.3, metalness: 0.55 });
  const hairMat = new THREE.MeshStandardMaterial({ color: def.hair ?? 0x1a1210, roughness: 0.85, metalness: 0.0 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: def.eyes, emissive: def.eyes, emissiveIntensity: 1.1, roughness: 0.2 });
  const mats = [giMat, trimMat, skinMat, metalMat, hairMat];

  const root = new THREE.Group();      // world position + facing
  const body = new THREE.Group();      // falls over as a whole (pivot at the feet)
  root.add(body);
  const s = def.scale;
  body.scale.setScalar(s);
  const mesh = (g, m, shadow = true) => { const o = new THREE.Mesh(g, m); o.castShadow = shadow; return o; };

  const J = {};
  const hips = new THREE.Group(); hips.position.y = 0.98; body.add(hips); J.hips = hips;
  const pelvis = mesh(sphere(0.19), giMat); pelvis.scale.set(1.0, 0.62, 0.76); pelvis.position.y = -0.02; hips.add(pelvis);
  // knotted sash with two tails that swing as the fighter moves
  const belt = mesh(geo('belt', () => new THREE.TorusGeometry(0.165, 0.03, 8, 24).rotateX(Math.PI / 2)), trimMat, false);
  belt.scale.set(1.0, 1, 0.8); belt.position.y = 0.06; hips.add(belt);
  const tails = new THREE.Group(); tails.position.set(0.09, 0.05, 0.12); hips.add(tails);
  tails.add(mesh(merged('sashTails', [[box(0.05, 0.22, 0.012), [-0.02, -0.1, 0], [0, 0, 0.12]], [box(0.05, 0.19, 0.012), [0.035, -0.09, 0], [0, 0, -0.1]]]), trimMat, false));

  const spine = new THREE.Group(); spine.position.y = 0.1; hips.add(spine); J.spine = spine;
  const abdomen = mesh(capsule(0.15, 0.14), giMat); abdomen.position.y = 0.12; abdomen.scale.set(1.05, 1, 0.82); spine.add(abdomen);
  const chest = new THREE.Group(); chest.position.y = 0.26; spine.add(chest); J.chest = chest;
  // ribcage under a wrap-over tunic, with skin showing at the open collar
  const torso = mesh(sphere(0.2), giMat); torso.position.y = 0.12; torso.scale.set(1.24, 1.22, 0.84); chest.add(torso);
  const collar = mesh(merged('collar', [[sphereLo(0.06), [0.08, 0.28, 0.0], [0, 0, 0], [1.4, 0.6, 1.0]], [sphereLo(0.06), [-0.08, 0.28, 0.0], [0, 0, 0], [1.4, 0.6, 1.0]]]), skinMat, false);
  chest.add(collar);
  const parts = { pelvis, belt, tails, abdomen, torso, collar, sleeve: {}, upperArm: {}, wrap: {}, fist: {}, thigh: {}, shin: {}, ankle: {}, foot: {} };
  const lapel = mesh(box(0.06, 0.34, 0.03), trimMat, false); parts.lapel = lapel; lapel.position.set(0.03, 0.12, 0.165); lapel.rotation.set(-0.12, 0, 0.42); chest.add(lapel);

  const head = new THREE.Group(); head.position.y = 0.38; chest.add(head); J.head = head;
  const { eyes, hair } = buildHead(def, head, skinMat, hairMat, giMat, eyeMat);
  const extras = addAccessory(def.accessory, head, chest, { giMat, trimMat, metalMat });

  let grip = null, hand = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;  // fighter faces +Z, so its left is +X
    const sh = new THREE.Group(); sh.name = 'sh' + side; sh.position.set(sx * 0.29, 0.25, 0); chest.add(sh); J['sh' + side] = sh;
    sh.add(parts.upperArm[side] = mesh(lathe('upperArm', UPPER_ARM), skinMat));
    sh.add(parts.sleeve[side] = mesh(lathe('sleeve', SLEEVE), giMat));
    const el = new THREE.Group(); el.name = 'el' + side; el.position.y = -0.31; sh.add(el); J['el' + side] = el;
    el.add(mesh(lathe('forearm', FOREARM), skinMat));
    const wrap = mesh(geo('wrap', () => new THREE.CylinderGeometry(0.046, 0.05, 0.11, 12)), trimMat, false); wrap.position.y = -0.2; el.add(wrap); parts.wrap[side] = wrap;
    const fist = mesh(buildHand(side), skinMat); fist.position.y = -0.31; el.add(fist); parts.fist[side] = fist;
    el.userData.fist = fist;
    hand[side] = el;
    if (side === 'R') {
      // weapons sit in the right fist, pointing along the forearm and tipped forward
      grip = new THREE.Group(); grip.position.set(0, -0.32, 0.01); el.add(grip);
    }
    if (def.accessory === 'pads') {
      const pad = mesh(sphere(0.13), metalMat); pad.scale.set(1.1, 0.7, 1.1); pad.position.set(sx * 0.04, 0.03, 0);
      sh.add(pad);
    }

    const hip = new THREE.Group(); hip.name = 'hip' + side; hip.position.set(sx * 0.11, -0.05, 0); hips.add(hip); J['hip' + side] = hip;
    hip.add(parts.thigh[side] = mesh(lathe('thigh', THIGH), giMat));
    const kn = new THREE.Group(); kn.name = 'kn' + side; kn.position.y = -0.46; hip.add(kn); J['kn' + side] = kn;
    kn.add(parts.shin[side] = mesh(lathe('shin', SHIN), giMat));
    const ankle = mesh(geo('ankleWrap', () => new THREE.CylinderGeometry(0.052, 0.056, 0.12, 12)), trimMat, false); ankle.position.y = -0.36; kn.add(ankle); parts.ankle[side] = ankle;
    const foot = mesh(merged('foot', [[sphereLo(0.06), [0, 0, 0.03], [0, 0, 0], [0.95, 0.75, 2.0]], [box(0.11, 0.025, 0.25), [0, -0.035, 0.035]]]), trimMat);
    foot.position.set(0, -0.475, 0.0); kn.add(foot); parts.foot[side] = foot;
  }

  // Floor marker in the fighter's colour so everyone can be told apart.
  const ring = new THREE.Mesh(
    geo('ring', () => new THREE.RingGeometry(0.52, 0.68, 40).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: def.eyes, transparent: true, opacity: 0.75, depthWrite: false })
  );
  ring.position.y = 0.025;
  ring.renderOrder = 1;
  root.add(ring);

  // Ice shell shown while frozen, armor glow while Iron Will is up.
  const ice = new THREE.Mesh(capsule(0.48, 1.0), new THREE.MeshStandardMaterial({
    color: 0xbfe9ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45, emissive: 0x2a6f9a, emissiveIntensity: 0.6,
  }));
  ice.position.y = 0.95; ice.visible = false; body.add(ice);
  const aura = new THREE.Mesh(capsule(0.55, 1.0), new THREE.MeshBasicMaterial({
    color: def.eyes, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  aura.position.y = 0.95; aura.visible = false; body.add(aura);
  // Barrier bubble for shield skills; lives on the root so it stays up while the body flickers.
  const shell = new THREE.Mesh(geo('shell', () => new THREE.SphereGeometry(1, 24, 16)), new THREE.MeshBasicMaterial({
    color: 0x9fe8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  shell.scale.set(0.8 * s, 1.15 * s, 0.8 * s); shell.position.y = 1.0 * s; shell.visible = false; root.add(shell);

  // Gear slots: the right fist holds a weapon or a drawn gun, a gun not in use rides on the right hip,
  // and Iron Armor adds a helm and breastplate.
  const holster = new THREE.Group(); holster.position.set(-0.2, -0.02, 0.03); holster.rotation.set(Math.PI / 2 + 0.15, 0, -0.1); holster.scale.setScalar(0.85); hips.add(holster);
  const armor = buildArmor(); armor.helm.visible = armor.chest.visible = false; head.add(armor.helm); chest.add(armor.chest);

  const rest = {};
  for (const k of JOINTS) rest[k] = { x: 0, y: 0, z: 0 };
  return {
    root, body, joints: J, ring, ice, aura, shell, mats, eyeMat, current: rest, hipsBaseY: 0.98,
    torso, eyes, tails, grip, holster, armor, gear: {}, held: null, holstered: null,
    parts, skinMat, hair, headExtras: extras.head, builtinCape: extras.cape, cape: null, victory: 'fist',
    blinkAt: 1 + Math.random() * 3, lookYaw: 0,
  };
}

// Shows `kind` (a weapon or gun id, or null) in the right fist, and `holstered` (a gun id or null) on the hip.
export function setGear(model, held, holstered) {
  if (model.held !== held) {
    if (model.held) model.gear['hand_' + model.held].visible = false;
    if (held) {
      const key = 'hand_' + held;
      if (!model.gear[key]) {
        const g = buildGear(held);
        const gun = held === 'pistol' || held === 'shotgun' || held === 'rifle';
        // melee weapons continue the forearm, tipped toward the knuckles; guns point their barrel the same way
        if (gun) g.rotation.set(Math.PI / 2, 0, 0); else g.rotation.set(Math.PI - 0.5, 0, 0);
        if (gun) g.position.set(0, 0.02, 0.03);
        model.grip.add(g);
        model.gear[key] = g;
      }
      model.gear[key].visible = true;
      model.joints.elR.userData.fist.visible = true;
    }
    model.held = held;
  }
  if (model.holstered !== holstered) {
    if (model.holstered) model.gear['hip_' + model.holstered].visible = false;
    if (holstered) {
      const key = 'hip_' + holstered;
      if (!model.gear[key]) { model.gear[key] = buildGear(holstered); model.holster.add(model.gear[key]); }
      model.gear[key].visible = true;
    }
    model.holstered = holstered;
  }
}

export function setArmorVisible(model, on) {
  model.armor.helm.visible = on;
  model.armor.chest.visible = on;
}

// Small signs of life on top of the pose: breathing, blinking, glancing at the nearest foe and a
// sash that trails behind when running. `lookAt` is a world-space yaw to look toward, or null.
export function animateLife(model, f, dt, lookAt) {
  const breath = Math.sin(f.animTime * (f.exhausted ? 5.5 : 2.1)) * (f.exhausted ? 0.035 : 0.014);
  model.torso.scale.set(1.24 + breath * 0.6, 1.22 + breath, 0.84 + breath * 1.2);
  model.blinkAt -= dt;
  let lid = 1;
  if (model.blinkAt < 0) {
    lid = Math.min(1, Math.abs(model.blinkAt + 0.07) / 0.07);
    if (model.blinkAt < -0.14) model.blinkAt = 2 + Math.random() * 4;
  }
  model.eyes.scale.y = f.alive ? Math.max(0.1, lid) : 0.1;
  let want = 0;
  if (lookAt !== null && f.alive) want = Math.max(-0.75, Math.min(0.75, wrap(lookAt - f.facing)));
  model.lookYaw += (want - model.lookYaw) * Math.min(1, dt * 6);
  model.joints.head.rotateY(model.lookYaw);
  const speed = Math.hypot(f.vel.x, f.vel.z);
  const swing = Math.min(1.2, speed * 0.12) + Math.sin(f.animTime * 9) * Math.min(0.15, speed * 0.02);
  model.tails.rotation.x += (swing - model.tails.rotation.x) * Math.min(1, dt * 8);
  swayCape(model, speed, f.animTime, dt);
}
function wrap(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

// Dress a fighter in team colours: the gi takes the team colour (keeping a hint of the
// fighter's own), and team-coloured pauldrons and a tabard go on over it.
export function applyTeamOutfit(model, color) {
  const [giMat] = model.mats;
  const team = new THREE.Color(color);
  giMat.color.lerp(team, 0.72);
  const teamMat = new THREE.MeshStandardMaterial({ color: team, roughness: 0.4, metalness: 0.55, emissive: team, emissiveIntensity: 0.12 });
  model.mats.push(teamMat);
  const chest = model.joints.chest;
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(sphere(0.12), teamMat);
    pad.scale.set(1.15, 0.65, 1.1);
    pad.position.set(side * 0.3, 0.27, 0);
    pad.castShadow = true;
    chest.add(pad);
  }
  const tabard = new THREE.Mesh(box(0.22, 0.42, 0.03), teamMat);
  tabard.position.set(0, -0.32, 0.135);
  model.joints.hips.add(tabard);
  model.ring.material.color.copy(team);
}

// Fundraiser goal rewards (cosmetic only): tier 1 a silver laurel wreath, tier 2 a golden crown with
// gold-glinting trim. Either adds a thin outer ring round the floor marker, which keeps its own colour.
export function applyReward(model, tier) {
  if (tier !== 1 && tier !== 2) return;
  const gold = tier === 2;
  const mat = new THREE.MeshStandardMaterial({
    color: gold ? 0xffc23a : 0xd9dee6, roughness: 0.25, metalness: 0.9, emissive: gold ? 0x7a4a00 : 0x30363e, emissiveIntensity: gold ? 0.55 : 0.35,
  });
  model.mats.push(mat);
  const head = model.joints.head;
  if (gold) {
    const crown = new THREE.Mesh(merged('crown', [
      [geo('crownBand', () => new THREE.CylinderGeometry(0.122, 0.116, 0.05, 20, 1, true)), [0, 0, 0]],
      ...Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return [geo('crownSpike', () => new THREE.ConeGeometry(0.022, 0.07, 6)), [Math.sin(a) * 0.115, 0.055, Math.cos(a) * 0.115]];
      }),
      [sphereLo(0.016), [0, 0.012, 0.124], [0, 0, 0], [1, 1, 0.6]],
    ]), mat);
    crown.position.y = 0.27; crown.rotation.x = -0.08; crown.castShadow = true;
    head.add(crown);
    model.mats[1].emissive?.setHex(0x5a3a00); // the trim catches a little gold light
    if (model.mats[1].emissiveIntensity !== undefined) model.mats[1].emissiveIntensity = 0.35;
  } else {
    // leaves sweep round the sides and back and leave the brow open (the fighter faces +Z, angle 0)
    // leaf pairs lie along the band, angled up and out like a laurel crown
    const wreath = new THREE.Mesh(merged('laurel', Array.from({ length: 18 }, (_, i) => {
      const a = 0.9 + (Math.floor(i / 2) / 8) * (Math.PI * 2 - 1.8), up = i % 2 ? 0.018 : -0.006;
      return [sphereLo(0.03), [Math.sin(a) * 0.13, up, Math.cos(a) * 0.13], [0, a + Math.PI / 2, i % 2 ? 0.5 : -0.3], [1.25, 0.45, 0.28]];
    })), mat);
    wreath.position.y = 0.245; wreath.rotation.x = -0.12; wreath.castShadow = true;
    head.add(wreath);
  }
  const ring = new THREE.Mesh(
    geo('rewardRing', () => new THREE.RingGeometry(0.72, 0.79, 40).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: gold ? 0xffc23a : 0xd9dee6, transparent: true, opacity: 0.85, depthWrite: false })
  );
  ring.position.y = 0.001; ring.renderOrder = 1;
  model.ring.add(ring); // hides with the floor marker when the fighter falls
  model.rewardRing = ring;
}

// Returns what headgear and back pieces hide: { head: [meshes], cape: mesh|null }.
function addAccessory(kind, head, chest, { giMat, trimMat, metalMat }) {
  const out = { head: [], cape: null };
  if (kind === 'horns') {
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(geo('horn', () => new THREE.ConeGeometry(0.035, 0.2, 10)), metalMat);
      horn.position.set(side * 0.1, 0.28, 0.0); horn.rotation.z = side * -0.5;
      head.add(horn);
      out.head.push(horn);
    }
  } else if (kind === 'hood') {
    const hood = new THREE.Mesh(geo('hood', () => new THREE.ConeGeometry(0.2, 0.42, 16, 1, true)), giMat);
    hood.position.set(0, 0.2, -0.03); hood.material = giMat; head.add(hood);
    const cape = new THREE.Mesh(box(0.42, 0.7, 0.03), trimMat); cape.position.set(0, -0.15, -0.17); cape.rotation.x = 0.12; chest.add(cape);
    out.head.push(hood);
    out.cape = cape;
  }
  return out;
}

// ---- Poses -------------------------------------------------------------
// A pose is { joint: [x, y, z] } plus optional `lift` (vertical body offset)
// and `lean` (whole-body pitch). Missing joints default to 0.

const guard = {
  shL: [-0.85, 0, 0.32], elL: [-1.95, 0, 0], shR: [-0.7, 0, -0.32], elR: [-2.05, 0, 0],
  hipL: [-0.28, 0, 0.12], knL: [0.42, 0, 0], hipR: [0.22, 0, -0.12], knR: [0.36, 0, 0],
  spine: [0.06, 0.25, 0], chest: [0.06, 0.15, 0], head: [-0.08, -0.35, 0], lift: -0.06,
};

function mix(a, b, t) {
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k] ?? (k === 'lift' || k === 'lean' ? 0 : [0, 0, 0]);
    const vb = b[k] ?? (k === 'lift' || k === 'lean' ? 0 : [0, 0, 0]);
    out[k] = typeof va === 'number' ? va + (vb - va) * t : [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t];
  }
  return out;
}
const ease = (t) => t * t * (3 - 2 * t);

function idlePose(t) {
  const b = Math.sin(t * 3.2) * 0.03;
  return { ...guard, lift: guard.lift + b * 0.6, chest: [0.06 + b, 0.15, 0], shL: [-0.85 - b, 0, 0.32], shR: [-0.7 + b, 0, -0.32] };
}

function runPose(phase, amount) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const run = {
    hipL: [-0.85 * s, 0, 0.05], knL: [0.25 + Math.max(0, c) * 1.1, 0, 0],
    hipR: [0.85 * s, 0, -0.05], knR: [0.25 + Math.max(0, -c) * 1.1, 0, 0],
    shL: [0.7 * s - 0.4, 0, 0.2], elL: [-1.5, 0, 0], shR: [-0.7 * s - 0.4, 0, -0.2], elR: [-1.5, 0, 0],
    spine: [0.22, 0.12 * s, 0], chest: [0.05, 0.15 * s, 0], head: [-0.15, -0.2 * s, 0],
    lift: Math.abs(Math.cos(phase)) * 0.07 - 0.03,
  };
  return mix(guard, run, amount);
}

function attackPose(move, side, p) {
  // p: 0..1 windup, 1..2 strike, 2..3 recover
  const w = Math.min(1, p), st = Math.min(1, Math.max(0, p - 1)), rc = Math.min(1, Math.max(0, p - 2));
  let windup, strike;
  const R = side > 0; // strike with right limb
  const sh = R ? 'shR' : 'shL', el = R ? 'elR' : 'elL', sz = R ? -1 : 1;
  if (move.kind === 'punch' && !move.heavy) {
    windup = { ...guard, [sh]: [-0.5, 0, sz * 0.4], [el]: [-2.2, 0, 0], chest: [0.05, sz * -0.35, 0] };
    strike = { ...guard, [sh]: [-1.6, 0, sz * 0.05], [el]: [-0.05, 0, 0], chest: [0.12, sz * 0.55, 0], spine: [0.12, sz * 0.3, 0], lift: -0.08 };
  } else if (move.kind === 'punch') { // hook / uppercut
    windup = { ...guard, [sh]: [-0.3, 0, sz * 0.9], [el]: [-1.6, 0, 0], chest: [0.15, sz * -0.7, 0], lift: -0.16, knL: [0.8, 0, 0], knR: [0.8, 0, 0], hipL: [-0.5, 0, 0.12], hipR: [-0.1, 0, -0.12] };
    strike = { ...guard, [sh]: [-2.5, 0, sz * 0.1], [el]: [-0.6, 0, 0], chest: [-0.2, sz * 0.7, 0], spine: [-0.15, sz * 0.4, 0], lift: 0.05, head: [-0.3, 0, 0] };
  } else if (move.air) {
    windup = { ...guard, hipL: [-1.2, 0, 0.1], knL: [2.0, 0, 0], hipR: [-0.3, 0, -0.1], knR: [0.4, 0, 0] };
    strike = { ...guard, hipR: [-0.9, 0, -0.1], knR: [0.05, 0, 0], hipL: [-1.4, 0, 0.1], knL: [2.1, 0, 0], spine: [0.3, 0, 0] };
  } else if (!move.heavy) { // front kick
    const hip = R ? 'hipR' : 'hipL', kn = R ? 'knR' : 'knL';
    windup = { ...guard, [hip]: [-1.2, 0, 0], [kn]: [1.9, 0, 0], spine: [-0.1, 0, 0] };
    strike = { ...guard, [hip]: [-1.55, 0, sz * 0.05], [kn]: [0.05, 0, 0], spine: [-0.35, 0, 0], chest: [-0.05, 0, 0], head: [0.2, 0, 0] };
  } else { // roundhouse
    const hip = R ? 'hipR' : 'hipL', kn = R ? 'knR' : 'knL';
    windup = { ...guard, [hip]: [-0.9, 0, sz * 0.6], [kn]: [1.6, 0, 0], spine: [0.0, sz * -0.6, sz * 0.2], lift: 0.02 };
    strike = { ...guard, [hip]: [-0.5, 0, sz * 1.5], [kn]: [0.1, 0, 0], spine: [0.0, sz * 0.9, sz * -0.45], chest: [0, sz * 0.3, 0], lift: 0.04 };
  }
  if (p < 1) return mix(guard, windup, ease(w));
  if (p < 2) return mix(windup, strike, Math.min(1, st * 2.5));
  return mix(strike, guard, ease(rc));
}

function specialPose(kind, p) {
  const w = Math.min(1, p), rc = Math.min(1, Math.max(0, p - 1));
  let charge, release;
  switch (kind) {
    case 'slam':
      charge = { shL: [-3.0, 0, 0.3], elL: [-0.4, 0, 0], shR: [-3.0, 0, -0.3], elR: [-0.4, 0, 0], spine: [-0.2, 0, 0], hipL: [-0.9, 0, 0.1], knL: [1.6, 0, 0], hipR: [-0.9, 0, -0.1], knR: [1.6, 0, 0] };
      release = { ...guard, shL: [-1.2, 0, 0.3], elL: [-0.2, 0, 0], shR: [-1.2, 0, -0.3], elR: [-0.2, 0, 0], spine: [0.6, 0, 0], lift: -0.35, knL: [1.3, 0, 0], knR: [1.3, 0, 0], hipL: [-1.0, 0, 0.2], hipR: [-1.0, 0, -0.2] };
      break;
    case 'spear':
      charge = { ...guard, shR: [-2.6, 0, -0.5], elR: [-1.3, 0, 0], chest: [0, -0.6, 0], spine: [-0.1, -0.3, 0] };
      release = { ...guard, shR: [-1.6, 0, 0], elR: [0, 0, 0], chest: [0.1, 0.5, 0], spine: [0.15, 0.3, 0] };
      break;
    case 'ironwill':
      charge = { ...guard, shL: [-0.3, 0, 0.9], elL: [-1.9, 0, 0], shR: [-0.3, 0, -0.9], elR: [-1.9, 0, 0], spine: [0.25, 0, 0], lift: -0.15 };
      release = { ...guard, shL: [-0.2, 0, 1.3], elL: [-1.6, 0, 0], shR: [-0.2, 0, -1.3], elR: [-1.6, 0, 0], spine: [-0.25, 0, 0], head: [-0.4, 0, 0], lift: 0.02 };
      break;
    case 'venom': case 'shadow':
      charge = { ...guard, spine: [0.5, 0, 0], lift: -0.18, hipL: [-0.9, 0, 0.1], knL: [1.3, 0, 0], hipR: [0.4, 0, -0.1], knR: [0.6, 0, 0] };
      release = { ...guard, shR: [-1.6, 0, 0], elR: [-0.1, 0, 0], shL: [0.6, 0, 0.3], spine: [0.5, 0.4, 0], lift: -0.12 };
      break;
    case 'storm':
      charge = { ...guard, shR: [-3.05, 0, -0.15], elR: [-0.1, 0, 0], shL: [-0.4, 0, 0.6], spine: [-0.2, 0, 0] };
      release = { ...guard, shR: [-1.4, 0, -0.1], elR: [0, 0, 0], spine: [0.25, 0, 0] };
      break;
    case 'aim': // one-handed gun: arm straight out at the target, a kick of recoil on the shot
      charge = { ...guard, shR: [-1.57, 0, 0.1], elR: [-0.02, 0, 0], chest: [0.02, -0.12, 0], spine: [0.04, -0.06, 0], head: [0, 0.15, 0], shL: [-0.5, 0, 0.35], elL: [-1.6, 0, 0] };
      release = { ...charge, shR: [-1.85, 0, 0.1], elR: [-0.25, 0, 0], chest: [-0.06, -0.12, 0] };
      break;
    case 'aim2': // long gun: braced at the shoulder with both hands
      charge = { ...guard, shR: [-1.4, 0, -0.05], elR: [-0.35, 0, 0], shL: [-1.4, 0, 0.62], elL: [-0.95, 0, 0], chest: [0.02, -0.2, 0], spine: [0.05, -0.1, 0], head: [0.05, 0.25, 0] };
      release = { ...charge, shR: [-1.55, 0, -0.05], shL: [-1.55, 0, 0.62], chest: [-0.12, -0.2, 0], spine: [-0.08, -0.1, 0] };
      break;
    default: // fireball / frost: two-palm thrust
      charge = { ...guard, shL: [-0.4, 0, -0.3], elL: [-2.0, 0, 0], shR: [-0.4, 0, 0.3], elR: [-2.0, 0, 0], chest: [0, -0.8, 0], spine: [0, -0.4, 0], lift: -0.12 };
      release = { ...guard, shL: [-1.55, 0, -0.18], elL: [-0.05, 0, 0], shR: [-1.55, 0, 0.18], elR: [-0.05, 0, 0], chest: [0.1, 0, 0], spine: [0.15, 0, 0], lift: -0.1 };
  }
  if (p < 1) return mix(guard, charge, ease(w));
  if (p < 1.25) return mix(charge, release, (p - 1) * 4);
  return mix(release, guard, ease(Math.max(0, rc - 0.25) / 0.75));
}

const blockPose = {
  ...guard, shL: [-1.35, 0, -0.45], elL: [-1.7, 0, 0], shR: [-1.45, 0, 0.45], elR: [-1.7, 0, 0],
  spine: [0.18, 0, 0], chest: [0.12, 0, 0], head: [0.15, 0, 0],
  hipL: [-0.45, 0, 0.18], knL: [0.75, 0, 0], hipR: [0.15, 0, -0.18], knR: [0.6, 0, 0], lift: -0.13,
};
const hurtPose = {
  ...guard, spine: [-0.45, 0, 0.1], chest: [-0.25, 0, 0], head: [-0.45, 0, 0.2],
  shL: [-0.4, 0, 0.9], elL: [-0.8, 0, 0], shR: [-0.3, 0, -0.9], elR: [-0.9, 0, 0], lift: -0.04,
};
const jumpPose = {
  ...guard, hipL: [-1.1, 0, 0.1], knL: [1.8, 0, 0], hipR: [-0.6, 0, -0.1], knR: [1.4, 0, 0],
  shL: [-1.2, 0, 0.6], elL: [-1.5, 0, 0], shR: [-1.2, 0, -0.6], elR: [-1.5, 0, 0], spine: [0.15, 0, 0],
};
const downPose = {
  shL: [-2.6, 0, 0.6], elL: [-0.3, 0, 0], shR: [-2.8, 0, -0.5], elR: [-0.4, 0, 0],
  hipL: [-0.15, 0, 0.2], knL: [0.25, 0, 0], hipR: [-0.35, 0, -0.15], knR: [0.5, 0, 0], head: [0.3, 0.4, 0],
};
const dodgePose = {
  ...guard, spine: [0.75, 0, 0], chest: [0.35, 0, 0], head: [-0.4, 0, 0], lift: -0.36,
  hipL: [-1.3, 0, 0.15], knL: [2.0, 0, 0], hipR: [-0.6, 0, -0.15], knR: [1.7, 0, 0],
  shL: [-1.0, 0, 0.5], elL: [-1.9, 0, 0], shR: [-1.0, 0, -0.5], elR: [-1.9, 0, 0],
};
const frozenPose = { ...guard, spine: [-0.15, 0, 0], shL: [-0.6, 0, 0.7], shR: [-0.5, 0, -0.7] };

// Victory poses are cosmetics (VICTORIES in cosmetics.js); the fighter's model says which one it uses.
export function victoryPose(t, kind = 'fist') {
  switch (kind) {
    case 'salsa': {
      // basic salsa: step forward and back on a one-two-three, hips swaying, arms up in a dance frame
      const beat = t * 5.2, s = Math.sin(beat), c = Math.cos(beat);
      return {
        hips: [0, 0.22 * s, 0.09 * c],
        hipL: [-0.45 * Math.max(0, s), 0, 0.1], knL: [0.2 + 0.45 * Math.max(0, s), 0, 0],
        hipR: [0.4 * Math.max(0, -s), 0, -0.1], knR: [0.2 + 0.45 * Math.max(0, -s), 0, 0],
        spine: [0.02, -0.12 * s, -0.08 * c], chest: [-0.05, -0.15 * s, 0], head: [-0.12, 0.3 * s, 0.05 * c],
        // left hand held high and out as if leading a partner, right hand low across the body
        shL: [-1.57, 0, 1.15 + 0.12 * c], elL: [-1.2, 0, 0], shR: [-0.75, 0, 0.25 + 0.1 * s], elR: [-1.3, 0, 0],
        lift: Math.abs(c) * 0.035 - 0.05,
      };
    }
    case 'flex': {
      // double biceps: upper arms out level, forearms straight up, chest puffed
      const p = 0.5 + 0.5 * Math.sin(t * 3.2);
      return {
        shL: [-1.57, 0, 1.45 + 0.08 * p], elL: [-1.75 - 0.35 * p, 0, 0], shR: [-1.57, 0, -1.45 - 0.08 * p], elR: [-1.75 - 0.35 * p, 0, 0],
        chest: [-0.14 - 0.06 * p, 0, 0], spine: [-0.06, 0, 0], head: [-0.3, 0, 0],
        hipL: [0, 0, 0.22], hipR: [0, 0, -0.22], knL: [0.1, 0, 0], knR: [0.1, 0, 0], lift: -0.02 + 0.015 * p,
      };
    }
    case 'beckon': {
      // one hand out in front curling the fingers in: "come on then"
      const w = Math.max(0, Math.sin(t * 6.5));
      return {
        shR: [-1.45, 0, -0.05], elR: [-0.15 - 1.5 * w, 0, 0], shL: [-0.1, 0, 0.55], elL: [-0.6, 0, 0],
        chest: [-0.12, 0.3, 0], spine: [-0.05, 0.15, 0], head: [-0.25, -0.25, 0.15],
        hipL: [-0.2, 0, 0.28], knL: [0.25, 0, 0], hipR: [0.15, 0, -0.22], knR: [0.15, 0, 0], lift: -0.04,
      };
    }
    case 'bow': {
      // a matador's bow: sweep down, hold, come back up
      const d = Math.min(1, Math.max(0, Math.sin(t * 1.2) * 1.6 + 0.3));
      return {
        spine: [0.5 * d, 0, 0], chest: [0.3 * d, 0, 0], head: [0.2 * d, 0, 0],
        shR: [-0.7 - 0.3 * d, 0, 0.55], elR: [-1.5, 0, 0], shL: [0.5 + 0.6 * d, 0, 0.5 + 0.5 * d], elL: [-0.15, 0, 0],
        hipL: [-0.15 * d, 0, 0.06], knL: [0.15 * d, 0, 0], hipR: [0.45 * d, 0, -0.06], knR: [0.2 + 0.2 * d, 0, 0], lift: -0.05 * d,
      };
    }
    default: {
      const b = Math.abs(Math.sin(t * 4));
      return {
        shR: [-3.0, 0, -0.25], elR: [-0.2, 0, 0], shL: [0.2, 0, 0.4], elL: [-1.8, 0, 0],
        head: [-0.35, 0, 0], spine: [-0.12, 0, 0], hipL: [0, 0, 0.12], hipR: [0, 0, -0.12], lift: b * 0.08,
      };
    }
  }
}

// Emotes (social.js): a wave and a laugh of their own, the rest borrowed from the victory poses.
export function emotePose(id, t) {
  switch (id) {
    case 'wave': {
      // right hand high, waving side to side, weight on one hip
      const w = Math.sin(t * 9);
      return {
        shR: [-2.55, 0, -0.45 - 0.32 * w], elR: [-0.55 + 0.25 * w, 0, 0], shL: [-0.15, 0, 0.3], elL: [-0.5, 0, 0],
        chest: [-0.04, -0.15, 0.04 * w], spine: [0, -0.08, 0], head: [-0.1, -0.15, -0.08],
        hips: [0, 0, 0.06], hipL: [0, 0, 0.14], hipR: [0, 0, -0.1], knL: [0.18, 0, 0], knR: [0.04, 0, 0], lift: -0.02,
      };
    }
    case 'laugh': {
      // head thrown back, shoulders shaking, hands on the belly
      const b = Math.abs(Math.sin(t * 13));
      return {
        spine: [-0.18 - 0.06 * b, 0, 0], chest: [-0.12 - 0.05 * b, 0, 0], head: [-0.45 - 0.08 * b, 0, 0],
        shL: [-0.55, 0, 0.32], elL: [-1.85, 0, 0], shR: [-0.55, 0, -0.32], elR: [-1.85, 0, 0],
        hipL: [0, 0, 0.1], hipR: [0, 0, -0.1], knL: [0.12, 0, 0], knR: [0.12, 0, 0], lift: -0.03 + 0.03 * b,
      };
    }
    case 'taunt': return victoryPose(t, 'beckon');
    default: return victoryPose(t, id);
  }
}

// ---- Motion capture ----------------------------------------------------
// Clips are decoded once into floats: per frame, 12 joint quaternions (JOINTS order) then the hip lift.
const STRIDE = JOINTS.length * 4 + 1;
const CLIPS = {};
for (const [name, c] of Object.entries(MOCAP)) {
  const bin = atob(c.data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const raw = new Int16Array(bytes.buffer), f = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) f[i] = raw[i] / (i % STRIDE === STRIDE - 1 ? 10000 : 32767);
  CLIPS[name] = { f, n: c.n, loop: c.loop, hit: c.hit ?? 0, dur: (c.loop ? c.n : c.n - 1) / MOCAP_FPS };
}
// which clip each attack plays (the CMU actor fights orthodox: left jab, right cross)
const ATTACK_CLIP = { jab1: 'cross', jab2: 'jab', hook: 'power', kick1: 'frontkick', kick2: 'roundhouse', airkick: 'flykick' };

// A target pose: joint quaternions packed in JOINTS order, plus the hip lift.
const newPose = () => ({ q: new Float32Array(JOINTS.length * 4), lift: 0 });
const _eq = new THREE.Quaternion(), _ee = new THREE.Euler();

function sampleClip(out, name, t) {
  const c = CLIPS[name];
  let fr = t * MOCAP_FPS;
  if (c.loop) fr = ((fr % c.n) + c.n) % c.n; else fr = Math.max(0, Math.min(c.n - 1, fr));
  const i0 = Math.floor(fr), i1 = c.loop ? (i0 + 1) % c.n : Math.min(c.n - 1, i0 + 1), w = fr - i0;
  const a = i0 * STRIDE, b = i1 * STRIDE, q = out.q, f = c.f;
  for (let j = 0; j < q.length; j += 4) {
    const s = f[a + j] * f[b + j] + f[a + j + 1] * f[b + j + 1] + f[a + j + 2] * f[b + j + 2] + f[a + j + 3] * f[b + j + 3] < 0 ? -1 : 1;
    let x = f[a + j] * (1 - w) + s * f[b + j] * w, y = f[a + j + 1] * (1 - w) + s * f[b + j + 1] * w;
    let z = f[a + j + 2] * (1 - w) + s * f[b + j + 2] * w, ww = f[a + j + 3] * (1 - w) + s * f[b + j + 3] * w;
    const l = 1 / Math.hypot(x, y, z, ww);
    q[j] = x * l; q[j + 1] = y * l; q[j + 2] = z * l; q[j + 3] = ww * l;
  }
  out.lift = f[a + STRIDE - 1] * (1 - w) + f[b + STRIDE - 1] * w;
  return out;
}

// a hand-made pose ({ joint: [x, y, z] euler, lift }) in the packed form
function fromEuler(out, p) {
  JOINTS.forEach((k, i) => { const e = p[k]; _eq.setFromEuler(e ? _ee.set(e[0], e[1], e[2]) : _ee.set(0, 0, 0)).toArray(out.q, i * 4); });
  out.lift = p.lift ?? 0;
  return out;
}

// blends b into a by t (in place on a)
function blendInto(a, b, t) {
  const q = a.q, r = b.q;
  for (let j = 0; j < q.length; j += 4) {
    const s = q[j] * r[j] + q[j + 1] * r[j + 1] + q[j + 2] * r[j + 2] + q[j + 3] * r[j + 3] < 0 ? -t : t;
    const x = q[j] * (1 - t) + r[j] * s, y = q[j + 1] * (1 - t) + r[j + 1] * s, z = q[j + 2] * (1 - t) + r[j + 2] * s, w = q[j + 3] * (1 - t) + r[j + 3] * s;
    const l = 1 / Math.hypot(x, y, z, w);
    q[j] = x * l; q[j + 1] = y * l; q[j + 2] = z * l; q[j + 3] = w * l;
  }
  a.lift += (b.lift - a.lift) * t;
  return a;
}

// Clip time for an attack: the windup plays up to just before contact, the active window holds
// the moment of contact and the recovery plays out the rest of the clip.
function attackTime(c, p) {
  const h0 = Math.max(0, c.hit - 0.05), h1 = Math.min(c.dur, c.hit + 0.05);
  if (p < 1) return h0 * p;
  if (p < 2) return h0 + (h1 - h0) * (p - 1);
  return h1 + (c.dur - h1) * Math.min(1, p - 2);
}

function locomotion(out, tmp, f) {
  sampleClip(out, 'idle', f.animTime);
  if (f.moveAmount > 0.02) blendInto(out, sampleClip(tmp, 'run', f.runPhase / (Math.PI * 2) * CLIPS.run.dur), Math.min(1, f.moveAmount * 1.3));
  return out;
}

// Works out the pose a fighter is aiming for this frame. Buffers live on the model so nothing is
// allocated per frame.
export function computePose(f) {
  const m = f.model;
  const P = m.poseBuf ||= [newPose(), newPose()];
  const [out, tmp] = P;
  const t = f.animTime;
  switch (f.state) {
    case 'attack': {
      const name = ATTACK_CLIP[f.moveName];
      if (name) return sampleClip(out, name, attackTime(CLIPS[name], f.attackPhase));
      return fromEuler(out, attackPose(f.move, f.attackSide, f.attackPhase));
    }
    case 'special': return fromEuler(out, specialPose(f.def.special, f.specialPhase));
    case 'skill': return fromEuler(out, specialPose(f.skill?.pose || 'fireball', f.specialPhase));
    case 'dodge': return sampleClip(out, 'duck', Math.min(1, f.stateTime / (f.stateDuration || 0.34)) * CLIPS.duck.dur);
    case 'block': return fromEuler(out, blockPose);
    case 'hitstun': case 'blockstun': case 'guardbreak': {
      if (f.state === 'guardbreak') return fromEuler(out, mix(hurtPose, { ...hurtPose, head: [0.5, Math.sin(t * 7) * 0.4, 0], spine: [0.4, 0, 0], lift: -0.2 }, 0.7));
      const w = Math.sin(Math.min(1, f.stateTime / 0.12) * Math.PI * 0.5);
      return blendInto(sampleClip(out, 'idle', t), fromEuler(tmp, f.state === 'blockstun' ? blockPose : hurtPose), w);
    }
    case 'knockdown': case 'ko': case 'getup': return fromEuler(out, downPose);
    case 'frozen': return fromEuler(out, frozenPose);
    case 'victory': return fromEuler(out, victoryPose(t, m.victory));
    case 'emote': return fromEuler(out, emotePose(f.emoteId, f.stateTime));
    default:
      if (!f.grounded) {
        // the jump clip runs from take-off to landing, following the fighter's actual rise and fall
        const u = Math.max(0, Math.min(1, 0.5 - (f.vel.y ?? 0) / 18.4));
        return sampleClip(out, 'jump', u * CLIPS.jump.dur);
      }
      return locomotion(out, tmp, f);
  }
}

// Blend each joint toward the target pose with critically damped smoothing.
export function applyPose(model, target, dt, sharp) {
  const k = 1 - Math.exp(-(sharp ? 34 : 16) * dt);
  // smoothed rotations are kept apart from the joints, which also carry extras like the head's glance
  const S = model.smoothQ ||= JOINTS.map(() => new THREE.Quaternion());
  for (let i = 0; i < JOINTS.length; i++) model.joints[JOINTS[i]].quaternion.copy(S[i].slerp(_eq.fromArray(target.q, i * 4), k));
  const cur = model.current;
  cur.lift = (cur.lift ?? 0) + (target.lift - (cur.lift ?? 0)) * k;
  model.joints.hips.position.y = model.hipsBaseY + cur.lift;
}
