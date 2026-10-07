// The account side of the menus: the sign-in box on the title, the player's profile, the
// leaderboards and other fighters' profiles. Keyboard first like every other screen: arrows
// move, left/right change an option, Enter selects.
import { ROSTER } from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (v) => Number(v || 0).toLocaleString();
const fighterName = (id) => ROSTER.find((d) => d.id === id)?.name || '—';
const MODE_LABEL = { CPU: 'Versus CPU', ONLINE: 'Online', TOURNAMENT: 'Tournament' };
const BOARDS = [['players', 'Fighters'], ['teams', 'Fundraising groups']];
const PERIODS = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']];
const MODES = [['all', 'Every match'], ['versus', 'Versus players'], ['online', 'Online only'], ['tournament', 'Tournaments only'], ['cpu', 'Versus CPU only']];

function when(iso) {
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statTiles(s, rank, rating, rankedGames = 0) {
  const tiles = [
    ['Wins', n(s.wins)], ['Losses', n(s.losses)], ['Win rate', `${s.winRate}%`], ['Knockouts', n(s.knockouts)],
    ['Rounds won', n(s.roundsWon)], ['Damage dealt', n(s.damage)], ['Win streak', n(s.currentStreak)], ['Best streak', n(s.bestStreak)],
  ];
  if (rank) tiles.unshift(['All-time rank', `#${n(rank)}`]);
  // ranked 1v1 rating, once the website keeps one
  if (Number.isFinite(rating)) tiles.unshift(['Ranked rating', `${Math.round(rating)}${rankedGames < 10 ? '?' : ''}`]);
  return tiles.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
}

function matchRows(list, cols) {
  if (!list?.length) return `<tr><td colspan="${cols}" class="empty">No matches yet. Win one and it shows up here.</td></tr>`;
  return list.map((m) => `<tr><td>${when(m.finishedAt)}</td><td>${MODE_LABEL[m.mode] || m.mode}</td><td>${esc(fighterName(m.fighter))}</td>
    <td class="${m.won ? 'won' : 'lost'}">${m.won ? 'Win' : 'Loss'}</td>${cols === 7 ? `<td>${m.roundsWon}</td>` : ''}<td>${m.knockouts}</td>${cols === 7 ? `<td>${n(m.damage)}</td>` : ''}</tr>`).join('');
}

export class AccountMenus {
  constructor({ menus, account }) {
    this.menus = menus;
    this.account = account;
    this.box = document.getElementById('account-box');
    this.q = { board: 'players', period: 'week', mode: 'all', mine: false };
    this.teams = null;
    this.teamPick = 0;
    this.boardsReturn = 'title';
    this.box.querySelector('[data-act=acct-guest]').hidden = !account.local;
    account.onChange(() => this.renderBox());
    this.renderBox();
  }

  renderBox() {
    const a = this.account;
    const signedIn = a.status === 'signed-in' || a.status === 'offline';
    this.box.querySelector('.acct-out').hidden = signedIn || a.status === 'guest';
    this.box.querySelector('.acct-in').hidden = !signedIn;
    this.box.classList.toggle('checking', a.status === 'checking');
    // the fundraising-group box only matters once you can fight
    const fr = this.menus.screens.title.querySelector('.fundraiser');
    if (fr) fr.hidden = !a.ready;
    const msg = this.box.querySelector('.acct-msg');
    msg.textContent = a.status === 'checking' ? 'Checking your sign-in…'
      : a.status === 'offline' ? 'Playing offline: josemadrid.net could not be reached, so this session is not being recorded.'
        : a.status === 'guest' ? 'Guest on a local copy: nothing is recorded.' : a.error;
    if (signedIn && a.profile) {
      const p = a.profile.player;
      this.box.querySelector('.acct-handle').textContent = p.handle;
      const team = this.box.querySelector('.acct-team');
      team.textContent = p.team ? p.team.name : 'No fundraising group yet: pick one in My profile';
      team.style.color = p.team?.color || '';
      this.box.querySelector('.acct-stats').textContent =
        `${n(p.stats.wins)} wins · ${n(p.stats.knockouts)} KOs${p.rank ? ` · #${n(p.rank)} all time` : ''}${p.stats.currentStreak > 1 ? ` · ${p.stats.currentStreak} win streak` : ''}`;
    }
    if (this.menus.active === 'profile') this.renderProfile();
  }

  // ---------------------------------------------------------------- menu hooks
  onShow(name) {
    if (name === 'profile') { this.renderProfile(); this.account.refresh(); this.loadTeams(); }
    if (name === 'boards') this.loadBoard();
  }

  onAct(act, el) {
    const a = this.account;
    switch (act) {
      case 'acct-signin': a.signIn(); return true;
      case 'acct-guest': a.playAsGuest(); this.menus.show('title'); return true;
      case 'acct-signout': a.signOut(); this.menus.show('title'); return true;
      case 'to-profile':
        if (!a.recording) { this.menus.requireAccount(); return true; }
        this.menus.show('profile'); return true;
      case 'to-boards': this.boardsReturn = this.menus.active || 'title'; this.menus.show('boards'); return true;
      case 'boards-back': this.menus.show(this.boardsReturn === 'boards' ? 'title' : this.boardsReturn); return true;
      case 'boards-refresh': this.loadBoard(); return true;
      case 'board-player': this.showPlayer(el.dataset.handle); return true;
      case 'player-back': this.menus.show('boards'); return true;
      case 'prof-save-name': this.saveName(); return true;
      case 'prof-save-team': this.saveTeam(); return true;
    }
    return false;
  }

  onOpt(key, el, d) {
    const cyc = (list, v) => list[(list.findIndex(([k]) => k === v) + d + list.length) % list.length][0];
    switch (key) {
      case 'b-board': this.q.board = cyc(BOARDS, this.q.board); break;
      case 'b-period': this.q.period = cyc(PERIODS, this.q.period); break;
      case 'b-mode': this.q.mode = cyc(MODES, this.q.mode); break;
      case 'b-mine': this.q.mine = !this.q.mine; break;
      case 'prof-team': {
        const len = (this.teams?.length || 0) + 1; // the extra entry is "no group"
        this.teamPick = (this.teamPick + d + len) % len;
        this.renderTeamPicker();
        this.focus('profile', '[data-opt=prof-team]');
        return true;
      }
      default: return false;
    }
    this.loadBoard(`[data-opt=${key}]`);
    return true;
  }

  focus(screen, sel) { this.menus.screens[screen].querySelector(sel)?.focus({ preventScroll: true }); }

  // ---------------------------------------------------------------- profile
  renderProfile() {
    const el = this.menus.screens.profile;
    const prof = this.account.profile;
    if (!prof) return;
    const p = prof.player;
    el.querySelector('.prof-name').textContent = p.handle;
    el.querySelector('.prof-sub').textContent = [
      p.team ? `Fights for ${p.team.name}${p.team.school ? ` (${p.team.school})` : ''}` : 'Not in a fundraising group yet',
      p.favouriteFighter ? `Main: ${fighterName(p.favouriteFighter)}` : '',
      p.memberSince ? `Fighting since ${new Date(p.memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : '',
    ].filter(Boolean).join(' · ');
    const input = el.querySelector('#prof-handle');
    if (document.activeElement !== input) input.value = p.handle;
    el.querySelector('.prof-stats').innerHTML = statTiles(p.stats, p.rank, p.rating, p.rankedGames);
    el.querySelector('.prof-matches tbody').innerHTML = matchRows(prof.recentMatches, 7);
    this.renderTeamPicker();
  }

  async loadTeams() {
    if (this.teams) return;
    try {
      this.teams = await this.account.teams();
      const cur = this.account.team?.id;
      this.teamPick = cur ? Math.max(0, this.teams.findIndex((t) => t.id === cur)) : this.teams.length;
    } catch (err) { this.teams = null; this.profMsg(err.message); }
    this.renderTeamPicker();
  }

  renderTeamPicker() {
    const box = this.menus.screens.profile.querySelector('.prof-team');
    const p = this.account.profile?.player;
    if (!p) return;
    if (p.teamLocked) {
      box.innerHTML = `<p class="team-fixed" style="--tc:${esc(p.team?.color || '#ddd')}"><b>${esc(p.team?.name)}</b><br>Your group comes from your fundraiser account.</p>`;
      return;
    }
    if (!this.teams) { box.innerHTML = '<p class="team-fixed">Loading groups…</p>'; return; }
    const pick = this.teams[this.teamPick] || null;
    const wait = p.teamChangeAvailableAt ? `You can change groups again on ${new Date(p.teamChangeAvailableAt).toLocaleDateString()}.` : '';
    const focused = document.activeElement?.dataset?.opt === 'prof-team';
    box.innerHTML = `<button class="nav opt row" data-opt="prof-team"><span class="lbl">Group</span><span class="val"><i>‹</i>${esc(pick ? pick.name : 'No group')}<i>›</i></span></button>
      ${pick?.school ? `<p class="team-school">${esc(pick.school)}</p>` : ''}
      <button class="nav" data-act="prof-save-team" ${(pick?.id || null) === (p.team?.id || null) ? 'disabled' : ''}>Fight for this group</button>
      <p class="team-fixed">${this.teams.length ? 'Pick the group you are raising money with. ' : 'No fundraiser battles are running right now. '}${wait}</p>`;
    if (focused) this.focus('profile', '[data-opt=prof-team]');
  }

  profMsg(text) { this.menus.screens.profile.querySelector('.prof-msg').textContent = text; }

  async saveName() {
    const handle = this.menus.screens.profile.querySelector('#prof-handle').value;
    if (handle.trim() === this.account.handle) return;
    this.profMsg('Saving…');
    try { await this.account.update({ handle }); this.profMsg('Name saved.'); } catch (err) { this.profMsg(err.message); }
  }

  async saveTeam() {
    const pick = this.teams?.[this.teamPick] || null;
    this.profMsg('Saving…');
    try {
      await this.account.update({ teamId: pick ? pick.id : null });
      this.profMsg(pick ? `You now fight for ${pick.name}.` : 'You left your group.');
      this.focus('profile', '[data-opt=prof-team]');
    } catch (err) { this.profMsg(err.message); }
  }

  // ---------------------------------------------------------------- leaderboards
  renderBoardOpts() {
    const el = this.menus.screens.boards.querySelector('.board-opts');
    const label = (list, v) => list.find(([k]) => k === v)?.[1];
    const opt = (key, lbl, val) => `<button class="nav opt row" data-opt="${key}"><span class="lbl">${lbl}</span><span class="val"><i>‹</i>${esc(val)}<i>›</i></span></button>`;
    const team = this.account.team;
    el.innerHTML = [
      opt('b-board', 'Ranking', label(BOARDS, this.q.board)),
      opt('b-period', 'When', label(PERIODS, this.q.period)),
      opt('b-mode', 'Matches', label(MODES, this.q.mode)),
      team && this.q.board === 'players' ? opt('b-mine', 'Show', this.q.mine ? `${team.name} only` : 'Everyone') : '',
    ].join('');
  }

  async loadBoard(refocus) {
    const el = this.menus.screens.boards;
    this.renderBoardOpts();
    if (refocus) this.focus('boards', refocus);
    else el.querySelector('.board-opts .nav')?.focus({ preventScroll: true });
    const note = el.querySelector('.board-note');
    const q = { board: this.q.board, period: this.q.period, mode: this.q.mode, limit: 50 };
    if (this.q.mine && this.q.board === 'players' && this.account.team) q.teamId = this.account.team.id;
    const ticket = (this.boardTicket = (this.boardTicket || 0) + 1);
    note.textContent = 'Loading…';
    let data;
    try { data = await this.account.leaderboard(q); } catch (err) { if (ticket === this.boardTicket) note.textContent = err.message; return; }
    if (ticket !== this.boardTicket) return; // a newer choice is loading
    const head = el.querySelector('thead'), body = el.querySelector('tbody');
    const since = data.since ? ` since ${new Date(data.since).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : '';
    note.textContent = `${data.rows.length ? 'Ranked by wins, then knockouts' : 'Nobody has a result here yet. Be the first'}${since}.`;
    const me = this.account.handle, myTeam = this.account.team?.id;
    if (data.board === 'teams') {
      head.innerHTML = '<tr><th>#</th><th>Group</th><th>Fighters</th><th>Wins</th><th>KOs</th><th>Matches</th></tr>';
      body.innerHTML = data.rows.map((r) => `<tr class="${r.team.id === myTeam ? 'me' : ''}"><td>${r.rank}</td>
        <td><i class="sw" style="background:${esc(r.team.color)}"></i>${esc(r.team.name)}${r.team.school ? `<small> ${esc(r.team.school)}</small>` : ''}</td>
        <td>${n(r.fighters)}</td><td>${n(r.wins)}</td><td>${n(r.knockouts)}</td><td>${n(r.matches)}</td></tr>`).join('');
    } else {
      head.innerHTML = '<tr><th>#</th><th>Fighter</th><th>Group</th><th>Wins</th><th>KOs</th><th>Matches</th></tr>';
      body.innerHTML = data.rows.map((r) => `<tr class="nav${r.handle === me ? ' me' : ''}" tabindex="0" data-act="board-player" data-handle="${esc(r.handle)}"><td>${r.rank}</td>
        <td>${esc(r.handle)}</td><td>${r.team ? `<i class="sw" style="background:${esc(r.team.color)}"></i>${esc(r.team.name)}` : '—'}</td>
        <td>${n(r.wins)}</td><td>${n(r.knockouts)}</td><td>${n(r.matches)}</td></tr>`).join('');
    }
  }

  async showPlayer(handle) {
    if (!handle) return;
    const el = this.menus.screens.player;
    el.querySelector('.pl-name').textContent = handle;
    el.querySelector('.pl-sub').textContent = 'Loading…';
    el.querySelector('.pl-stats').innerHTML = '';
    el.querySelector('tbody').innerHTML = '';
    this.menus.show('player');
    try {
      const { player: p, recentMatches } = await this.account.player(handle);
      el.querySelector('.pl-sub').textContent = [p.team ? `Fights for ${p.team.name}` : 'No fundraising group', p.favouriteFighter ? `Main: ${fighterName(p.favouriteFighter)}` : ''].filter(Boolean).join(' · ');
      el.querySelector('.pl-stats').innerHTML = statTiles(p.stats, p.rank, p.rating, p.rankedGames);
      el.querySelector('tbody').innerHTML = matchRows(recentMatches, 5);
    } catch (err) { el.querySelector('.pl-sub').textContent = err.message; }
  }

  // a line under the results table saying whether the match went on the player's record
  showResult(r) {
    const el = this.menus.screens.results.querySelector('.acct-result');
    if (!el) return;
    if (!r.recorded) { el.textContent = r.reason && r.reason !== 'Already recorded.' ? `Not recorded: ${r.reason}` : ''; return; }
    el.textContent = r.won
      ? `Win recorded for ${this.account.handle}${r.streak > 1 ? ` · ${r.streak} wins in a row` : ''}.`
      : `Recorded for ${this.account.handle}: ${r.knockouts} KO${r.knockouts === 1 ? '' : 's'}. Get the next one.`;
    // ranked 1v1: the new rating and how far it moved
    if (Number.isFinite(r.rating)) {
      const d = Math.round(r.ratingDelta || 0);
      el.insertAdjacentHTML('beforeend', ` Rating <b>${Math.round(r.rating)}</b> <span class="${d >= 0 ? 'delta-up' : 'delta-down'}">(${d >= 0 ? '+' : ''}${d})</span>.`);
    }
  }
}
