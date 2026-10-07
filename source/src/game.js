// Game orchestration: renderer, fixed-step simulation, rounds and match flow.
import * as THREE from 'three';
import { SIM_DT, ROSTER, PLAYER_COLORS, TEAM_COLORS, POWERUPS, WEAPONS, COMBAT, HILL, cleanTeamName, modeRules } from './config.js';
import { events } from './events.js';
import { Arena } from './arena.js';
import { Badlands } from './battleground.js';
import { Pickups } from './pickups.js';
import { Effects } from './effects.js';
import { Fighter, allies } from './fighter.js';
import { CameraRig } from './camera.js';
import { AIController, DummyController } from './ai.js';
import { HumanController, devices } from './input.js';
import { Hud } from './hud.js';
import { Replay } from './replay.js';
import { Hill } from './hill.js';
import { wardrobe, randomLook } from './cosmetics.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Game {
  constructor({ stage, hudRoot, keyboard, quality = 'auto' }) {
    this.stage = stage;
    this.keyboard = keyboard;
    this.events = events;
    this.quality = quality;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxPixelRatio = quality === 'low' ? 1 : quality === 'high' ? 2 : 1.6;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    stage.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.rig = new CameraRig(1);
    this.arenaQuality = quality === 'auto' ? 'high' : quality;
    this.arenas = { coliseum: new Arena(this.scene, this.arenaQuality) };
    this.arena = this.arenas.coliseum;
    this.effects = new Effects(this.scene);
    this.pickups = new Pickups(this);
    this.pickups.setPads(this.arena.pads);
    this.rules = modeRules('cpu');
    this.friendlyFire = false;
    this.reviveOn = false;
    this.hud = new Hud(hudRoot);
    this.replay = new Replay(this);
    this.hill = new Hill(this);

    // world state read by fighters, AI and specials
    this.fighters = [];
    this.projectiles = [];
    this.delayed = [];
    this.time = 0;
    this.ringRadius = 99;
    this.locked = true;
    this.cameraForward = this.rig.forward;
    this.cameraRight = this.rig.right;

    this.mode = 'demo';       // 'demo' | 'match'
    this.phase = 'idle';      // 'intro' | 'fight' | 'roundOver' | 'matchOver'
    this.paused = false;
    this.timeScale = 1;
    this.slowmo = 0;
    this.acc = 0;
    this.phaseTime = 0;
    this.fightTime = 0;
    this.round = 0;
    this.setup = null;
    this.onMatchEnd = null;
    this.frameMs = 16;
    this.perfTimer = 0;
    this.errors = 0;
    this.fastForward = false;
    this.debugSpeed = 1;
    this.online = null;       // null | 'host' | 'client'
    this.net = null;          // the NetSession while online

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      document.getElementById('fatal').hidden = false;
    });

    this.bindEvents();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
    this.startBackgroundTicker();
  }

  // Browsers stop animation frames in hidden tabs. An online host keeps simulating
  // from a worker timer so everyone else's match carries on while its tab is hidden.
  startBackgroundTicker() {
    try {
      const src = 'setInterval(() => postMessage(0), 16);';
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = () => { if (document.hidden && this.online === 'host') this.frame(true); };
    } catch { /* no workers: the host simply pauses while hidden */ }
  }

  bindEvents() {
    events.on('hit', ({ heavy, ko }) => { this.arena.excitement += heavy ? 0.18 : 0.06; if (ko) this.arena.excitement += 1; });
    events.on('ko', ({ fighter, by, replay }) => {
      if (replay) return; // the instant replay plays back its own effects
      if (this.online === 'client') { this.arena.excitement += 1.2; flashScreen(); return; } // the host sends the rest
      this.rig.shake(0.5);
      this.arena.excitement += 1.2;
      this.effects.ring(fighter.pos.x, 0.1, fighter.pos.z, fighter.def.eyes, 3.2, 0.6);
      if (this.mode !== 'match') return;
      const v = nameTag(fighter);
      const k = by ? nameTag(by) : '<b class="fire">The flames</b>';
      const verb = by && allies(by, fighter) ? 'betrayed' : fighter.downed > 0 ? 'downed' : 'defeated';
      this.hud.feed(`${k} <span>${verb}</span> ${v}${fighter.downed > 0 ? ' <span>· a teammate can revive</span>' : ''}`);
      flashScreen();
    });
    events.on('backstab', ({ fighter, by, quiet }) => {
      if (this.online === 'client' || this.mode !== 'match' || quiet || !by) return;
      this.hud.feed(`${nameTag(by)} <span class="stab">backstabbed</span> ${nameTag(fighter)}`);
    });
    events.on('parry', ({ fighter, by }) => {
      if (this.online === 'client' || this.mode !== 'match' || !(fighter.isPlayer || by?.isPlayer)) return;
      this.hud.feed(`${nameTag(fighter)} <span>parried</span> ${nameTag(by)}`);
    });
    events.on('revive', ({ fighter, by }) => {
      if (this.online === 'client' || this.mode !== 'match') return;
      this.hud.feed(`${by ? nameTag(by) : 'A teammate'} <span>revived</span> ${nameTag(fighter)}`);
    });
    // gear pickups and breakages show on the player's own ability bar (clients replay these events too)
    events.on('pickup', ({ fighter, type }) => {
      if (this.mode === 'match' && fighter) { const pu = POWERUPS[type]; if (pu?.weapon || pu?.item || pu?.armor) this.hud.gearToast(fighter, type); }
    });
    events.on('weaponBreak', ({ fighter, weapon }) => {
      if (this.mode === 'match' && fighter) this.hud.gearNote(fighter, `${WEAPONS[weapon]?.label || 'Weapon'} shattered`);
    });
    events.on('armorBreak', ({ fighter }) => {
      if (this.mode === 'match' && fighter) this.hud.gearNote(fighter, 'Armor broken');
    });
    events.on('pickup', ({ fighter, type }) => {
      if (this.online === 'client' || this.mode !== 'match' || !fighter.isPlayer) return;
      this.hud.feed(`${nameTag(fighter)} <span>grabbed</span> <b style="color:${hex(POWERUPS[type].color)}">${POWERUPS[type].label}</b>`);
    });
  }

  shake(a) { this.rig.shake(a); }

  // Swaps the battleground: the coliseum for quick fights, the much larger Badlands for tournaments.
  useArena(name) {
    this.rig.maxDistance = name === 'badlands' ? 50 : 36;
    if (!this.arenas[name]) {
      this.arenas[name] = new Badlands(this.scene, this.arenaQuality);
      this.arenas[name].moon.castShadow = this.renderer.shadowMap.enabled;
    }
    const next = this.arenas[name];
    for (const a of Object.values(this.arenas)) if (a !== next) a.show(false);
    next.show(true);
    if (this.arena !== next) {
      this.arena = next;
      this.pickups.setPads(next.pads);
      this.warmShaders();
    }
  }

  // Mode rules (MODES in config.js) for the match about to start.
  applyRules(setup) {
    this.rules = { ...modeRules(setup?.mode || 'cpu'), ...(setup?.rules || {}) };
    this.useArena(this.rules.map);
    this.friendlyFire = !!this.rules.friendlyFire;
    this.reviveOn = !!this.rules.revive;
  }

  // Compiles every shader the match can need (hidden effect pools, the fire ring, buff shells,
  // projectiles) up front, so the first special or KO of a match does not stall a frame.
  warmShaders() {
    const hidden = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    const samples = [
      new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 6), new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.3 })),
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial()),
      new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial()),
      this.effects.makeGlow(0xffffff, 1),
    ];
    for (const o of samples) this.scene.add(o);
    try {
      this.renderer.compile(this.scene, this.rig.camera);
    } catch (err) {
      console.warn('[game] shader warm-up skipped', err);
    } finally {
      for (const o of hidden) o.visible = false;
      for (const o of samples) { this.scene.remove(o); if (!o.isSprite) o.geometry.dispose(); o.material.dispose(); } // sprites share one geometry
    }
  }

  onKO() {
    // round end is checked in the tick so simultaneous KOs resolve together
  }

  resize() {
    const w = this.stage.clientWidth || window.innerWidth, h = this.stage.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w / h);
  }

  clearFighters() {
    this.replay.reset();
    for (const f of this.fighters) {
      this.scene.remove(f.model.root);
      for (const m of f.model.mats) m.dispose();
      f.model.eyeMat.dispose();
      f.model.ring.material.dispose();
      f.model.ice.material.dispose();
      f.model.aura.material.dispose();
      f.model.shell.material.dispose();
    }
    this.fighters = [];
    for (const p of this.projectiles) if (!p.dead) p.burst(this);
    this.projectiles = [];
    this.delayed = [];
  }

  // A CPU-only brawl that plays behind the title menu.
  startDemo() {
    this.clearFighters();
    this.mode = 'demo';
    this.online = null;
    this.teams = null;
    this.localFighter = null;
    this.hud.show(false);
    this.rig.mode = 'orbit';
    this.rig.follow = null;
    this.applyRules({ mode: 'cpu' });
    const ids = [...ROSTER.keys()].sort(() => Math.random() - 0.5).slice(0, 6);
    this.fighters = ids.map((i, k) => new Fighter(ROSTER[i], k, new AIController('normal'), randomLook()));
    for (const f of this.fighters) this.scene.add(f.model.root);
    this.setup = { winsNeeded: 99, suddenDeath: 50 };
    this.beginRound(true);
  }

  startMatch(setup, bindings) {
    this.clearFighters();
    this.mode = 'match';
    this.online = null;
    this.localFighter = null;
    this.setup = setup;
    this.bindings = bindings;
    this.keyboard.setGameKeys(bindings);
    this.keyboard.captureGameKeys = true;
    this.applyRules(setup);
    this.fighters = setup.slots.map((s, i) => {
      const index = s.fighter < 0 ? Math.floor(Math.random() * ROSTER.length) : s.fighter;
      const ctrl = s.control === 'cpu' ? new AIController(setup.difficulty)
        : s.control === 'dummy' ? new DummyController()
        : new HumanController(this.keyboard, bindings[s.control], s.control);
      // people wear what they picked in the wardrobe, CPUs and the practice dummy dress themselves
      const look = s.look && typeof s.look === 'object' ? s.look
        : s.control === 'cpu' || s.control === 'dummy' ? randomLook() : wardrobe.lookFor(index);
      // a slot can bring its own fighter definition (the arcade boss is a giant version of a roster fighter)
      const f = new Fighter(s.def || ROSTER[index], i, ctrl, look);
      if (ctrl.name) f.name = ctrl.name;
      if (s.name) f.name = s.name;
      f.setReward(s.reward);
      return f;
    });
    this.applyTeams(setup.teams, setup.slots.map((s) => s.team));
    for (const f of this.fighters) f.setDurability(this.rules.durability);
    this.tintDuplicates();
    for (const f of this.fighters) this.scene.add(f.model.root);
    this.round = 0;
    this.buildHud();
    this.hud.show(true);
    this.hintUntil = 12;
    const humans = this.fighters.filter((f) => f.isHuman);
    this.rig.follow = humans.length === 1 && this.arena.radius > 20 ? humans[0] : null;
    this.beginRound(false);
  }

  // Team mode: `teams` is { count, names } (count 0 = free-for-all), `picks` each fighter's team.
  applyTeams(teams, picks) {
    const count = teams?.count || 0;
    this.teams = count ? Array.from({ length: count }, (_, t) => ({ name: cleanTeamName(teams.names?.[t], t), color: TEAM_COLORS[t] })) : null;
    if (!this.teams) return;
    this.arena.setTeams?.(this.teams);
    this.fighters.forEach((f, i) => {
      const t = ((picks[i] ?? i) % count + count) % count;
      f.setTeam(t, this.teams[t].name, this.teams[t].color);
    });
  }

  get teamMode() { return !!this.teams && this.mode === 'match'; }

  // duplicate characters get a tint so they stay distinguishable
  tintDuplicates() {
    const seen = new Map();
    for (const f of this.fighters) {
      const n = seen.get(f.def.id) || 0;
      seen.set(f.def.id, n + 1);
      if (n > 0) {
        f.name = `${f.def.name} ${['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n - 1]}`;
        f.model.mats[0].color.offsetHSL(0, 0, n % 2 ? -0.12 : 0.1);
      }
    }
  }

  // Online match. The host simulates with `controllers`; a client gets none and
  // only shows what the host's snapshots say. `you` is this browser's slot (-1 spectates).
  startOnline(spec, role, controllers, you, bindings) {
    this.clearFighters();
    this.mode = 'match';
    this.online = role;
    this.setup = spec.setup;
    this.bindings = bindings;
    this.keyboard.setGameKeys([bindings[0], bindings[1]]);
    this.keyboard.captureGameKeys = true;
    this.paused = false;
    this.applyRules(spec.setup);
    this.fighters = spec.fighters.map((s, i) => {
      const f = new Fighter(ROSTER[s.def], i, controllers ? controllers[i] : null, s.look);
      f.netName = s.pname || null;
      f.netColor = s.color || null;
      f.isYou = i === you;
      f.setReward(s.reward);
      return f;
    });
    this.applyTeams(spec.setup.teams, spec.fighters.map((s) => s.team));
    for (const f of this.fighters) f.setDurability(this.rules.durability);
    this.tintDuplicates();
    for (const f of this.fighters) this.scene.add(f.model.root);
    this.localFighter = this.fighters[you] || null;
    this.rig.follow = this.arena.radius > 20 ? this.localFighter : null;
    this.round = 0;
    this.watchHint = spec.watchHint;
    this.buildHud();
    this.hud.show(true);
    this.hintUntil = 12;
    if (role === 'host') this.beginRound(false);
    else {
      this.phase = 'intro';
      this.rig.mode = 'fight';
      this.rig.winner = null;
      this.arena.resetFireRing();
      this.pickups.reset(false);
      this.hill.reset();
    }
  }

  // Cards, item bars and the opening hints, labelled for the keys, controller or touch
  // screen each player is using. Rebuilt between rounds when someone switches device.
  buildHud() {
    const b = this.bindings, show = (p) => devices.display(p, b[p]);
    this.hudDevices = devices.kind.join();
    this.hud.build(this.fighters, this.setup.winsNeeded, this.teams,
      this.online ? (f, a) => show(0)?.[a] : (f, a) => show(f.controller.playerIndex)?.[a]);
    this.hud.setHints(this.openingHints());
  }

  openingHints() {
    const b = this.bindings;
    if (this.online) {
      if (!this.localFighter) return [this.watchHint || 'You are watching this match. You join the next one.'];
      if (devices.kind[0] === 'touch') return [];
      return [Hud.onlineHint([devices.display(0, b[0]), b[1]]), Hud.skillHint(this.localFighter, devices.display(0, b[0]), 'You')];
    }
    const humans = this.fighters.filter((f) => f.isHuman).sort((x, y) => x.controller.playerIndex - y.controller.playerIndex);
    return humans.flatMap((f) => {
      const p = f.controller.playerIndex;
      if (devices.kind[p] === 'touch') return [];
      const d = devices.display(p, b[p]);
      return [Hud.controlHint(p, d), Hud.skillHint(f, d, `P${p + 1}`)];
    });
  }

  // Someone picked up a controller or touched the screen: fix the hints now, the labels at the next round.
  inputChanged() {
    if (this.mode !== 'match' || !this.fighters.length) return;
    if (this.hintUntil > 0) this.hud.setHints(this.openingHints());
  }

  beginRound(silent) {
    if (this.mode === 'match' && this.round > 0 && this.hudDevices !== devices.kind.join()) this.buildHud();
    this.round++;
    this.phase = 'intro';
    this.phaseTime = 0;
    this.fightTime = 0;
    this.locked = true;
    this.ringRadius = 99;
    this.suddenDeath = false;
    this.arena.resetFireRing();
    this.timeScale = 1;
    this.slowmo = 0;
    this.fastForward = false;
    for (const p of this.projectiles) if (!p.dead) p.burst(this);
    this.projectiles = [];
    this.delayed = [];
    this.pickups.reset(!!this.rules.powerups);
    // teammates start side by side (or in their base on the Badlands)
    const order = this.teamMode ? [...this.fighters].sort((a, b) => a.team - b.team || a.slot - b.slot) : this.fighters;
    const spots = this.arena.spawnPoints(order);
    order.forEach((f, i) => f.reset(new THREE.Vector3(spots[i].x, 0, spots[i].z), spots[i].facing));
    this.hill.reset();
    if (this.mode === 'match') {
      this.rig.mode = 'fight';
      this.rig.winner = null;
      const last = this.fighters.some((f) => f.stats.wins === this.setup.winsNeeded - 1) && this.round > 1;
      if (this.teamMode) this.teamsAlive = new Set(this.fighters.map((f) => f.team));
      this.hud.announce(last ? `Round ${this.round} · Final` : `Round ${this.round}`, 'round', 1300);
      this.hud.setTimer('');
      events.emit('roundStart', { round: this.round, final: last, fighters: this.fighters });
    }
    if (silent) { this.phase = 'fight'; this.locked = false; }
  }

  tick(dt) {
    this.time += dt;
    this.phaseTime += dt;

    if (this.phase === 'intro' && this.phaseTime > 1.5) {
      this.phase = 'fight';
      this.locked = false;
      this.hud.announce('Fight!', 'fight', 900);
      events.emit('fight', { round: this.round });
    }

    if (this.phase === 'fight') {
      this.fightTime += dt;
      const sd = this.setup.suddenDeath;
      if (sd > 0 && this.fightTime > sd && !this.hill.active) { // king of the hill has its own clock
        if (!this.suddenDeath) {
          this.suddenDeath = true;
          this.ringRadius = this.arena.radius + 0.6;
          if (this.mode === 'match') this.hud.announce('Sudden Death', 'sudden', 1800);
          events.emit('suddenDeath', {});
        }
        this.ringRadius = Math.max(2.6, this.ringRadius - dt * 0.42 * Math.max(1, this.arena.radius / 22));
      }
    }

    for (const f of this.fighters) f.update(dt, this);
    this.resolveCollisions(dt);
    this.pickups.update(dt, this);
    if (this.arena.zones.length && this.phase === 'fight') this.healZones(dt);
    if (this.reviveOn) this.tickRevives(dt);

    for (const p of this.projectiles) if (!p.dead) p.update(dt, this);
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
    if (this.delayed.length) {
      const due = this.delayed.filter((d) => d.at <= this.time);
      if (due.length) {
        this.delayed = this.delayed.filter((d) => d.at > this.time);
        for (const d of due) d.run(this);
      }
    }

    if (this.phase === 'fight' && this.hill.active) {
      // king of the hill: rounds end on points (or time), never on knockouts
      const w = this.hill.tick(dt);
      if (w !== undefined) this.endRound(w);
      if (this.mode === 'match') this.onTick?.(dt);
    } else if (this.phase === 'fight') {
      const alive = this.fighters.filter((f) => f.alive);
      if (this.teamMode) {
        const left = new Set(alive.map((f) => f.team));
        if (left.size > 1) {
          // announce a team that just went down entirely
          for (const t of this.teamsAlive) if (!left.has(t)) this.hud.feed(`<b style="color:${hex(this.teams[t].color)}">${esc(this.teams[t].name)}</b> <span>are wiped out</span>`);
        }
        this.teamsAlive = left;
        if (left.size <= 1) this.endRound(alive[0] || null);
      } else if (alive.length <= 1) this.endRound(alive[0] || null);
      // the tutorial and practice room follow along every step
      if (this.mode === 'match') this.onTick?.(dt);
    } else if (this.phase === 'roundOver') {
      const w = this.roundWinner;
      if (w && w.alive && w.grounded && w.state === 'idle' && this.phaseTime > 0.6) w.setState('victory');
      if (this.phaseTime > 3.2) this.afterRound();
    }
  }

  // Healing springs on the Badlands mend anyone standing in them.
  healZones(dt) {
    for (const f of this.fighters) {
      if (!f.alive || f.hp >= f.maxHp) continue;
      for (const z of this.arena.zones) {
        if (Math.hypot(f.pos.x - z.x, f.pos.z - z.z) > z.r) continue;
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * z.heal * dt);
        if (Math.random() < dt * 6) this.effects.sparks(f.pos.x, 0.4, f.pos.z, 0x7affc8, 3, 2);
        break;
      }
    }
  }

  // Tournament: a teammate standing over a downed fighter pulls them back up; alone, they bleed out.
  tickRevives(dt) {
    if (this.phase !== 'fight') return;
    for (const f of this.fighters) {
      if (f.alive || f.downed <= 0) continue;
      f.downed -= dt;
      let helper = null;
      for (const o of this.fighters) {
        if (!o.alive || !allies(o, f) || !(o.state === 'idle' || o.state === 'block')) continue;
        if (Math.hypot(o.pos.x - f.pos.x, o.pos.z - f.pos.z) < COMBAT.reviveRange) { helper = o; break; }
      }
      if (helper) {
        f.reviveProgress += dt;
        if (Math.random() < dt * 10) this.effects.sparks(f.pos.x, 0.5, f.pos.z, 0x7affc8, 3, 2.5);
      } else f.reviveProgress = Math.max(0, f.reviveProgress - dt * 0.5);
      if (f.reviveProgress >= COMBAT.reviveTime) f.revive(this, helper);
      else if (f.downed <= 0) { f.downed = 0; f.reviveProgress = 0; }
    }
  }

  resolveCollisions(dt) {
    const F = this.fighters;
    for (let i = 0; i < F.length; i++) {
      const a = F[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < F.length; j++) {
        const b = F[j];
        if (!b.alive) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.2) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz), min = a.radius + b.radius;
        if (d < min) {
          const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
          const push = (min - d) / 2;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
    for (const f of F) {
      const r = this.arena.collide(f.pos.x, f.pos.z, f.radius);
      if (r.hitWall) {
        const speed = Math.hypot(f.vel.x, f.vel.z);
        if (f.alive && speed > 7 && (f.state === 'hitstun' || f.state === 'knockdown')) {
          // wall splat: bounce off and take a little extra damage
          const nx = r.x - f.pos.x, nz = r.z - f.pos.z, nl = Math.hypot(nx, nz) || 1;
          const dot = f.vel.x * (nx / nl) + f.vel.z * (nz / nl);
          f.vel.x -= 1.6 * dot * (nx / nl); f.vel.z -= 1.6 * dot * (nz / nl);
          f.applyDamage(3, f.lastAttacker, this, true);
          this.effects.dust(f.pos.x, f.pos.z, 1.2);
          this.rig.shake(0.25);
          events.emit('wallHit', { fighter: f, speed });
        }
        f.pos.x = r.x; f.pos.z = r.z;
      }
    }
  }

  endRound(winner) {
    this.phase = 'roundOver';
    this.phaseTime = 0;
    this.roundWinner = winner;
    this.slowmo = 1.3;
    const team = this.teamMode && winner ? this.teams[winner.team] : null;
    if (team) { for (const f of this.fighters) if (f.team === winner.team) f.stats.wins++; }
    else if (winner) winner.stats.wins++;
    events.emit('roundEnd', { winner, round: this.round, team: team ? team.name : null });
    if (this.mode !== 'match') return;
    this.rig.mode = 'winner';
    this.rig.winner = winner;
    this.rig.orbitAngle = this.rig.yaw;
    if (winner) {
      const done = winner.stats.wins >= this.setup.winsNeeded;
      const who = team ? team.name : winner.name;
      this.hud.announce(done ? `${who} ${team ? 'win' : 'wins'}` : `${who} ${team ? 'take' : 'takes'} the round`, 'win', 3000);
    } else {
      this.hud.announce('Double K.O.', 'win', 3000);
    }
  }

  afterRound() {
    if (this.mode === 'demo') { this.beginRound(true); return; }
    const champ = this.fighters.find((f) => f.stats.wins >= this.setup.winsNeeded);
    if (champ) {
      this.phase = 'matchOver';
      this.phaseTime = 0;
      events.emit('matchEnd', { winner: champ, fighters: this.fighters });
      this.onMatchEnd?.(champ, this.fighters);
      return;
    }
    this.beginRound(false);
  }

  setPaused(p) {
    this.paused = p;
    this.keyboard.captureGameKeys = !p && this.mode === 'match';
  }

  frame(noRender = false) {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.frameMs = this.frameMs * 0.95 + dt * 1000 * 0.05;

    try {
      if (this.replay.playing) {
        this.replay.step(dt);
      } else if (this.online === 'client') {
        this.net.clientStep(dt);
        this.hill.animate(dt);
        this.pickups.animate(this.time);
        this.effects.update(dt);
        this.arena.update(dt);
        this.rig.update(dt, this.fighters);
        this.cameraForward = this.rig.forward;
        this.cameraRight = this.rig.right;
        if (this.ringRadius < 90) this.arena.setFireRing(this.ringRadius);
        if (this.mode === 'match') this.updateHud(dt, !!this.localFighter && !this.localFighter.alive);
        this.replay.record();
      } else if (!this.paused) {
        if (this.slowmo > 0) { this.slowmo -= dt; this.timeScale = this.slowmo > 0 ? 0.3 : 1; }
        const humansAlive = this.fighters.some((f) => f.isHuman && f.alive);
        const anyHuman = this.fighters.some((f) => f.isHuman);
        const ff = !this.online && this.mode === 'match' && this.phase === 'fight' && anyHuman && !humansAlive && !this.hill.active &&
          (this.keyboard.isDown('KeyX') || !!devices.touch?.isDown('ff') || !!devices.pads?.anyDown('b0'));
        const scale = this.timeScale * (ff ? 3 : 1) * this.debugSpeed;
        this.acc += dt * scale;
        let steps = 0;
        const maxSteps = 24 * this.debugSpeed;
        while (this.acc >= SIM_DT && steps < maxSteps) { this.tick(SIM_DT); this.acc -= SIM_DT; steps++; }
        if (steps >= maxSteps) this.acc = 0;
        this.effects.update(dt * scale);
        this.hill.animate(dt);
        this.pickups.animate(this.time);
        this.arena.update(dt * scale);
        this.rig.update(dt, this.fighters);
        this.cameraForward = this.rig.forward;
        this.cameraRight = this.rig.right;
        if (this.ringRadius < 90) this.arena.setFireRing(this.ringRadius);
        if (this.online === 'host') this.net?.afterFrame(dt);
        if (this.mode === 'match') this.updateHud(dt, this.online ? !!this.localFighter && !this.localFighter.alive : anyHuman && !humansAlive);
        this.replay.record();
      }
      if (noRender) return;
      this.renderer.render(this.scene, this.rig.camera);
      this.replay.afterRender(dt);
      this.adaptQuality(dt);
    } catch (err) {
      this.errors++;
      console.error('[game] frame error', err);
      if (this.errors > 30) { this.renderer.setAnimationLoop(null); document.getElementById('fatal').hidden = false; }
    }
  }

  updateHud(dt, spectating) {
    if (this.hill.active) spectating = false; // knocked-out fighters are back in a moment
    if ((this.phase === 'fight' || this.phase === 'roundOver') && this.hill.active) {
      const left = Math.max(0, (this.rules.hillLimit || HILL.limit) - this.hill.time);
      this.hud.setTimer(String(Math.ceil(left)), left < 10);
    } else if (this.phase === 'fight' || this.phase === 'roundOver') {
      const sd = this.setup.suddenDeath;
      if (sd > 0) {
        const left = Math.max(0, sd - this.fightTime);
        this.hud.setTimer(this.suddenDeath ? '∞' : String(Math.ceil(left)), !this.suddenDeath && left < 10);
      } else this.hud.setTimer('');
    }
    this.hintUntil -= dt;
    if (spectating && this.phase === 'fight') this.hud.setHints([this.online ? 'You are out. Watch who takes the round.' : `You are out. ${devices.last === 'touch' ? 'Hold the button' : devices.last === 'pad' ? 'Hold <kbd class="pad f0">A</kbd>' : 'Hold <kbd>X</kbd>'} to fast-forward.`]);
    else if (this.hintUntil <= 0 && this.hintUntil > -1) { this.hud.setHints([]); this.hintUntil = -2; }
    this.hud.update(dt, this.rig.camera, this.width, this.height);
  }

  adaptQuality(dt) {
    if (this.quality !== 'auto') return;
    this.perfTimer += dt;
    if (this.perfTimer < 2.5) return;
    this.perfTimer = 0;
    const target = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    if (this.frameMs > 21 && this.pixelRatio > 0.6) {
      this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.2);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      if (this.pixelRatio <= 0.8 && this.renderer.shadowMap.enabled && this.frameMs > 28) {
        this.renderer.shadowMap.enabled = false;
        this.arena.moon.castShadow = false;
      }
    } else if (this.frameMs < 13 && this.pixelRatio < target) {
      this.pixelRatio = Math.min(target, this.pixelRatio + 0.1);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  stats() {
    return {
      fps: Math.round(1000 / this.frameMs), pixelRatio: this.pixelRatio, phase: this.phase, round: this.round, mode: this.mode,
      rules: this.rules.mode, map: this.arena.name, pickups: this.pickups.state(),
      fighters: this.fighters.map((f) => ({ name: f.name, team: f.team, hp: Math.round(f.hp), maxHp: f.maxHp, alive: f.alive, downed: +f.downed.toFixed(1), wins: f.stats.wins, kos: f.stats.kos, state: f.state, weapon: f.weapon, plate: Math.round(f.plate), items: f.items.map((it) => `${it.id}x${it.charges}`) })),
      drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
    };
  }
}

function nameTag(f) { return `<b style="color:${hex(f.teamColor ?? f.def.eyes)}">${esc(f.netName || f.name)}</b>`; }

function flashScreen() {
  const el = document.getElementById('flash');
  if (!el) return;
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
}

export { PLAYER_COLORS };
