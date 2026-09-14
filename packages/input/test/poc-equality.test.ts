// The TypeScript input against the JavaScript proof of concept it was ported
// from (src/input/input.js, imported from its repo, never written to): the
// same scripted event sequences -- keys by name, code and event (with
// modifiers, repeats and shortcuts), mouse, touch, sticks, taps, gamepads,
// blur, and through attach() the DOM-shaped events -- into both, and every
// sample compared to the bit, over many seeds.

import { test } from "node:test";
import * as tIn from "../src/input.ts";
import type { Input, InputOptions, KeyLike, PadState } from "../src/input.ts";
import { POC, counter, hasPoc, poc, rand } from "./reference.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
const J = hasPoc ? await poc<typeof tIn>("src/input/input.js") : (null as unknown as typeof tIn);
const { same, exact, summary } = counter();

const NAMES = ["w", "a", "s", "d", "W", " ", "space", "Spacebar", "Shift", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "up", "left", "KeyW", "KeyD", "ShiftRight",
  "Meta", "Control", "Alt", "AltGraph", "CapsLock", "OSLeft", "q", "Tab", "Escape", "F5", "Enter", ""];
const CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ArrowUp", "ArrowRight", "MetaLeft", "ControlRight", "AltLeft", "KeyQ", "KeyZ", ""];

// One scripted event, the same for both inputs.
type Act = (i: Input) => void;
function actOf(r: () => number): Act {
  const k = r();
  const pickOf = <T>(l: readonly T[]): T => l[Math.floor(r() * l.length)]!;
  if (k < 0.3) {
    const down = r() < 0.6;
    const key: KeyLike = r() < 0.5 ? pickOf(NAMES) : { key: pickOf(NAMES), code: pickOf(CODES), metaKey: r() < 0.1, ctrlKey: r() < 0.1, altKey: r() < 0.05, shiftKey: r() < 0.2, repeat: r() < 0.2 };
    return (i) => { i.key(key, down); };
  }
  if (k < 0.45) { const dx = r() < 0.1 ? (r() - 0.5) * 5000 : Math.round((r() - 0.5) * 60); const dy = r() < 0.3 ? 0 : Math.round((r() - 0.5) * 60); return (i) => i.look(dx, dy); }
  if (k < 0.52) { const dx = (r() - 0.5) * 30; const dy = (r() - 0.5) * 30; return (i) => i.touchLook(dx, dy); }
  if (k < 0.6) { const x = r() < 0.3 ? 0 : r() * 2 - 1; const y = r() < 0.3 ? 0 : r() * 2 - 1; return (i) => i.stick(x, y); }
  if (k < 0.64) return (i) => i.tap();
  if (k < 0.8) {
    if (r() < 0.1) return (i) => i.pad(null);
    const axes = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1].map((v) => (r() < 0.3 ? v * 0.2 : v));
    const buttons: tIn.PadButton[] = Array.from({ length: 12 }, () => (r() < 0.5 ? r() : { pressed: r() < 0.3 }));
    const p: PadState = r() < 0.1 ? {} : { axes, buttons };
    return (i) => i.pad(p);
  }
  if (k < 0.83) return (i) => i.blur();
  return () => {}; // (nothing this time)
}

function sameIntent(a: tIn.Intent, b: tIn.Intent, msg: string): void {
  for (const k of ["move", "axes", "look"] as const) { exact(`intent ${k}`, a[k][0], b[k][0], `${msg} ${k}[0]`); exact(`intent ${k}`, a[k][1], b[k][1], `${msg} ${k}[1]`); }
  same("intent flags", [a.jump, a.hold, a.sprint, a.driver, a.player], [b.jump, b.hold, b.sprint, b.driver, b.player], msg);
  same("intent keys", Object.keys(a).sort(), Object.keys(b).sort(), msg);
}

test("codeOf, GAME_KEYS and the arbiter", { skip }, () => {
  same("GAME_KEYS", { ...tIn.GAME_KEYS }, { ...J.GAME_KEYS });
  const r = rand(3);
  for (const n of [...NAMES, ...CODES, "SPACE", "arrowup", "Right"]) {
    same("codeOf", tIn.codeOf(n), J.codeOf(n));
    for (const c of CODES) same("codeOf", tIn.codeOf({ key: n, code: c }), J.codeOf({ key: n, code: c }));
  }
  for (let seed = 1; seed <= 50; seed += 1) {
    const idle = [0.5, 2, 6, Infinity][seed % 4]!;
    const a = tIn.createArbiter({ idle, start: seed % 3 ? "autopilot" : "player" });
    const b = J.createArbiter({ idle, start: seed % 3 ? "autopilot" : "player" });
    for (let i = 0; i < 2000; i += 1) {
      const real = r() < (i % 500 < 250 ? 0.3 : 0.001);
      if (r() < 0.002) { a.takeOver(); b.takeOver(); }
      if (r() < 0.002) { a.giveBack(); b.giveBack(); }
      same("arbiter", a.update(1 / 120, real), b.update(1 / 120, real));
      exact("arbiter", a.idleFor, b.idleFor);
    }
  }
});

test("samples: scripted event sequences, 200 seeds x 600 steps, every sample to the bit", { skip }, () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const r = rand(seed);
    const opts: InputOptions = seed % 2 ? {} : { sensitivity: 0.001 + r() * 0.01, invertY: r() < 0.5, lookSpeed: 1 + r() * 3, deadzone: r() * 0.4, idle: 0.5 + r() * 4, touchSensitivity: r() * 0.02, maxMouse: 50 + r() * 300 };
    const a = tIn.createInput(opts);
    const b = J.createInput(opts);
    same("options", a.opt, b.opt);
    let yaw = r() * 6 - 3;
    for (let step = 0; step < 600; step += 1) {
      const n = Math.floor(r() * 4);
      for (let e = 0; e < n; e += 1) { const act = actOf(r); act(a); act(b); }
      yaw += (r() - 0.5) * 0.1;
      const dt = r() < 0.9 ? 1 / 120 : r() * 0.05;
      sameIntent(a.sample(dt, yaw), b.sample(dt, yaw), `seed ${seed} step ${step}`);
      same("driver", [a.driver, a.player], [b.driver, b.player]);
    }
  }
});

test("attach: the same DOM-shaped events into both (keys, lock, mouse, touch, pads, blur, visibility), every sample to the bit", { skip }, () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const r = rand(seed * 13);
    const world = () => {
      const win = new EventTarget();
      const doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown, hidden: false, exitPointerLock(): void { doc.pointerLockElement = null; } });
      const canvas = Object.assign(new EventTarget(), {
        requestPointerLock: (): Promise<void> => { doc.pointerLockElement = canvas; doc.dispatchEvent(new Event("pointerlockchange")); return Promise.resolve(); },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
      });
      const pads: (PadState | null)[] = [null, null];
      return { win, doc, canvas, pads };
    };
    const A = world();
    const B = world();
    const a = tIn.createInput();
    const b = J.createInput();
    const offA = a.attach(A.win, { canvas: A.canvas, document: A.doc, navigator: { getGamepads: () => A.pads } });
    const offB = b.attach(B.win, { canvas: B.canvas, document: B.doc, navigator: { getGamepads: () => B.pads } });
    const fire = (type: string, props: Record<string, unknown>, where: "win" | "doc" | "canvas", time: number): void => {
      for (const W of [A, B]) {
        const e = Object.assign(new Event(type, { cancelable: true }), props);
        Object.defineProperty(e, "timeStamp", { value: time });
        W[where].dispatchEvent(e);
      }
    };
    let time = 0;
    for (let step = 0; step < 400; step += 1) {
      time += 1000 / 120;
      const n = Math.floor(r() * 3);
      for (let e = 0; e < n; e += 1) {
        const k = r();
        const touches = (): { identifier: number; clientX: number; clientY: number }[] => Array.from({ length: 1 + Math.floor(r() * 2) }, () => ({ identifier: Math.floor(r() * 3), clientX: r() * 200, clientY: r() * 100 }));
        if (k < 0.35) fire(r() < 0.6 ? "keydown" : "keyup", { code: CODES[Math.floor(r() * CODES.length)], key: NAMES[Math.floor(r() * NAMES.length)], metaKey: r() < 0.1 }, "win", time);
        else if (k < 0.45) fire("click", {}, "canvas", time);
        else if (k < 0.5) fire("mousedown", { button: r() < 0.8 ? 0 : 2 }, "canvas", time);
        else if (k < 0.55) fire("mouseup", {}, "win", time);
        else if (k < 0.7) fire("mousemove", { movementX: Math.round((r() - 0.5) * 40), movementY: Math.round((r() - 0.5) * 40) }, "doc", time);
        else if (k < 0.85) fire(["touchstart", "touchmove", "touchend", "touchcancel"][Math.floor(r() * 4)]!, { changedTouches: touches() }, "canvas", time);
        else if (k < 0.9) { const p: PadState | null = r() < 0.5 ? null : { connected: r() < 0.8, axes: [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1], buttons: [r() < 0.4 ? 1 : 0] }; A.pads[1] = p; B.pads[1] = p; }
        else if (k < 0.93) { fire("blur", {}, "win", time); }
        else if (k < 0.96) { A.doc.hidden = B.doc.hidden = r() < 0.5; fire("visibilitychange", {}, "doc", time); }
        else { A.doc.pointerLockElement = null; B.doc.pointerLockElement = null; fire("pointerlockchange", {}, "doc", time); }
      }
      same("locked", a.locked, b.locked);
      sameIntent(a.sample(1 / 120, step * 0.01), b.sample(1 / 120, step * 0.01), `attach seed ${seed} step ${step}`);
    }
    offA();
    offB();
    same("detached", [a.locked, A.doc.pointerLockElement], [b.locked, B.doc.pointerLockElement === B.canvas ? A.canvas : B.doc.pointerLockElement]);
    sameIntent(a.sample(1 / 120, 0), b.sample(1 / 120, 0), `attach seed ${seed} after detach`);
  }
  console.log(summary("input equality (TS vs the proof of concept)"));
});
