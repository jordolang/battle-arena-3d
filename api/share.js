// Shared match links: /api/share?w=Ember&by=Jordan&t=Mage&n=8[&team=1][&room=ABCDE]
// Facebook (and Messenger, texts, Slack) read this page's Open Graph tags to build the post preview,
// so the preview names the winner. A person who clicks the link is sent straight on to the game,
// into the online room when the link carries one. (Script, not a meta refresh: link crawlers follow
// meta refreshes and would read the game page's generic tags instead.)

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max) => String(Array.isArray(v) ? v[0] : v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

module.exports = (req, res) => {
  const q = req.query || {};
  const winner = clean(q.w, 40);
  const by = clean(q.by, 24);
  const title = clean(q.t, 40);
  const team = clean(q.team, 1) === '1';
  const n = Math.min(8, Math.max(2, parseInt(clean(q.n, 2), 10) || 0));
  const room = clean(q.room, 5).toUpperCase().replace(/[^A-Z0-9]/g, '');

  const host = clean(req.headers['x-forwarded-host'] || req.headers.host, 120) || 'battle-arena-3d-mauve.vercel.app';
  const origin = `https://${host}`;
  const game = `${origin}/${room.length === 5 ? `?room=${room}` : ''}`;

  let ogTitle = 'José Madrid Salsa Battle Arena';
  let desc = 'Eight warriors, one blood-moon coliseum. Fight the CPU or your friends free in your browser. Last one standing wins.';
  if (winner) {
    const who = team ? winner : `${winner}${by && by !== 'CPU' ? ` (${by})` : ''}`;
    ogTitle = `${who} ${team ? 'took the crown' : 'won'} in ${n ? `${n === 8 ? 'an' : 'a'} ${n}-fighter` : 'a'} brawl`;
    desc = `${title ? `${title}. ` : ''}Think you can do better? Play José Madrid Salsa Battle Arena free in your browser.`;
  }
  if (room.length === 5) desc = `Join the fight in room ${room}. ${desc}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="José Madrid Salsa Battle Arena">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + req.url)}">
<meta property="og:image" content="${esc(origin)}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="José Madrid Salsa Battle Arena crest over a fight in the coliseum">
<meta name="twitter:card" content="summary_large_image">
<style>body{background:#120c0a;color:#efe4d2;font:18px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}a{color:#ffc861}</style>
</head>
<body>
<p><a href="${esc(game)}">Enter the arena</a></p>
<script>location.replace(${JSON.stringify(game).replace(/</g, '\\u003c')});</script>
</body>
</html>
`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400');
  res.status(200).send(html);
};
