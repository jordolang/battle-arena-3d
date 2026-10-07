// The Friends screen: add friends by fighter name, answer requests, see who is online and in
// which private room, join them, or invite them into yours. Plus the corner card that pops up
// when a friend invites you. Keyboard first like every other screen.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function seen(iso) {
  if (!iso) return 'Not seen yet';
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 60) return `Seen ${Math.max(1, Math.round(mins))} min ago`;
  if (mins < 60 * 24) return `Seen ${Math.round(mins / 60)} h ago`;
  return `Seen ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export class FriendsMenus {
  constructor({ menus, friends, account, online, session, game }) {
    this.menus = menus;
    this.friends = friends;
    this.account = account;
    this.online = online;
    this.session = session;
    this.game = game;
    this.screen = menus.screens.friends;
    this.body = this.screen.querySelector('.fr-body');
    this.input = this.screen.querySelector('#fr-handle');
    this.msgEl = this.screen.querySelector('.fr-msg');
    this.back = 'title';
    this.confirm = null; // the friend whose Remove was pressed once
    this.invited = new Set();
    this.toast = document.createElement('div');
    this.toast.id = 'fr-invite-toast';
    this.toast.hidden = true;
    document.body.appendChild(this.toast);
    this.toast.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !this.toastInvite) return;
      const inv = this.toastInvite;
      this.hideToast();
      if (b.dataset.t === 'join') this.join(inv.room, inv);
      else friends.dismiss(inv);
    });
    friends.onChange(() => this.refresh());
    friends.onInvite = (inv) => this.showToast(inv);
  }

  refresh() {
    const n = this.friends.online, r = this.friends.requests + this.friends.invites.length;
    for (const el of document.querySelectorAll('.fr-count')) el.textContent = r ? `(${r} new)` : n ? `(${n} online)` : '';
    if (this.menus.active === 'friends') this.render(true);
  }

  setMsg(text, bad = false) { this.msgEl.textContent = text; this.msgEl.classList.toggle('bad', bad); }

  onShow(name) {
    if (name !== 'friends') return;
    this.setMsg('');
    this.confirm = null;
    this.render(false);
    this.friends.poll();
  }

  onAct(act, el) {
    switch (act) {
      case 'to-friends':
        if (!this.menus.requireAccount()) return true;
        this.back = this.menus.active || 'title';
        this.menus.show('friends');
        return true;
      case 'fr-back': this.menus.show(this.back === 'friends' ? 'title' : this.back); return true;
      case 'fr-add': this.add(); return true;
      case 'fr-host': this.host(); return true;
      case 'fr-accept': this.run(() => this.friends.add(el.dataset.h), `You and ${el.dataset.h} are friends now.`); return true;
      case 'fr-decline': this.run(() => this.friends.remove(el.dataset.h), ''); return true;
      case 'fr-remove':
        if (this.confirm !== el.dataset.h) { this.confirm = el.dataset.h; this.render(true); this.setMsg(`Press Remove again to unfriend ${el.dataset.h}.`); return true; }
        this.confirm = null;
        this.run(() => this.friends.remove(el.dataset.h), `${el.dataset.h} is no longer on your list.`);
        return true;
      case 'fr-invite': this.invite(el.dataset.h); return true;
      case 'fr-join': this.join(el.dataset.room); return true;
      case 'fr-dismiss': {
        const inv = this.friends.invites.find((i) => i.from === el.dataset.h);
        if (inv) this.friends.dismiss(inv);
        return true;
      }
    }
    return false;
  }

  async run(fn, ok) {
    this.setMsg('Working…');
    try { await fn(); this.setMsg(ok); } catch (err) { this.setMsg(err.message, true); }
  }

  add() {
    const h = this.input.value.trim();
    if (!h) { this.setMsg('Type your friend\'s fighter name, exactly as it shows on the leaderboards.', true); this.input.focus(); return; }
    this.run(async () => {
      await this.friends.add(h);
      this.input.value = '';
      const mutual = this.friends.view?.friends.some((f) => f.handle.toLowerCase() === h.toLowerCase());
      this.setMsg(mutual ? `You and ${h} are friends now.` : `Request sent. ${h} sees it next time they open the game.`);
    }, '');
  }

  async invite(handle) {
    this.setMsg(`Inviting ${handle}…`);
    try {
      await this.friends.invite(handle);
      this.invited.add(`${handle}|${this.friends.room}`);
      this.setMsg(`${handle} is invited to room ${this.friends.room}. The invite lasts 10 minutes.`);
      this.render(true);
    } catch (err) { this.setMsg(err.message, true); }
  }

  // Open a private room from here; the lobby's Invite friends button brings you back.
  async host() {
    if (this.session.connected && this.session.kind === 'room') { this.menus.show('lobby'); return; }
    if (!this.menus.requireGroup()) return;
    this.menus.show('online');
    await this.online.onAct('net-host');
  }

  // Into a friend's room, through the usual join (which checks the fundraiser code first).
  async join(room, inv = null) {
    if (!room) return;
    if (inv) this.friends.dismiss(inv);
    if (this.session.connected && this.session.lobby?.code === room) { this.menus.show('lobby'); return; }
    // leave whatever is going on here first: a fight against the CPU, the practice room, a replay
    if (this.game.mode === 'match' && !this.game.online) this.menus.cb.onQuit();
    if (!this.account.ready || !this.menus.requireGroup()) return;
    document.getElementById('net-code').value = room;
    this.menus.show('online');
    await this.online.onAct('net-join');
  }

  showToast(inv) {
    // not while you are mid-fight online or already in that room; the friends screen lists it anyway
    if (this.game.online && this.game.mode === 'match') return;
    this.toastInvite = inv;
    this.toast.innerHTML = `<span><b>${esc(inv.from)}</b> invited you to their private room.</span><button type="button" class="go" data-t="join">Join</button><button type="button" data-t="no">Not now</button>`;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(), 20000);
  }

  hideToast() { this.toast.hidden = true; this.toastInvite = null; }

  render(keepFocus) {
    const f = this.friends;
    const focused = document.activeElement;
    const focusKey = keepFocus && this.body.contains(focused) ? `${focused.dataset.act}|${focused.dataset.h || ''}` : null;
    const room = f.room;
    this.screen.querySelector('.fr-room').innerHTML = room
      ? `You are in private room <b>${esc(room)}</b>. Invite friends who are online; they get a pop-up to join.`
      : 'Host a private room to invite friends, or join one a friend is in.';
    this.screen.querySelector('[data-act=fr-host]').textContent = room ? 'Back to my room' : 'Host a private room';
    if (f.status === 'off') { this.body.innerHTML = '<p class="fr-empty">Sign in to see your friends.</p>'; return; }
    if (!f.view) {
      this.body.innerHTML = `<p class="fr-empty">${f.status === 'error' ? esc(`Could not load your friends: ${f.error}`) : 'Loading your friends…'}</p>`;
      return;
    }
    const v = f.view;
    const btn = (act, label, h, extra = '') => `<button class="nav" data-act="${act}" data-h="${esc(h)}"${extra}>${label}</button>`;
    const parts = [];
    const invites = f.invites;
    if (invites.length) {
      parts.push(`<div class="col-h">Room invites</div><div class="fr-list">${invites.map((i) => `<div class="fr-row"><span class="fr-dot room"></span>
        <div class="fr-who"><b>${esc(i.from)}</b><small>Invited you to room ${esc(i.room)}</small></div>
        ${btn('fr-join', 'Join', i.from, ` data-room="${esc(i.room)}"`)}${btn('fr-dismiss', 'Not now', i.from)}</div>`).join('')}</div>`);
    }
    if (v.incoming.length) {
      parts.push(`<div class="col-h">Friend requests</div><div class="fr-list">${v.incoming.map((r) => `<div class="fr-row"><span class="fr-dot"></span>
        <div class="fr-who"><b>${esc(r.handle)}</b><small>Wants to be friends</small></div>${btn('fr-accept', 'Accept', r.handle)}${btn('fr-decline', 'Decline', r.handle)}</div>`).join('')}</div>`);
    }
    parts.push(`<div class="col-h">Friends ${v.friends.length ? `· ${f.online} online` : ''}</div>`);
    if (!v.friends.length) parts.push('<p class="fr-empty">No friends yet. Add someone by the fighter name they use on the leaderboards; once they accept, you can see when they are online and play in private rooms together.</p>');
    else {
      parts.push(`<div class="fr-list">${v.friends.map((fr) => {
        const here = fr.room && fr.room === room;
        const status = !fr.online ? seen(fr.lastSeenAt) : here ? 'In your room' : fr.room ? `In private room ${fr.room}` : 'Online';
        const actions = [];
        if (fr.room && !here) actions.push(btn('fr-join', 'Join', fr.handle, ` data-room="${esc(fr.room)}"`));
        if (room && !here) actions.push(btn('fr-invite', this.invited.has(`${fr.handle}|${room}`) ? 'Invite again' : 'Invite', fr.handle));
        actions.push(btn('fr-remove', this.confirm === fr.handle ? 'Remove?' : 'Remove', fr.handle));
        const team = fr.team ? `<small style="color:${/^#[0-9a-f]{3,8}$/i.test(fr.team.color || '') ? fr.team.color : 'inherit'}"> · ${esc(fr.team.name)}</small>` : '';
        return `<div class="fr-row"><span class="fr-dot${fr.room ? ' room' : fr.online ? ' on' : ''}"></span>
          <div class="fr-who"><b>${esc(fr.handle)}</b><small>${esc(status)}</small>${team}</div>${actions.join('')}</div>`;
      }).join('')}</div>`);
    }
    if (v.outgoing.length) {
      parts.push(`<div class="col-h">Waiting for an answer</div><div class="fr-list">${v.outgoing.map((r) => `<div class="fr-row"><span class="fr-dot"></span>
        <div class="fr-who"><b>${esc(r.handle)}</b><small>Request sent</small></div>${btn('fr-decline', 'Cancel', r.handle)}</div>`).join('')}</div>`);
    }
    this.body.innerHTML = parts.join('');
    if (focusKey) [...this.body.querySelectorAll('.nav')].find((x) => `${x.dataset.act}|${x.dataset.h || ''}` === focusKey)?.focus({ preventScroll: true });
  }
}
