// Fundraising teams for the game's donate button: /api/fundraisers
// Reads this month's team standings from the José Madrid Salsa fundraising site (the same public
// snapshot its spectator arena polls) and passes on only what the game shows: name, link, goal and
// amount raised. The site sends no CORS headers, so the game asks here instead of asking it directly.
// Donations themselves happen on the site's own team page; nothing about payments passes through here.

const SITE = String(process.env.FUNDRAISING_SITE_URL || 'https://fundraising.josemadrid.net').replace(/\/+$/, '');
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const period = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the single-file copy of the game asks from file:// or other hosts
  const asked = clean(req.query?.period, 7);
  const p = /^\d{4}-\d{2}$/.test(asked) ? asked : period(new Date());
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`${SITE}/api/fundraiser/arena/${p}/state`, { signal: ctl.signal }).finally(() => clearTimeout(timer));
    if (!r.ok) throw new Error(`state ${r.status}`);
    const data = await r.json();
    const teams = (data?.snapshot?.teams || []).map((t) => ({
      slug: clean(t.slug, 80), name: clean(t.name, 80), school: clean(t.school, 80),
      color: /^#[0-9a-f]{6}$/i.test(t.teamColor) ? t.teamColor : null,
      goal: Math.max(0, Number(t.goalAmount) || 0), raised: Math.max(0, Number(t.raised) || 0),
    })).filter((t) => t.slug && t.name);
    // a minute at the edge keeps the site from being asked once per player
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ site: SITE, period: p, teams });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ site: SITE, period: p, teams: [], error: 'The fundraising site could not be reached.' });
  }
};
