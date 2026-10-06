// Screens for online play: host or join a room, the room lobby, the in-match
// menu and the results buttons. Plugs into Menus through its onAct/onOpt/onShow hooks.
import { ROSTER, DIFFICULTY, TEAM_COLORS, cleanTeamName } from '../config.js';
import { moveSummary } from '../ui.js';
import { lookSummary } from '../cosmetics.js';
import { shareOnFacebook } from '../share.js';
import { ONLINE_COLORS, MAX_PLAYERS, cleanCode, cleanName, saveOnlineSettings } from './session.js';

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
    session.onMatchStart = () => { this.lastKind = session.kind; };
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
        if (act === 'net-requeue') this.menus.show('online');
        this.prepareName();
        this.busy = true;
        this.setStatus('Looking for a battle…');
        try {
          await s.queue();
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
        this.setStatus('Opening a room…');
        try {
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
        if (code.length !== 5) { this.setStatus('Type the 5-character room code from the host first.', true); this.codeInput.focus(); return; }
        this.prepareName();
        this.busy = true;
        this.setStatus(`Joining room ${code}…`);
        try {
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
      ? '<button class="nav big primary" data-act="net-start">Begin the fight</button><button class="nav big" data-act="net-invite-fb">Invite on Facebook</button><button class="nav big" data-act="to-controls">Controls</button><button class="nav big" data-act="net-leave">Close room</button>'
      : '<span class="waiting">Waiting for the host…</span><button class="nav big" data-act="to-controls">Controls</button><button class="nav big" data-act="net-leave">Leave room</button>';

    if (focusKey) {
      const again = [...el.querySelectorAll('.nav')].find((x) => `${x.dataset.opt || ''}|${x.dataset.act || ''}` === focusKey);
      again?.focus({ preventScroll: true });
    }
  }

  // The queue's waiting room: a countdown, who is in, your fighter, and an invite link.
  renderQueue(keepFocus) {
    const s = this.session;
    const L = s.lobby;
    const el = this.lobbyEl;
    el.querySelector('.lobby-head .eyebrow').textContent = 'Battle starts in';
    el.querySelector('.room-code').textContent = `${L.queue?.left ?? 0}s`;
    if (!(performance.now() < this.flashUntil)) el.querySelector('.lobby-share').innerHTML = `Everyone who joins the queue before the countdown ends fights in this battle. Invite friends: <span class="invite">${esc(this.inviteLink())}</span>`;
    this.teamNamesEl.hidden = true;
    this.teamNamesEl.innerHTML = '';
    this.teamNamesCount = -1;
    el.querySelector('.net-rules').innerHTML = [['Battle', 'Free-for-all'], ['Rounds to win', L.rules.winsNeeded], ['Arena', 'Coliseum, power-ups on']]
      .map(([k, v]) => `<div class="row static"><span class="lbl">${k}</span><span class="val">${esc(v)}</span></div>`).join('');
    const count = Math.max(4, L.members.length);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const m = L.members[i];
      const def = m && m.fighter >= 0 ? ROSTER[m.fighter] : null;
      const mine = m && m.id === s.myId;
      const who = m ? `<span style="color:${ONLINE_COLORS[m.color]}">${esc(m.name)}</span>${mine ? '<small>You</small>' : ''}` : '<span>CPU</span>';
      const dress = m && def ? lookSummary(m.looks?.[def.id]) : '';
      const inner = `<span class="fname">${m ? (def ? esc(def.name) : 'Random') : 'Waiting…'}</span><span class="ftitle">${dress ? `<em class="dress">${esc(dress)}</em> · ` : ''}${def ? `${esc(def.title)} · ${esc(moveSummary(def))}` : m ? 'Any of the eight' : 'A CPU takes this seat if nobody joins'}</span>`;
      rows.push(`<div class="slot" style="--fc:${def ? hex(def.eyes) : '#888'}"><span class="slot-n">${i + 1}</span><div class="who">${who}</div>
        ${mine ? `<button class="nav opt fighter" data-opt="net-fighter" data-cs="net">${inner}</button>` : `<div class="fighter">${inner}</div>`}</div>`);
    }
    // the countdown re-renders every second: only touch the seats when they changed, so clicks on them land
    const slotsEl = el.querySelector('.net-slots'), slotsHtml = rows.join('');
    if (slotsEl.dataset.html !== slotsHtml) { slotsEl.innerHTML = slotsHtml; slotsEl.dataset.html = slotsHtml; }
    slotsEl.classList.remove('teamed');
    el.querySelector('.net-note').textContent = `${L.members.length} in the queue. Up to ${MAX_PLAYERS} fight; CPUs fill a battle up to 4.`;
    const focusKey = keepFocus && el.contains(document.activeElement) ? `${document.activeElement.dataset.opt || ''}|${document.activeElement.dataset.act || ''}` : null;
    const actions = el.querySelector('.net-actions');
    if (actions.dataset.mode !== 'queue') {
      actions.dataset.mode = 'queue';
      actions.innerHTML = '<button class="nav big primary" data-act="net-invite">Copy invite link</button><button class="nav big" data-act="net-invite-fb">Invite on Facebook</button><button class="nav big" data-act="to-controls">Controls</button><button class="nav big" data-act="net-leave">Leave queue</button>';
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
      if (el.dataset.mode !== 'queue') {
        el.dataset.mode = 'queue';
        el.innerHTML = '<button class="nav big primary" data-act="net-requeue">Queue again</button><button class="nav big" data-act="net-leave-title">Title screen</button>';
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
      ? '<button class="nav big primary" data-act="net-rematch">Rematch</button><button class="nav big" data-act="net-lobby">Back to the room</button><button class="nav big" data-act="net-leave">Close room</button>'
      : '<span class="waiting">The host picks a rematch or heads back to the room.</span><button class="nav big" data-act="net-leave">Leave room</button>';
    if (this.menus.active === 'results') el.querySelector('.nav')?.focus({ preventScroll: true });
  }
}
