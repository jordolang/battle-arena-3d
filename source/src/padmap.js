// Gamepad button names and the default layout. Codes are "b<n>" for a button of the
// standard mapping and "a<n>+" / "a<n>-" for one direction of a stick axis.
// Stored on bindings as "Pad:<code>:<family>" when a HUD hint should show a pad glyph.

// Left stick moves; face buttons fight; triggers block and dodge; bumpers work the item bar;
// the D-pad fires bar slots 1-4 directly and flicking the right stick casts skills 1-3.
export const PAD_DEFAULTS = {
  up: 'a1-', down: 'a1+', left: 'a0-', right: 'a0+',
  punch: 'b2', kick: 'b3', special: 'b1', jump: 'b0',
  block: 'b6', dash: 'b7',
  skill1: 'a3-', skill2: 'a2-', skill3: 'a2+',
  use: 'b5', cycle: 'b4',
  slot1: 'b12', slot2: 'b15', slot3: 'b13', slot4: 'b14',
  // clicking the sticks: right taunts, left opens emotes and quick chat (the D-pad then picks)
  taunt: 'b11', comms: 'b10',
};

// Start and View/Share are kept for pausing, so they cannot be bound to fighting.
export const PAD_RESERVED = new Set(['b8', 'b9', 'b16']);

const FACE = {
  xbox: ['A', 'B', 'X', 'Y'],
  ps: ['✕', '○', '□', '△'],
  nintendo: ['B', 'A', 'Y', 'X'],
};
const SHOULDER = {
  xbox: ['LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS'],
  ps: ['L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3'],
  nintendo: ['L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS'],
};
const DPAD = { 12: 'D↑', 13: 'D↓', 14: 'D←', 15: 'D→', 16: 'Home' };
const ARROW = { '0-': 'L←', '0+': 'L→', '1-': 'L↑', '1+': 'L↓', '2-': 'R←', '2+': 'R→', '3-': 'R↑', '3+': 'R↓' };

// Which glyph set a controller uses, from the id string the browser reports.
export function padFamily(id = '') {
  const s = id.toLowerCase();
  if (/xbox|xinput|045e/.test(s)) return 'xbox';
  if (/054c|playstation|dualshock|dualsense|sony|^wireless controller/.test(s)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox';
}

// Short label for a pad code: "X", "RB", "D↑", "R↑".
export function padLabel(code, family = 'xbox') {
  if (!code) return '—';
  const m = /^([ab])(\d+)([+-]?)$/.exec(code);
  if (!m) return code;
  const n = +m[2];
  if (m[1] === 'a') return ARROW[n + m[3]] || `Axis ${n}${m[3]}`;
  if (n < 4) return (FACE[family] || FACE.xbox)[n];
  if (n < 12) return (SHOULDER[family] || SHOULDER.xbox)[n - 4];
  return DPAD[n] || `B${n}`;
}

// A friendlier name for the controller list on the Controls screen.
export function padName(id = '') {
  const fam = padFamily(id);
  const s = id.toLowerCase();
  if (/dualsense/.test(s)) return 'DualSense';
  if (fam === 'ps') return 'PlayStation controller';
  if (/pro controller/.test(s)) return 'Switch Pro Controller';
  if (/joy-con/.test(s)) return 'Joy-Con';
  if (/xbox|xinput|045e/.test(s)) return 'Xbox controller';
  const clean = id.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 28) : 'Controller';
}
