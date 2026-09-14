// Sample documents the tests and the size table share: a guard's script (the
// kind of thing the blocks editor makes), and WALLRUN's sound settings.

import type { Script, SfxSettings } from "../src/index.ts";

const n = (value: number) => ({ op: "num", value }) as const;
const v = (name: string) => ({ op: "var", name }) as const;
const txt = (value: string) => ({ op: "text", value }) as const;
const sense = (name: string, ...args: object[]) => ({ op: "sense", name, args }) as never;

/** A guard: patrols, spots the player, chases and shoots in bursts, takes hits, dies, respawns. */
export const GUARD_SCRIPT: Script = {
  name: "guard",
  vars: [
    { name: "hp", init: 10 }, { name: "ammo", init: 12 }, { name: "state", init: "patrol" }, { name: "leg", init: 0 },
    { name: "alert", init: false }, { name: "burst", init: 3 }, { name: "speed", init: 2.5 },
  ],
  handlers: [
    { on: "start", body: [
      { op: "set", name: "hp", value: n(10) },
      { op: "set", name: "state", value: txt("patrol") },
      { op: "do", action: "play", args: [txt("idle")] },
    ] },
    { on: "tick", body: [
      { op: "if", cond: { op: "compare", fn: "==", a: v("state"), b: txt("patrol") }, then: [
        { op: "do", action: "moveTo", args: [sense("waypoint", v("leg")), v("speed")] },
        { op: "if", cond: { op: "compare", fn: "<", a: sense("distanceTo", sense("waypoint", v("leg"))), b: n(0.5) }, then: [
          { op: "change", name: "leg", by: n(1) },
          { op: "if", cond: { op: "compare", fn: ">=", a: v("leg"), b: sense("waypoints") }, then: [{ op: "set", name: "leg", value: n(0) }], else: [] },
          { op: "wait", seconds: { op: "random", lo: n(0.5), hi: n(2) } },
        ], else: [] },
        { op: "if", cond: { op: "logic", fn: "and", a: { op: "compare", fn: "<", a: sense("distanceTo", sense("player")), b: n(12) }, b: sense("canSee", sense("player")) }, then: [
          { op: "set", name: "state", value: txt("chase") },
          { op: "set", name: "alert", value: { op: "flag", value: true } },
          { op: "send", message: "spotted" },
          { op: "do", action: "play", args: [txt("alarm")] },
        ], else: [] },
      ], else: [
        { op: "do", action: "face", args: [sense("player")] },
        { op: "if", cond: { op: "compare", fn: ">", a: sense("distanceTo", sense("player")), b: n(6) }, then: [
          { op: "do", action: "moveTo", args: [sense("player"), { op: "arith", fn: "*", a: v("speed"), b: n(1.6) }] },
        ], else: [
          { op: "repeat", times: { op: "arith", fn: "min", a: v("burst"), b: v("ammo") }, body: [
            { op: "do", action: "shoot", args: [sense("player")] },
            { op: "change", name: "ammo", by: n(-1) },
            { op: "wait", seconds: n(0.15) },
          ] },
          { op: "if", cond: { op: "compare", fn: "<=", a: v("ammo"), b: n(0) }, then: [
            { op: "do", action: "play", args: [txt("reload")] },
            { op: "wait", seconds: n(1.8) },
            { op: "set", name: "ammo", value: n(12) },
          ], else: [{ op: "wait", seconds: { op: "random", lo: n(0.4), hi: n(1.1) } }] },
        ] },
        { op: "if", cond: { op: "compare", fn: ">", a: sense("distanceTo", sense("player")), b: n(30) }, then: [
          { op: "set", name: "state", value: txt("patrol") },
          { op: "set", name: "alert", value: { op: "flag", value: false } },
        ], else: [] },
      ] },
    ] },
    { on: "hit", body: [
      { op: "change", name: "hp", by: { op: "arith", fn: "-", a: n(0), b: sense("damage") } },
      { op: "do", action: "flash", args: [txt("white"), n(0.1)] },
      { op: "if", cond: { op: "compare", fn: "<=", a: v("hp"), b: n(0) }, then: [
        { op: "do", action: "play", args: [txt("die")] },
        { op: "do", action: "emit", args: [txt("blood-splat"), n(24)] },
        { op: "send", message: "guardDown" },
        { op: "wait", seconds: n(5) },
        { op: "do", action: "respawn", args: [] },
        { op: "set", name: "hp", value: n(10) },
        { op: "stop" },
      ], else: [
        { op: "set", name: "state", value: txt("chase") },
      ] },
    ] },
    { on: "message", arg: "spotted", body: [
      { op: "if", cond: { op: "not", a: v("alert") }, then: [
        { op: "set", name: "alert", value: { op: "flag", value: true } },
        { op: "while", cond: { op: "compare", fn: ">", a: sense("distanceTo", sense("player")), b: n(8) }, body: [
          { op: "do", action: "moveTo", args: [sense("player"), v("speed")] },
          { op: "wait", seconds: n(0.25) },
        ] },
        { op: "set", name: "state", value: txt("chase") },
      ], else: [] },
    ] },
  ],
};

/** WALLRUN's sound effects: its seed, a lofi palette with a heavier shoe, what the course's materials sound like. */
export const WALLRUN_SFX: SfxSettings = {
  seed: "wallrun",
  style: { name: "lofi", shoe: "boot", bright: 0.5 },
  volume: 0.8,
  body: {
    wind: true, gain: 1,
    surfaces: { wall: "stone", floor: "stone", rail: "metal", metal: "metal", water: "water", wood: "stone" },
    events: { jumped: "jump", wallStart: "wallStart", wallJump: "wallJump", railStart: "railStart", railEnd: "railEnd", skimStart: "skimStart", splashIn: "splash", respawn: "respawn" },
  },
  sounds: { step: { gain: 0.9, jitter: 0.08 }, land: { gain: 1.1 }, grind: { rate: 1.05 }, wind: { gain: 0.6, pan: 0 } },
};
