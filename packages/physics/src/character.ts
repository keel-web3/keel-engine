// A character's body: kinematic, stepped at a fixed rate, colliding with the
// same boxes the renderer draws -- ported from the proof of concept's
// src/physics/character.js; test/poc-equality.test.ts steps both side by side
// and proves every step identical, bit for bit, and test/golden.test.ts holds
// the proof of concept's pinned runs. Its moves are modes -- on the ground, in
// the air, running along a wall, grinding a rail, skimming the water -- each
// with the few rules that make it feel right (coyote time and a buffered jump
// on the ground; light gravity and a kick off on a wall; a rail that holds you
// and slopes you; water that holds you only while you're fast).
//
//   const body = createCharacter({ boxes, wedges, rails, waterY, spawn });
//   body.step(dt, { move: [x, z], jump: pressed, hold: held });
//   body.pos, body.vel, body.mode, body.events (landed, jumped, wallStart, ...)
//
// Wedges are ramps: a box whose top slopes (see wedgeDistance). Up to
// `slopeMax` the body stands on one and runs up and down it; steeper, it
// slides. A world without wedges steps exactly as it did before they existed
// (test/golden.test.ts pins it to the bit).

import type { Vec3, Vec3Like } from "@keel-engine/core";
import { boxDistance, nearestOnRail, wedgeDistance } from "./solids.ts";
import type { Box, Hit, Rail, Solid, Wedge } from "./solids.ts";
import { datan2, dcos, dhypot, dsin } from "@keel-engine/core";

/** The body's feel: every number a rule reads. */
export interface Tuning {
  /** m: the three collision spheres' radius. */
  readonly radius: number;
  /** m/s². */
  readonly gravity: number;
  readonly runSpeed: number;
  readonly runAccel: number;
  /** m/s² of braking on the ground with the stick let go. */
  readonly friction: number;
  readonly airAccel: number;
  /** m/s: a jump's take-off speed. */
  readonly jump: number;
  /** s: a jump just after running off an edge still counts. */
  readonly coyote: number;
  /** s: a jump pressed just before landing fires on landing. */
  readonly buffer: number;
  /** m/s: the least speed along a wall that starts a wall-run. */
  readonly wallMin: number;
  /** Gravity's share while on a wall. */
  readonly wallGravity: number;
  /** s: the longest wall-run. */
  readonly wallTime: number;
  readonly wallKick: number;
  readonly wallUp: number;
  /** m: how near a rail catches. */
  readonly railSnap: number;
  /** m: the feet ride this far over the rail. */
  readonly railLift: number;
  readonly railPush: number;
  readonly railCruise: number;
  readonly railMax: number;
  /** m/s: faster than this, water holds you. */
  readonly skimMin: number;
  readonly skimDrag: number;
  /** s sunk before coming back at the checkpoint. */
  readonly respawn: number;
  /** Degrees: a wedge up to this stands and runs; steeper slides. */
  readonly slopeMax: number;
  /** m/s: never faster than radius x 120 Hz, so nothing is fallen through. */
  readonly maxFall: number;
  /** m: off a ramp's crest the feet find the floor this far below. */
  readonly stepDown: number;
}

export const TUNING: Tuning = Object.freeze({
  radius: 0.26, gravity: 24, runSpeed: 9.5, runAccel: 48, friction: 30, airAccel: 16, jump: 8.6,
  coyote: 0.1, buffer: 0.12, wallMin: 4.5, wallGravity: 0.16, wallTime: 1.35, wallKick: 7.5, wallUp: 7.4,
  railSnap: 0.45, railLift: 0.28, railPush: 3, railCruise: 11, railMax: 14, skimMin: 6.5, skimDrag: 1.4, respawn: 0.9,
  slopeMax: 42, // (degrees: a wedge up to this stands and runs; steeper slides)
  maxFall: 30, // (m/s: never faster than radius x 120 Hz, so nothing is fallen through)
  stepDown: 0.3, // (m: off a ramp's crest the feet find the floor this far below)
});

/** What the body is doing: standing or running, flying, on a wall, on a rail, skimming the water, sinking in it. */
export type BodyMode = "ground" | "air" | "wall" | "grind" | "skim" | "sink";
export const BODY_MODES: readonly BodyMode[] = ["ground", "air", "wall", "grind", "skim", "sink"];

/** Every event's own payload, by type (each also carries `at`, where the body was). */
export interface BodyEventPayloads {
  /** `speed`: how fast it was falling. */
  landed: { speed: number };
  jumped: object;
  /** `n`: the wall's outward normal. */
  wallStart: { n: Vec3 };
  wallRunning: { n: Vec3 };
  wallEnd: object;
  wallJump: { n: Vec3 };
  railStart: object;
  /** `tan`: the way along the rail it is going. */
  grinding: { tan: Vec3 };
  railEnd: object;
  skimStart: object;
  skimming: object;
  splashIn: object;
  respawn: object;
}
export type BodyEventType = keyof BodyEventPayloads;
/** One event of a type, with its payload. */
export type BodyEventOf<K extends BodyEventType> = { type: K; at: Vec3 } & BodyEventPayloads[K];
/** An event of this step: a discriminated union on `type`. */
export type BodyEvent = { [K in BodyEventType]: BodyEventOf<K> }[BodyEventType];
export const BODY_EVENTS: readonly BodyEventType[] = [
  "landed", "jumped", "wallStart", "wallRunning", "wallEnd", "wallJump", "railStart", "grinding", "railEnd", "skimStart", "skimming", "splashIn", "respawn",
];

/**
 * One step's input. `move` is a horizontal world direction [x, z] (length <= 1;
 * camera-relative through moveFromView); `jump` the press (an edge), `hold`
 * whether it's held (let go early and the rise is cut). An input sample
 * (@keel-engine/input) is one.
 */
export interface BodyInput {
  readonly move?: readonly [number, number] | undefined;
  readonly jump?: boolean | undefined;
  readonly hold?: boolean | undefined;
}

export interface CharacterSpec {
  /** Solids: boxes, and wedges given among them (kind "wedge") -- one list feeds physics and the renderer. */
  readonly boxes?: readonly Solid[] | undefined;
  readonly wedges?: readonly Wedge[] | undefined;
  readonly rails?: readonly Rail[] | undefined;
  /** The water plane's height. */
  readonly waterY?: number | undefined;
  /** Where the feet start (and the first checkpoint). */
  readonly spawn?: Vec3Like | undefined;
  /** Overrides any of TUNING for this body. */
  readonly tuning?: Partial<Tuning> | undefined;
}

/** A body: its state is plain fields (read them, or set pos/vel to place it); step() moves it. */
export interface Character {
  /** The feet. */
  pos: Vec3;
  vel: Vec3;
  mode: BodyMode;
  /** The yaw it faces (the way it's going, once it goes faster than 0.5 m/s). */
  facing: number;
  time: number;
  /** A wall-run's wall normal (kept after the run). */
  wall: Vec3 | null;
  /** The face a wall-run started on: only it counts while running. */
  wallFace: Vec3 | null;
  wallTime: number;
  /** The rail being ground (an index into rails). */
  rail: number | null;
  railS: number;
  /** 1 along the rail's points, -1 against them. */
  railDir: number;
  coyote: number;
  buffer: number;
  sinking: number;
  /** Where it comes back after sinking: where it last stood, 0.2 m up. */
  checkpoint: Vec3;
  /** What happened this step (cleared by the next). */
  events: BodyEvent[];
  /** Standing on a wedge: its normal. */
  slope: Vec3 | null;
  /** One fixed step. Returns the body. */
  step(dt: number, input: BodyInput): Character;
}

const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3Like): number => dhypot(a[0], a[1], a[2]);

interface Beside { d: number; n: Vec3; b: Box }

export function createCharacter({ boxes: boxesIn = [], wedges: wedgesIn = [], rails = [], waterY = 0, spawn = [0, 1, 0], tuning = {} }: CharacterSpec): Character {
  const K: Tuning = { ...TUNING, ...tuning };
  // (A box with kind "wedge" is a wedge -- the renderer's setWorld reads it the same way. A list with none is kept as given.)
  let boxes = boxesIn as readonly Box[];
  let wedges: readonly Wedge[] = wedgesIn;
  if (boxesIn.some((b) => b.kind === "wedge")) {
    wedges = [...wedgesIn, ...boxesIn.filter((b): b is Wedge => b.kind === "wedge")];
    boxes = boxesIn.filter((b) => b.kind !== "wedge") as Box[];
  }
  const walkable = dcos((K.slopeMax * Math.PI) / 180);
  const body: Character = {
    pos: [spawn[0], spawn[1], spawn[2]], vel: [0, 0, 0], mode: "air", facing: 0, time: 0,
    wall: null, wallFace: null, wallTime: 0, rail: null, railS: 0, railDir: 1, coyote: 0, buffer: 0, sinking: 0,
    checkpoint: [spawn[0], spawn[1], spawn[2]], events: [], slope: null,
    step: (dt, input) => step(dt, input),
  };
  const emit = <E extends BodyEventType>(type: E, ...extra: object extends BodyEventPayloads[E] ? [] : [BodyEventPayloads[E]]): void => {
    body.events.push({ type, at: [body.pos[0], body.pos[1], body.pos[2]], ...extra[0] } as BodyEvent);
  };

  // Push the body's spheres out of every box; report what it stands on and what it leans on.
  function collide(): { ground: Vec3 | null; side: Vec3 | null; sideBox: Box | null; slope: Vec3 | null } {
    let ground: Vec3 | null = null;
    let side: Vec3 | null = null;
    let sideBox: Box | null = null;
    let slope: Vec3 | null = null;
    for (const h of [K.radius, 0.56, 0.86]) {
      for (const b of boxes) {
        const c: Vec3 = [body.pos[0], body.pos[1] + h, body.pos[2]];
        const { d, n } = boxDistance(c, b);
        if (d < K.radius) {
          const push = K.radius - d;
          body.pos[0] += n[0] * push; body.pos[1] += n[1] * push; body.pos[2] += n[2] * push;
          const vn = dot(body.vel, n);
          if (vn < 0) { body.vel[0] -= n[0] * vn; body.vel[1] -= n[1] * vn; body.vel[2] -= n[2] * vn; }
          if (n[1] > 0.65 && h === K.radius) ground = n;
          else if (Math.abs(n[1]) < 0.35) { side = n; sideBox = b; }
        } else if (h === K.radius && d < K.radius + 0.06 && n[1] > 0.65 && body.vel[1] <= 0.5) ground = n;
      }
      // Wedges: a walkable slope is stood on -- pushed out straight up and moved along it, not down it -- and a
      // steeper one pushes out along its normal, so the body slides. (Their sides aren't run on: not walls.)
      for (const w of wedges) {
        const c: Vec3 = [body.pos[0], body.pos[1] + h, body.pos[2]];
        const { d, n } = wedgeDistance(c, w);
        const stand = h === K.radius && n[1] > walkable;
        if (d < K.radius) {
          const push = K.radius - d;
          if (stand) body.pos[1] += push / n[1];
          else { body.pos[0] += n[0] * push; body.pos[1] += n[1] * push; body.pos[2] += n[2] * push; }
          const vn = dot(body.vel, n);
          if (vn < 0) {
            if (stand) body.vel[1] = -(n[0] * body.vel[0] + n[2] * body.vel[2]) / n[1]; // (along the slope, the run kept)
            else { body.vel[0] -= n[0] * vn; body.vel[1] -= n[1] * vn; body.vel[2] -= n[2] * vn; }
          }
          if (stand) { ground = n; slope = n; }
        } else if (stand && d < K.radius + 0.06 && dot(body.vel, n) <= 0.5) { ground = n; slope = n; }
      }
    }
    return { ground, side, sideBox, slope: slope && ground === slope ? slope : null };
  }
  // The ground just below the feet (within stepDown), for staying on them over a ramp's crest.
  function groundBelow(): { drop: number; n: Vec3; wedge: boolean } | null {
    const c: Vec3 = [body.pos[0], body.pos[1] + K.radius, body.pos[2]];
    let best: { drop: number; n: Vec3; wedge: boolean } | null = null;
    const look = (list: readonly (Box | Wedge)[], wedge: boolean): void => {
      for (const b of list) {
        const { d, n }: Hit = wedge ? wedgeDistance(c, b) : boxDistance(c, b);
        if (n[1] <= (wedge ? walkable : 0.65) || d < K.radius) continue;
        const drop = (d - K.radius) / n[1];
        if (drop < K.stepDown && (!best || drop < best.drop)) best = { drop, n, wedge };
      }
    };
    look(boxes, false);
    look(wedges, true);
    return best;
  }
  // A wall to run on: one that rises past the head (a floor's edge is a step), met on a face (not round an edge or an end).
  const runnable = (n: Vec3Like, b: Box): boolean => {
    if (b.c[1] + b.h[1] < body.pos[1] + 1.1) return false;
    const c = dcos(b.yaw ?? 0);
    const s = dsin(b.yaw ?? 0);
    return Math.abs(n[0] * c - n[2] * s) > 0.99 || Math.abs(n[0] * s + n[2] * c) > 0.99;
  };
  // A wall beside the body, within reach of its middle.
  // (Running along one: only the same face counts -- past a thin wall's end the nearest point turns round
  // its corner, and following it would wrap the run onto the far side.)
  function wallBeside(face: Vec3Like | null = null): Beside | null {
    const c: Vec3 = [body.pos[0], body.pos[1] + 0.56, body.pos[2]];
    let best: Beside | null = null;
    for (const b of boxes) {
      const { d, n } = boxDistance(c, b);
      if (face && dot(n, face) < 0.99) continue;
      if (b.c[1] + b.h[1] < body.pos[1] + 1.1) continue; // (a wall rises past the head; a floor's edge is a step, not a wall)
      if (d < K.radius + 0.42 && Math.abs(n[1]) < 0.3 && (!best || d < best.d)) best = { d, n, b };
    }
    return best;
  }

  function step(dt: number, input: BodyInput): Character {
    body.events.length = 0;
    body.time += dt;
    const move = input.move ?? [0, 0];
    const mlen = Math.min(1, dhypot(move[0], move[1]));
    const wish: Vec3 | null = mlen > 0.05 ? [move[0] / dhypot(move[0], move[1]), 0, move[1] / dhypot(move[0], move[1])] : null;
    if (input.jump) body.buffer = K.buffer; else body.buffer = Math.max(0, body.buffer - dt);
    const hv: Vec3 = [body.vel[0], 0, body.vel[2]];
    const hs = len(hv);

    if (body.mode === "sink") {
      body.sinking += dt;
      body.vel = [body.vel[0] * 0.9, -1.2, body.vel[2] * 0.9];
      body.pos[1] += body.vel[1] * dt;
      if (body.sinking > K.respawn) { body.pos = [...body.checkpoint]; body.vel = [0, 0, 0]; body.mode = "air"; body.sinking = 0; emit("respawn"); }
      return body;
    }

    if (body.mode === "grind") {
      const rail = rails[body.rail!]!;
      // (A rail of fewer than two points is never caught, so there is always a nearest point here.)
      const at = nearestOnRail([body.pos[0], body.pos[1] - K.railLift, body.pos[2]], rail)!;
      const tan: Vec3 = [at.tan[0] * body.railDir, at.tan[1] * body.railDir, at.tan[2] * body.railDir];
      // (Downhill speeds it, uphill slows it, and it settles toward a rail's cruise -- never a fling.)
      let speed = dot(body.vel, tan) - K.gravity * tan[1] * dt * 0.8;
      speed += (K.railCruise - speed) * Math.min(1, 1.5 * dt);
      speed = Math.min(K.railMax, Math.max(4, speed));
      body.vel = [tan[0] * speed, tan[1] * speed, tan[2] * speed];
      body.pos = [at.q[0] + body.vel[0] * dt, at.q[1] + K.railLift + body.vel[1] * dt, at.q[2] + body.vel[2] * dt];
      emit("grinding", { tan });
      const end = (body.railDir > 0 && at.i === rail.length - 2 && at.t > 0.98) || (body.railDir < 0 && at.i === 0 && at.t < 0.02);
      if (body.buffer > 0) { body.vel[1] = K.jump; body.mode = "air"; body.buffer = 0; body.coyote = 0; emit("jumped"); }
      else if (end) { body.mode = "air"; body.vel[1] += 2; emit("railEnd"); }
      body.facing = datan2(body.vel[0], body.vel[2]);
      return body;
    }

    if (body.mode === "wall") {
      const w = wallBeside(body.wallFace);
      body.wallTime += dt;
      if (!w || body.wallTime > K.wallTime || hs < K.wallMin * 0.6) { body.mode = "air"; emit("wallEnd"); }
      else {
        const n = w.n;
        // Along the wall, the way it was going; a little into it so it holds; hardly any gravity.
        const along: Vec3 = [hv[0] - n[0] * dot(hv, n), 0, hv[2] - n[2] * dot(hv, n)];
        const al = len(along) || 1;
        const sp = Math.max(K.wallMin + 1, al);
        body.vel[0] = (along[0] / al) * sp - n[0] * 0.8;
        body.vel[2] = (along[2] / al) * sp - n[2] * 0.8;
        body.vel[1] -= K.gravity * K.wallGravity * dt;
        body.wall = n;
        emit("wallRunning", { n });
        if (body.buffer > 0) {
          body.vel = [body.vel[0] * 0.9 + n[0] * K.wallKick, K.wallUp, body.vel[2] * 0.9 + n[2] * K.wallKick];
          body.mode = "air"; body.buffer = 0; emit("wallJump", { n });
        }
      }
    }

    // (Read through a function: the step's own mode changes above are not narrowed away.)
    const mode = (): BodyMode => body.mode;
    if (mode() === "ground" || mode() === "air" || mode() === "skim") {
      const onGround = mode() === "ground";
      const accel = onGround ? K.runAccel : mode() === "skim" ? K.runAccel * 0.4 : K.airAccel;
      if (wish) {
        const target = [wish[0] * K.runSpeed * mlen, wish[2] * K.runSpeed * mlen] as const;
        const dx = target[0] - body.vel[0];
        const dz = target[1] - body.vel[2];
        const dl = dhypot(dx, dz);
        const stepA = Math.min(dl, accel * dt);
        // (In the air, don't brake what the run carried: only add toward where it's steered.)
        if (onGround || dl > 0) { body.vel[0] += (dx / (dl || 1)) * stepA; body.vel[2] += (dz / (dl || 1)) * stepA; }
      } else if (onGround) {
        const f = Math.max(0, hs - K.friction * dt) / (hs || 1);
        body.vel[0] *= f; body.vel[2] *= f;
      }
      if (mode() === "skim") {
        const f = Math.max(0, hs - K.skimDrag * dt) / (hs || 1);
        body.vel[0] *= f; body.vel[2] *= f;
        body.vel[1] = 0;
        body.pos[1] = waterY;
        emit("skimming");
        if (hs < K.skimMin * 0.9) { body.mode = "sink"; emit("splashIn"); return body; }
        if (body.buffer > 0) { body.vel[1] = K.jump * 0.9; body.mode = "air"; body.buffer = 0; emit("jumped"); }
      } else {
        if (onGround && body.slope) {
          // (On a ramp: along it, at the run's speed -- up it, down it, never sliding off it while stood on.)
          const n = body.slope;
          body.vel[1] = -(n[0] * body.vel[0] + n[2] * body.vel[2]) / n[1];
        } else body.vel[1] = Math.max(body.vel[1] - K.gravity * dt, -K.maxFall);
        if (body.coyote > 0 && body.buffer > 0) { body.vel[1] = K.jump; body.mode = "air"; body.coyote = 0; body.buffer = 0; emit("jumped"); }
        // Short hops: let go of jump early and the rise is cut.
        if (mode() === "air" && body.vel[1] > 0 && !input.hold) body.vel[1] -= K.gravity * 1.4 * dt;
      }
    }

    // Move, then push out.
    body.pos[0] += body.vel[0] * dt; body.pos[1] += body.vel[1] * dt; body.pos[2] += body.vel[2] * dt;
    const hit = collide();
    let { ground, slope } = hit;
    const { side, sideBox } = hit;
    // Over a ramp's crest either way (off its top, or off a floor onto it), stay on the feet: step down onto
    // what's just below. (Only to or from a wedge -- a world of boxes never takes this path.)
    if (!ground && wedges.length && mode() === "ground" && !body.events.some((e) => e.type === "jumped")) {
      const below = groundBelow();
      if (below && (body.slope || below.wedge)) {
        body.pos[1] -= below.drop; ground = below.n; slope = below.wedge ? below.n : null;
        body.vel[1] = slope ? -(slope[0] * body.vel[0] + slope[2] * body.vel[2]) / slope[1] : 0;
      }
    }
    body.slope = slope; // (standing on a wedge: its normal)
    const wasAir = mode() === "air";
    if (mode() !== "wall" && mode() !== "skim") {
      if (ground) {
        if (wasAir) emit("landed", { speed: -body.vel[1] });
        body.mode = "ground"; body.coyote = K.coyote; body.checkpoint = [body.pos[0], body.pos[1] + 0.2, body.pos[2]];
        if (body.vel[1] < 0 && !slope) body.vel[1] = 0;
      } else {
        if (mode() === "ground") body.mode = "air";
        body.coyote = Math.max(0, body.coyote - dt);
      }
    }
    // Catch a wall: in the air, fast, going along it rather than into it.
    if (mode() === "air" && hs > K.wallMin && body.vel[1] < 4) {
      const w = side && sideBox ? { n: side, b: sideBox } : wallBeside();
      if (w && Math.abs(dot(hv, w.n)) < hs * 0.75 && runnable(w.n, w.b)) {
        body.mode = "wall"; body.wallTime = 0; body.wall = w.n; body.wallFace = w.n; body.vel[1] = Math.max(body.vel[1], 1.2);
        emit("wallStart", { n: w.n });
      }
    }
    // Catch a rail: falling onto it.
    if (mode() === "air" && body.vel[1] <= 0.5) {
      for (let i = 0; i < rails.length; i += 1) {
        if (mode() !== "air") continue;
        const rail = rails[i]!;
        const at = nearestOnRail([body.pos[0], body.pos[1] - 0.05, body.pos[2]], rail);
        if (at && at.d < K.railSnap) {
          const dir = dot(body.vel, at.tan) >= 0 ? 1 : -1;
          // (Not where it would end at once: off a rail's end it would catch, end, fall and catch again, for ever.)
          if ((dir > 0 && at.i === rail.length - 2 && at.t > 0.98) || (dir < 0 && at.i === 0 && at.t < 0.02)) continue;
          body.mode = "grind"; body.rail = i;
          body.railDir = dir;
          // (Pushed on, but never past the rail's cap: a fall onto a rail isn't a launch.)
          const sp = Math.min(K.railMax, Math.max(Math.abs(dot(body.vel, at.tan)), hs, 6) + K.railPush);
          body.vel = [at.tan[0] * body.railDir * sp, at.tan[1] * body.railDir * sp, at.tan[2] * body.railDir * sp];
          emit("railStart");
        }
      }
    }
    // Water: fast enough, it holds you; otherwise in you go.
    if ((mode() === "air" || mode() === "ground") && body.pos[1] <= waterY && body.vel[1] <= 0) {
      if (hs >= K.skimMin) { body.mode = "skim"; body.pos[1] = waterY; body.vel[1] = 0; emit("skimStart"); }
      else { body.mode = "sink"; body.sinking = 0; emit("splashIn"); }
    }
    if (hs > 0.5) body.facing = datan2(body.vel[0], body.vel[2]);
    return body;
  }
  return body;
}
