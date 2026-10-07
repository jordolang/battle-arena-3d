// Emotes, taunts and quick chat. F taunts (a "come on then" that pays back a little special
// energy if nobody punishes it); C opens a small menu whose pages are flicked with C again and
// whose four entries are picked with 1-4 (or the D-pad, or a tap): a page of emotes, then two
// pages of quick-chat lines that pop up in a bubble over your fighter for everyone to see.
// Quick chat is a fixed list on purpose: nothing typed by a stranger ever reaches another player.
export const EMOTES = {
  taunt: { label: 'Taunt', time: 1.15, say: 'Come on!' },
  wave: { label: 'Wave', time: 1.6 },
  flex: { label: 'Flex', time: 1.8 },
  salsa: { label: 'Salsa', time: 2.8 },
  laugh: { label: 'Laugh', time: 1.6 },
  bow: { label: 'Bow', time: 2.2 },
};
export const EMOTE_IDS = Object.keys(EMOTES);
// what a finished taunt pays, and how often
export const TAUNT_ENERGY = 12;
export const TAUNT_COOLDOWN = 6;
// a moment into an emote, moving or fighting ends it
export const EMOTE_LOCK = 0.2;

export const QUICK_CHAT = [
  'Good luck!', 'Nice one!', 'Watch out!', 'Help me!',
  'Team up on them!', 'Come get some!', 'So close!', 'GG!',
];

export const COMMS_PAGES = [
  { title: 'Emotes', items: ['wave', 'flex', 'salsa', 'laugh'].map((id) => ({ emote: id, label: EMOTES[id].label })) },
  { title: 'Quick chat', items: [0, 1, 2, 3].map((i) => ({ chat: i, label: QUICK_CHAT[i] })) },
  { title: 'Quick chat', items: [4, 5, 6, 7].map((i) => ({ chat: i, label: QUICK_CHAT[i] })) },
];

const SAY_MS = 2600;
const CHAT_GAP = 1200; // ms between one player's quick-chat lines
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const cleanChat = (i) => (Number.isInteger(i) && i >= 0 && i < QUICK_CHAT.length ? i : -1);
export const cleanEmote = (id) => (EMOTES[id] ? id : null);

// The menu itself. One per page: on a keyboard it belongs to P1, online to your own fighter.
// Seats (local players 0-3) each have their own page; only one menu is drawn at a time.
export class Comms {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'comms';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.seat = -1;   // whose menu is open
    this.page = 0;
    this.closeAt = 0;
    this.pendingEmote = [null, null, null, null];
    this.onChat = () => {};   // (seat, index): the page decides who hears it (main.js)
    this.keyFor = () => '';  // (seat, action) -> key label for the hints
    this.enabled = () => true;
    this.el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) { e.preventDefault(); e.stopPropagation(); this.pick(this.seat, +b.dataset.pick); }
    });
  }

  isOpen(seat) { return this.seat === seat && seat >= 0; }

  // The comms key: open on the first page, then the next one, then close.
  toggle(seat) {
    if (!this.enabled()) return;
    if (this.seat !== seat) { this.seat = seat; this.page = 0; } else if (++this.page >= COMMS_PAGES.length) { this.close(); return; }
    this.closeAt = performance.now() + 5000;
    this.render();
  }

  close() { this.seat = -1; this.el.hidden = true; }

  pick(seat, i) {
    if (!this.isOpen(seat)) return;
    const item = COMMS_PAGES[this.page]?.items[i];
    this.close();
    if (!item) return;
    if (item.emote) this.pendingEmote[seat] = item.emote;
    else this.onChat(seat, item.chat);
  }

  // The emote a seat picked, once.
  takeEmote(seat) {
    const e = this.pendingEmote[seat];
    if (e) this.pendingEmote[seat] = null;
    return e;
  }

  tick() {
    if (this.seat >= 0 && (performance.now() > this.closeAt || !this.enabled())) this.close();
  }

  render() {
    const p = COMMS_PAGES[this.page];
    const keys = ['slot1', 'slot2', 'slot3', 'slot4'].map((a) => this.keyFor(this.seat, a));
    const next = this.keyFor(this.seat, 'comms');
    this.el.innerHTML = `<div class="cm-head"><b>${esc(p.title)}</b><span>${this.page + 1}/${COMMS_PAGES.length}${next ? ` · <kbd>${esc(next)}</kbd> ${this.page + 1 < COMMS_PAGES.length ? 'more' : 'close'}` : ''}</span></div>
      <div class="cm-items">${p.items.map((it, i) => `<button type="button" class="cm-item${it.emote ? ' emote' : ''}" data-pick="${i}">${keys[i] ? `<kbd>${esc(keys[i])}</kbd>` : ''}${esc(it.label)}</button>`).join('')}</div>`;
    this.el.hidden = false;
  }
}

// Who may say something right now: one quick-chat line per player every CHAT_GAP.
export class ChatGate {
  constructor() { this.at = new Map(); }
  allow(key, now = performance.now()) {
    if (now - (this.at.get(key) || -Infinity) < CHAT_GAP) return false;
    this.at.set(key, now);
    return true;
  }
}

export { SAY_MS };
