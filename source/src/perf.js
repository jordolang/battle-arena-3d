// Graphics quality ladder and the automatic step-down that keeps phones smooth.
// In Auto the game starts on a tier picked for the device (phones start lower), watches frame times, drops a
// tier when frames run long and climbs back when there is headroom. Shadows soften, then go, before the
// resolution drops. A tier that keeps failing is not retried, and when stepping down stops helping (a 30 fps
// battery-saver cap, or a slow CPU rather than GPU) it stops degrading. The tier that worked is remembered.
import * as THREE from 'three';

// prCap limits the canvas pixel ratio; shadow is the shadow map size (0 = off); soft picks PCFSoft over PCF
export const TIERS = [
  { name: 'Ultra',  prCap: 1.6,  shadow: 2048, soft: true },
  { name: 'High',   prCap: 1.4,  shadow: 1024, soft: true },
  { name: 'Medium', prCap: 1.2,  shadow: 1024, soft: false },
  { name: 'Low',    prCap: 1.0,  shadow: 0 },
  { name: 'Lower',  prCap: 0.85, shadow: 0 },
  { name: 'Lowest', prCap: 0.7,  shadow: 0 },
];
// the fixed settings for the Graphics option
const FIXED = { high: 0, low: 4 };
// from this tier down the menus skip their background blur, which phones re-run every frame over the live scene
const LITE_FROM = 3;
const SAVE_KEY = 'ba3d.autoTier';
const WINDOW = 2;        // seconds of frames judged at a time
const SLOW_MS = 20.5;    // average frame time that triggers a step down (under ~49 fps)
const FAST_MS = 12.5;    // average needed to try a step up (over ~80 fps)
const FAST_WINDOWS = 3;  // consecutive fast windows before stepping up

// phones and tablets: a touch screen with a coarse pointer, or a small screen
let handheld = null;
export function isHandheld() {
  if (handheld !== null) return handheld;
  try {
    const coarse = matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints || 0) > 0;
    handheld = coarse || Math.min(screen.width, screen.height) < 500;
  } catch { handheld = false; }
  return handheld;
}

function lowEnd() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  return cores <= 4 || mem <= 3;
}

export function startTier() {
  let t = isHandheld() ? (lowEnd() ? 3 : 2) : lowEnd() ? 1 : 0;
  try {
    const saved = parseInt(localStorage.getItem(SAVE_KEY), 10);
    if (saved >= 0 && saved < TIERS.length) t = saved;
  } catch { /* storage blocked */ }
  return t;
}

export class QualityGovernor {
  constructor(game, quality) {
    this.game = game;
    this.mode = quality;            // 'auto' | 'high' | 'low'
    this.tier = quality in FIXED ? FIXED[quality] : startTier();
    this.fails = TIERS.map(() => 0); // times each tier was stepped down from
    this.floor = TIERS.length - 1;  // lowest tier allowed; raised when stepping down stops helping
    this.reset();
  }

  reset() { this.acc = 0; this.n = 0; this.fast = 0; this.settle = 1; }

  setMode(quality) {
    this.mode = quality;
    this.fails.fill(0);
    this.floor = TIERS.length - 1;
    this.lastDrop = null;
    this.apply(quality in FIXED ? FIXED[quality] : startTier());
  }

  // one rendered frame took dt seconds; covered = another renderer (the fighter preview) is also drawing
  sample(dt, covered) {
    if (this.mode !== 'auto' || covered || document.hidden) { this.reset(); return; }
    dt = Math.min(dt, 0.25); // one long hitch (loading, a tab switch) must not decide a whole window
    if (this.settle > 0) { this.settle -= dt; return; } // let shaders compile after a change
    this.acc += dt; this.n++;
    if (this.acc < WINDOW) return;
    const avg = (this.acc / this.n) * 1000;
    this.acc = 0; this.n = 0;
    this.lastAvg = avg;
    if (avg > SLOW_MS) {
      this.fast = 0;
      // the last drop bought nothing: rendering is not the bottleneck, so undo it and stop degrading
      if (this.lastDrop && avg > this.lastDrop.avg * 0.92) {
        this.floor = this.tier - 1;
        this.lastDrop = null;
        this.apply(this.floor);
        this.save();
        return;
      }
      if (this.tier >= this.floor) return;
      this.fails[this.tier]++;
      this.lastDrop = { avg };
      this.apply(this.tier + 1);
      this.save();
    } else {
      this.lastDrop = null;
      if (avg < FAST_MS && this.tier > 0 && this.fails[this.tier - 1] < 2) {
        if (++this.fast >= FAST_WINDOWS) { this.fast = 0; this.apply(this.tier - 1); }
      } else this.fast = 0;
      this.save();
    }
  }

  save() {
    if (this.mode !== 'auto' || this.saved === this.tier) return;
    this.saved = this.tier;
    try { localStorage.setItem(SAVE_KEY, String(this.tier)); } catch { /* storage blocked */ }
  }

  get pixelRatio() { return Math.min(window.devicePixelRatio || 1, this.mode === 'high' ? 2 : TIERS[this.tier].prCap); }

  // puts the renderer, the arena lights and the menus on tier t
  apply(t = this.tier) {
    const g = this.game, r = g.renderer;
    const prev = TIERS[this.tier], next = TIERS[t];
    const first = !this.applied;
    this.applied = true;
    this.tier = t;
    this.settle = 1;
    g.pixelRatio = this.pixelRatio;
    r.setPixelRatio(g.pixelRatio);
    const type = next.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const shadowsChanged = first || prev.shadow !== next.shadow || !!prev.soft !== !!next.soft;
    r.shadowMap.enabled = next.shadow > 0;
    r.shadowMap.type = type;
    for (const a of Object.values(g.arenas)) this.applyLight(a.moon);
    // materials pick up a shadow on/off or filter change only when recompiled
    if (shadowsChanged && !first) g.scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
    try { document.body.classList.toggle('perf-lite', t >= LITE_FROM); } catch { /* no DOM */ }
    g.resize();
  }

  applyLight(light) {
    const s = TIERS[this.tier].shadow;
    light.castShadow = s > 0;
    if (s && light.shadow.mapSize.x !== s) {
      light.shadow.mapSize.set(s, s);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  }

  stats() { return { tier: TIERS[this.tier].name, tierIndex: this.tier, mode: this.mode, floor: this.floor, avgMs: this.lastAvg ? +this.lastAvg.toFixed(1) : null }; }
}
