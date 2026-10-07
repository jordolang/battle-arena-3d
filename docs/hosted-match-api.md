# Host-reported matches (website contract)

Online and tournament matches are reported once, by the host, for every player.
The website accepts online results only through these endpoints; a browser can no
longer post its own online result. Matches against the CPU still use the old
self-reported `POST /api/arena/matches` with `mode: "CPU"`, and stay off the online boards.

All calls carry the caller's own `Authorization: Bearer <arena token>`.

## 1. Host opens the match

`POST /api/arena/hosted-matches` (host's token), sent when round 1 starts.

```json
{ "mode": "ONLINE" | "TOURNAMENT", "room": "WQ4DE", "fighters": 4,
  "seats": [0, 1], "hostSeat": 0, "fighter": "titan", "seatFighters": ["titan", "volt"] }
```

`seats` are the fighter slots played by people (CPU slots are left out). `hostSeat` is -1 when the
host only runs the match (tournament admin). The website stores the match with the host as owner,
claims `hostSeat` for the host, and makes one random ticket per other seat (store only a hash).

Response: `{ "matchId": "…", "tickets": { "1": "<secret>" } }`

The host sends each guest only its own seat's ticket over the game connection.

## 2. Each guest claims its seat

`POST /api/arena/hosted-matches/:id/join` (guest's own token)

```json
{ "ticket": "<secret>", "fighter": "volt" }
```

Refuse when the ticket is unknown, the seat is already claimed, the caller already holds a seat
in this match, the host is the caller, or the match was already reported. Response `{ "ok": true, "seat": 1 }`.

## 3. Host reports every seat

`POST /api/arena/hosted-matches/:id/report` (host's token, only the account that opened it)

```json
{ "rounds": 3, "winnerSeat": 0, "winnerTeam": null,
  "results": [ { "seat": 0, "fighter": "titan", "won": true, "roundsWon": 2, "rounds": 3, "knockouts": 4, "damage": 812 },
               { "seat": 1, "fighter": "volt", "won": false, "roundsWon": 1, "rounds": 3, "knockouts": 1, "damage": 640 } ] }
```

Accept once. Write an `ArenaMatch` result for every seat that was claimed (host included); seats
nobody claimed are dropped. Sanity checks worth keeping: the match is older than ~20 s per round,
younger than ~1 h, at most one winning seat (or one winning team), `roundsWon <= rounds <= 5`.
A match where only the host claimed a seat (host versus CPUs) is no harder to fake than a CPU
match, so keep it on the profile but off the online boards, like CPU matches.

Response: `{ "recorded": [ { "seat": 0, "handle": "Alpha", "streak": 2 }, … ] }`

The host passes each guest its own line, and every browser refreshes `/api/arena/me`.

## Rollout

Either side can ship first. Until the website has these endpoints the game logs
"match not recorded" for online matches and CPU matches keep recording; once the website
refuses online self-reports, older copies of the game simply stop recording online matches.
