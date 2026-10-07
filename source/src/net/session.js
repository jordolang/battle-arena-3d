// Online play. One browser hosts: it runs the only real simulation, with remote
// players steering their fighters through NetControllers and CPUs filling the
// empty seats. Every other browser sends its keyboard input to the host and draws
// the match from the host's snapshots, slightly in the past so motion stays smooth.
// Visual effects, announcer lines and gameplay events are replayed on the same
// timeline, so a client also hears every `events` emit the audio pass listens to.
// A guest's own fighter runs ahead on its own machine (predict.js), and when the
// host leaves a room or a queue battle, another player takes over hosting from the
// last snapshot and everyone else reconnects to them (migrate()).
import { wardrobe, sanitizeLook, randomLook } from '../cosmetics.js';
import { SIM_DT, ROSTER, MOVES, SKILLS, SKILL_IDS, WEAPON_IDS, TEAM_COUNTS, TEAM_DEFAULT_NAMES, ARENA_CHOICES, cleanTeamName, pickArena } from '../config.js';
import { AIController } from '../ai.js';
import { OnlineKeyboardController, NetController, NET_TAPS } from '../input.js';
import { Projectile } from '../specials.js';
import { events } from '../events.js';
import { createTransport, createBeacon, TransportError } from './transport.js';
import { Predictor } from './predict.js';
import { EMOTE_IDS, ChatGate, cleanChat } from '../social.js';
import { cleanTier } from '../fundraiser.js';
import { teamsOf, seedBracket, nextMatch, recordWinner, champion, roundName, groupKey, cleanGroup, cleanText, findFundraiser, isFundraiserCode, verifyFundraiserCode } from './tournament.js';

export const PROTOCOL = 11;
export const MAX_PLAYERS = 8;
export const MAX_TOURNAMENT = 32;  // fighters and spectators in one tournament room
export const QUEUE_SECONDS = 30;
// The online queues. Each has its own well-known beacon, so players only meet others who picked the same one.
//   brawl   free-for-all, up to 8, CPUs fill to 4
//   hill    king of the hill, free-for-all, up to 8, CPUs fill to 4
//   duo     2v2: two teams of two, CPUs fill empty places
//   ranked  1v1 for rating: exactly two players, no CPUs; the fight starts as soon as an opponent is found
export const QUEUES = {
  brawl:  { beacon: 'queue', label: 'Free-for-all', max: MAX_PLAYERS, fill: 4, mode: 'queue', teams: 0, wins: 2, sudden: 75 },
  hill:   { beacon: 'hill', label: 'King of the hill', max: MAX_PLAYERS, fill: 4, mode: 'hill', teams: 0, wins: 2, sudden: 0 },
  duo:    { beacon: 'duo', label: '2v2', max: 4, fill: 4, mode: 'duo', teams: 2, wins: 2, sudden: 75 },
  ranked: { beacon: 'ranked', label: 'Ranked 1v1', max: 2, fill: 2, mode: 'ranked', teams: 0, wins: 2, sudden: 60, rated: true },
};
const RANKED_LEAD = 5; // seconds between finding an opponent and the ranked fight starting
const CHAT_KEEP = 80;
export const ONLINE_COLORS = ['#ff6b3d', '#3db8ff', '#7dff6b', '#ffd23d', '#ff6bd5', '#b38bff', '#4ff0d8', '#f2f2f2'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SNAP_HZ = 30;
const INPUT_HZ = 60;
const INTERP_DELAY = 0.1;     // seconds a client draws behind the host
const PEER_TIMEOUT = 10000;   // ms without any message before the host drops a player
const HOST_TIMEOUT = 4000;    // ms without a snapshot mid-match before a guest gives the host up
const RETURN_GRACE = 7000;    // ms the other players get to reconnect to a new host
const DEEP_EVERY = 15;        // every 15th snapshot also carries the timers a new host would need

export const STATES = ['idle', 'attack', 'special', 'block', 'blockstun', 'hitstun', 'guardbreak', 'frozen', 'knockdown', 'getup', 'victory', 'ko', 'dodge', 'skill', 'emote'];
const PHASES = ['idle', 'intro', 'fight', 'roundOver', 'matchOver'];
const MOVE_NAMES = Object.keys(MOVES);
const PROJECTILES = {
  fireball: { color: 0xff7a1c, glow: 0xff5a00 },
  spear: { color: 0xc0c4cc },
};
for (const id of SKILL_IDS) if (SKILLS[id].type === 'bolt') PROJECTILES[id] = { color: SKILLS[id].color, glow: SKILLS[id].glow, size: SKILLS[id].size, stretch: SKILLS[id].stretch };
const PROJ_KINDS = Object.keys(PROJECTILES);
const FX = ['sparks', 'impact', 'dust', 'puff', 'streak', 'ring', 'cone', 'telegraph', 'lightning'];
const SYNC_EVENTS = ['hit', 'block', 'guardBreak', 'ko', 'swing', 'specialStart', 'special', 'specialFail', 'thunder',
  'spearPull', 'jump', 'land', 'wallHit', 'roundStart', 'fight', 'suddenDeath', 'roundEnd', 'matchEnd',
  'skillStart', 'skill', 'skillFail', 'dodge', 'dodgeFail', 'exhausted', 'shieldBreak', 'backstab', 'parry', 'revive', 'pickup',
  'weaponBreak', 'armorBreak', 'respawn', 'hillMove', 'hazard', 'emote', 'taunt'];
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
// A room code is five characters; a room that moved to a new host adds -1, -2… (see migrate()).
export function cleanCode(s) {
  const [base, moved] = String(s ?? '').toUpperCase().split('-');
  const code = base.split('').filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 5);
  const n = String(moved ?? '').replace(/\D/g, '').slice(0, 2);
  return moved !== undefined && code.length === 5 ? `${code}-${n}` : code;
}
export const isRoomCode = (code) => /^[A-Z2-9]{5}(-\d{1,2})?$/.test(code);
// Each player's saved looks by fighter id, as sent to the host: unknown fighters and items are dropped.
// (Ownership is not checked here yet; player profiles will vouch for it later.)
export function cleanLooks(map) {
  const out = {};
  if (map && typeof map === 'object') for (const def of ROSTER) if (map[def.id]) out[def.id] = sanitizeLook(map[def.id]);
  return out;
}
// What a lobby member wears on the roster fighter `index`.
const lookOf = (member, index) => sanitizeLook(member?.looks?.[ROSTER[index]?.id]);

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

// The group a fundraiser code made in the José Madrid Salsa admin panel belongs to, checked with the
// site. Resolves to { name } or { why } (shown to the player); `notCode` explains text that is no code.
export async function siteGroup(typed, notCode, tail) {
  if (!isFundraiserCode(typed)) return { why: notCode };
  try {
    const name = await verifyFundraiserCode(typed);
    if (name) return { name };
    return { why: `That fundraiser code is not registered. Check it with your organizer.${tail}` };
  } catch {
    return { why: `The José Madrid Salsa site could not check your fundraiser code just now. Try again in a moment.${tail}` };
  }
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
    this.fundraiserCode = '';  // the code from the title screen, sent when joining an online battle
    this.onLobby = () => {};   // UI hooks, set by the online menus
    this.onMatchStart = () => {};
    this.onLeft = () => {};
    this.onChat = () => {};
    this.onAccount = () => {}; // guests: seat tickets and recorded results from the host (account.js)
    this.onQuickChat = () => {}; // (fighter slot, line index) during a match (social.js)
    this.chatGate = new ChatGate();
    this.unhook = [];
    this.chat = [];
    this.beacon = null;
    // who you are on the José Madrid Salsa site, shown in ranked lobbies: { handle, rating }. main.js fills it in.
    this.identity = () => ({});
    // ?predict=0 turns off client-side prediction (for comparing, or if it ever misbehaves)
    this.noPredict = new URLSearchParams(location.search).get('predict') === '0';
  }

  get kind() { return this.lobby?.kind || null; }
  // which queue this lobby is ('brawl', 'hill', 'duo', 'ranked'), or null outside the queue
  get format() { return this.lobby?.kind === 'queue' ? this.lobby.format || 'brawl' : null; }
  get queueRules() { return QUEUES[this.format] || null; }
  get me() { return this.lobby?.members.find((m) => m.id === this.myId) || null; }

  get connected() { return !!this.role; }
  get isHost() { return this.role === 'host'; }

  // ---------------------------------------------------------------- hosting
  // kind: 'room' (a private room), 'queue' (the 30-second public queue) or 'tournament' (fixed `code`, the host is the admin)
  async host({ kind = 'room', code: fixed = null, tournament = null, keepBeacon = false, format = 'brawl' } = {}) {
    const beacon = keepBeacon ? this.beacon : null;
    if (beacon) this.beacon = null;
    this.leave(null, true);
    this.beacon = beacon;
    const transport = createTransport();
    let code = null;
    if (fixed) {
      try { await transport.host(fixed); code = fixed; } catch (err) {
        if (err.kind === 'taken') throw new TransportError('taken', `Tournament ${fixed} is already open, maybe in another tab or by someone else. Close it there or make a new code.`);
        throw err;
      }
    }
    for (let attempt = 0; attempt < 4 && !code; attempt++) {
      const c = randomCode();
      try { await transport.host(c); code = c; } catch (err) { if (err.kind !== 'taken') throw err; }
    }
    if (!code) throw new TransportError('taken', 'Could not find a free room code. Try again.');
    this.transport = transport;
    this.role = 'host';
    this.myId = 'host';
    this.heard = new Map();
    this.chat = [];
    this.chatAt = new Map();
    const admin = kind === 'tournament';
    this.fundraisers = [];
    this.pending = new Set(); // players whose fundraiser code is being checked
    this.lobby = {
      code, base: code, epoch: 0, kind, inMatch: false,
      rules: { count: 4, winsNeeded: 2, difficulty: 'normal', suddenDeath: 75, arena: 'random', teams: 0, teamNames: [...TEAM_DEFAULT_NAMES], mode: kind === 'tournament' ? 'tournament' : 'queue' },
      members: [{ id: 'host', name: cleanName(this.settings.name), fighter: this.settings.fighter, looks: wardrobe.allLooks(), color: 0, team: 0, role: admin ? 'admin' : 'player', group: '', reward: admin ? 0 : cleanTier(this.menus.rewardTier), ...this.identity() }],
    };
    if (kind === 'queue') {
      const Q = QUEUES[format] || QUEUES.brawl;
      this.lobby.format = QUEUES[format] ? format : 'brawl';
      Object.assign(this.lobby.rules, { mode: Q.mode, count: Q.fill, teams: Q.teams, winsNeeded: Q.wins, suddenDeath: Q.sudden });
      if (Q.teams) this.lobby.rules.teamNames = ['Red', 'Blue'];
      // ranked waits for an opponent however long it takes; the others count down
      this.lobby.queue = Q.rated ? { left: null, since: Date.now() } : { left: QUEUE_SECONDS, ends: performance.now() + QUEUE_SECONDS * 1000 };
    }
    if (admin) {
      this.lobby.tournament = {
        name: cleanText(tournament?.name, 48) || 'Tournament', startsAt: String(tournament?.startsAt || '').slice(0, 32),
        prize: cleanText(tournament?.prize, 160), teamSize: Math.min(4, Math.max(1, tournament?.teamSize | 0 || 3)),
        wins: Math.min(3, Math.max(1, tournament?.wins | 0 || 2)), fill: tournament?.fill !== false,
        status: 'open', bracket: null, current: null, champion: null, last: '',
        registration: tournament?.registration === 'open' ? 'open' : 'code',
      };
      // the admin's fundraiser codes stay here, out of the lobby every player receives
      this.fundraisers = tournament?.groups || [];
      this.systemChat(`${this.lobby.tournament.name} is open. Teams join with their ${this.lobby.tournament.registration === 'code' ? 'fundraiser code' : 'fundraising group'}; everyone else can watch.`);
    }
    this.listenAsHost(transport);
    this.onLobby();
    return code;
  }

  listenAsHost(transport) {
    transport.onMessage = (id, msg, ch) => this.hostReceive(id, msg, ch);
    transport.onPeerJoin = (id) => { this.heard.set(id, performance.now()); };
    transport.onPeerLeave = (id) => this.dropPeer(id, 'left');
    this.pingTimer = setInterval(() => this.hostHousekeeping(), 1000);
  }

  hostReceive(id, msg, ch) {
    if (!this.lobby) return;
    this.heard.set(id, performance.now());
    const member = this.lobby.members.find((m) => m.id === id);
    switch (msg.t) {
      case 'hello': {
        // a player of the room we took over (see migrate()) coming back: they were let in before
        if (msg.back && this.returning?.has(id) && member) { this.welcomeBack(id, member); return; }
        if (member || this.pending.has(id)) return;
        if (msg.v !== PROTOCOL) { this.reject(id, 'That room runs a different version of the game. Both players need the same file.'); return; }
        const tourney = this.kind === 'tournament';
        const closed = this.closedReason();
        if (closed) { this.reject(id, closed); return; }
        // in a tournament your fundraising group is your team; without one you can only watch.
        // When the admin requires fundraiser codes, fighters must bring one: it names their group.
        // Online battles (rooms and the queue) are for enrolled groups only: the site checks the code.
        const group = cleanGroup(msg.group);
        const check = !tourney ? siteGroup(msg.fc, 'Online play needs your fundraising group\'s code. Type the code your organizer gave you on the title screen.', '')
          : msg.role === 'player' && this.lobby.tournament.registration === 'code' ? this.registeredGroup(group) : null;
        if (check) {
          this.pending.add(id);
          check.then((reg) => {
            if (!this.pending.delete(id) || !this.lobby || this.lobby.members.some((m) => m.id === id)) return;
            // others may have filled the room, or the queue started, while the site was checking
            const full = this.closedReason();
            if (full) { this.reject(id, full); return; }
            if (reg.name) { this.admit(id, msg, cleanGroup(reg.name)); return; }
            this.reject(id, reg.why);
          });
          return;
        }
        this.admit(id, msg, group);
        break;
      }
      case 'pick':
        if (member && Number.isInteger(msg.fighter) && msg.fighter >= -1 && msg.fighter < ROSTER.length) {
          member.fighter = msg.fighter;
          if (msg.looks) member.looks = cleanLooks(msg.looks);
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
      case 'chat':
        if (member) this.hostChat(member, msg.x);
        break;
      case 'qc':
        this.hostQuickChat(id, msg.i);
        break;
      case 'bye':
        this.dropPeer(id, 'left');
        break;
    }
  }

  // Why nobody else can join right now, or null.
  closedReason() {
    if (this.kind === 'tournament') return this.lobby.members.length >= MAX_TOURNAMENT ? `That tournament is full (${MAX_TOURNAMENT} people).` : null;
    const max = this.queueRules?.max || MAX_PLAYERS;
    if (this.lobby.members.length >= max) return max === 2 ? 'That ranked fight already has two players.' : `That battle is full (${max} players).`;
    if (this.kind === 'queue' && (this.lobby.inMatch || (this.lobby.queue.left != null && this.lobby.queue.left <= 0))) return 'That battle already started.';
    return null;
  }

  // Let a player or watcher into the lobby. `group` is their checked fundraising group (tournaments only).
  admit(id, msg, group) {
    const tourney = this.kind === 'tournament';
    const used = new Set(this.lobby.members.map((m) => m.color));
    const color = [...ONLINE_COLORS.keys()].find((c) => !used.has(c)) ?? 0;
    const fighter = Number.isInteger(msg.fighter) && msg.fighter >= -1 && msg.fighter < ROSTER.length ? msg.fighter : -1;
    let name = cleanName(msg.name);
    const names = new Set(this.lobby.members.map((m) => m.name.toLowerCase()));
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${cleanName(msg.name).slice(0, 13)} ${n}`;
    const role = tourney ? (msg.role === 'player' && group ? 'player' : 'spectator') : 'player';
    // reward: the cosmetic their fundraising group earned by reaching its goal (fundraiser.js)
    this.lobby.members.push({ id, name, fighter, looks: cleanLooks(msg.looks), color, team: this.smallestTeam(), role, group: tourney ? group : '', reward: cleanTier(msg.reward), ...cleanIdentity(msg) });
    if (!tourney && !this.queueRules?.teams) this.lobby.rules.count = Math.max(this.lobby.rules.count, this.lobby.members.length);
    this.transport.send(id, { t: 'welcome', id, lobby: this.lobby });
    if (tourney) {
      this.transport.send(id, { t: 'chatlog', l: this.chat });
      this.systemChat(role === 'player' ? `${name} joined for ${group}.` : `${name} is watching.`);
    }
    if (this.lobby.inMatch) this.transport.send(id, { t: 'start', spec: this.spec, you: -1 });
    this.broadcastLobby();
    if (this.lobby.inMatch) this.game.hud.feed(`<b style="color:${ONLINE_COLORS[color]}">${escHtml(name)}</b> <span>joined and fights next match</span>`);
  }

  // The group a fundraiser code belongs to: the admin's own list first, then the codes made in the
  // José Madrid Salsa admin panel. Resolves to { name } or { why } (shown to the player).
  async registeredGroup(typed) {
    const local = findFundraiser(this.fundraisers, typed);
    if (local) return { name: local.name };
    return siteGroup(typed, 'This tournament needs your fundraiser code, not the group name. Type the code your organizer gave you on the title screen.', ' Or join to watch.');
  }

  reject(id, reason) {
    this.transport.send(id, { t: 'reject', reason });
    this.transport.kick(id);
  }

  hostHousekeeping() {
    const now = performance.now();
    // after our own tab stalled (loading a map, a busy machine) everyone's messages are still queued
    // behind this timer: give them a fresh window instead of dropping the whole room
    if (now - (this.lastHousekeeping ?? now) > 3000) for (const id of this.heard.keys()) this.heard.set(id, now);
    this.lastHousekeeping = now;
    for (const [id, t] of this.heard) if (now - t > PEER_TIMEOUT) this.dropPeer(id, 'timed out');
    if (!this.lobby.inMatch) this.transport.broadcast({ t: 'ping' });
    // the queue counts down, then everyone in it fights (also when the battle fills up)
    const q = this.lobby.queue;
    const Q = this.queueRules;
    if (q && !this.lobby.inMatch && Q?.rated) {
      // ranked: once an opponent is here, a short lead-in and the fight; if they leave first, keep searching
      const full = this.lobby.members.length >= Q.max;
      if (full && q.left == null) q.ends = now + RANKED_LEAD * 1000;
      if (!full) { q.left = null; this.broadcastLobby(); }
      else {
        q.left = Math.max(0, Math.ceil((q.ends - now) / 1000));
        if (q.left <= 0) { this.beacon?.release(); this.beacon = null; this.startMatch(); } else this.broadcastLobby();
      }
    } else if (q && !this.lobby.inMatch && q.left > 0) {
      q.left = Math.max(0, Math.ceil((q.ends - now) / 1000));
      if (this.lobby.members.length >= (Q?.max || MAX_PLAYERS)) q.left = 0;
      if (q.left <= 0) { this.beacon?.release(); this.beacon = null; this.startMatch(); } else this.broadcastLobby();
    }
  }

  // ---------------------------------------------------------------- the online queue
  // Joins the open queue, or opens one when nobody else has. Resolves to 'host' or 'client'.
  async queue(format = 'brawl') {
    this.leave(null, true);
    if (!QUEUES[format]) format = 'brawl';
    const name = `${QUEUES[format].beacon}-v${PROTOCOL}`;
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const beacon = createBeacon();
      try {
        await beacon.claim(name);
        this.beacon = beacon;
        try { await this.host({ kind: 'queue', keepBeacon: true, format }); } catch (err) { this.beacon?.release(); this.beacon = null; throw err; }
        beacon.info = () => ({ code: this.lobby?.code, left: this.lobby?.queue ? this.lobby.queue.left : 0 });
        return 'host';
      } catch (err) {
        if (err.kind !== 'taken') throw err;
      }
      try {
        const info = await beacon.ask(name);
        // (a ranked host still searching reports no countdown at all)
        if (info?.code && (info.left === null || info.left > 2)) { await this.join(info.code); return 'client'; }
        lastErr = new TransportError('busy', 'A battle is just starting. Queue again in a moment.');
        await sleep(Math.min(5000, ((info?.left || 0) + 1.5) * 1000));
      } catch (err) {
        if (!['noroom', 'timeout', 'rejected'].includes(err.kind)) throw err;
        lastErr = err;
        await sleep(700);
      }
    }
    throw lastErr || new TransportError('busy', 'The queue is busy. Try again in a moment.');
  }

  // ---------------------------------------------------------------- chat (tournaments)
  systemChat(text) { this.pushChat({ n: '', r: 'system', x: cleanText(text, 200), ts: Date.now() }); }

  hostChat(member, text) {
    const x = cleanText(text, 200);
    if (!x) return;
    const now = performance.now();
    if (now - (this.chatAt.get(member.id) || 0) < 700) return; // a little flood control
    this.chatAt.set(member.id, now);
    this.pushChat({ n: member.name, c: ONLINE_COLORS[member.color] || '#ddd', r: member.role, g: member.group || '', x, ts: Date.now() });
  }

  pushChat(m) {
    this.chat.push(m);
    if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
    this.transport?.broadcast({ t: 'chat', m });
    this.onChat(m);
  }

  sendChat(text) {
    if (!this.connected || this.kind !== 'tournament') return;
    if (this.isHost) this.hostChat(this.me, text);
    else this.transport.sendHost({ t: 'chat', x: cleanText(text, 200) });
  }

  // ---------------------------------------------------------------- quick chat (any online match)
  // A fixed line (social.js QUICK_CHAT) over your fighter's head. The host checks it is a player
  // in this match and not flooding, then tells everyone.
  sendQuickChat(i) {
    if (!this.connected || !this.lobby?.inMatch || cleanChat(i) < 0) return;
    if (this.isHost) this.hostQuickChat('host', i);
    else this.transport.sendHost({ t: 'qc', i });
  }

  hostQuickChat(id, i) {
    if (!this.lobby?.inMatch || cleanChat(i) < 0) return;
    const slot = this.spec?.fighters.findIndex((f) => f.owner === id) ?? -1;
    if (slot < 0 || !this.chatGate.allow(id)) return;
    this.transport.broadcast({ t: 'qc', s: slot, i });
    this.onQuickChat(slot, i);
  }

  // ---------------------------------------------------------------- tournaments (host = admin)
  get tournamentTeams() { return teamsOf(this.lobby?.members || []); }

  // Admin: lock in the teams present now and draw the bracket.
  startTournament() {
    const t = this.lobby?.tournament;
    if (!this.isHost || !t || t.status !== 'open') return 'Not open.';
    const teams = this.tournamentTeams;
    if (teams.size < 2) return 'At least two teams (fundraising groups) need a player in the room.';
    t.names = Object.fromEntries([...teams.values()].map((x) => [x.key, x.name]));
    t.bracket = seedBracket([...teams.keys()]);
    t.status = 'running';
    this.systemChat(`The bracket is drawn: ${teams.size} teams. ${this.describeNext()}`);
    this.broadcastLobby();
    return null;
  }

  describeNext() {
    const t = this.lobby.tournament;
    const m = nextMatch(t.bracket);
    if (!m) return '';
    return `Up next, ${roundName(t.bracket, m.r)}: ${t.names[m.a]} vs ${t.names[m.b]}.`;
  }

  // Admin: play the next bracket match. Teams field their players present (up to the team size),
  // CPUs fill empty places when the admin allows it; a team with nobody here forfeits.
  startTournamentMatch() {
    const t = this.lobby?.tournament;
    if (!this.isHost || !t || t.status !== 'running' || this.lobby.inMatch) return;
    const m = nextMatch(t.bracket);
    if (!m) return;
    const teams = this.tournamentTeams;
    const present = (key) => (teams.get(key)?.members || []).slice(0, t.teamSize);
    const pa = present(m.a), pb = present(m.b);
    if (!pa.length || !pb.length) {
      const winner = pa.length ? m.a : pb.length ? m.b : m.a;
      this.systemChat(`${t.names[pa.length ? m.b : m.a]} has nobody here and forfeits. ${t.names[winner]} go through.`);
      this.finishTournamentMatch(m, winner);
      return;
    }
    const size = t.fill ? t.teamSize : Math.max(pa.length, pb.length);
    const pick = (f) => (f >= 0 ? f : Math.floor(Math.random() * ROSTER.length));
    const fighters = [];
    [pa, pb].forEach((list, side) => {
      for (const mem of list) { const def = pick(mem.fighter); fighters.push({ def, look: lookOf(mem, def), pname: mem.name, color: ONLINE_COLORS[mem.color], owner: mem.id, team: side, reward: mem.reward || 0 }); }
      for (let k = list.length; k < size; k++) fighters.push({ def: pick(-1), look: randomLook(), pname: null, color: null, owner: null, team: side });
    });
    t.current = { r: m.r, i: m.i, a: m.a, b: m.b };
    const label = `${roundName(t.bracket, m.r)} · ${t.names[m.a]} vs ${t.names[m.b]}`;
    this.systemChat(`${label}. Fight!`);
    this.launch({
      setup: { mode: 'tournament', winsNeeded: t.wins, suddenDeath: 120, difficulty: 'hard', teams: { count: 2, names: [t.names[m.a], t.names[m.b]] } },
      fighters, label,
      watchHint: `${label}. Watching live: <kbd>←</kbd><kbd>→</kbd> follow a fighter · <kbd>↑</kbd> whole field · <kbd>T</kbd> chat`,
    });
  }

  // The host saw the match end: record it and bring everyone back to the bracket.
  onTournamentMatchEnd(champ) {
    const t = this.lobby?.tournament;
    if (!this.isHost || !t?.current) return;
    const m = t.current;
    const winner = champ?.team === 1 ? m.b : m.a;
    t.current = null;
    clearTimeout(this.backTimer);
    this.backTimer = setTimeout(() => {
      if (!this.isHost || !this.lobby) return;
      this.finishTournamentMatch(m, winner);
      this.backToLobby();
    }, 6500);
  }

  finishTournamentMatch(m, winner) {
    const t = this.lobby.tournament;
    const loser = winner === m.a ? m.b : m.a;
    recordWinner(t.bracket, m.r, m.i, winner);
    t.last = `${t.names[winner]} beat ${t.names[loser]} in the ${roundName(t.bracket, m.r).toLowerCase()}.`;
    const champ = champion(t.bracket);
    if (champ) {
      t.status = 'done';
      t.champion = champ;
      this.systemChat(`${t.names[champ]} are the champions!${t.prize ? ` Prize: ${t.prize}` : ''}`);
    } else this.systemChat(`${t.last} ${this.describeNext()}`);
    this.broadcastLobby();
  }

  kick(id) {
    if (!this.isHost || id === 'host') return;
    const m = this.lobby.members.find((x) => x.id === id);
    if (!m) return;
    this.reject(id, 'The admin removed you from the tournament.');
    this.dropPeer(id, 'removed');
    this.systemChat(`${m.name} was removed by the admin.`);
  }

  dropPeer(id, why) {
    this.heard.delete(id);
    this.pending?.delete(id);
    this.returning?.delete(id);
    this.transport?.kick(id);
    const i = this.lobby.members.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [m] = this.lobby.members.splice(i, 1);
    if (this.lobby.inMatch && this.queueRules?.rated) {
      // ranked: leaving forfeits. The leaver's fighter falls and whoever stayed wins the match.
      const slot = this.spec.fighters.findIndex((f) => f.owner === id);
      this.forfeit(slot);
      this.controllers?.delete(id);
      this.game.hud.feed(`<b style="color:${ONLINE_COLORS[m.color]}">${escHtml(m.name)}</b> <span>${why === 'left' ? 'left' : 'lost connection'} and forfeits</span>`);
    } else if (this.lobby.inMatch) {
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

  // Ranked forfeit: the fighter in `slot` is knocked out and the other one is given the rounds still needed.
  forfeit(slot) {
    const g = this.game;
    const quitter = g.fighters[slot];
    if (!quitter || g.phase === 'matchOver') return;
    quitter.controller = null;
    this.spec.fighters[slot].owner = null;
    this.spec.forfeit = slot;
    const other = g.fighters.find((f) => f !== quitter);
    if (other) other.stats.wins = Math.max(other.stats.wins, g.setup.winsNeeded - 1);
    if (g.phase === 'roundOver') { if (other) other.stats.wins = g.setup.winsNeeded; return; }
    quitter.invuln = 0;
    if (quitter.alive) quitter.applyDamage(quitter.hp + 1, null, g, true);
    if (g.phase === 'intro') { g.phase = 'fight'; g.locked = false; }
  }

  broadcastLobby(extra = {}) {
    this.transport.broadcast({ t: 'lobby', lobby: this.lobby, ...extra });
    this.onLobby(!!extra.back);
  }

  setRule(key, d) {
    const r = this.lobby.rules;
    const cyc = (arr, v) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
    if (key === 'count') r.count = Math.min(MAX_PLAYERS, Math.max(Math.max(2, this.lobby.members.length), r.count + d));
    if (key === 'wins') r.winsNeeded = Math.min(5, Math.max(1, r.winsNeeded + d));
    if (key === 'diff') r.difficulty = cyc(['easy', 'normal', 'hard', 'brutal'], r.difficulty);
    if (key === 'sudden') r.suddenDeath = cyc([0, 45, 60, 75, 90, 120], r.suddenDeath);
    if (key === 'arena') r.arena = cyc(ARENA_CHOICES, r.arena || 'random');
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
    this.setFighter(((cur + 1 + d + n + 1) % (n + 1)) - 1); // -1 = random
  }

  // Your fighter (roster index, -1 = random) and your looks from the wardrobe, sent to the room.
  // Also called after the wardrobe changes, so the room sees a new outfit at once.
  setFighter(index) {
    this.settings.fighter = index;
    saveOnlineSettings(this.settings);
    const looks = wardrobe.allLooks();
    if (this.isHost) {
      this.lobby.members[0].fighter = index;
      this.lobby.members[0].looks = looks;
      this.broadcastLobby();
    } else if (this.role === 'client') {
      const me = this.lobby?.members.find((m) => m.id === this.myId);
      if (me) { me.fighter = index; me.looks = looks; }
      this.transport.sendHost({ t: 'pick', fighter: index, looks });
      this.onLobby();
    }
  }

  startMatch() {
    if (!this.isHost) return;
    if (this.kind === 'tournament') { this.startTournamentMatch(); return; }
    const { rules, members } = this.lobby;
    const count = Math.max(rules.count, members.length, 2);
    const pick = (f) => (f >= 0 ? f : Math.floor(Math.random() * ROSTER.length));
    const tc = rules.teams || 0;
    const fighters = members.map((m) => { const def = pick(m.fighter); return { def, look: lookOf(m, def), pname: m.name, color: ONLINE_COLORS[m.color], owner: m.id, team: tc ? m.team % tc : -1, reward: m.reward || 0 }; });
    while (fighters.length < count) {
      const cpu = { def: pick(-1), look: randomLook(), pname: null, color: null, owner: null, team: -1 };
      if (tc) {
        const sizes = Array(tc).fill(0);
        for (const f of fighters) sizes[f.team]++;
        cpu.team = sizes.indexOf(Math.min(...sizes));
      }
      fighters.push(cpu);
    }
    const teams = { count: tc, names: rules.teamNames.slice(0, tc).map((n, i) => cleanTeamName(n, i)) };
    // hazard arenas for free-for-all brawls and private rooms; hill, duo and ranked stay on the coliseum
    const fixed = rules.mode === 'hill' || (this.format && this.format !== 'brawl');
    this.launch({ setup: { mode: rules.mode || 'queue', map: fixed ? 'coliseum' : pickArena(rules.arena), winsNeeded: rules.winsNeeded, suddenDeath: rules.suddenDeath, difficulty: rules.difficulty, teams }, fighters });
  }

  // Starts a match from a spec: { setup, fighters: [{ def, pname, color, owner, team, reward }], label?, watchHint? }.
  launch(spec) {
    const { rules, members } = this.lobby;
    const fighters = spec.fighters;
    this.spec = spec;
    this.controllers = new Map();
    const ctrls = fighters.map((f) => {
      if (f.owner === 'host') return new OnlineKeyboardController(this.keyboard, this.bindings, () => !!this.menus.active);
      if (f.owner) { const c = new NetController(fighters.indexOf(f)); this.controllers.set(f.owner, c); return c; }
      return new AIController(spec.setup.difficulty || rules.difficulty);
    });
    this.unhookAll();
    this.game.net = this;
    this.menus.hideAll();
    this.installHostHooks();
    this.game.startOnline(this.spec, 'host', ctrls, fighters.findIndex((f) => f.owner === 'host'), this.bindings);
    this.lobby.inMatch = true;
    this.snapAcc = 1;
    this.snapSeq = 0;
    for (const m of members) if (m.id !== 'host') this.transport.send(m.id, { t: 'start', spec: this.spec, you: fighters.findIndex((f) => f.owner === m.id) });
    this.broadcastLobby();
    this.onMatchStart();
  }

  // Host: a message for one guest (if still in the room).
  sendTo(id, msg) {
    if (this.isHost && this.lobby?.members.some((m) => m.id === id)) this.transport.send(id, msg);
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
      obj[name] = (...args) => { if (!g.replay.playing) this.fx.push([tag, name, args]); return orig.apply(obj, args); };
      this.unhook.push(() => { delete obj[name]; });
    };
    for (const name of FX) wrap(g.effects, name, 'e');
    wrap(g.rig, 'shake', 's');
    wrap(g.hud, 'announce', 'a');
    wrap(g.hud, 'feed', 'f');
    for (const name of SYNC_EVENTS) {
      this.unhook.push(events.on(name, (data) => { if (g.online === 'host' && !data?.replay) this.fx.push(['v', name, [packPayload(data)]]); }));
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
        // gear: weapon, its hits left, armor points, selected bar slot, then [item, charges] pairs
        f.weapon ? WEAPON_IDS.indexOf(f.weapon) : -1, f.weaponHits, Math.round(f.plate), f.sel,
        f.items.flatMap((it) => [SKILL_IDS.indexOf(it.id), it.charges]),
        r2(f.vel.x), r2(f.vel.y), r2(f.vel.z),
        f.state === 'emote' ? EMOTE_IDS.indexOf(f.emoteId) : -1,
      ]),
      // the last input the host applied for each remote player, so their own prediction can check itself
      a: g.fighters.map((f) => (f.controller instanceof NetController ? f.controller.seq : -1)),
      ah: g.fighters.map((f) => (f.controller instanceof NetController && f.controller.from != null ? Math.round((g.time - f.controller.from + SIM_DT) * 1000) / 1000 : 0)),
      ...(this.snapSeq % DEEP_EVERY === 0 ? { d: this.deepState() } : {}),
      pu: g.pickups.state(),
      hl: g.hill.active ? g.hill.state() : null,
      p: g.projectiles.filter((p) => !p.dead).map((p) => [p.id, PROJ_KINDS.indexOf(p.kind), r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.dir.x), r2(p.dir.z), p.owner.slot]),
    };
  }

  // Timers and meters the snapshots leave out, which a guest needs if it ever has to take over hosting.
  deepState() {
    const g = this.game;
    return {
      pt: r2(g.phaseTime),
      f: g.fighters.map((f) => [f.armor, f.power, f.lifesteal, f.vanish, f.haste, f.slow, f.shieldTime, f.poison,
        f.guard, f.healLeft, f.healRate, f.staminaDelay, f.guardRegenDelay].map(r2)),
    };
  }

  // ---------------------------------------------------------------- joining
  // role/group: tournaments only ('player' with your fundraising group, or 'spectator')
  async join(code, { role = 'player', group = '' } = {}) {
    this.leave(null, true);
    const transport = createTransport();
    await transport.join(code);
    this.transport = transport;
    this.role = 'client';
    const welcome = new Promise((resolve, reject) => {
      this.pendingJoin = { resolve, reject };
      setTimeout(() => reject(new TransportError('timeout', 'The host did not let us in. Try again.')), 10000);
    });
    this.chat = [];
    this.listenAsClient(transport);
    transport.sendHost({ t: 'hello', v: PROTOCOL, name: cleanName(this.settings.name), fighter: this.settings.fighter, looks: wardrobe.allLooks(), role, group: cleanGroup(group), reward: cleanTier(this.menus.rewardTier), fc: this.fundraiserCode, ...this.identity() });
    try {
      await welcome;
    } catch (err) {
      this.leave(null, true);
      throw err;
    } finally {
      this.pendingJoin = null;
    }
  }

  listenAsClient(transport) {
    transport.onMessage = (id, msg) => this.clientReceive(msg);
    transport.onHostLost = () => this.hostGone();
    this.hostHeard = performance.now();
    let lastTick = performance.now();
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      const now = performance.now();
      if (now - lastTick > 3000) this.hostHeard = now; // our tab stalled; the host's messages are still queued
      lastTick = now;
      transport.sendHost({ t: 'ping' });
      // mid-match the host sends 30 snapshots a second, so silence means it is gone
      if (now - this.hostHeard > (this.game.online === 'client' && this.snaps ? HOST_TIMEOUT : PEER_TIMEOUT)) this.hostGone();
    }, 1000);
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
      case 'resume':
        // the new host carries on the match we were in: its clock and snapshot numbers start afresh
        if (msg.spec?.fighters?.length === this.spec?.fighters?.length) this.spec = msg.spec;
        if (this.fxQueue) for (const q of this.fxQueue.splice(0)) this.playFx(q.item);
        if (this.snaps) this.snaps = this.snaps.slice(-1);
        this.clockOffset = null;
        this.lastSeq = 0;
        this.resumedAt = performance.now();
        this.predictor?.pause(false);
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
      case 'qc':
        if (Number.isInteger(msg.s) && cleanChat(msg.i) >= 0) this.onQuickChat(msg.s, msg.i);
        break;
      case 'chatlog':
        if (Array.isArray(msg.l)) { this.chat = msg.l.slice(-CHAT_KEEP); this.onChat(null); }
        break;
      case 'chat':
        if (msg.m && typeof msg.m === 'object') {
          this.chat.push(msg.m);
          if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
          this.onChat(msg.m);
        }
        break;
      case 'acct':
        this.onAccount(msg);
        break;
      case 'bye':
        // a host who closes their room in the lobby closes it for everyone; otherwise the room moves on
        if (this.lobby?.inMatch || this.kind === 'queue') this.hostGone();
        else this.leave('The host closed the room.');
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
    this.input = { ctl: new OnlineKeyboardController(this.keyboard, this.bindings, () => !!this.menus.active), counts: NET_TAPS.map(() => 0), seq: 0, acc: 1, emotes: 0, emote: -1 };
    this.game.net = this;
    this.menus.hideAll();
    this.game.startOnline(spec, 'client', null, you, this.bindings);
    this.latest = null;
    this.predictor = this.game.localFighter && !this.noPredict ? new Predictor(this.game, this.game.localFighter, { states: STATES, moves: MOVE_NAMES }) : null;
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
    if (this.resumedAt) {
      // the old host's last snapshot is on another clock: line it up just before the new host's first
      this.resumedAt = 0;
      this.snaps = this.snaps.slice(-1).map((old) => ({ ...old, ht: s.ht - 1 / SNAP_HZ }));
    }
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.splice(0, this.snaps.length - 40);
    this.latest = s;
    if (s.d) this.deep = s.d;
  }

  clientStep(dt) {
    const g = this.game;
    g.time += dt;
    const it = this.sendInput(dt);
    const P = this.predictor;
    if (!this.snaps?.length) { for (const f of g.fighters) f.syncVisual(0, g); return; }
    // our own fighter runs ahead of the snapshots while it is free to act (predict.js)
    const ahead = !!P && P.update(this.latest);
    const renderT = performance.now() / 1000 + this.clockOffset - INTERP_DELAY;
    let a = this.snaps[0], b = a;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].ht <= renderT) { a = this.snaps[i]; b = this.snaps[i + 1] || a; break; }
    }
    if (this.snaps.length > 2) this.snaps.splice(0, Math.max(0, this.snaps.indexOf(a) - 1));
    const t = b === a ? 0 : Math.min(1, Math.max(0, (renderT - a.ht) / (b.ht - a.ht)));
    this.applySnap(a, b, t, dt, ahead ? P.f.slot : -1);
    if (P) {
      if (ahead && it) P.simulate(dt, it, this.input.seq);
      P.afterDraw(dt);
    }
    // effects and events whose moment has come
    while (this.fxQueue.length && this.fxQueue[0].ht <= renderT + 0.001) this.playFx(this.fxQueue.shift().item);
    if (this.fxQueue.length > 400) for (const q of this.fxQueue.splice(0, this.fxQueue.length - 400)) this.playFx(q.item);
  }

  // Sends this frame's input to the host (at most INPUT_HZ times a second, at once on a tap) and returns it.
  sendInput(dt) {
    const me = this.game.localFighter;
    if (!me) return null;
    const inp = this.input;
    const it = inp.ctl.getIntent(me, this.game);
    let tapped = false;
    NET_TAPS.forEach((a, i) => { if (it[a]) { inp.counts[i]++; tapped = true; } });
    if (it.emote && EMOTE_IDS.includes(it.emote)) { inp.emotes++; inp.emote = EMOTE_IDS.indexOf(it.emote); tapped = true; }
    inp.acc += dt;
    if (!tapped && inp.acc < 1 / INPUT_HZ) return it;
    inp.acc = 0;
    this.transport.sendHost({ t: 'in', s: ++inp.seq, mx: r2(it.mx), mz: r2(it.mz), b: it.block ? 1 : 0, d: it.dashHeld ? 1 : 0, c: inp.counts, e: [inp.emotes, inp.emote] }, 'rt');
    return it;
  }

  // Draws the match between snapshots a and b. `own` is the slot our prediction is drawing
  // (its position, motion and state are left alone; its meters still come from the host).
  applySnap(a, b, t, dt, own = -1) {
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
      const mine = i === own;
      if (!mine) {
        f.animTime += dt;
        f.pos.set(lerp(fa[0], fb[0], t), lerp(fa[1], fb[1], t), lerp(fa[2], fb[2], t));
        f.vel.set(num(fa[35]), num(fa[36]), num(fa[37]));
        f.facing = lerpAngle(fa[3], fb[3], t);
        f.state = STATES[fa[4]] || 'idle';
        f.stateTime = sameState ? lerp(fa[5], fb[5], t) : fa[5];
        f.stateDuration = fa[6];
      }
      f.hp = sameState ? lerp(fa[7], fb[7], t) : fa[7];
      f.energy = fa[8];
      const flags = fa[9];
      f.alive = !!(flags & 1);
      f.model.ice.visible = !!(flags & 4);
      f.armor = flags & 8 ? 1 : 0;
      if (!mine) {
        f.grounded = !!(flags & 2);
        f.moveName = MOVE_NAMES[fa[10]] || null;
        f.move = f.moveName ? MOVES[f.moveName] : null;
        f.attackPhase = sameState && fa[10] === fb[10] ? lerp(fa[11], fb[11], t) : fa[11];
        f.attackSide = fa[12];
        f.specialPhase = sameState ? lerp(fa[13], fb[13], t) : fa[13];
        f.moveAmount = lerp(fa[14], fb[14], t);
        f.runPhase = fb[15] >= fa[15] ? lerp(fa[15], fb[15], t) : fb[15];
      }
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
      if (!mine) f.sprinting = !!(buffs & 32);
      f.downed = num(fa[27]);
      f.reviveProgress = num(fa[28]);
      if (fa[29] > 0) f.maxHp = fa[29];
      f.weapon = WEAPON_IDS[fa[30]] || null;
      f.weaponHits = num(fa[31]);
      f.plate = num(fa[32]);
      f.sel = num(fa[33]);
      const items = Array.isArray(fa[34]) ? fa[34] : [];
      f.items.length = 0;
      for (let k = 0; k + 1 < items.length && f.items.length < 4; k += 2) {
        const id = SKILL_IDS[items[k]];
        if (SKILLS[id]?.item) f.items.push({ id, charges: num(items[k + 1]) });
      }
      f.emoteId = EMOTE_IDS[fa[38]] || null;
      if (f.alive) f.model.ring.visible = true;
      f.updateBuffVisuals();
      if (!mine) f.syncVisual(flags & 16 ? 0 : dt, g);
    });
    g.pickups.applyState(a.pu);
    if (a.hl) g.hill.applyState(a.hl);
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
        proj = new Projectile(g, ownerF, { kind, x, y, z, dx, dz, speed: 0, life: Infinity, radius: 0, color: style.color, glow: style.glow, size: style.size, stretch: style.stretch, hit: null });
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
        // our own swings, jumps and dodges already played the moment we pressed the key
        if (data.fighter && data.fighter === g.localFighter && this.predictor?.claim(name)) return;
        if (name === 'roundStart' || name === 'matchEnd') data.fighters = g.fighters;
        events.emit(name, data);
        if (name === 'matchEnd' && data.winner) {
          g.phase = 'matchOver';
          g.onMatchEnd?.(data.winner, g.fighters);
        }
      }
    } catch (err) { console.warn('[net] could not replay', item, err); }
  }

  // ---------------------------------------------------------------- host migration
  // When the host of a room or a queue battle leaves (or its connection dies), the match does not
  // end: the first other player in the lobby hosts it from their last snapshot, under the room code
  // plus "-1" (then "-2"…), and everyone else reconnects to them with the same link they had. If that
  // player is gone too, the next one in line takes over. Tournaments stay with their admin.
  hostGone() {
    if (this.migrating || this.role !== 'client') return;
    const L = this.lobby;
    const over = this.game.phase === 'matchOver' && this.kind === 'queue'; // nothing left to save
    if (!L || this.kind === 'tournament' || over || !L.members.some((m) => m.id === this.myId)) {
      this.leave('Lost the connection to the host.');
      return;
    }
    this.migrate();
  }

  async migrate() {
    const token = this.migrating = {};
    const L = this.lobby;
    const old = this.transport;
    clearInterval(this.pingTimer);
    old.onMessage = () => {};
    old.onHostLost = () => {};
    this.predictor?.pause(true);
    const gone = L.members.find((m) => m.id === 'host');
    const epoch = (L.epoch || 0) + 1;
    const code = `${L.base || L.code}-${epoch}`;
    const line = L.members.filter((m) => m.id !== 'host');
    this.migrateNote(`${gone ? `<b style="color:${ONLINE_COLORS[gone.color]}">${escHtml(gone.name)}</b>` : 'The host'} <span>left. Keeping the battle going…</span>`);
    for (let i = 0; i < line.length; i++) {
      if (this.migrating !== token) return;
      if (line[i].id === this.myId) {
        try { await this.takeOver(code, epoch, old); return; } catch (err) {
          if (err.kind !== 'taken') break;
          // someone already holds the new code: they are hosting, so join them instead
        }
        if (await this.rejoinHost(old, code, 6000, token)) return;
      } else if (await this.rejoinHost(old, code, i === 0 ? 8000 : 5000, token)) return;
    }
    if (this.migrating !== token) return;
    this.migrating = null;
    this.leave('Lost the connection to the host.');
  }

  migrateNote(html) {
    if (this.game.online) this.game.hud.feed(html);
  }

  // Keep knocking on the new host's door until it opens or `ms` runs out. True once we're back in.
  async rejoinHost(transport, code, ms, token) {
    const until = performance.now() + ms;
    while (performance.now() < until && this.migrating === token) {
      try {
        await transport.rejoin(code, Math.max(1500, until - performance.now()));
      } catch (err) {
        await sleep(600);
        continue;
      }
      if (this.migrating !== token) return false;
      const back = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 5000);
        transport.onMessage = (id, msg) => {
          if (msg.t === 'welcome') { clearTimeout(timer); resolve(true); }
          if (msg.t === 'reject') { clearTimeout(timer); resolve(false); }
          this.clientReceive(msg);
        };
        transport.sendHost({ t: 'hello', v: PROTOCOL, back: 1 });
      });
      if (this.migrating !== token) return false;
      if (back) {
        this.migrating = null;
        this.listenAsClient(transport);
        const host = this.lobby?.members.find((m) => m.id === 'host');
        this.migrateNote(`<b style="color:${ONLINE_COLORS[host?.color] || '#ddd'}">${escHtml(host?.name || 'Someone')}</b> <span>is hosting now</span>`);
        return true;
      }
    }
    return false;
  }

  // We are next in line: host the room from here, starting from the newest snapshot.
  async takeOver(code, epoch, old) {
    const transport = createTransport();
    await transport.host(code);
    const L = this.lobby;
    const oldId = this.myId;
    this.migrating = null;
    setTimeout(() => old.close(), 200);
    this.transport = transport;
    this.role = 'host';
    this.myId = 'host';
    L.code = code;
    L.epoch = epoch;
    const me = L.members.find((m) => m.id === oldId);
    const others = L.members.filter((m) => m.id !== 'host' && m !== me);
    me.id = 'host';
    L.members = [me, ...others];
    const now = performance.now();
    // the rest of the room gets a few seconds to reconnect before a CPU takes their place
    this.heard = new Map(others.map((m) => [m.id, now - PEER_TIMEOUT + RETURN_GRACE]));
    this.returning = new Set(others.map((m) => m.id));
    this.chat = [];
    this.chatAt = new Map();
    this.fundraisers = [];
    this.pending = new Set();
    this.lastHousekeeping = now;
    const q = L.queue;
    if (q && q.left != null) q.ends = now + q.left * 1000;
    // ranked: the host leaving mid-match forfeits it, like anyone else leaving
    const hostSlot = L.inMatch && this.queueRules?.rated ? this.spec.fighters.findIndex((f) => f.owner === 'host') : -1;
    this.listenAsHost(transport);
    if (L.inMatch) this.resumeAsHost(oldId);
    if (hostSlot >= 0) this.forfeit(hostSlot);
    // the queue's beacon (the name new players look for) left with the old host: claim it back if free
    if (q && !L.inMatch && (q.left === null || q.left > 0)) {
      const beacon = createBeacon();
      beacon.claim(`${(this.queueRules || QUEUES.brawl).beacon}-v${PROTOCOL}`).then(() => {
        if (this.lobby !== L || !this.isHost) { beacon.release(); return; }
        this.beacon = beacon;
        beacon.info = () => ({ code: this.lobby?.code, left: this.lobby?.queue ? this.lobby.queue.left : 0 });
      }, () => {});
    }
    this.migrateNote('<b>You</b> <span>are hosting now</span>');
    this.broadcastLobby();
  }

  welcomeBack(id, member) {
    this.returning.delete(id);
    this.heard.set(id, performance.now());
    this.transport.send(id, { t: 'welcome', id, lobby: this.lobby });
    if (this.lobby.inMatch) this.transport.send(id, { t: 'resume', spec: this.spec });
    this.broadcastLobby();
    if (this.lobby.inMatch) this.game.hud.feed(`<b style="color:${ONLINE_COLORS[member.color]}">${escHtml(member.name)}</b> <span>is back</span>`);
  }

  // Turn this guest's view of the match into the real simulation and carry on hosting it.
  resumeAsHost(oldId) {
    const g = this.game;
    const L = this.lobby;
    const spec = this.spec;
    const present = new Set(L.members.map((m) => m.id));
    for (const f of spec.fighters) {
      if (f.owner === oldId) f.owner = 'host';
      else if (f.owner && (f.owner === 'host' || !present.has(f.owner))) f.owner = null; // the old host's fighter goes to a CPU
    }
    this.controllers = new Map();
    const ctrls = spec.fighters.map((f, i) => {
      if (f.owner === 'host') return new OnlineKeyboardController(this.keyboard, this.bindings, () => !!this.menus.active);
      if (f.owner) { const c = new NetController(i); this.controllers.set(f.owner, c); return c; }
      return new AIController(spec.setup.difficulty || L.rules.difficulty);
    });
    // anything still waiting to be shown happens now
    if (this.fxQueue) for (const q of this.fxQueue.splice(0)) this.playFx(q.item);
    const last = this.snaps?.[this.snaps.length - 1] || this.latest;
    const deep = this.deep;
    if (this.clientProjectiles) { for (const p of this.clientProjectiles.values()) p.dispose(g); this.clientProjectiles.clear(); }
    this.predictor = null;
    this.snaps = null;
    this.fxQueue = null;
    g.online = 'host';
    g.fighters.forEach((f, i) => { f.controller = ctrls[i]; });
    g.projectiles = [];
    g.delayed = [];
    g.acc = 0;
    g.slowmo = 0;
    g.timeScale = 1;
    if (!last) {
      g.round = 0;
      g.beginRound(false);
    } else {
      this.applySnap(last, last, 0, 0);
      g.phase = PHASES[last.ph] || 'fight';
      g.phaseTime = deep?.pt ?? 0;
      g.locked = g.phase !== 'fight';
      g.roundWinner = g.fighters[last.w] || null;
      g.ringRadius = num(last.rr, 99);
      if (g.teamMode) g.teamsAlive = new Set(g.fighters.filter((f) => f.alive).map((f) => f.team));
      g.pickups.enabled = !!g.rules.powerups;
      g.pickups.group.visible = g.pickups.enabled;
      g.fighters.forEach((f, i) => {
        const d = deep?.f?.[i];
        if (d) [f.armor, f.power, f.lifesteal, f.vanish, f.haste, f.slow, f.shieldTime, f.poison, f.guard, f.healLeft, f.healRate, f.staminaDelay, f.guardRegenDelay] = d.map((v) => num(v));
        const sf = last.f[i];
        f.vel.set(num(sf[35]), num(sf[36]), num(sf[37]));
        f.stateTime = num(sf[5]);
        f.hitstop = 0;
        f.buffer = null;
        f.hitSet = new Set();
        f.landTime = 0;
        f.specialDone = f.specialPhase >= 1;
        if (f.state === 'dodge') {
          const v = Math.hypot(f.vel.x, f.vel.z);
          f.dodgeDir = v > 0.1 ? { x: f.vel.x / v, z: f.vel.z / v } : { x: -Math.sin(f.facing), z: -Math.cos(f.facing) };
        }
        if (f.state === 'attack' && !f.move) f.setState('idle');
        if (f.state === 'skill' && !f.skill) f.setState('idle');
        f.syncVisual(0, g);
      });
    }
    this.unhookAll();
    this.installHostHooks();
    this.snapAcc = 1;
    this.snapSeq = 0;
  }

  // ---------------------------------------------------------------- shared
  endMatchLocally() {
    this.unhookAll();
    this.predictor = null;
    this.latest = null;
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
    this.beacon?.release();
    this.beacon = null;
    this.migrating = null;
    this.returning = null;
    if (!this.role) return;
    try {
      if (this.isHost) this.transport.broadcast({ t: 'bye' });
      else this.transport.sendHost({ t: 'bye' });
    } catch { /* already gone */ }
    clearInterval(this.pingTimer);
    clearTimeout(this.backTimer);
    this.beacon?.release();
    this.beacon = null;
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

// Site handle and rating a player sends with their hello, for the ranked lobby (display only: the
// website keeps the real ratings).
function cleanIdentity(msg) {
  const out = {};
  if (typeof msg?.handle === 'string') out.handle = msg.handle.replace(/[\u0000-\u001f<>]/g, '').slice(0, 20);
  if (Number.isFinite(msg?.rating)) out.rating = Math.round(Math.min(4000, Math.max(0, msg.rating)));
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function escHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
