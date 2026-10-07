# Battle Arena 3D

A 3D last-one-standing brawler in Three.js with three ways to play:
- **Fight**: you against 1 to 7 CPU fighters in the coliseum.
- **Fight online**: a 30-second public queue. Everyone who queues in the same 30 seconds fights in one free-for-all battle.
- **Tournament**: fundraising groups team up and fight a knockout bracket on the Badlands, run by an admin, with spectators and live chat.
- **Training**: a guided tutorial (14 short lessons: movement, combos, block, parry, backstab, skills, special, weapons,
  guns and spells) and a free practice room, both against a training dummy that cannot be knocked out.

Every fighter has stamina, three castable skills matched to their class (Warrior, Ranged or Mage) and a special move.
Power-ups, backstabs, parries and (in tournaments) friendly fire and revives make positioning and teamwork matter.

## Play
- **Easiest:** open `index.html` in the repo root in Chrome, Edge, Firefox or Safari. It is one self-contained file
  (a copy of `dist/battle-arena.html`, which the build writes).
- **From source:** serve this folder with any static server (for example `python3 -m http.server`) and open `index.html`.
  ES modules need a server, so double-clicking `index.html` will not work.
- Rebuild the single-file versions after changing the source: `npm i --no-save esbuild && node tools/build.mjs`,
  then copy `dist/battle-arena.html` to the repo root as `index.html`.

## José Madrid Salsa accounts, profiles and leaderboards
- **Everyone signs in.** The title screen asks players to sign in with their José Madrid Salsa account before they can
  fight in any mode. **Sign in to play** goes to `https://www.josemadrid.net/battle-arena/connect`, where they sign in
  (or make a free account) and press **Play as …**; the website sends them straight back to the game, invite and
  tournament links included. The game keeps a sign-in token in the browser for 90 days; **Sign out** on the profile
  screen ends it.
- **Profile** (title screen, **My profile**): the fighter name shown on the boards and online (players can rename
  themselves), their fundraising group, wins, losses, win rate, knockouts, rounds won, damage, win streaks, all-time
  rank, favourite fighter and recent matches. A player whose account already belongs to a group (a claimed
  fundraiser character, or the fundraiser they run) is in that group automatically; anyone else picks a group from the
  fundraisers running now, and can switch once a week.
- **Leaderboards** (title screen): fighters or fundraising groups, this week, this month or all time, over every match,
  versus players only, or one mode. Ranked by wins, then knockouts. Choose a fighter to see their profile.
- **What gets recorded**: every match a signed-in player fights in (versus CPU, online, tournament) is opened on the
  website when its first round starts and closed with that player's own result when it ends. The website refuses
  results a match cannot produce (too fast, too many knockouts or too much damage). Spectating records nothing.
- **Offline**: if the website cannot be reached a signed-in player keeps playing, but nothing is recorded.
- **Testing**: `?account-api=URL` points the game at another copy of the website. On a local copy (localhost or a
  file) **Play as a guest** skips sign-in, and `?autotest` plays as a guest. The website only hands sign-in tokens to
  the published game (`https://battle-arena-3d-mauve.vercel.app`); other addresses are added on the website with
  `ARENA_GAME_ORIGINS`.

## José Madrid Salsa fundraiser
- The title screen shows the José Madrid Salsa Battle Arena logo (`assets/jose-madrid-battle-arena-logo.webp`,
  a revamp of the official José Madrid Salsa badge; the build inlines it into the single file).
- Players must be enrolled in a José Madrid Salsa fundraising group. The title screen asks for the group's fundraiser
  code, and Fight online and fighting in a tournament stay locked until it is filled in (Fight versus the CPU and watching a tournament
  do not need one). Admins make codes on the website at **Admin → Fundraisers → Battle Arena → Game codes**, so a code
  works on any device.
- **Online battles** (the queue and invite rooms) need a code the website confirms: the game checks it with
  `POST https://www.josemadrid.net/api/arena/game-codes/verify` before queueing, and the host checks every player who
  joins again, so a group name or a revoked code can't get in.
- In tournaments the group is the team: everyone who typed the same group (case and spacing don't matter) fights together.
- **Donate to your team**: under the group field the title screen shows the group's fundraiser from the José Madrid
  Salsa fundraising site: how much it has raised toward its goal and a **Donate to (group)** button that opens the
  group's own page (`https://fundraising.josemadrid.net/fundraise/<slug>`) in a new tab, where the site takes the
  donation. The game never handles payments. The group is matched by its name, its school or its page name; a fundraiser
  code is first turned into its group's name. A group that isn't found gets **Find your group** (the site's group list).
  The results screen has the same button.
- **Goal rewards (cosmetic only)**: a group that has raised half its goal unlocks the **Silver Laurel** (a silver laurel
  wreath and a silver ring round the fighter's floor marker); at the full goal, the **Golden Crown** (a golden crown,
  a gold ring and gold-glinting trim). The player's fighter wears it versus the CPU, online and in tournaments, and
  its name tag gets a ❦ or ♛. Rewards change nothing about how a fighter plays.
- Where the numbers come from: `api/fundraisers.js` (a Vercel function next to `api/share.js`) reads this month's team
  standings from the fundraising site's public arena snapshot (`/api/fundraiser/arena/<YYYY-MM>/state`, the same data its
  spectator arena shows) and passes on each team's name, page, goal and amount raised, cached for a minute. The hosted game
  asks it at `/api/fundraisers`; the single-file copy asks the hosted one. `?fundraisers-api=URL` points at another
  copy for testing, and the `FUNDRAISING_SITE_URL` environment variable moves the function to another fundraising site.

## Training
- The tutorial shows one lesson at a time in a panel on the left and moves on when you have done it (Tab skips a lesson).
  The dummy stands still, holds its guard or throws slow punches, depending on the lesson.
- The practice room shows your last hit, the current combo and your best combo. Tab changes what the dummy does,
  G lays out two pieces of gear at a time, R puts you both back in the middle. Mana refills itself there.
- Prompts follow the input device in use (`src/prompts.js`): keys on a keyboard, the real (and rebound) buttons of the
  connected controller, the on-screen button names on a touch screen. `main.js` registers the gamepad and touch labels.
  On a controller View skips a lesson (or cycles the dummy); in the practice room L3 lays out gear and R3 resets.

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
  (type a group name, **Make code**; saved only in that browser and good for that tournament only). Set **Who can fight** to **Any group name** to skip
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

### Game controllers (`src/gamepad.js`, `src/padmap.js`)
Up to four pads (Xbox, PlayStation, Switch Pro, most USB/Bluetooth pads in standard mapping). Pad N plays as PN by
default; the Controls screen lists connected pads, lets each be seated as P1-P4, rebinds every action (shared by all
pads) and turns rumble on or off. A pad also steers that player's keyboard section, so mixing works.

| Move | Punch | Kick | Special | Jump | Block | Dodge / sprint | Skills 1-3 | Use gun / spell | Next slot | Slots 1-4 | Pause |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Left stick (analog: a light push walks) | X | Y | B | A | LT | RT | Right stick up / left / right | RB | LB | D-pad up / right / down / left | Start or View |

Menus: D-pad or stick to move (held directions repeat), A select, B back, LB/RB change a value, Start pauses or
selects. Presses that drive a menu are not counted in the fight, so picking Resume with A does not also jump.
Unplugging a pad mid-fight pauses a local match. Online, any connected pad steers your fighter. When you are out,
hold A to fast-forward. Rumble: hits (harder for heavy ones), blocks, parries, guard breaks, knockouts, "Fight!".

### Touch screens (`src/touch.js`)
Shown during a fight on phones and tablets (Controls: Auto, Always on, Off; Small/Medium/Large buttons). The left
thumb lands anywhere on the left side and becomes a floating analog stick. The right side has Punch, Kick, Jump,
Block and Dodge (hold both), Special, the fighter's three skills (named, with a cooldown sweep, dimmed without mana)
and Use/Next for the item bar; tapping a slot on the item bar fires it. Several fingers work at once and a thumb can
slide from one button to the next. Pause and full-screen buttons sit top-left; upright phones get a narrower layout
and a hint to turn sideways. Keyboard or pad input hides the overlay again (laptops with touch screens).

### Couch play
Fight setup has **Players here** (1-4). Each local player uses their keyboard section and/or their controller;
the fighter list shows which device each one has, and the opening hints show the glyphs of the device in use.

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

## Character select, clothing and the locker room
- **Character select** opens from the Versus CPU screen (Enter on a fighter), from your seat in an online room or the
  queue, and from your fighter in a tournament lobby. It shows every fighter with a portrait, a turning 3D preview on a
  pedestal (drag to turn), their health, power and speed, their special and skills, and the wardrobe.
- **Locker room** (title screen) is the same screen for browsing and dressing all eight fighters. The one you confirm
  becomes your usual fighter, offline and online.
- **Clothing** is real clothing, worn over the body and moving with it: tops (Arena Tee, Tank Top, Hoodie, Serape
  Poncho, Salsa Chef Apron, Biker Jacket, Charro Jacket, José Madrid Tee, Suit of Lights), pants (Fight Shorts, Jeans,
  Cargo Pants, Charro Trousers, José Madrid Joggers, Gold Breeches), shoes (High-tops, Huaraches, Cowboy Boots, Golden
  Boots) and gloves (Fight Gloves, Boxing Gloves, Iron Gauntlets, Salsa Chef Mitts). On top of that: colour schemes
  (Salsa Roja, Salsa Verde, Chipotle Smoke, Mango Habanero, Ghost Pepper, Golden Jar and more) that dye the gi and any
  dyeable clothes, headgear (Bandana, Luchador Mask, Sombrero, Rider's Hat & Mask, Crown of Chilies, Salsa King Crown),
  back pieces (Battle Cape, Chili Banner, Salsa Jar Pack, José Madrid Standard, Golden Mantle) and victory poses
  (Fist to the Sky, Salsa Step, Double Flex, Come On Then, Matador's Bow). Hovering an item tries it on; Enter wears it.
  Every fighter keeps their own look. Clothes are looks only: they never change how a fighter plays.
- **Body** (first wardrobe tab): skin tone, hair style (bald, short, long, top knot, mohawk, spiky, braids), hair colour,
  beard on or off and eye glow, each defaulting to the fighter's own. Body options are always free.
- **Unlocks**: some items are free; the rest unlock from your record (matches finished, matches won, rounds won,
  knockouts), and the José Madrid pieces need a fundraising group on the title screen. New unlocks are listed on the
  results screen. CPU fighters dress themselves, sometimes in gear you have not earned yet.
- **Online**: your saved looks travel with you (`hello` and `pick` carry them; the host puts each fighter's look in the
  match spec), so everyone sees what you wear. Protocol is now 7.
- **Storage and profiles**: the wardrobe (record, looks, usual fighter) is kept in this browser under
  `battle-arena.wardrobe.v1`. Player profiles take it over with `wardrobe.connectProfile(adapter)` in `src/cosmetics.js`:
  the adapter can supply the account's stats, items granted outright, fundraiser membership and saved looks, and
  receives finished matches and wardrobe changes.

## Levels, challenges and the season pass
- **XP**: every match you play (not training) earns XP: 60 for finishing, 120 for a win, 25 per round won, 20 per
  knockout and up to 60 for damage. Matches against people (online, tournaments) pay 25% more. The results screen
  shows what the match earned.
- **Fighter levels**: the XP levels up the fighter you played, from 1 to 20 (level L to L+1 costs 300 + 100×(L−1) XP).
  Levels 5, 10, 15 and 20 are Bronze, Silver, Gold and Salsa Master mastery. Levels show on the character select
  cards and the Season pass screen.
- **Challenges**: three daily and three weekly challenges ("Win 3 matches with Volt", "Parry 3 attacks", "Finish a
  match online"…), the same for everyone on the same day or week. Dailies are worth 200 XP, weeklies 750. Days reset
  at local midnight, weeks on Monday.
- **Season pass**: a season is a calendar month, the same period the fundraisers run on. The pass has 20 tiers at
  1,000 XP each; every tier gives a cosmetic outright (items normally earned from your record, ones you don't own yet
  first, rarest last; the order changes every season).
- **Group track**: when your fundraising group (the code on the title screen) reaches 25%, 50%, 75% and 100% of its goal
  this month, you get +10%, +20%, +30% and +50% season XP and the Golden Jar colours, Golden Mantle, Salsa King Crown and
  Molten Salsa colours. Goal data comes from the same `/api/fundraisers` as the donate button.
- **Storage**: progress is kept in this browser under `battle-arena.progress.v1`, like the wardrobe.
  `progression.connectProfile(adapter)` in `src/progression.js` is the hook for keeping it on the account. Items from the
  pass reach the wardrobe through `wardrobe.grantedBy(fn)`.

## Code map (`src/`)
- `main.js` boot and wiring · `game.js` renderer, fixed 120 Hz simulation, rounds and match flow
- `fighter.js` fighter state machine, movement, attacks, hit reactions, gear · `fighterModel.js` procedural jointed model
  (sculpted faces, hair, hands and muscled limbs merged per material), poses, breathing, blinking and gaze
- `specials.js` special moves, skills, guns, spells and projectiles · `ai.js` CPU controller · `input.js` keyboard, device registry and human controller (keys + pads + touch)
- `items.js` weapon, gun and armor meshes and the ability bar icons
- `cosmetics.js` clothing, colour schemes, headgear, back pieces and victory poses, unlock rules and the wardrobe ·
  `wardrobeModels.js` the 3D clothing and accessories · `bodyShapes.js` limb profiles shared by bodies and clothes ·
  `charSelect.js` the character select and locker room screen
- `progression.js` XP, fighter levels, challenges and the season pass · `progression-ui.js` the Season pass screen and
  the results screen's XP summary
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
