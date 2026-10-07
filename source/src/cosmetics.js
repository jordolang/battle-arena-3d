// Cosmetics: clothing (tops, pants, shoes, gloves), colour schemes, headgear, back pieces and victory
// poses, how each one is unlocked, and the player's wardrobe (what they own and wear on each fighter).
// Nothing here changes how a fighter plays; it is all looks.
//
// The wardrobe lives in this browser (localStorage) for now. Player profiles can take it over later
// through `wardrobe.connectProfile(adapter)`, see the bottom of this file.
import { ROSTER } from './config.js';

export const SLOTS = ['top', 'legs', 'feet', 'hands', 'head', 'back', 'outfit', 'victory'];
export const SLOT_LABELS = { top: 'Tops', legs: 'Pants', feet: 'Shoes', hands: 'Gloves', head: 'Headgear', back: 'Back', outfit: 'Colours', victory: 'Victory' };

export const RARITY = {
  common: { label: 'Common', color: '#c9bba6' },
  rare: { label: 'Rare', color: '#4fb0ff' },
  epic: { label: 'Epic', color: '#c77dff' },
  legendary: { label: 'Legendary', color: '#ffc861' },
  fundraiser: { label: 'Fundraiser exclusive', color: '#ff6a3d' },
};

// How an item is earned. Counts are the player's totals across every match played in this browser
// (or, once profiles are connected, on their account).
//   free           everyone has it
//   matches n      finish n matches
//   wins n         win n matches
//   rounds n       win n rounds
//   kos n          knock out n fighters
//   group          be enrolled in a José Madrid Salsa fundraising group (the title-screen field)
const free = { need: 'free' };
const need = (kind, n) => ({ need: kind, n });
const group = { need: 'group' };

// Clothing is worn over the fighter's body and moves with it. `color` is a fixed colour, or one of the
// colour scheme's parts ('gi', 'trim', 'accent'), so the Colours tab dyes the clothes too.
export const TOPS = {
  gi: { label: 'Fighting Gi', rarity: 'common', unlock: free, hint: 'The wrap-over tunic every fighter starts in' },
  tee: { label: 'Arena Tee', rarity: 'common', unlock: free, color: 'accent', hint: 'A plain tee, dyed to your colours' },
  tank: { label: 'Tank Top', rarity: 'common', unlock: need('matches', 1), color: 'gi', hint: 'Bare arms, for showing off' },
  hoodie: { label: 'Hoodie', rarity: 'rare', unlock: need('matches', 3), color: 'trim', hint: 'Hood up for the walk-out, pocket for snacks' },
  poncho: { label: 'Serape Poncho', rarity: 'rare', unlock: need('kos', 20), color: 'accent', hint: 'Woven stripes, worn over the shoulders' },
  apron: { label: 'Salsa Chef Apron', rarity: 'rare', unlock: need('rounds', 8), hint: 'For the fighter who cooks between rounds' },
  leather: { label: 'Biker Jacket', rarity: 'epic', unlock: need('kos', 50), hint: 'Black leather, silver zip' },
  charro: { label: 'Charro Jacket', rarity: 'epic', unlock: need('wins', 5), hint: 'A short black jacket with gold buttons' },
  jmTee: { label: 'José Madrid Tee', rarity: 'fundraiser', unlock: group, hint: 'Black tee with the red chili, for fundraiser members' },
  matador: { label: 'Suit of Lights', rarity: 'legendary', unlock: need('wins', 15), hint: 'A matador\'s gold-embroidered jacket' },
};

export const LEGS = {
  gi: { label: 'Gi Trousers', rarity: 'common', unlock: free, hint: 'Loose and easy to kick in' },
  shorts: { label: 'Fight Shorts', rarity: 'common', unlock: free, color: 'accent', hint: 'Satin trunks with a waistband' },
  jeans: { label: 'Jeans', rarity: 'common', unlock: need('matches', 2), hint: 'Faded denim' },
  cargo: { label: 'Cargo Pants', rarity: 'rare', unlock: need('rounds', 6), hint: 'Olive drab with side pockets' },
  charro: { label: 'Charro Trousers', rarity: 'epic', unlock: need('wins', 5), hint: 'Black with a row of silver buttons down each leg' },
  jmJoggers: { label: 'José Madrid Joggers', rarity: 'fundraiser', unlock: group, hint: 'Salsa red with a gold stripe' },
  matador: { label: 'Gold Breeches', rarity: 'legendary', unlock: need('wins', 15), hint: 'Gold breeches and pink stockings, to match the Suit of Lights' },
};

export const FEET = {
  wraps: { label: 'Foot Wraps', rarity: 'common', unlock: free, hint: 'Cloth wraps and bare soles' },
  sneakers: { label: 'High-tops', rarity: 'common', unlock: free, color: 'accent', hint: 'White high-tops, coloured soles' },
  huaraches: { label: 'Huaraches', rarity: 'common', unlock: need('matches', 1), hint: 'Woven leather sandals' },
  boots: { label: 'Cowboy Boots', rarity: 'rare', unlock: need('matches', 4), hint: 'Pointed toes and a stacked heel' },
  goldBoots: { label: 'Golden Boots', rarity: 'legendary', unlock: need('kos', 100), hint: 'Kick like royalty' },
};

export const HANDS = {
  wraps: { label: 'Hand Wraps', rarity: 'common', unlock: free, hint: 'Cloth wraps over the wrists' },
  mma: { label: 'Fight Gloves', rarity: 'common', unlock: free, color: 'trim', hint: 'Thin open-finger gloves' },
  boxing: { label: 'Boxing Gloves', rarity: 'rare', unlock: need('wins', 2), color: 'accent', hint: 'Big padded gloves, laced at the wrist' },
  gauntlets: { label: 'Iron Gauntlets', rarity: 'epic', unlock: need('kos', 30), hint: 'Steel cuffs and knuckle plates' },
  mitts: { label: 'Salsa Chef Mitts', rarity: 'fundraiser', unlock: group, hint: 'Oven mitts: hot salsa, hotter fists' },
};

// Colour schemes (the Colours tab) recolour the gi (main cloth), the trim (sash, wraps) and give an accent colour that dyeable clothes,
// headgear and back pieces pick up. `own` keeps the fighter's own colour for that part.
// finish: cloth (default), metal (polished), gold (gilded) or glow (the trim burns with `glow`).
export const OUTFITS = {
  classic: { label: 'Classic', rarity: 'common', unlock: free, gi: 'own', trim: 'own', accent: 'eyes',
    hint: "The fighter's own colours" },
  midnight: { label: 'Midnight', rarity: 'common', unlock: free, gi: 0x16141a, trim: 'gi', accent: 'gi',
    hint: 'Black cloth trimmed in the fighter\'s colour' },
  bone: { label: 'Bone White', rarity: 'common', unlock: need('matches', 1), gi: 0xe6dccb, trim: 'gi', accent: 'gi',
    hint: 'Undyed linen for a first-timer' },
  salsaRoja: { label: 'Salsa Roja', rarity: 'rare', unlock: need('wins', 1), gi: 0xc21e1a, trim: 0x2e7d2a, accent: 0xf3e7c9,
    hint: 'Ripe tomato, fresh cilantro and white onion' },
  salsaVerde: { label: 'Salsa Verde', rarity: 'rare', unlock: need('matches', 3), gi: 0x6f9e2c, trim: 0xece4b4, accent: 0x2c4c14,
    hint: 'Roasted tomatillo and lime' },
  chipotle: { label: 'Chipotle Smoke', rarity: 'rare', unlock: need('kos', 15), gi: 0x5c2a18, trim: 0x1a100b, accent: 0xd0622c,
    hint: 'Smoked jalapeño, dark and rich' },
  mango: { label: 'Mango Habanero', rarity: 'rare', unlock: need('wins', 3), gi: 0xffa51c, trim: 0xd8361a, accent: 0xffe08a,
    hint: 'Sweet up front, hot at the finish' },
  blackBean: { label: 'Black Bean & Corn', rarity: 'rare', unlock: need('rounds', 10), gi: 0x201c22, trim: 0xf1c232, accent: 0xf1c232,
    hint: 'Midnight black with sweet corn gold' },
  habanero: { label: 'Habanero Inferno', rarity: 'epic', unlock: need('kos', 40), gi: 0xff5a10, trim: 0x3a0a04, accent: 0xffb347,
    finish: 'glow', glow: 0xff6a12, hint: 'The trim smoulders like a live coal' },
  ghostPepper: { label: 'Ghost Pepper', rarity: 'epic', unlock: need('wins', 10), gi: 0xddd5ea, trim: 0x5c1a8c, accent: 0xb070ff,
    finish: 'glow', glow: 0xa050ff, hint: 'Pale as a ghost, burns twice as hot' },
  jinete: { label: 'El Jinete', rarity: 'epic', unlock: need('matches', 10), gi: 0x141214, trim: 0xd4a83a, accent: 0xc0201c,
    finish: 'metal', hint: 'Dressed like the rider on the José Madrid crest' },
  jmOriginal: { label: 'José Madrid Original', rarity: 'fundraiser', unlock: group, gi: 0xb3161b, trim: 0x111011, accent: 0xf2b636,
    finish: 'metal', hint: 'The label colours: salsa red, jar-lid black and crest gold' },
  goldenJar: { label: 'Golden Jar', rarity: 'legendary', unlock: need('wins', 25), gi: 0xe8b23a, trim: 0x9e1712, accent: 0xfff1b0,
    finish: 'gold', hint: 'Solid gold, for the true salsa champion' },
  molten: { label: 'Molten Salsa', rarity: 'legendary', unlock: need('kos', 150), gi: 0x2a0f0a, trim: 0xff3a0a, accent: 0xffa020,
    finish: 'glow', glow: 0xff3a0a, giGlow: 0x7a1404, hint: 'Cooled crust over a river of lava' },
};

export const HEADGEAR = {
  none: { label: 'Bare head', rarity: 'common', unlock: free, hint: 'Nothing on but determination' },
  bandana: { label: 'Bandana', rarity: 'common', unlock: free, hint: 'Tied tight, tails flying' },
  luchador: { label: 'Luchador Mask', rarity: 'rare', unlock: need('wins', 2), covers: true, hint: 'Flames around the eyes, honour on the line' },
  sombrero: { label: 'Sombrero', rarity: 'rare', unlock: need('matches', 2), covers: true, hint: 'Wide brim, embroidered band' },
  jinete: { label: "Rider's Hat & Mask", rarity: 'epic', unlock: need('matches', 8), covers: true, hint: 'A flat black hat and a bandit mask' },
  chiliCrown: { label: 'Crown of Chilies', rarity: 'epic', unlock: need('kos', 60), hint: 'Eight fresh peppers on a gold band' },
  jmBandana: { label: 'José Madrid Bandana', rarity: 'fundraiser', unlock: group, hint: 'Salsa red with a gold crest' },
  kingCrown: { label: 'Salsa King Crown', rarity: 'legendary', unlock: need('wins', 20), hint: 'Gold and rubies for the king of the arena' },
};

export const BACKS = {
  none: { label: 'Nothing', rarity: 'common', unlock: free, hint: 'Travel light' },
  cape: { label: 'Battle Cape', rarity: 'common', unlock: need('rounds', 3), hint: 'Catches the wind when you run' },
  chiliBanner: { label: 'Chili Banner', rarity: 'rare', unlock: need('wins', 5), hint: 'A war banner with a red pepper' },
  salsaJar: { label: 'Salsa Jar Pack', rarity: 'epic', unlock: need('matches', 6), hint: 'A jar of the good stuff, strapped on for the road' },
  jmStandard: { label: 'José Madrid Standard', rarity: 'fundraiser', unlock: group, hint: 'Fly your fundraiser\'s colours' },
  goldMantle: { label: 'Golden Mantle', rarity: 'legendary', unlock: need('wins', 30), hint: 'A cape of beaten gold' },
};

export const VICTORIES = {
  fist: { label: 'Fist to the Sky', rarity: 'common', unlock: free, hint: 'The classic' },
  salsa: { label: 'Salsa Step', rarity: 'common', unlock: free, hint: 'One, two, three, turn' },
  flex: { label: 'Double Flex', rarity: 'rare', unlock: need('wins', 1), hint: 'Show them the guns' },
  beckon: { label: 'Come On Then', rarity: 'rare', unlock: need('rounds', 5), hint: 'Waves the next one in' },
  bow: { label: "Matador's Bow", rarity: 'epic', unlock: need('matches', 4), hint: 'A sweeping bow to the crowd' },
};

// Body customisation: always free, chosen per fighter. 'own' keeps the fighter's own look.
// Each option is { label, value } where value is a colour, a hair style name, or true/false for the beard.
const opt = (label, value) => ({ label, value });
export const BODY = {
  skin: { label: 'Skin tone', options: {
    own: opt('Their own', null), t1: opt('Porcelain', 0xf3d6c0), t2: opt('Fair', 0xe8c4a8), t3: opt('Light tan', 0xdcae86),
    t4: opt('Golden', 0xc68a5e), t5: opt('Olive', 0xb08560), t6: opt('Bronze', 0x8a5a3c), t7: opt('Brown', 0x6a4028), t8: opt('Deep brown', 0x4a3428),
  } },
  hairStyle: { label: 'Hair', options: {
    own: opt('Their own', null), bald: opt('Bald', 'bald'), short: opt('Short', 'short'), long: opt('Long', 'long'), topknot: opt('Topknot', 'topknot'),
    mohawk: opt('Mohawk', 'mohawk'), spiky: opt('Spiky', 'spiky'), braids: opt('Braids', 'braids'),
  } },
  hairColor: { label: 'Hair colour', options: {
    own: opt('Their own', null), black: opt('Black', 0x120c0a), brown: opt('Brown', 0x4a2a16), auburn: opt('Auburn', 0x7a2e14), blonde: opt('Blonde', 0xe0c070),
    silver: opt('Silver', 0xd8e4f0), red: opt('Chili red', 0xc0201c), green: opt('Jalapeño green', 0x4f9a1c), blue: opt('Blue', 0x2a6fd0), purple: opt('Purple', 0x7a3fc0),
  } },
  beard: { label: 'Beard', options: { own: opt('Their own', null), on: opt('Beard', true), off: opt('Clean-shaven', false) } },
  eyes: { label: 'Eye glow', options: {
    own: opt('Their own', null), ember: opt('Ember', 0xffb347), ice: opt('Ice', 0x9fe8ff), venom: opt('Venom', 0xc6ff4a), violet: opt('Violet', 0xe08bff),
    blood: opt('Blood', 0xff5a4a), gold: opt('Gold', 0xffdd77), ghost: opt('Ghost', 0xf0f0ff),
  } },
};
export const BODY_KEYS = Object.keys(BODY);
// The fighter's definition with their chosen body (hair style and beard change the model's shape).
export function bodyDef(def, look) {
  const v = (k) => BODY[k].options[look?.[k]]?.value ?? null;
  return { ...def, hairStyle: v('hairStyle') ?? def.hairStyle, beard: v('beard') ?? def.beard, skin: v('skin') ?? def.skin, hair: v('hairColor') ?? def.hair };
}
export const bodyValue = (look, k) => BODY[k].options[look?.[k]]?.value ?? null;

export const ITEMS = { top: TOPS, legs: LEGS, feet: FEET, hands: HANDS, outfit: OUTFITS, head: HEADGEAR, back: BACKS, victory: VICTORIES };
export const DEFAULT_LOOK = Object.freeze({ skin: 'own', hairStyle: 'own', hairColor: 'own', beard: 'own', eyes: 'own', top: 'gi', legs: 'gi', feet: 'wraps', hands: 'wraps', outfit: 'classic', head: 'none', back: 'none', victory: 'fist' });
export const ITEM_COUNT = SLOTS.reduce((n, s) => n + Object.keys(ITEMS[s]).length, 0);

// Anything from the network or storage goes through here: unknown ids fall back to the default.
export function sanitizeLook(look) {
  const out = { ...DEFAULT_LOOK };
  if (look && typeof look === 'object') {
    for (const s of SLOTS) if (typeof look[s] === 'string' && Object.hasOwn(ITEMS[s], look[s])) out[s] = look[s];
    for (const k of BODY_KEYS) if (typeof look[k] === 'string' && Object.hasOwn(BODY[k].options, look[k])) out[k] = look[k];
  }
  return out;
}
export const sameLook = (a, b) => [...SLOTS, ...BODY_KEYS].every((s) => a?.[s] === b?.[s]);

// A CPU fighter dresses itself: often in its classic colours, sometimes in something rare, so players
// see what there is to earn.
export function randomLook(rand = Math.random) {
  const any = (obj) => { const k = Object.keys(obj); return k[Math.floor(rand() * k.length)]; };
  return {
    top: rand() < 0.4 ? 'gi' : any(TOPS),
    legs: rand() < 0.45 ? 'gi' : any(LEGS),
    feet: rand() < 0.4 ? 'wraps' : any(FEET),
    hands: rand() < 0.5 ? 'wraps' : any(HANDS),
    outfit: rand() < 0.4 ? 'classic' : any(OUTFITS),
    head: rand() < 0.5 ? 'none' : any(HEADGEAR),
    back: rand() < 0.6 ? 'none' : any(BACKS),
    victory: any(VICTORIES),
  };
}

// "Salsa Roja · Sombrero": the parts of a look that differ from the default, for menus.
export function lookSummary(look) {
  const l = sanitizeLook(look);
  return SLOTS.filter((s) => l[s] !== DEFAULT_LOOK[s]).map((s) => ITEMS[s][l[s]].label).join(' · ');
}

// Resolves an outfit's colours for one fighter: { gi, trim, accent, finish, glow, giGlow }.
export function outfitColors(def, outfitId) {
  const o = OUTFITS[outfitId] || OUTFITS.classic;
  const own = { gi: def.gi, trim: def.trim, eyes: def.eyes };
  const pick = (v, self) => (v === 'own' ? own[self] : typeof v === 'string' ? own[v] : v);
  return { gi: pick(o.gi, 'gi'), trim: pick(o.trim, 'trim'), accent: pick(o.accent, 'eyes'), finish: o.finish || 'cloth', glow: o.glow ?? null, giGlow: o.giGlow ?? null };
}

// ---------------------------------------------------------------- the wardrobe
const STORE_KEY = 'battle-arena.wardrobe.v1';
const GROUP_KEY = 'battle-arena.fundraiser-group.v1';
const STAT_KEYS = ['matches', 'wins', 'rounds', 'kos'];
const STAT_LABELS = { matches: ['Finish', 'match', 'matches'], wins: ['Win', 'match', 'matches'], rounds: ['Win', 'round', 'rounds'], kos: ['Knock out', 'fighter', 'fighters'] };

function blank() {
  return { stats: { matches: 0, wins: 0, rounds: 0, kos: 0 }, looks: {}, favourite: -1, seen: [] };
}

class Wardrobe {
  constructor() {
    this.data = blank();
    this.profile = null;
    this.grants = [];
    this.listeners = new Set();
    this.hasGroup = () => { try { return !!(localStorage.getItem(GROUP_KEY) || '').trim(); } catch { return false; } };
    this.load();
    // everything that is free or already earned counts as seen, so the first unlock toast is a real one
    if (!this.data.seen.length) this.data.seen = this.unlockedIds();
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      const d = blank();
      for (const k of STAT_KEYS) d.stats[k] = Math.max(0, Math.floor(+s.stats?.[k] || 0));
      for (const def of ROSTER) if (s.looks?.[def.id]) d.looks[def.id] = sanitizeLook(s.looks[def.id]);
      d.favourite = Number.isInteger(s.favourite) && s.favourite >= -1 && s.favourite < ROSTER.length ? s.favourite : -1;
      d.seen = Array.isArray(s.seen) ? s.seen.filter((x) => typeof x === 'string') : [];
      this.data = d;
    } catch { /* storage unavailable or damaged: start fresh */ }
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
    this.profile?.save?.(this.export());
    for (const fn of this.listeners) fn();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get stats() { return this.profile?.stats?.() || this.data.stats; }

  // ---- what you own
  // An item is yours when its goal is met. A connected profile can also grant items outright
  // (purchases, event rewards) through `owns(slot, id)`.
  isUnlocked(slot, id) {
    if (BODY[slot]) return Object.hasOwn(BODY[slot].options, id); // body options are always free
    const item = ITEMS[slot]?.[id];
    if (!item) return false;
    if (this.profile?.owns?.(slot, id)) return true;
    if (this.grants.some((fn) => fn(slot, id))) return true;
    const u = item.unlock;
    if (u.need === 'free') return true;
    if (u.need === 'group') return this.profile?.inGroup ? !!this.profile.inGroup() : this.hasGroup();
    return (this.stats[u.need] || 0) >= u.n;
  }

  // { have, need, text, done } for the unlock line under an item
  progress(slot, id) {
    const u = ITEMS[slot]?.[id]?.unlock;
    if (!u || u.need === 'free') return { have: 1, need: 1, done: true, text: 'Free for everyone' };
    if (u.need !== 'group' && this.grants.some((fn) => fn(slot, id)) && (this.stats[u.need] || 0) < u.n) return { have: 1, need: 1, done: true, text: 'Earned on the season pass' };
    if (u.need === 'group') {
      const done = this.isUnlocked(slot, id);
      return { have: +done, need: 1, done, text: done ? 'Yours as a fundraiser member' : 'Enter your fundraising group on the title screen' };
    }
    const have = Math.min(u.n, this.stats[u.need] || 0);
    const [verb, one, many] = STAT_LABELS[u.need];
    return { have, need: u.n, done: have >= u.n, text: `${verb} ${u.n} ${u.n === 1 ? one : many}` };
  }

  unlockedIds() {
    const out = [];
    for (const s of SLOTS) for (const id of Object.keys(ITEMS[s])) if (this.isUnlocked(s, id)) out.push(`${s}:${id}`);
    return out;
  }
  get unlockedCount() { return this.unlockedIds().length; }

  // ---- what you wear
  // The look saved for a fighter (roster index), with anything you no longer own swapped for the default.
  lookFor(index) {
    const def = ROSTER[index];
    if (!def) return { ...DEFAULT_LOOK };
    const look = sanitizeLook(this.data.looks[def.id]);
    for (const s of SLOTS) if (!this.isUnlocked(s, look[s])) look[s] = DEFAULT_LOOK[s];
    return look;
  }

  setLook(index, look) {
    const def = ROSTER[index];
    if (!def) return;
    const clean = sanitizeLook(look);
    for (const s of SLOTS) if (!this.isUnlocked(s, clean[s])) clean[s] = this.lookFor(index)[s];
    this.data.looks[def.id] = clean;
    this.save();
  }

  // every fighter's look by fighter id, as sent to an online host (only the ones you changed)
  allLooks() {
    const out = {};
    ROSTER.forEach((def, i) => { const l = this.lookFor(i); if (!sameLook(l, DEFAULT_LOOK)) out[def.id] = l; });
    return out;
  }

  get favourite() { return this.data.favourite; }
  set favourite(i) { this.data.favourite = i; this.save(); }

  // ---- earning
  // Called after every match you played in. Returns the items that just unlocked.
  recordMatch({ won = false, rounds = 0, kos = 0 } = {}) {
    if (!this.profile?.stats) {
      const st = this.data.stats;
      st.matches++;
      if (won) st.wins++;
      st.rounds += Math.max(0, rounds | 0);
      st.kos += Math.max(0, kos | 0);
    }
    this.profile?.recordMatch?.({ won, rounds, kos });
    return this.collectNew();
  }

  // Items unlocked since they were last announced (also catches a fundraising group typed in later).
  collectNew() {
    const seen = new Set(this.data.seen);
    const fresh = this.unlockedIds().filter((k) => !seen.has(k));
    if (fresh.length) this.data.seen.push(...fresh);
    this.save();
    return fresh.map((k) => { const [slot, id] = k.split(':'); return { slot, id, item: ITEMS[slot][id] }; });
  }

  export() { return JSON.parse(JSON.stringify(this.data)); }

  // Other ways to own an item outright, such as season pass tiers (progression.js): fn(slot, id) -> true when owned.
  grantedBy(fn) { this.grants.push(fn); }

  // ---- profiles
  // Player profiles plug in here. An adapter may provide any of:
  //   stats()                 -> { matches, wins, rounds, kos } from the account (replaces local counts)
  //   owns(slot, id)          -> true for items granted outright (store, events, admin gifts)
  //   inGroup()               -> true when the account belongs to a fundraising group
  //   looks                   -> { [fighterId]: look } saved on the account, merged over the local ones
  //   recordMatch(result)     -> sends a finished match to the account
  //   save(wardrobeData)      -> stores looks and favourite on the account
  connectProfile(adapter) {
    this.profile = adapter || null;
    if (adapter?.looks) for (const [id, look] of Object.entries(adapter.looks)) if (ROSTER.some((d) => d.id === id)) this.data.looks[id] = sanitizeLook(look);
    for (const fn of this.listeners) fn();
  }
}

export const wardrobe = new Wardrobe();
