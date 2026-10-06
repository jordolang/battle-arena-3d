// Online play. One browser hosts: it runs the only real simulation, with remote
// players steering their fighters through NetControllers and CPUs filling the
// empty seats. Every other browser sends its keyboard input to the host and draws
// the match from the host's snapshots, slightly in the past so motion stays smooth.
// Visual effects, announcer lines and gameplay events are replayed on the same
// timeline, so a client also hears every `events` emit the audio pass listens to.
import { ROSTER, MOVES, SKILLS, SKILL_IDS, TEAM_COUNTS, TEAM_DEFAULT_NAMES, cleanTeamName } from '../config.js';
import { AIController } from '../ai.js';
import { OnlineKeyboardController, NetController, NET_TAPS } from '../input.js';
import { Projectile } from '../specials.js';
import { events } from '../events.js';
import { createTransport, TransportError } from './transport.js';

export const PROTOCOL = 4;
export const MAX_PLAYERS = 8;
export const ONLINE_COLORS = ['#ff6b3d', '#3db8ff', '#7dff6b', '#ffd23d', '#ff6bd5', '#b38bff', '#4ff0d8', '#f2f2f2'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SNAP_HZ = 30;
const INPUT_HZ = 60;
const INTERP_DELAY = 0.1;     // seconds a client draws behind the host
const PEER_TIMEOUT = 10000;   // ms without any message before the host drops a player

const STATES = ['idle', 'attack', 'special', 'block', 'blockstun', 'hitstun', 'guardbreak', 'frozen', 'knockdown', 'getup', 'victory', 'ko', 'dodge', 'skill'];
const PHASES = ['idle', 'intro', 'fight', 'roundOver', 'matchOver'];
const MOVE_NAMES = Object.keys(MOVES);
const PROJECTILES = {
  fireball: { color: 0xff7a1c, glow: 0xff5a00 },
  spear: { color: 0xc0c4cc },
};
for (const id of SKILL_IDS) if (SKILLS[id].type === 'bolt') PROJECTILES[id] = { color: SKILLS[id].color, glow: SKILLS[id].glow, size: SKILLS[id].size };
const PROJ_KINDS = Object.keys(PROJECTILES);
const FX = ['sparks', 'impact', 'dust', 'puff', 'streak', 'ring', 'cone', 'telegraph', 'lightning'];
const SYNC_EVENTS = ['hit', 'block', 'guardBreak', 'ko', 'swing', 'specialStart', 'special', 'specialFail', 'thunder',
  'spearPull', 'jump', 'land', 'wallHit', 'roundStart', 'fight', 'suddenDeath', 'roundEnd', 'matchEnd',
  'skillStart', 'skill', 'skillFail', 'dodge', 'dodgeFail', 'exhausted', 'shieldBreak', 'backstab', 'parry', 'revive', 'pickup'];
const SETTINGS_KEY = 'battle-arena.online.v1';

const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Fighter';
}
export function randomCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}
export function cleanCode(s) {
  return String(s ?? '').toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 5);
}
export function loadOnlineSettings() {
  try { return { name: '', fighter: -1, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { name: '', fighter: -1 }; }
}
export function saveOnlineSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ name: s.name, fighter: s.fighter })); } catch { /* storage unavailable */ }
}

// Fighters inside event payloads travel as slot numbers.
function packPayload(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'slot' in v && v.model) out[k] = { $f: v.slot };
    else if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out[k] = v;
  }
  return out;
}

// The kill feed arrives as HTML from the host; keep only bold names, colours and spans.
function cleanFeed(html) {
  const doc = new DOMParser().parseFromString(`<div>${String(html)}</div>`, 'text/html');
  const walk = (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out += n.textContent.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      else if (n.nodeType === 1 && (n.tagName === 'B' || n.tagName === 'SPAN')) {
        const tag = n.tagName.toLowerCase();
        const color = /^#[0-9a-f]{6}$/i.test((n.style.color && rgbToHex(n.style.color)) || '') ? rgbToHex(n.style.color) : '';
        const cls = n.classList.contains('fire') ? ' class="fire"' : '';
        out += `<${tag}${cls}${color ? ` style="color:${color}"` : ''}>${walk(n)}</${tag}>`;
      }
    }
    return out;
  };
  return walk(doc.body.firstChild);
}
function rgbToHex(c) {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
  if (!m) return /^#[0-9a-f]{6}$/i.test(c) ? c : '';
  return '#' + m.slice(1, 4).map((x) => (+x).toString(16).padStart(2, '0')).join('');
}

export class NetSession {
  constructor({ game, menus, keyboard, bindings }) {
    this.game = game;
    this.menus = menus;
    this.keyboard = keyboard;
    this.bindings = bindings;
    this.role = null;          // 'host' | 'client' while connected
    this.transport = null;
    this.lobby = null;         // { code, rules, members, inMatch }
    this.myId = null;
    this.settings = loadOnlineSettings();
    this.onLobby = () => {};   // UI hooks, set by the online menus
    this.onMatchStart = () => {};
    this.onLeft = () => {};
    this.unhook = [];
  }

  get connected() { return !!this.role; }
  get isHost() { return this.role === 'host'; }

  // ---------------------------------------------------------------- hosting
  async host() {
    this.leave(null, true);
    const transport = createTransport();
    let code = null;
    for (let attempt = 0; attempt < 4 && !code; attempt++) {
      const c = randomCode();
      try { await transport.host(c); code = c; } catch (err) { if (err.kind !== 'taken') throw err; }
    }
    if (!code) throw new TransportError('taken', 'Could not find a free room code. Try again.');
    this.transport = transport;
    this.role = 'host';
    this.myId = 'host';
    this.heard = new Map();
    this.lobby = {
      code, inMatch: false,
      rules: { count: 4, winsNeeded: 2, difficulty: 'normal', suddenDeath: 75, teams: 0, teamNames: [...TEAM_DEFAULT_NAMES] },
      members: [{ id: 'host', name: cleanName(this.settings.name), fighter: this.settings.fighter, color: 0, team: 0 }],
    };
    transport.onMessage = (id, msg, ch) => this.hostReceive(id, msg, ch);
    transport.onPeerJoin = (id) => { this.heard.set(id, performance.now()); };
    transport.onPeerLeave = (id) => this.dropPeer(id, 'left');
    this.pingTimer = setInterval(() => this.hostHousekeeping(), 1000);
    this.onLobby();
    return code;
  }

  hostReceive(id, msg, ch) {
    if (!this.lobby) return;
    this.heard.set(id, performance.now());
    const member = this.lobby.members.find((m) => m.id === id);
    switch (msg.t) {
      case 'hello': {
        if (member) return;
        if (msg.v !== PROTOCOL) { this.reject(id, 'That room runs a different version of the game. Both players need the same file.'); return; }
        if (this.lobby.members.length >= MAX_PLAYERS) { this.reject(id, 'That room is full (8 players).'); return; }
        const used = new Set(this.lobby.members.map((m) => m.color));
        const color = [...ONLINE_COLORS.keys()].find((c) => !used.has(c)) ?? 0;
        const fighter = Number.isInteger(msg.fighter) && msg.fighter >= -1 && msg.fighter < ROSTER.length ? msg.fighter : -1;
        let name = cleanName(msg.name);
        const names = new Set(this.lobby.members.map((m) => m.name.toLowerCase()));
        for (let n = 2; names.has(name.toLowerCase()); n++) name = `${cleanName(msg.name).slice(0, 13)} ${n}`;
        this.lobby.members.push({ id, name, fighter, color, team: this.smallestTeam() });
        this.lobby.rules.count = Math.max(this.lobby.rules.count, this.lobby.members.length);
        this.transport.send(id, { t: 'welcome', id, lobby: this.lobby });
        if (this.lobby.inMatch) this.transport.send(id, { t: 'start', spec: this.spec, you: -1 });
        this.broadcastLobby();
        if (this.lobby.inMatch) this.game.hud.feed(`<b style="color:${ONLINE_COLORS[color]}">${escHtml(name)}</b> <span>joined and fights next match</span>`);
        break;
      }
      case 'pick':
        if (member && Number.isInteger(msg.fighter) && msg.fighter >= -1 && msg.fighter < ROSTER.length) {
          member.fighter = msg.fighter;
          this.broadcastLobby();
        }
        break;
      case 'team':
        if (member && Number.isInteger(msg.team) && msg.team >= 0 && msg.team < 4) {
          member.team = msg.team % Math.max(2, this.lobby.rules.teams);
          this.broadcastLobby();
        }
        break;
      case 'in':
        this.controllers?.get(id)?.receive(msg, performance.now());
        break;
      case 'bye':
        this.dropPeer(id, 'left');
        break;
    }
  }

  reject(id, reason) {
    this.transport.send(id, { t: 'reject', reason });
    this.transport.kick(id);
  }

  hostHousekeeping() {
    const now = performance.now();
    for (const [id, t] of this.heard) if (now - t > PEER_TIMEOUT) this.dropPeer(id, 'timed out');
    if (!this.lobby.inMatch) this.transport.broadcast({ t: 'ping' });
  }

  dropPeer(id, why) {
    this.heard.delete(id);
    this.transport?.kick(id);
    const i = this.lobby.members.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [m] = this.lobby.members.splice(i, 1);
    if (this.lobby.inMatch) {
      // a CPU takes the seat so the match carries on
      const slot = this.spec.fighters.findIndex((f) => f.owner === id);
      const f = this.game.fighters[slot];
      if (f) {
        f.controller = new AIController(this.lobby.rules.difficulty);
        this.spec.fighters[slot].owner = null;
      }
      this.controllers?.delete(id);
      this.game.hud.feed(`<b style="color:${ONLINE_COLORS[m.color]}">${escHtml(m.name)}</b> <span>${why === 'left' ? 'left' : 'lost connection'}, a CPU takes over</span>`);
    }
    this.broadcastLobby();
  }

  broadcastLobby(extra = {}) {
    this.transport.broadcast({ t: 'lobby', lobby: this.lobby, ...extra });
    this.onLobby();
  }

  setRule(key, d) {
    const r = this.lobby.rules;
    const cyc = (arr, v) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
    if (key === 'count') r.count = Math.min(MAX_PLAYERS, Math.max(Math.max(2, this.lobby.members.length), r.count + d));
    if (key === 'wins') r.winsNeeded = Math.min(5, Math.max(1, r.winsNeeded + d));
    if (key === 'diff') r.difficulty = cyc(['easy', 'normal', 'hard', 'brutal'], r.difficulty);
    if (key === 'sudden') r.suddenDeath = cyc([0, 45, 60, 75, 90, 120], r.suddenDeath);
    if (key === 'teams') {
      r.teams = cyc(TEAM_COUNTS, r.teams);
      if (r.teams) this.lobby.members.forEach((m, i) => { if (!(m.team < r.teams)) m.team = i % r.teams; });
    }
    this.broadcastLobby();
  }

  // Team with the fewest people in the lobby (where a newcomer or a CPU goes).
  smallestTeam(extra = []) {
    const n = Math.max(2, this.lobby.rules.teams || 2);
    const sizes = Array(n).fill(0);
    for (const m of [...this.lobby.members, ...extra]) if (m.team >= 0) sizes[m.team % n]++;
    return sizes.indexOf(Math.min(...sizes));
  }

  setTeamName(i, name, final) {
    if (!this.isHost) return;
    this.lobby.rules.teamNames[i] = final ? cleanTeamName(name, i) : String(name).slice(0, 18);
    this.broadcastLobby();
  }

  pickTeam(d) {
    const n = Math.max(2, this.lobby?.rules.teams || 2);
    const me = this.lobby?.members.find((m) => m.id === this.myId);
    if (!me) return;
    me.team = (((me.team || 0) % n) + d + n) % n;
    if (this.isHost) this.broadcastLobby();
    else { this.transport.sendHost({ t: 'team', team: me.team }); this.onLobby(); }
  }

  pickFighter(d) {
    const n = ROSTER.length;
    const cur = this.settings.fighter;
    this.settings.fighter = ((cur + 1 + d + n + 1) % (n + 1)) - 1; // -1 = random
    saveOnlineSettings(this.settings);
    if (this.isHost) {
      this.lobby.members[0].fighter = this.settings.fighter;
      this.broadcastLobby();
    } else if (this.role === 'client') {
      const me = this.lobby?.members.find((m) => m.id === this.myId);
      if (me) me.fighter = this.settings.fighter;
      this.transport.sendHost({ t: 'pick', fighter: this.settings.fighter });
      this.onLobby();
    }
  }

  startMatch() {
    if (!this.isHost) return;
    const { rules, members } = this.lobby;
    const count = Math.max(rules.count, members.length, 2);
    const pick = (f) => (f >= 0 ? f : Math.floor(Math.random() * ROSTER.length));
    const tc = rules.teams || 0;
    const fighters = members.map((m) => ({ def: pick(m.fighter), pname: m.name, color: ONLINE_COLORS[m.color], owner: m.id, team: tc ? m.team % tc : -1 }));
    while (fighters.length < count) {
      const cpu = { def: pick(-1), pname: null, color: null, owner: null, team: -1 };
      if (tc) {
        const sizes = Array(tc).fill(0);
        for (const f of fighters) sizes[f.team]++;
        cpu.team = sizes.indexOf(Math.min(...sizes));
      }
      fighters.push(cpu);
    }
    const teams = { count: tc, names: rules.teamNames.slice(0, tc).map((n, i) => cleanTeamName(n, i)) };
    this.spec = { setup: { winsNeeded: rules.winsNeeded, suddenDeath: rules.suddenDeath, difficulty: rules.difficulty, teams }, fighters };
    this.controllers = new Map();
    const ctrls = fighters.map((f) => {
      if (f.owner === 'host') return new OnlineKeyboardController(this.keyboard, this.bindings, () => !!this.menus.active);
      if (f.owner) { const c = new NetController(fighters.indexOf(f)); this.controllers.set(f.owner, c); return c; }
      return new AIController(rules.difficulty);
    });
    this.unhookAll();
    this.game.net = this;
    this.menus.hideAll();
    this.installHostHooks();
    this.game.startOnline(this.spec, 'host', ctrls, 0, this.bindings);
    this.lobby.inMatch = true;
    this.snapAcc = 1;
    this.snapSeq = 0;
    for (const m of members) if (m.id !== 'host') this.transport.send(m.id, { t: 'start', spec: this.spec, you: fighters.findIndex((f) => f.owner === m.id) });
    this.broadcastLobby();
    this.onMatchStart();
  }

  // Back to the lobby after a match (or from the results screen).
  backToLobby() {
    if (!this.isHost) return;
    this.endMatchLocally();
    this.lobby.inMatch = false;
    this.broadcastLobby({ back: true });
  }

  // Record everything the simulation shows or says so clients can replay it.
  installHostHooks() {
    const g = this.game;
    this.fx = [];
    const wrap = (obj, name, tag) => {
      const orig = obj[name];
      obj[name] = (...args) => { this.fx.push([tag, name, args]); return orig.apply(obj, args); };
      this.unhook.push(() => { delete obj[name]; });
    };
    for (const name of FX) wrap(g.effects, name, 'e');
    wrap(g.rig, 'shake', 's');
    wrap(g.hud, 'announce', 'a');
    wrap(g.hud, 'feed', 'f');
    for (const name of SYNC_EVENTS) {
      this.unhook.push(events.on(name, (data) => { if (g.online === 'host') this.fx.push(['v', name, [packPayload(data)]]); }));
    }
  }

  unhookAll() {
    for (const fn of this.unhook.splice(0)) fn();
  }

  afterFrame(dt) {
    if (!this.lobby?.inMatch) return;
    const ht = performance.now() / 1000;
    if (this.fx.length) {
      this.transport.broadcast({ t: 'fx', ht, l: this.fx });
      this.fx = [];
    }
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAP_HZ) {
      this.snapAcc = 0;
      this.transport.broadcast(this.snapshot(ht), 'rt');
    }
  }

  snapshot(ht) {
    const g = this.game;
    return {
      t: 'snap', n: ++this.snapSeq, ht,
      ph: PHASES.indexOf(g.phase), r: g.round, ft: r2(g.fightTime), rr: r2(g.ringRadius), sd: g.suddenDeath ? 1 : 0,
      w: g.phase === 'roundOver' && g.roundWinner ? g.roundWinner.slot : -1,
      f: g.fighters.map((f) => [
        r2(f.pos.x), r2(f.pos.y), r2(f.pos.z), r2(f.facing), STATES.indexOf(f.state), r2(f.stateTime), r2(f.stateDuration),
        r2(f.hp), Math.round(f.energy),
        (f.alive ? 1 : 0) | (f.grounded ? 2 : 0) | (f.model.ice.visible ? 4 : 0) | (f.armor > 0 ? 8 : 0) | (f.hitstop > 0 ? 16 : 0),
        f.moveName ? MOVE_NAMES.indexOf(f.moveName) : -1, r2(f.attackPhase), f.attackSide, r2(f.specialPhase),
        r2(f.moveAmount), r2(f.runPhase), r2(Math.max(0, f.invuln)), f.stats.wins, f.stats.kos, Math.round(f.stats.damage),
        Math.round(f.stamina), r2(f.cooldowns[0]), r2(f.cooldowns[1]), Math.round(f.shield), f.skillId ? SKILL_IDS.indexOf(f.skillId) : -1,
        (f.armor > 0 || f.power > 0 || f.lifesteal > 0 ? 1 : 0) | (f.vanish > 0 ? 2 : 0) | (f.exhausted ? 4 : 0) | (f.haste > 0 ? 8 : 0) | (f.slow > 0 ? 16 : 0) | (f.sprinting ? 32 : 0),
        r2(f.cooldowns[2]), r2(f.downed), r2(f.reviveProgress), f.maxHp,
      ]),
      pu: g.pickups.state(),
      p: g.projectiles.filter((p) => !p.dead).map((p) => [p.id, PROJ_KINDS.indexOf(p.kind), r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.dir.x), r2(p.dir.z), p.owner.slot]),
    };
  }

  // ---------------------------------------------------------------- joining
  async join(code) {
    this.leave(null, true);
    const transport = createTransport();
    await transport.join(code);
    this.transport = transport;
    this.role = 'client';
    const welcome = new Promise((resolve, reject) => {
      this.pendingJoin = { resolve, reject };
      setTimeout(() => reject(new TransportError('timeout', 'The host did not let us in. Try again.')), 10000);
    });
    transport.onMessage = (id, msg) => this.clientReceive(msg);
    transport.onHostLost = () => this.leave('Lost the connection to the host.');
    transport.sendHost({ t: 'hello', v: PROTOCOL, name: cleanName(this.settings.name), fighter: this.settings.fighter });
    this.hostHeard = performance.now();
    this.pingTimer = setInterval(() => {
      transport.sendHost({ t: 'ping' });
      if (performance.now() - this.hostHeard > PEER_TIMEOUT) this.leave('Lost the connection to the host.');
    }, 2000);
    try {
      await welcome;
    } catch (err) {
      this.leave(null, true);
      throw err;
    } finally {
      this.pendingJoin = null;
    }
  }

  clientReceive(msg) {
    this.hostHeard = performance.now();
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.id;
        this.lobby = msg.lobby;
        this.pendingJoin?.resolve();
        this.onLobby();
        break;
      case 'reject':
        if (this.pendingJoin) this.pendingJoin.reject(new TransportError('rejected', msg.reason || 'The host turned us away.'));
        else this.leave(msg.reason);
        break;
      case 'lobby':
        if (!msg.lobby) return;
        this.lobby = msg.lobby;
        if (msg.back && this.game.online === 'client') this.endMatchLocally();
        this.onLobby(msg.back);
        break;
      case 'start':
        this.clientStart(msg.spec, msg.you);
        break;
      case 'snap':
        this.receiveSnap(msg);
        break;
      case 'fx':
        if (Array.isArray(msg.l)) for (const item of msg.l) this.fxQueue?.push({ ht: msg.ht, item });
        break;
      case 'bye':
        this.leave('The host closed the room.');
        break;
    }
  }

  clientStart(spec, you) {
    if (!spec?.fighters?.length) return;
    this.endMatchLocally();
    this.spec = spec;
    this.snaps = [];
    this.fxQueue = [];
    this.lastSeq = 0;
    this.clockOffset = null;
    this.lastRound = -1;
    this.lastPhase = -1;
    this.clientProjectiles = new Map();
    this.input = { ctl: new OnlineKeyboardController(this.keyboard, this.bindings, () => !!this.menus.active), counts: NET_TAPS.map(() => 0), seq: 0, acc: 1 };
    this.game.net = this;
    this.menus.hideAll();
    this.game.startOnline(spec, 'client', null, you, this.bindings);
    this.onMatchStart();
  }

  receiveSnap(s) {
    if (!this.snaps || !(s.n > this.lastSeq) || !Array.isArray(s.f) || s.f.length !== this.game.fighters.length) return;
    this.lastSeq = s.n;
    const now = performance.now() / 1000;
    const offset = s.ht - now;
    // track the fastest-arriving packets; drift slowly so the clock follows the host
    if (this.clockOffset === null || offset > this.clockOffset) this.clockOffset = offset;
    else this.clockOffset += (offset - this.clockOffset) * 0.01;
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.splice(0, this.snaps.length - 40);
  }

  clientStep(dt) {
    const g = this.game;
    g.time += dt;
    this.sendInput(dt);
    if (!this.snaps?.length) { for (const f of g.fighters) f.syncVisual(0); return; }
    const renderT = performance.now() / 1000 + this.clockOffset - INTERP_DELAY;
    let a = this.snaps[0], b = a;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].ht <= renderT) { a = this.snaps[i]; b = this.snaps[i + 1] || a; break; }
    }
    if (this.snaps.length > 2) this.snaps.splice(0, Math.max(0, this.snaps.indexOf(a) - 1));
    const t = b === a ? 0 : Math.min(1, Math.max(0, (renderT - a.ht) / (b.ht - a.ht)));
    this.applySnap(a, b, t, dt);
    // effects and events whose moment has come
    while (this.fxQueue.length && this.fxQueue[0].ht <= renderT + 0.001) this.playFx(this.fxQueue.shift().item);
    if (this.fxQueue.length > 400) for (const q of this.fxQueue.splice(0, this.fxQueue.length - 400)) this.playFx(q.item);
  }

  sendInput(dt) {
    const me = this.game.localFighter;
    if (!me) return;
    const inp = this.input;
    const it = inp.ctl.getIntent(me, this.game);
    let tapped = false;
    NET_TAPS.forEach((a, i) => { if (it[a]) { inp.counts[i]++; tapped = true; } });
    inp.acc += dt;
    if (!tapped && inp.acc < 1 / INPUT_HZ) return;
    inp.acc = 0;
    this.transport.sendHost({ t: 'in', s: ++inp.seq, mx: r2(it.mx), mz: r2(it.mz), b: it.block ? 1 : 0, d: it.dashHeld ? 1 : 0, c: inp.counts }, 'rt');
  }

  applySnap(a, b, t, dt) {
    const g = this.game;
    const ph = PHASES[a.ph] || 'fight';
    if (a.r !== this.lastRound) {
      this.lastRound = a.r;
      g.arena.resetFireRing();
      g.rig.mode = 'fight';
      g.rig.winner = null;
    }
    g.phase = ph;
    g.round = a.r;
    g.fightTime = lerp(num(a.ft), num(b.ft), t);
    g.ringRadius = lerp(num(a.rr, 99), num(b.rr, 99), t);
    g.suddenDeath = !!a.sd;
    if (ph === 'roundOver' && g.rig.mode !== 'winner') {
      g.rig.mode = 'winner';
      g.rig.winner = g.fighters[a.w] || null;
      g.rig.orbitAngle = g.rig.yaw;
    }
    g.fighters.forEach((f, i) => {
      const fa = a.f[i], fb = b.f[i] || fa;
      if (!fa) return;
      const sameState = fa[4] === fb[4];
      f.animTime += dt;
      f.pos.set(lerp(fa[0], fb[0], t), lerp(fa[1], fb[1], t), lerp(fa[2], fb[2], t));
      f.facing = lerpAngle(fa[3], fb[3], t);
      f.state = STATES[fa[4]] || 'idle';
      f.stateTime = sameState ? lerp(fa[5], fb[5], t) : fa[5];
      f.stateDuration = fa[6];
      f.hp = sameState ? lerp(fa[7], fb[7], t) : fa[7];
      f.energy = fa[8];
      const flags = fa[9];
      f.alive = !!(flags & 1);
      f.grounded = !!(flags & 2);
      f.model.ice.visible = !!(flags & 4);
      f.armor = flags & 8 ? 1 : 0;
      f.moveName = MOVE_NAMES[fa[10]] || null;
      f.move = f.moveName ? MOVES[f.moveName] : null;
      f.attackPhase = sameState && fa[10] === fb[10] ? lerp(fa[11], fb[11], t) : fa[11];
      f.attackSide = fa[12];
      f.specialPhase = sameState ? lerp(fa[13], fb[13], t) : fa[13];
      f.moveAmount = lerp(fa[14], fb[14], t);
      f.runPhase = fb[15] >= fa[15] ? lerp(fa[15], fb[15], t) : fb[15];
      f.invuln = fa[16];
      f.stats.wins = fa[17]; f.stats.kos = fa[18]; f.stats.damage = fa[19];
      f.stamina = lerp(num(fa[20], 100), num(fb[20], 100), t);
      f.cooldowns[0] = num(fa[21]); f.cooldowns[1] = num(fa[22]); f.cooldowns[2] = num(fa[26]);
      f.shield = num(fa[23]);
      f.skillId = SKILL_IDS[fa[24]] || null;
      f.skill = f.skillId ? SKILLS[f.skillId] : null;
      const buffs = num(fa[25]);
      f.power = buffs & 1 ? 1 : 0;
      f.vanish = buffs & 2 ? 1 : 0;
      f.exhausted = !!(buffs & 4);
      f.haste = buffs & 8 ? 1 : 0;
      f.slow = buffs & 16 ? 1 : 0;
      f.sprinting = !!(buffs & 32);
      f.downed = num(fa[27]);
      f.reviveProgress = num(fa[28]);
      if (fa[29] > 0) f.maxHp = fa[29];
      if (f.alive) f.model.ring.visible = true;
      f.updateBuffVisuals();
      f.syncVisual(flags & 16 ? 0 : dt);
    });
    g.pickups.applyState(a.pu);
    // projectiles: create, move and retire to match the host
    const live = new Set();
    const prev = new Map((a.p || []).map((p) => [p[0], p]));
    for (const p of b.p || []) {
      const [id, kindIdx, x, y, z, dx, dz, owner] = p;
      live.add(id);
      let proj = this.clientProjectiles.get(id);
      if (!proj) {
        const kind = PROJ_KINDS[kindIdx];
        const style = PROJECTILES[kind];
        const ownerF = g.fighters[owner];
        if (!style || !ownerF) continue;
        proj = new Projectile(g, ownerF, { kind, x, y, z, dx, dz, speed: 0, life: Infinity, radius: 0, color: style.color, glow: style.glow, size: style.size, hit: null });
        this.clientProjectiles.set(id, proj);
      }
      const q = prev.get(id) || p;
      proj.pos.set(lerp(q[2], x, t), lerp(q[3], y, t), lerp(q[4], z, t));
      proj.visual(dt, g);
    }
    for (const [id, proj] of this.clientProjectiles) if (!live.has(id)) { proj.dispose(g); this.clientProjectiles.delete(id); }
  }

  playFx(item) {
    const g = this.game;
    if (!Array.isArray(item)) return;
    const [tag, name, args = []] = item;
    try {
      if (tag === 'e' && FX.includes(name)) {
        const r = g.effects[name](...args);
        if (name === 'telegraph' && r) setTimeout(() => { r.done = true; }, num(args[4], 0.5) * 1000);
      } else if (tag === 's') g.rig.shake(num(args[0]));
      else if (tag === 'a') g.hud.announce(String(args[0] ?? ''), String(args[1] ?? '').replace(/[^a-z ]/gi, ''), num(args[2], 1400));
      else if (tag === 'f') g.hud.feed(cleanFeed(args[0]));
      else if (tag === 'v' && SYNC_EVENTS.includes(name)) {
        const data = {};
        for (const [k, v] of Object.entries(args[0] || {})) data[k] = v && typeof v === 'object' ? (g.fighters[v.$f] || null) : v;
        if (name === 'roundStart' || name === 'matchEnd') data.fighters = g.fighters;
        events.emit(name, data);
        if (name === 'matchEnd' && data.winner) {
          g.phase = 'matchOver';
          g.onMatchEnd?.(data.winner, g.fighters);
        }
      }
    } catch (err) { console.warn('[net] could not replay', item, err); }
  }

  // ---------------------------------------------------------------- shared
  endMatchLocally() {
    this.unhookAll();
    if (this.clientProjectiles) { for (const p of this.clientProjectiles.values()) p.dispose(this.game); this.clientProjectiles.clear(); }
    this.snaps = null;
    this.fxQueue = null;
    this.controllers = null;
    if (this.game.online) {
      this.game.keyboard.captureGameKeys = false;
      this.game.hud.show(false);
      this.game.startDemo();
    }
  }

  // Leave the room. `reason` is shown to the player; `quiet` skips the UI callback.
  leave(reason = null, quiet = false) {
    if (!this.role) return;
    try {
      if (this.isHost) this.transport.broadcast({ t: 'bye' });
      else this.transport.sendHost({ t: 'bye' });
    } catch { /* already gone */ }
    clearInterval(this.pingTimer);
    const transport = this.transport;
    if (transport) transport.onMessage = transport.onPeerJoin = transport.onPeerLeave = transport.onHostLost = () => {};
    setTimeout(() => transport?.close(), 200);
    this.endMatchLocally();
    this.role = null;
    this.transport = null;
    this.lobby = null;
    this.myId = null;
    this.game.net = null;
    if (!quiet) this.onLeft(reason);
  }
}

function escHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
