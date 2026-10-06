// Button prompts that follow the input device in use. The tutorial and the practice room ask
// for actions by name (punch, block, skill1...) and this module turns each into the right label:
// a key on a keyboard, a button on a gamepad, an on-screen button on a touch screen.
// Whatever adds gamepad or touch controls can replace a device's labels with registerPromptDevice()
// and switch devices with prompts.use(); until then the last device the player touched is used.
import { keyLabel } from './config.js';

// Standard-mapping gamepad (Xbox names). Placeholder until the gamepad controls define their own.
const GAMEPAD = {
  move: 'Left stick', punch: 'X', kick: 'Y', jump: 'A', special: 'B', block: 'RT', dash: 'LT',
  skill1: 'LB', skill2: 'RB', skill3: 'R3', use: 'D-pad ↑', cycle: 'D-pad →',
  slot1: 'D-pad ↑', slot2: 'D-pad →', slot3: 'D-pad ↓', slot4: 'D-pad ←', menu: 'Start', skip: 'Select', next: 'Select',
};
// On-screen touch buttons, named after what they do.
const TOUCH = {
  move: 'joystick', punch: 'Punch', kick: 'Kick', jump: 'Jump', special: 'Special', block: 'Block', dash: 'Dodge',
  skill1: 'Skill 1', skill2: 'Skill 2', skill3: 'Skill 3', use: 'Use', cycle: 'Next',
  slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3', slot4: 'Slot 4', menu: 'Pause', skip: 'Skip', next: 'Skip',
};
// Keys the training screens use that are not player bindings.
const KEYBOARD_EXTRA = { menu: 'Esc', skip: 'Tab', next: 'Tab', dummy: 'Tab', reset: 'R', gear: 'G' };

const devices = {
  keyboard: { verb: 'Press', hold: 'Hold', label: (a, b) => KEYBOARD_EXTRA[a] || keyLabel(b?.[a]),
    move: (b) => [b?.up, b?.left, b?.down, b?.right].map(keyLabel).join(' ') },
  gamepad: { verb: 'Press', hold: 'Hold', label: (a) => GAMEPAD[a] || a, move: () => GAMEPAD.move },
  touch: { verb: 'Tap', hold: 'Hold', label: (a) => TOUCH[a] || a, move: () => `the ${TOUCH.move}` },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const prompts = {
  device: 'keyboard',
  listeners: new Set(),
  // switch to 'keyboard' | 'gamepad' | 'touch' (or any registered device)
  use(name) {
    if (!devices[name] || name === this.device) return;
    this.device = name;
    for (const fn of this.listeners) fn(name);
  },
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  // <kbd> for one action, e.g. key('punch', bindings[0]) -> J, X or "Punch"
  key(action, binding) {
    const d = devices[this.device];
    return `<kbd class="pr pr-${this.device}">${esc(d.label(action, binding) || '—')}</kbd>`;
  },
  // the movement control: W A S D, Left stick or the joystick
  move(binding) {
    const d = devices[this.device];
    return this.device === 'keyboard'
      ? [binding?.up, binding?.left, binding?.down, binding?.right].map((c) => `<kbd class="pr">${esc(keyLabel(c))}</kbd>`).join('')
      : `<kbd class="pr pr-${this.device}">${esc(d.move(binding))}</kbd>`;
  },
  get verb() { return devices[this.device].verb; },
  get hold() { return devices[this.device].hold; },
  // a gamepad has no keydown, so it is noticed when any button or stick moves
  pollGamepad() {
    if (this.device === 'gamepad' || !navigator.getGamepads) return;
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      if (pad.buttons.some((b) => b.pressed) || pad.axes.some((v) => Math.abs(v) > 0.5)) { this.use('gamepad'); return; }
    }
  },
};

// Replace or add a device: labelFn(action, binding) -> text, moveFn(binding) -> text.
export function registerPromptDevice(name, { label, move, verb = 'Press', hold = 'Hold' }) {
  devices[name] = { verb, hold, label, move: move || (() => label('move')) };
  if (prompts.device === name) for (const fn of prompts.listeners) fn(name);
}

// the last thing the player touched decides the prompts
window.addEventListener('keydown', () => prompts.use('keyboard'), { capture: true });
window.addEventListener('touchstart', () => prompts.use('touch'), { capture: true, passive: true });
window.addEventListener('gamepadconnected', () => prompts.use('gamepad'));
