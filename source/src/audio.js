// Sound and music. Every clip was generated with Higgsfield (Mirelo SFX, Sonilo music, Inworld announcer),
// trimmed, peak-levelled and packed into four compressed files on Higgsfield's CDN:
//   sfx     one ~470 KB sprite holding every effect and announcer call (offsets in SPRITE)
//   crowd   a 10 s arena murmur that loops under every match
//   battle  30 s of suspenseful drums, brass and choir that loops during a match
//   title   40 s of brooding drones for the menus
// Nothing loads until the first key or click (browsers keep audio locked until then), the sprite comes first,
// and the game stays silent rather than stalling if a file can't be fetched.
import * as THREE from 'three';
import { SKILLS, POWERUPS } from './config.js';

const CDN = 'https://d2ol7oe51mr4n9.cloudfront.net/user_3Ca8TrzXB9OGqAMXyMN8bLQGzHv/';
const FILES = {
  sfx: '02edcf33-ebc7-4a25-bc3c-76080d6faee5.mp3',
  crowd: '063bd605-232a-4447-9db6-be752eb24f43.mp3',
  battle: '3afdb38b-06dc-4bc3-942a-b33c2b07a00e.mp3',
  title: '1f16181f-0a14-45f6-b7ed-db90bfc75abd.mp3',
};
// [start, length] in seconds inside the sfx sprite
const SPRITE = {
  block: [0.1, 0.777], blood: [1.177, 1.9609], chain: [3.4379, 2.009], crowd_cheer: [5.7468, 3.0186],
  dodge: [9.0654, 0.9999], fire: [10.3653, 1.7343], fizzle: [12.3996, 0.9372], frost: [13.6368, 2.0071],
  gong: [15.9439, 3.6406], guardbreak: [19.8845, 2.0165], ironwill: [22.201, 1.976], kick: [24.477, 0.3292],
  ko: [25.1062, 2.0066], land: [27.4128, 1.0133], punch_heavy: [28.7261, 0.9839], punch_light: [30.01, 1.0151],
  shadow: [31.3251, 2.0196], slam: [33.6447, 1.8171], thunder: [35.7617, 2.5498], venom: [38.6116, 2.0032],
  vo_fight: [40.9148, 0.9344], vo_final: [42.1492, 2.0107], vo_ko: [44.46, 1.6624], vo_round1: [46.4224, 1.2744],
  vo_round2: [47.9967, 1.5373], vo_round3: [49.834, 1.3932], vo_suddendeath: [51.5271, 1.3987],
  vo_victory: [53.2258, 1.0698], wall: [54.5957, 1.0108], whoosh_heavy: [55.9064, 0.9922], whoosh_light: [57.1986, 0.959],
};
// each fighter's special and skills share one elemental sound, keyed by the fighter's special
const ELEMENT = { fireball: 'fire', frost: 'frost', slam: 'slam', venom: 'venom', storm: 'thunder', shadow: 'shadow', spear: 'blood', ironwill: 'ironwill' };
const SPECIAL_SOUND = { ...ELEMENT, storm: 'whoosh_heavy', spear: 'chain' };
const SPELL_SOUND = { sp_fireball: 'fire', sp_chain: 'thunder', sp_meteor: 'slam', sp_frostnova: 'frost', sp_heal: 'ironwill' };
const MAX_VOICES = 28;   // hard cap on overlapping effects so an 8-fighter brawl never turns to mush
const PER_SOUND = 4;     // and on copies of any one effect

export function initAudio(events, { getCamera } = {}) {
  let ctx = null, master, musicBus, sfxBus, voiceBus, ambBus;
  let sprite = null;
  const buffers = {};
  const live = [];                 // { src, name, end }
  const recent = new Map();        // name -> last start time, to drop exact duplicates in the same frame
  let musicVol = 0.7, sfxVol = 0.85, muted = false;
  let scene = 'title', music = null, crowd = null, lastKoCall = -10;
  const stats = { played: 0, dropped: 0, loaded: [], errors: [] };
  const tmp = new THREE.Vector3();

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    // master -> gentle limiter so a pile-up of hits can't clip
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 8; limiter.ratio.value = 6;
    limiter.attack.value = 0.003; limiter.release.value = 0.2;
    master = ctx.createGain();
    master.connect(limiter).connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    ambBus = ctx.createGain(); ambBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    voiceBus = ctx.createGain(); voiceBus.connect(master);
    applyVolumes();
    // the sprite first so the fight sounds are ready soonest, then the loops
    load('sfx').then((b) => { sprite = b; })
      .then(() => Promise.all(['title', 'battle', 'crowd'].map(load)))
      .finally(() => setScene(scene, 2));
  }

  async function load(key) {
    if (buffers[key]) return buffers[key];
    try {
      const res = await fetch(CDN + FILES[key], { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      buffers[key] = await new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail));
      stats.loaded.push(key);
      return buffers[key];
    } catch (err) {
      stats.errors.push(`${key}: ${err?.message || err}`);
      console.warn(`[audio] could not load ${key}`, err);
      return null;
    }
  }

  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime, m = muted ? 0 : 1;
    master.gain.setTargetAtTime(m, t, 0.05);
    musicBus.gain.setTargetAtTime(0.55 * musicVol, t, 0.1);
    ambBus.gain.setTargetAtTime(0.5 * sfxVol, t, 0.1);
    sfxBus.gain.setTargetAtTime(0.8 * sfxVol, t, 0.05);
    voiceBus.gain.setTargetAtTime(Math.sqrt(sfxVol), t, 0.05); // the announcer stays clear at low effect volumes
  }

  // Pan and distance from where the fighter is on screen, so a hit on the left of the arena sounds left.
  function place(fighter) {
    const cam = getCamera?.();
    if (!cam || !fighter?.pos) return { pan: 0, gain: 1 };
    tmp.copy(fighter.pos); tmp.y += 1.2;
    const dist = tmp.distanceTo(cam.position);
    tmp.project(cam);
    const pan = Math.max(-0.75, Math.min(0.75, tmp.x * 0.75));
    const gain = Math.max(0.35, Math.min(1, 14 / Math.max(dist, 1)));
    return { pan, gain };
  }

  // play one clip from the sprite
  function play(name, { gain = 1, rate = 1, vary = 0.06, fighter = null, bus = null, delay = 0 } = {}) {
    if (!ctx || !sprite || muted) return null;
    const seg = SPRITE[name];
    if (!seg) return null;
    const now = ctx.currentTime;
    if (now - (recent.get(name) ?? -1) < 0.03) { stats.dropped++; return null; }
    // retire finished voices, then enforce the caps by stopping the oldest
    for (let i = live.length - 1; i >= 0; i--) if (live[i].end <= now) live.splice(i, 1);
    const same = live.filter((v) => v.name === name);
    if (same.length >= PER_SOUND) stopVoice(same[0]);
    if (live.length >= MAX_VOICES) stopVoice(live[0]);

    const src = ctx.createBufferSource();
    src.buffer = sprite;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const g = ctx.createGain();
    const p = place(fighter);
    g.gain.value = gain * p.gain;
    let out = g;
    if (p.pan && ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = p.pan; g.connect(pn); out = pn; }
    out.connect(bus || sfxBus);
    src.connect(g);
    const at = now + delay;
    const len = seg[1];
    src.start(at, seg[0], len);
    const voice = { src, name, end: at + len / src.playbackRate.value };
    src.onended = () => { const i = live.indexOf(voice); if (i >= 0) live.splice(i, 1); };
    live.push(voice);
    recent.set(name, now);
    stats.played++;
    return voice;
  }
  // Gunfire is synthesised: a filtered noise crack over a low thump, and a falling zap for the rail rifle.
  let noise = null;
  function gunshot(gun, fighter) {
    if (!ctx || muted) return;
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const now = ctx.currentTime, p = place(fighter);
    const out = ctx.createGain();
    out.gain.value = p.gain * (gun === 'shotgun' ? 1.0 : 0.8);
    let dest = out;
    if (p.pan && ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = p.pan; out.connect(pn); dest = pn; }
    dest.connect(sfxBus);
    const len = gun === 'shotgun' ? 0.42 : gun === 'rifle' ? 0.3 : 0.2;
    const n = ctx.createBufferSource(); n.buffer = noise; n.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(gun === 'shotgun' ? 5200 : 7000, now);
    f.frequency.exponentialRampToValueAtTime(gun === 'shotgun' ? 380 : 700, now + len);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gun === 'rifle' ? 0.35 : 0.9, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + len);
    n.connect(f).connect(ng).connect(out);
    n.start(now, Math.random() * 0.1, len + 0.05);
    const o = ctx.createOscillator(); o.type = gun === 'rifle' ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(gun === 'rifle' ? 1800 : gun === 'shotgun' ? 110 : 150, now);
    o.frequency.exponentialRampToValueAtTime(gun === 'rifle' ? 90 : 38, now + (gun === 'rifle' ? 0.28 : 0.12));
    const og = ctx.createGain();
    og.gain.setValueAtTime(gun === 'rifle' ? 0.25 : 0.8, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + (gun === 'rifle' ? 0.3 : 0.16));
    o.connect(og).connect(out);
    o.start(now); o.stop(now + 0.32);
    stats.played++;
  }

  function stopVoice(v) { try { v.src.stop(); } catch { /* already stopped */ } const i = live.indexOf(v); if (i >= 0) live.splice(i, 1); }

  // Announcer lines duck the music so they read clearly over it.
  function say(name, delay = 0) {
    if (!play(name, { bus: voiceBus, vary: 0, delay })) return;
    const t = ctx.currentTime + delay, len = SPRITE[name][1];
    musicBus.gain.setTargetAtTime(0.22 * musicVol, t, 0.05);
    musicBus.gain.setTargetAtTime(0.55 * musicVol, t + len, 0.35);
  }

  // A seamless loop: each pass of the track overlaps the next by `fade` seconds with an equal-power crossfade,
  // so the seam never clicks even though the clips weren't cut to loop.
  function makeLoop(buffer, bus, fade = 2) {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(bus);
    const period = Math.max(1, buffer.duration - fade);
    let next = ctx.currentTime + 0.05, stopped = false;
    const sources = [];
    function schedule() {
      if (stopped) return;
      while (next < ctx.currentTime + 4) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        const steps = 16, up = new Float32Array(steps), down = new Float32Array(steps);
        for (let i = 0; i < steps; i++) { const x = i / (steps - 1); up[i] = Math.sin(x * Math.PI / 2); down[i] = Math.cos(x * Math.PI / 2); }
        g.gain.setValueCurveAtTime(up, next, fade);
        g.gain.setValueCurveAtTime(down, next + period, fade);
        src.connect(g).connect(out);
        src.start(next);
        src.stop(next + buffer.duration + 0.05);
        sources.push(src);
        src.onended = () => { const i = sources.indexOf(src); if (i >= 0) sources.splice(i, 1); };
        next += period;
      }
    }
    schedule();
    const timer = setInterval(schedule, 1000);
    return {
      fadeTo(v, time = 1.5) { out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setTargetAtTime(v, ctx.currentTime, time / 3); },
      stop(time = 1.5) {
        stopped = true; clearInterval(timer);
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setTargetAtTime(0, ctx.currentTime, time / 3);
        const end = ctx.currentTime + time + 0.1;
        for (const s of sources) { try { s.stop(end); } catch { /* not started */ } }
        setTimeout(() => out.disconnect(), (time + 0.5) * 1000);
      },
    };
  }

  // 'title' plays the menu drones; 'battle' plays the fight music with the crowd underneath
  function setScene(name, fade = 1.5) {
    scene = name;
    if (!ctx) return;
    const want = buffers[name];
    if (music?.key !== name) {
      music?.loop.stop(fade);
      music = want ? { key: name, loop: makeLoop(want, musicBus) } : null;
      music?.loop.fadeTo(1, fade);
    }
    const wantCrowd = name === 'battle' && buffers.crowd;
    if (wantCrowd && !crowd) { crowd = makeLoop(buffers.crowd, ambBus, 1.5); crowd.fadeTo(0.6, 2); }
    if (!wantCrowd && crowd) { crowd.stop(2); crowd = null; }
  }

  // the crowd swells with the action and settles back down
  function roar(level = 1, hold = 1.2) {
    if (!crowd || !ctx) return;
    crowd.fadeTo(Math.min(1.4, 0.6 + 0.6 * level), 0.15);
    clearTimeout(roar.t);
    roar.t = setTimeout(() => crowd?.fadeTo(0.6, 2.5), hold * 1000);
  }

  const isHuman = (f) => !!f?.isHuman;
  const elementOf = (f) => ELEMENT[f?.def?.special] || 'shadow';

  events.on('swing', ({ fighter, heavy }) => play(heavy ? 'whoosh_heavy' : 'whoosh_light', { fighter, gain: heavy ? 0.5 : 0.32, vary: 0.1 }));
  events.on('hit', ({ fighter, kind, heavy, damage }) => {
    const loud = Math.min(1, 0.55 + (damage || 0) / 30);
    if (kind === 'weapon') { play('punch_heavy', { fighter, gain: loud, rate: 0.85 }); play('block', { fighter, gain: 0.5 * loud, rate: 1.35 }); }
    else if (kind === 'punch') play(heavy ? 'punch_heavy' : 'punch_light', { fighter, gain: loud });
    else if (kind === 'kick') { play('kick', { fighter, gain: loud }); if (heavy) play('punch_heavy', { fighter, gain: 0.45, rate: 0.85 }); }
    else play('punch_heavy', { fighter, gain: 0.55 * loud, rate: 0.9 });
    if (heavy) roar(0.4, 0.6);
  });
  events.on('block', ({ fighter, heavy }) => play('block', { fighter, gain: heavy ? 0.85 : 0.6 }));
  events.on('guardBreak', ({ fighter }) => { play('guardbreak', { fighter, gain: 0.85 }); roar(0.6); });
  events.on('shieldBreak', ({ fighter }) => play('guardbreak', { fighter, gain: 0.7, rate: 1.15 }));
  events.on('dodge', ({ fighter }) => play('dodge', { fighter, gain: 0.5 }));
  events.on('jump', ({ fighter }) => play('whoosh_light', { fighter, gain: 0.18, rate: 0.75 }));
  events.on('land', ({ fighter, impact, down }) => {
    if (down) play('land', { fighter, gain: 0.9, rate: 0.85 });
    else if ((impact ?? 1) > 0.3) play('land', { fighter, gain: 0.3 });
  });
  events.on('wallHit', ({ fighter, speed }) => play('wall', { fighter, gain: Math.min(1, 0.4 + (speed || 0) / 20) }));
  events.on('special', ({ fighter, special }) => { play(SPECIAL_SOUND[special] || 'whoosh_heavy', { fighter, gain: 0.85 }); roar(0.5); });
  events.on('thunder', ({ fighter }) => { play('thunder', { fighter, gain: 1 }); roar(0.7); });
  events.on('spearPull', ({ fighter }) => play('chain', { fighter, gain: 0.7, rate: 1.2 }));
  events.on('skill', ({ fighter, skill }) => {
    const sk = SKILLS[skill];
    if (sk?.gun) gunshot(sk.gun, fighter);
    else if (sk?.spell) play(SPELL_SOUND[skill] || 'fire', { fighter, gain: 0.8, rate: 1.0 });
    else play(elementOf(fighter), { fighter, gain: 0.7, rate: 1.08 });
  });
  // picking up gear: a metal clang for weapons and armor, a click for guns, a shimmer for spell tomes
  events.on('pickup', ({ fighter, type }) => {
    const pu = POWERUPS[type];
    if (pu?.weapon || pu?.armor) play('block', { fighter, gain: 0.6, rate: 1.25 });
    else if (pu?.spell) play('frost', { fighter, gain: 0.35, rate: 1.6 });
    else if (pu?.item) play('chain', { fighter, gain: 0.45, rate: 1.7 });
    else play('dodge', { fighter, gain: 0.35, rate: 1.4 });
  });
  events.on('weaponBreak', ({ fighter }) => play('guardbreak', { fighter, gain: 0.7, rate: 1.3 }));
  events.on('armorBreak', ({ fighter }) => play('guardbreak', { fighter, gain: 0.75, rate: 0.9 }));
  // failure buzzes only for the people pressing the keys
  for (const ev of ['specialFail', 'skillFail', 'dodgeFail']) {
    events.on(ev, ({ fighter }) => { if (isHuman(fighter)) play('fizzle', { fighter, gain: 0.5 }); });
  }
  events.on('ko', ({ fighter }) => {
    play('ko', { fighter, gain: 1 });
    play('crowd_cheer', { gain: 0.6, delay: 0.15 });
    roar(1, 2.5);
    // one "K.O.!" at a time even when two fighters drop together
    if (ctx && ctx.currentTime - lastKoCall > 1.6) { lastKoCall = ctx.currentTime; say('vo_ko', 0.25); }
  });
  events.on('roundStart', ({ round, final }) => {
    setScene('battle');
    play('gong', { gain: 0.8, vary: 0 });
    say(final || round > 3 ? 'vo_final' : `vo_round${Math.max(1, round || 1)}`, 0.5);
  });
  events.on('fight', () => { say('vo_fight'); roar(0.8, 1.5); });
  events.on('suddenDeath', () => { play('gong', { gain: 0.9, rate: 0.85, vary: 0 }); say('vo_suddendeath', 0.4); roar(0.7); });
  events.on('roundEnd', () => { play('crowd_cheer', { gain: 0.7 }); roar(1, 3); });
  events.on('matchEnd', () => {
    say('vo_victory', 1.2);
    play('crowd_cheer', { gain: 0.9, delay: 1 });
    roar(1, 4);
    setTimeout(() => { if (scene === 'battle') setScene('title', 3); }, 4000);
  });

  return {
    unlock,
    setScene,
    setMuted(m) { muted = !!m; applyVolumes(); },
    setVolumes({ music, sfx } = {}) {
      if (music != null) musicVol = Math.max(0, Math.min(1, music));
      if (sfx != null) sfxVol = Math.max(0, Math.min(1, sfx));
      applyVolumes();
    },
    play,
    get stats() { return { ...stats, state: ctx?.state ?? 'locked', voices: live.length, scene }; },
  };
}
