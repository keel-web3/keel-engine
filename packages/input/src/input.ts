// Input: devices in, intents out -- ported from the proof of concept's
// src/input/input.js; test/poc-equality.test.ts drives both with the same
// scripted event sequences and proves every sample identical. Keyboard (WASD
// or arrows, space to jump -- hold it to go higher -- shift to sprint), the
// mouse under Pointer Lock (click the canvas to lock it, Esc to let go), a
// gamepad (left stick runs, right stick looks, A jumps) and touch (left half a
// stick, right half a drag to look, a tap to jump) all come down to the same
// intents, taken once per fixed simulation step (see Intent).
//
//   const input = createInput({ sensitivity: 0.0025, idle: 6 });
//   const detach = input.attach(window, { canvas });  // the browser; tests drive key()/look()/pad() instead
//   const it = input.sample(STEP, cam.yaw);            // each fixed step
//   body.step(STEP, it.player ? it : pilot());
//
// Only the game's own keys count. A modifier, or a key pressed with Meta,
// Ctrl or Alt held (a shortcut), never moves anything and never takes the
// controls from the autopilot.

import { moveFromView } from "@keel-engine/core";

/** What a game key does. */
export type Action = "forward" | "back" | "left" | "right" | "jump" | "sprint";
/** The game's keys, by KeyboardEvent.code. */
export type GameKeyCode = "KeyW" | "ArrowUp" | "KeyS" | "ArrowDown" | "KeyA" | "ArrowLeft" | "KeyD" | "ArrowRight" | "Space" | "ShiftLeft" | "ShiftRight";

/** The game's keys by KeyboardEvent.code (the key's place, so WASD is WASD on any layout) and what each does. */
export const GAME_KEYS: Readonly<Record<GameKeyCode, Action>> = Object.freeze({
  KeyW: "forward", ArrowUp: "forward", KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  Space: "jump", ShiftLeft: "sprint", ShiftRight: "sprint",
});
const actionOf = (code: string): Action | undefined => (GAME_KEYS as Readonly<Record<string, Action>>)[code];
// (Plain key names -- "w", " ", "ArrowUp", "Shift" -- come in through here.)
const BY_NAME: Readonly<Record<string, GameKeyCode>> = {
  w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD", " ": "Space", space: "Space", spacebar: "Space", shift: "ShiftLeft",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};
const MODIFIERS = new Set(["meta", "os", "control", "alt", "altgraph", "contextmenu", "fn", "hyper", "super", "capslock"]);
const isModifier = (name: unknown): boolean => MODIFIERS.has(String(name ?? "").toLowerCase().replace(/(left|right)$/, ""));

/** What a key event carries (a KeyboardEvent is one). */
export interface KeyEventLike {
  readonly key?: string | undefined;
  readonly code?: string | undefined;
  readonly metaKey?: boolean | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
  readonly repeat?: boolean | undefined;
}
/** A key: a name ("w", " ", "ArrowUp"), a code ("KeyW"), or an event. */
export type KeyLike = string | KeyEventLike;

/** A key (a name, a code, or a KeyboardEvent) as a code in GAME_KEYS, or null. */
export function codeOf(k: KeyLike | null | undefined): GameKeyCode | null {
  if (k && typeof k === "object") return (k.code && actionOf(k.code) ? (k.code as GameKeyCode) : null) ?? codeOf(k.key ?? "");
  const s = String(k);
  if (actionOf(s)) return s as GameKeyCode;
  return BY_NAME[s.toLowerCase()] ?? null;
}

// A stick's two axes with a round dead zone, rescaled so it starts from 0 at the edge of it.
function deadzone(x: number, y: number, dz: number): [number, number] {
  const l = Math.hypot(x, y);
  if (l <= dz) return [0, 0];
  const k = Math.min(1, (l - dz) / (1 - dz)) / l;
  return [x * k, y * k];
}
/** A gamepad button: a number (pressed past 0.5) or { pressed }. */
export type PadButton = number | { readonly pressed?: boolean } | null | undefined;
const pressed = (b: PadButton): boolean => (typeof b === "number" ? b > 0.5 : Boolean(b?.pressed));

/** Who is driving. */
export type Driver = "player" | "autopilot";

export interface ArbiterOptions {
  /** s without real input before the autopilot takes back over (Infinity: never). */
  readonly idle?: number;
  readonly start?: Driver;
}
export interface Arbiter {
  driver: Driver;
  /** s since the player last did something real. */
  idleFor: number;
  idle: number;
  /** One step: `real` is whether the player did anything real in it. */
  update(dt: number, real: boolean): Driver;
  takeOver(): void;
  giveBack(): void;
}

/**
 * Who's driving: the autopilot until the player does something real, then the
 * player until `idle` seconds pass with nothing (Infinity: the player keeps it).
 */
export function createArbiter({ idle = 6, start = "autopilot" }: ArbiterOptions = {}): Arbiter {
  const a: Arbiter = {
    driver: start, idleFor: 0, idle,
    update(dt, real) {
      if (real) { a.driver = "player"; a.idleFor = 0; }
      else {
        a.idleFor += dt;
        if (a.driver === "player" && a.idleFor >= a.idle - 1e-9) a.driver = "autopilot"; // (steps summed in floats: 240 of 1/120 is 2 s)
      }
      return a.driver;
    },
    takeOver() { a.driver = "player"; a.idleFor = 0; },
    giveBack() { a.driver = "autopilot"; },
  };
  return a;
}

/**
 * One step's intents. `move` is a world direction on the ground,
 * camera-relative (moveFromView); `axes` the same before the view turned it;
 * `look` radians this step (+ yaw turns to the screen's right, + pitch looks
 * up); `jump` pressed since the last step (an edge: a tap between steps still
 * counts); `hold` jump is held (the character cuts short hops without it).
 * It is a @keel-engine/physics BodyInput and a @keel-engine/camera LookInput.
 */
export interface Intent {
  readonly move: [number, number];
  readonly axes: [number, number];
  readonly look: [number, number];
  readonly jump: boolean;
  readonly hold: boolean;
  readonly sprint: boolean;
  readonly driver: Driver;
  readonly player: boolean;
}

/** A gamepad's state: axes [lx, ly, rx, ry] and buttons (standard mapping: 0 A, 5 RB, 10 L3). A Gamepad is one. */
export interface PadState {
  readonly axes?: readonly number[] | undefined;
  readonly buttons?: readonly PadButton[] | undefined;
  readonly connected?: boolean | undefined;
}

export interface InputOptions {
  /** Radians of look per pixel of mouse. */
  readonly sensitivity?: number;
  /** Mouse/stick up looks down. */
  readonly invertY?: boolean;
  /** Radians a second at full right stick. */
  readonly lookSpeed?: number;
  /** Of the sticks. */
  readonly deadzone?: number;
  /** s without input before the autopilot takes back over. */
  readonly idle?: number;
  readonly start?: Driver;
  readonly touchSensitivity?: number;
  /** px of drag for a full touch stick. */
  readonly touchRadius?: number;
  /** px: one mouse event is clamped to this (some browsers throw one huge jump when the lock starts). */
  readonly maxMouse?: number;
}

// ---- the browser, as attach reads it (structural: tests hand it plain EventTargets)

export interface EventTargetLike {
  addEventListener(type: string, fn: (e: Event) => void, how?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, fn: (e: Event) => void, how?: AddEventListenerOptions | boolean): void;
}
export interface DocumentLike extends EventTargetLike {
  readonly hidden?: boolean;
  readonly pointerLockElement?: unknown;
  exitPointerLock?(): void;
}
export interface CanvasLike extends EventTargetLike {
  requestPointerLock?(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
  getBoundingClientRect(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
}
export interface NavigatorLike {
  getGamepads?(): ArrayLike<PadState | null> | null;
}
export interface AttachOptions {
  readonly canvas?: CanvasLike | null;
  /** Click the canvas to lock the pointer (else drag to look). */
  readonly lock?: boolean;
  readonly touch?: boolean;
  readonly document?: DocumentLike | null;
  readonly navigator?: NavigatorLike | null;
}

interface KeyEventIn extends KeyEventLike { readonly target?: unknown; preventDefault(): void }
interface MouseEventIn { readonly button?: number; readonly movementX: number; readonly movementY: number }
interface TouchIn { readonly identifier: number; readonly clientX: number; readonly clientY: number }
interface TouchEventIn { readonly changedTouches: Iterable<TouchIn>; readonly timeStamp: number; preventDefault(): void }

export interface Input {
  readonly opt: Required<InputOptions>;
  readonly arbiter: Arbiter;
  /** The pointer is locked to the canvas. */
  locked: boolean;
  /** Polled in sample() (attach sets it to navigator.getGamepads). */
  pollPads: (() => PadState | null) | null;
  readonly driver: Driver;
  readonly player: boolean;
  /** A key down or up: a name ("w", " ", "ArrowUp"), a code ("KeyW") or a KeyboardEvent. True if it was the game's. */
  key(k: KeyLike, down: boolean): boolean;
  /** Mouse movement in pixels (movementX, movementY): right and down are positive. */
  look(dx: number, dy: number): void;
  /** A touch drag to look, in pixels. */
  touchLook(dx: number, dy: number): void;
  /** The touch stick: x right, y forward, each -1..1. */
  stick(x: number, y: number): void;
  /** A tap that jumps. */
  tap(): void;
  /** A gamepad's state, or null. */
  pad(p: PadState | null | undefined): void;
  /** Let go of everything (the window lost focus). */
  blur(): void;
  /** The intents for one fixed step, relative to the view's yaw. */
  sample(dt: number, viewYaw?: number): Intent;
  /**
   * Listen in a browser: keys on `target` (window), the mouse and touch on
   * `canvas` (click to lock the pointer; without the lock, drag to look),
   * gamepads through navigator.getGamepads. Returns detach().
   */
  attach(target?: EventTargetLike, opts?: AttachOptions): () => void;
}

/** The input core (no DOM in it: tests and replays drive it by hand). */
export function createInput(o: InputOptions = {}): Input {
  const opt: Required<InputOptions> = { sensitivity: 0.0025, invertY: false, lookSpeed: 2.8, deadzone: 0.18, idle: 6, start: "autopilot", touchSensitivity: 0.006, touchRadius: 48, maxMouse: 240, ...o };
  const arbiter = createArbiter({ idle: opt.idle, start: opt.start });
  const held = new Set<GameKeyCode>();
  let mouse: [number, number] = [0, 0];
  let touchLook: [number, number] = [0, 0];
  let stick: [number, number] = [0, 0];
  let pad: PadState | null = null;
  let padJumpWas = false;
  let jumpLatch = false;
  let real = false;
  const doing = (action: Action): boolean => { for (const c of held) if (GAME_KEYS[c] === action) return true; return false; };

  const input: Input = {
    opt, arbiter, locked: false, pollPads: null,
    get driver() { return arbiter.driver; },
    get player() { return arbiter.driver === "player"; },
    key(k, down) {
      const ev = k && typeof k === "object" ? k : null;
      // A modifier going down: the keys held now may never see their key-up (Cmd+Tab), so let go of them all.
      if (isModifier(ev ? ev.key ?? ev.code : k) || isModifier(ev?.code)) { if (down) input.blur(); return false; }
      const code = codeOf(k);
      if (!code) return false;
      if (!down) { held.delete(code); return true; }
      if (ev && (ev.metaKey || ev.ctrlKey || ev.altKey)) return false; // (a shortcut, not a move)
      if (!held.has(code)) {
        held.add(code);
        if (GAME_KEYS[code] === "jump") jumpLatch = true;
        if (GAME_KEYS[code] !== "sprint") real = true; // (shift alone takes nothing over)
      }
      return true;
    },
    look(dx, dy) {
      const c = (v: number): number => Math.max(-opt.maxMouse, Math.min(opt.maxMouse, v || 0)); // (some browsers throw one huge jump when the lock starts)
      mouse = [mouse[0] + c(dx), mouse[1] + c(dy)];
      if (dx || dy) real = true;
    },
    touchLook(dx, dy) { touchLook = [touchLook[0] + dx, touchLook[1] + dy]; if (dx || dy) real = true; },
    stick(x, y) { stick = [x, y]; if (x || y) real = true; },
    tap() { jumpLatch = true; real = true; },
    pad(p) { pad = p ?? null; },
    blur() { held.clear(); stick = [0, 0]; mouse = [0, 0]; touchLook = [0, 0]; },
    sample(dt, viewYaw = 0) {
      if (input.pollPads) pad = input.pollPads() ?? null;
      let fwd = (doing("forward") ? 1 : 0) - (doing("back") ? 1 : 0);
      let strafe = (doing("right") ? 1 : 0) - (doing("left") ? 1 : 0);
      const inv = opt.invertY ? -1 : 1;
      let lookYaw = mouse[0] * opt.sensitivity + touchLook[0] * opt.touchSensitivity;
      let lookPitch = -(mouse[1] * opt.sensitivity + touchLook[1] * opt.touchSensitivity) * inv;
      mouse = [0, 0]; touchLook = [0, 0];
      let padJump = false;
      let padSprint = false;
      if (pad) {
        const ax = pad.axes ?? [];
        const [lx, ly] = deadzone(ax[0] ?? 0, ax[1] ?? 0, opt.deadzone);
        const [rx, ry] = deadzone(ax[2] ?? 0, ax[3] ?? 0, opt.deadzone);
        strafe += lx; fwd -= ly; // (a stick's up is -y)
        lookYaw += rx * opt.lookSpeed * dt;
        lookPitch -= ry * opt.lookSpeed * dt * inv;
        const b = pad.buttons ?? [];
        padJump = pressed(b[0]);
        padSprint = pressed(b[10]) || pressed(b[5]);
        if (padJump && !padJumpWas) jumpLatch = true;
        if (lx || ly || rx || ry || padJump) real = true;
      }
      padJumpWas = padJump;
      strafe += stick[0]; fwd += stick[1];
      const l = Math.hypot(strafe, fwd);
      if (l > 1) { strafe /= l; fwd /= l; }
      const jump = jumpLatch;
      jumpLatch = false;
      const hold = doing("jump") || padJump || jump;
      const moving = Math.abs(fwd) + Math.abs(strafe) > 0;
      const driver = arbiter.update(dt, real || moving || hold);
      real = false;
      return {
        move: moveFromView(viewYaw, fwd, strafe), axes: [strafe || 0, fwd || 0], look: [lookYaw || 0, lookPitch || 0], // (|| 0: no -0s)
        jump, hold, sprint: doing("sprint") || padSprint, driver, player: driver === "player",
      };
    },
    attach(target = globalThis as unknown as EventTargetLike, { canvas = null, lock = true, touch = true, document: doc = (globalThis as { document?: DocumentLike }).document ?? null, navigator: nav = (globalThis as { navigator?: NavigatorLike }).navigator ?? null } = {}) {
      const offs: (() => void)[] = [];
      const on = <E>(el: EventTargetLike | null | undefined, type: string, fn: (e: E) => void, how?: AddEventListenerOptions): void => {
        if (!el?.addEventListener) return;
        const f = fn as unknown as (e: Event) => void;
        el.addEventListener(type, f, how);
        offs.push(() => el.removeEventListener(type, f, how));
      };
      // (Typing in a field is not playing.)
      const editable = (e: KeyEventIn): boolean => {
        const t = e.target as { isContentEditable?: boolean; tagName?: string } | null | undefined;
        return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? "")));
      };
      on<KeyEventIn>(target, "keydown", (e) => { if (!editable(e) && input.key(e, true)) e.preventDefault(); });
      on<KeyEventIn>(target, "keyup", (e) => { if (input.key(e, false) && !editable(e)) e.preventDefault(); });
      on(target, "blur", () => input.blur());
      on(doc, "visibilitychange", () => { if (doc?.hidden) input.blur(); });
      if (nav?.getGamepads) {
        const getPads = nav.getGamepads.bind(nav);
        input.pollPads = () => { for (const p of Array.from(getPads() ?? [])) if (p?.connected) return p; return null; };
      }
      if (canvas) {
        let drag = false;
        // (Raw mouse, no acceleration, where it's offered; else a plain lock; else none -- drag to look.)
        const ask = (how?: { unadjustedMovement: boolean }): Promise<void> => {
          try {
            const r = how ? canvas.requestPointerLock?.(how) : canvas.requestPointerLock?.();
            return r && typeof (r as Promise<void>).then === "function" ? (r as Promise<void>) : Promise.resolve();
          } catch (e) { return Promise.reject(e as Error); }
        };
        const requestLock = (): void => { ask({ unadjustedMovement: true }).catch(() => ask().catch(() => {})); };
        on(canvas, "click", () => { if (lock && doc?.pointerLockElement !== canvas) requestLock(); });
        on(doc, "pointerlockchange", () => { input.locked = doc?.pointerLockElement === canvas; if (!input.locked) drag = false; });
        on<MouseEventIn>(canvas, "mousedown", (e) => { if (e.button === 0 && !input.locked) drag = true; });
        on(globalThis as unknown as EventTargetLike, "mouseup", () => { drag = false; });
        on<MouseEventIn>(doc, "mousemove", (e) => { if (input.locked || drag) input.look(e.movementX, e.movementY); });
        if (touch) {
          let moveId: number | null = null;
          let moveAt: [number, number] = [0, 0];
          let lookId: number | null = null;
          let lookAt = { x: 0, y: 0, far: 0, t: 0 };
          const opts = { passive: false };
          on<TouchEventIn>(canvas, "touchstart", (e) => {
            const r = canvas.getBoundingClientRect();
            for (const t of e.changedTouches) {
              if (t.clientX < r.left + r.width / 2 && moveId === null) { moveId = t.identifier; moveAt = [t.clientX, t.clientY]; }
              else if (lookId === null) { lookId = t.identifier; lookAt = { x: t.clientX, y: t.clientY, far: 0, t: e.timeStamp }; }
            }
            e.preventDefault();
          }, opts);
          on<TouchEventIn>(canvas, "touchmove", (e) => {
            for (const t of e.changedTouches) {
              if (t.identifier === moveId) {
                let sx = (t.clientX - moveAt[0]) / opt.touchRadius;
                let sy = -(t.clientY - moveAt[1]) / opt.touchRadius;
                const l = Math.hypot(sx, sy);
                if (l > 1) { sx /= l; sy /= l; }
                input.stick(sx, sy);
              } else if (t.identifier === lookId) {
                const dx = t.clientX - lookAt.x;
                const dy = t.clientY - lookAt.y;
                lookAt.far += Math.abs(dx) + Math.abs(dy); lookAt.x = t.clientX; lookAt.y = t.clientY;
                input.touchLook(dx, dy);
              }
            }
            e.preventDefault();
          }, opts);
          const end = (e: TouchEventIn): void => {
            for (const t of e.changedTouches) {
              if (t.identifier === moveId) { moveId = null; input.stick(0, 0); }
              else if (t.identifier === lookId) { if (lookAt.far < 12 && e.timeStamp - lookAt.t < 250) input.tap(); lookId = null; }
            }
          };
          on(canvas, "touchend", end);
          on(canvas, "touchcancel", end);
        }
      }
      return () => {
        for (const off of offs) off();
        input.pollPads = null;
        if (canvas && doc?.pointerLockElement === canvas) doc.exitPointerLock?.();
        input.locked = false;
        input.blur();
      };
    },
  };
  return input;
}
