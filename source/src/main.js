// Entry point: wires keyboard, menus, game and the audio layer.
import { Keyboard, loadBindings, devices } from './input.js';
import { Gamepads } from './gamepad.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { ROSTER, TEAM_DEFAULT_NAMES } from './config.js';
import { Game } from './game.js';
import { Menus } from './ui.js';
import { events } from './events.js';
import { initAudio } from './audio.js';
import { NetSession, cleanCode, saveOnlineSettings } from './net/session.js';
import { OnlineMenus } from './net/online-ui.js';
import { TournamentMenus } from './net/tourney-ui.js';
import { ChatPanel } from './net/chat.js';
import { CharacterSelect } from './charSelect.js';
import { wardrobe } from './cosmetics.js';
import { Account } from './account.js';
import { Progression, trackMatchCounts } from './progression.js';
import { ProgressionMenus } from './progression-ui.js';
import { AccountMenus } from './account-ui.js';
import { Training } from './training.js';
import { prompts, registerPromptDevice } from './prompts.js';
import { padLabel } from './padmap.js';

function boot() {
  const keyboard = new Keyboard();
  const bindings = loadBindings();
  keyboard.bindings = bindings;
  const pads = new Gamepads();
  devices.pads = pads;
  // phones and tablets start out showing touch prompts; a key or pad press switches them over
  if (isTouchDevice() && matchMedia('(pointer: coarse)').matches) devices.last = devices.kind[0] = 'touch';
  for (let p = 0; p < 4; p++) if (pads.slotsFor(p).length) devices.kind[p] = 'pad';
  document.body.dataset.input = devices.last;
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
  let progressUi = null;
  // every player signs in with a José Madrid Salsa account; their matches go on their profile
  const account = new Account(params);
  let training = null;

  const menus = new Menus({
    keyboard, bindings,
    onStart: (setup) => {
      training.stop();
      lastSetup = setup;
      online?.localMatch();
      audio.unlock();
      menus.hideAll();
      game.setPaused(false);
      game.startMatch(setup, bindings);
    },
    onResume: () => { menus.hideAll(); game.setPaused(false); },
    onRestart: () => { menus.hideAll(); game.setPaused(false); if (training.kind) { training.restart(); return; } for (const f of game.fighters) f.stats = { kos: 0, damage: 0, wins: 0 }; game.startMatch(lastSetup, bindings); },
    onQuit: () => { training.stop(); audio.setScene('title'); game.setPaused(false); game.keyboard.captureGameKeys = false; game.startDemo(); menus.show('title'); },
    onQualityChange: (q) => game.setQuality(q),
    onVolumeChange: (v) => audio.setVolumes(v),
    onTouchChange: (s) => applyTouch(s),
    pads,
    onAct: (act, el) => {
      audio.unlock();
      // the Training screen: the guided tutorial, the free practice room, and the way out of a finished tutorial
      if (act === 'tr-tutorial' || act === 'tr-practice') { online?.localMatch(); menus.hideAll(); game.setPaused(false); training.start(act === 'tr-tutorial' ? 'tutorial' : 'practice'); return; }
      if (act === 'tr-fight') { menus.cb.onQuit(); menus.show('setup'); return; }
      if (progressUi?.onAct(act, el)) return;
      if (!accountUi?.onAct(act, el)) online?.onAct(act, el);
    },
    onOpt: (key, el, d) => {
      if (key === 'tr-fighter') return training.changeFighter(d);
      if (!accountUi?.onOpt(key, el, d)) online?.onOpt(key, el, d);
    },
    onShow: (name) => { if (name === 'training') training.renderMenu(); accountUi?.onShow(name); progressUi?.onShow(name); online?.onShow(name); },
    onSelect: (key) => online?.openSelect(key),
    // the locker's "make this my fighter" also becomes your pick online
    onFavourite: (f) => { session.settings.fighter = f; saveOnlineSettings(session.settings); },
  });
  menus.select = new CharacterSelect({ menus });
  game.coveredBy = () => menus.active;
  menus.account = account;
  accountUi = new AccountMenus({ menus, account });
  // fighter levels, daily and weekly challenges and the season pass; the group track follows the
  // fundraising team found for the code on the title screen
  const progression = new Progression();
  progression.group = () => menus.fundraiser?.team || null;
  menus.progression = progression;
  progressUi = new ProgressionMenus({ menus, progression });
  training = new Training({ game, menus, bindings, keyboard, events });
  // ---- controllers and touch ----
  const touch = new TouchControls({
    onPause: () => keyboard.dispatch('Escape'),
    onUsed: () => devices.used('touch', 0),
    getFighter: () => (game.online ? game.localFighter : game.fighters.find((f) => f.isHuman && f.controller?.playerIndex === 0)) || null,
  });
  devices.touch = touch;
  const applyTouch = (s) => { touch.setSize(s.touchSize || 1); touch.vibrate = pads.rumbleOn; };
  applyTouch(menus.setup);
  const toastEl = document.createElement('div');
  toastEl.id = 'pad-toast';
  document.body.appendChild(toastEl);
  let toastTimer = 0;
  const toast = (html) => {
    toastEl.innerHTML = html;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
  };
  pads.menuMode = () => {
    if (menus.active) return menus.active === 'pause' || menus.active === 'netpause' ? 'pause' : 'menu';
    if (game.mode === 'match') return game.online && !game.localFighter ? 'spectate' : 'game';
    return 'menu';
  };
  // pads send menu keys through the keyboard listeners, except while a keyboard key is being rebound.
  // In a fight View pauses, or skips a tutorial lesson; in the practice room the stick clicks lay out gear and reset.
  const padKeys = { View: () => (training.active ? 'Tab' : 'Escape'), L3: () => (training.active ? 'KeyG' : ''), R3: () => (training.active ? 'KeyR' : '') };
  pads.emitKey = (code) => {
    const key = padKeys[code] ? padKeys[code]() : code;
    if (key && !menus.rebinding) keyboard.dispatch(key);
  };
  // tutorial and practice-room prompts name the real controller buttons and on-screen buttons
  const padFam = () => { const s = [0, 1, 2, 3].find((i) => pads.state(i)); return s === undefined ? 'xbox' : pads.state(s).family; };
  const PAD_EXTRA = { menu: 'b9', skip: 'b8', next: 'b8', dummy: 'b8', reset: 'b11', gear: 'b10' };
  registerPromptDevice('gamepad', {
    label: (a) => (a === 'move' ? 'Left stick' : padLabel(pads.map[a] || PAD_EXTRA[a], padFam())),
    move: () => 'Left stick',
  });
  registerPromptDevice('touch', {
    verb: 'Tap',
    label: (a) => (/^slot\d$/.test(a) ? `bar slot ${a.slice(4)}` : a === 'move' ? 'thumbstick'
      : touch.btns[a]?.querySelector('.tl').textContent || { menu: 'Pause', skip: 'Skip lesson', next: 'Skip lesson' }[a] || a),
    move: () => 'the thumbstick on the left',
  });
  const syncPrompts = () => prompts.use(devices.last === 'pad' ? 'gamepad' : devices.last);
  syncPrompts();
  pads.onUse = (slot) => devices.used('pad', pads.seatOf(slot));
  pads.onChange = ({ slot, on }) => {
    if (on) {
      const st = pads.state(slot);
      toast(`<b>${st.name}</b> connected · plays as P${pads.seatOf(slot) + 1}`);
      devices.used('pad', pads.seatOf(slot));
      pads.rumble(slot, 0.4, 0.5, 180);
    } else {
      toast(`Controller ${slot + 1} disconnected`);
      // a fighter whose controller drops mid-fight gets the pause screen instead of standing there
      if (game.mode === 'match' && !game.online && !menus.active && game.phase === 'fight' &&
        game.fighters.some((f) => f.isHuman && f.controller.playerIndex === pads.seatOf(slot))) {
        game.setPaused(true);
        menus.show('pause');
      }
    }
    menus.padsChanged();
  };
  devices.listeners.add(() => {
    document.body.dataset.input = devices.last;
    syncPrompts();
    game.inputChanged();
  });
  // shake the controller of whoever gets hit, harder for heavy blows and knockouts
  const padsOf = (f) => {
    if (!f) return [];
    if (game.online) return f === game.localFighter ? [0, 1, 2, 3].filter((i) => pads.state(i)) : [];
    return f.isHuman && f.controller?.playerIndex !== undefined ? pads.slotsFor(f.controller.playerIndex) : [];
  };
  const buzz = (f, strong, weak, ms) => {
    for (const s of padsOf(f)) pads.rumble(s, strong, weak, ms);
    if (touch.visible && touch.vibrate && f && f === touch.getFighter() && strong > 0.3) navigator.vibrate?.(Math.min(ms, 120));
  };
  events.on('hit', (d) => { buzz(d.fighter, d.heavy ? 0.85 : 0.35, d.heavy ? 0.6 : 0.4, d.heavy ? 230 : 110); buzz(d.by, 0, d.heavy ? 0.35 : 0.18, 60); });
  events.on('block', (d) => buzz(d.fighter, 0.12, 0.3, 70));
  events.on('parry', (d) => buzz(d.fighter, 0, 0.7, 90));
  events.on('guardBreak', (d) => buzz(d.fighter, 0.7, 0.5, 260));
  events.on('ko', (d) => { buzz(d.fighter, 1, 1, 480); buzz(d.by, 0.3, 0.5, 160); });
  events.on('fight', () => { for (const f of game.fighters) buzz(f, 0.25, 0.25, 120); });
  // the overlay shows during a fight on touch screens (or always, when switched on in Controls)
  const touchLoop = () => {
    const mode = menus.setup.touch || 'auto';
    const wanted = mode === 'on' || (mode === 'auto' && devices.last === 'touch');
    const me = touch.getFighter();
    const fighting = game.mode === 'match' && !menus.active && game.phase !== 'matchOver' && !!me;
    touch.setVisible(wanted && fighting, { spectating: !!me && !me.alive, ff: !game.online });
    requestAnimationFrame(touchLoop);
  };
  requestAnimationFrame(touchLoop);

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

  // Your match counts toward unlocking outfits: P1 on this keyboard, or your own fighter online.
  const recordMatch = (champ, fighters) => {
    const me = game.online ? game.localFighter
      : fighters.filter((f) => f.isHuman).sort((a, b) => a.controller.playerIndex - b.controller.playerIndex)[0];
    menus.progress = null;
    if (!me || game.mode !== 'match' || training.active) return []; // practice doesn't count
    const won = champ === me || (champ && champ.team >= 0 && champ.team === me.team);
    // XP first: season pass tiers it reaches grant items, which the wardrobe then announces
    const prog = menus.progress = progression.recordMatch({
      fighter: me.def.id, won, rounds: me.stats.wins, kos: me.stats.kos, damage: me.stats.damage, versus: !!game.online, counts: matchCounts(),
    });
    const fresh = wardrobe.recordMatch({ won, rounds: me.stats.wins, kos: me.stats.kos });
    if (session.kind === 'tournament') {
      game.hud.feed(`<b>+${prog.xp} XP</b> <span>${prog.levelUps.length ? `${me.def.name} level ${prog.after.level}` : `season tier ${prog.tier.tier}`}</span>`);
      if (fresh.length) game.hud.feed(`<b>Unlocked</b> <span>${fresh.map((x) => x.item.label).join(', ')}</span>`);
    }
    return fresh;
  };
  // this match's specials, skills, parries, power-ups and guard breaks, for challenges
  const matchCounts = trackMatchCounts(events, () => (game.online ? game.localFighter
    : game.fighters.filter((f) => f.isHuman).sort((a, b) => a.controller.playerIndex - b.controller.playerIndex)[0]) || null);

  game.onMatchEnd = (champ, fighters) => {
    menus.newUnlocks = recordMatch(champ, fighters);
    // tournament matches go back to the bracket instead of the results screen
    if (session.kind === 'tournament') { session.onTournamentMatchEnd(champ); return; }
    menus.screens.results.querySelector('.acct-result').textContent = account.recording ? 'Saving to your profile…' : '';
    // freeze the deciding knockout now, then play it back (recording the clip) before the results
    const teamed = champ.team >= 0 && champ.teamColor != null;
    game.replay.capture(teamed ? `${champ.teamName} win the arena` : `${champ.name}${champ.label !== 'CPU' ? ` (${champ.label})` : ''} wins`);
    const results = () => { if (game.phase === 'matchOver') { menus.showResults(champ, fighters); progressUi.renderResult(menus.progress); } };
    setTimeout(() => {
      if (game.phase !== 'matchOver') return;
      game.keyboard.captureGameKeys = false;
      game.hud.show(false);
      if (!game.replay.play({ onDone: results })) results();
    }, 2600);
  };
  // the results screen's replay buttons
  game.replay.audioStream = () => audio.captureStream();
  game.replay.releaseStream = () => audio.releaseStream();
  game.replay.onVideo = () => { if (menus.active === 'results') menus.updateReplayButtons(); };
  menus.replay = {
    get canPlay() { return game.replay.canPlay; },
    get video() { return game.replay.video; },
    watch() {
      const back = () => { menus.show('results'); menus.updateReplayButtons(); };
      menus.hideAll();
      if (!game.replay.play({ onDone: back })) back();
    },
  };
  // any of these keys, or a tap, skips the replay
  keyboard.onKey((e) => {
    if (!game.replay.playing) return false;
    if (['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(e.code)) game.replay.skip();
    return true;
  });
  document.getElementById('stage').addEventListener('pointerdown', () => game.replay.skip());

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
  if (initial) game.setQuality(initial);
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
  window.__arena = { game, menus, events, bindings, session, audio, training, pads, touch, devices, keyboard, account, wardrobe, progression };
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

try {
  boot();
} catch (err) {
  console.error(err);
  const el = document.getElementById('fatal');
  if (el) { el.hidden = false; el.querySelector('p').textContent = 'This browser could not start WebGL: ' + (err?.message || err); }
}
