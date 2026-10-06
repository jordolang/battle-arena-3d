// Live chat for tournament rooms: docked beside the bracket in the lobby, a corner overlay during
// matches. T opens it, Enter sends, Esc closes. Typing here never reaches the fighters (see input.js).
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BADGE = { admin: 'Admin', spectator: 'Fan' };

export class ChatPanel {
  constructor({ session, keyboard }) {
    this.session = session;
    this.keyboard = keyboard;
    this.el = document.getElementById('chat');
    this.log = this.el.querySelector('.chat-log');
    this.input = this.el.querySelector('.chat-input');
    this.home = this.el.parentElement;
    this.visible = false;
    session.onChat = (m) => (m ? this.add(m) : this.renderAll());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) session.sendChat(text);
        this.input.value = '';
        if (this.overlay) this.input.blur();
      } else if (e.key === 'Escape') this.input.blur();
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    this.input.addEventListener('focus', () => { keyboard.held.clear(); this.el.classList.add('typing'); });
    this.input.addEventListener('blur', () => this.el.classList.remove('typing'));
    keyboard.onKey((e) => {
      if (!this.visible || e.code !== 'KeyT' || e.repeat) return false;
      if (document.activeElement?.tagName === 'INPUT') return false;
      this.open();
      return true;
    });
  }

  open() { this.input.focus({ preventScroll: true }); }

  // `slot`: an element to dock into (the lobby), or null for the in-match overlay.
  show(on, slot = null) {
    this.visible = on;
    this.el.hidden = !on;
    if (!on) { this.input.blur(); return; }
    this.overlay = !slot;
    this.el.classList.toggle('overlay', this.overlay);
    const parent = slot || this.home;
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
    this.log.scrollTop = this.log.scrollHeight;
  }

  renderAll() {
    this.log.innerHTML = '';
    for (const m of this.session.chat) this.add(m, false);
    this.log.scrollTop = this.log.scrollHeight;
  }

  add(m, scroll = true) {
    const row = document.createElement('div');
    row.className = 'chat-row ' + (m.r || '');
    if (m.r === 'system') row.innerHTML = `<i>${esc(m.x)}</i>`;
    else {
      const badge = BADGE[m.r] ? `<em class="badge ${m.r}">${BADGE[m.r]}</em>` : m.g ? `<em class="badge">${esc(m.g)}</em>` : '';
      row.innerHTML = `${badge}<b style="color:${/^#[0-9a-f]{6}$/i.test(m.c || '') ? m.c : '#ddd'}">${esc(m.n)}</b> ${esc(m.x)}`;
    }
    const stick = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    this.log.appendChild(row);
    while (this.log.children.length > 80) this.log.firstChild.remove();
    if (scroll && stick) this.log.scrollTop = this.log.scrollHeight;
    // during a match new lines flash the overlay so viewers notice them
    if (this.overlay && scroll) { this.el.classList.remove('ping'); void this.el.offsetWidth; this.el.classList.add('ping'); }
  }
}
