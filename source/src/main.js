// Entry point: wires keyboard, menus, game and the audio layer.
import { Keyboard, loadBindings } from './input.js';
import { ROSTER, TEAM_DEFAULT_NAMES } from './config.js';
import { Game } from './game.js';
import { Menus } from './ui.js';
import { events } from './events.js';
import { initAudio } from './audio.js';
import { NetSession, cleanCode } from './net/session.js';
import { OnlineMenus } from './net/online-ui.js';
import { TournamentMenus } from './net/tourney-ui.js';
import { ChatPanel } from './net/chat.js';
import { Account } from './account.js';
import { AccountMenus } from './account-ui.js';

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
  let accountUi = null;
  // every player signs in with a José Madrid Salsa account; their matches go on their profile
  const account = new Account(params);

  const menus = new Menus({
    keyboard, bindings,
    onStart: (setup) => {
      lastSetup = setup;
      online?.localMatch();
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
    onAct: (act, el) => { audio.unlock(); if (!accountUi?.onAct(act, el)) online?.onAct(act, el); },
    onOpt: (key, el, d) => { if (!accountUi?.onOpt(key, el, d)) online?.onOpt(key, el, d); },
    onShow: (name) => { accountUi?.onShow(name); online?.onShow(name); },
  });
  menus.account = account;
  accountUi = new AccountMenus({ menus, account });
  session = new NetSession({ game, menus, keyboard, bindings });
  online = new OnlineMenus({ menus, session });
  // a private room stays open after a match, so a shared result doubles as an invite into it
  menus.shareRoom = () => (session.connected && session.kind === 'room' ? session.lobby.code : '');
  const chat = new ChatPanel({ session, keyboard });
  online.tourney = new TournamentMenus({ menus, session, online, chat });
  window.addEventListener('pagehide', () => session.leave(null, true));
  account.track({ events, game, session, onResult: (r) => accountUi.showResult(r) });
  // online, your fighter name is your leaderboard name
  account.onChange(() => { if (account.handle && !session.connected) session.settings.name = account.handle; });
  account.refresh();

  game.onMatchEnd = (champ, fighters) => {
    // tournament matches go back to the bracket instead of the results screen
    if (session.kind === 'tournament') { session.onTournamentMatchEnd(champ); return; }
    menus.screens.results.querySelector('.acct-result').textContent = account.recording ? 'Saving to your profile…' : '';
    setTimeout(() => { if (game.phase === 'matchOver') { game.keyboard.captureGameKeys = false; game.hud.show(false); menus.showResults(champ, fighters); } }, 2600);
  };

  // pause with Escape or P during a match
  keyboard.onKey((e) => {
    if (game.mode !== 'match' || menus.active) return false;
    // watching an online match: arrows pick whom the camera follows, up shows the whole field
    if (game.online && !game.localFighter && /^Arrow/.test(e.code)) {
      const alive = game.fighters.filter((f) => f.alive);
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || !alive.length) game.rig.follow = null;
      else {
        const i = alive.indexOf(game.rig.follow);
        game.rig.follow = alive[(i + (e.code === 'ArrowRight' ? 1 : -1) + alive.length + (i < 0 ? 1 : 0)) % alive.length];
      }
      return true;
    }
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
  // (players without a fundraising group stay on the title until they enter one; the code waits in the join field)
  if (room) { document.getElementById('net-code').value = room; if (account.ready && menus.requireGroup()) menus.show('online'); }
  // a tournament link (?t=CODE) opens the tournament screen with the code filled in
  const tcode = cleanCode(params.get('t'));
  if (tcode && !room) { document.getElementById('t-code').value = tcode; menus.show('tourney'); }

  // when embedded in a frame the page needs a click before it hears keys
  const note = document.getElementById('focus-note');
  const syncFocus = () => { note.hidden = document.hasFocus(); };
  window.addEventListener('focus', syncFocus);
  window.addEventListener('blur', syncFocus);
  window.addEventListener('pointerdown', () => { window.focus(); setTimeout(syncFocus, 0); });
  setTimeout(syncFocus, 300);

  // test and debugging hooks
  window.__arena = { game, menus, events, bindings, session, audio, account };
  if (params.has('autotest')) {
    // ?autotest=8 runs an all-CPU match; &mode=tournament&teams=2 tries the Badlands with friendly fire and revives
    const n = Math.max(2, Math.min(8, +params.get('autotest') || 8));
    const tc = Math.max(0, Math.min(4, +params.get('teams') || 0));
    menus.cb.onStart({
      mode: params.get('mode') || 'cpu', winsNeeded: +params.get('wins') || 1, difficulty: 'normal', suddenDeath: +params.get('sd') || 30,
      teams: { count: tc, names: TEAM_DEFAULT_NAMES.slice(0, tc) },
      slots: Array.from({ length: n }, (_, i) => ({ control: 'cpu', fighter: i % ROSTER.length, team: tc ? i % tc : -1 })),
    });
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
  for (const a of Object.values(game.arenas)) a.moon.castShadow = shadows;
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
