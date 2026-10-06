// Gear a fighter can pick up: weapon and gun meshes (held in the hand, holstered on the hip and
// floating over the arena's pickup pads) and the SVG icons the ability bar draws for each item.
import * as THREE from 'three';

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const box = (x, y, z) => geo(`b${x}_${y}_${z}`, () => new THREE.BoxGeometry(x, y, z));
const cyl = (r1, r2, h, n = 10) => geo(`c${r1}_${r2}_${h}_${n}`, () => new THREE.CylinderGeometry(r1, r2, h, n));

// Shared materials: every copy of a weapon uses the same few, so 8 armed fighters add no shader work.
// (The arena has no environment map, so fully metallic surfaces would render black: metals stay half metal.)
const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0xe4ecf4, roughness: 0.25, metalness: 0.55 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.45, metalness: 0.5 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6a4424, roughness: 0.8, metalness: 0.0 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.9 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xe8b44a, roughness: 0.3, metalness: 0.55 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xd08040, roughness: 0.35, metalness: 0.5 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x6af0ff, emissive: 0x2ad8ff, emissiveIntensity: 1.6, roughness: 0.3 }),
  iron: new THREE.MeshStandardMaterial({ color: 0xa8b2c2, roughness: 0.32, metalness: 0.5 }),
};
export const ITEM_MATERIALS = Object.values(MAT);

function part(g, geometry, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  g.add(m);
  return m;
}

// Melee weapons are modelled with the grip at the origin and the business end up +Y.
function sword() {
  const g = new THREE.Group();
  part(g, cyl(0.022, 0.024, 0.2), MAT.leather, 0, 0, 0);
  part(g, geo('pommel', () => new THREE.SphereGeometry(0.035, 10, 8)), MAT.gold, 0, -0.12, 0);
  part(g, box(0.22, 0.035, 0.05), MAT.gold, 0, 0.11, 0);
  // a tapered blade: a flattened four-sided cone
  const blade = part(g, geo('blade', () => new THREE.CylinderGeometry(0.004, 0.045, 0.95, 4, 1).scale(1, 1, 0.22)), MAT.steel, 0, 0.6, 0);
  blade.rotation.y = Math.PI / 4;
  return g;
}

function axe() {
  const g = new THREE.Group();
  part(g, cyl(0.022, 0.026, 0.85), MAT.wood, 0, 0.25, 0);
  part(g, cyl(0.026, 0.026, 0.12), MAT.leather, 0, -0.05, 0);
  // the head: a fan-shaped wedge on one side and a short spike behind
  const head = geo('axehead', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.07); s.lineTo(0.13, -0.13); s.quadraticCurveTo(0.24, 0, 0.13, 0.15); s.lineTo(0, 0.08); s.lineTo(0, -0.07);
    return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 }).translate(0, 0, -0.015);
  });
  part(g, head, MAT.steel, 0.02, 0.6, 0);
  part(g, geo('spike', () => new THREE.ConeGeometry(0.03, 0.12, 6)), MAT.dark, -0.07, 0.6, 0, 0, 0, Math.PI / 2);
  return g;
}

function hammer() {
  const g = new THREE.Group();
  part(g, cyl(0.024, 0.028, 0.8), MAT.wood, 0, 0.22, 0);
  part(g, cyl(0.03, 0.03, 0.14), MAT.leather, 0, -0.06, 0);
  part(g, box(0.3, 0.16, 0.16), MAT.iron, 0, 0.66, 0);
  part(g, box(0.06, 0.2, 0.2), MAT.dark, 0.15, 0.66, 0);
  part(g, box(0.06, 0.2, 0.2), MAT.dark, -0.15, 0.66, 0);
  return g;
}

// Guns are modelled with the barrel along +Z and the grip hanging down -Y.
function pistol() {
  const g = new THREE.Group();
  part(g, box(0.06, 0.08, 0.3), MAT.dark, 0, 0.04, 0.08);
  part(g, cyl(0.022, 0.022, 0.16, 8), MAT.steel, 0, 0.055, 0.28, Math.PI / 2);
  part(g, box(0.05, 0.14, 0.07), MAT.wood, 0, -0.06, -0.02, -0.25);
  part(g, box(0.012, 0.03, 0.03), MAT.gold, 0, 0.1, 0.18);
  return g;
}

function shotgun() {
  const g = new THREE.Group();
  part(g, cyl(0.028, 0.028, 0.62, 8), MAT.dark, 0.02, 0.05, 0.36, Math.PI / 2);
  part(g, cyl(0.028, 0.028, 0.62, 8), MAT.dark, -0.02, 0.05, 0.36, Math.PI / 2);
  part(g, box(0.07, 0.07, 0.22), MAT.copper, 0, 0.03, 0.02);
  part(g, box(0.06, 0.1, 0.3), MAT.wood, 0, -0.02, -0.2, 0.15);
  part(g, box(0.06, 0.05, 0.16), MAT.wood, 0, 0.0, 0.32);
  return g;
}

function rifle() {
  const g = new THREE.Group();
  part(g, box(0.07, 0.09, 0.55), MAT.dark, 0, 0.04, 0.2);
  part(g, cyl(0.018, 0.018, 0.5, 8), MAT.steel, 0, 0.06, 0.66, Math.PI / 2);
  part(g, box(0.02, 0.03, 0.5), MAT.rail, 0.04, 0.06, 0.32);
  part(g, box(0.02, 0.03, 0.5), MAT.rail, -0.04, 0.06, 0.32);
  part(g, cyl(0.025, 0.025, 0.18, 8), MAT.steel, 0, 0.12, 0.18, Math.PI / 2);
  part(g, box(0.06, 0.12, 0.24), MAT.dark, 0, -0.02, -0.18, 0.1);
  return g;
}

const BUILDERS = { sword, axe, hammer, pistol, shotgun, rifle };

// A fresh mesh group for a weapon or gun (geometry and materials are shared).
export function buildGear(kind) {
  const make = BUILDERS[kind];
  const g = make ? make() : new THREE.Group();
  g.userData.kind = kind;
  return g;
}

// Worn armour: a helmet for the head and a breastplate with pauldrons for the chest.
export function buildArmor() {
  const helm = new THREE.Group();
  part(helm, geo('helm', () => new THREE.SphereGeometry(0.155, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), MAT.iron, 0, 0.15, -0.005);
  part(helm, box(0.03, 0.12, 0.03), MAT.iron, 0, 0.12, 0.15);
  part(helm, geo('helmrim', () => new THREE.TorusGeometry(0.15, 0.014, 6, 24).rotateX(Math.PI / 2)), MAT.dark, 0, 0.17, 0);
  part(helm, geo('crest', () => new THREE.BoxGeometry(0.025, 0.07, 0.24)), MAT.gold, 0, 0.31, -0.02);
  const chest = new THREE.Group();
  // shaped to sit just outside the fighter's ribcage (radius 0.2 scaled 1.24 x 1.22 x 0.84)
  part(chest, geo('plate', () => new THREE.SphereGeometry(0.21, 18, 12, Math.PI * 0.05, Math.PI * 0.9, Math.PI * 0.16, Math.PI * 0.62)), MAT.iron, 0, 0.12, 0.0).scale.set(1.27, 1.25, 0.9);
  part(chest, geo('backplate', () => new THREE.SphereGeometry(0.21, 18, 12, Math.PI * 1.05, Math.PI * 0.9, Math.PI * 0.16, Math.PI * 0.62)), MAT.dark, 0, 0.12, 0.0).scale.set(1.27, 1.25, 0.88);
  for (const side of [-1, 1]) {
    const p = part(chest, geo('pauldron', () => new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), MAT.iron, side * 0.3, 0.25, 0);
    p.scale.set(1.15, 0.9, 1.1);
    p.rotation.z = side * -0.35;
  }
  part(chest, box(0.42, 0.05, 0.28), MAT.gold, 0, -0.08, 0);
  return { helm, chest };
}

// ---- icons for the ability bar and the pickup banner (40x40, drawn in the item's colour) ----
const P = (d, extra = '') => `<path d="${d}" ${extra}/>`;
const ICONS = {
  sword: P('M30 4l6 0 0 6-17 17-6-6zM9 22l9 9-3 3-2-2-4 4-3-3 4-4-2-2z'),
  axe: P('M8 36l-3-3 17-17 3 3zM20 6c8-2 14 4 14 14-4-3-7-4-11-3l-3-3c1-3 0-5 0-8z'),
  hammer: P('M7 37l-3-3 16-16 3 3zM16 10l8-8 14 14-8 8z'),
  plate: P('M20 4c-6 3-11 3-15 2 0 15 5 25 15 30 10-5 15-15 15-30-4 1-9 1-15-2zm0 6v22c-6-4-9-10-10-20 4 0 7-1 10-2z'),
  pistol: P('M4 12h30v8H18l-2 4h-4l-2 10H4l3-14H4z'),
  shotgun: P('M2 15h34v5H20l-3 3H11l-2 8H3l3-10H2zM24 21h8v4h-8z'),
  rifle: P('M2 17h36v4H22l-3 3h-7l-2 7H4l3-10H2zM14 11h12v4H14z'),
  sp_fireball: P('M24 6c2 6 10 9 10 18a12 12 0 0 1-24 0c0-5 3-8 5-10 0 4 2 6 4 6-1-6 2-10 5-14z'),
  sp_chain: P('M22 2L8 22h9l-3 16 18-22h-10l6-14z'),
  sp_meteor: P('M26 14a10 10 0 1 1-12 12zM4 4l14 14-3 3L2 8zM12 2l12 12-2 2L10 6zM2 12l12 12-2 2L2 16z'),
  sp_frostnova: P('M18 2h4v36h-4zM2 18h36v4H2zM6.5 9.3l2.8-2.8 24.2 24.2-2.8 2.8zM30.7 6.5l2.8 2.8L9.3 33.5l-2.8-2.8z'),
  sp_heal: P('M15 4h10v11h11v10H25v11H15V25H4V15h11z'),
};
const GUN_OF = { gun_pistol: 'pistol', gun_shotgun: 'shotgun', gun_rifle: 'rifle' };

export function itemIcon(id, color) {
  const key = GUN_OF[id] || id;
  const body = ICONS[key] || '<circle cx="20" cy="20" r="12"/>';
  return `<svg viewBox="0 0 40 40" width="100%" height="100%" fill="${color}" aria-hidden="true">${body}</svg>`;
}
