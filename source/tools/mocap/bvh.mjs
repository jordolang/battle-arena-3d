// BVH parsing, forward kinematics and retargeting onto the fighter's 12-joint rig.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

export function parseBVH(path) {
  const txt = readFileSync(path, 'utf8');
  const tok = txt.split(/\s+/).filter(Boolean);
  let i = 0;
  const joints = [];
  function readJoint(parent) {
    const kind = tok[i++]; // ROOT / JOINT / End
    let name;
    if (kind === 'End') { i++; name = (parent ? parent.name : '') + '_end'; } else name = tok[i++];
    const j = { name, parent, offset: null, channels: [], children: [], end: kind === 'End' };
    if (tok[i++] !== '{') throw new Error('bvh {');
    while (tok[i] !== '}') {
      const t = tok[i++];
      if (t === 'OFFSET') { j.offset = new THREE.Vector3(+tok[i++], +tok[i++], +tok[i++]); }
      else if (t === 'CHANNELS') { const n = +tok[i++]; for (let k = 0; k < n; k++) j.channels.push(tok[i++]); }
      else if (t === 'JOINT' || t === 'End') { i--; j.children.push(readJoint(j)); }
    }
    i++;
    joints.push(j);
    return j;
  }
  if (tok[i++] !== 'HIERARCHY') throw new Error('bvh');
  const root = readJoint(null);
  if (tok[i++] !== 'MOTION') throw new Error('motion');
  i++; const nFrames = +tok[i++];
  i += 2; const frameTime = +tok[i++];
  // channel layout in hierarchy order (depth-first, as written)
  const order = [];
  (function walk(j) { order.push(j); j.children.forEach(walk); })(root);
  const nCh = order.reduce((s, j) => s + j.channels.length, 0);
  const data = new Float32Array(nFrames * nCh);
  for (let k = 0; k < nFrames * nCh; k++) data[k] = +tok[i++];
  let c = 0;
  for (const j of order) { j.chIndex = c; c += j.channels.length; }
  const byName = Object.fromEntries(order.map((j) => [j.name, j]));
  return { root, order, byName, nFrames, frameTime, nCh, data };
}

const D2R = Math.PI / 180;
const AX = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
const _q = new THREE.Quaternion();

// world positions and rotations of every joint at (fractional) frame f
export function pose(b, frame) {
  frame = Math.min(frame, b.nFrames - 1);
  const f0 = Math.floor(frame), f1 = Math.min(b.nFrames - 1, f0 + 1), t = frame - f0;
  const out = {};
  for (const j of b.order) {
    const local = new THREE.Quaternion();
    const pos = j.offset.clone();
    if (j.channels.length) {
      const ch = (k) => { const a = b.data[f0 * b.nCh + j.chIndex + k], c = b.data[f1 * b.nCh + j.chIndex + k]; return a + (c - a) * t; };
      j.channels.forEach((name, k) => {
        const v = ch(k);
        if (name.endsWith('position')) pos.setComponent('XYZ'.indexOf(name[0]), v + (j.parent ? j.offset.getComponent('XYZ'.indexOf(name[0])) : 0));
        else local.multiply(_q.setFromAxisAngle(AX[name[0]], v * D2R));
      });
    }
    const p = j.parent ? out[j.parent.name] : null;
    const rot = p ? p.rot.clone().multiply(local) : local;
    const wpos = p ? pos.clone().applyQuaternion(p.rot).add(p.pos) : pos;
    out[j.name] = { rot, pos: wpos, local };
  }
  return out;
}

// target joint -> [source joint, source child used for the bone direction]
export const MAP = {
  hips: ['Hips', null],
  spine: ['Spine', 'Spine1'],
  chest: ['Spine1', 'Neck'],
  head: ['Head', 'Head_end'],
  shL: ['LeftArm', 'LeftForeArm'], elL: ['LeftForeArm', 'LeftHand'],
  shR: ['RightArm', 'RightForeArm'], elR: ['RightForeArm', 'RightHand'],
  hipL: ['LeftUpLeg', 'LeftLeg'], knL: ['LeftLeg', 'LeftFoot'],
  hipR: ['RightUpLeg', 'RightLeg'], knR: ['RightLeg', 'RightFoot'],
};
export const PARENT = { hips: null, spine: 'hips', chest: 'spine', head: 'chest', shL: 'chest', elL: 'shL', shR: 'chest', elR: 'shR', hipL: 'hips', knL: 'hipL', hipR: 'hips', knR: 'hipR' };
export const JOINTS = ['hips', 'spine', 'chest', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR'];
// the axis each fighter limb part points along in its rest pose
const BONE_AXIS = { spine: [0, 1, 0], chest: [0, 1, 0], head: [0, 1, 0], shL: [0, -1, 0], elL: [0, -1, 0], shR: [0, -1, 0], elR: [0, -1, 0], hipL: [0, -1, 0], knL: [0, -1, 0], hipR: [0, -1, 0], knR: [0, -1, 0] };

export function makeRetarget(b) {
  const T = pose(b, 0); // frame 0 is the added T-pose
  const align = {}, invT = {};
  for (const k of JOINTS) {
    const [src, child] = MAP[k];
    invT[k] = T[src].rot.clone().invert();
    if (!child) { align[k] = new THREE.Quaternion(); continue; }
    const d0 = T[child].pos.clone().sub(T[src].pos).normalize();
    align[k] = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...BONE_AXIS[k]), d0);
  }
  const foot = (P) => Math.min(P.LeftFoot.pos.y, P.RightFoot.pos.y);
  const stand = T.Hips.pos.y - foot(T);
  // world rotation of each fighter joint at frame f, with heading `yaw` removed
  return function at(frame, yaw = 0) {
    const P = pose(b, frame);
    const H = new THREE.Quaternion().setFromAxisAngle(AX.Y, -yaw);
    const world = {}, local = {};
    for (const k of JOINTS) {
      const src = MAP[k][0];
      world[k] = H.clone().multiply(P[src].rot).multiply(invT[k]).multiply(align[k]);
    }
    for (const k of JOINTS) local[k] = PARENT[k] ? world[PARENT[k]].clone().invert().multiply(world[k]) : world[k].clone();
    const lift = (P.Hips.pos.y - foot(P) - stand) / stand * 0.98;
    return { local, world, lift, P };
  };
}

// facing of the actor (yaw of the hips' forward axis) at frame f
export function heading(P) {
  const l = P.LeftUpLeg.pos, r = P.RightUpLeg.pos;
  // forward = up x (left - right) ... left is +X when facing +Z, so forward = (left-right) x up
  const side = l.clone().sub(r); side.y = 0; side.normalize();
  const fwd = new THREE.Vector3().crossVectors(side, new THREE.Vector3(0, 1, 0));
  return Math.atan2(fwd.x, fwd.z);
}
