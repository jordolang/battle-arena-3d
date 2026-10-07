// Friends: the players you added on the José Madrid Salsa site, who of them is online, and
// invites into private rooms. The game has no server of its own, so while it is open it checks
// in with the website about every 30 seconds (and at once when you enter or leave a private
// room); each check-in says which room you are in and brings back the whole friends list.
const POLL_MS = 30000;

export class Friends {
  constructor({ account, session }) {
    this.account = account;
    this.session = session;
    this.view = null;        // { friends, incoming, outgoing, invites } from the website
    this.status = 'off';     // 'off' (signed out) | 'loading' | 'ready' | 'error'
    this.error = '';
    this.listeners = new Set();
    this.onInvite = () => {}; // (invite): a new invite into a friend's room
    this.seenInvites = new Set();
    this.dismissed = new Set();
    this.lastRoom = null;
    this.busy = null;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this); } catch (err) { console.error('[friends]', err); } } }

  // the private room you are in right now (queues and tournaments are not for friends to drop into)
  get room() { const s = this.session; return s.connected && s.kind === 'room' ? s.lobby?.code || null : null; }
  get online() { return (this.view?.friends || []).filter((f) => f.online).length; }
  get requests() { return this.view?.incoming?.length || 0; }
  get invites() { return (this.view?.invites || []).filter((i) => !this.dismissed.has(key(i))); }

  start() {
    this.account.onChange(() => { if (!this.account.recording) this.reset(); else if (this.status === 'off') this.poll(); });
    setInterval(() => this.poll(), POLL_MS);
    // entering or leaving a private room tells friends straight away
    setInterval(() => { if (this.room !== this.lastRoom) this.poll(); }, 1500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poll(); });
    this.poll();
  }

  reset() {
    this.view = null;
    this.status = 'off';
    this.lastRoom = null;
    this.emit();
  }

  async poll() {
    if (!this.account.recording) { if (this.status !== 'off') this.reset(); return; }
    if (document.hidden && this.status !== 'off') return;
    if (this.busy) return this.busy;
    const room = this.room;
    this.lastRoom = room;
    if (!this.view) { this.status = 'loading'; this.emit(); }
    this.busy = this.account.checkIn(room)
      .then((v) => this.take(v))
      .catch((err) => { this.status = this.view ? 'ready' : 'error'; this.error = err.message; this.emit(); })
      .finally(() => { this.busy = null; });
    return this.busy;
  }

  take(view) {
    if (!view || !Array.isArray(view.friends)) return;
    this.view = view;
    this.status = 'ready';
    this.error = '';
    for (const inv of view.invites || []) {
      const k = key(inv);
      if (this.seenInvites.has(k)) continue;
      this.seenInvites.add(k);
      if (inv.room !== this.room) this.onInvite(inv);
    }
    this.emit();
  }

  // Each of these answers with the new list, or throws an AccountError whose message the player can read.
  async add(handle) { this.take(await this.account.addFriend(handle)); }
  async remove(handle) { this.take(await this.account.removeFriend(handle)); }
  async invite(handle) {
    const room = this.room;
    if (!room) throw new Error('Open a private room first, then invite your friends into it.');
    return this.account.inviteFriend(handle, room);
  }
  dismiss(inv) { this.dismissed.add(key(inv)); this.emit(); }
}

const key = (inv) => `${inv.from}|${inv.room}|${inv.sentAt}`;
