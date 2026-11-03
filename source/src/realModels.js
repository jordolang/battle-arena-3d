// Rigged, textured fighter bodies (GLB files in models/, made from each fighter's reference art).
// The procedural skeleton in fighterModel.js still runs every pose, combo and mocap clip; when a
// fighter has a real model, its sculpted shapes are hidden and the model's bones copy the joints'
// rotations each frame. Fighters without a model, or pages where the file can't load (the offline
// single file, an Artifact), keep the procedural body.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from '../vendor/addons/utils/SkeletonUtils.js';

// Fighter ids that have a model file at models/<id>.glb.
export const REAL_MODEL_IDS = ['titan'];

// Procedural joint -> [model bone, bone that marks the end of that segment, the joint's own
// segment direction in its rest pose]. Bone names follow the rigger's Mixamo-style skeleton,
// where the spine counts down: Spine02 sits just above the hips and Spine just below the neck.
const UP = [0, 1, 0], DOWN = [0, -1, 0];
const BONE_MAP = [
  ['hips', 'Hips', 'Spine02', UP],
  ['spine', 'Spine02', 'Spine', UP],
  ['chest', 'Spine', 'neck', UP],
  ['head', 'Head', 'head_end', UP],
  ['shL', 'LeftArm', 'LeftForeArm', DOWN],
  ['elL', 'LeftForeArm', 'LeftHand', DOWN],
  ['shR', 'RightArm', 'RightForeArm', DOWN],
  ['elR', 'RightForeArm', 'RightHand', DOWN],
  ['hipL', 'LeftUpLeg', 'LeftLeg', DOWN],
  ['knL', 'LeftLeg', 'LeftFoot', DOWN],
  ['hipR', 'RightUpLeg', 'RightLeg', DOWN],
  ['knR', 'RightLeg', 'RightFoot', DOWN],
];
// Height of a procedural fighter in body units (before the fighter's own scale), so a model
// stands as tall as the body it replaces.
const BODY_HEIGHT = 2.0;

const cache = new Map(); // id -> { scene, height } once loaded, or null after a failure
const waiting = new Map(); // id -> models waiting for that file
let loader = null;

function modelBase() {
  const custom = typeof window !== 'undefined' && window.ARENA_MODEL_BASE;
  return custom || new URL('models/', document.baseURI).href;
}

// Starts loading every model file. Safe to call more than once.
export function preloadRealModels() {
  if (typeof document === 'undefined' || /^(data|blob):/.test(document.baseURI)) return;
  loader ||= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  for (const id of REAL_MODEL_IDS) {
    if (cache.has(id) || waiting.has(id)) continue;
    waiting.set(id, []);
    loader.load(modelBase() + id + '.glb', (gltf) => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      scene.traverse((o) => {
        if (!o.isMesh) return;
        // the rigger's emissive layer is a blank map: drop it to save memory
        o.material.emissiveMap = null;
        o.material.emissive?.setHex(0);
        // nothing on these fighters is bare metal; the rigger's metal map only darkens skin and cloth
        o.material.metalnessMap = null;
        o.material.metalness = 0;
      });
      cache.set(id, { scene, height: box.max.y - box.min.y, floor: box.min.y });
      for (const model of waiting.get(id)) if (!model.disposed) attach(model, id);
      waiting.delete(id);
    }, undefined, () => {
      cache.set(id, null);
      waiting.delete(id);
    });
  }
}

// Gives `model` (from buildFighterModel and dressFighter) its real body now, or as soon as the file
// arrives. Call it before adding team or reward pieces.
export function useRealModel(model, id) {
  if (!REAL_MODEL_IDS.includes(id)) return;
  preloadRealModels();
  markBody(model);
  const hit = cache.get(id);
  if (hit) attach(model, id);
  else if (waiting.has(id)) waiting.get(id).push(model);
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();

// Rotation of `obj` relative to the ancestor `stop`.
function relQuat(obj, stop, out) {
  out.identity();
  for (let o = obj; o && o !== stop; o = o.parent) out.premultiply(o.quaternion);
  return out;
}
// Transform of `obj` relative to the ancestor `stop`.
function relMatrix(obj, stop, out) {
  out.identity();
  for (let o = obj; o && o !== stop; o = o.parent) { o.updateMatrix(); out.premultiply(o.matrix); }
  return out;
}

function attach(model, id) {
  if (model.real) return;
  const { scene, height, floor } = cache.get(id);
  const rig = cloneSkinned(scene);
  const holder = new THREE.Group();
  const k = BODY_HEIGHT / height;
  holder.scale.setScalar(k);
  holder.position.y = -floor * k;
  holder.add(rig);
  model.body.add(holder);

  for (const o of model.bodyMeshes) o.visible = false;
  rig.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // bones move the skin well outside its bind-pose bounds
    o.material = o.material.clone(); // per fighter, so tints and disposal don't leak between copies
    model.mats.push(o.material);
  });

  // Rest-pose bookkeeping. Procedural joints rest with no rotation, so a joint's rotation
  // relative to the body is its whole pose. Each bone gets a correction that turns its rest
  // direction (an A-pose) onto the joint's rest direction (arms and legs hanging straight).
  const pairs = [];
  const pa = new THREE.Vector3(), pb = new THREE.Vector3();
  for (const [joint, boneName, endName, dir] of BONE_MAP) {
    const bone = rig.getObjectByName(boneName), end = rig.getObjectByName(endName);
    if (!bone || !end) continue;
    pa.setFromMatrixPosition(relMatrix(bone, holder, _m));
    pb.setFromMatrixPosition(relMatrix(end, holder, _m));
    const from = pb.sub(pa).normalize();
    const align = new THREE.Quaternion().setFromUnitVectors(from, _v.fromArray(dir));
    const rest = align.multiply(relQuat(bone, holder, new THREE.Quaternion()));
    pairs.push({ joint: model.joints[joint], bone, rest });
  }
  const hipsBone = rig.getObjectByName('Hips');
  model.real = {
    id, holder, rig, pairs, k,
    hipsBone,
    // the hips' parent (the armature) never moves, so its transform is worked out once
    hipsRestHolder: new THREE.Vector3().setFromMatrixPosition(relMatrix(hipsBone, holder, _m)),
    toHipsParent: relMatrix(hipsBone.parent, holder, new THREE.Matrix4()).invert(),
    hipsRestBody: new THREE.Vector3(0, model.hipsBaseY, 0),
  };
  // the weapon grip sits in the model's right hand rather than the longer procedural forearm
  const fore = rig.getObjectByName('RightForeArm'), hand = rig.getObjectByName('RightHand');
  if (fore && hand && model.grip) {
    pa.setFromMatrixPosition(relMatrix(fore, holder, _m));
    pb.setFromMatrixPosition(relMatrix(hand, holder, _m));
    model.grip.position.y = -pa.distanceTo(pb) * k - 0.04;
  }
  syncRealModel(model);
}

// Notes which meshes make up the sculpted body (and its outfit) so they can be hidden under a real
// model. Gear, armor and the status shells are left out, and anything added later (team pads, goal
// rewards) stays visible on top of the real body.
function markBody(model) {
  const keep = new Set([model.grip, model.holster, model.armor?.helm, model.armor?.chest, model.ice, model.aura].filter(Boolean));
  const list = [];
  const walk = (o) => {
    if (keep.has(o)) return;
    if (o.isMesh) list.push(o);
    for (const c of o.children) walk(c);
  };
  walk(model.body);
  model.bodyMeshes = list;
}

// Copies the procedural joints' current pose onto the model's bones.
export function syncRealModel(model) {
  const R = model.real;
  if (!R) return;
  for (const { joint, bone, rest } of R.pairs) {
    // the bone turns by exactly as much as the joint, measured in the body's frame
    relQuat(joint, model.body, _q).multiply(rest);
    relQuat(bone.parent, R.holder, _q2).invert();
    bone.quaternion.copy(_q2.multiply(_q));
  }
  // the hips also carry the pose's rise and drop (crouches, knockdowns)
  const h = model.joints.hips.position;
  _v.set(h.x - R.hipsRestBody.x, h.y - R.hipsRestBody.y, h.z - R.hipsRestBody.z).divideScalar(R.k);
  R.hipsBone.position.copy(_v.add(R.hipsRestHolder).applyMatrix4(R.toHipsParent));
}

// Forgets a model whose fighter has been removed, so a late file doesn't attach to it.
export function releaseRealModel(model) {
  model.disposed = true;
}
