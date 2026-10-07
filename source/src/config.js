// Shared constants, the fighter roster, move data and default key bindings.

import { padLabel } from './padmap.js';
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

export const ARENA = {
  radius: 17,          // playable radius (inner face of the wall)
  wallHeight: 1.1,
  pillarRadius: 11.2,  // pillars stand on this circle
  pillarCount: 4,
  pillarSize: 0.85,    // collision radius of a pillar
};

// Game modes. Fight is a quick match against the CPU, Fight online is the 30-second public queue,
// Tournament is team-against-team on the Badlands with friendly fire and revives, Training is the tutorial and practice room.
// durability multiplies every fighter's health so fights last longer and team tactics matter.
export const MODES = {
  cpu:        { label: 'Versus CPU', map: 'coliseum', durability: 1.7, powerups: true, friendlyFire: false, revive: false },
  queue:      { label: 'Online brawl', map: 'coliseum', durability: 1.7, powerups: true, friendlyFire: false, revive: false },
  tournament: { label: 'Tournament', map: 'badlands', durability: 2.6, powerups: true, friendlyFire: true, revive: true },
  // tutorial and practice room: you and a training dummy, nobody can be knocked out, gear is placed by the lesson
  practice:   { label: 'Training', map: 'coliseum', durability: 1, powerups: true, friendlyFire: false, revive: false },
  // King of the hill: hold the glowing ring alone to score; knocked-out fighters come back after a few seconds
  hill:       { label: 'King of the hill', map: 'coliseum', durability: 1.4, powerups: true, friendlyFire: false, revive: false, hill: true },
  // the 2v2 online queue: two teams of two, CPUs fill empty places
  duo:        { label: 'Online 2v2', map: 'coliseum', durability: 1.9, powerups: true, friendlyFire: false, revive: false },
  // ranked 1v1: the same fight for both players, so no power-ups; best of three for rating
  ranked:     { label: 'Ranked 1v1', map: 'coliseum', durability: 1.7, powerups: false, friendlyFire: false, revive: false },
  // the arcade ladder: one CPU after another, then the boss
  arcade:     { label: 'Arcade', map: 'coliseum', durability: 1.5, powerups: true, friendlyFire: false, revive: false },
};
// Battlegrounds. The hazard arenas are the coliseum's size; the Badlands is the big tournament canyon.
// 'random' (the default for quick fights and the online queue) picks one of RANDOM_ARENAS each match.
export const ARENAS = {
  coliseum: { label: 'Coliseum', hint: 'Moonlit stone ring, no hazards.' },
  bridge:   { label: 'Sky Bridge', hint: 'The bridge crumbles from the gates inward. Falling off is a knockout.' },
  foundry:  { label: 'Foundry', hint: 'Fire vents erupt from the floor. Step off a grate when it glows.' },
  storm:    { label: 'Eye of the Storm', hint: 'A storm wall closes in three times a round. Stay inside the ring.' },
  badlands: { label: 'Badlands', hint: 'The huge tournament canyon, with healing springs.' },
};
export const ARENA_CHOICES = ['random', ...Object.keys(ARENAS)];
export const RANDOM_ARENAS = ['coliseum', 'bridge', 'foundry', 'storm'];
export function pickArena(choice) { return ARENAS[choice] ? choice : RANDOM_ARENAS[Math.floor(Math.random() * RANDOM_ARENAS.length)]; }
export function arenaLabel(choice) { return ARENAS[choice]?.label || 'Random'; }

// King of the hill. The ring sits on one of `spots` and moves every `moveEvery` seconds; whoever stands in
// it alone (or with only teammates) scores a point a second. First to `target` takes the round; after
// `limit` seconds the highest score does. Knocked-out fighters are back after `respawn` seconds.
export const HILL = { radius: 3.2, target: 25, limit: 120, moveEvery: 22, respawn: 3.5, invuln: 1.6,
  spots: [[0, 0], [7.2, 0], [-7.2, 0], [0, 7.2], [0, -7.2]] };
export function modeRules(mode) { return { mode, ...(MODES[mode] || MODES.cpu) }; }

// Team tactics and the wider move set.
//   backstab  hits landing from behind deal extra damage, cannot be blocked and always stagger
//   parry     a block raised just before a melee hit stops it dead and staggers the attacker
//   formation fighters standing near a living teammate take less damage
//   revive    (tournament) a downed fighter can be pulled back up by a teammate standing over them
export const COMBAT = {
  backstabMult: 1.6, backstabDot: -0.3,
  parryWindow: 0.18, parryStagger: 0.75,
  formationRange: 5, formationGuard: 0.85,
  downedTime: 12, reviveRange: 1.9, reviveTime: 2.4, reviveHp: 0.35,
  friendlyFireMult: 0.6,
};

// Power-ups float above pads on the arena floor; walk through one to take it.
// share is the chance weight when a pad picks what to spawn next.
export const POWERUPS = {
  heal:   { label: 'Health', color: 0x5dff7a, share: 3, hint: 'Restores 40% health over two seconds' },
  shield: { label: 'Shield', color: 0x6fc8ff, share: 2, hint: 'A barrier that soaks 35% health worth of damage' },
  rage:   { label: 'Rage', color: 0xff4a2a, share: 2, hint: '+30% damage for 10 seconds' },
  haste:  { label: 'Haste', color: 0xc6ff4a, share: 2, hint: 'Faster movement and stamina for 10 seconds' },
  mana:   { label: 'Mana', color: 0x4a7aff, share: 2, hint: 'Fills the blue bar' },
  cloak:  { label: 'Cloak', color: 0xb070ff, share: 1, hint: 'Invisible for 5 seconds: sneak behind a foe' },
  vamp:   { label: 'Vampire', color: 0xd01a4a, share: 1, hint: 'Your hits heal you for 10 seconds' },
  // gear: `weapon` goes in the fighter's hand, `item` goes on the ability bar, `armor` is worn
  sword:  { label: 'Longsword', color: 0xdfe8f2, share: 1.3, weapon: 'sword', hint: 'Punches become sword slashes' },
  axe:    { label: 'Battle Axe', color: 0xe0a060, share: 1, weapon: 'axe', hint: 'Heavy chops that hit hard' },
  hammer: { label: 'War Hammer', color: 0xb8c0cc, share: 1, weapon: 'hammer', hint: 'Crushing blows that floor foes' },
  plate:  { label: 'Iron Armor', color: 0x9aa6b8, share: 1, armor: true, hint: 'Helm and breastplate soak hits' },
  pistol: { label: 'Hand Cannon', color: 0xffc04a, share: 1.3, item: 'gun_pistol', hint: 'A pistol with 12 shots' },
  shotgun: { label: 'Scattergun', color: 0xff8a3a, share: 1, item: 'gun_shotgun', hint: 'A shotgun with 6 shells' },
  rifle:  { label: 'Rail Rifle', color: 0x6af0ff, share: 0.7, item: 'gun_rifle', hint: 'Four piercing rail shots' },
  tome_fire: { label: 'Fireball', color: 0xff6a1c, share: 1.1, item: 'sp_fireball', spell: true, hint: 'Spell: three blazing fireballs' },
  tome_chain: { label: 'Chain Lightning', color: 0xfff27a, share: 1, item: 'sp_chain', spell: true, hint: 'Spell: lightning through every foe in line' },
  tome_meteor: { label: 'Meteor Storm', color: 0xff3a1a, share: 0.7, item: 'sp_meteor', spell: true, hint: 'Spell: a meteor on the nearest foe' },
  tome_frost: { label: 'Frost Nova', color: 0x9fe8ff, share: 0.8, item: 'sp_frostnova', spell: true, hint: 'Spell: freezes everyone around you' },
  tome_heal: { label: 'Healing Light', color: 0x7affa0, share: 1, item: 'sp_heal', spell: true, hint: 'Spell: restores 35% health' },
};
export const POWERUP_IDS = Object.keys(POWERUPS);

// Melee weapons replace bare-handed punches while they last (`hits` landed blows, then they break).
export const WEAPONS = {
  sword:  { label: 'Longsword', color: 0xdfe8f2, damage: 1.45, range: 0.6, hits: 16, knock: 1.1, sound: 'blade' },
  axe:    { label: 'Battle Axe', color: 0xe0a060, damage: 1.75, range: 0.45, hits: 12, knock: 1.3, sound: 'blade', bleed: 2 },
  hammer: { label: 'War Hammer', color: 0xb8c0cc, damage: 1.6, range: 0.5, hits: 12, knock: 1.7, sound: 'crush', heavy: true },
};
export const WEAPON_IDS = Object.keys(WEAPONS);
// Iron Armor soaks this share of incoming damage until it has taken `ARMOR_POINTS` x max health.
export const ARMOR_SOAK = 0.4;
export const ARMOR_POINTS = 0.5;
// The ability bar holds this many guns and spells; picking up one you already carry adds its charges.
export const BELT_SIZE = 4;

export const GRAVITY = 26;
export const ENERGY_MAX = 100;
export const SPECIAL_COST = 50;
export const GUARD_MAX = 100;

// Stamina drains on attacks, blocked hits, dodges and sprinting, and refills after a short pause.
// At zero a fighter is exhausted (slower, weaker, no dodge or sprint) until it climbs back to `recoverAt`.
export const STAMINA_MAX = 100;
export const STAMINA = {
  jump: 6, dodge: 22, sprint: 16, blockPerDamage: 0.6,
  regen: 26, regenBlocking: 9, delay: 0.7, recoverAt: 35,
  exhaustedSpeed: 0.78, exhaustedDamage: 0.72, sprintSpeed: 1.5,
};
export const DODGE = { duration: 0.34, invuln: 0.24, speed: 13 };

// Base movement in metres per second, multiplied by each fighter's speed stat.
export const BASE_SPEED = 5.4;

// Frame data is in seconds. `next` lists the moves this one can chain into
// when the same button (or the other attack button) is pressed in time.
export const MOVES = {
  jab1: { kind: 'punch', startup: 0.07, active: 0.08, recovery: 0.16, damage: 5, range: 1.55, arc: 1.4,
          knock: 2.6, hitstun: 0.3, lunge: 2.2, stamina: 5, chain: { punch: 'jab2', kick: 'kick1' } },
  jab2: { kind: 'punch', startup: 0.07, active: 0.08, recovery: 0.16, damage: 5, range: 1.55, arc: 1.4,
          knock: 2.6, hitstun: 0.3, lunge: 2.2, stamina: 5, chain: { punch: 'hook', kick: 'kick1' } },
  hook: { kind: 'punch', startup: 0.13, active: 0.1, recovery: 0.32, damage: 10, range: 1.7, arc: 1.7,
          knock: 7.5, hitstun: 0.5, lunge: 3.2, heavy: true, stamina: 9, chain: {} },
  kick1: { kind: 'kick', startup: 0.16, active: 0.12, recovery: 0.3, damage: 10, range: 2.0, arc: 1.3,
           knock: 6.5, hitstun: 0.45, lunge: 2.6, stamina: 9, chain: { kick: 'kick2' } },
  kick2: { kind: 'kick', startup: 0.2, active: 0.14, recovery: 0.42, damage: 13, range: 2.1, arc: 2.4,
           knock: 9, hitstun: 0.6, lunge: 2.0, heavy: true, knockdown: true, stamina: 12, chain: {} },
  airkick: { kind: 'kick', startup: 0.06, active: 0.5, recovery: 0.2, damage: 10, range: 1.7, arc: 1.6,
             knock: 8, hitstun: 0.5, lunge: 0, heavy: true, knockdown: true, air: true, stamina: 8, chain: {} },
};

export const SPECIALS = {
  fireball: { label: 'Hellfire Orb', startup: 0.28, recovery: 0.32, hint: 'Hurls a blazing fireball' },
  frost:    { label: 'Glacial Breath', startup: 0.3, recovery: 0.4, hint: 'Freezes enemies in a cone' },
  slam:     { label: 'Quake Slam', startup: 0.5, recovery: 0.45, hint: 'Leaps and smashes the ground' },
  venom:    { label: 'Venom Rush', startup: 0.12, recovery: 0.35, hint: 'Poisoned dash through foes' },
  storm:    { label: 'Storm Call', startup: 0.35, recovery: 0.35, hint: 'Lightning strikes the nearest foe' },
  shadow:   { label: 'Shadow Step', startup: 0.12, recovery: 0.4, hint: 'Teleports behind a foe and strikes' },
  spear:    { label: 'Chain Spear', startup: 0.22, recovery: 0.38, hint: 'Harpoons a foe and drags them in' },
  ironwill: { label: 'Iron Will', startup: 0.3, recovery: 0.3, hint: 'Armors up, shrugs off hits, hits harder' },
};

// Three castable skills per fighter, themed by class, paid for with the blue mana bar and gated by a cooldown.
// Warriors fight up close, Ranged fighters shoot, Mages cast spells from afar.
// type: bolt (projectile, `count` for a fan), nova (burst around you), wave (cone in front; short = a heavy melee blow),
//       leap (dash strike at the nearest foe), beam (instant line that pierces everyone in it),
//       smite (marks the nearest foe in range, then strikes that spot after `delay`).
// Riders on a hit: burn/poison/bleed (damage over time), slow, stun, freeze, drain (share of damage healed), knockdown, unblockable.
// pose picks the cast animation from the special-move poses in fighterModel.js.
export const SKILLS = {
  // Titan, warrior
  mountainfist: { label: 'Mountain Fist', type: 'wave', cost: 22, cooldown: 6, startup: 0.3, recovery: 0.35, pose: 'slam',
                  color: 0xffb04a, length: 2.7, arc: 0.9, damage: 16, knock: 12, knockdown: true, hint: 'A colossal haymaker that sends a foe flying' },
  tremor:       { label: 'Tremor Stomp', type: 'nova', cost: 24, cooldown: 9, startup: 0.32, recovery: 0.3, pose: 'slam',
                  color: 0xffdd77, radius: 3.3, damage: 9, knock: 5, stun: 0.9, hint: 'Stomps the ground and stuns everyone close by' },
  avalanche:    { label: 'Avalanche Charge', type: 'leap', cost: 22, cooldown: 8, startup: 0.18, recovery: 0.35, pose: 'venom',
                  color: 0xc8a070, range: 7.5, damage: 13, knock: 10, knockdown: true, hint: 'Charges into the nearest foe and bowls them over' },
  // Onyx, warrior
  shatter:      { label: 'Shatter Strike', type: 'wave', cost: 24, cooldown: 8, startup: 0.32, recovery: 0.35, pose: 'slam',
                  color: 0xd0e4ff, length: 4, arc: 0.6, damage: 12, knock: 9, knockdown: true, hint: 'Smashes the floor, knocking down everything just ahead' },
  guardcrush:   { label: 'Guard Crusher', type: 'wave', cost: 20, cooldown: 6, startup: 0.24, recovery: 0.3, pose: 'ironwill',
                  color: 0x9fb4d0, length: 2.5, arc: 0.8, damage: 11, knock: 7, unblockable: true, stun: 0.6, hint: 'An iron blow that smashes through any block' },
  cyclone:      { label: 'Iron Cyclone', type: 'nova', cost: 24, cooldown: 9, startup: 0.22, recovery: 0.35, pose: 'ironwill',
                  color: 0xb8c4d8, radius: 2.9, damage: 11, knock: 8, hint: 'Spins with iron fists, hitting everyone around you' },
  // Kane, warrior
  bloodrush:    { label: 'Blood Rush', type: 'leap', cost: 20, cooldown: 7, startup: 0.14, recovery: 0.32, pose: 'venom',
                  color: 0xff3030, range: 8, damage: 11, knock: 7, drain: 0.4, hint: 'Lunges at the nearest foe and drinks their blood' },
  reaver:       { label: 'Reaver Slash', type: 'wave', cost: 20, cooldown: 6, startup: 0.18, recovery: 0.3, pose: 'spear',
                  color: 0xff5a4a, length: 2.6, arc: 1.0, damage: 12, knock: 6, drain: 0.6, hint: 'A savage slash that heals you for part of the damage' },
  crimsonwhirl: { label: 'Crimson Whirl', type: 'nova', cost: 22, cooldown: 9, startup: 0.2, recovery: 0.32, pose: 'ironwill',
                  color: 0xd01a2a, radius: 2.8, damage: 8, knock: 6, bleed: 4, hint: 'A spinning cut that leaves everyone around you bleeding' },
  // Viper, ranged
  spit:         { label: 'Venom Spit', type: 'bolt', cost: 16, cooldown: 4, startup: 0.16, recovery: 0.26, pose: 'spear',
                  color: 0x9dff3a, glow: 0x5fd010, speed: 25, life: 0.8, size: 0.5, damage: 5, poison: 4, knock: 3, hint: 'A glob of venom that poisons' },
  fangvolley:   { label: 'Fang Volley', type: 'bolt', cost: 22, cooldown: 7, startup: 0.2, recovery: 0.3, pose: 'fireball',
                  color: 0xd8ff8a, glow: 0x7fd030, count: 5, spread: 0.16, speed: 27, life: 0.65, size: 0.38, damage: 4, poison: 1.5, knock: 2, hint: 'A fan of five venom darts' },
  piercingfang: { label: 'Piercing Fang', type: 'beam', cost: 24, cooldown: 9, startup: 0.3, recovery: 0.3, pose: 'spear',
                  color: 0xc6ff4a, length: 12, width: 0.9, damage: 10, poison: 3, knock: 5, hint: 'A dart that passes through every foe in line' },
  // Shade, ranged
  kunai:        { label: 'Shadow Kunai', type: 'bolt', cost: 16, cooldown: 4, startup: 0.14, recovery: 0.24, pose: 'fireball',
                  color: 0xd8b0ff, glow: 0x8a3cff, count: 3, spread: 0.1, speed: 32, life: 0.55, size: 0.36, damage: 5, knock: 3, hint: 'Three quick throwing knives' },
  voidbolt:     { label: 'Soul Dagger', type: 'bolt', cost: 20, cooldown: 6, startup: 0.2, recovery: 0.3, pose: 'spear',
                  color: 0xb070ff, glow: 0x8a3cff, speed: 22, life: 0.9, size: 0.7, damage: 9, drain: 1, knock: 4, hint: 'A cursed dagger that steals health from whoever it hits' },
  phantomlance: { label: 'Phantom Lance', type: 'beam', cost: 24, cooldown: 9, startup: 0.28, recovery: 0.32, pose: 'spear',
                  color: 0xe08bff, length: 12, width: 0.9, damage: 11, stun: 0.6, knock: 5, hint: 'A spectral lance that pierces and stuns everyone in line' },
  // Ember, mage
  meteor:       { label: 'Meteor', type: 'smite', cost: 28, cooldown: 10, startup: 0.35, recovery: 0.3, pose: 'storm',
                  color: 0xff7a1c, range: 14, radius: 2.3, delay: 0.75, damage: 16, knock: 8, knockdown: true, burn: 3, fx: 'meteor', hint: 'Calls a meteor down on the nearest foe' },
  flamelance:   { label: 'Flame Lance', type: 'beam', cost: 22, cooldown: 7, startup: 0.26, recovery: 0.3, pose: 'fireball',
                  color: 0xff9a3a, length: 11, width: 1.0, damage: 9, burn: 3, knock: 5, hint: 'A searing ray that sets everyone in line alight' },
  emberspray:   { label: 'Ember Spray', type: 'bolt', cost: 18, cooldown: 5, startup: 0.18, recovery: 0.28, pose: 'fireball',
                  color: 0xffb347, glow: 0xff5a00, count: 3, spread: 0.26, speed: 22, life: 0.8, size: 0.5, damage: 5, burn: 2, knock: 3, hint: 'Three burning embers in a spread' },
  // Frost, mage
  shards:       { label: 'Ice Shards', type: 'bolt', cost: 18, cooldown: 5, startup: 0.2, recovery: 0.3, pose: 'fireball',
                  color: 0xbfefff, glow: 0x5fc8ff, count: 3, spread: 0.24, speed: 21, life: 0.85, size: 0.6, damage: 6, slow: 2.5, knock: 3, hint: 'Three shards that chill and slow' },
  glacier:      { label: 'Glacial Spike', type: 'smite', cost: 26, cooldown: 10, startup: 0.3, recovery: 0.3, pose: 'storm',
                  color: 0x9fe8ff, range: 13, radius: 2.0, delay: 0.6, damage: 10, knock: 4, freeze: 1.2, fx: 'ice', hint: 'Ice erupts under a distant foe and freezes them solid' },
  frostray:     { label: 'Frost Ray', type: 'beam', cost: 22, cooldown: 7, startup: 0.26, recovery: 0.3, pose: 'fireball',
                  color: 0x6fd8ff, length: 11, width: 1.0, damage: 8, slow: 3.5, knock: 3, hint: 'A freezing ray that slows everyone in line' },
  // Volt, mage
  spark:        { label: 'Spark Bolt', type: 'bolt', cost: 18, cooldown: 5, startup: 0.18, recovery: 0.28, pose: 'storm',
                  color: 0xfff27a, glow: 0xffe14a, speed: 30, life: 0.6, size: 0.55, damage: 8, stun: 0.7, knock: 2, hint: 'A crackling bolt that stuns' },
  lightningarc: { label: 'Lightning Arc', type: 'beam', cost: 24, cooldown: 8, startup: 0.26, recovery: 0.3, pose: 'storm',
                  color: 0xfff6a8, length: 12, width: 1.0, damage: 10, stun: 0.5, knock: 4, hint: 'A bolt of lightning that jumps through everyone in line' },
  balllightning: { label: 'Ball Lightning', type: 'bolt', cost: 26, cooldown: 10, startup: 0.3, recovery: 0.3, pose: 'fireball',
                  color: 0xfff27a, glow: 0xb0a0ff, speed: 10, life: 2.2, size: 1.4, damage: 15, stun: 1.0, knock: 8, knockdown: true, hint: 'A slow, huge orb of lightning that floors whoever it touches' },

  // Guns and spell tomes picked up from the arena floor. They sit on the ability bar, cost no mana
  // and are used up: `charges` is the ammo or casts a pickup gives. `gun` draws the weapon in hand.
  gun_pistol:  { label: 'Hand Cannon', type: 'bolt', item: true, gun: 'pistol', charges: 12, startup: 0.08, recovery: 0.16, pose: 'aim',
                 color: 0xffe08a, glow: 0xff9a2a, speed: 46, life: 0.5, size: 0.2, stretch: 4, damage: 7, knock: 3, hint: 'Quick shots' },
  gun_shotgun: { label: 'Scattergun', type: 'bolt', item: true, gun: 'shotgun', charges: 6, startup: 0.14, recovery: 0.42, pose: 'aim2',
                 color: 0xffc070, glow: 0xff6a1a, count: 6, spread: 0.09, speed: 40, life: 0.28, size: 0.17, stretch: 4, damage: 4.5, knock: 7, hint: 'Six pellets, brutal up close' },
  gun_rifle:   { label: 'Rail Rifle', type: 'beam', item: true, gun: 'rifle', charges: 4, startup: 0.3, recovery: 0.36, pose: 'aim2',
                 color: 0x6af0ff, length: 18, width: 0.55, damage: 15, knock: 8, knockdown: true, hint: 'Pierces every foe in line' },
  sp_fireball:  { label: 'Fireball', type: 'bolt', item: true, spell: true, charges: 3, startup: 0.22, recovery: 0.3, pose: 'fireball',
                  color: 0xff7a1c, glow: 0xff3a00, speed: 20, life: 1.1, size: 1.1, damage: 14, burn: 3, knock: 8, knockdown: true, hint: 'A blazing fireball' },
  sp_chain:     { label: 'Chain Lightning', type: 'beam', item: true, spell: true, charges: 3, startup: 0.24, recovery: 0.3, pose: 'storm',
                  color: 0xfff6a8, length: 14, width: 1.1, damage: 12, stun: 0.8, knock: 5, hint: 'Lightning through every foe in line' },
  sp_meteor:    { label: 'Meteor Storm', type: 'smite', item: true, spell: true, charges: 2, startup: 0.32, recovery: 0.3, pose: 'storm',
                  color: 0xff4a1a, range: 16, radius: 2.8, delay: 0.7, damage: 20, knock: 9, knockdown: true, burn: 3, fx: 'meteor', hint: 'A meteor on the nearest foe' },
  sp_frostnova: { label: 'Frost Nova', type: 'nova', item: true, spell: true, charges: 2, startup: 0.2, recovery: 0.32, pose: 'ironwill',
                  color: 0x9fe8ff, radius: 3.8, damage: 8, knock: 3, freeze: 1.6, hint: 'Freezes everyone around you' },
  sp_heal:      { label: 'Healing Light', type: 'heal', item: true, spell: true, charges: 2, startup: 0.2, recovery: 0.25, pose: 'ironwill',
                  color: 0x7affa0, healPct: 0.35, duration: 1.6, hint: 'Restores 35% health' },
};
export const SKILL_IDS = Object.keys(SKILLS);

// Team play: fighters on one team cannot hurt each other and the last team standing takes the round.
export const TEAM_COLORS = [0xd23a2a, 0x2f6fe0, 0x3fae4a, 0xe0b030];
export const TEAM_DEFAULT_NAMES = ['Crimson Legion', 'Azure Order', 'Verdant Clan', 'Golden Host'];
export const TEAM_COUNTS = [0, 2, 3, 4];
export function cleanTeamName(s, i) {
  return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18) || TEAM_DEFAULT_NAMES[i] || `Team ${i + 1}`;
}

// Colours are linear-ish hex values for MeshStandardMaterial.
export const ROSTER = [
  { id: 'ember', skin: 0xc68a5e, hair: 0x1a0d08, hairStyle: 'topknot', beard: false, name: 'Ember', title: 'The Pyre Monk', gi: 0xd8641c, trim: 0x2a120a, eyes: 0xffb347,
    special: 'fireball', speed: 1.0, power: 1.0, health: 100, scale: 1.0, accessory: 'topknot', skills: ['meteor', 'flamelance', 'emberspray'], role: 'Mage' },
  { id: 'frost', skin: 0xe8c4a8, hair: 0xd8e4f0, hairStyle: 'long', beard: true, name: 'Frost', title: 'Warden of the North', gi: 0x2f7fd0, trim: 0x0d1f33, eyes: 0x9fe8ff,
    special: 'frost', speed: 0.98, power: 0.95, health: 104, scale: 1.0, accessory: 'none', skills: ['shards', 'glacier', 'frostray'], role: 'Mage' },
  { id: 'titan', skin: 0x8a5a3c, hair: 0x1a120c, hairStyle: 'bald', beard: true, name: 'Titan', title: 'The Mountain', gi: 0x8b6a3e, trim: 0x2b2116, eyes: 0xffdd77,
    special: 'slam', speed: 0.84, power: 1.2, health: 125, scale: 1.16, accessory: 'pads', skills: ['mountainfist', 'tremor', 'avalanche'], role: 'Warrior' },
  { id: 'viper', skin: 0xb88a5a, hair: 0x4f9a1c, hairStyle: 'mohawk', beard: false, name: 'Viper', title: 'Fang of the Marsh', gi: 0x3f9b3a, trim: 0x10240f, eyes: 0xc6ff4a,
    special: 'venom', speed: 1.12, power: 0.9, health: 92, scale: 0.96, accessory: 'none', skills: ['spit', 'fangvolley', 'piercingfang'], role: 'Ranged' },
  { id: 'volt', skin: 0xdcae86, hair: 0xf0e070, hairStyle: 'spiky', beard: false, name: 'Volt', title: 'Thunder Herald', gi: 0xe0c13a, trim: 0x2e2708, eyes: 0xfff6a8,
    special: 'storm', speed: 1.04, power: 0.98, health: 98, scale: 1.0, accessory: 'horns', skills: ['spark', 'lightningarc', 'balllightning'], role: 'Mage' },
  { id: 'shade', skin: 0xa87a58, hair: 0x120a18, hairStyle: 'short', beard: false, mask: true, name: 'Shade', title: 'The Unseen', gi: 0x6b3fa8, trim: 0x170c26, eyes: 0xe08bff,
    special: 'shadow', speed: 1.1, power: 0.92, health: 94, scale: 0.98, accessory: 'hood', skills: ['kunai', 'voidbolt', 'phantomlance'], role: 'Ranged' },
  { id: 'kane', skin: 0x6a4028, hair: 0x0e0808, hairStyle: 'braids', beard: true, name: 'Kane', title: 'Blood Hunter', gi: 0xa8202c, trim: 0x22070a, eyes: 0xff5a4a,
    special: 'spear', speed: 1.0, power: 1.03, health: 100, scale: 1.02, accessory: 'none', skills: ['bloodrush', 'reaver', 'crimsonwhirl'], role: 'Warrior' },
  { id: 'onyx', skin: 0x4a3428, hair: 0x0a0a0c, hairStyle: 'bald', beard: false, name: 'Onyx', title: 'Iron Revenant', gi: 0x3a3d44, trim: 0x0b0c0e, eyes: 0xd0e4ff,
    special: 'ironwill', speed: 0.92, power: 1.1, health: 115, scale: 1.08, accessory: 'horns', skills: ['shatter', 'guardcrush', 'cyclone'], role: 'Warrior' },
];

export const ACTIONS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'block', 'special', 'jump', 'dash', 'skill1', 'skill2', 'skill3',
  'use', 'cycle', 'slot1', 'slot2', 'slot3', 'slot4'];
export const ACTION_LABELS = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right',
  punch: 'Punch', kick: 'Kick', block: 'Block (hold)', special: 'Special', jump: 'Jump',
  dash: 'Dodge (tap) / sprint (hold)', skill1: 'Skill 1', skill2: 'Skill 2', skill3: 'Skill 3',
  use: 'Use gun / spell', cycle: 'Next bar slot', slot1: 'Bar slot 1', slot2: 'Bar slot 2', slot3: 'Bar slot 3', slot4: 'Bar slot 4',
};

// KeyboardEvent.code values, so bindings work on any keyboard layout.
// P1's left hand moves (WASD, Shift), the right hand fights (J K I H) and casts (= - 0).
// The ability bar (guns and spell tomes picked up in the arena): P1 fires with E, Q picks the next slot, 1-4 fire a slot directly.
export const DEFAULT_BINDINGS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    punch: 'KeyJ', kick: 'KeyK', block: 'KeyH', special: 'KeyI', jump: 'Space',
    dash: 'ShiftLeft', skill1: 'Equal', skill2: 'Minus', skill3: 'Digit0',
    use: 'KeyE', cycle: 'KeyQ', slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    punch: 'Period', kick: 'Slash', block: 'Semicolon', special: 'Quote', jump: 'Enter',
    dash: 'ShiftRight', skill1: 'BracketRight', skill2: 'BracketLeft', skill3: 'Backslash',
    use: 'Comma', cycle: 'Backspace', slot1: '', slot2: '', slot3: '', slot4: '' },
  { up: 'Numpad8', down: 'Numpad5', left: 'Numpad4', right: 'Numpad6',
    punch: 'Numpad1', kick: 'Numpad2', block: 'Numpad3', special: 'Numpad7', jump: 'Numpad0',
    dash: 'NumpadDecimal', skill1: 'Numpad9', skill2: 'NumpadAdd', skill3: 'NumpadSubtract',
    use: 'NumpadEnter', cycle: 'NumpadMultiply', slot1: '', slot2: '', slot3: '', slot4: '' },
  { up: 'KeyY', down: 'KeyN', left: 'KeyB', right: 'KeyM',
    punch: 'KeyU', kick: 'KeyO', block: 'KeyL', special: 'Digit7', jump: 'Digit8',
    dash: 'KeyV', skill1: 'Digit6', skill2: 'Digit9', skill3: 'Digit5',
    use: 'KeyG', cycle: 'KeyT', slot1: '', slot2: '', slot3: '', slot4: '' },
];

export const PLAYER_COLORS = ['#ff6b3d', '#3db8ff', '#7dff6b', '#ffd23d'];

export const DIFFICULTY = {
  easy:   { label: 'Rookie',  reaction: 0.42, block: 0.15, aggression: 0.45, combo: 0.25, special: 0.35, accuracy: 0.6 },
  normal: { label: 'Fighter', reaction: 0.27, block: 0.38, aggression: 0.7,  combo: 0.55, special: 0.65, accuracy: 0.8 },
  hard:   { label: 'Veteran', reaction: 0.17, block: 0.6,  aggression: 0.85, combo: 0.8,  special: 0.85, accuracy: 0.92 },
  brutal: { label: 'Brutal',  reaction: 0.1,  block: 0.8,  aggression: 1.0,  combo: 1.0,  special: 1.0,  accuracy: 1.0 },
};

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Pad:')) { const [, c, fam] = code.split(':'); return padLabel(c, fam); }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'NumpadDecimal') return 'Num .';
  if (code === 'NumpadAdd') return 'Num +';
  if (code === 'NumpadSubtract') return 'Num -';
  if (code === 'NumpadMultiply') return 'Num *';
  if (code === 'NumpadEnter') return 'Num ↵';
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Enter: 'Enter',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[',
    BracketRight: ']', Minus: '-', Equal: '=', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt', Backquote: '`',
    Tab: 'Tab', Backspace: 'Bksp',
  };
  return map[code] || code;
}
