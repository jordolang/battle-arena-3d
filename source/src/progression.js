// Progression: fighter levels, daily and weekly challenges, and the monthly fundraiser season pass.
//
// Every match you play (not training) earns XP. The same XP levels up the fighter you played and
// fills the season pass. Challenges add bonus XP on top. A season is a calendar month, the same
// period the José Madrid Salsa fundraisers run on; when your fundraising group passes 25/50/75/100%
// of its goal this month, everyone in it earns season XP faster and unlocks the group rewards.
//
// Everything a pass tier or a group milestone gives is an existing cosmetic, granted outright
// (cosmetics.js `wardrobe.grantedBy`). Nothing here changes how a fighter plays.
//
// Progress lives in this browser (localStorage), like the wardrobe. `progression.connectProfile`
// is the hook for keeping it on the player's account later.
import { ROSTER } from './config.js';
import { ITEMS, SLOTS, wardrobe } from './cosmetics.js';

const STORE_KEY = 'battle-arena.progress.v1';

// ---------------------------------------------------------------- XP
// What a match is worth. Matches against other people pay a quarter more.
export const XP = { finish: 60, win: 120, round: 25, ko: 20, damagePer: 20, damageCap: 60, versus: 1.25 };
export function matchXp({ won, rounds = 0, kos = 0, damage = 0, versus = false }) {
  const parts = [
    ['Match finished', XP.finish],
    won && ['Victory', XP.win],
    rounds > 0 && [`${rounds} round${rounds === 1 ? '' : 's'} won`, rounds * XP.round],
    kos > 0 && [`${kos} knockout${kos === 1 ? '' : 's'}`, kos * XP.ko],
    damage >= XP.damagePer && ['Damage dealt', Math.min(XP.damageCap, Math.floor(damage / XP.damagePer))],
  ].filter(Boolean);
  let total = parts.reduce((n, [, v]) => n + v, 0);
  if (versus) { const bonus = Math.round(total * (XP.versus - 1)); parts.push(['Versus players', bonus]); total += bonus; }
  return { total, parts };
}

// ---------------------------------------------------------------- fighter levels
// Level L to L+1 costs 300 + 100*(L-1) XP; level 20 is the top (about 90 matches with one fighter).
export const MAX_LEVEL = 20;
export const MASTERY = [
  { at: 5, label: 'Bronze', color: '#d08a4c' },
  { at: 10, label: 'Silver', color: '#d8e4f0' },
  { at: 15, label: 'Gold', color: '#ffc861' },
  { at: 20, label: 'Salsa Master', color: '#ff6a3d' },
];
const levelCost = (lv) => 300 + 100 * (lv - 1);
export function fighterLevel(xp) {
  let lv = 1, left = Math.max(0, xp | 0);
  while (lv < MAX_LEVEL && left >= levelCost(lv)) { left -= levelCost(lv); lv++; }
  const need = lv < MAX_LEVEL ? levelCost(lv) : 0;
  const mastery = [...MASTERY].reverse().find((m) => lv >= m.at) || null;
  return { level: lv, into: lv < MAX_LEVEL ? left : 0, need, max: lv >= MAX_LEVEL, mastery };
}

// ---------------------------------------------------------------- seasons
export const PASS_TIERS = 20;
export const TIER_XP = 1000;
// Group milestones: share of the group's goal raised this month → season XP boost and a reward.
export const GROUP_TRACK = [
  { at: 0.25, boost: 0.1, item: 'outfit:goldenJar' },
  { at: 0.5, boost: 0.2, item: 'back:goldMantle' },
  { at: 0.75, boost: 0.3, item: 'head:kingCrown' },
  { at: 1, boost: 0.5, item: 'outfit:molten' },
];
const GROUP_ITEMS = new Set(GROUP_TRACK.map((g) => g.item));
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

const pad = (n) => String(n).padStart(2, '0');
export const seasonId = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const dayId = (d = new Date()) => `${seasonId(d)}-${pad(d.getDate())}`;
// weeks start on Monday; a week is named after its Monday
export function weekId(d = new Date()) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `W${dayId(m)}`;
}
export function seasonName(id = seasonId()) {
  const [y, m] = id.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
// when the current day, week and season end
export function resetsAt(d = new Date()) {
  return {
    daily: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
    weekly: new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 7),
    season: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}
export function timeLeft(to, now = Date.now()) {
  const mins = Math.max(0, Math.round((to - now) / 60000));
  if (mins >= 48 * 60) return `${Math.floor(mins / 1440)} days`;
  if (mins >= 60) return `${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `${mins} min`;
}

// small seeded random numbers, so everyone gets the same challenges on the same day
function seeded(key) {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) { h = Math.imul(h ^ key.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The pass's 20 rewards for a season: cosmetics normally earned from match totals, rarest last.
// Items the player doesn't own yet come first, so a tier is always something new when it can be.
export function passRewards(season, owns = () => false) {
  const rand = seeded(`pass:${season}`);
  const pool = [];
  for (const slot of SLOTS) {
    for (const [id, item] of Object.entries(ITEMS[slot])) {
      const key = `${slot}:${id}`;
      if (['free', 'group'].includes(item.unlock.need) || GROUP_ITEMS.has(key)) continue;
      pool.push({ key, slot, id, rank: RARITY_ORDER.indexOf(item.rarity), fresh: !owns(slot, id) });
    }
  }
  const picked = shuffled(pool, rand).sort((a, b) => b.fresh - a.fresh).slice(0, PASS_TIERS);
  return picked.sort((a, b) => a.rank - b.rank).map((p) => p.key);
}

// ---------------------------------------------------------------- challenges
// `stat` is what a match adds to it (see matchCounts); `fighter` limits it to one fighter,
// `versus` to matches against people (online and tournaments), `distinct` counts different fighters.
const fighterName = (id) => ROSTER.find((d) => d.id === id)?.name || id;
const DAILY = [
  { id: 'win1', n: 1, stat: 'wins', text: () => 'Win a match' },
  { id: 'play3', n: 3, stat: 'matches', text: (n) => `Finish ${n} matches` },
  { id: 'kos8', n: 8, stat: 'kos', text: (n) => `Knock out ${n} fighters` },
  { id: 'rounds4', n: 4, stat: 'rounds', text: (n) => `Win ${n} rounds` },
  { id: 'special5', n: 5, stat: 'specials', text: (n) => `Use your special move ${n} times` },
  { id: 'parry3', n: 3, stat: 'parries', text: (n) => `Parry ${n} attacks` },
  { id: 'pickup4', n: 4, stat: 'pickups', text: (n) => `Grab ${n} power-ups` },
  { id: 'dmg1500', n: 1500, stat: 'damage', text: (n) => `Deal ${n.toLocaleString('en-US')} damage` },
  { id: 'online1', n: 1, stat: 'matches', versus: true, text: () => 'Finish a match online' },
  { id: 'as2', n: 2, stat: 'matches', fighter: true, text: (n, f) => `Finish ${n} matches as ${fighterName(f)}` },
];
const WEEKLY = [
  { id: 'winWith3', n: 3, stat: 'wins', fighter: true, text: (n, f) => `Win ${n} matches with ${fighterName(f)}` },
  { id: 'wins8', n: 8, stat: 'wins', text: (n) => `Win ${n} matches` },
  { id: 'kos40', n: 40, stat: 'kos', text: (n) => `Knock out ${n} fighters` },
  { id: 'online5', n: 5, stat: 'matches', versus: true, text: (n) => `Finish ${n} matches online or in tournaments` },
  { id: 'skills30', n: 30, stat: 'skills', text: (n) => `Use ${n} skills` },
  { id: 'guard10', n: 10, stat: 'guardBreaks', text: (n) => `Break ${n} guards` },
  { id: 'fighters4', n: 4, stat: 'wins', distinct: true, text: (n) => `Win with ${n} different fighters` },
  { id: 'dmg10k', n: 10000, stat: 'damage', text: (n) => `Deal ${n.toLocaleString('en-US')} damage` },
];
export const CHALLENGE_XP = { daily: 200, weekly: 750 };
const PER_PERIOD = 3;

// The challenges for a day or a week: the same for everyone, drawn from the lists above.
export function challengesFor(kind, id) {
  const rand = seeded(`${kind}:${id}`);
  const list = shuffled(kind === 'daily' ? DAILY : WEEKLY, rand).slice(0, PER_PERIOD);
  return list.map((c) => ({ key: c.id, fighter: c.fighter ? ROSTER[Math.floor(rand() * ROSTER.length)].id : null }));
}
function challengeDef(kind, key) { return (kind === 'daily' ? DAILY : WEEKLY).find((c) => c.id === key); }
export const challengeTarget = (kind, key) => challengeDef(kind, key)?.n ?? 1;
export function challengeText(kind, c) {
  const d = challengeDef(kind, c.key);
  return d ? d.text(d.n, c.fighter) : '';
}

// ---------------------------------------------------------------- the player's progress
function blank() {
  return { fighters: {}, owned: [], season: null, daily: null, weekly: null, total: 0 };
}

export class Progression {
  constructor({ storage = globalThis.localStorage, now = () => new Date() } = {}) {
    this.storage = storage;
    this.now = now;
    this.listeners = new Set();
    this.group = () => null; // main.js: the player's fundraising team { raised, goal, name } or null
    this.profile = null;
    this.load();
    this.roll();
    // pass and group rewards count as owned in the wardrobe
    wardrobe.grantedBy((slot, id) => this.owned.has(`${slot}:${id}`));
  }

  load() {
    let d = blank();
    try {
      const s = JSON.parse(this.storage?.getItem(STORE_KEY) || 'null');
      if (s && typeof s === 'object') {
        for (const def of ROSTER) {
          const xp = Math.max(0, Math.floor(+s.fighters?.[def.id]?.xp || 0));
          if (xp) d.fighters[def.id] = { xp };
        }
        d.owned = Array.isArray(s.owned) ? s.owned.filter((k) => typeof k === 'string' && validItem(k)) : [];
        d.total = Math.max(0, Math.floor(+s.total || 0));
        if (s.season?.id) d.season = { id: String(s.season.id), xp: Math.max(0, +s.season.xp | 0), rewards: (s.season.rewards || []).filter(validItem), group: (s.season.group || []).filter(Number.isInteger) };
        for (const k of ['daily', 'weekly']) {
          if (s[k]?.id && Array.isArray(s[k].list)) {
            d[k] = { id: String(s[k].id), list: s[k].list.filter((c) => challengeDef(k, c?.key)).map((c) => ({
              key: c.key, fighter: ROSTER.some((f) => f.id === c.fighter) ? c.fighter : null,
              have: Math.max(0, +c.have || 0), seen: Array.isArray(c.seen) ? c.seen.filter((x) => typeof x === 'string') : [], done: !!c.done,
            })) };
          }
        }
      }
    } catch { d = blank(); }
    this.data = d;
    this.owned = new Set(d.owned);
  }

  save() {
    this.data.owned = [...this.owned];
    try { this.storage?.setItem(STORE_KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
    this.profile?.save?.(this.export());
    for (const fn of this.listeners) { try { fn(this); } catch (err) { console.error('[progression]', err); } }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // Starts a new day, week or season when the calendar has moved on. Returns true if anything changed.
  roll() {
    const now = this.now();
    let changed = false;
    const sid = seasonId(now);
    if (this.data.season?.id !== sid) {
      this.data.season = { id: sid, xp: 0, rewards: passRewards(sid, (s, i) => wardrobe.isUnlocked(s, i)), group: [] };
      changed = true;
    }
    for (const [kind, id] of [['daily', dayId(now)], ['weekly', weekId(now)]]) {
      if (this.data[kind]?.id !== id) {
        this.data[kind] = { id, list: challengesFor(kind, id).map((c) => ({ ...c, have: 0, seen: [], done: false })) };
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  // ---- reading
  get season() { this.roll(); return this.data.season; }
  get tier() { return Math.min(PASS_TIERS, Math.floor(this.season.xp / TIER_XP)); }
  tierProgress() {
    const xp = this.season.xp, tier = this.tier;
    return tier >= PASS_TIERS ? { tier, into: 0, need: 0, done: true } : { tier, into: xp - tier * TIER_XP, need: TIER_XP, done: false };
  }
  fighterXp(id) { return this.data.fighters[id]?.xp || 0; }
  fighter(id) { return fighterLevel(this.fighterXp(id)); }
  challenges(kind) { this.roll(); return this.data[kind].list; }
  get openChallenges() { return ['daily', 'weekly'].reduce((n, k) => n + this.challenges(k).filter((c) => !c.done).length, 0); }

  // the group's progress this month: { team, pct, reached (milestones met), boost }
  groupStatus() {
    const team = this.group();
    const pct = team?.goal ? team.raised / team.goal : 0;
    const reached = GROUP_TRACK.filter((g) => pct >= g.at).length;
    return { team, pct, reached, boost: reached ? GROUP_TRACK[reached - 1].boost : 0 };
  }

  // ---- earning
  // Grants group-track rewards the player's group has reached this season. Returns what was new.
  claimGroup() {
    const { reached } = this.groupStatus();
    const s = this.season;
    const fresh = [];
    for (let i = 0; i < reached; i++) {
      if (s.group.includes(i)) continue;
      s.group.push(i);
      fresh.push({ source: 'group', at: GROUP_TRACK[i].at, ...this.grant(GROUP_TRACK[i].item) });
    }
    if (fresh.length) this.save();
    return fresh;
  }

  grant(key) {
    this.owned.add(key);
    const [slot, id] = key.split(':');
    return { key, slot, id, item: ITEMS[slot][id] };
  }

  // Adds a finished match. `m` = { fighter, won, rounds, kos, damage, versus, counts } where counts
  // holds the per-match tallies the challenges use (specials, parries, pickups, skills, guardBreaks).
  // Returns everything the results screen shows about it.
  recordMatch(m) {
    this.roll();
    const def = ROSTER.find((d) => d.id === m.fighter);
    const xp = matchXp(m);
    const out = { xp: xp.total, parts: xp.parts, fighter: def?.id || null, levelUps: [], challenges: [], tiers: [], group: [], boost: 0 };

    // the fighter's level
    if (def) {
      const before = this.fighter(def.id);
      this.data.fighters[def.id] = { xp: this.fighterXp(def.id) + xp.total };
      const after = this.fighter(def.id);
      out.before = before; out.after = after;
      for (let lv = before.level + 1; lv <= after.level; lv++) out.levelUps.push(lv);
    }
    this.data.total += xp.total;

    // challenges
    const counts = { matches: 1, wins: m.won ? 1 : 0, rounds: m.rounds || 0, kos: m.kos || 0, damage: Math.round(m.damage || 0), ...(m.counts || {}) };
    let bonus = 0;
    for (const kind of ['daily', 'weekly']) {
      for (const c of this.data[kind].list) {
        if (c.done) continue;
        const d = challengeDef(kind, c.key);
        if (d.versus && !m.versus) continue;
        if (d.fighter && c.fighter !== m.fighter) continue;
        if (d.distinct) {
          if (counts[d.stat] > 0 && m.fighter && !c.seen.includes(m.fighter)) c.seen.push(m.fighter);
          c.have = c.seen.length;
        } else c.have += counts[d.stat] || 0;
        if (c.have >= d.n) {
          c.have = d.n; c.done = true;
          bonus += CHALLENGE_XP[kind];
          out.challenges.push({ kind, text: challengeText(kind, c), xp: CHALLENGE_XP[kind] });
        }
      }
    }
    out.xp += bonus;

    // the season pass, boosted while the player's group is ahead on its goal
    const g = this.groupStatus();
    const s = this.data.season;
    const tierBefore = this.tier;
    const seasonXp = Math.round((xp.total + bonus) * (1 + g.boost));
    out.boost = g.boost;
    out.seasonXp = seasonXp;
    s.xp += seasonXp;
    for (let t = tierBefore + 1; t <= this.tier; t++) {
      const key = s.rewards[t - 1];
      out.tiers.push({ tier: t, ...(key ? this.grant(key) : {}) });
    }
    out.group = this.claimGroup();
    out.tier = this.tierProgress();
    this.save();
    this.profile?.recordMatch?.(m, out);
    return out;
  }

  export() { this.data.owned = [...this.owned]; return JSON.parse(JSON.stringify(this.data)); }

  // ---- profiles
  // A player profile can keep progress on the account. The adapter may provide:
  //   data              -> a saved copy (same shape as export()); replaces this browser's copy
  //   save(data)        -> stores progress on the account
  //   recordMatch(m, r) -> told about every match recorded here
  connectProfile(adapter) {
    this.profile = adapter || null;
    if (adapter?.data) {
      try { this.storage?.setItem(STORE_KEY, JSON.stringify(adapter.data)); } catch { /* ignore */ }
      this.load();
      this.roll();
    }
    for (const fn of this.listeners) fn(this);
  }
}

function validItem(k) {
  if (typeof k !== 'string') return false;
  const [slot, id] = k.split(':');
  return !!ITEMS[slot] && Object.hasOwn(ITEMS[slot], id);
}

// Per-match tallies for challenges: the local player's specials, skills, parries, power-ups and
// guard breaks. `who()` returns the fighter that is "you" (or null while watching).
export function trackMatchCounts(events, who) {
  let counts = {};
  const mine = (f) => !!f && f === who();
  const add = (k) => { counts[k] = (counts[k] || 0) + 1; };
  events.on('roundStart', (d) => { if (d.round === 1) counts = {}; });
  events.on('special', (d) => { if (mine(d.fighter)) add('specials'); });
  events.on('skill', (d) => { if (mine(d.fighter)) add('skills'); });
  events.on('parry', (d) => { if (mine(d.fighter)) add('parries'); });
  events.on('pickup', (d) => { if (mine(d.fighter)) add('pickups'); });
  events.on('guardBreak', (d) => { if (mine(d.by)) add('guardBreaks'); });
  return () => ({ ...counts });
}

