// The 3D side of cosmetics: recolours a fighter for its outfit and builds the headgear and back
// pieces from simple shapes (no external assets). Shapes that share a material are merged, so a
// dressed fighter costs only two or three more draw calls.
import * as THREE from 'three';
import { outfitColors, bodyValue, HEADGEAR, TOPS, LEGS, FEET, HANDS, sanitizeLook } from './cosmetics.js';
import { UPPER_ARM, FOREARM, THIGH, SHIN } from './bodyShapes.js';

const cache = new Map();
const geo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
// [geometry, position, rotation, scale] parts baked into one geometry, cached by key
function merged(key, parts) {
  return geo(`m_${key}`, () => {
    const pos = [], nor = [];
    for (const [g, p = [0, 0, 0], r = [0, 0, 0], sc = [1, 1, 1]] of parts) {
      const src = g.index ? g.toNonIndexed() : g.clone();
      _m.compose(_v.set(...p), _q.setFromEuler(_e.set(...r)), _s.set(...sc));
      src.applyMatrix4(_m);
      pos.push(...src.attributes.position.array);
      nor.push(...src.attributes.normal.array);
      src.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.computeBoundingSphere();
    return out;
  });
}

const cyl = (rt, rb, h, seg = 20, open = false, ts = 0, tl = Math.PI * 2) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, ts, tl);
const torus = (r, t, rs = 8, ts = 24, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const sph = (r, ws = 16, hs = 10, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl);
const cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...opts });
}
const GOLD = (extra = {}) => mat(0xf0b83c, { roughness: 0.28, metalness: 0.9, emissive: 0x3a2400, emissiveIntensity: 0.25, ...extra });

// Dresses a freshly built fighter model. Call once, before team colours are applied.
export function dressFighter(model, def, lookIn) {
  const look = sanitizeLook(lookIn);
  model.look = look;
  model.victory = look.victory;
  applyOutfit(model, def, look.outfit);
  // body: skin and hair colours (hair style and beard are built in, see bodyDef), and the eye glow
  const skin = bodyValue(look, 'skin'), hairCol = bodyValue(look, 'hairColor'), eyes = bodyValue(look, 'eyes');
  if (skin != null) model.skinMat.color.setHex(skin);
  if (hairCol != null) model.mats[4].color.setHex(hairCol);
  if (eyes != null) { model.eyeMat.color.setHex(eyes); model.eyeMat.emissive.setHex(eyes); }
  const c = outfitColors(def, look.outfit);
  const add = (m) => { model.mats.push(m); return m; };
  const mesh = (g, m, parent, shadow = true) => { const o = new THREE.Mesh(g, m); o.castShadow = shadow; parent.add(o); return o; };

  dressClothes(model, look, c, add, mesh);

  // ---- headgear
  const head = model.joints.head;
  const hg = HEADGEAR[look.head];
  if (look.head !== 'none') {
    // horns and Shade's hood would poke through anything worn on the head
    for (const o of model.headExtras || []) o.visible = false;
    if (hg?.covers && model.hair) model.hair.visible = false;
  }
  switch (look.head) {
    case 'bandana':
    case 'jmBandana': {
      const jm = look.head === 'jmBandana';
      const cloth = add(mat(jm ? 0xb3161b : c.accent, { roughness: 0.75 }));
      mesh(merged('bandana', [
        [torus(0.122, 0.022, 8, 28), [0, 0.215, -0.005], [Math.PI / 2 - 0.22, 0, 0], [0.95, 1.06, 1.25]],
        [sph(0.03, 10, 8), [0, 0.2, -0.14], [0, 0, 0], [1.2, 1, 0.8]],
        [box(0.045, 0.16, 0.012), [0.03, 0.13, -0.155], [0.35, 0, 0.3]],
        [box(0.045, 0.14, 0.012), [-0.025, 0.14, -0.15], [0.4, 0, -0.25]],
      ]), cloth, head);
      if (jm) mesh(merged('jmCrest', [[cyl(0.03, 0.03, 0.01, 16), [0, 0.245, 0.117], [Math.PI / 2 - 0.5, 0, 0]], [cone(0.012, 0.035, 4), [0, 0.248, 0.124], [0.35, 0, 0]]]), add(GOLD()), head, false);
      break;
    }
    case 'luchador': {
      // an open-face hood in the outfit's accent colour, flames painted around the eyes in the trim colour
      const hood = add(mat(c.accent, { roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide }));
      const paint = add(mat(c.trim, { roughness: 0.35, metalness: 0.2 }));
      const window = 1.0;
      mesh(merged('luchaHood', [
        [sph(0.134, 24, 14, Math.PI / 2 + window / 2, Math.PI * 2 - window, 0, Math.PI * 0.74), [0, 0.165, 0], [0, 0, 0], [0.93, 1.07, 1.03]],
        [sph(0.135, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.37), [0, 0.165, 0], [0, 0, 0], [0.93, 1.07, 1.03]],
      ]), hood, head);
      const flame = (sx) => [torus(0.03, 0.007, 5, 12, Math.PI * 1.25), [sx * 0.044, 0.168, 0.112], [0, 0, sx > 0 ? -0.3 : Math.PI * 0.55]];
      mesh(merged('luchaPaint', [
        flame(1), flame(-1),
        [box(0.02, 0.012, 0.2), [0, 0.3, -0.005], [0, 0, 0]],
        [cone(0.018, 0.06, 4), [0, 0.262, 0.118], [0.3, 0, Math.PI]],
      ]), paint, head, false);
      break;
    }
    case 'sombrero': {
      const straw = add(mat(0xd9b56c, { roughness: 0.9 }));
      const band = add(mat(c.accent === 0xd9b56c ? c.trim : c.accent, { roughness: 0.6 }));
      mesh(merged('sombrero', [
        [cyl(0.36, 0.36, 0.012, 36), [0, 0.262, 0]],
        [torus(0.36, 0.022, 6, 40), [0, 0.275, 0], [Math.PI / 2, 0, 0]],
        [cyl(0.085, 0.13, 0.17, 24), [0, 0.35, 0]],
        [sph(0.085, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.435, 0], [0, 0, 0], [1, 0.55, 1]],
      ]), straw, head);
      mesh(merged('sombreroBand', [
        [torus(0.125, 0.014, 6, 28), [0, 0.285, 0], [Math.PI / 2, 0, 0]],
        [torus(0.29, 0.008, 4, 40), [0, 0.27, 0], [Math.PI / 2, 0, 0]],
        [cyl(0.015, 0.015, 0.012, 8), [0.105, 0.33, 0.06]],
      ]), band, head, false);
      break;
    }
    case 'jinete': {
      // flat-brimmed rider's hat and a bandit mask; the glowing eyes show through the mask
      const black = add(mat(0x121014, { roughness: 0.55 }));
      mesh(merged('jineteHat', [
        [cyl(0.25, 0.25, 0.012, 32), [0, 0.275, 0]],
        [cyl(0.112, 0.118, 0.095, 24), [0, 0.325, 0]],
        [cyl(0.112, 0.112, 0.01, 24), [0, 0.373, 0]],
        [cyl(0.128, 0.128, 0.042, 28, true), [0, 0.168, 0], [0, 0, 0], [0.92, 1, 0.945]],
        [box(0.04, 0.12, 0.01), [0.025, 0.12, -0.13], [0.3, 0, 0.25]],
        [box(0.04, 0.11, 0.01), [-0.025, 0.125, -0.13], [0.3, 0, -0.25]],
      ]), black, head);
      mesh(merged('jineteBand', [[torus(0.117, 0.01, 6, 28), [0, 0.29, 0], [Math.PI / 2, 0, 0]]]), add(mat(c.accent === 0x121014 ? 0xc0201c : c.accent, { roughness: 0.5 })), head, false);
      break;
    }
    case 'chiliCrown': {
      const parts = [], stems = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = Math.sin(a) * 0.105, z = Math.cos(a) * 0.105;
        // a pepper points up and out from the band, with its green cap at the bottom
        parts.push([cone(0.022, 0.12, 8), [x * 1.12, 0.33, z * 1.12], [Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35]]);
        stems.push([sph(0.022, 8, 6), [x, 0.27, z], [0, 0, 0], [1, 0.6, 1]]);
      }
      mesh(merged('chiliPeppers', parts), add(mat(0xd4160f, { roughness: 0.25, metalness: 0.05, emissive: 0x3a0000, emissiveIntensity: 0.4 })), head);
      mesh(merged('chiliCaps', stems), add(mat(0x2f8a24, { roughness: 0.5 })), head, false);
      mesh(merged('chiliBand', [[torus(0.112, 0.013, 6, 28), [0, 0.262, 0], [Math.PI / 2 + 0.06, 0, 0]]]), add(GOLD()), head, false);
      break;
    }
    case 'kingCrown': {
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pts.push([cone(0.02, 0.07, 4), [Math.sin(a) * 0.112, 0.345, Math.cos(a) * 0.112]]);
        pts.push([sph(0.011, 6, 5), [Math.sin(a) * 0.112, 0.385, Math.cos(a) * 0.112]]);
      }
      mesh(merged('crown', [[cyl(0.118, 0.11, 0.06, 28, true), [0, 0.29, 0]], [torus(0.114, 0.008, 5, 28), [0, 0.262, 0], [Math.PI / 2, 0, 0]], ...pts]),
        add(GOLD({ side: THREE.DoubleSide })), head);
      const gems = [];
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; gems.push([sph(0.016, 8, 6), [Math.sin(a) * 0.12, 0.292, Math.cos(a) * 0.12]]); }
      mesh(merged('crownGems', gems), add(mat(0xd0102a, { roughness: 0.1, metalness: 0.3, emissive: 0x900010, emissiveIntensity: 0.8 })), head, false);
      break;
    }
  }

  // ---- back pieces
  const chest = model.joints.chest;
  if (look.back !== 'none' && model.builtinCape) model.builtinCape.visible = false;
  switch (look.back) {
    case 'cape':
    case 'goldMantle': {
      const gold = look.back === 'goldMantle';
      const pivot = new THREE.Group(); pivot.position.set(0, 0.3, -0.12); chest.add(pivot);
      // a curved sheet: the back half of a cone, hanging from the shoulders
      const cloth = add(gold ? GOLD({ side: THREE.DoubleSide, roughness: 0.35 }) : mat(c.accent === c.gi ? c.trim : c.accent, { roughness: 0.8, side: THREE.DoubleSide }));
      const sheet = mesh(merged('cape', [[cyl(0.2, 0.36, 0.9, 16, true, Math.PI - 1.0, 2.0), [0, -0.45, 0.13]]]), cloth, pivot);
      const clasp = add(gold ? mat(0xd0102a, { roughness: 0.2, emissive: 0x700010 }) : GOLD());
      mesh(merged('capeClasps', [[sph(0.03, 10, 8), [0.17, 0.02, 0.07]], [sph(0.03, 10, 8), [-0.17, 0.02, 0.07]]]), clasp, pivot, false);
      model.cape = pivot;
      void sheet;
      break;
    }
    case 'chiliBanner':
    case 'jmStandard': {
      const jm = look.back === 'jmStandard';
      const holder = new THREE.Group(); holder.position.set(0, 0.12, -0.2); chest.add(holder);
      mesh(merged('bannerPole', [[cyl(0.012, 0.012, 1.1, 8), [0, 0.38, 0]], [sph(0.025, 8, 6), [0, 0.94, 0]], [box(0.06, 0.06, 0.04), [0, 0, 0.02]]]), add(jm ? GOLD() : mat(0x5a3a1c, { roughness: 0.8 })), holder);
      const flagPivot = new THREE.Group(); flagPivot.position.set(0, 0.88, 0); holder.add(flagPivot);
      mesh(merged('bannerFlag', [[box(0.012, 0.5, 0.3), [0, -0.25, -0.16]]]), add(mat(jm ? 0x111011 : c.accent, { roughness: 0.8 })), flagPivot);
      // a red chili on both faces of the flag
      mesh(merged('bannerChili', [
        [cone(0.045, 0.24, 10), [0.009, -0.27, -0.16], [0, 0, 0.35], [1, 1, 0.3]],
        [cone(0.045, 0.24, 10), [-0.009, -0.27, -0.16], [0, 0, 0.35], [1, 1, 0.3]],
      ]), add(mat(0xd4160f, { roughness: 0.4 })), flagPivot, false);
      if (jm) mesh(merged('bannerEdge', [[box(0.016, 0.5, 0.02), [0, -0.25, -0.31]], [box(0.016, 0.02, 0.3), [0, -0.5, -0.16]], [box(0.016, 0.02, 0.3), [0, 0, -0.16]]]), add(GOLD()), flagPivot, false);
      model.cape = flagPivot;
      model.capeAxis = 'y';
      break;
    }
    case 'salsaJar': {
      const holder = new THREE.Group(); holder.position.set(0, 0.1, -0.27); chest.add(holder);
      mesh(merged('jarGlass', [[cyl(0.1, 0.1, 0.22, 20), [0, 0, 0]], [sph(0.1, 20, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), [0, -0.11, 0], [0, 0, 0], [1, 0.3, 1]]]),
        add(mat(0xc4231a, { roughness: 0.12, metalness: 0.1, emissive: 0x4a0602, emissiveIntensity: 0.5 })), holder);
      mesh(merged('jarLid', [[cyl(0.085, 0.09, 0.05, 20), [0, 0.135, 0]], [torus(0.085, 0.008, 4, 20), [0, 0.12, 0], [Math.PI / 2, 0, 0]]]), add(GOLD()), holder, false);
      mesh(merged('jarLabel', [[cyl(0.103, 0.103, 0.09, 20, true), [0, -0.01, 0]]]), add(mat(0xf3e7c9, { roughness: 0.7, side: THREE.DoubleSide })), holder, false);
      mesh(merged('jarStraps', [
        [box(0.035, 0.42, 0.012), [0.12, 0.05, 0.0], [0.15, 0, 0.12]],
        [box(0.035, 0.42, 0.012), [-0.12, 0.05, 0.0], [0.15, 0, -0.12]],
      ]), add(mat(0x3a2414, { roughness: 0.85 })), chest, false).position.set(0, 0.1, -0.17);
      break;
    }
  }
  return model;
}

// ---------------------------------------------------------------- clothing
// A limb shell: the limb's own profile, widened by `k` and cut to the part between minY and maxY,
// so a sleeve or trouser leg sits just over the arm or leg and bends with it.
function shell(key, profile, k, minY = -9, maxY = 9) {
  return geo(`shell_${key}_${k}_${minY}_${maxY}`, () => {
    const at = (y) => {
      for (let i = 1; i < profile.length; i++) {
        const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
        if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
      }
      return 0;
    };
    const pts = [];
    if (minY > profile[0][1]) pts.push([at(minY), minY]);
    for (const [r, y] of profile) if (y > minY && y < maxY) pts.push([r, y]);
    if (maxY < profile[profile.length - 1][1]) pts.push([at(maxY), maxY]);
    return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * k, y)), 16);
  });
}

// The colour a piece of clothing is dyed: fixed, or a part of the outfit's colour scheme.
const dye = (item, c, fallback) => {
  const v = item?.color ?? fallback;
  return typeof v === 'string' ? c[v] : v;
};

function dressClothes(model, look, c, add, mesh) {
  const J = model.joints, P = model.parts;
  const sides = ['L', 'R'];
  const each = (fn) => sides.forEach((side) => fn(side, side === 'L' ? 1 : -1));
  const hide = (...objs) => objs.forEach((o) => { if (o) o.visible = false; });
  const cloth = (color, extra = {}) => add(mat(color, { roughness: 0.85, ...extra }));
  const gold = () => add(GOLD());
  const torsoShell = (m, k = 1.06) => mesh(merged(`torso${k}`, [[sph(0.2, 22, 16), [0, 0.12, 0], [0, 0, 0], [1.24 * k, 1.22 * 1.025, 0.84 * k]]]), m, J.chest);
  const bellyShell = (m, k = 1.07) => mesh(merged(`belly${k}`, [[new THREE.CapsuleGeometry(0.15, 0.14, 6, 14), [0, 0.12, 0], [0, 0, 0], [1.05 * k, 1, 0.82 * k]]]), m, J.spine);
  const longSleeves = (m, cuff = null) => each((side) => {
    hide(P.sleeve[side]);
    mesh(shell('ua', UPPER_ARM, 1.2, -0.31), m, J['sh' + side]);
    mesh(shell('fa', FOREARM, 1.2, -0.16), m, J['el' + side]);
    if (cuff) mesh(merged('cuff', [[torus(0.054, 0.009, 6, 18), [0, -0.155, 0], [Math.PI / 2, 0, 0]]]), cuff, J['el' + side], false);
  });
  const shortSleeves = (m) => each((side) => { hide(P.sleeve[side]); mesh(shell('uaShort', UPPER_ARM, 1.22, -0.14), m, J['sh' + side]); });

  // ---- tops
  const top = TOPS[look.top];
  if (look.top !== 'gi') hide(P.lapel);
  switch (look.top) {
    case 'tee': case 'jmTee': case 'tank': {
      const jm = look.top === 'jmTee';
      const m = cloth(jm ? 0x161416 : dye(top, c, 'accent'));
      torsoShell(m); bellyShell(m);
      if (look.top === 'tank') each((side) => hide(P.sleeve[side])); else shortSleeves(m);
      if (jm) {
        mesh(merged('teeChili', [[cone(0.04, 0.2, 10), [0.0, 0.14, 0.185], [0.12, 0, 0.5], [1, 1, 0.35]]]), add(mat(0xd4160f, { roughness: 0.5 })), J.chest, false);
        mesh(merged('teeStem', [[cyl(0.012, 0.012, 0.05, 6), [0.052, 0.235, 0.17], [0.1, 0, 0.9]]]), add(mat(0x2f8a24)), J.chest, false);
        mesh(merged('teeLine', [[box(0.16, 0.012, 0.01), [0, 0.0, 0.183], [0.15, 0, 0]]]), gold(), J.chest, false);
      }
      break;
    }
    case 'hoodie': {
      const m = cloth(dye(top, c, 'trim'));
      torsoShell(m, 1.09); bellyShell(m, 1.1); longSleeves(m);
      mesh(merged('hood', [[sph(0.16, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), [0, 0.32, -0.1], [-1.2, 0, 0], [1.05, 1, 0.8]]]), add(mat(dye(top, c, 'trim'), { roughness: 0.85, side: THREE.DoubleSide })), J.chest);
      mesh(merged('pocket', [[box(0.2, 0.09, 0.02), [0, 0.04, 0.135], [0.1, 0, 0]]]), m, J.spine, false);
      mesh(merged('strings', [[cyl(0.005, 0.005, 0.12, 4), [0.035, 0.25, 0.185]], [cyl(0.005, 0.005, 0.12, 4), [-0.035, 0.25, 0.185]]]), add(mat(0xf2ede4)), J.chest, false);
      break;
    }
    case 'poncho': {
      // stacked bands of a woven serape, two colours
      const a = [], b = [];
      const bands = [[0.34, 0.15], [0.26, 0.24], [0.18, 0.31], [0.1, 0.37], [0.02, 0.42], [-0.06, 0.45]];
      for (let i = 1; i < bands.length; i++) {
        const [y0, r0] = bands[i - 1], [y1, r1] = bands[i];
        (i % 2 ? a : b).push([cyl(r0, r1, y0 - y1, 28, true), [0, (y0 + y1) / 2, 0], [0, 0, 0], [1, 1, 0.78]]);
      }
      const side = { side: THREE.DoubleSide, roughness: 0.95 };
      mesh(merged('ponchoA', a), add(mat(dye(top, c, 'accent'), side)), J.chest);
      mesh(merged('ponchoB', b), add(mat(0xf3e7c9, side)), J.chest);
      mesh(merged('ponchoNeck', [[torus(0.14, 0.02, 6, 20), [0, 0.34, 0], [Math.PI / 2, 0, 0], [1, 0.78, 1]]]), add(mat(0xc21e1a)), J.chest, false);
      break;
    }
    case 'apron': {
      const m = add(mat(0xf4efe6, { roughness: 0.9 }));
      mesh(merged('apronBib', [[box(0.24, 0.22, 0.02), [0, 0.13, 0.185], [-0.08, 0, 0]], [torus(0.1, 0.008, 4, 18), [0, 0.3, 0.06], [1.2, 0, 0]]]), m, J.chest, false);
      mesh(merged('apronTie', [[torus(0.16, 0.01, 4, 24), [0, 0.0, 0], [Math.PI / 2, 0, 0], [1.05, 0.85, 1]]]), m, J.spine, false);
      mesh(merged('apronSkirt', [[box(0.32, 0.44, 0.02), [0, -0.22, 0.165], [0.06, 0, 0]]]), m, J.hips, false);
      mesh(merged('apronChili', [[cone(0.03, 0.13, 10), [0, 0.12, 0.2], [0, 0, 0.6], [1, 1, 0.3]]]), add(mat(0xd4160f)), J.chest, false);
      break;
    }
    case 'leather': {
      const m = add(mat(0x1a171b, { roughness: 0.32, metalness: 0.25 }));
      torsoShell(m, 1.08); bellyShell(m, 1.09); longSleeves(m);
      mesh(merged('collarL', [[box(0.09, 0.12, 0.015), [0.07, 0.3, 0.13], [-0.5, 0, -0.5]], [box(0.09, 0.12, 0.015), [-0.07, 0.3, 0.13], [-0.5, 0, 0.5]]]), m, J.chest, false);
      mesh(merged('zip', [[box(0.012, 0.3, 0.01), [0.015, 0.11, 0.18], [-0.05, 0, 0]]]), add(mat(0xc8ccd4, { roughness: 0.2, metalness: 0.9 })), J.chest, false);
      break;
    }
    case 'charro':
    case 'matador': {
      const gilt = look.top === 'matador';
      const m = gilt ? add(GOLD({ side: THREE.DoubleSide })) : add(mat(0x121014, { roughness: 0.5, side: THREE.DoubleSide }));
      // a short bolero, open at the front, over the gi
      const open = 0.95;
      mesh(merged('bolero', [[sph(0.2, 26, 14, Math.PI / 2 + open / 2, Math.PI * 2 - open, 0, Math.PI * 0.62), [0, 0.12, 0], [0, 0, 0], [1.24 * 1.07, 1.22 * 1.03, 0.84 * 1.09]]]), m, J.chest);
      longSleeves(gilt ? add(GOLD()) : m, gold());
      const buttons = [];
      for (const sx of [1, -1]) for (let i = 0; i < 4; i++) buttons.push([sph(0.012, 8, 6), [sx * 0.085, 0.25 - i * 0.055, 0.165 - i * 0.004]]);
      mesh(merged('boleroButtons', buttons), gilt ? add(mat(0xf2f2f2, { roughness: 0.2, metalness: 0.6 })) : gold(), J.chest, false);
      if (gilt) {
        const ep = [];
        for (const sx of [1, -1]) {
          ep.push([sph(0.08, 14, 8), [sx * 0.27, 0.31, 0], [0, 0, 0], [1.25, 0.45, 1]]);
          for (let i = 0; i < 6; i++) ep.push([cyl(0.008, 0.008, 0.07, 5), [sx * (0.2 + i * 0.03), 0.27, 0.06 - (i % 2) * 0.12]]);
        }
        mesh(merged('epaulettes', ep), gold(), J.chest);
      } else {
        mesh(merged('boleroTrim', [[torus(0.17, 0.006, 4, 30, Math.PI * 1.2), [0, 0.2, 0], [Math.PI / 2, 0, Math.PI * 0.9], [1.5, 1.0, 1]]]), gold(), J.chest, false);
      }
      break;
    }
  }

  // ---- pants
  const legs = LEGS[look.legs];
  const pelvisShell = (m, k = 1.07) => mesh(merged(`pelvis${k}`, [[sph(0.19, 20, 12), [0, -0.02, 0], [0, 0, 0], [1.0 * k, 0.62 * k, 0.76 * k]]]), m, J.hips);
  const trousers = (m, shinM = m) => each((side) => {
    mesh(shell('th', THIGH, 1.1), m, J['hip' + side]);
    mesh(shell('sh', SHIN, 1.12, -0.3), shinM, J['kn' + side]);
  });
  const belt = (m) => { hide(P.belt, P.tails); mesh(merged('belt2', [[torus(0.17, 0.018, 6, 28), [0, 0.06, 0], [Math.PI / 2, 0, 0], [1.08, 0.86, 1]], [box(0.05, 0.04, 0.02), [0, 0.06, 0.15]]]), m, J.hips, false); };
  switch (look.legs) {
    case 'shorts': {
      const m = cloth(dye(legs, c, 'accent'), { roughness: 0.35, metalness: 0.1 });
      each((side) => { P.thigh[side].material = model.skinMat; P.shin[side].material = model.skinMat; mesh(shell('shorts', THIGH, 1.18, -0.26), m, J['hip' + side]); });
      pelvisShell(m);
      hide(P.tails);
      mesh(merged('waistband', [[torus(0.17, 0.02, 6, 28), [0, 0.06, 0], [Math.PI / 2, 0, 0], [1.08, 0.86, 1]]]), add(mat(0xf2ede4)), J.hips, false);
      hide(P.belt);
      break;
    }
    case 'jeans': case 'cargo': case 'charro': case 'jmJoggers': {
      const color = { jeans: 0x3c5a82, cargo: 0x56603a, charro: 0x121014, jmJoggers: 0xb3161b }[look.legs];
      const m = cloth(color, { roughness: look.legs === 'charro' ? 0.5 : 0.9 });
      trousers(m); pelvisShell(m);
      belt(add(mat(0x3a2414, { roughness: 0.6 })));
      if (look.legs === 'cargo') each((side, sx) => mesh(merged(`pocket${side}`, [[box(0.03, 0.1, 0.09), [sx * 0.105, -0.24, 0.01]]]), m, J['hip' + side], false));
      if (look.legs === 'charro') {
        const silver = add(mat(0xd8dce4, { roughness: 0.2, metalness: 0.9 }));
        each((side, sx) => {
          mesh(merged(`charroTh${side}`, [0, 1, 2, 3, 4].map((i) => [sph(0.011, 6, 5), [sx * (0.112 - i * 0.006), -0.06 - i * 0.085, 0]])), silver, J['hip' + side], false);
          mesh(merged(`charroSh${side}`, [0, 1, 2].map((i) => [sph(0.011, 6, 5), [sx * (0.083 - i * 0.004), -0.07 - i * 0.08, 0]])), silver, J['kn' + side], false);
        });
      }
      if (look.legs === 'jmJoggers') {
        const g = gold();
        each((side, sx) => {
          mesh(merged(`stripeTh${side}`, [[box(0.012, 0.5, 0.025), [sx * 0.1, -0.22, 0], [0, 0, sx * 0.04]]]), g, J['hip' + side], false);
          mesh(merged(`stripeSh${side}`, [[box(0.012, 0.3, 0.022), [sx * 0.075, -0.14, 0], [0, 0, -sx * 0.03]]]), g, J['kn' + side], false);
        });
      }
      break;
    }
    case 'matador': {
      const m = add(GOLD());
      each((side) => mesh(shell('breeches', THIGH, 1.12, -0.44), m, J['hip' + side]));
      const stock = add(mat(0xf08aa8, { roughness: 0.7 }));
      each((side) => mesh(shell('sh', SHIN, 1.12, -0.3), stock, J['kn' + side]));
      pelvisShell(m);
      belt(add(mat(0xb3161b, { roughness: 0.6 })));
      break;
    }
  }

  // ---- shoes
  const feet = FEET[look.feet];
  switch (look.feet) {
    case 'sneakers': {
      const white = add(mat(0xf2f0ec, { roughness: 0.7 }));
      const sole = add(mat(dye(feet, c, 'accent'), { roughness: 0.6 }));
      each((side) => {
        hide(P.foot[side], P.ankle[side]);
        mesh(merged('sneaker', [[sph(0.068, 14, 10), [0, -0.47, 0.035], [0, 0, 0], [1.0, 0.85, 2.05]], [cyl(0.064, 0.068, 0.13, 14), [0, -0.39, 0]]]), white, J['kn' + side]);
        mesh(merged('sneakerSole', [[box(0.13, 0.035, 0.29), [0, -0.508, 0.04]], [torus(0.066, 0.008, 4, 16), [0, -0.33, 0], [Math.PI / 2, 0, 0]]]), sole, J['kn' + side], false);
      });
      break;
    }
    case 'huaraches': {
      const leather = add(mat(0x7a4a24, { roughness: 0.85 }));
      each((side) => {
        hide(P.ankle[side]);
        P.foot[side].material = model.skinMat;
        mesh(merged('huarache', [
          [box(0.12, 0.02, 0.27), [0, -0.515, 0.035]],
          [torus(0.058, 0.009, 4, 16), [0, -0.485, 0.09], [0, 0, 0], [1, 0.75, 1]],
          [torus(0.058, 0.009, 4, 16), [0, -0.485, 0.02], [0, 0, 0], [1, 0.75, 1]],
          [torus(0.054, 0.008, 4, 16), [0, -0.43, -0.01], [Math.PI / 2, 0, 0]],
        ]), leather, J['kn' + side], false);
      });
      break;
    }
    case 'boots': case 'goldBoots': {
      const m = look.feet === 'goldBoots' ? add(GOLD()) : add(mat(0x6a3d1f, { roughness: 0.55, metalness: 0.05 }));
      const band = look.feet === 'goldBoots' ? add(mat(0xd0102a, { roughness: 0.3 })) : add(mat(c.accent, { roughness: 0.5 }));
      each((side) => {
        hide(P.foot[side], P.ankle[side]);
        mesh(merged('boot', [
          [cyl(0.072, 0.064, 0.26, 16), [0, -0.33, 0]],
          [sph(0.068, 14, 10), [0, -0.468, 0.045], [0, 0, 0], [1.0, 0.85, 2.2]],
          [cone(0.04, 0.08, 10), [0, -0.475, 0.19], [Math.PI / 2, 0, 0], [1, 1, 0.6]],
          [box(0.07, 0.055, 0.07), [0, -0.5, -0.06]],
        ]), m, J['kn' + side]);
        mesh(merged('bootBand', [[torus(0.072, 0.009, 4, 18), [0, -0.205, 0], [Math.PI / 2, 0, 0]]]), band, J['kn' + side], false);
      });
      break;
    }
  }

  // ---- gloves
  const hands = HANDS[look.hands];
  switch (look.hands) {
    case 'mma': {
      const m = add(mat(dye(hands, c, 'trim'), { roughness: 0.55 }));
      each((side) => {
        hide(P.wrap[side]);
        mesh(merged('mma', [[sph(0.056, 12, 8), [0, -0.3, 0.012], [0, 0, 0], [1, 0.85, 1]], [cyl(0.05, 0.053, 0.06, 12), [0, -0.235, 0]]]), m, J['el' + side]);
      });
      break;
    }
    case 'boxing': case 'mitts': {
      const mitt = look.hands === 'mitts';
      const m = add(mat(mitt ? 0xc4231a : dye(hands, c, 'accent'), { roughness: mitt ? 0.9 : 0.35, metalness: mitt ? 0 : 0.1 }));
      const cuff = add(mat(0xf2ede4, { roughness: 0.8 }));
      each((side, sx) => {
        hide(P.wrap[side], P.fist[side]);
        mesh(merged(mitt ? 'mitt' : 'glove', mitt
          ? [[sph(0.075, 14, 10), [0, -0.34, 0.01], [0, 0, 0], [1, 1.45, 0.85]]]
          : [[sph(0.085, 14, 10), [0, -0.33, 0.02], [0, 0, 0], [1, 1.15, 1.1]], [sph(0.035, 8, 6), [-sx * 0.065, -0.3, 0.05]]]), m, J['el' + side]);
        mesh(merged('gloveCuff', [[cyl(0.062, 0.058, 0.1, 14), [0, -0.22, 0]]]), cuff, J['el' + side], false);
      });
      break;
    }
    case 'gauntlets': {
      const steel = add(mat(0xaab2bf, { roughness: 0.25, metalness: 0.9 }));
      each((side) => {
        hide(P.wrap[side]);
        mesh(merged('gauntlet', [[cyl(0.068, 0.058, 0.17, 14), [0, -0.165, 0]], [sph(0.058, 12, 8), [0, -0.305, 0.01], [0, 0, 0], [1.05, 0.95, 1.05]], [box(0.1, 0.035, 0.05), [0, -0.345, 0.03]]]), steel, J['el' + side]);
      });
      break;
    }
  }
}

// Recolours the gi and trim and sets their finish.
function applyOutfit(model, def, outfitId) {
  const [giMat, trimMat] = model.mats;
  const c = outfitColors(def, outfitId);
  giMat.color.setHex(c.gi);
  trimMat.color.setHex(c.trim);
  if (c.finish === 'metal') {
    giMat.roughness = 0.5; giMat.metalness = 0.18;
    trimMat.roughness = 0.28; trimMat.metalness = 0.8;
  } else if (c.finish === 'gold') {
    giMat.roughness = 0.3; giMat.metalness = 0.85;
    giMat.emissive.setHex(0x2a1800); giMat.emissiveIntensity = 0.4;
    trimMat.roughness = 0.4; trimMat.metalness = 0.4;
  }
  if (c.glow != null) { trimMat.emissive.setHex(c.glow); trimMat.emissiveIntensity = 0.9; }
  if (c.giGlow != null) { giMat.emissive.setHex(c.giGlow); giMat.emissiveIntensity = 0.55; }
}

// Capes and banners sway as the fighter moves; called every frame from animateLife.
export function swayCape(model, speed, t, dt) {
  if (!model.cape) return;
  const k = Math.min(1, dt * 6);
  if (model.capeAxis === 'y') { // a banner flutters side to side
    const want = Math.sin(t * 3.1) * (0.15 + Math.min(0.35, speed * 0.05)) + Math.sin(t * 8.3) * 0.05;
    model.cape.rotation.y += (want - model.cape.rotation.y) * k;
    return;
  }
  const want = Math.min(0.9, speed * 0.09) + Math.sin(t * 2.3) * 0.04 + Math.sin(t * 7) * Math.min(0.06, speed * 0.01);
  model.cape.rotation.x += (want - model.cape.rotation.x) * k;
}
