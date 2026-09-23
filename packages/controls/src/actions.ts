// The action map: a game names what the player does ("steer", "throttle",
// "jump", "pause") and says where each can come from -- keys, pad buttons or
// a stick, a touch control -- and reads back one value per action a frame,
// whatever the player is holding. Each value says which device it came from
// and whether it was DIGITAL (all or nothing: a key, a d-pad, a touch button)
// or analog (a stick, a trigger, a tilt), because a game treats them
// differently: a car steered by a key needs its full press shaped, one steered
// by a stick doesn't. The device last used decides which glyphs to show.
//
//   const controls = createControls({
//     steer: { kind: "axis", negKeys: ["KeyA", "ArrowLeft"], keys: ["KeyD", "ArrowRight"], stick: "lx", negPad: ["left"], pad: ["right"], touch: "steer" },
//     throttle: { kind: "button", keys: ["KeyW"], pad: ["rt"], touch: "gas" },
//   });
//   controls.attach(window);
//   // each frame:
//   controls.update();
//   car.steer = controls.value("steer");  // -1..1
//   car.keySteer = controls.digital("steer");

import { PAD_GLYPHS, axisValue, buttonValue, keyGlyph, padFamily } from "./pads.ts";
import type { Glyph, PadAxis, PadButton, PadFamily, PadState } from "./pads.ts";

export type Source = "keyboard" | "gamepad" | "touch";

/** Where an action's value comes from. A button reads 0..1 (a trigger its travel); an axis -1..1, `neg*` pushing it down. */
export interface ActionSpec {
  readonly kind: "button" | "axis";
  readonly keys?: readonly string[];
  readonly negKeys?: readonly string[];
  readonly pad?: readonly PadButton[];
  readonly negPad?: readonly PadButton[];
  /** A stick axis (an axis action; x is right, y is DOWN -- set invert for up-is-positive). */
  readonly stick?: PadAxis;
  readonly invert?: boolean;
  /** A touch control's id (what a touch scheme writes; see touch/). */
  readonly touch?: string;
  /** Analog dead zone (default 0.15 for sticks, 0.04 for triggers). */
  readonly deadzone?: number;
  /** Analog response: 0 straight, 1 squared (fine near the centre, full at the edge). */
  readonly curve?: number;
}

export interface ActionState {
  readonly value: number;
  /** Held past half (a button), or pushed past half either way (an axis). */
  readonly down: boolean;
  /** Went down / came up this update. */
  readonly pressed: boolean;
  readonly released: boolean;
  /** All or nothing -- a key, a d-pad, a face button, a touch button. */
  readonly digital: boolean;
  readonly source: Source | null;
}

/** Touch controls' live values: the on-screen schemes write here, the map reads. */
export interface VirtualControls {
  set(id: string, value: number, digital?: boolean): void;
  /** Queue a one-frame press for a tap that may begin and end between updates. */
  press(id: string, value?: number, digital?: boolean): void;
  get(id: string): { readonly value: number; readonly digital: boolean } | undefined;
  /** Let one go (or all of them: a scheme torn down). */
  clear(id?: string): void;
}

export interface Controls<A extends string> {
  /** Poll the pads and fold every device into this frame's states. Once a frame, before reading. */
  update(): void;
  state(action: A): ActionState;
  value(action: A): number;
  down(action: A): boolean;
  pressed(action: A): boolean;
  digital(action: A): boolean;
  /** The device the player used last, and (for a gamepad) its family -- what prompts should show. */
  readonly source: Source;
  readonly family: PadFamily | null;
  /** How to prompt for an action on the device in use (every binding it has there; empty if none). */
  glyphs(action: A): Glyph[];
  readonly virtual: VirtualControls;
  /** Feed a key by hand (tests, a remapped source); attach does this from the page. */
  key(code: string, down: boolean): void;
  /** Replace an action's keyboard bindings without changing its pad or touch controls. */
  bindKeys(action: A, keys: readonly string[], negKeys?: readonly string[]): void;
  /** Hand in the pads (tests); attach polls navigator.getGamepads in update(). */
  setPads(pads: ArrayLike<PadState | null>): void;
  /** Told whenever the device in use changes (for glyphs, or to show/hide touch controls). */
  onSource(listener: (source: Source, family: PadFamily | null) => void): () => void;
  /** Listen to a page: keys on `target`, pads through navigator. Returns detach(). */
  attach(target?: EventTarget, nav?: { getGamepads?(): ArrayLike<PadState | null> | null }): () => void;
}

const IDLE: ActionState = { value: 0, down: false, pressed: false, released: false, digital: true, source: null };

/** An analog reading through a dead zone (rescaled to start at 0 past it) and a response curve. */
export function shapeAnalog(v: number, deadzone: number, curve = 0): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const t = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(v) * (t + (t * t - t) * curve);
}

export function createControls<A extends string>(map: Readonly<Record<A, ActionSpec>>): Controls<A> {
  map = { ...map };
  const actions = Object.keys(map) as A[];
  const held = new Set<string>(), keyPulses = new Set<string>(), bound = new Set<string>();
  for (const a of actions) for (const k of [...(map[a].keys ?? []), ...(map[a].negKeys ?? [])]) bound.add(k);
  const touches = new Map<string, { value: number; digital: boolean }>();
  // A quick tap can write 1 and 0 before the next simulation update. Keep the
  // press long enough for that update, then discard it below.
  const pulses = new Map<string, { value: number; digital: boolean }>();
  let pads: ArrayLike<PadState | null> = [], poll: (() => ArrayLike<PadState | null> | null) | null = null;
  const states = new Map<A, ActionState>();
  const listeners = new Set<(s: Source, f: PadFamily | null) => void>();
  let source: Source = "keyboard", family: PadFamily | null = null;
  const use = (s: Source, f: PadFamily | null): void => {
    if (s === source && f === family) return;
    source = s; family = f;
    for (const l of listeners) l(s, f);
  };

  // One action's reading from each device: the value, and whether it was digital.
  const fromKeys = (spec: ActionSpec): number => {
    const on = (ks: readonly string[] | undefined): number => (ks?.some((k) => held.has(k) || keyPulses.has(k)) ? 1 : 0);
    return on(spec.keys) - on(spec.negKeys);
  };
  const fromPad = (spec: ActionSpec, pad: PadState): { value: number; digital: boolean } => {
    let best = 0, digital = true;
    const take = (v: number, d: boolean): void => { if (Math.abs(v) > Math.abs(best)) { best = v; digital = d; } };
    if (spec.stick) take(shapeAnalog(axisValue(pad, spec.stick) * (spec.invert ? -1 : 1), spec.deadzone ?? 0.15, spec.curve), false);
    const button = (b: PadButton, sign: number): void => {
      const trigger = b === "lt" || b === "rt", raw = buttonValue(pad, b);
      take(sign * (trigger ? shapeAnalog(raw, spec.deadzone ?? 0.04, spec.curve) : raw > 0.5 ? 1 : 0), !trigger);
    };
    for (const b of spec.pad ?? []) button(b, 1);
    for (const b of spec.negPad ?? []) button(b, -1);
    return { value: best, digital };
  };

  const controls: Controls<A> = {
    get source() { return source; },
    get family() { return family; },
    virtual: {
      set(id, value, digital = false) { touches.set(id, { value, digital }); if (value !== 0) use("touch", null); },
      press(id, value = 1, digital = true) { pulses.set(id, { value, digital }); if (value !== 0) use("touch", null); },
      get: (id) => touches.get(id),
      clear(id) {
        if (id === undefined) { touches.clear(); pulses.clear(); }
        else { touches.delete(id); pulses.delete(id); }
      },
    },
    key(code, down) {
      if (down) { if(!held.has(code))keyPulses.add(code);held.add(code); if (bound.has(code)) use("keyboard", null); } else held.delete(code);
    },
    bindKeys(action, keys, negKeys = []) {
      map = { ...map, [action]: { ...map[action], keys: [...keys], negKeys: [...negKeys] } };
      states.delete(action); bound.clear();
      for (const a of actions) for (const k of [...(map[a].keys ?? []), ...(map[a].negKeys ?? [])]) bound.add(k);
    },
    setPads(p) { pads = p; },
    onSource(l) { listeners.add(l); return () => listeners.delete(l); },
    update() {
      if (poll) pads = poll() ?? [];
      // (A pad counts as picked up when a button goes down or a stick leaves its dead zone -- a resting pad's drift doesn't.)
      for (let i = 0; i < pads.length; i += 1) {
        const pad = pads[i];
        if (!pad || pad.connected === false) continue;
        let active = false;
        for (let b = 0; b < pad.buttons.length && !active; b += 1) { const raw = pad.buttons[b]!; active = (typeof raw === "number" ? raw : raw.value) > 0.5 || (typeof raw !== "number" && raw.pressed); }
        for (let x = 0; x < pad.axes.length && !active; x += 1) active = Math.abs(pad.axes[x]!) > 0.5;
        if (active) use("gamepad", padFamily(pad.id ?? ""));
      }
      for (const a of actions) {
        const spec = map[a];
        // Every device's reading; the strongest wins (ties go to the device in use).
        const readings: { value: number; digital: boolean; source: Source }[] = [{ value: fromKeys(spec), digital: true, source: "keyboard" }];
        for (let i = 0; i < pads.length; i += 1) { const pad = pads[i]; if (pad && pad.connected !== false) readings.push({ ...fromPad(spec, pad), source: "gamepad" }); }
        const t = spec.touch ? touches.get(spec.touch) : undefined;
        if (t) readings.push({ value: t.value, digital: t.digital, source: "touch" });
        const p = spec.touch ? pulses.get(spec.touch) : undefined;
        if (p) readings.push({ value: p.value, digital: p.digital, source: "touch" });
        let best: (typeof readings)[number] | null = null;
        for (const r of readings) if (r.value !== 0 && (!best || Math.abs(r.value) > Math.abs(best.value) || (Math.abs(r.value) === Math.abs(best.value) && r.source === source))) best = r;
        const value = best ? Math.max(spec.kind === "axis" ? -1 : 0, Math.min(1, best.value)) : 0;
        const was = states.get(a) ?? IDLE, down = Math.abs(value) > 0.5;
        const keyPressed=[...(spec.keys??[]),...(spec.negKeys??[])].some(k=>keyPulses.has(k));
        states.set(a, { value, down, pressed: down && (!was.down || keyPressed), released: !down && was.down, digital: best ? best.digital : true, source: best ? best.source : null });
      }
      pulses.clear();
      keyPulses.clear();
    },
    state: (a) => states.get(a) ?? IDLE,
    value: (a) => (states.get(a) ?? IDLE).value,
    down: (a) => (states.get(a) ?? IDLE).down,
    pressed: (a) => (states.get(a) ?? IDLE).pressed,
    digital: (a) => (states.get(a) ?? IDLE).digital,
    glyphs(a) {
      const spec = map[a];
      if (source === "keyboard") return [...(spec.negKeys ?? []), ...(spec.keys ?? [])].map(keyGlyph);
      if (source === "gamepad") {
        const set = PAD_GLYPHS[family ?? "generic"];
        return [...(spec.stick ? [set[spec.stick]] : []), ...(spec.negPad ?? []).map((b) => set[b]), ...(spec.pad ?? []).map((b) => set[b])];
      }
      return [];
    },
    attach(target = globalThis as unknown as EventTarget, nav = (globalThis as { navigator?: { getGamepads?(): ArrayLike<PadState | null> | null } }).navigator) {
      const down = (e: Event): void => {
        const k = e as KeyboardEvent;
        // (A shortcut -- a key with Meta, Ctrl or Alt held -- is the browser's, not the game's.)
        if (k.metaKey || k.altKey || (k.ctrlKey && !k.code.startsWith("Control"))) return;
        controls.key(k.code, true);
        if (bound.has(k.code)) k.preventDefault();
      };
      const up = (e: Event): void => controls.key((e as KeyboardEvent).code, false);
      // (A blur loses key-ups, so held keys are dropped; touches get their own pointercancel, so they're left to it.)
      const blur = (): void => {held.clear();keyPulses.clear();};
      target.addEventListener("keydown", down);
      target.addEventListener("keyup", up);
      target.addEventListener("blur", blur);
      if (nav?.getGamepads) poll = nav.getGamepads.bind(nav);
      return () => {
        target.removeEventListener("keydown", down);
        target.removeEventListener("keyup", up);
        target.removeEventListener("blur", blur);
        poll = null;
      };
    },
  };
  return controls;
}
