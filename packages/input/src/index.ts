// @keel-engine/input: keyboard, mouse (pointer lock), gamepad and touch to
// per-step intents, and the arbiter that decides who is driving. Names as in
// the proof of concept's src/input/input.js.

export { GAME_KEYS, codeOf, createArbiter, createInput } from "./input.ts";
export type {
  Action, Arbiter, ArbiterOptions, AttachOptions, CanvasLike, DocumentLike, Driver, EventTargetLike, GameKeyCode, Input, InputOptions, Intent, KeyEventLike,
  KeyLike, NavigatorLike, PadButton, PadState,
} from "./input.ts";
