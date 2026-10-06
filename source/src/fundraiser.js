// The player's fundraising team on the José Madrid Salsa site: progress toward its goal, the link to
// donate (the site's own team page takes the payment; the game never does), and the cosmetic reward
// the team has earned. Teams come from /api/fundraisers (api/fundraisers.js); `?fundraisers-api=URL`
// points at another copy for testing.
import { normFundraiserCode, verifyFundraiserCode } from './net/tournament.js';

const HOSTED = 'https://battle-arena-3d-mauve.vercel.app/api/fundraisers';
const params = new URLSearchParams(globalThis.location?.search || '');
// the hosted game asks its own server; the single-file copy (file:// or anywhere else) asks the hosted one
export const FUNDRAISERS_API = params.get('fundraisers-api') ||
  (/^https?:$/.test(globalThis.location?.protocol || '') && /\.vercel\.app$/.test(location.hostname) ? '/api/fundraisers' : HOSTED);
export const SITE = 'https://fundraising.josemadrid.net';

// Cosmetic rewards, by share of the goal raised. Nothing here changes how a fighter plays.
export const REWARDS = [
  null,
  { tier: 1, at: 0.5, label: 'Silver Laurel', hint: 'a silver laurel wreath and a silver ring under your fighter' },
  { tier: 2, at: 1, label: 'Golden Crown', hint: 'a golden crown, a gold ring and a gold glow on your fighter' },
];
export function rewardTier(team) {
  if (!team?.goal) return 0;
  const pct = team.raised / team.goal;
  return pct >= 1 ? 2 : pct >= 0.5 ? 1 : 0;
}
export const cleanTier = (t) => (t === 1 || t === 2 ? t : 0);

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const isCode = (s) => /^JM[A-Z0-9]{8}$/.test(normFundraiserCode(s));

// The team a typed group belongs to: its name, its link name (slug) or its school.
export function matchTeam(teams, typed) {
  const k = norm(typed);
  if (!k || !teams?.length) return null;
  const slug = k.replace(/ /g, '-');
  return teams.find((t) => norm(t.name) === k) || teams.find((t) => t.slug === slug) ||
    teams.find((t) => norm(t.school) === k) || teams.find((t) => norm(`${t.name} ${t.school}`) === k) || null;
}

export function donateUrl(team) {
  return team ? `${SITE}/fundraise/${encodeURIComponent(team.slug)}` : `${SITE}/groups`;
}

// Teams are asked for at most once a minute; null when the site couldn't be asked (tried again next time).
let cache = null;
export function loadTeams() {
  if (!cache || Date.now() - cache.at > 60000) {
    const at = Date.now();
    const p = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(FUNDRAISERS_API, { signal: ctl.signal });
        const data = await res.json();
        return Array.isArray(data?.teams) && !data.error ? data.teams : null;
      } finally { clearTimeout(timer); }
    })().catch(() => null).then((teams) => { if (!teams && cache?.p === p) cache = null; return teams; });
    cache = { at, p };
  }
  return cache.p;
}

// What the title screen shows for a typed group: { team, tier } (team null when not found), or null
// when the fundraising site can't be reached. Codes are turned into their group's name first.
export async function lookupGroup(typed) {
  const teams = await loadTeams();
  if (!teams) return null;
  let name = typed;
  if (isCode(typed)) {
    try { name = (await verifyFundraiserCode(typed)) || ''; } catch { name = ''; }
  }
  const team = matchTeam(teams, name);
  return { team, tier: rewardTier(team) };
}
