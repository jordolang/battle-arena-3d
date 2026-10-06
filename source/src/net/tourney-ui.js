// Tournament screens: join (as a fighter for your fundraising group, or to watch) or host as the admin,
// then the tournament lobby with teams, the bracket and the live chat. The admin's browser runs every
// match; everyone else fights or watches from their own.
import { ROSTER } from '../config.js';
import { moveSummary } from '../ui.js';
import { ONLINE_COLORS, cleanCode, cleanName, randomCode, saveOnlineSettings } from './session.js';
import { TEAM_SIZES, teamsOf, nextMatch, roundName, describeStart, loadTournamentSettings, saveTournamentSettings, cleanText } from './tournament.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class TournamentMenus {
  constructor({ menus, session, online, chat }) {
    this.menus = menus;
    this.session = session;
    this.online = online;
    this.chat = chat;
    this.owns = false;       // true from joining or hosting a tournament until leaving it
    this.busy = false;
    this.screen = menus.screens.tourney;
    this.lobbyEl = menus.screens.tlobby;
    this.statusEl = this.screen.querySelector('.t-status');
    this.nameInput = this.screen.querySelector('#t-name');
    this.codeInput = this.screen.querySelector('#t-code');
    this.form = { title: this.screen.querySelector('#t-title'), when: this.screen.querySelector('#t-when'), prize: this.screen.querySelector('#t-prize') };
    this.settings = loadTournamentSettings();
    if (!this.settings.code) { this.settings.code = randomCode(); saveTournamentSettings(this.settings); }
    this.form.title.value = this.settings.name;
    this.form.when.value = this.settings.startsAt;
    this.form.prize.value = this.settings.prize;
    for (const [k, input] of Object.entries(this.form)) {
      input.addEventListener('input', () => {
        this.settings[k === 'title' ? 'name' : k === 'when' ? 'startsAt' : 'prize'] = input.value;
        saveTournamentSettings(this.settings);
      });
    }
    this.nameInput.addEventListener('input', () => { session.settings.name = this.nameInput.value; saveOnlineSettings(session.settings); });
    this.codeInput.addEventListener('input', () => { const v = cleanCode(this.codeInput.value); if (v !== this.codeInput.value) this.codeInput.value = v; });
    // the admin's clock in the lobby header ticks once a minute
    setInterval(() => { if (this.menus.active === 'tlobby') this.renderHead(); }, 30000);
  }

  setStatus(text, bad = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('bad', bad);
  }

  onShow(name) {
    if (name === 'tourney') {
      this.nameInput.value = this.session.settings.name || '';
      const group = this.menus.group;
      this.screen.querySelector('.t-myteam').innerHTML = group
        ? `You fight for <b>${esc(group)}</b>. Teammates must type the same group on the title screen.`
        : 'Enter your fundraising group on the title screen to fight. You can still watch.';
      this.renderOpts();
      if (!this.busy) this.setStatus('');
    }
    if (name === 'tlobby') this.render(false);
    // the chat sits beside the bracket in the lobby and floats over the arena during a match
    const live = this.owns && this.session.kind === 'tournament';
    if (name === 'tlobby') this.chat.show(true, this.lobbyEl.querySelector('.t-chat-slot'));
    else this.chat.show(live && !name, null);
  }

  renderOpts() {
    const t = this.settings;
    const opt = (key, label, value) => `<button class="nav opt row" data-opt="${key}"><span class="lbl">${label}</span><span class="val"><i>‹</i>${esc(value)}<i>›</i></span></button>`;
    this.screen.querySelector('.t-opts').innerHTML = [
      opt('t-size', 'Fighters per team', t.teamSize),
      opt('t-wins', 'Rounds to win a match', t.wins),
      opt('t-fill', 'Short teams', t.fill ? 'CPU fills in' : 'Fight short'),
    ].join('');
    const link = /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}?t=${t.code}` : '';
    this.screen.querySelector('.t-admin-code').innerHTML = `Your tournament code is <b class="code-chip">${t.code}</b>. Share it${link ? ` (or <span class="invite">${esc(link)}</span>)` : ''} with the teams before the day. <button class="nav link" data-act="t-newcode">New code</button>`;
  }

  onOpt(key, d) {
    const t = this.settings;
    if (key === 't-size') t.teamSize = TEAM_SIZES[(TEAM_SIZES.indexOf(t.teamSize) + d + TEAM_SIZES.length) % TEAM_SIZES.length];
    else if (key === 't-wins') t.wins = ((t.wins - 1 + d + 3) % 3) + 1;
    else if (key === 't-fill') t.fill = !t.fill;
    else if (key === 't-fighter') { this.session.pickFighter(d); this.render(true); return; }
    else return;
    saveTournamentSettings(t);
    const focus = `[data-opt="${key}"]`;
    this.renderOpts();
    this.screen.querySelector(focus)?.focus({ preventScroll: true });
  }

  async onAct(act, el) {
    const s = this.session;
    switch (act) {
      case 'to-tourney': this.menus.show('tourney'); return true;
      case 't-newcode':
        this.settings.code = randomCode();
        saveTournamentSettings(this.settings);
        this.renderOpts();
        this.screen.querySelector('[data-act="t-newcode"]')?.focus();
        return true;
      case 't-join-fight':
      case 't-join-watch': {
        if (this.busy) return true;
        const code = cleanCode(this.codeInput.value);
        if (code.length !== 5) { this.setStatus('Type the 5-character tournament code from the admin first.', true); this.codeInput.focus(); return true; }
        const role = act === 't-join-fight' ? 'player' : 'spectator';
        this.prepareName();
        this.busy = true;
        this.setStatus(`Joining tournament ${code}…`);
        try {
          await s.join(code, { role, group: this.menus.group });
          if (s.kind !== 'tournament') { s.leave(null, true); throw new Error('That code is not a tournament. Use Fight online to join a friend.'); }
          this.owns = true;
          this.menus.show(s.game.online === 'client' ? null : 'tlobby');
          if (!this.menus.active) this.onShow(null);
        } catch (err) {
          this.setStatus(err?.kind === 'noroom' ? `Tournament ${code} is not open yet. The admin opens it at the start time; try again then.` : this.online.explain(err), true);
        } finally { this.busy = false; }
        return true;
      }
      case 't-host': {
        if (this.busy) return true;
        this.prepareName();
        this.settings.name = cleanText(this.form.title.value, 48) || 'José Madrid Salsa Showdown';
        this.settings.prize = cleanText(this.form.prize.value, 160);
        this.settings.startsAt = this.form.when.value;
        saveTournamentSettings(this.settings);
        this.busy = true;
        this.setStatus('Opening the tournament room…');
        try {
          await s.host({ kind: 'tournament', code: this.settings.code, tournament: this.settings });
          this.owns = true;
          this.menus.show('tlobby');
        } catch (err) {
          this.setStatus(this.online.explain(err), true);
        } finally { this.busy = false; }
        return true;
      }
      case 't-start': {
        const err = s.startTournament();
        if (err) this.note(err, true);
        return true;
      }
      case 't-next': s.startTournamentMatch(); return true;
      case 't-kick': s.kick(el?.dataset.id); return true;
      case 't-chat': this.chat.open(); return true;
      case 't-leave':
        this.owns = false;
        s.leave(null, true);
        this.chat.show(false);
        this.menus.show('tourney');
        this.setStatus(s.isHost ? 'Tournament closed.' : 'You left the tournament.');
        return true;
    }
    return false;
  }

  prepareName() {
    const s = this.session;
    s.settings.name = cleanName(this.nameInput.value);
    this.nameInput.value = s.settings.name;
    saveOnlineSettings(s.settings);
  }

  onLobby(back) {
    if (this.menus.active === 'tlobby') this.render(true);
    else if (back) this.menus.show('tlobby');
  }

  onLeft(reason) {
    this.owns = false;
    this.chat.show(false);
    this.menus.show('tourney');
    this.setStatus(reason || 'You left the tournament.', !!reason);
  }

  note(text, bad = false) {
    const el = this.lobbyEl.querySelector('.t-note');
    el.textContent = text;
    el.classList.toggle('bad', bad);
  }

  renderHead() {
    const t = this.session.lobby?.tournament;
    if (!t) return;
    const el = this.lobbyEl;
    el.querySelector('.t-code').textContent = `· code ${this.session.lobby.code}`;
    el.querySelector('.t-title').textContent = t.name;
    const when = describeStart(t.startsAt);
    el.querySelector('.t-when').textContent = when ? `Starts ${when}` : '';
    el.querySelector('.t-prize').innerHTML = t.prize ? `<b>Prize</b> ${esc(t.prize)}` : '';
  }

  render(keepFocus) {
    const s = this.session;
    const L = s.lobby;
    const t = L?.tournament;
    if (!t) return;
    const el = this.lobbyEl;
    const focused = document.activeElement;
    const focusKey = keepFocus && el.contains(focused) ? `${focused.dataset.opt || ''}|${focused.dataset.act || ''}|${focused.dataset.id || ''}` : null;
    this.renderHead();

    // teams and who is in them
    const teams = teamsOf(L.members);
    const names = t.names || Object.fromEntries([...teams.values()].map((x) => [x.key, x.name]));
    const live = t.current;
    const teamRows = [...teams.values()].map((team) => {
      const out = t.bracket && !this.stillIn(t, team.key);
      const playing = live && (live.a === team.key || live.b === team.key);
      const people = team.members.map((m) => {
        const def = m.fighter >= 0 ? ROSTER[m.fighter] : null;
        const kick = s.isHost ? `<button class="nav link kick" data-act="t-kick" data-id="${esc(m.id)}" title="Remove ${esc(m.name)}">✕</button>` : '';
        return `<li><span style="color:${ONLINE_COLORS[m.color] || '#ddd'}">${esc(m.name)}</span>${m.id === s.myId ? '<small>You</small>' : ''} <em>${def ? esc(def.name) : 'Random'}</em>${kick}</li>`;
      }).join('');
      const short = team.members.length < t.teamSize ? ` · ${t.fill ? 'CPU fills' : 'short'} ${t.teamSize - team.members.length}` : '';
      return `<div class="t-team${out ? ' out' : ''}${playing ? ' live' : ''}${t.champion === team.key ? ' champ' : ''}"><div class="t-team-name">${esc(team.name)}<span>${team.members.length}/${t.teamSize}${short}</span></div><ul>${people}</ul></div>`;
    });
    const fans = L.members.filter((m) => m.role === 'spectator' || m.role === 'admin');
    const fanRow = fans.length ? `<div class="t-fans"><b>Watching</b> ${fans.map((m) => `${esc(m.name)}${m.role === 'admin' ? ' (admin)' : ''}${s.isHost && m.role !== 'admin' ? `<button class="nav link kick" data-act="t-kick" data-id="${esc(m.id)}" title="Remove ${esc(m.name)}">✕</button>` : ''}`).join(', ')}</div>` : '';
    el.querySelector('.t-teams').innerHTML = (teamRows.join('') || '<p class="empty">No teams yet. Players join with the tournament code and their fundraising group.</p>') + fanRow;

    // your own fighter, for players
    const me = s.me;
    const def = me && me.fighter >= 0 ? ROSTER[me.fighter] : null;
    el.querySelector('.t-me').innerHTML = me?.role === 'player'
      ? `<div class="col-h">Your fighter</div><div class="slot" style="--fc:${def ? hex(def.eyes) : '#888'}"><button class="nav opt fighter" data-opt="t-fighter"><span class="fname">${def ? esc(def.name) : 'Random'}</span><span class="ftitle">${def ? `${esc(def.title)} · ${esc(moveSummary(def))}` : 'Any of the eight'}</span></button></div>`
      : '';

    // the bracket
    const b = t.bracket;
    const up = b ? nextMatch(b) : null;
    el.querySelector('.t-bracket').innerHTML = b ? `<div class="rounds">${b.rounds.map((round, r) => `<div class="round"><div class="round-h">${roundName(b, r)}</div>${round.map((m, i) => {
      const side = (k) => (k ? `<span class="${m.winner === k ? 'won' : m.winner ? 'lost' : ''}">${esc(names[k] || k)}</span>` : `<span class="tbd">${r === 0 ? 'bye' : 'TBD'}</span>`);
      const isLive = live && live.r === r && live.i === i;
      const isNext = !isLive && up && up.r === r && up.i === i;
      return `<div class="match${isLive ? ' live' : ''}${isNext ? ' next' : ''}">${side(m.a)}${side(m.b)}${isLive ? '<em>Live</em>' : isNext ? '<em>Next</em>' : ''}</div>`;
    }).join('')}</div>`).join('')}</div>` : `<p class="empty">The admin draws the bracket once the teams are in. Up to ${teams.size} ${teams.size === 1 ? 'team' : 'teams'} so far.</p>`;
    el.querySelector('.t-last').innerHTML = t.champion
      ? `<span class="champ-line">Champions: <b>${esc(names[t.champion])}</b>${t.prize ? `. Prize: ${esc(t.prize)}` : ''}</span>`
      : esc(t.last || '');

    // what happens next
    const noteText = t.status === 'open'
      ? (s.isHost ? `${teams.size} ${teams.size === 1 ? 'team' : 'teams'} in the room. Draw the bracket when every team that agreed to play is here.` : 'Waiting for the admin to draw the bracket.')
      : t.status === 'running'
        ? (L.inMatch ? 'A match is live. It shows here when it ends.' : up ? `Up next, ${roundName(b, up.r)}: ${names[up.a]} vs ${names[up.b]}.` : '')
        : 'The tournament is over. Thanks for fighting for your fundraiser!';
    this.note(noteText);
    const actions = [];
    if (s.isHost) {
      if (t.status === 'open') actions.push('<button class="nav big primary" data-act="t-start">Draw the bracket</button>');
      if (t.status === 'running' && !L.inMatch && up) actions.push(`<button class="nav big primary" data-act="t-next">Start: ${esc(names[up.a])} vs ${esc(names[up.b])}</button>`);
    }
    actions.push('<button class="nav big" data-act="t-chat">Chat (T)</button>');
    actions.push('<button class="nav big" data-act="to-controls">Controls</button>');
    actions.push(`<button class="nav big" data-act="t-leave">${s.isHost ? 'Close tournament' : 'Leave'}</button>`);
    const actionsHtml = actions.join('');
    const actionsEl = el.querySelector('.t-actions');
    if (actionsEl.dataset.html !== actionsHtml) { actionsEl.innerHTML = actionsHtml; actionsEl.dataset.html = actionsHtml; }

    if (focusKey) {
      const again = [...el.querySelectorAll('.nav')].find((x) => `${x.dataset.opt || ''}|${x.dataset.act || ''}|${x.dataset.id || ''}` === focusKey);
      (again || el.querySelector('.t-actions .nav'))?.focus({ preventScroll: true });
    } else if (!keepFocus) el.querySelector('.t-actions .nav')?.focus({ preventScroll: true });
  }

  stillIn(t, key) {
    if (t.champion) return t.champion === key;
    // a team is out once it lost a decided match
    for (const round of t.bracket.rounds) for (const m of round) if (m.winner && (m.a === key || m.b === key) && m.winner !== key) return false;
    return true;
  }
}

