// ai/herd: animals that keep together -- boids (separation, alignment,
// cohesion), a leader the rest follow, and flight from a threat that spreads
// through the herd. Provides ai/animal@1.0.0; bound to bodies by contract (it
// needs contract:body/quadruped@^1 and reads only what that contract
// promises: socket sizes). Pure functions and createBrain(seed, params); no
// drawing.

import type { ModuleContext } from "@keel-engine/runtime";
import type { AnimalAi } from "./contract.ts";
import { DEFAULTS, MODULE, createBrain, paramsFor } from "./herd.ts";
import type { HerdParams } from "./herd.ts";

export type { Agent, AnimalAi, AnimalMode, Brain, BrainSave, Neighbour, Obstacle, SocketSizes, Vec3, WorldQuery } from "./contract.ts";
export { DEFAULTS, MODULE, createBrain, paramsFor, stepHerd } from "./herd.ts";
export type { HerdMemory, HerdParams } from "./herd.ts";
export { add, along, avoid, contain, drawer, flat, integrate, len, limit, mul, sub, turn, unit, wrap, yawOf } from "./steer.ts";
export type { Motion, V2 } from "./steer.ts";

/** The ai/animal@1.0.0 face of this module (its exports carry the same fields, so the module itself keeps the contract). */
export const ai: AnimalAi<HerdParams> = Object.freeze({ contract: "ai/animal@1.0.0", id: MODULE, social: true, defaults: DEFAULTS, createBrain, paramsFor });
export const contract = ai.contract;
export const id = ai.id;
export const social = ai.social;
export const defaults = ai.defaults;

let packs: string[] = [];
/** On a page: the body/quadruped packs it can drive (the registry resolved them by contract). */
export function setup(ctx: ModuleContext): void {
  packs = ctx.providers("body/quadruped").map((p) => `${p.manifest.id}@${p.manifest.version}`);
}
/** The packs whose bodies this brain was bound to on this page. */
export const drives = (): readonly string[] => packs;
