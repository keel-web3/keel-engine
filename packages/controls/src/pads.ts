// Gamepads: the browser's standard mapping (every pad the Gamepad API knows
// is laid out as an Xbox pad -- face buttons bottom/right/left/top, bumpers,
// analog triggers, the d-pad, two sticks), which family a pad is (so the game
// shows the buttons actually printed on it), and the glyphs to draw them with.
// A PlayStation pad's bottom face button is the same button 0 as Xbox's A --
// only the glyph differs: Cross, blue.

/** A control on a standard-mapping pad (buttons and stick axes), named by where it is. */
export type PadButton = "a" | "b" | "x" | "y" | "lb" | "rb" | "lt" | "rt" | "view" | "menu" | "ls" | "rs" | "up" | "down" | "left" | "right" | "home";
export type PadAxis = "lx" | "ly" | "rx" | "ry";
export type PadControl = PadButton | PadAxis;

/** Button indices under the standard mapping (a: bottom face, b: right, x: left, y: top). */
export const PAD_BUTTONS: Readonly<Record<PadButton, number>> = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15, home: 16,
};
/** Axis indices (x right, y down). */
export const PAD_AXES: Readonly<Record<PadAxis, number>> = { lx: 0, ly: 1, rx: 2, ry: 3 };

export type PadFamily = "xbox" | "playstation" | "switch" | "generic";

/** A pad's family from its id string (vendor ids and names: Sony 054c, Microsoft 045e, Nintendo 057e). */
export function padFamily(id: string): PadFamily {
  const s = id.toLowerCase();
  // (Xbox first: its pads call themselves "Xbox Wireless Controller", and Sony's plain "Wireless Controller".)
  if (/045e|xbox|xinput|microsoft/.test(s)) return "xbox";
  if (/054c|sony|playstation|dualshock|dualsense|wireless controller/.test(s)) return "playstation";
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return "switch";
  return "generic";
}

/** How to draw a control: its label, a spoken name, its colour (face buttons), and its shape. */
export interface Glyph {
  readonly label: string;
  readonly name: string;
  readonly colour?: string;
  readonly shape: "round" | "pill" | "trigger" | "key" | "stick" | "dpad";
}

const g = (label: string, name: string, shape: Glyph["shape"], colour?: string): Glyph => (colour ? { label, name, shape, colour } : { label, name, shape });
const SHARED: Readonly<Record<"up" | "down" | "left" | "right" | "ls" | "rs" | PadAxis, Glyph>> = {
  up: g("↑", "D-pad up", "dpad"), down: g("↓", "D-pad down", "dpad"), left: g("←", "D-pad left", "dpad"), right: g("→", "D-pad right", "dpad"),
  ls: g("L", "Left stick", "stick"), rs: g("R", "Right stick", "stick"),
  lx: g("L", "Left stick", "stick"), ly: g("L", "Left stick", "stick"), rx: g("R", "Right stick", "stick"), ry: g("R", "Right stick", "stick"),
};

/** Every family's glyphs, control by control. */
export const PAD_GLYPHS: Readonly<Record<PadFamily, Readonly<Record<PadControl, Glyph>>>> = {
  xbox: {
    ...SHARED,
    a: g("A", "A", "round", "#3fbf3f"), b: g("B", "B", "round", "#e2403c"), x: g("X", "X", "round", "#2f7fe6"), y: g("Y", "Y", "round", "#f2c21b"),
    lb: g("LB", "Left bumper", "pill"), rb: g("RB", "Right bumper", "pill"), lt: g("LT", "Left trigger", "trigger"), rt: g("RT", "Right trigger", "trigger"),
    view: g("⧉", "View", "round"), menu: g("≡", "Menu", "round"), home: g("⊗", "Xbox", "round"),
  },
  playstation: {
    ...SHARED,
    a: g("✕", "Cross", "round", "#7ea8ff"), b: g("○", "Circle", "round", "#ff6a74"), x: g("□", "Square", "round", "#ff8ad8"), y: g("△", "Triangle", "round", "#3fd6a4"),
    lb: g("L1", "L1", "pill"), rb: g("R1", "R1", "pill"), lt: g("L2", "L2", "trigger"), rt: g("R2", "R2", "trigger"),
    view: g("⋯", "Create", "pill"), menu: g("≡", "Options", "pill"), home: g("PS", "PS", "round"),
  },
  // (Nintendo prints A on the RIGHT: the standard mapping's bottom button is their B.)
  switch: {
    ...SHARED,
    a: g("B", "B", "round"), b: g("A", "A", "round"), x: g("Y", "Y", "round"), y: g("X", "X", "round"),
    lb: g("L", "L", "pill"), rb: g("R", "R", "pill"), lt: g("ZL", "ZL", "trigger"), rt: g("ZR", "ZR", "trigger"),
    view: g("−", "Minus", "round"), menu: g("+", "Plus", "round"), home: g("⌂", "Home", "round"),
  },
  generic: {
    ...SHARED,
    a: g("1", "Button 1", "round"), b: g("2", "Button 2", "round"), x: g("3", "Button 3", "round"), y: g("4", "Button 4", "round"),
    lb: g("L1", "L1", "pill"), rb: g("R1", "R1", "pill"), lt: g("L2", "L2", "trigger"), rt: g("R2", "R2", "trigger"),
    view: g("SEL", "Select", "pill"), menu: g("STA", "Start", "pill"), home: g("⌂", "Home", "round"),
  },
};

const KEY_LABELS: Readonly<Record<string, string>> = {
  Space: "SPACE", ShiftLeft: "SHIFT", ShiftRight: "SHIFT", ControlLeft: "CTRL", ControlRight: "CTRL", AltLeft: "ALT", AltRight: "ALT",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "ENTER", Escape: "ESC", Tab: "TAB", Backspace: "⌫",
};
/** A key's glyph, by KeyboardEvent.code ("KeyW" is "W", "Digit1" is "1", "Space" is SPACE). */
export function keyGlyph(code: string): Glyph {
  const label = KEY_LABELS[code] ?? code.replace(/^Key|^Digit|^Numpad/, "");
  return { label, name: label, shape: "key" };
}

/** What a pad reports (a Gamepad is one). */
export interface PadState {
  readonly id?: string;
  readonly connected?: boolean;
  readonly mapping?: string;
  readonly axes: ArrayLike<number>;
  readonly buttons: ArrayLike<{ readonly value: number; readonly pressed: boolean } | number>;
}

/** A button's value (0..1: a trigger's travel, 0 or 1 for the rest). */
export function buttonValue(pad: PadState, b: PadButton): number {
  const raw = pad.buttons[PAD_BUTTONS[b]];
  if (raw === undefined) return 0;
  return typeof raw === "number" ? raw : raw.value > 0 ? raw.value : raw.pressed ? 1 : 0;
}
/** An axis's value (-1..1). */
export const axisValue = (pad: PadState, a: PadAxis): number => pad.axes[PAD_AXES[a]] ?? 0;
