// The progression side of the menus: the Season pass screen (pass tiers, the group track,
// daily and weekly challenges, fighter levels), the line under "Season pass" on the title, and
// the XP summary on the results screen.
import { ROSTER } from './config.js';
import { ITEMS, RARITY, SLOT_LABELS } from './cosmetics.js';
import {
  PASS_TIERS, TIER_XP, GROUP_TRACK, MAX_LEVEL, CHALLENGE_XP, seasonName, resetsAt, timeLeft, challengeText, challengeTarget,
} from './progression.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const n = (v) => Math.round(v || 0).toLocaleString('en-US');
const money = (v) => '$' + n(v);
const pct = (have, need) => (need ? Math.min(100, (have / need) * 100) : 100);
const bar = (have, need, cls = '') => `<div class="xp-bar ${cls}"><i style="width:${pct(have, need).toFixed(1)}%"></i></div>`;
const itemOf = (key) => { const [slot, id] = (key || '').split(':'); return ITEMS[slot]?.[id] ? { slot, id, item: ITEMS[slot][id] } : null; };
const reward = (key) => {
  const r = itemOf(key);
  return r ? `<b style="color:${RARITY[r.item.rarity].color}">${esc(r.item.label)}</b> <span>${esc(SLOT_LABELS[r.slot].toLowerCase())}</span>` : '';
};
const boostText = (b) => `+${Math.round(b * 100)}% season XP`;

export class ProgressionMenus {
  constructor({ menus, progression }) {
    this.menus = menus;
    this.p = progression;
    this.passReturn = 'title';
    progression.onChange(() => { this.renderTitle(); if (menus.active === 'pass') this.render(); });
    this.renderTitle();
  }

  onShow(name) {
    if (name === 'title') this.renderTitle();
    if (name === 'pass') { this.p.claimGroup(); this.render(); }
  }

  onAct(act) {
    switch (act) {
      case 'to-pass': this.passReturn = this.menus.active || 'title'; this.menus.show('pass'); return true;
      case 'pass-back': this.menus.show(this.passReturn === 'pass' ? 'title' : this.passReturn); return true;
    }
    return false;
  }

  // "Tier 6 of 20 · 2 challenges left"
  renderTitle() {
    const el = this.menus.screens.title.querySelector('.pass-hint');
    if (!el) return;
    const open = this.p.openChallenges;
    el.textContent = `Tier ${this.p.tier} of ${PASS_TIERS} · ${open ? `${open} challenge${open === 1 ? '' : 's'} open` : 'all challenges done'}`;
  }

  render() {
    const el = this.menus.screens.pass;
    const p = this.p;
    const s = p.season;
    const tp = p.tierProgress();
    const g = p.groupStatus();
    const ends = resetsAt();
    el.querySelector('.pass-name').textContent = `${seasonName(s.id)} season`;
    el.querySelector('.pass-sub').textContent = `Every match fills the pass and levels up the fighter you played. Ends in ${timeLeft(ends.season)}.` +
      (g.boost ? ` Your group's fundraising gives you ${boostText(g.boost)}.` : '');

    el.querySelector('.pass-tier').innerHTML = `<div class="pass-tier-head"><b>Tier ${tp.tier}</b><span>of ${PASS_TIERS}</span>
      <em>${tp.done ? 'Pass complete for this season' : `${n(tp.into)} / ${n(tp.need)} XP to tier ${tp.tier + 1}`}</em></div>
      ${bar(tp.done ? 1 : tp.into, tp.done ? 1 : tp.need, 'big')}`;

    el.querySelector('.pass-track').innerHTML = s.rewards.map((key, i) => {
      const t = i + 1, got = t <= tp.tier, next = t === tp.tier + 1;
      const r = itemOf(key);
      return `<div class="tier${got ? ' got' : ''}${next ? ' next' : ''}" style="--rc:${r ? RARITY[r.item.rarity].color : '#888'}" title="${esc(r?.item.hint || '')}">
        <span class="tier-n">${t}</span><span class="tier-r">${reward(key)}</span><span class="tier-xp">${got ? 'Earned' : `${n(t * TIER_XP)} XP`}</span></div>`;
    }).join('');

    for (const kind of ['daily', 'weekly']) {
      el.querySelector(`.pass-reset[data-kind=${kind}]`).textContent = `· new in ${timeLeft(ends[kind])}`;
      el.querySelector(`.pass-ch[data-kind=${kind}]`).innerHTML = p.challenges(kind).map((c) => {
        const need = challengeTarget(kind, c.key);
        return `<div class="ch${c.done ? ' done' : ''}"><div class="ch-head"><span>${esc(challengeText(kind, c))}</span>
          <em>${c.done ? 'Done' : `${n(c.have)} / ${n(need)}`} · +${CHALLENGE_XP[kind]} XP</em></div>${bar(c.have, need)}</div>`;
      }).join('');
    }

    el.querySelector('.pass-group').innerHTML = this.groupHtml(g, s);

    el.querySelector('.pass-fighters').innerHTML = ROSTER.map((def) => {
      const f = p.fighter(def.id);
      return `<div class="fl" style="--fc:${hex(def.eyes)}"><div class="fl-head"><b>${esc(def.name)}</b>
        <span class="fl-lv">Lv ${f.level}</span>${f.mastery ? `<span class="fl-m" style="color:${f.mastery.color}">${esc(f.mastery.label)}</span>` : ''}</div>
        ${bar(f.max ? 1 : f.into, f.max ? 1 : f.need)}<div class="fl-xp">${f.max ? `Level ${MAX_LEVEL}, the top` : `${n(f.into)} / ${n(f.need)} XP`}</div></div>`;
    }).join('');
  }

  groupHtml(g, s) {
    const steps = GROUP_TRACK.map((m, i) => {
      const got = s.group.includes(i), reached = g.pct >= m.at;
      return `<div class="gt${got ? ' got' : reached ? ' reached' : ''}"><span class="gt-at">${Math.round(m.at * 100)}%</span>
        <span class="gt-r">${reward(m.item)}</span><span class="gt-b">${boostText(m.boost)}</span></div>`;
    }).join('');
    const head = g.team
      ? `<p class="gt-team"><b>${esc(g.team.name)}</b> ${g.team.goal ? `${money(g.team.raised)} of ${money(g.team.goal)} raised this month` : ''}</p>
         ${g.team.goal ? `<div class="fr-bar"><i style="width:${pct(g.team.raised, g.team.goal).toFixed(1)}%"></i></div>` : ''}`
      : '<p class="gt-team">Enter your fundraiser code on the title screen to join your group\'s track.</p>';
    return `${head}<p class="gt-note">When your group reaches each step of its goal this month, everyone in it earns season XP faster and gets the reward.</p>
      <div class="gt-list">${steps}</div><button class="nav fr-donate" data-act="donate">${g.team ? `Donate to ${esc(g.team.name)}` : 'Support a fundraiser'}</button>`;
  }

  // The results screen's summary of what the match earned (r from progression.recordMatch, or null).
  renderResult(r) {
    const box = this.menus.screens.results.querySelector('.prog-result');
    box.hidden = !r;
    if (!r) { box.innerHTML = ''; return; }
    const def = ROSTER.find((d) => d.id === r.fighter);
    const lines = [];
    if (def && r.after) {
      const f = r.after;
      lines.push(`<div class="pr-row"><span class="pr-k">${esc(def.name)}</span><span class="pr-lv">Lv ${f.level}</span>${bar(f.max ? 1 : f.into, f.max ? 1 : f.need)}
        <span class="pr-v">${r.levelUps.length ? `Level up!${f.mastery && r.levelUps.includes(f.mastery.at) ? ` ${esc(f.mastery.label)} mastery` : ''}` : f.max ? 'Max level' : `${n(f.into)} / ${n(f.need)}`}</span></div>`);
    }
    const t = r.tier;
    lines.push(`<div class="pr-row"><span class="pr-k">Season pass</span><span class="pr-lv">Tier ${t.tier}</span>${bar(t.done ? 1 : t.into, t.done ? 1 : t.need)}
      <span class="pr-v">+${n(r.seasonXp)} XP${r.boost ? ` (group ${boostText(r.boost).replace(' season XP', '')})` : ''}</span></div>`);
    const extras = [
      ...r.challenges.map((c) => `<span class="pr-ch">${c.kind === 'daily' ? 'Daily' : 'Weekly'} done: <b>${esc(c.text)}</b> +${c.xp} XP</span>`),
      ...r.tiers.filter((x) => x.item).map((x) => `<span class="pr-ch">Tier ${x.tier}: ${reward(x.key)}</span>`),
      ...r.group.map((x) => `<span class="pr-ch">Group reached ${Math.round(x.at * 100)}%: ${reward(x.key)}</span>`),
    ];
    box.innerHTML = `<div class="unlocks-h">+${n(r.xp)} XP</div>${lines.join('')}${extras.length ? `<div class="pr-extras">${extras.join('')}</div>` : ''}`;
  }
}
