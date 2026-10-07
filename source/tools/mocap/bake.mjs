// Bakes the chosen CMU motion capture clips into src/mocapData.js.
// Usage (from source/):  npm i --no-save three@0.180.0 && node tools/mocap/bake.mjs
// The BVH takes are downloaded into tools/mocap/cache/ (not committed) on first run.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { parseBVH, makeRetarget, pose, heading, JOINTS } from './bvh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const raw = join(here, 'cache'), outFile = join(here, '../../src/mocapData.js');
// Bruce Hahne's BVH conversion of the CMU database, mirrored on GitHub
const SOURCE = 'https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data';
const FPS = 30;
// name, CMU take, window (s), how to face it forward, optional strike time / loop search
const CLIPS = [
  { name: 'idle', take: '15_13', a: 2.0, b: 3.4, yaw: 'guard', loop: [0.7, 1.4] },
  { name: 'run', take: '09_01', a: 0.3, b: 1.22, yaw: 'travel', loop: [0.55, 0.85] },
  { name: 'jab', take: '14_01', a: 2.12, b: 2.85, yaw: 'LH@2.4', hit: 2.4 },
  { name: 'cross', take: '14_01', a: 2.58, b: 3.3, yaw: 'RH@2.84', hit: 2.84 },
  { name: 'power', take: '13_17', a: 1.66, b: 2.5, yaw: 'RH@2.01', hit: 2.01 },
  { name: 'frontkick', take: '144_05', a: 2.55, b: 3.5, yaw: 'RF@3.01', hit: 3.01 },
  { name: 'roundhouse', take: '135_07', a: 3.15, b: 4.25, yaw: 'LF@3.67', hit: 3.67 },
  { name: 'flykick', take: '75_16', a: 1.55, b: 2.45, yaw: 'RF@2.01', hit: 2.01 },
  { name: 'jump', take: '13_11', a: 1.88, b: 2.46, yaw: 'travel' },
  { name: 'duck', take: '77_09', a: 1.75, b: 2.75, yaw: 'auto' },
];

const EFF = { RH: ['RightHand', 'Spine1'], LH: ['LeftHand', 'Spine1'], RF: ['RightFoot', 'Hips'], LF: ['LeftFoot', 'Hips'] };
const dirYaw = (d) => Math.atan2(d.x, d.z);

function yawFor(b, c, fps) {
  if (/^[RL][HF]@/.test(c.yaw)) {
    const [k, t] = c.yaw.split('@'); const P = pose(b, +t * fps);
    return dirYaw(P[EFF[k][0]].pos.clone().sub(P[EFF[k][1]].pos));
  }
  if (c.yaw === 'guard') { // hands held up toward the opponent
    const d = new THREE.Vector3();
    for (let t = c.a; t < c.b; t += 0.1) { const P = pose(b, t * fps); d.add(P.LeftHand.pos).add(P.RightHand.pos).sub(P.Spine1.pos.clone().multiplyScalar(2)); }
    return dirYaw(d);
  }
  if (c.yaw === 'travel') return dirYaw(pose(b, c.b * fps).Hips.pos.clone().sub(pose(b, c.a * fps).Hips.pos));
  return heading(pose(b, c.a * fps));
}

function sample(at, fps, t, yaw) {
  const r = at(t * fps, yaw);
  return { q: JOINTS.map((k) => r.local[k].clone()), lift: r.lift };
}
function dist(x, y) {
  let s = 0;
  for (let i = 0; i < x.q.length; i++) s += 1 - Math.abs(x.q[i].dot(y.q[i]));
  return s + Math.abs(x.lift - y.lift) * 4;
}

mkdirSync(raw, { recursive: true });
for (const c of CLIPS) {
  const file = `${raw}/${c.take}.bvh`;
  if (existsSync(file)) continue;
  const url = `${SOURCE}/${c.take.split('_')[0].padStart(3, '0')}/${c.take}.bvh`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const out = [];
const cache = {};
for (const c of CLIPS) {
  const b = cache[c.take] ||= parseBVH(`${raw}/${c.take}.bvh`);
  const fps = Math.round(1 / b.frameTime);
  const at = makeRetarget(b);
  const yaw = yawFor(b, c, fps);
  let end = c.b;
  if (c.loop) { // end the loop where the pose comes closest to the first frame
    const first = sample(at, fps, c.a, yaw);
    let best = 1e9;
    for (let t = c.a + c.loop[0]; t <= Math.min(c.b, c.a + c.loop[1]); t += 1 / fps) {
      const d = dist(first, sample(at, fps, t, yaw));
      if (d < best) { best = d; end = t; }
    }
    console.log(`${c.name}: loop ${(end - c.a).toFixed(2)}s, seam error ${best.toFixed(3)}`);
  }
  const n = Math.max(2, Math.round((end - c.a) * FPS) + (c.loop ? 0 : 1));
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(sample(at, fps, c.a + i / FPS, yaw));
  if (c.loop) { // fade the last few frames into the first so the seam is invisible
    const K = Math.min(6, n >> 2);
    for (let i = 0; i < K; i++) {
      const fr = frames[n - K + i], w = (i + 1) / (K + 1);
      fr.q.forEach((q, j) => { const t = frames[0].q[j]; if (q.dot(t) < 0) t.set(-t.x, -t.y, -t.z, -t.w); q.slerp(t, w * w); });
      fr.lift += (frames[0].lift - fr.lift) * w * w;
    }
  }
  // keep neighbouring quaternions in the same hemisphere so interpolation never takes the long way
  for (let i = 1; i < n; i++) frames[i].q.forEach((q, j) => { if (q.dot(frames[i - 1].q[j]) < 0) q.set(-q.x, -q.y, -q.z, -q.w); });
  const data = new Int16Array(n * 49);
  frames.forEach((f, i) => {
    f.q.forEach((q, j) => { const o = i * 49 + j * 4; data[o] = Math.round(q.x * 32767); data[o + 1] = Math.round(q.y * 32767); data[o + 2] = Math.round(q.z * 32767); data[o + 3] = Math.round(q.w * 32767); });
    data[i * 49 + 48] = Math.round(f.lift * 10000);
  });
  out.push({ name: c.name, take: c.take, n, loop: !!c.loop, hit: c.hit ? +((c.hit - c.a)).toFixed(3) : undefined,
    data: Buffer.from(data.buffer).toString('base64') });
}

const body = out.map((c) => `  ${c.name}: { take: '${c.take}', n: ${c.n}, loop: ${c.loop}${c.hit !== undefined ? `, hit: ${c.hit}` : ''},\n    data: '${c.data}' },`).join('\n');
writeFileSync(outFile, `// Generated by tools/mocap/bake.mjs from the CMU Graphics Lab Motion Capture Database
// (mocap.cs.cmu.edu, free for research and commercial use; created with funding from NSF EIA-0196217),
// retargeted onto the fighter rig. Each frame is 12 joint quaternions then the hip lift, as int16, at 30 fps.
export const MOCAP_FPS = ${FPS};
export const MOCAP = {
${body}
};
`);
console.log(`wrote ${outFile}: ${(body.length / 1024).toFixed(1)} KB`);
