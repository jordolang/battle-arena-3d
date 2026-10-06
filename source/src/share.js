// One-tap sharing: Facebook's share dialog (no app ID needed) and the phone's own share sheet.
// Facebook builds the post preview from the shared page's Open Graph tags, and it no longer lets a
// site prefill the post text, so a match result travels in the link: /api/share serves a page whose
// preview says who won, then sends the visitor on to the game (and into the room, for an invite).

export const GAME_URL = 'https://battle-arena-3d-mauve.vercel.app/';
const HASHTAG = '#JoseMadridBattleArena';

// The José Madrid Salsa fundraising site serves the game at /battle-arena and its share page at
// /battle-arena/share; the game's own deployment serves them at / and /api/share.
const ON_SITE = location.protocol === 'https:' && /(^|\.)josemadrid(salsa)?\.(net|com)$/.test(location.hostname);

// The deployed site, or the public game when playing from a file or the Claude preview.
function siteRoot() {
  if (ON_SITE) return `${location.origin}/battle-arena`;
  return /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[?::1)/.test(location.hostname)
    ? `${location.origin}/` : GAME_URL;
}

// result: { winner, by, title, fighters, team } from the results screen; room: an online room code.
export function shareLink({ result, room } = {}) {
  if (!result && !room) return siteRoot();
  const q = new URLSearchParams();
  if (result) {
    q.set('w', result.winner);
    if (result.by) q.set('by', result.by);
    if (result.title) q.set('t', result.title);
    if (result.fighters) q.set('n', String(result.fighters));
    if (result.team) q.set('team', '1');
  }
  if (room) q.set('room', room);
  return ON_SITE ? `${siteRoot()}/share?${q}` : `${siteRoot()}api/share?${q}`;
}

export function shareText({ result, room } = {}) {
  if (result) {
    const who = result.team ? `${result.winner} took the crown` : `${result.winner}${result.by && result.by !== 'CPU' ? ` (${result.by})` : ''} won`;
    return `${who} in ${result.fighters === 8 ? 'an' : 'a'} ${result.fighters}-fighter brawl in José Madrid Salsa Battle Arena. Think you can do better?`;
  }
  if (room) return `Join my room in José Madrid Salsa Battle Arena. Room code ${room}.`;
  return 'Come fight me in José Madrid Salsa Battle Arena, a free 3D brawler you play right in your browser.';
}

// Must run straight from the click or key press, or the browser blocks the popup.
export function shareOnFacebook(opts) {
  const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareLink(opts))}&hashtag=${encodeURIComponent(HASHTAG)}`;
  const w = 640, h = 560;
  const left = Math.max(0, (screen.width - w) / 2), top = Math.max(0, (screen.height - h) / 3);
  const win = window.open(url, 'fb-share', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!win) location.href = url; // popups blocked: go to the dialog in this tab
}

// Phones get their share sheet (Messenger, texts, Facebook app...); elsewhere the link is copied.
// Resolves to a short message for the screen, or '' when the share sheet handled it.
export async function shareAnywhere(opts) {
  const url = shareLink(opts), text = shareText(opts);
  if (navigator.share) {
    try { await navigator.share({ title: 'José Madrid Salsa Battle Arena', text, url }); return ''; } catch (err) {
      if (err?.name === 'AbortError') return '';
    }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); return 'Link copied. Paste it anywhere to share.'; } catch { return url; }
}

// The knockout clip (see replay.js) as a file: video { blob, type, url, name }.
export function saveClip(video) {
  const a = document.createElement('a');
  a.href = video.url;
  a.download = video.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Phones share the video itself (Facebook, Messenger, texts...). Elsewhere a site can't attach a video to a
// Facebook post, so the clip is saved for the player to add and the share dialog opens with the match link.
// Runs straight from the click, like shareOnFacebook. Resolves to a short message for the screen.
export async function shareClip(video, opts) {
  const file = typeof File === 'function' ? new File([video.blob], video.name, { type: video.type }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'José Madrid Salsa Battle Arena', text: `${shareText(opts)} ${shareLink(opts)} ${HASHTAG}` });
      return '';
    } catch (err) {
      if (err?.name === 'AbortError') return '';
      // past the await the click no longer counts, so a popup would be blocked: just save the file
      saveClip(video);
      return 'Clip saved to your downloads. Post it from the Facebook app or site.';
    }
  }
  saveClip(video);
  shareOnFacebook(opts);
  return 'Clip saved to your downloads. Add it to the Facebook post with the photo/video button.';
}
