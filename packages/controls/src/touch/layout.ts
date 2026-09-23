// A touch scheme is data: a list of on-screen controls, each writing a touch
// id the action map reads (ActionSpec.touch). A game picks a preset or writes
// its own -- a new scheme is a new list, no code. Positions are CSS pixels from
// an anchor (scaled by --keel-ctl-scale); zones and regions are fractions of
// the screen.

export type Anchor = "tl" | "t" | "tr" | "l" | "c" | "r" | "bl" | "b" | "br";
/** A rectangle as fractions of the overlay: x, y, width, height (0..1). */
export type Rect = readonly [number, number, number, number];

export interface ButtonControl {
  readonly type: "button";
  readonly id: string;
  readonly label?: string;
  readonly anchor: Anchor;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
  readonly shape?: "round" | "pill" | "square";
  /** Extra class names (a game's own styling hook). */
  readonly className?: string;
  /** What holding it writes (default 1; buttons sharing an id add up -- a left arrow -1, a right +1). */
  readonly value?: number;
  /** Flip on each tap instead of holding. */
  readonly toggle?: boolean;
  /** Buttons in the same group can be held and crossed with one finger. */
  readonly slide?: string;
}
export interface StickControl {
  readonly type: "stick";
  /** The ids it writes: x (right +) and y (down +). Leave one out for a one-axis stick (a steering slider). */
  readonly x?: string;
  readonly y?: string;
  readonly anchor: Anchor;
  readonly at: readonly [number, number];
  readonly radius?: number;
  /** A floating stick appears wherever the thumb lands inside `region` (default: fixed where it's drawn). */
  readonly region?: Rect;
  readonly deadzone?: number;
}
export interface ZoneControl {
  readonly type: "zone";
  readonly id: string;
  /** What holding it writes (zones sharing an id add up: left half -1, right half +1). */
  readonly value: number;
  readonly rect: Rect;
  readonly label?: string;
  /** Zones in the same group can be held and crossed with one finger. */
  readonly slide?: string;
}
export interface SliderControl {
  readonly type: "slider";
  readonly id: string;
  readonly anchor: Anchor;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly label?: string;
  /** Spring back to 0 when let go (a pedal), or stay (a throttle lever). */
  readonly spring?: boolean;
}
export interface TiltControl {
  readonly type: "tilt";
  readonly id: string;
  /** Degrees of roll for a full value, and the dead zone around level. */
  readonly range?: number;
  readonly deadzone?: number;
}
export type TouchControl = ButtonControl | StickControl | ZoneControl | SliderControl | TiltControl;

export interface TouchLayout {
  readonly name: string;
  readonly controls: readonly TouchControl[];
}

// ------------------------------------------------------------------- presets

const btn = (id: string, label: string, anchor: Anchor, x: number, y: number, size = 64, shape: ButtonControl["shape"] = "round"): ButtonControl => ({ type: "button", id, label, anchor, x, y, size, shape });

/** Generic: a d-pad of four buttons on the left, four face buttons on the right (ids up/down/left/right, a/b/x/y). */
export const DPAD_BUTTONS: TouchLayout = {
  name: "dpad-buttons",
  controls: [
    { ...btn("up", "↑", "bl", 76, 140, 56, "square"), slide: "dpad-y" }, { ...btn("down", "↓", "bl", 76, 24, 56, "square"), slide: "dpad-y" },
    { ...btn("left", "←", "bl", 18, 82, 56, "square"), slide: "dpad-x" }, { ...btn("right", "→", "bl", 134, 82, 56, "square"), slide: "dpad-x" },
    btn("a", "A", "br", 76, 24), btn("b", "B", "br", 18, 82), btn("x", "X", "br", 134, 82), btn("y", "Y", "br", 76, 140),
  ],
};

/** Generic: two floating sticks, one each half (ids move.x/move.y, look.x/look.y). */
export const TWIN_STICK: TouchLayout = {
  name: "twin-stick",
  controls: [
    { type: "stick", x: "move.x", y: "move.y", anchor: "bl", at: [110, 110], radius: 60, region: [0, 0.3, 0.5, 0.7] },
    { type: "stick", x: "look.x", y: "look.y", anchor: "br", at: [110, 110], radius: 60, region: [0.5, 0.3, 0.5, 0.7] },
  ],
};

// Racing: every scheme writes the same ids -- steer (-1..1), gas, brake, handbrake, boost (0..1), camera -- so a game
// binds them once and lets the player pick.
const pedals: readonly TouchControl[] = [
  btn("gas", "GAS", "br", 22, 30, 84, "pill"), btn("brake", "BRK", "br", 118, 30, 70, "pill"),
  btn("boost", "N₂O", "br", 30, 136, 60), btn("handbrake", "E", "br", 104, 124, 52), btn("camera", "◉", "tr", 16, 84, 44),
];
/** Arrows: two big steering buttons bottom-left, the pedals bottom-right. */
export const RACING_BUTTONS: TouchLayout = {
  name: "racing-buttons",
  controls: [{ ...btn("steer", "◀", "bl", 20, 30, 84), value: -1, slide: "steer" }, { ...btn("steer", "▶", "bl", 120, 30, 84), value: 1, slide: "steer" }, ...pedals],
};
/** A one-axis stick for the wheel (analog), the pedals on the right. */
export const RACING_STICK: TouchLayout = {
  name: "racing-stick",
  controls: [{ type: "stick", x: "steer", anchor: "bl", at: [120, 100], radius: 70, region: [0, 0.35, 0.45, 0.65] }, ...pedals],
};
/** Tilt the phone to steer (a steering wheel in your hands), the pedals under your thumbs. */
export const RACING_TILT: TouchLayout = {
  name: "racing-tilt",
  controls: [{ type: "tilt", id: "steer", range: 28, deadzone: 2.5 }, btn("brake", "BRK", "bl", 22, 30, 84, "pill"), ...pedals.filter((c) => !("id" in c) || c.id !== "brake")],
};
/** Tap and hold the screen's halves to steer; an analog throttle lever on the right edge. */
export const RACING_ZONES: TouchLayout = {
  name: "racing-zones",
  controls: [
    { type: "zone", id: "steer", value: -1, rect: [0, 0.25, 0.35, 0.75], label: "◀", slide: "steer" },
    { type: "zone", id: "steer", value: 1, rect: [0.35, 0.25, 0.35, 0.75], label: "▶", slide: "steer" },
    { type: "slider", id: "gas", anchor: "br", x: 24, y: 40, width: 56, height: 180, label: "GAS", spring: true },
    btn("brake", "BRK", "br", 96, 40, 64, "pill"), btn("boost", "N₂O", "br", 96, 124, 56), btn("handbrake", "E", "br", 96, 196, 48), btn("camera", "◉", "tr", 16, 84, 44),
  ],
};

export const TOUCH_LAYOUTS = { DPAD_BUTTONS, TWIN_STICK, RACING_BUTTONS, RACING_STICK, RACING_TILT, RACING_ZONES } as const;
