// Entry point: wires keyboard, menus, game and the audio layer.
import { Keyboard, loadBindings } from './input.js';
import { Game } from './game.js';
import { Menus } from './ui.js';
import { events } from './events.js';
import { initAudio } from './audio.js';
import { NetSession, cleanCode } from './net/session.js';
import { OnlineMenus } from './net/online-ui.js';

function boot() {
  const keyboard = new Keyboard();
  const bindings = loadBindings();
  let lastSetup = null;

  const params = new URLSearchParams(location.search);
  const game = new Game({
    stage: document.getElementById('stage'),
    hudRoot: document.getElementById('hud'),
    keyboard,
    quality: params.get('quality') || 'auto',
  });
  const audio = initAudio(events, { getCamera: () => game.rig.camera });
  let online = null;
  let session = null;

  const menus = new Menus({
    keyboard, bindings,
    onStart: (setup) => {
      lastSetup = setup;
      audio.unlock();
      menus.hideAll();
      game.setPaused(false);
      game.startMatch(setup, bindings);
    },
    onResume: () => { menus.hideAll(); game.setPaused(false); },
    onRestart: () => { menus.hideAll(); game.setPaused(false); for (const f of game.fighters) f.stats = { kos: 0, damage: 0, wins: 0 }; game.startMatch(lastSetup, bindings); },
    onQuit: () => { audio.setScene('title'); game.setPaused(false); game.keyboard.captureGameKeys = false; game.startDemo(); menus.show('title'); },
    onQualityChange: (q) => setQuality(game, q),
    onVolumeChange: (v) => audio.setVolumes(v),
    onAct: (act, el) => { audio.unlock(); online?.onAct(act, el); },
    onOpt: (key, el, d) => online?.onOpt(key, el, d),
    onShow: (name) => online?.onShow(name),
  });
  session = new NetSession({ game, menus, keyboard, bindings });
  online = new OnlineMenus({ menus, session });
  window.addEventListener('pagehide', () => session.leave(null, true));

  game.onMatchEnd = (champ, fighters) => {
    setTimeout(() => { if (game.phase === 'matchOver') { game.keyboard.captureGameKeys = false; game.hud.show(false); menus.showResults(champ, fighters); } }, 2600);
  };

  // pause with Escape or P during a match
  keyboard.onKey((e) => {
    if (game.mode !== 'match' || menus.active) return false;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (game.phase === 'matchOver') return false;
      if (game.online) { menus.show('netpause'); return true; } // online matches keep running
      game.setPaused(true);
      menus.show('pause');
      return true;
    }
    return false;
  });
  // pause automatically when the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'match' && !game.online && !menus.active && game.phase !== 'matchOver') {
      game.setPaused(true);
      menus.show('pause');
    }
  });

  audio.setVolumes({ music: menus.setup.music / 100, sfx: menus.setup.sfx / 100 });
  // browsers keep sound locked until the first key or click
  const firstGesture = () => audio.unlock();
  window.addEventListener('keydown', firstGesture, { once: true, capture: true });
  window.addEventListener('pointerdown', firstGesture, { once: true, capture: true });
  const initial = loadSetupQuality(menus);
  if (initial) setQuality(game, initial);
  game.startDemo();
  game.warmShaders();
  menus.show('title');
  document.getElementById('boot').hidden = true;
  // an invite link (?room=CODE) opens the join screen with the code filled in
  const room = cleanCode(params.get('room'));
  if (room) { menus.show('online'); document.getElementById('net-code').value = room; }

  // when embedded in a frame the page needs a click before it hears keys
  const note = document.getElementById('focus-note');
  const syncFocus = () => { note.hidden = document.hasFocus(); };
  window.addEventListener('focus', syncFocus);
  window.addEventListener('blur', syncFocus);
  window.addEventListener('pointerdown', () => { window.focus(); setTimeout(syncFocus, 0); });
  setTimeout(syncFocus, 300);

  // test and debugging hooks
  window.__arena = { game, menus, events, bindings, session, audio };
  if (params.has('autotest')) {
    const n = Math.max(2, Math.min(8, +params.get('autotest') || 8));
    menus.setup.count = n;
    menus.setup.slots.forEach((s) => { s.control = 'cpu'; });
    menus.setup.winsNeeded = +params.get('wins') || 1;
    menus.setup.suddenDeath = +params.get('sd') || 30;
    menus.runAct('start');
  }
}

function loadSetupQuality(menus) { return menus.setup.quality !== 'auto' ? menus.setup.quality : null; }

function setQuality(game, q) {
  game.quality = q;
  game.maxPixelRatio = q === 'low' ? 1 : q === 'high' ? 2 : 1.6;
  game.pixelRatio = Math.min(window.devicePixelRatio || 1, game.maxPixelRatio);
  if (q === 'low') game.pixelRatio = Math.min(game.pixelRatio, 0.85);
  game.renderer.setPixelRatio(game.pixelRatio);
  const shadows = q !== 'low';
  game.renderer.shadowMap.enabled = shadows;
  game.arena.moon.castShadow = shadows;
  game.scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
  game.resize();
}

try {
  boot();
} catch (err) {
  console.error(err);
  const el = document.getElementById('fatal');
  if (el) { el.hidden = false; el.querySelector('p').textContent = 'This browser could not start WebGL: ' + (err?.message || err); }
}
