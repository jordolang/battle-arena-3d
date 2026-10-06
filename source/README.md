# Battle Arena 3D

A 3D last-one-standing brawler in Three.js with three ways to play:
- **Fight**: you against 1 to 7 CPU fighters in the coliseum.
- **Fight online**: a 30-second public queue. Everyone who queues in the same 30 seconds fights in one free-for-all battle.
- **Tournament**: fundraising groups team up and fight a knockout bracket on the Badlands, run by an admin, with spectators and live chat.

Every fighter has stamina, three castable skills matched to their class (Warrior, Ranged or Mage) and a special move.
Power-ups, backstabs, parries and (in tournaments) friendly fire and revives make positioning and teamwork matter.

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
  code, and Fight online and fighting in a tournament stay locked until it is filled in (Fight versus the CPU and watching a tournament
  do not need one). The value is remembered in the browser only; it is not yet checked against the fundraiser system.
- In tournaments the group is the team: everyone who typed the same group (case and spacing don't matter) fights together.

## Fight online: the 30-second queue
- Choose **Fight online**, then **Join the queue**. The first person to queue opens a battle and a 30-second countdown;
  everyone who queues before it ends lands in the same battle (up to 8; it starts early when full). CPU fighters fill
  a battle up to 4. While waiting you pick your fighter and can copy an invite link (`?room=CODE`) for friends.
- After the battle everyone gets **Queue again**.
- How the queue works without a server: the queue opener claims a well-known PeerJS name (`queue-v4`). Anyone else who
  tries to claim it is told it is taken, asks its holder for the battle's room code, and joins that room. When the
  countdown ends the opener lets the name go, so the next person to queue opens the next battle.

## Tournaments
- **Admin**: on the Tournament screen fill in the name, start time and prize, the fighters per team (1 to 4), rounds to
  win a match and whether CPUs fill short teams. Share the tournament code (or the `?t=CODE` link) with the teams ahead
  of time. The code is saved in the admin's browser, so the same code works on the day. At the agreed time press
  **Open tournament room**, wait for the teams, **Draw the bracket**, then **Start** each match.
- **Fundraiser codes**: by default (**Who can fight: Fundraiser code**) only players who type a fundraiser code on the
  title screen can fight, and they join the team of the group the code belongs to; anyone can still watch. Codes come
  from two places: the José Madrid Salsa admin panel (website or desktop app), which the host checks with
  `POST https://www.josemadrid.net/api/arena/game-codes/verify`, or the **Fundraiser codes** list on the admin card
  (type a group name, **Make code**; saved only in that browser). Set **Who can fight** to **Any group name** to skip
  codes. `?codes-api=URL` points the check at another server for testing.
- **Teams**: enter your fundraiser code (or, if the admin made none, your group's name) on the title screen, open
  Tournament, type the tournament code and press **Fight for my group**. Pick your fighter in the lobby.
- **Viewers**: type the code and press **Watch**. While watching, the arrow keys pick which fighter the camera follows
  and up shows the whole field.
- **Chat**: press **T** in the lobby or during a match, Enter sends, Esc closes. The admin's messages are marked Admin,
  and the admin can remove anyone from the room (the ✕ by their name).
- Matches are team against team on the Badlands with friendly fire on (60% damage to teammates) and revives. The
  winner advances; a team with nobody in the room forfeits. Odd team counts get byes. The champion and the prize are
  announced in the lobby and the chat.
- **Livestreaming**: the admin's screen is a spectator view of every match plus the chat, so streaming it with OBS or
  any screen capture to YouTube or Twitch shows the whole tournament.
- Everything runs in the admin's browser over PeerJS (no server): keep that tab open and visible for the whole event,
  on a wired connection if possible. Up to 32 people (fighters and viewers) fit in one tournament room.

## Online play details
- Online, each player uses the P1 keys (or arrows with K/L/;/O/Enter). Esc opens a menu but never pauses the shared match.
- Needs internet for the room code lookup (PeerJS's free public server); the match itself runs browser to browser over WebRTC.
  It cannot run inside the Claude Artifact preview, which blocks WebRTC: use the standalone file or a hosted copy.
- Very strict networks (some offices) can block direct connections; PeerJS's public relay servers are tried as a fallback.

How it works (`src/net/`): the host runs the only simulation. Remote players send input (movement plus running tap counters,
so a lost packet never drops a punch) and draw the match from 30 Hz snapshots, 100 ms behind the host for smooth interpolation.
Effects, announcer lines, the kill feed and every gameplay event are replayed on clients at the matching moment, so
`events` listeners (the audio pass) fire on every machine. `transport.js` wraps PeerJS; add `?net=local` to test with
several tabs of one browser and no network, or `?peerserver=host:port` to use your own PeerJS server.

## Controls (rebindable in the Controls screen, saved in the browser)
| | Move | Punch | Kick | Block | Special | Jump | Dodge / sprint | Skill 1 | Skill 2 | Skill 3 | Use gun / spell | Next slot | Slots 1-4 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | W A S D | J | K | H | I | Space | Left Shift | = | - | 0 | E | Q | 1 2 3 4 |
| P2 | Arrows | . | / | ; | ' | Enter | Right Shift | ] | [ | \\ | , | Backspace | (unbound) |
| P3 | Numpad 8 4 5 6 | Num 1 | Num 2 | Num 3 | Num 7 | Num 0 | Num . | Num 9 | Num + | Num - | Num Enter | Num * | (unbound) |
| P4 | Y B N M | U | O | L | 7 | 8 | V | 6 | 9 | 5 | G | T | (unbound) |

P1's left hand moves and the right hand fights. Keys saved before this layout are reset to these defaults once.
Esc or P pauses. Menus: arrows/WASD, Enter, Esc. When every keyboard player is out, hold X to fast-forward.

Combos: punch ×3 (ends in a hook), punch-punch-kick, kick-kick (knockdown roundhouse), jump then kick (dive kick).
Block stops frontal hits but drains a guard meter that breaks. Specials cost half the blue mana bar.
Sudden death (default 75 s) brings in a closing ring of fire.

## Arenas, power-ups and tactics
- **Coliseum** (Fight and Fight online): the moonlit arena with four pillars and four power-up pads.
- **Badlands** (tournaments): a sunset canyon more than three times larger, with a walled base for each team, a ruined
  shrine in the middle, boulders and broken walls to flank around, nine power-up pads and four healing springs.
  On a map this big the camera follows your own fight.
- **Power-ups**: walk through the floating gem. Health (40% over 2 s), Shield (soaks 35% of your health), Rage (+30%
  damage, 10 s), Haste (10 s, full stamina), Mana (full blue bar), Cloak (invisible for 5 s, broken by attacking),
  Vampire (hits heal you, 10 s). Pads refill 9 to 16 s after they are taken.
- **Gear** shows up on the same pads, floating as the real thing:
  - *Weapons* (Longsword, Battle Axe, War Hammer) go in your right hand and turn punches into slashes, chops or
    crushing blows with more reach and damage. Each one breaks after 12 to 16 landed blows.
  - *Iron Armor* adds a helm and breastplate that soak 40% of every hit until they have taken half your health.
  - *Guns* (Hand Cannon 12 shots, Scattergun 6 shells, Rail Rifle 4 piercing shots) and *spell tomes* (Fireball,
    Chain Lightning, Meteor Storm, Frost Nova, Healing Light) go on the **ability bar** along the bottom of the
    screen: a health orb and a mana orb either side of your weapon, armor and four item slots. A banner names each
    new item and the key that uses it. Guns and spells cost no mana; each pickup gives a set number of shots or
    casts and a second copy adds more. A spare gun rides on your hip; the one you fire is drawn in your hand.
- **Healing springs** (Badlands): stand in the glowing pool to recover 4% health a second.
- **Backstab**: a melee hit (punch, kick, lunge, close-range skill, Shadow Step) landing on someone facing away deals
  60% more damage, cannot be blocked and always staggers, even through armour.
- **Parry**: start blocking in the last moment before a punch or kick lands to cancel it, stagger the attacker and
  refill some guard and mana.
- **Formation**: a fighter with a living teammate within 5 m takes 15% less damage.
- **Durability**: everyone has 1.7x health in Fight and Fight online and 2.6x in tournaments.
- **Tournament rules**: friendly fire is on (teammates take 60% damage from your hits, area skills included), and a
  fighter knocked out goes down for 12 s. A teammate standing over them for 2.4 s revives them at 35% health. When a
  whole team is down, the round is over. CPU fighters revive teammates, chase power-ups, retreat to springs when hurt,
  circle behind busy enemies and hold off attacks that would catch a teammate.

## Stamina, skills and teams
- **Stamina** (green bar): attacks, jumps, blocked hits, dodges and sprinting drain it; it refills after a short pause.
  At zero you are exhausted (slower, 28% weaker, no dodge or sprint, guard breaks faster) until it is back to 35.
- **Dodge / sprint**: tap to roll (brief invulnerability) in the held direction, or backwards; hold while moving to sprint.
- **Skills**: three per fighter, each unique and themed by class: Warriors strike up close, Ranged fighters shoot,
  Mages cast spells from a distance. Each is paid from the mana bar and then goes on cooldown.
  The chips under a player's card show each one; a dark fill is the cooldown, dim means not enough mana.
- **Teams** (tournaments): fighters wear their team's colours (dyed gi, pauldrons, tabard, floor ring) and the last team
  with anyone standing wins the round.

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
- `fighter.js` fighter state machine, movement, attacks, hit reactions, gear · `fighterModel.js` procedural jointed model
  (sculpted faces, hair, hands and muscled limbs merged per material), poses, breathing, blinking and gaze
- `specials.js` special moves, skills, guns, spells and projectiles · `ai.js` CPU controller · `input.js` keyboard and human controller
- `items.js` weapon, gun and armor meshes and the ability bar icons
- `arena.js` coliseum, lighting, crowd, fire ring, collision · `battleground.js` the Badlands · `pickups.js` power-ups
- `effects.js` pooled particles and FX
- `camera.js` framing camera · `hud.js` in-fight overlay · `ui.js` menus and key rebinding
- `net/session.js` online rooms, the queue, tournaments and chat, host sync and client playback · `net/transport.js` PeerJS
  links and the queue beacon · `net/tournament.js` teams and bracket · `net/online-ui.js` queue screens ·
  `net/tourney-ui.js` tournament screens · `net/chat.js` live chat
- `replay.js` instant replay of the final knockout and its shareable video clip (`share.js` posts it)
- `events.js` event bus · `audio.js` sound effects, announcer, crowd and music · `config.js` roster, frame data, skills, stamina, teams, bindings, AI tuning

## Extension points for later passes
- **Audio:** built. `audio.js` listens to `events` and plays Higgsfield-generated clips (Mirelo effects, Sonilo music,
  Inworld announcer) from four compressed files on Higgsfield's CDN: one effects sprite (offsets in `SPRITE`), a crowd
  loop and two music loops, crossfaded so they loop without a seam. Sound unlocks on the first key or click; Music and
  Sound effects volumes live in the fight setup. `window.__arena.audio.stats` shows what loaded and played.
- **Online multiplayer:** built (see above). Every fighter is driven by a controller with `getIntent(fighter, world)`;
  remote players use `NetController` on the host. Online clients receive `events` too, with fighters resolved locally.
- **Replays:** built. While a match runs, `replay.js` keeps the last 14 seconds of poses, projectiles, effects and
  sound events (sampled 30 times a second). At match end it freezes the seconds around the deciding KO, plays them back
  with a cinematic camera and slow motion before the results, and records that playback (plus a title card) into an
  MP4 or WebM clip with `MediaRecorder`. Only the playback is encoded, so normal play pays almost nothing. The results
  screen offers Watch the knockout, Share the KO clip (the phone share sheet, or save plus the Facebook dialog on a
  computer) and Save clip. `window.__arena.game.replay.stats()` shows the buffer and clip.
- Debug: `window.__arena.game.stats()`; `?autotest=8` starts an all-CPU match, `&mode=tournament&teams=2` on the Badlands.

Three.js r180 and PeerJS 1.5.5 are vendored in `vendor/` (both MIT, see `vendor/three-LICENSE` and `vendor/peerjs-LICENSE`).
