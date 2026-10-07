// Arcade: a short ladder for one player. Five CPU fights that get harder, then the boss, El Diablo,
// a giant version of a roster fighter with triple health and heavier hands. Losing a fight costs a
// continue and you try that stage again; run out and the climb is over. Every stage is an ordinary
// local match in the 'arcade' mode, so it counts on your profile and toward locker unlocks.
import { ROSTER, SPECIALS } from './config.js';
import { saveSetup } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const BEST_KEY = 'battle-arena.arcade-best.v1';
const CONTINUES = 3;
// [CPU skill, how many foes, rounds to win]
const STAGES = [['easy', 1, 1], ['normal', 1, 1], ['normal', 2, 1], ['hard', 1, 1], ['brutal', 1, 1]];
const BOSS_FROM = ['titan', 'onyx', 'kane'];

// The boss is a roster fighter blown up to giant size: bigger, tougher, harder hitting, a little slower.
export function bossDef(base) {
  return { ...base, name: 'El Diablo', title: 'Lord of the Arena', scale: base.scale * 1.45, health: Math.round(base.health * 2.8),
    power: base.power * 1.3, speed: base.speed * 0.94 };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export class Arcade {
  constructor({ game, menus, bindings }) {
    this.game = game;
    this.menus = menus;
    this.bindings = bindings;
    this.run = null;   // the climb in progress
    this.screen = menus.screens.arcade;
  }

  get active() { return !!this.run && this.game.mode === 'match' && this.game.setup?.mode === 'arcade'; }
  get best() { try { return +localStorage.getItem(BEST_KEY) || 0; } catch { return 0; } }

  // A fresh climb: the opponents for each stage are drawn now, so the ladder can be shown up front.
  newRun() {
    const pick = this.menus.setup.slots[0].fighter;
    const me = pick >= 0 ? pick : Math.floor(Math.random() * ROSTER.length);
    const others = shuffle([...ROSTER.keys()].filter((i) => i !== me));
    const bosses = shuffle(ROSTER.map((d, i) => i).filter((i) => BOSS_FROM.includes(ROSTER[i].id) && i !== me));
    const bi = bosses[0];
    let k = 0;
    const stages = STAGES.map(([diff, foes, wins]) => ({ diff, wins, foes: Array.from({ length: foes }, () => others[k++ % others.length]) }));
    stages.push({ diff: 'brutal', wins: 2, foes: [bi], boss: true });
    this.run = { me, stages, stage: 0, continues: CONTINUES, score: 0, kos: 0, over: false, won: false, last: '' };
  }

  // Shows the ladder screen; a new climb when none is going (or the last one ended).
  open() {
    if (!this.run || this.run.over) this.newRun();
    this.menus.show('arcade');
  }

  stop() { this.run = null; }

  changeFighter(d) {
    if (!this.run || this.run.stage > 0 || this.run.last) return;
    const s = this.menus.setup.slots[0], n = ROSTER.length;
    s.fighter = ((s.fighter + 1 + d + n + 1) % (n + 1)) - 1; // -1 = random
    saveSetup(this.menus.setup);
    this.newRun();
    this.render();
    this.screen.querySelector('[data-opt=arc-fighter]')?.focus({ preventScroll: true });
  }

  startStage() {
    const r = this.run;
    if (!r || r.over) return;
    const st = r.stages[r.stage];
    const slots = [{ control: 0, fighter: r.me, team: -1, reward: this.menus.rewardTier }];
    for (const f of st.foes) {
      slots.push(st.boss ? { control: 'cpu', fighter: f, def: bossDef(ROSTER[f]), team: -1, reward: 2 } : { control: 'cpu', fighter: f, team: -1 });
    }
    const setup = { mode: 'arcade', winsNeeded: st.wins, difficulty: st.diff, suddenDeath: st.boss ? 0 : 75, teams: { count: 0, names: [] }, slots };
    this.menus.hideAll();
    this.game.setPaused(false);
    this.game.startMatch(setup, this.bindings);
    this.game.hud.announce(st.boss ? 'Final stage · El Diablo' : `Stage ${r.stage + 1}`, 'round', 1500);
  }

  restartStage() { for (const f of this.game.fighters) f.stats = { kos: 0, damage: 0, wins: 0 }; this.startStage(); }

  // The stage's match is over (main.js routes the end of an arcade match here).
  onMatchEnd(champ) {
    const r = this.run;
    const me = this.game.fighters[0];
    const st = r.stages[r.stage];
    const won = champ === me;
    r.kos += me.stats.kos;
    if (won) {
      const gained = 1000 * (r.stage + 1) * (st.boss ? 3 : 1) + me.stats.kos * 150 + Math.round(me.stats.damage) + Math.round((me.hp / me.maxHp) * 500);
      r.score += gained;
      r.last = st.boss ? `You toppled El Diablo. +${gained.toLocaleString()} points.` : `Stage ${r.stage + 1} cleared. +${gained.toLocaleString()} points.`;
      r.stage++;
      if (r.stage >= r.stages.length) { r.over = true; r.won = true; }
    } else {
      r.continues--;
      r.last = r.continues >= 0 ? `${champ?.name || 'The arena'} beat you. ${r.continues} ${r.continues === 1 ? 'continue' : 'continues'} left.` : '';
      if (r.continues < 0) { r.over = true; r.last = `${champ?.name || 'The arena'} beat you. Out of continues.`; }
    }
    if (r.over && r.score > this.best) { try { localStorage.setItem(BEST_KEY, String(r.score)); } catch { /* ignore */ } r.newBest = true; }
    setTimeout(() => {
      if (this.game.phase !== 'matchOver' || this.run !== r) return;
      this.game.keyboard.captureGameKeys = false;
      this.game.hud.show(false);
      this.menus.show('arcade');
    }, 2600);
  }

  fighterLine(i) {
    const d = ROSTER[i];
    return `${esc(d.title)} · ${esc(d.role)} · ${esc(SPECIALS[d.special].label)}`;
  }

  render() {
    const r = this.run;
    if (!r) return;
    const el = this.screen;
    const me = ROSTER[r.me];
    const fresh = r.stage === 0 && !r.last;
    el.querySelector('.arc-eyebrow').textContent = r.over ? (r.won ? 'Arcade · champion' : 'Arcade · game over') : `Arcade · stage ${r.stage + 1} of ${r.stages.length}`;
    el.querySelector('.arc-title').textContent = r.over ? (r.won ? 'Champion of the arena' : 'The climb ends here') : fresh ? 'Climb the ladder' : r.stages[r.stage].boss ? 'The boss awaits' : 'Next challenger';
    el.querySelector('.arc-sub').textContent = r.last || 'Five fights against the CPU, each harder than the last, then El Diablo. Lose and you spend a continue to try the stage again.';
    const pick = el.querySelector('[data-opt=arc-fighter]');
    pick.hidden = !fresh;
    const sel = this.menus.setup.slots[0].fighter;
    pick.innerHTML = `<span class="lbl">Your fighter</span><span class="val"><i>‹</i>${sel >= 0 ? esc(ROSTER[sel].name) : `Random (${esc(me.name)})`}<i>›</i></span>`;
    el.querySelector('.ladder').innerHTML = r.stages.map((st, i) => {
      const names = st.foes.map((f) => (st.boss ? 'El Diablo' : ROSTER[f].name)).join(' & ');
      const sub = st.boss ? `A giant ${esc(ROSTER[st.foes[0]].name)} · triple health · best of three` : st.foes.length > 1 ? 'Two at once' : this.fighterLine(st.foes[0]);
      const state = i < r.stage ? 'done' : i === r.stage && !r.over ? 'now' : '';
      const label = i < r.stage ? 'Beaten' : i === r.stage && !r.over ? 'Next' : st.boss ? 'Boss' : { easy: 'Easy', normal: 'Normal', hard: 'Hard', brutal: 'Brutal' }[st.diff];
      return `<div class="rung ${state}${st.boss ? ' boss' : ''}" style="--fc:${hex(ROSTER[st.foes[0]].eyes)}"><span class="n">${st.boss ? 'BOSS' : i + 1}</span>
        <span class="who"><b>${esc(names)}</b><small>${sub}</small></span><span class="st">${label}</span></div>`;
    }).join('');
    el.querySelector('.arcade-stats').innerHTML = [
      `You <b>${esc(me.name)}</b>`, `Score <b>${r.score.toLocaleString()}</b>`, `Knockouts <b>${r.kos}</b>`,
      `Continues <b>${Math.max(0, r.continues)}</b>`, `Best <b>${Math.max(this.best, r.score).toLocaleString()}</b>${r.newBest && r.over ? ' (new!)' : ''}`,
    ].map((x) => `<span>${x}</span>`).join('');
    const nextLabel = fresh ? 'Begin the climb' : r.stages[r.stage]?.boss ? 'Face El Diablo' : r.last.includes('beat you') ? 'Try again' : 'Next fight';
    el.querySelector('.arc-actions').innerHTML = r.over
      ? '<button class="nav big primary" data-act="arc-new">Climb again</button><button class="nav big" data-act="arc-quit">Title screen</button>'
      : `<button class="nav big primary" data-act="arc-fight">${nextLabel}</button><button class="nav big" data-act="to-controls">Controls</button><button class="nav big" data-act="arc-quit">${fresh ? 'Back' : 'Give up'}</button>`;
  }

  // Buttons on the arcade screen (main.js routes arc-* here). True when handled.
  onAct(act) {
    switch (act) {
      case 'arc-fight': this.startStage(); return true;
      case 'arc-new': this.newRun(); this.menus.show('arcade'); return true;
      case 'arc-quit': this.stop(); this.menus.cb.onQuit(); return true;
      default: return false;
    }
  }
}
