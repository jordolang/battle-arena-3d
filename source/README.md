# Battle Arena 3D

A 3D last-one-standing brawler in Three.js. 2 to 8 fighters, up to four people on one keyboard, CPU fighters fill the rest.
Play free-for-all or in 2 to 4 named teams. Every fighter has stamina, three castable skills matched to their class (Warrior, Ranged or Mage) and a special move.

## Play
- **Easiest:** open `index.html` in the repo root in Chrome, Edge, Firefox or Safari. It is one self-contained file
  (a copy of `dist/battle-arena.html`, which the build writes).
- **From source:** serve this folder with any static server (for example `python3 -m http.server`) and open `index.html`.
  ES modules need a server, so double-clicking `index.html` will not work.
- Rebuild the single-file versions after changing the source: `npm i --no-save esbuild && node tools/build.mjs`,
  then copy `dist/battle-arena.html` to the repo root as `index.html`.

## José Madrid Salsa fundraiser
- The title screen shows the José Madrid Salsa Battle Arena logo (`assets/jose-madrid-battle-arena-logo.webp`,
  a revamp of the official José Madrid Salsa badge; the build inlines it into the single file).
- Players must be enrolled in a José Madrid Salsa fundraising group. The title screen asks for the group's name or
  code, and Fight / Fight online stay locked until it is filled in. The value is remembered in the browser only;
  it is not yet checked against the fundraiser system.

## Online play (2 to 8 browsers)
- Open `index.html` from the repo root (or a hosted copy of it) in each player's browser and choose **Fight online**.
- One person picks **Host a room** and shares the 5-character code. Everyone else types it under **Join**.
  On a hosted page the lobby also shows an invite link (`?room=CODE`) that opens the join screen with the code filled in.
- In the room each player picks a fighter; the host sets fighters (2 to 8), rounds, CPU skill and sudden death, then starts.
  CPU fighters fill empty seats, a player who leaves mid-match is replaced by a CPU, and late joiners watch and fight next match.
- Online, each player uses the P1 keys (or arrows with K/L/;/O/Enter). Esc opens a menu but never pauses the shared match.
- Needs internet for the room code lookup (PeerJS's free public server); the match itself runs browser to browser over WebRTC.
  It cannot run inside the Claude Artifact preview, which blocks WebRTC: use the standalone file or a hosted copy.
- Very strict networks (some offices) can block direct connections; PeerJS's public relay servers are tried as a fallback.

How it works (`src/net/`): the host runs the only simulation. Remote players send input (movement plus running tap counters,
so a lost packet never drops a punch) and draw the match from 30 Hz snapshots, 100 ms behind the host for smooth interpolation.
Effects, announcer lines, the kill feed and every gameplay event are replayed on clients at the matching moment, so
`events` listeners (the audio pass) fire on every machine. `transport.js` wraps PeerJS; add `?net=local` to test with two tabs
of one browser and no network, or `?peerserver=host:port` to use your own PeerJS server.

## Controls (rebindable in the Controls screen, saved in the browser)
| | Move | Punch | Kick | Block | Special | Jump | Dodge / sprint | Skill 1 | Skill 2 | Skill 3 |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | W A S D | J | K | H | I | Space | Left Shift | = | - | 0 |
| P2 | Arrows | . | / | ; | ' | Enter | Right Shift | ] | [ | \\ |
| P3 | Numpad 8 4 5 6 | Num 1 | Num 2 | Num 3 | Num 7 | Num 0 | Num . | Num 9 | Num + | Num - |
| P4 | Y B N M | U | O | L | 7 | 8 | V | 6 | 9 | 5 |

P1's left hand moves and the right hand fights. Keys saved before this layout are reset to these defaults once.
Esc or P pauses. Menus: arrows/WASD, Enter, Esc. When every keyboard player is out, hold X to fast-forward.

Combos: punch ×3 (ends in a hook), punch-punch-kick, kick-kick (knockdown roundhouse), jump then kick (dive kick).
Block stops frontal hits but drains a guard meter that breaks. Specials cost half the blue mana bar.
Sudden death (default 75 s) brings in a closing ring of fire.

## Stamina, skills and teams
- **Stamina** (green bar): attacks, jumps, blocked hits, dodges and sprinting drain it; it refills after a short pause.
  At zero you are exhausted (slower, 28% weaker, no dodge or sprint, guard breaks faster) until it is back to 35.
- **Dodge / sprint**: tap to roll (brief invulnerability) in the held direction, or backwards; hold while moving to sprint.
- **Skills**: three per fighter, each unique and themed by class: Warriors strike up close, Ranged fighters shoot,
  Mages cast spells from a distance. Each is paid from the mana bar and then goes on cooldown.
  The chips under a player's card show each one; a dark fill is the cooldown, dim means not enough mana.
- **Teams**: set *Teams* to 2, 3 or 4 in the rules, name the teams, and pick each slot's team. Fighters wear their
  team's colours (dyed gi, pauldrons, tabard, floor ring). Teammates cannot hurt or target each other, and the last
  team with anyone standing wins the round. Online, the host sets the team count and names and each player picks a team;
  CPUs fill the smallest team.

## Roster (class · special · skills 1 to 3)
| Fighter | Class | Special | Skill 1 | Skill 2 | Skill 3 |
|---|---|---|---|---|---|
| Titan | Warrior | Quake Slam | Mountain Fist (huge launching punch) | Tremor Stomp (stun burst) | Avalanche Charge (knockdown rush) |
| Onyx | Warrior | Iron Will | Shatter Strike (knockdown floor smash) | Guard Crusher (unblockable blow) | Iron Cyclone (spin hits all around) |
| Kane | Warrior | Chain Spear | Blood Rush (lunge, heals you) | Reaver Slash (slash, heals you) | Crimson Whirl (spin, bleeds) |
| Viper | Ranged | Venom Rush | Venom Spit (poison glob) | Fang Volley (5 poison darts) | Piercing Fang (passes through a line) |
| Shade | Ranged | Shadow Step | Shadow Kunai (3 fast knives) | Soul Dagger (steals health) | Phantom Lance (piercing, stuns) |
| Ember | Mage | Hellfire Orb | Meteor (marked strike on a distant foe, burns) | Flame Lance (burning ray) | Ember Spray (3 burning embers) |
| Frost | Mage | Glacial Breath | Ice Shards (3 slowing shards) | Glacial Spike (marked strike, freezes) | Frost Ray (slowing ray) |
| Volt | Mage | Storm Call | Spark Bolt (stuns) | Lightning Arc (piercing ray, stuns) | Ball Lightning (slow huge orb, knockdown) |

Marked strikes (Meteor, Glacial Spike) show a circle under the target first; dodge out of it in time.

## Code map (`src/`)
- `main.js` boot and wiring · `game.js` renderer, fixed 120 Hz simulation, rounds and match flow
- `fighter.js` fighter state machine, movement, attacks, hit reactions · `fighterModel.js` procedural jointed model and poses
- `specials.js` special moves, skills and projectiles · `ai.js` CPU controller · `input.js` keyboard and human controller
- `arena.js` coliseum, lighting, crowd, fire ring, collision · `effects.js` pooled particles and FX
- `camera.js` framing camera · `hud.js` in-fight overlay · `ui.js` menus and key rebinding
- `net/session.js` online rooms, host sync and client playback · `net/transport.js` PeerJS links · `net/online-ui.js` online screens
- `events.js` event bus · `audio.js` empty hook for the sound pass · `config.js` roster, frame data, skills, stamina, teams, bindings, AI tuning

## Extension points for later passes
- **Audio:** subscribe to `events` (`hit`, `block`, `guardBreak`, `ko`, `swing`, `specialStart`, `special`, `thunder`,
  `spearPull`, `jump`, `land`, `wallHit`, `roundStart`, `fight`, `suddenDeath`, `roundEnd`, `matchEnd`, `skillStart`, `skill`,
  `skillFail`, `dodge`, `dodgeFail`, `exhausted`, `shieldBreak`) inside `audio.js`.
- **Online multiplayer:** built (see above). Every fighter is driven by a controller with `getIntent(fighter, world)`;
  remote players use `NetController` on the host. Online clients receive `events` too, with fighters resolved locally.
- Debug: `window.__arena.game.stats()`; `?autotest=8` starts an all-CPU match.

Three.js r180 and PeerJS 1.5.5 are vendored in `vendor/` (both MIT, see `vendor/three-LICENSE` and `vendor/peerjs-LICENSE`).
