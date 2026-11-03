// The fight promo cam's picks: the best moments of one fighter's match.
//
// While a match runs, this watches the "star" (the one person fighting on this device; in couch
// play the first player) and scores what they do: combos, heavy blows, knockouts, parries, guard
// breaks, and above all aerial plays that count. An aerial play is a blow landed while in the air,
// or a jump that carries the star over a projectile or a swing that was coming straight for them
// and doesn't hit them. Plain jumps score nothing. Aerial plays are
// played back in bullet time (replay.js).
//
// The replay buffer (replay.js) keeps every recorded frame a highlight's window covers, so the reel
// can reach back past the last few seconds it otherwise holds.
import { events } from './events.js';

export const PROMO = {
  keep: 12,            // highlights held at once (the lowest scores give way)
  segments: 5,         // most moments in a reel
  seconds: 26,         // rough cap on a reel's running time (bullet time counts extra)
  bulletExtra: 4.5,    // real seconds a bullet-time moment adds to its segment
  minScore: 2.5,       // a moment worth showing
  before: 1.5, after: 1.1,
  maxSpan: 6,          // longest a single moment may grow (sustained fighting starts a new one)
};

const airborne = (f) => !!f && !f.grounded && f.pos.y > 0.35;

export class Highlights {
  constructor(game) {
    this.game = game;
    this.reset();
    const on = (name, fn) => events.on(name, (d) => {
      const g = this.game;
      if (d?.replay || g.mode !== 'match' || g.replay?.playing) return;
      const s = this.star();
      if (s) fn(d || {}, s, g.time);
    });
    on('hit', (d, s, t) => this.onHit(d, s, t));
    on('parry', (d, s, t) => { if (d.fighter === s) this.add('parry', t, 3.2); });
    on('guardBreak', (d, s, t) => { if (d.by === s) this.add('guardBreak', t, 2.6); });
    on('backstab', (d, s, t) => { if (d.by === s) this.add('backstab', t, 2.4); });
    // a swing at an airborne star: if it doesn't connect soon, they jumped it
    on('swing', (d, s, t) => {
      const e = d.fighter;
      if (!e || e === s || !s.alive || !airborne(s) || this.friendly(e, s)) return;
      const dx = s.pos.x - e.pos.x, dz = s.pos.z - e.pos.z, dist = Math.hypot(dx, dz);
      if (dist > 2.6 || dist < 1e-3) return;
      // facing the star
      if (Math.sin(e.facing) * dx / dist + Math.cos(e.facing) * dz / dist < 0.5) return;
      this.pendingSwings.push({ t, by: e });
    });
  }

  reset() {
    this.list = [];             // { kind, t, from, to, score, bullet, peak }
    this.combo = null;          // the star's running string of hits
    this.pendingSwings = [];
    this.pendingProjs = [];
    this.seen = new Set();      // projectiles already judged
    this.aimed = new Map();     // projectile id -> was heading straight for the star
    this.lastHitOnStar = -99;
  }

  // Whose highlights these are: the one person fighting on this device, else the first player.
  star() {
    const g = this.game;
    if (g.mode !== 'match') return null;
    if (g.online) return g.localFighter || null;
    let best = null;
    for (const f of g.fighters) if (f.isHuman && (!best || f.controller.playerIndex < best.controller.playerIndex)) best = f;
    return best;
  }

  friendly(a, b) { return a.team >= 0 && a.team === b.team && !this.game.friendlyFire; }

  add(kind, t, score, o = {}) {
    const h = { kind, t, score, from: t - (o.before ?? PROMO.before), to: t + (o.after ?? PROMO.after), bullet: !!o.bullet, peak: o.peak ?? t };
    // fold into a moment that overlaps it
    for (const x of this.list) {
      if (h.from < x.to && h.to > x.from && Math.max(x.to, h.to) - Math.min(x.from, h.from) <= PROMO.maxSpan) {
        x.from = Math.min(x.from, h.from); x.to = Math.max(x.to, h.to);
        if (h.bullet && !x.bullet) { x.bullet = true; x.peak = h.peak; x.kind = h.kind; }
        x.score += h.score;
        return x;
      }
    }
    this.list.push(h);
    if (this.list.length > PROMO.keep) {
      // drop the weakest, never one still being built (the newest)
      let worst = 0;
      for (let i = 1; i < this.list.length - 1; i++) if (this.list[i].score < this.list[worst].score) worst = i;
      this.list.splice(worst, 1);
    }
    return h;
  }

  onHit(d, s, t) {
    if (d.fighter === s) { this.lastHitOnStar = t; return; }
    if (d.by !== s) return;
    const dmg = d.damage || 0;
    if (airborne(s)) this.add('aerialStrike', t, 6 + dmg / 8, { bullet: true, peak: t - 0.04 });
    // strings of hits grow one moment
    const c = this.combo;
    if (c && t - c.last < 1.3 && t + PROMO.after - c.h.from <= PROMO.maxSpan && this.list.includes(c.h)) {
      c.count++; c.last = t;
      c.h.to = Math.max(c.h.to, t + PROMO.after);
      c.h.score += 1 + dmg / 12 + (c.count >= 3 ? 0.8 : 0) + (d.perfect ? 0.6 : 0) + (d.juggle ? 1 : 0);
    } else {
      const h = this.add('combo', t, 0.6 + dmg / 12 + (d.heavy ? 0.8 : 0));
      this.combo = { count: 1, last: t, h };
    }
    if (d.ko) this.add('ko', t, 5, { after: 1.6 });
  }

  // Each rendered frame of a match: judge projectiles passing the star and swings that missed.
  update() {
    const g = this.game, s = this.star();
    if (!s || g.mode !== 'match' || g.replay?.playing || g.phase !== 'fight') return;
    const t = g.time;
    // swings at an airborne star that didn't land within a beat
    for (let i = this.pendingSwings.length - 1; i >= 0; i--) {
      const p = this.pendingSwings[i];
      if (t - p.t < 0.4) continue;
      this.pendingSwings.splice(i, 1);
      if (this.lastHitOnStar < p.t && s.alive) this.add('aerialEvade', p.t + 0.12, 5.5, { bullet: true, peak: p.t + 0.12 });
    }
    if (!s.alive) return;
    const projs = [...g.projectiles, ...(g.net?.clientProjectiles?.values() || [])];
    for (const p of projs) {
      if (p.dead || !p.owner || p.owner === s || this.seen.has(p.id) || this.friendly(p.owner, s)) continue;
      const dx = s.pos.x - p.pos.x, dz = s.pos.z - p.pos.z, dist = Math.hypot(dx, dz);
      const dl = Math.hypot(p.dir.x, p.dir.z) || 1;
      const head = (p.dir.x * dx + p.dir.z * dz) / (dl * (dist || 1));
      // was it coming straight for them while still a few metres out?
      if (dist > 1.8 && dist < 9 && head > 0.9) this.aimed.set(p.id, true);
      if (!this.aimed.get(p.id)) continue;
      // passing them now: within a stride. Whether it went over or under, the hit check decides
      if (dist < 1.6) {
        this.seen.add(p.id);
        if (airborne(s)) this.pendingProjs.push({ t, bullet: true });
        else if (s.state === 'dodge') this.pendingProjs.push({ t, bullet: false });
      }
    }
    // a projectile that reached them without a hit: they jumped (or dodged) it
    for (let i = this.pendingProjs.length - 1; i >= 0; i--) {
      const p = this.pendingProjs[i];
      if (t - p.t < 0.35) continue;
      this.pendingProjs.splice(i, 1);
      if (this.lastHitOnStar >= p.t - 0.05 || !s.alive) continue;
      if (p.bullet) this.add('aerialEvade', p.t, 7, { bullet: true, peak: p.t + 0.05 });
      else this.add('dodge', p.t, 2.6);
    }
    if (this.aimed.size > 64) for (const id of this.aimed.keys()) { if (this.aimed.size <= 32) break; this.aimed.delete(id); }
  }

  // Whether a recorded moment at match time `t` belongs to a kept highlight.
  covers(t) {
    for (const h of this.list) if (t >= h.from - 0.3 && t <= h.to + 0.3) return true;
    return false;
  }

  // The reel: the best moments, aerial plays first, in the order they happened.
  pick() {
    const ranked = this.list.filter((h) => h.score >= PROMO.minScore || h.bullet)
      .sort((a, b) => (b.bullet - a.bullet) || (b.score - a.score));
    const out = [];
    let total = 0;
    for (const h of ranked) {
      const len = Math.min(h.to - h.from, PROMO.maxSpan) + (h.bullet ? PROMO.bulletExtra : 0);
      if (out.length >= PROMO.segments || (out.length && total + len > PROMO.seconds)) continue;
      const seg = { ...h };
      // never longer than one moment may be, kept centred on its peak
      if (seg.to - seg.from > PROMO.maxSpan) {
        seg.from = Math.max(seg.from, Math.min(seg.peak - PROMO.before, seg.to - PROMO.maxSpan));
        seg.to = seg.from + PROMO.maxSpan;
      }
      out.push(seg);
      total += len;
    }
    return out.sort((a, b) => a.from - b.from);
  }

  stats() { return { star: this.star()?.name || null, moments: this.list.map((h) => ({ kind: h.kind, t: +h.t.toFixed(2), score: +h.score.toFixed(1), bullet: h.bullet })) }; }
}
