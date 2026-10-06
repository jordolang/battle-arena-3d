// In-fight overlay: fighter cards, floating name tags, announcer, KO feed.
import * as THREE from 'three';
import { ENERGY_MAX, SPECIAL_COST, PLAYER_COLORS, SPECIALS, SKILLS, STAMINA_MAX, COMBAT, keyLabel } from './config.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Hud {
  constructor(root) {
    this.root = root;
    this.cardsEl = root.querySelector('#roster');
    this.tagsEl = root.querySelector('#tags');
    this.timerEl = root.querySelector('#timer');
    this.announceEl = root.querySelector('#announce');
    this.feedEl = root.querySelector('#feed');
    this.hintEl = root.querySelector('#hint');
    this.teamsEl = document.createElement('div');
    this.teamsEl.id = 'teams';
    root.querySelector('#topbar').prepend(this.teamsEl);
    this.items = [];
    this.v = new THREE.Vector3();
    this.announceTimer = null;
  }

  show(on) { this.root.hidden = !on; }

  // `teams` is null for free-for-all, else [{ name, color }]. `keyFor(fighter, action)` gives a player's key code.
  build(fighters, winsNeeded, teams = null, keyFor = null) {
    this.cardsEl.innerHTML = '';
    this.teams = teams;
    this.teamsEl.hidden = !teams;
    this.teamsEl.innerHTML = teams ? teams.map((t, i) => `<div class="team-score" style="--tc:${hex(t.color)}" data-t="${i}">
      <span class="team-name">${esc(t.name)}</span><span class="pips">${Array.from({ length: winsNeeded }, () => '<i></i>').join('')}</span></div>`).join('') : '';
    this.teamPips = teams ? [...this.teamsEl.querySelectorAll('.team-score')].map((el) => ({ el, pips: [...el.querySelectorAll('i')], last: -1 })) : [];
    this.cardsEl.classList.toggle('few', fighters.length <= 4);
    this.tagsEl.innerHTML = '';
    this.feedEl.innerHTML = '';
    this.items = fighters.map((f) => {
      const color = hex(f.def.eyes);
      const who = f.label;
      const whoColor = f.labelColor;
      const card = document.createElement('div');
      card.className = 'card' + (f.team >= 0 && teams ? ' teamed' : '') + (f.isPlayer || f.isYou ? ' player' : '');
      card.style.setProperty('--fc', color);
      if (f.teamColor != null) card.style.setProperty('--tc', hex(f.teamColor));
      const chipFor = (action, label) => {
        const key = f.isPlayer && keyFor ? keyLabel(keyFor(f, action)) : '';
        return `<span class="chip" title="${esc(label)}"><b>${esc(key)}</b>${esc(label.split(' ')[0])}<i class="cd"></i></span>`;
      };
      const chips = f.isPlayer || f.isYou
        ? `<div class="chips">${f.skillIds.map((id, i) => chipFor('skill' + (i + 1), SKILLS[id].label)).join('')}${chipFor('special', SPECIALS[f.def.special].label)}</div>`
        : '';
      card.innerHTML = `
        <div class="card-top">
          <span class="who" ${whoColor ? `style="color:${whoColor}"` : ''}>${esc(who)}</span>
          <span class="nm">${esc(f.name)}</span>
          <span class="pips">${Array.from({ length: winsNeeded }, () => '<i></i>').join('')}</span>
        </div>
        <div class="bar hp"><div class="trail"></div><div class="fill"></div><div class="shield"></div></div>
        <div class="bar en"><div class="fill"></div><span class="notch"></span></div>
        <div class="bar st"><div class="fill"></div></div>${chips}`;
      this.cardsEl.appendChild(card);
      const tag = document.createElement('div');
      tag.className = 'tag' + (f.isPlayer ? ' human' : '') + (f.isYou ? ' you' : '');
      tag.style.setProperty('--fc', whoColor || color);
      if (f.teamColor != null) tag.style.setProperty('--tc', hex(f.teamColor));
      if (teams && f.team >= 0) tag.classList.add('teamed');
      tag.innerHTML = `<span>${f.isYou ? 'You' : f.isPlayer ? esc(who) : esc(f.name)}</span><div class="mini"><div></div></div>`;
      this.tagsEl.appendChild(tag);
      return {
        f, card, tag,
        hpFill: card.querySelector('.hp .fill'), hpTrail: card.querySelector('.hp .trail'),
        enFill: card.querySelector('.en .fill'), pips: [...card.querySelectorAll('.pips i')],
        stFill: card.querySelector('.st .fill'), shield: card.querySelector('.hp .shield'),
        chips: [...card.querySelectorAll('.chip')].map((el) => ({ el, cd: el.querySelector('.cd'), last: '' })),
        mini: tag.querySelector('.mini div'), label: tag.querySelector('span'), name: tag.querySelector('span').textContent, downed: false, trail: f.hp, lastHp: -1, lastEn: -1, lastSt: -1, lastSh: -1, lastWins: -1, lastAlive: true,
      };
    });
  }

  setHints(lines) {
    this.hintEl.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    this.hintEl.classList.toggle('on', lines.length > 0);
  }

  static controlHint(index, b) {
    const k = (a) => `<kbd>${esc(keyLabel(b[a]))}</kbd>`;
    return `<b style="color:${PLAYER_COLORS[index]}">P${index + 1}</b> ${k('up')}${k('left')}${k('down')}${k('right')} move · ${k('punch')} punch · ${k('kick')} kick · ${k('block')} block · ${k('jump')} jump · ${k('dash')} dodge, hold to sprint · ${k('skill1')}${k('skill2')}${k('skill3')} skills · ${k('special')} special`;
  }

  static onlineHint(b) {
    const k = (a) => `<kbd>${esc(keyLabel(b[0][a]))}</kbd>`;
    return `<b>You</b> ${k('up')}${k('left')}${k('down')}${k('right')} or arrows move · ${k('punch')} punch · ${k('kick')} kick · ${k('block')} block · ${k('jump')} jump · ${k('dash')} dodge, hold to sprint · ${k('skill1')}${k('skill2')}${k('skill3')} skills · ${k('special')} special`;
  }

  // "P1 Ember (Mage): = Meteor · - Flame Lance · 0 Ember Spray · I Hellfire Orb"
  static skillHint(f, b, who) {
    const k = (a) => `<kbd>${esc(keyLabel(b[a]))}</kbd>`;
    const color = f.labelColor ? ` style="color:${f.labelColor}"` : '';
    return `<b${color}>${esc(who)}</b> ${esc(f.def.name)}${f.def.role ? ` (${esc(f.def.role)})` : ''}: ${f.skillIds.map((id, i) => `${k('skill' + (i + 1))} ${esc(SKILLS[id].label)}`).join(' · ')} · ${k('special')} ${esc(SPECIALS[f.def.special].label)}`;
  }

  announce(text, cls = '', ms = 1400) {
    const el = this.announceEl;
    el.className = '';
    void el.offsetWidth; // restart the animation
    el.textContent = text;
    el.className = 'on ' + cls;
    clearTimeout(this.announceTimer);
    if (ms > 0) this.announceTimer = setTimeout(() => { el.className = ''; }, ms);
  }

  clearAnnounce() { this.announceEl.className = ''; clearTimeout(this.announceTimer); }

  feed(html) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = html;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild.remove();
    setTimeout(() => row.classList.add('out'), 4200);
    setTimeout(() => row.remove(), 5000);
  }

  setTimer(text, urgent) {
    this.timerEl.textContent = text;
    this.timerEl.classList.toggle('urgent', !!urgent);
  }

  update(dt, camera, width, height) {
    if (this.teams) {
      const alive = new Set(this.items.filter((it) => it.f.alive).map((it) => it.f.team));
      this.teamPips.forEach((tp, i) => tp.el.classList.toggle('out', !alive.has(i)));
    }
    for (const it of this.items) {
      const f = it.f;
      const hp = Math.max(0, f.hp / f.maxHp);
      // damage trail drains after a short delay, like the classic arcade bars
      if (f.hp < it.trail) it.trail = Math.max(f.hp, it.trail - f.maxHp * dt * (f.alive ? 0.45 : 1.2));
      else it.trail = f.hp;
      if (Math.abs(hp - it.lastHp) > 0.001) {
        it.hpFill.style.transform = `scaleX(${hp})`;
        it.mini.style.transform = `scaleX(${hp})`;
        it.card.classList.toggle('low', hp < 0.25 && hp > 0);
        it.lastHp = hp;
      }
      it.hpTrail.style.transform = `scaleX(${Math.max(0, it.trail / f.maxHp)})`;
      const en = f.energy / ENERGY_MAX;
      if (Math.abs(en - it.lastEn) > 0.004) {
        it.enFill.style.transform = `scaleX(${en})`;
        it.card.classList.toggle('ready', f.energy >= SPECIAL_COST);
        it.lastEn = en;
      }
      const st = f.stamina / STAMINA_MAX;
      if (Math.abs(st - it.lastSt) > 0.004 || it.card.classList.contains('tired') !== !!f.exhausted) {
        it.stFill.style.transform = `scaleX(${st})`;
        it.card.classList.toggle('tired', !!f.exhausted);
        it.lastSt = st;
      }
      const sh = Math.min(1, (f.shield || 0) / f.maxHp);
      if (sh !== it.lastSh) { it.shield.style.transform = `scaleX(${sh})`; it.lastSh = sh; }
      it.chips.forEach((c, i) => {
        // three skills, then the special
        let frac = 0, off = false;
        if (i < f.skillIds.length) {
          const sk = SKILLS[f.skillIds[i]];
          frac = sk ? Math.min(1, (f.cooldowns?.[i] || 0) / sk.cooldown) : 0;
          off = !sk || f.energy < sk.cost;
        } else off = f.energy < SPECIAL_COST;
        const key = `${frac.toFixed(2)}${off ? 1 : 0}`;
        if (key === c.last) return;
        c.last = key;
        c.cd.style.transform = `scaleY(${frac})`;
        c.el.classList.toggle('off', off);
        c.el.classList.toggle('ready', !off && frac === 0);
      });
      if (f.stats.wins !== it.lastWins) {
        it.pips.forEach((p, i) => p.classList.toggle('won', i < f.stats.wins));
        it.lastWins = f.stats.wins;
      }
      if (it.f.team >= 0 && this.teamPips[it.f.team]) {
        const tp = this.teamPips[it.f.team];
        if (tp.last !== f.stats.wins) { tp.pips.forEach((p, i) => p.classList.toggle('won', i < f.stats.wins)); tp.last = f.stats.wins; }
      }
      if (f.alive !== it.lastAlive) {
        it.card.classList.toggle('dead', !f.alive);
        it.lastAlive = f.alive;
      }
      // floating tag above the head; a downed fighter (tournament) shows a revive bar instead
      const downed = !f.alive && f.downed > 0;
      if (downed !== it.downed) {
        it.downed = downed;
        it.tag.classList.toggle('downed', downed);
        if (!downed) { it.label.textContent = it.name; it.lastHp = -1; }
      }
      if (!f.alive && !downed) { it.tag.style.opacity = '0'; continue; }
      if (downed) {
        const secs = Math.ceil(f.downed);
        const text = f.reviveProgress > 0 ? 'Reviving' : `Down ${secs}`;
        if (it.label.textContent !== text) it.label.textContent = text;
        it.mini.style.transform = `scaleX(${Math.min(1, f.reviveProgress / COMBAT.reviveTime)})`;
      }
      this.v.set(f.pos.x, f.pos.y + (downed ? 0.9 : 2.25 * f.def.scale), f.pos.z).project(camera);
      if (this.v.z > 1) { it.tag.style.opacity = '0'; continue; }
      const x = (this.v.x * 0.5 + 0.5) * width, y = (-this.v.y * 0.5 + 0.5) * height;
      it.tag.style.opacity = '1';
      it.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}

export function specialName(def) { return SPECIALS[def.special].label; }
