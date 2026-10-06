// Tournament bookkeeping: teams come from the fundraising groups players typed on the title screen,
// and a single-elimination bracket takes them to one champion. Pure data, so the host can send it
// to everyone in the lobby as is.

const SETTINGS_KEY = 'battle-arena.tournament.v1';

export const TEAM_SIZES = [1, 2, 3, 4];

// "Lincoln Elem PTA " and "lincoln elem pta" are the same team.
export function groupKey(s) { return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
export function cleanGroup(s) { return String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ').slice(0, 40); }
export function cleanText(s, max) { return String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max); }

export function defaultTournament() {
  return { name: 'José Madrid Salsa Showdown', startsAt: '', prize: '', teamSize: 3, wins: 2, fill: true, code: '', groups: [] };
}
export function loadTournamentSettings() {
  let t;
  try { t = { ...defaultTournament(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { t = defaultTournament(); }
  if (!Array.isArray(t.groups)) t.groups = [];
  t.groups = t.groups.filter((g) => g && typeof g.code === 'string' && typeof g.name === 'string');
  return t;
}
export function saveTournamentSettings(t) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(t)); } catch { /* storage unavailable */ }
}

// Fundraiser registration codes: the admin makes one per fundraising group and hands it to that
// group's participants. They type it on the title screen, and the admin's browser (which hosts the
// tournament) swaps it for the group's name when they join. The codes never leave the admin's browser.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I lookalikes
export function fundraiserCode(taken = []) {
  const used = new Set(taken.map(normFundraiserCode));
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    const code = `JM-${chars.slice(0, 4)}-${chars.slice(4)}`;
    if (!used.has(normFundraiserCode(code))) return code;
  }
}
// "jm 7kq4 x2pd", "JM7KQ4X2PD" and "JM-7KQ4-X2PD" are the same code
export function normFundraiserCode(s) { return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(?!JM)(?=[A-Z0-9]{8}$)/, 'JM'); }
// the registered group for what a player typed, or null
export function findFundraiser(groups, typed) {
  const k = normFundraiserCode(typed);
  return (k && groups?.find((g) => normFundraiserCode(g.code) === k)) || null;
}

// Teams present in the lobby: { key: { name, members[] } } in the order they first appeared.
export function teamsOf(members) {
  const teams = new Map();
  for (const m of members) {
    if (m.role !== 'player' || !m.group) continue;
    const key = groupKey(m.group);
    if (!teams.has(key)) teams.set(key, { key, name: m.group, members: [] });
    teams.get(key).members.push(m);
  }
  return teams;
}

// Round one pairs the teams in a shuffled order; an odd team out gets a bye into round two.
export function seedBracket(keys) {
  const order = [...keys].sort(() => Math.random() - 0.5);
  let size = 1;
  while (size < order.length) size *= 2;
  // spread the byes so no two byes meet in round one
  const slots = Array(size).fill(null);
  const byes = size - order.length;
  let k = 0;
  for (let i = 0; i < size / 2; i++) {
    slots[i * 2] = order[k++] ?? null;
    slots[i * 2 + 1] = i < size / 2 - byes ? order[k++] ?? null : null;
  }
  const first = [];
  for (let i = 0; i < size; i += 2) first.push({ a: slots[i], b: slots[i + 1], winner: null });
  const rounds = [first];
  for (let n = size / 4; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, () => ({ a: null, b: null, winner: null })));
  const bracket = { rounds };
  settleByes(bracket);
  return bracket;
}

// A round-one match with a single team is a bye: that team goes straight through.
// (With at least half the slots filled no round-one match is empty, so byes only happen there.)
function settleByes(bracket) {
  bracket.rounds[0].forEach((m, i) => {
    if (!m.winner && (m.a || m.b) && !(m.a && m.b)) advance(bracket, 0, i, m.a || m.b);
  });
}

function advance(bracket, r, i, key) {
  const m = bracket.rounds[r][i];
  m.winner = key;
  const next = bracket.rounds[r + 1];
  if (!next) return;
  const n = next[Math.floor(i / 2)];
  if (i % 2 === 0) n.a = key; else n.b = key;
}

// The next match with both teams known and no winner yet: { r, i, a, b } or null.
export function nextMatch(bracket) {
  if (!bracket) return null;
  for (let r = 0; r < bracket.rounds.length; r++) {
    for (let i = 0; i < bracket.rounds[r].length; i++) {
      const m = bracket.rounds[r][i];
      if (!m.winner && m.a && m.b) return { r, i, a: m.a, b: m.b };
    }
  }
  return null;
}

export function recordWinner(bracket, r, i, key) { advance(bracket, r, i, key); }

export function champion(bracket) {
  const last = bracket?.rounds[bracket.rounds.length - 1];
  return last?.[0]?.winner || null;
}

// "Final", "Semifinal", "Quarterfinal", "Round 1"...
export function roundName(bracket, r) {
  const left = bracket.rounds.length - r;
  return left === 1 ? 'Final' : left === 2 ? 'Semifinal' : left === 3 ? 'Quarterfinal' : `Round ${r + 1}`;
}

// When the tournament is scheduled for, in the viewer's own time zone.
export function describeStart(iso, now = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const when = t.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const ms = t.getTime() - now;
  if (ms <= 0) return `${when} (live now)`;
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  const left = d >= 1 ? `${d}d ${h % 24}h` : h >= 1 ? `${h}h ${m % 60}m` : `${m}m`;
  return `${when} (in ${left})`;
}
