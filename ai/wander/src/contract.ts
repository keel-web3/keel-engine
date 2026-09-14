// The ai/animal@1.0.0 contract: what an animal brain promises, whichever
// module provides it (ai/wander, ai/herd). A brain steers ONE agent on the
// ground plane on a fixed step, from a seed; it never draws.
//
//   const brain = ai.createBrain(seed, ai.paramsFor(sockets));   // sockets: a body/quadruped entity's
//   every tick:  next = brain.step(agent, world)                   // each agent against the same snapshot
//
// The agent's state is plain data -- { id, pos, vel, facing, mode } -- in the
// core frame: +z front, +x right, +y up; yaw = atan2(dx, dz), so `facing` is
// what a physics body and keel/entity's animator read. The AI moves x and z
// only (y is carried through). `mode` says what it's doing; a game maps it to
// clips (idle -> idle, walk/run/flee -> move at its speed, sit -> hold "sit").
// A brain's memory (timers, headings, how many random draws it has made)
// saves to JSON and loads back bit-identical.
//
// (This file is the same in ai/wander and ai/herd -- a contract's types want a
// home of their own; see the README.)

export type Vec3 = [number, number, number];
export type AnimalMode = "idle" | "walk" | "run" | "sit" | "flee";

export interface Agent {
  readonly id: string;
  readonly pos: Vec3;
  readonly vel: Vec3;
  /** Yaw: atan2(dx, dz). */
  readonly facing: number;
  readonly mode: AnimalMode;
}

/** Another agent, as the world reports it. */
export interface Neighbour {
  readonly id: string;
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly mode?: AnimalMode;
  /** A herd's leader (followers steer after it). */
  readonly leader?: boolean;
}

/** Something to keep clear of: a disc on the ground. */
export interface Obstacle {
  readonly pos: Vec3;
  readonly r: number;
}

/** The world a brain can ask about. */
export interface WorldQuery {
  /** Agents within r of pos (the asking agent may be among them: brains skip their own id). */
  neighbours(pos: Vec3, r: number): readonly Neighbour[];
  readonly obstacles: readonly Obstacle[];
  /** The pen: [minX, minZ, maxX, maxZ]. */
  readonly bounds?: readonly [number, number, number, number];
  /** Something to run from (a predator, the player), or none. */
  readonly threat?: Vec3 | null;
}

/** A brain's saved memory: JSON-safe. */
export interface BrainSave {
  readonly schema: "keel-ai-animal@1";
  readonly module: string;
  readonly seed: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly memory: Readonly<Record<string, unknown>>;
}

export interface Brain<P> {
  readonly seed: string;
  readonly params: Readonly<P>;
  /** Advance one fixed step (params.dt seconds): the agent's next state. */
  step(agent: Agent, world: WorldQuery): Agent;
  save(): BrainSave;
  load(save: BrainSave): Brain<P>;
}

/** Body sockets as a body contract promises them (only their sizes are read). */
export type SocketSizes = Readonly<Record<string, { readonly size: readonly [number, number, number] }>>;

/** What a module providing ai/animal@1.0.0 hands out. */
export interface AnimalAi<P> {
  readonly contract: "ai/animal@1.0.0";
  /** The module providing it: "ai/wander", "ai/herd". */
  readonly id: string;
  /** Solo animals or a herd (a game picks by it). */
  readonly social: boolean;
  readonly defaults: Readonly<P>;
  createBrain(seed: string, params?: Partial<P>): Brain<P>;
  /** Speeds and ranges scaled to a body, from its contract's sockets: a mouse potters, a bear strides. */
  paramsFor(sockets: SocketSizes): Partial<P>;
}
