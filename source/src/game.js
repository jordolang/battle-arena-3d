// Game orchestration: renderer, fixed-step simulation, rounds and match flow.
import * as THREE from 'three';
import { SIM_DT, ARENA, ROSTER, PLAYER_COLORS, TEAM_COLORS, cleanTeamName } from './config.js';
import { events } from './events.js';
import { Arena } from './arena.js';
import { Effects } from './effects.js';
import { Fighter } from './fighter.js';
import { CameraRig } from './camera.js';
import { AIController } from './ai.js';
import { HumanController } from './input.js';
import { Hud } from './hud.js';

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
    this.arena = new Arena(this.scene, quality === 'auto' ? 'high' : quality);
    this.effects = new Effects(this.scene);
    this.hud = new Hud(hudRoot);

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
    events.on('ko', ({ fighter, by }) => {
      if (this.online === 'client') { this.arena.excitement += 1.2; flashScreen(); return; } // the host sends the rest
      this.rig.shake(0.5);
      this.arena.excitement += 1.2;
      this.effects.ring(fighter.pos.x, 0.1, fighter.pos.z, fighter.def.eyes, 3.2, 0.6);
      if (this.mode !== 'match') return;
      const v = `<b style="color:${hex(fighter.teamColor ?? fighter.def.eyes)}">${esc(fighter.name)}</b>`;
      const k = by ? `<b style="color:${hex(by.teamColor ?? by.def.eyes)}">${esc(by.name)}</b>` : '<b class="fire">The flames</b>';
      this.hud.feed(`${k} <span>defeated</span> ${v}`);
      flashScreen();
    });
  }

  shake(a) { this.rig.shake(a); }

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
    const ids = [...ROSTER.keys()].sort(() => Math.random() - 0.5).slice(0, 6);
    this.fighters = ids.map((i, k) => new Fighter(ROSTER[i], k, new AIController('normal')));
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
    this.fighters = setup.slots.map((s, i) => {
      const def = ROSTER[s.fighter < 0 ? Math.floor(Math.random() * ROSTER.length) : s.fighter];
      const ctrl = s.control === 'cpu'
        ? new AIController(setup.difficulty)
        : new HumanController(this.keyboard, bindings[s.control], s.control);
      return new Fighter(def, i, ctrl);
    });
    this.applyTeams(setup.teams, setup.slots.map((s) => s.team));
    this.tintDuplicates();
    for (const f of this.fighters) this.scene.add(f.model.root);
    this.round = 0;
    this.hud.build(this.fighters, setup.winsNeeded, this.teams, (f, a) => bindings[f.controller.playerIndex]?.[a]);
    this.hud.show(true);
    const humans = this.fighters.filter((f) => f.isHuman).sort((a, b) => a.controller.playerIndex - b.controller.playerIndex);
    this.hud.setHints(humans.flatMap((f) => {
      const b = bindings[f.controller.playerIndex];
      return [Hud.controlHint(f.controller.playerIndex, b), Hud.skillHint(f, b, `P${f.controller.playerIndex + 1}`)];
    }));
    this.hintUntil = 12;
    this.beginRound(false);
  }

  // Team mode: `teams` is { count, names } (count 0 = free-for-all), `picks` each fighter's team.
  applyTeams(teams, picks) {
    const count = teams?.count || 0;
    this.teams = count ? Array.from({ length: count }, (_, t) => ({ name: cleanTeamName(teams.names?.[t], t), color: TEAM_COLORS[t] })) : null;
    if (!this.teams) return;
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
    this.fighters = spec.fighters.map((s, i) => {
      const f = new Fighter(ROSTER[s.def], i, controllers ? controllers[i] : null);
      f.netName = s.pname || null;
      f.netColor = s.color || null;
      f.isYou = i === you;
      return f;
    });
    this.applyTeams(spec.setup.teams, spec.fighters.map((s) => s.team));
    this.tintDuplicates();
    for (const f of this.fighters) this.scene.add(f.model.root);
    this.localFighter = this.fighters[you] || null;
    this.round = 0;
    this.hud.build(this.fighters, spec.setup.winsNeeded, this.teams, (f, a) => bindings[0]?.[a]);
    this.hud.show(true);
    this.hud.setHints(you >= 0 ? [Hud.onlineHint(bindings), Hud.skillHint(this.localFighter, bindings[0], 'You')] : ['You are watching this match. You join the next one.']);
    this.hintUntil = 12;
    if (role === 'host') this.beginRound(false);
    else {
      this.phase = 'intro';
      this.rig.mode = 'fight';
      this.rig.winner = null;
      this.arena.resetFireRing();
    }
  }

  beginRound(silent) {
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
    const n = this.fighters.length;
    const spawnR = n <= 2 ? 4 : n <= 4 ? 6 : 7.5;
    const offset = Math.PI / 2 + (n === 2 ? 0 : Math.PI / n);
    // teammates start side by side
    const order = this.teamMode ? [...this.fighters].sort((a, b) => a.team - b.team || a.slot - b.slot) : this.fighters;
    order.forEach((f, i) => {
      const a = offset + (i / n) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(a) * spawnR, 0, Math.sin(a) * spawnR);
      f.reset(p, Math.atan2(-p.x, -p.z));
    });
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
      if (sd > 0 && this.fightTime > sd) {
        if (!this.suddenDeath) {
          this.suddenDeath = true;
          this.ringRadius = ARENA.radius + 0.6;
          if (this.mode === 'match') this.hud.announce('Sudden Death', 'sudden', 1800);
          events.emit('suddenDeath', {});
        }
        this.ringRadius = Math.max(2.6, this.ringRadius - dt * 0.42);
      }
    }

    for (const f of this.fighters) f.update(dt, this);
    this.resolveCollisions(dt);

    for (const p of this.projectiles) if (!p.dead) p.update(dt, this);
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
    if (this.delayed.length) {
      const due = this.delayed.filter((d) => d.at <= this.time);
      if (due.length) {
        this.delayed = this.delayed.filter((d) => d.at > this.time);
        for (const d of due) d.run(this);
      }
    }

    if (this.phase === 'fight') {
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
    } else if (this.phase === 'roundOver') {
      const w = this.roundWinner;
      if (w && w.alive && w.grounded && w.state === 'idle' && this.phaseTime > 0.6) w.setState('victory');
      if (this.phaseTime > 3.2) this.afterRound();
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
      if (this.online === 'client') {
        this.net.clientStep(dt);
        this.effects.update(dt);
        this.arena.update(dt);
        this.rig.update(dt, this.fighters);
        this.cameraForward = this.rig.forward;
        this.cameraRight = this.rig.right;
        if (this.ringRadius < 30) this.arena.setFireRing(this.ringRadius);
        if (this.mode === 'match') this.updateHud(dt, !!this.localFighter && !this.localFighter.alive);
      } else if (!this.paused) {
        if (this.slowmo > 0) { this.slowmo -= dt; this.timeScale = this.slowmo > 0 ? 0.3 : 1; }
        const humansAlive = this.fighters.some((f) => f.isHuman && f.alive);
        const anyHuman = this.fighters.some((f) => f.isHuman);
        const ff = !this.online && this.mode === 'match' && this.phase === 'fight' && anyHuman && !humansAlive && this.keyboard.isDown('KeyX');
        const scale = this.timeScale * (ff ? 3 : 1) * this.debugSpeed;
        this.acc += dt * scale;
        let steps = 0;
        const maxSteps = 24 * this.debugSpeed;
        while (this.acc >= SIM_DT && steps < maxSteps) { this.tick(SIM_DT); this.acc -= SIM_DT; steps++; }
        if (steps >= maxSteps) this.acc = 0;
        this.effects.update(dt * scale);
        this.arena.update(dt * scale);
        this.rig.update(dt, this.fighters);
        this.cameraForward = this.rig.forward;
        this.cameraRight = this.rig.right;
        if (this.ringRadius < 30) this.arena.setFireRing(this.ringRadius);
        if (this.online === 'host') this.net?.afterFrame(dt);
        if (this.mode === 'match') this.updateHud(dt, this.online ? !!this.localFighter && !this.localFighter.alive : anyHuman && !humansAlive);
      }
      if (noRender) return;
      this.renderer.render(this.scene, this.rig.camera);
      this.adaptQuality(dt);
    } catch (err) {
      this.errors++;
      console.error('[game] frame error', err);
      if (this.errors > 30) { this.renderer.setAnimationLoop(null); document.getElementById('fatal').hidden = false; }
    }
  }

  updateHud(dt, spectating) {
    if (this.phase === 'fight' || this.phase === 'roundOver') {
      const sd = this.setup.suddenDeath;
      if (sd > 0) {
        const left = Math.max(0, sd - this.fightTime);
        this.hud.setTimer(this.suddenDeath ? '∞' : String(Math.ceil(left)), !this.suddenDeath && left < 10);
      } else this.hud.setTimer('');
    }
    this.hintUntil -= dt;
    if (spectating && this.phase === 'fight') this.hud.setHints([this.online ? 'You are out. Watch who takes the round.' : 'You are out. Hold <kbd>X</kbd> to fast-forward.']);
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
      fighters: this.fighters.map((f) => ({ name: f.name, hp: Math.round(f.hp), alive: f.alive, wins: f.stats.wins, kos: f.stats.kos, state: f.state })),
      drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
    };
  }
}

function flashScreen() {
  const el = document.getElementById('flash');
  if (!el) return;
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
}

export { PLAYER_COLORS };
