// José Madrid Salsa accounts: every player signs in before they can fight, and the game reports
// each match to the website, which keeps their profile and the leaderboards.
//
// Sign-in: the game sends the browser to the website's /battle-arena/connect page with a
// random `state`; once signed in there the website sends it back here with a token in the URL
// fragment. The token is kept in this browser and sent as a bearer token on every API call.
//   ?account-api=URL  points the game at another copy of the website (testing)
//   ?guest            on a local copy (localhost or a file) plays without an account
const TOKEN_KEY = 'battle-arena.account.v1';
const STATE_KEY = 'battle-arena.account-state.v1';
const PROFILE_KEY = 'battle-arena.account-profile.v1';
const DEFAULT_API = 'https://www.josemadrid.net';
const MODE = { cpu: 'CPU', queue: 'ONLINE', room: 'ONLINE', tournament: 'TOURNAMENT' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function randomState() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class AccountError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}

export class Account {
  constructor(params = new URLSearchParams(location.search)) {
    this.api = (params.get('account-api') || DEFAULT_API).replace(/\/+$/, '');
    this.local = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    this.token = store.get(TOKEN_KEY);
    // status: 'signed-out' | 'checking' | 'signed-in' | 'offline' (signed in, website unreachable) | 'guest'
    this.status = this.token ? 'checking' : 'signed-out';
    this.profile = null;
    try { this.profile = this.token ? JSON.parse(store.get(PROFILE_KEY) || 'null') : null; } catch { /* ignore */ }
    this.listeners = new Set();
    this.error = '';
    this.takeTokenFromUrl();
    if (this.local && (params.has('guest') || params.has('autotest'))) this.status = 'guest';
  }

  // signed in (or a guest on a local copy): the menus let them fight. A saved sign-in counts while it
  // is being checked; if the website says it has ended, the player is sent back to sign in.
  get ready() { return ['signed-in', 'offline', 'guest'].includes(this.status) || (this.status === 'checking' && !!this.token); }
  get recording() { return !!this.token && ['signed-in', 'offline', 'checking'].includes(this.status); }
  get handle() { return this.profile?.player?.handle || ''; }
  get team() { return this.profile?.player?.team || null; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this); } catch (err) { console.error('[account]', err); } } }

  // the website sends players back with #arena_token=…&state=…; take it and tidy the address bar
  takeTokenFromUrl() {
    if (!location.hash.includes('arena_token=')) return;
    const h = new URLSearchParams(location.hash.slice(1));
    const token = h.get('arena_token'), state = h.get('state');
    const expected = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    history.replaceState(null, '', location.pathname + location.search);
    if (!token || !state || state !== expected) { this.error = 'That sign-in did not come from this game. Press Sign in to try again.'; return; }
    this.setToken(token);
    this.status = 'checking';
  }

  setToken(token) {
    this.token = token;
    store.set(TOKEN_KEY, token);
    if (!token) { this.profile = null; store.set(PROFILE_KEY, null); }
  }

  // off to the website to sign in; it comes back to this exact page (invite and tournament links included)
  signIn() {
    const state = randomState();
    sessionStorage.setItem(STATE_KEY, state);
    const back = location.origin + location.pathname + location.search;
    location.assign(`${this.api}/battle-arena/connect?${new URLSearchParams({ return_to: back, state })}`);
  }

  playAsGuest() { if (this.local) { this.status = 'guest'; this.emit(); } }

  async signOut() {
    const token = this.token;
    this.setToken(null);
    this.status = 'signed-out';
    this.emit();
    if (token) fetch(`${this.api}/api/arena/auth/sign-out`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }

  async call(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (auth) {
      if (!this.token) throw new AccountError('Sign in first.', 401, 'signed_out');
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(this.api + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new AccountError('Could not reach josemadrid.net. Check your connection.', 0, 'network');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'signed_out' && auth) { this.setToken(null); this.status = 'signed-out'; this.error = data.error || ''; this.emit(); }
      throw new AccountError(data.error || `The website answered ${res.status}.`, res.status, data.code || '');
    }
    return data;
  }

  // loads the signed-in player's profile; a website outage keeps them playing on the saved copy
  async refresh() {
    if (!this.token || this.status === 'guest') return this.profile;
    try {
      this.setProfile(await this.call('/api/arena/me'));
      this.status = 'signed-in';
      this.error = '';
    } catch (err) {
      if (err.code === 'network') this.status = this.profile ? 'offline' : 'signed-out';
      if (err.code === 'network' && !this.profile) this.error = err.message;
    }
    this.emit();
    return this.profile;
  }

  setProfile(p) { this.profile = p; store.set(PROFILE_KEY, JSON.stringify(p)); }

  async update(changes) {
    this.setProfile(await this.call('/api/arena/me', { method: 'PATCH', body: changes }));
    this.emit();
    return this.profile;
  }

  teams() { return this.call('/api/arena/teams', { auth: false }).then((d) => d.teams || []); }
  leaderboard(q) { return this.call(`/api/arena/leaderboard?${new URLSearchParams(q)}`, { auth: false }); }
  player(handle) { return this.call(`/api/arena/players/${encodeURIComponent(handle)}`, { auth: false }); }

  // Reports matches to the website, which keeps the leaderboards.
  //  - Against the CPU this browser reports its own fighter's result (the website keeps those on the
  //    profile but leaves them off the online boards).
  //  - Online, only the host reports. When the first round starts the host opens the match on the
  //    website, which hands back one secret ticket per player seat. The host sends each guest its
  //    own ticket and the guest claims that seat with its own sign-in, so the website knows which
  //    accounts really played. When the match ends the host reports every seat's result in one go;
  //    the website records it for the accounts that claimed a seat and refuses any other report.
  // Watching, demos, training and guests record nothing.
  track({ events, game, session, onResult }) {
    let cur = null;
    events.on('roundStart', (d) => {
      if (game.mode !== 'match' || game.setup?.mode === 'practice' || game.online === 'client') return;
      if (d.round === 1 || !cur) cur = game.online === 'host' ? this.openHostedMatch(game, session) : this.openMatch(game, session);
      if (cur) cur.rounds = Math.max(cur.rounds + 1, d.round || 0);
    });
    events.on('matchEnd', ({ winner }) => {
      if (game.online === 'client') { // the host reports for guests; its word may beat the knockout here
        const early = this.hostedResult; this.hostedResult = null;
        if (early) setTimeout(() => onResult?.(early), 0);
        return;
      }
      const m = cur; cur = null;
      if (!m || game.mode !== 'match') return;
      if (m.hosted) { this.reportHostedMatch(m, game, session, winner, onResult); return; }
      const result = seatResult(m.fighter, winner, m.rounds);
      m.id.then((id) => (id ? this.call(`/api/arena/matches/${encodeURIComponent(id)}`, { method: 'POST', body: result }) : null))
        .then((r) => {
          if (!r) return;
          onResult?.({ ...result, ...r });
          this.refresh();
        })
        .catch((err) => onResult?.({ ...result, recorded: false, reason: err.message }));
    });
    // a guest hears about the match from the host: first its seat ticket, then the recorded results
    session.onAccount = (msg) => this.guestMessage(msg, game, onResult);
  }

  openMatch(game, session) {
    if (!this.recording) return null;
    const me = game.fighters.find((f) => f.isHuman && f.controller.playerIndex === 0);
    if (!me) return null;
    const body = { mode: 'CPU', fighter: me.def.id, opponents: Math.max(1, Math.min(7, game.fighters.length - 1)) };
    const id = this.call('/api/arena/matches', { method: 'POST', body }).then((r) => r.matchId).catch((err) => { console.warn('[account] match not recorded:', err.message); return null; });
    return { id, fighter: me, rounds: 0 };
  }

  // Host: opens the match on the website and sends every guest its seat ticket.
  openHostedMatch(game, session) {
    if (!this.recording || !session?.spec) return null;
    const owners = session.spec.fighters.map((f) => f.owner || null);
    const seats = owners.flatMap((o, i) => (o ? [i] : []));
    const hostSeat = owners.indexOf('host');
    const body = {
      mode: MODE[session.kind] || 'ONLINE',
      room: roomCode(session),
      fighters: game.fighters.length,
      seats,
      hostSeat,
      fighter: hostSeat >= 0 ? game.fighters[hostSeat].def.id : null,
      seatFighters: seats.map((i) => game.fighters[i].def.id),
    };
    const m = { hosted: true, rounds: 0, owners, matchId: null };
    m.id = this.call('/api/arena/hosted-matches', { method: 'POST', body })
      .then((r) => {
        m.matchId = r.matchId;
        for (const [seat, ticket] of Object.entries(r.tickets || {})) {
          const owner = owners[+seat];
          if (owner && owner !== 'host') session.sendTo(owner, { t: 'acct', a: 'seat', id: r.matchId, seat: +seat, ticket });
        }
        return r.matchId;
      })
      .catch((err) => { console.warn('[account] match not recorded:', err.message); return null; });
    return m;
  }

  // Host: reports every player seat's result and passes the outcome on to each guest.
  reportHostedMatch(m, game, session, winner, onResult) {
    const results = m.owners.flatMap((o, seat) => (o ? [{ seat, fighter: game.fighters[seat].def.id, ...seatResult(game.fighters[seat], winner, m.rounds) }] : []));
    const winnerSeat = winner ? game.fighters.indexOf(winner) : -1;
    const body = { rounds: Math.max(1, m.rounds), winnerSeat, winnerTeam: winner && winner.team >= 0 ? winner.team : null, results };
    const tell = (seat, r) => {
      const owner = m.owners[seat];
      if (owner === 'host') onResult?.(r);
      else if (owner) session.sendTo(owner, { t: 'acct', a: 'result', id: m.matchId, r });
    };
    m.id.then((id) => {
      if (!id) throw new AccountError('The website did not open this match.');
      return this.call(`/api/arena/hosted-matches/${encodeURIComponent(id)}/report`, { method: 'POST', body });
    }).then((r) => {
      const recorded = new Map((r.recorded || []).map((x) => [x.seat, x]));
      for (const res of results) {
        const x = recorded.get(res.seat);
        tell(res.seat, x ? { ...res, ...x, recorded: true } : { ...res, recorded: false, reason: x === undefined ? 'That player was not signed in when the match started.' : '' });
      }
      this.refresh();
    }).catch((err) => {
      for (const res of results) tell(res.seat, { ...res, recorded: false, reason: err.message });
    });
  }

  // Guest: claims its seat with its own sign-in, then shows what the host's report recorded.
  guestMessage(msg, game, onResult) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.a === 'seat' && typeof msg.id === 'string' && typeof msg.ticket === 'string') {
      this.hostedResult = null;
      if (!this.recording) { this.hosted = null; return; }
      this.hosted = { id: msg.id, seat: msg.seat };
      this.call(`/api/arena/hosted-matches/${encodeURIComponent(msg.id)}/join`, { method: 'POST', body: { ticket: msg.ticket, fighter: game.localFighter?.def.id || null } })
        .catch((err) => { if (this.hosted?.id === msg.id) this.hosted.error = err.message; });
    } else if (msg.a === 'result' && msg.r && typeof msg.r === 'object' && this.hosted?.id === msg.id) {
      const r = msg.r, error = this.hosted.error;
      this.hosted = null;
      const shown = {
        won: !!r.won, knockouts: Math.max(0, Math.floor(+r.knockouts || 0)), streak: Math.max(0, Math.floor(+r.streak || 0)),
        recorded: !!r.recorded && !error, reason: String(error || r.reason || '').slice(0, 120),
      };
      // ranked: the website may add the player's new rating
      for (const k of ['rating', 'ratingDelta']) if (Number.isFinite(r[k])) shown[k] = Math.round(r[k]);
      if (game.phase === 'matchOver') onResult?.(shown); else this.hostedResult = shown;
      if (shown.recorded) this.refresh();
    }
  }
}

// One fighter's result, for the website.
function seatResult(f, winner, rounds) {
  return {
    won: !!winner && (winner === f || (f.team >= 0 && winner.team === f.team)),
    roundsWon: Math.min(5, f.stats.wins),
    rounds: Math.max(1, rounds, f.stats.wins),
    knockouts: f.stats.kos,
    damage: Math.round(f.stats.damage),
  };
}

function roomCode(session) {
  return String(session?.lobby?.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24) || undefined;
}
