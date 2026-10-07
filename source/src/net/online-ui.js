// Screens for online play: host or join a room, the room lobby, the in-match
// menu and the results buttons. Plugs into Menus through its onAct/onOpt/onShow hooks.
import { ROSTER, DIFFICULTY, TEAM_COLORS, cleanTeamName, arenaLabel } from '../config.js';
import { moveSummary } from '../ui.js';
import { lookSummary } from '../cosmetics.js';
import { shareOnFacebook } from '../share.js';
import { ONLINE_COLORS, MAX_PLAYERS, QUEUES, cleanCode, isRoomCode, cleanName, saveOnlineSettings } from './session.js';
import { TEAM_COLORS as QUEUE_TEAM_COLORS, HILL } from '../config.js';
import { isFundraiserCode, verifyFundraiserCode } from './tournament.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const OFFLINE_HELP = 'Online play needs an internet connection and the standalone game file. It cannot connect from inside the Claude preview: open battle-arena.html in Chrome, Edge, Firefox or Safari.';

export class OnlineMenus {
  constructor({ menus, session }) {
    this.menus = menus;
    this.session = session;
    this.busy = false;
    this.screen = menus.screens.online;
    this.lobbyEl = menus.screens.lobby;
    this.nameInput = this.screen.querySelector('#net-name');
    this.codeInput = this.screen.querySelector('#net-code');
    this.statusEl = this.screen.querySelector('.net-status');
    const results = menus.screens.results.querySelector('.actions');
    this.resultsActions = results;
    this.localResults = results.innerHTML;

    this.nameInput.addEventListener('input', () => {
      session.settings.name = this.nameInput.value;
      saveOnlineSettings(session.settings);
    });
    // the host's team name fields are rebuilt only when the number of teams changes, so typing keeps focus
    this.teamNamesEl = document.createElement('div');
    this.teamNamesEl.className = 'team-names';
    this.lobbyEl.querySelector('.net-rules').after(this.teamNamesEl);
    this.teamNamesEl.addEventListener('input', (e) => {
      const i = +e.target.dataset.team;
      if (Number.isInteger(i)) session.setTeamName(i, e.target.value, false);
    });
    this.teamNamesEl.addEventListener('focusout', (e) => {
      const i = +e.target.dataset.team;
      if (!Number.isInteger(i)) return;
      e.target.value = cleanTeamName(e.target.value, i);
      session.setTeamName(i, e.target.value, true);
    });
    this.codeInput.addEventListener('input', () => {
      const v = cleanCode(this.codeInput.value);
      if (v !== this.codeInput.value) this.codeInput.value = v;
    });

    session.onLobby = (back) => {
      if (session.kind === 'tournament') { this.tourney?.onLobby(back); return; }
      if (this.menus.active === 'lobby') this.renderLobby(true);
      else if (back) this.menus.show('lobby');
      else if (this.menus.active === 'results') this.decorateResults();
    };
    session.onMatchStart = () => { this.lastKind = session.kind; if (session.format) this.lastFormat = session.format; };
    session.onLeft = (reason) => {
      if (this.tourney?.owns) { this.tourney.onLeft(reason); return; }
      // after a queue battle the host leaving is no news: everyone is on the results screen already
      if (this.menus.active === 'results') { this.decorateResults(); return; }
      this.menus.show('online');
      this.setStatus(reason || 'You left the room.', !!reason);
    };
  }

  // A local (versus CPU) match is starting: results get the local buttons again.
  localMatch() { this.lastKind = null; }

  setStatus(text, bad = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('bad', bad);
  }

  onShow(name) {
    this.tourney?.onShow(name);
    if (name === 'online') {
      this.nameInput.value = this.session.settings.name || '';
      if (!this.busy) this.setStatus('');
    }
    if (name === 'lobby') this.renderLobby(false);
    if (name === 'results') this.decorateResults();
  }

  async onAct(act, el) {
    const s = this.session;
    if (this.tourney && (act === 'to-tourney' || act.startsWith('t-')) && await this.tourney.onAct(act, el)) return;
    switch (act) {
      case 'to-online': this.menus.show('online'); break;
      case 'net-queue':
      case 'net-requeue': {
        if (this.busy) return;
        // which queue: the button's data-q, or the one you just played for "Queue again"
        const format = act === 'net-requeue' ? this.lastFormat || 'brawl' : el?.dataset.q || 'brawl';
        this.lastFormat = format;
        if (act === 'net-requeue') this.menus.show('online');
        this.prepareName();
        this.busy = true;
        try {
          if (!await this.checkFundraiser()) return;
          this.setStatus(format === 'ranked' ? 'Looking for a ranked opponent…' : `Looking for a ${QUEUES[format].label.toLowerCase()} battle…`);
          await s.queue(format);
          this.menus.show(s.game.online === 'client' ? null : 'lobby');
        } catch (err) {
          this.setStatus(this.explain(err), true);
        } finally { this.busy = false; }
        break;
      }
      case 'net-invite-fb': if (s.lobby?.code) shareOnFacebook({ room: s.lobby.code }); break;
      case 'net-invite': {
        const link = this.inviteLink();
        try { await navigator.clipboard.writeText(link); this.flashShare('Invite link copied. Send it to your friends.'); } catch { this.flashShare(link); }
        break;
      }
      case 'net-host': {
        if (this.busy) return;
        this.prepareName();
        this.busy = true;
        try {
          if (!await this.checkFundraiser()) return;
          this.setStatus('Opening a room…');
          await s.host();
          this.menus.show('lobby');
        } catch (err) {
          this.setStatus(this.explain(err), true);
        } finally { this.busy = false; }
        break;
      }
      case 'net-join': {
        if (this.busy) return;
        const code = cleanCode(this.codeInput.value);
        if (!isRoomCode(code)) { this.setStatus('Type the 5-character room code from the host first.', true); this.codeInput.focus(); return; }
        this.prepareName();
        this.busy = true;
        try {
          if (!await this.checkFundraiser()) return;
          this.setStatus(`Joining room ${code}…`);
          await s.join(code);
          this.menus.show(s.game.online === 'client' ? null : 'lobby');
        } catch (err) {
          this.setStatus(this.explain(err), true);
        } finally { this.busy = false; }
        break;
      }
      case 'net-start':
      case 'net-rematch': s.startMatch(); break;
      case 'net-lobby': s.backToLobby(); this.menus.show('lobby'); break;
      case 'net-leave': s.leave(null); break;
      case 'net-other': this.lastKind = null; s.leave(null, true); this.menus.show('online'); break;
      case 'net-leave-title': this.lastKind = null; s.leave(null, true); this.menus.cb.onQuit(); break;
      case 'net-resume': this.menus.hideAll(); break;
    }
  }

  // Character select from a lobby ('net' = this room or queue, 't' = the tournament lobby). Whatever you
  // change in the wardrobe reaches the room when you leave the screen.
  openSelect(key) {
    const s = this.session;
    if (!s.connected) return;
    const back = key === 't' ? 'tlobby' : 'lobby';
    this.menus.select.open({
      context: key === 't' ? 'Tournament' : s.kind === 'queue' ? 'Online brawl' : 'Online room',
      fighter: s.settings.fighter,
      confirm: (def) => (def ? `Fight as ${def.name}` : 'Fight as a random fighter'),
      onConfirm: (f) => { s.settings.fighter = f; },
      onClose: (f, ok) => {
        if (!s.connected) return;
        s.setFighter(ok ? f : s.settings.fighter);
        if (key === 't') this.tourney?.render(true); else if (this.menus.active === 'lobby') this.renderLobby(true);
        this.menus.screens[back].querySelector('[data-cs]')?.focus({ preventScroll: true });
      },
      // a new outfit reaches the room as soon as you put it on
      onChange: () => { if (s.connected) s.setFighter(s.settings.fighter); },
      back,
    });
  }

  onOpt(key, el, d) {
    const s = this.session;
    if (key.startsWith('t-')) { this.tourney?.onOpt(key, d); return; }
    if (!s.connected) return;
    if (key === 'net-fighter') s.pickFighter(d);
    else if (key === 'net-team') s.pickTeam(d);
    else if (s.isHost && key.startsWith('net-')) s.setRule(key.slice(4), d);
    this.renderLobby(true);
  }

  prepareName() {
    const s = this.session;
    s.settings.name = cleanName(this.nameInput.value);
    this.nameInput.value = s.settings.name;
    saveOnlineSettings(s.settings);
  }

  // Online battles are for enrolled fundraising groups: the José Madrid Salsa site checks the code
  // typed on the title screen, so a code made in its admin panel works on any device. Resolves to
  // the group's name, or null after telling the player why not. (The host checks everyone again.)
  async checkFundraiser() {
    const typed = this.menus.group;
    this.session.fundraiserCode = typed;
    if (!isFundraiserCode(typed)) {
      this.setStatus('');
      this.menus.flagGroup('Online play needs your group\'s fundraiser code (like JM-7KQ4-X2PD), not its name. Ask your organizer for it.');
      return null;
    }
    this.setStatus('Checking your fundraiser code…');
    try {
      const name = await verifyFundraiserCode(typed);
      if (name) return name;
      this.setStatus('');
      this.menus.flagGroup('That fundraiser code is not registered. Check it with your organizer.');
    } catch {
      this.setStatus('Could not reach the José Madrid Salsa site to check your fundraiser code. Check your connection and try again.', true);
    }
    return null;
  }

  inviteLink() {
    const code = this.session.lobby?.code || '';
    return /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}?room=${code}` : code;
  }

  flashShare(text) {
    this.lobbyEl.querySelector('.lobby-share').textContent = text;
    this.flashUntil = performance.now() + 2500;
  }

  explain(err) {
    if (err?.kind === 'server' || err?.kind === 'unsupported') return `${err.message} ${OFFLINE_HELP}`;
    return err?.message || 'Something went wrong. Try again.';
  }

  renderLobby(keepFocus) {
    const s = this.session;
    const L = s.lobby;
    if (!L) return;
    const el = this.lobbyEl;
    const focused = document.activeElement;
    const focusKey = keepFocus && el.contains(focused) && !this.teamNamesEl.contains(focused) ? `${focused.dataset.opt || ''}|${focused.dataset.act || ''}` : null;

    if (L.kind === 'queue') { this.renderQueue(keepFocus); return; }
    el.querySelector('.lobby-head .eyebrow').textContent = 'Room code';
    el.querySelector('.room-code').textContent = L.code;
    const link = /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}?room=${L.code}` : '';
    el.querySelector('.lobby-share').innerHTML = s.isHost
      ? `Share this code. Friends open the game, choose <b>Fight online</b> and type it in.${link ? ` Or send them <span class="invite">${esc(link)}</span>` : ''}`
      : 'You are in. The host starts the fight when everyone is ready.';

    const r = L.rules;
    const count = Math.max(r.count, L.members.length);
    const ruleRows = [
      ['count', 'Fighters', count],
      ['wins', 'Rounds to win', r.winsNeeded],
      ['diff', 'CPU skill', DIFFICULTY[r.difficulty]?.label || r.difficulty],
      ['sudden', 'Sudden death', r.suddenDeath ? `after ${r.suddenDeath}s` : 'Off'],
      ['arena', 'Arena', arenaLabel(r.arena)],
      ['teams', 'Teams', r.teams ? `${r.teams} teams` : 'Free-for-all'],
    ];
    const tc = r.teams || 0;
    const teamName = (t) => cleanTeamName(r.teamNames?.[t], t);
    if (s.isHost) {
      if (this.teamNamesCount !== tc) {
        this.teamNamesCount = tc;
        this.teamNamesEl.innerHTML = tc ? `<div class="col-h">Team names</div>${Array.from({ length: tc }, (_, i) => `
          <label class="field team-field" style="--tc:${hex(TEAM_COLORS[i])}"><span class="lbl">Team ${i + 1}</span>
          <input class="nav" data-team="${i}" maxlength="18" autocomplete="off" spellcheck="false" value="${esc(teamName(i))}"></label>`).join('')}` : '';
      }
    } else {
      this.teamNamesCount = -1;
      this.teamNamesEl.innerHTML = tc ? `<div class="col-h">Teams</div>${Array.from({ length: tc }, (_, i) =>
        `<div class="row static team-static" style="--tc:${hex(TEAM_COLORS[i])}"><span class="lbl">Team ${i + 1}</span><span class="val">${esc(teamName(i))}</span></div>`).join('')}` : '';
    }
    this.teamNamesEl.hidden = !tc;
    el.querySelector('.net-rules').innerHTML = ruleRows.map(([k, label, v]) => s.isHost
      ? `<button class="nav opt row" data-opt="net-${k}"><span class="lbl">${label}</span><span class="val"><i>‹</i>${esc(v)}<i>›</i></span></button>`
      : `<div class="row static"><span class="lbl">${label}</span><span class="val">${esc(v)}</span></div>`).join('');

    const rows = [];
    for (let i = 0; i < count; i++) {
      const m = L.members[i];
      const fighter = m ? m.fighter : null;
      const def = fighter != null && fighter >= 0 ? ROSTER[fighter] : null;
      const mine = m && m.id === s.myId;
      const color = m ? ONLINE_COLORS[m.color] : '';
      const who = m ? `<span style="color:${color}">${esc(m.name)}</span>${mine ? '<small>You</small>' : ''}` : '<span>CPU</span>';
      const fname = m ? (def ? esc(def.name) : 'Random') : 'Random';
      const dress = m && def ? lookSummary(m.looks?.[def.id]) : '';
      const ftitle = (dress ? `<em class="dress">${esc(dress)}</em> · ` : '') + (def ? `${esc(def.title)} · ${esc(moveSummary(def))}` : m ? 'Any of the eight' : 'Fills the empty seat');
      const inner = `<span class="fname">${fname}</span><span class="ftitle">${ftitle}</span>`;
      let team = '';
      if (tc) {
        const t = m ? (m.team || 0) % tc : -1;
        const label = t >= 0 ? `<span>${esc(teamName(t))}</span>` : '<span>Auto</span>';
        const style = `style="--tc:${t >= 0 ? hex(TEAM_COLORS[t]) : '#888'}"`;
        team = mine ? `<button class="nav opt team" data-opt="net-team" ${style}>${label}</button>` : `<div class="team" ${style}>${label}</div>`;
      }
      rows.push(`<div class="slot" style="--fc:${def ? hex(def.eyes) : '#888'}">
        <span class="slot-n">${i + 1}</span>
        <div class="who">${who}</div>
        ${mine ? `<button class="nav opt fighter" data-opt="net-fighter" data-cs="net">${inner}</button>` : `<div class="fighter">${inner}</div>`}${team}
      </div>`);
    }
    el.querySelector('.net-slots').innerHTML = rows.join('');
    el.querySelector('.net-slots').dataset.html = '';
    el.querySelector('.net-slots').classList.toggle('teamed', !!tc);

    const humans = L.members.length;
    el.querySelector('.net-note').textContent = L.inMatch
      ? 'A match is running. You join the next one.'
      : `${humans} ${humans === 1 ? 'player' : 'players'} in the room${count > humans ? `, ${count - humans} CPU` : ''}. Up to ${MAX_PLAYERS} people can join.`;
    el.querySelector('.net-actions').dataset.mode = '';
    el.querySelector('.net-actions').innerHTML = s.isHost
      ? '<button class="nav big primary" data-act="net-start">Begin the fight</button><button class="nav big" data-act="to-friends">Invite friends</button><button class="nav big" data-act="net-invite-fb">Invite on Facebook</button><button class="nav big" data-act="to-controls">Controls</button><button class="nav big" data-act="net-leave">Close room</button>'
      : '<span class="waiting">Waiting for the host…</span><button class="nav big" data-act="to-friends">Invite friends</button><button class="nav big" data-act="to-controls">Controls</button><button class="nav big" data-act="net-leave">Leave room</button>';

    if (focusKey) {
      const again = [...el.querySelectorAll('.nav')].find((x) => `${x.dataset.opt || ''}|${x.dataset.act || ''}` === focusKey);
      again?.focus({ preventScroll: true });
    }
  }

  // The queue's waiting room: a countdown (or, in ranked, the search), who is in, your fighter, and an invite link.
  renderQueue(keepFocus) {
    const s = this.session;
    const L = s.lobby;
    const el = this.lobbyEl;
    const format = L.format || 'brawl';
    const Q = QUEUES[format] || QUEUES.brawl;
    const searching = Q.rated && L.queue?.left == null;
    const elapsed = Math.max(0, Math.floor((Date.now() - (L.queue?.since || Date.now())) / 1000));
    el.querySelector('.lobby-head .eyebrow').textContent = searching ? 'Ranked 1v1 · searching' : Q.rated ? 'Opponent found · fight in' : `${Q.label} · battle starts in`;
    el.querySelector('.room-code').textContent = searching ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : `${L.queue?.left ?? 0}s`;
    if (!(performance.now() < this.flashUntil)) {
      el.querySelector('.lobby-share').innerHTML = Q.rated
        ? (searching ? 'Waiting for another fighter to queue for ranked. Stay on this screen; the fight starts by itself.' : 'Best of three. Leaving now counts as a loss.')
        : `Everyone who joins this queue before the countdown ends fights in this battle. Invite friends: <span class="invite">${esc(this.inviteLink())}</span>`;
    }
    this.teamNamesEl.hidden = true;
    this.teamNamesEl.innerHTML = '';
    this.teamNamesCount = -1;
    const ruleRows = {
      brawl: [['Battle', 'Free-for-all'], ['Rounds to win', L.rules.winsNeeded], ['Arena', 'Random each battle, power-ups on']],
      hill: [['Battle', 'King of the hill'], ['Round', `First to ${HILL.target} points`], ['Knocked out', `Back in ${HILL.respawn}s`]],
      duo: [['Battle', 'Two teams of two'], ['Rounds to win', L.rules.winsNeeded], ['Arena', 'Coliseum, power-ups on']],
      ranked: [['Battle', 'One on one'], ['Match', 'Best of three'], ['Arena', 'Coliseum, no power-ups']],
    }[format];
    el.querySelector('.net-rules').innerHTML = ruleRows
      .map(([k, v]) => `<div class="row static"><span class="lbl">${k}</span><span class="val">${esc(v)}</span></div>`).join('');
    const count = Math.max(Q.fill, L.members.length);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const m = L.members[i];
      const def = m && m.fighter >= 0 ? ROSTER[m.fighter] : null;
      const mine = m && m.id === s.myId;
      const rating = Q.rated && m ? `<span class="rating">${Number.isFinite(m.rating) ? m.rating : 'Unrated'}</span>` : '';
      const who = m ? `<span style="color:${ONLINE_COLORS[m.color]}">${esc(m.name)}</span>${rating}${mine ? '<small>You</small>' : ''}` : `<span>${Q.rated ? 'Searching…' : 'CPU'}</span>`;
      const dress = m && def ? lookSummary(m.looks?.[def.id]) : '';
      const empty = Q.rated ? 'A real opponent takes this seat' : 'A CPU takes this seat if nobody joins';
      const inner = `<span class="fname">${m ? (def ? esc(def.name) : 'Random') : 'Waiting…'}</span><span class="ftitle">${dress ? `<em class="dress">${esc(dress)}</em> · ` : ''}${def ? `${esc(def.title)} · ${esc(moveSummary(def))}` : m ? 'Any of the eight' : empty}</span>`;
      // 2v2: the team each seat fights for (people as the host placed them, CPUs fill the short side)
      const t = Q.teams && m ? (m.team || 0) % Q.teams : -1;
      const team = Q.teams ? `<div class="team" style="--tc:${t >= 0 ? hex(QUEUE_TEAM_COLORS[t]) : '#888'}"><span>${t >= 0 ? esc(L.rules.teamNames?.[t] || `Team ${t + 1}`) : 'Auto'}</span></div>` : '';
      rows.push(`<div class="slot" style="--fc:${def ? hex(def.eyes) : '#888'}"><span class="slot-n">${i + 1}</span><div class="who">${who}</div>
        ${mine ? `<button class="nav opt fighter" data-opt="net-fighter" data-cs="net">${inner}</button>` : `<div class="fighter">${inner}</div>`}${team}</div>`);
    }
    // the countdown re-renders every second: only touch the seats when they changed, so clicks on them land
    const slotsEl = el.querySelector('.net-slots'), slotsHtml = rows.join('');
    if (slotsEl.dataset.html !== slotsHtml) { slotsEl.innerHTML = slotsHtml; slotsEl.dataset.html = slotsHtml; }
    slotsEl.classList.toggle('teamed', !!Q.teams);
    el.querySelector('.net-note').textContent = Q.rated
      ? (searching ? 'Ranked fights are always one real player against another. Your rating moves with every result.' : 'Good luck.')
      : `${L.members.length} in the queue. Up to ${Q.max} fight; CPUs fill a battle up to ${Q.fill}.`;
    const focusKey = keepFocus && el.contains(document.activeElement) ? `${document.activeElement.dataset.opt || ''}|${document.activeElement.dataset.act || ''}` : null;
    const actions = el.querySelector('.net-actions');
    const mode = `queue-${Q.rated ? (searching ? 'search' : 'found') : 'open'}`;
    if (actions.dataset.mode !== mode) {
      actions.dataset.mode = mode;
      actions.innerHTML = Q.rated
        ? `<button class="nav big" data-act="to-controls">Controls</button><button class="nav big" data-act="net-leave">${searching ? 'Stop searching' : 'Leave (counts as a loss)'}</button>`
        : '<button class="nav big primary" data-act="net-invite">Copy invite link</button><button class="nav big" data-act="net-invite-fb">Invite on Facebook</button><button class="nav big" data-act="to-controls">Controls</button><button class="nav big" data-act="net-leave">Leave queue</button>';
    }
    if (focusKey) [...el.querySelectorAll('.nav')].find((x) => `${x.dataset.opt || ''}|${x.dataset.act || ''}` === focusKey)?.focus({ preventScroll: true });
  }

  // The results screen offers different buttons online: only the host restarts. After a queue battle
  // everyone simply queues again.
  decorateResults() {
    const s = this.session;
    const el = this.resultsActions;
    const screen = this.menus.screens.results;
    if (this.lastKind === 'queue' || s.kind === 'queue') {
      this.lastKind = 'queue';
      screen.dataset.back = 'net-leave-title';
      if (el.dataset.mode !== `queue-${this.lastFormat}`) {
        el.dataset.mode = `queue-${this.lastFormat}`;
        const label = QUEUES[this.lastFormat || 'brawl']?.label || 'Free-for-all';
        el.innerHTML = `<button class="nav big primary" data-act="net-requeue">Queue again <small>${esc(label)}</small></button><button class="nav big" data-act="net-other">Other queues</button><button class="nav big" data-act="net-leave-title">Title screen</button>`;
        if (this.menus.active === 'results') el.querySelector('.nav')?.focus({ preventScroll: true });
      }
      return;
    }
    if (!s.connected) { screen.dataset.back = 'quit'; if (el.dataset.mode !== 'local') { el.innerHTML = this.localResults; el.dataset.mode = 'local'; } return; }
    const mode = s.isHost ? 'host' : 'client';
    screen.dataset.back = s.isHost ? 'net-lobby' : '';
    if (el.dataset.mode === mode) return;
    el.dataset.mode = mode;
    el.innerHTML = s.isHost
      ? '<button class="nav big primary" data-act="net-rematch">Rematch</button><button class="nav big" data-act="net-lobby">Back to the room</button><button class="nav big" data-act="net-leave">Leave room</button>'
      : '<span class="waiting">The host picks a rematch or heads back to the room.</span><button class="nav big" data-act="net-leave">Leave room</button>';
    if (this.menus.active === 'results') el.querySelector('.nav')?.focus({ preventScroll: true });
  }
}
