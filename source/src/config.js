// Shared constants, the fighter roster, move data and default key bindings.

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
// Tournament is team-against-team on the Badlands with friendly fire and revives.
// durability multiplies every fighter's health so fights last longer and team tactics matter.
export const MODES = {
  cpu:        { label: 'Versus CPU', map: 'coliseum', durability: 1.7, powerups: true, friendlyFire: false, revive: false },
  queue:      { label: 'Online brawl', map: 'coliseum', durability: 1.7, powerups: true, friendlyFire: false, revive: false },
  tournament: { label: 'Tournament', map: 'badlands', durability: 2.6, powerups: true, friendlyFire: true, revive: true },
};
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
};
export const POWERUP_IDS = Object.keys(POWERUPS);

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
  { id: 'ember', name: 'Ember', title: 'The Pyre Monk', gi: 0xd8641c, trim: 0x2a120a, eyes: 0xffb347,
    special: 'fireball', speed: 1.0, power: 1.0, health: 100, scale: 1.0, accessory: 'topknot', skills: ['meteor', 'flamelance', 'emberspray'], role: 'Mage' },
  { id: 'frost', name: 'Frost', title: 'Warden of the North', gi: 0x2f7fd0, trim: 0x0d1f33, eyes: 0x9fe8ff,
    special: 'frost', speed: 0.98, power: 0.95, health: 104, scale: 1.0, accessory: 'none', skills: ['shards', 'glacier', 'frostray'], role: 'Mage' },
  { id: 'titan', name: 'Titan', title: 'The Mountain', gi: 0x8b6a3e, trim: 0x2b2116, eyes: 0xffdd77,
    special: 'slam', speed: 0.84, power: 1.2, health: 125, scale: 1.16, accessory: 'pads', skills: ['mountainfist', 'tremor', 'avalanche'], role: 'Warrior' },
  { id: 'viper', name: 'Viper', title: 'Fang of the Marsh', gi: 0x3f9b3a, trim: 0x10240f, eyes: 0xc6ff4a,
    special: 'venom', speed: 1.12, power: 0.9, health: 92, scale: 0.96, accessory: 'none', skills: ['spit', 'fangvolley', 'piercingfang'], role: 'Ranged' },
  { id: 'volt', name: 'Volt', title: 'Thunder Herald', gi: 0xe0c13a, trim: 0x2e2708, eyes: 0xfff6a8,
    special: 'storm', speed: 1.04, power: 0.98, health: 98, scale: 1.0, accessory: 'horns', skills: ['spark', 'lightningarc', 'balllightning'], role: 'Mage' },
  { id: 'shade', name: 'Shade', title: 'The Unseen', gi: 0x6b3fa8, trim: 0x170c26, eyes: 0xe08bff,
    special: 'shadow', speed: 1.1, power: 0.92, health: 94, scale: 0.98, accessory: 'hood', skills: ['kunai', 'voidbolt', 'phantomlance'], role: 'Ranged' },
  { id: 'kane', name: 'Kane', title: 'Blood Hunter', gi: 0xa8202c, trim: 0x22070a, eyes: 0xff5a4a,
    special: 'spear', speed: 1.0, power: 1.03, health: 100, scale: 1.02, accessory: 'none', skills: ['bloodrush', 'reaver', 'crimsonwhirl'], role: 'Warrior' },
  { id: 'onyx', name: 'Onyx', title: 'Iron Revenant', gi: 0x3a3d44, trim: 0x0b0c0e, eyes: 0xd0e4ff,
    special: 'ironwill', speed: 0.92, power: 1.1, health: 115, scale: 1.08, accessory: 'horns', skills: ['shatter', 'guardcrush', 'cyclone'], role: 'Warrior' },
];

export const ACTIONS = ['up', 'down', 'left', 'right', 'punch', 'kick', 'block', 'special', 'jump', 'dash', 'skill1', 'skill2', 'skill3'];
export const ACTION_LABELS = {
  up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right',
  punch: 'Punch', kick: 'Kick', block: 'Block (hold)', special: 'Special', jump: 'Jump',
  dash: 'Dodge (tap) / sprint (hold)', skill1: 'Skill 1', skill2: 'Skill 2', skill3: 'Skill 3',
};

// KeyboardEvent.code values, so bindings work on any keyboard layout.
// P1's left hand moves (WASD, Shift), the right hand fights (J K I H) and casts (= - 0).
export const DEFAULT_BINDINGS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    punch: 'KeyJ', kick: 'KeyK', block: 'KeyH', special: 'KeyI', jump: 'Space',
    dash: 'ShiftLeft', skill1: 'Equal', skill2: 'Minus', skill3: 'Digit0' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    punch: 'Period', kick: 'Slash', block: 'Semicolon', special: 'Quote', jump: 'Enter',
    dash: 'ShiftRight', skill1: 'BracketRight', skill2: 'BracketLeft', skill3: 'Backslash' },
  { up: 'Numpad8', down: 'Numpad5', left: 'Numpad4', right: 'Numpad6',
    punch: 'Numpad1', kick: 'Numpad2', block: 'Numpad3', special: 'Numpad7', jump: 'Numpad0',
    dash: 'NumpadDecimal', skill1: 'Numpad9', skill2: 'NumpadAdd', skill3: 'NumpadSubtract' },
  { up: 'KeyY', down: 'KeyN', left: 'KeyB', right: 'KeyM',
    punch: 'KeyU', kick: 'KeyO', block: 'KeyL', special: 'Digit7', jump: 'Digit8',
    dash: 'KeyV', skill1: 'Digit6', skill2: 'Digit9', skill3: 'Digit5' },
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
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'NumpadDecimal') return 'Num .';
  if (code === 'NumpadAdd') return 'Num +';
  if (code === 'NumpadSubtract') return 'Num -';
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
