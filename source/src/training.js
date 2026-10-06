// Training: a guided tutorial that teaches one move at a time against a training dummy, and a
// free practice room with the same dummy, a damage readout and gear on demand.
// Both run as a local match in the 'practice' mode: you and the dummy, neither can be knocked out.
// Every prompt is written with prompts.js, so it shows keys, gamepad buttons or touch buttons.
import * as THREE from 'three';
import { ROSTER, SKILLS, SPECIALS, POWERUPS } from './config.js';
import { DUMMY_MODES } from './ai.js';
import { prompts } from './prompts.js';
import { saveSetup } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DUMMY_FIGHTER = Math.max(0, ROSTER.findIndex((d) => d.id === 'onyx'));
const DUMMY_HP = 300;
const DUMMY_LABEL = { idle: 'Stands still', block: 'Blocks', attack: 'Fights back' };
// gear the practice room lays out when asked, two pads at a time
const GEAR = ['sword', 'pistol', 'tome_fire', 'axe', 'shotgun', 'tome_chain', 'hammer', 'rifle', 'tome_meteor', 'plate', 'tome_frost', 'tome_heal'];

// Each lesson: what to do (`text` gets the prompt helpers), how much of it (`need`), how the dummy behaves,
// and what counts: `tick` adds progress every simulation step, `on` adds progress for a game event.
const STEPS = [
  { id: 'move', title: 'Move', need: 8, dummy: 'idle',
    text: (k) => `Use ${k.move} to walk around the arena. The camera turns with the fight, so up always means away from you.`,
    tick: (t) => t.moved },
  { id: 'sprint', title: 'Sprint', need: 1.2, dummy: 'idle',
    text: (k) => `${k.hold} ${k.key('dash')} while moving to sprint. Sprinting drains the green stamina bar under your health.`,
    tick: (t, dt) => (t.player.sprinting ? dt : 0) },
  { id: 'dodge', title: 'Dodge roll', need: 2, dummy: 'idle',
    text: (k) => `${k.verb} ${k.key('dash')} quickly to roll. For a split second nothing can hurt you. Roll twice.`,
    on: { dodge: (t, d) => d.fighter === t.player } },
  { id: 'jump', title: 'Jump', need: 2, dummy: 'idle',
    text: (k) => `${k.verb} ${k.key('jump')} to jump. Jump twice.`,
    on: { jump: (t, d) => d.fighter === t.player } },
  { id: 'punch', title: 'Punch combo', need: 1, dummy: 'idle',
    text: (k) => `Walk up to the dummy and ${k.verb.toLowerCase()} ${k.key('punch')}${k.key('punch')}${k.key('punch')} in quick succession: jab, jab, then a heavy hook.`,
    on: { hit: (t, d) => t.mine(d) && d.move === 'hook' } },
  { id: 'kick', title: 'Kick combo', need: 1, dummy: 'idle',
    text: (k) => `${k.verb} ${k.key('kick')}${k.key('kick')}: a front kick into a roundhouse that knocks the dummy down.`,
    on: { hit: (t, d) => t.mine(d) && d.move === 'kick2' } },
  { id: 'air', title: 'Diving kick', need: 1, dummy: 'idle',
    text: (k) => `${k.verb} ${k.key('jump')}, then ${k.key('kick')} in the air to dive onto the dummy.`,
    on: { hit: (t, d) => t.mine(d) && d.move === 'airkick' } },
  { id: 'block', title: 'Block', need: 3, dummy: 'attack',
    text: (k) => `The dummy fights back now. ${k.hold} ${k.key('block')} while facing it to stop three punches. Blocking costs stamina, and too many blocked hits break your guard.`,
    on: { block: (t, d) => d.fighter === t.player, parry: (t, d) => d.fighter === t.player } },
  { id: 'parry', title: 'Parry', need: 1, dummy: 'attack',
    text: (k) => `Let go of ${k.key('block')}, then raise it again just as the punch lands. A parry stops the blow dead and staggers the attacker.`,
    on: { parry: (t, d) => d.fighter === t.player } },
  { id: 'backstab', title: 'Backstab', need: 1, dummy: 'idle', faceDummy: true,
    text: (k) => `Hits from behind deal 60% more damage and cannot be blocked. Circle around the dummy and strike its back with ${k.key('punch')} or ${k.key('kick')}.`,
    on: { backstab: (t, d) => d.by === t.player } },
  { id: 'skills', title: 'Skills', need: 3, dummy: 'idle', mana: true,
    text: (k, t) => `Your ${esc(t.player.def.role || 'fighter')} has three skills paid for with the blue mana bar: ${t.player.skillIds.map((id, i) => `${k.key('skill' + (i + 1))} ${esc(SKILLS[id].label)}`).join(', ')}. Cast all three.`,
    enter: (t) => { t.cast = new Set(); },
    on: { skillStart: (t, d) => d.fighter === t.player && d.slot >= 0 && !t.cast.has(d.slot) && t.cast.add(d.slot) } },
  { id: 'special', title: 'Special move', need: 1, dummy: 'idle', mana: true,
    text: (k, t) => `${k.verb} ${k.key('special')} for ${esc(SPECIALS[t.player.def.special].label)}: ${esc(SPECIALS[t.player.def.special].hint.toLowerCase())}. It costs half the mana bar, which fills as you fight.`,
    on: { specialStart: (t, d) => d.fighter === t.player } },
  { id: 'weapon', title: 'Weapons', need: 2, dummy: 'idle',
    text: (k) => `A Longsword is waiting on a glowing pad. Walk through it to pick it up, then hit the dummy with ${k.key('punch')}. Weapons break after a number of hits.`,
    enter: (t) => { t.game.pickups.place('sword', t.player.pos.x, t.player.pos.z); },
    on: { pickup: (t, d) => d.fighter === t.player && d.type === 'sword', hit: (t, d) => t.mine(d) && d.kind === 'weapon' } },
  { id: 'bar', title: 'Guns and spells', need: 4, dummy: 'idle',
    text: (k) => `Grab the Hand Cannon and the Fireball tome. They go on your ability bar at the bottom of the screen. ${k.verb} ${k.key('use')} to fire the selected slot and ${k.key('cycle')} to pick the next one${prompts.device === 'keyboard' ? `, or ${k.key('slot1')} to ${k.key('slot4')} to fire a slot directly` : ''}. Fire the gun and cast the spell.`,
    enter: (t) => { t.game.pickups.place('pistol', t.player.pos.x, t.player.pos.z); t.game.pickups.place('tome_fire', t.player.pos.x, t.player.pos.z); t.used = new Set(); },
    on: {
      pickup: (t, d) => d.fighter === t.player && (d.type === 'pistol' || d.type === 'tome_fire'),
      skillStart: (t, d) => d.fighter === t.player && d.slot === -1 && (d.skill === 'gun_pistol' || d.skill === 'sp_fireball') && !t.used.has(d.skill) && t.used.add(d.skill),
    } },
];
const EVENTS = [...new Set(STEPS.flatMap((s) => Object.keys(s.on || {}))), 'hit', 'block'];

export class Training {
  constructor({ game, menus, bindings, keyboard, events }) {
    this.game = game;
    this.menus = menus;
    this.bindings = bindings;
    this.kind = null;          // null | 'tutorial' | 'practice'
    this.el = document.createElement('div');
    this.el.id = 'coach';
    this.el.hidden = true;
    game.hud.root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-coach]');
      if (b) this.command(b.dataset.coach);
    });
    for (const type of EVENTS) events.on(type, (d) => this.onEvent(type, d));
    prompts.onChange(() => this.render());
    keyboard.onKey((e) => this.onKey(e));
  }

  get active() { return !!this.kind && this.game.mode === 'match'; }
  mine(d) { return d.by === this.player && d.fighter === this.dummy; }

  // 'tutorial' starts the lessons from the top, 'practice' opens the free room
  start(kind) {
    this.kind = kind;
    const pick = this.menus.setup.slots[0].fighter;
    const setup = {
      mode: 'practice', winsNeeded: 1, difficulty: 'normal', suddenDeath: 0,
      teams: { count: 0, names: [] },
      slots: [{ control: 0, fighter: pick, team: -1 }, { control: 'dummy', fighter: DUMMY_FIGHTER, team: -1 }],
    };
    this.game.pickups.manual = true;
    this.game.onTick = (dt) => this.tick(dt);
    this.game.startMatch(setup, this.bindings);
    [this.player, this.dummy] = this.game.fighters;
    this.player.immortal = this.dummy.immortal = true;
    this.place();
    this.game.hud.announce(kind === 'tutorial' ? 'Tutorial' : 'Practice', 'round', 1300);
    // the coach panel carries the prompts, so the usual key reminder stays hidden
    this.game.hud.setHints([]);
    this.game.hintUntil = -2;
    this.stats = { last: 0, combo: 0, comboDmg: 0, best: 0, at: -9 };
    this.step = -1;
    this.doneAt = 0;
    if (kind === 'tutorial') this.next();
    else this.setDummy('idle');
    this.el.hidden = false;
    this.render();
  }

  restart() { this.start(this.kind); }

  stop() {
    this.kind = null;
    this.el.hidden = true;
    this.game.onTick = null;
    this.game.pickups.manual = false;
  }

  // you a few steps from the dummy in the middle of the arena, both full health
  place() {
    const { player: p, dummy: d } = this;
    p.reset(new THREE.Vector3(0, 0, 5), Math.PI);
    d.reset(new THREE.Vector3(0, 0, 0), 0);
    d.maxHp = d.hp = d.displayHp = DUMMY_HP;
    this.lastPos = { x: p.pos.x, z: p.pos.z };
  }

  setDummy(mode) {
    this.dummy.controller.mode = mode;
    if (mode !== 'idle' && this.dummy.state === 'block') this.dummy.setState('idle');
  }

  next() {
    this.step++;
    this.progress = 0;
    this.doneAt = 0;
    const s = STEPS[this.step];
    if (!s) { this.finish(); return; }
    const { player: p, dummy: d } = this;
    // a dummy that was knocked across the arena comes back to the middle
    if (Math.hypot(d.pos.x, d.pos.z) > 6) { d.reset(new THREE.Vector3(0, 0, 0), 0); d.maxHp = d.hp = d.displayHp = DUMMY_HP; }
    this.setDummy(s.dummy);
    if (s.faceDummy) d.facing = Math.atan2(p.pos.x - d.pos.x, p.pos.z - d.pos.z);
    if (s.mana) { p.energy = 100; p.cooldowns = [0, 0, 0]; }
    s.enter?.(this);
    this.render();
  }

  // every lesson done: pause on the graduation screen
  finish() {
    this.game.setPaused(true);
    this.el.hidden = true;
    this.menus.show('trained');
  }

  addProgress(n) {
    const s = STEPS[this.step];
    if (!s || this.doneAt || !n) return;
    this.progress = Math.min(s.need, this.progress + n);
    if (this.progress >= s.need) {
      this.doneAt = this.game.time;
      this.game.hud.announce(this.step === STEPS.length - 1 ? 'Well fought' : 'Nice', 'fight', 900);
    }
    this.renderBar();
  }

  onEvent(type, d) {
    if (!this.active || !d) return;
    if (this.kind === 'practice') { this.track(type, d); return; }
    const fn = STEPS[this.step]?.on?.[type];
    if (fn && fn(this, d)) this.addProgress(1);
  }

  // practice room readout: last hit, the running combo and the best one
  track(type, d) {
    if (type !== 'hit' || !this.mine(d)) return;
    const s = this.stats, now = this.game.time;
    s.last = d.damage;
    if (now - s.at < 1.4) { s.combo++; s.comboDmg += d.damage; } else { s.combo = 1; s.comboDmg = d.damage; }
    s.at = now;
    s.best = Math.max(s.best, s.comboDmg);
    this.renderStats();
  }

  tick(dt) {
    if (!this.kind) return;
    const { player: p, dummy: d, game } = this;
    prompts.pollGamepad();
    // the dummy heals once you stop hitting it, and so do you
    if (game.time - d.lastHitTime > 2.2) d.hp = Math.min(d.maxHp, d.hp + d.maxHp * dt * 0.8);
    if (game.time - p.lastHitTime > 3) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * dt * 0.4);
    this.moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
    this.lastPos = { x: p.pos.x, z: p.pos.z };
    if (this.kind === 'practice') {
      p.energy = 100; // mana is free in the practice room
      if (this.stats.combo && game.time - this.stats.at > 1.4) { this.stats.combo = 0; this.renderStats(); }
      return;
    }
    const s = STEPS[this.step];
    if (!s) return;
    if (s.mana) p.energy = Math.max(p.energy, 60);
    if (s.tick && !this.doneAt) this.addProgress(s.tick(this, dt));
    if (this.doneAt && game.time - this.doneAt > 1) this.next();
  }

  // training keys (Tab, R, G) work only when player 1 has not bound them to a move
  onKey(e) {
    if (!this.active || this.menus.active || e.repeat) return false;
    if (Object.values(this.bindings[0]).includes(e.code)) return false;
    const cmd = { Tab: this.kind === 'tutorial' ? 'skip' : 'dummy', KeyR: 'reset', KeyG: 'gear' }[e.code];
    if (!cmd || (this.kind === 'tutorial' && cmd !== 'skip')) return false;
    this.command(cmd);
    return true;
  }

  command(cmd) {
    if (!this.active) return;
    if (cmd === 'skip' && this.kind === 'tutorial') { if (!this.doneAt) this.next(); }
    else if (cmd === 'dummy') { const m = this.dummy.controller.mode; this.setDummy(DUMMY_MODES[(DUMMY_MODES.indexOf(m) + 1) % DUMMY_MODES.length]); this.render(); }
    else if (cmd === 'reset') { this.place(); this.setDummy(this.dummy.controller.mode); }
    else if (cmd === 'gear') {
      this.gearAt = ((this.gearAt ?? -2) + 2) % GEAR.length;
      for (const type of GEAR.slice(this.gearAt, this.gearAt + 2)) this.game.pickups.place(type, this.player.pos.x, this.player.pos.z);
      this.game.hud.feed(`<span>gear laid out:</span> ${GEAR.slice(this.gearAt, this.gearAt + 2).map((t) => `<b>${esc(POWERUPS[t].label)}</b>`).join(' <span>and</span> ')}`);
    } else if (cmd === 'menu') { this.game.setPaused(true); this.menus.show('pause'); }
  }

  helpers() {
    const b = this.bindings[0];
    return { move: prompts.move(b), key: (a) => prompts.key(a, b), verb: prompts.verb, hold: prompts.hold };
  }

  render() {
    if (!this.kind || !this.player) return;
    const k = this.helpers();
    const btn = (cmd, label, key) => `<button class="coach-btn" data-coach="${cmd}">${key ? k.key(key) : ''}${esc(label)}</button>`;
    if (this.kind === 'tutorial') {
      const s = STEPS[this.step];
      if (!s) return;
      this.el.className = 'tutorial';
      this.el.innerHTML = `
        <div class="coach-head"><span class="coach-n">Lesson ${this.step + 1} of ${STEPS.length}</span><span class="coach-title">${esc(s.title)}</span></div>
        <p class="coach-text">${s.text(k, this)}</p>
        <div class="coach-prog"><div class="coach-bar"><i></i></div><span class="coach-count"></span></div>
        <div class="coach-foot">${btn('skip', 'Skip lesson', 'skip')}${btn('menu', 'Menu', 'menu')}</div>`;
      this.renderBar();
    } else {
      this.el.className = 'practice';
      this.el.innerHTML = `
        <div class="coach-head"><span class="coach-n">Practice room</span><span class="coach-title">Train freely</span></div>
        <p class="coach-text">Mana refills itself and nobody can be knocked out. Try your combos, skills and gear on the dummy.</p>
        <div class="coach-stats"></div>
        <div class="coach-foot">
          ${btn('dummy', `Dummy: ${DUMMY_LABEL[this.dummy.controller.mode]}`, 'dummy')}
          ${btn('gear', 'Lay out gear', 'gear')}
          ${btn('reset', 'Reset positions', 'reset')}
          ${btn('menu', 'Menu', 'menu')}
        </div>`;
      this.renderStats();
    }
  }

  renderBar() {
    const s = STEPS[this.step];
    const bar = this.el.querySelector('.coach-bar i');
    if (!s || !bar) return;
    bar.style.transform = `scaleX(${this.progress / s.need})`;
    const counted = Number.isInteger(s.need) && s.need > 1 && !s.tick;
    this.el.querySelector('.coach-count').textContent = this.doneAt ? 'Done' : counted ? `${Math.floor(this.progress)} / ${s.need}` : '';
    this.el.classList.toggle('done', !!this.doneAt);
  }

  renderStats() {
    const el = this.el.querySelector('.coach-stats');
    if (!el) return;
    const s = this.stats;
    el.innerHTML = `<div><b>${Math.round(s.last)}</b><span>last hit</span></div>
      <div><b>${s.combo}</b><span>combo hits</span></div>
      <div><b>${Math.round(s.combo ? s.comboDmg : 0)}</b><span>combo damage</span></div>
      <div><b>${Math.round(s.best)}</b><span>best combo</span></div>`;
  }

  // the Training screen: pick a fighter, then the tutorial or the practice room
  renderMenu() {
    const el = this.menus.screens.training.querySelector('.tr-fighter');
    const i = this.menus.setup.slots[0].fighter;
    const def = i >= 0 ? ROSTER[i] : null;
    el.innerHTML = `<span class="lbl">Your fighter</span><span class="val"><i>‹</i>${def ? esc(def.name) : 'Random'}<i>›</i></span>`;
    this.menus.screens.training.querySelector('.tr-desc').textContent = def
      ? `${def.title} · ${def.role} · ${[SPECIALS[def.special].label, ...def.skills.map((id) => SKILLS[id].label)].join(' · ')}`
      : 'Any of the eight, picked when the lesson starts.';
  }

  changeFighter(d) {
    const s = this.menus.setup.slots[0], n = ROSTER.length;
    s.fighter = ((s.fighter + 1 + d + n + 1) % (n + 1)) - 1; // -1 = random
    saveSetup(this.menus.setup);
    this.renderMenu();
  }
}
