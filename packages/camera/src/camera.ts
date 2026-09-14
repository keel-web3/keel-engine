// Cameras: where the picture is taken from -- ported from the proof of
// concept's src/camera/camera.js; test/poc-equality.test.ts proves every rig,
// every mode and every blend identical, bit for bit, in worlds of boxes. A
// camera is { eye, target, fov, yaw, pitch } and a rig that moves it:
//
//   orbit  the player's: mouse or stick turns it, the subject sits a little
//          below the middle, W runs where it looks (cam.move)
//   chase  the attract mode's: it turns after the subject's heading, looks
//          ahead of the run, swings out off a wall the subject runs along
//   first  from the subject's eyes (the game hides the subject: cam.hidesSubject)
//   frame  a showcase: the subject's FRONT toward us, its bounds fitted in the
//          picture (a turntable if it spins)
//   rail   scripted keys (cutscenes, attract loops); `fixed` is a rail of one
//
// Rigs step on the game's fixed simulation steps, never on the screen's
// frames, so a camera is where it should be at any frame rate and the same
// steps always give the same camera. Rendering only reads cam.view().
//
//   const cam = createCamera({ mode: "orbit", width: 128, height: 128 });
//   cam.step(dt, subject, { boxes }, { look: [dyaw, dpitch] });   // each fixed step
//   body.step(dt, { move: cam.move(forward, strafe), ... });      // W is forward
//   px.render({ ...cam.view(), time, ... });                      // each frame
//
// The frame convention is core's: +z front, +x right, +y up,
// front(yaw) = [sin, 0, cos]. A positive look yaw turns the view to the
// screen's right (what was on the right comes to the middle); a positive look
// pitch looks up.
//
// Two things differ from the proof of concept, on purpose (README "Fixes"):
// the arm collides with wedges as wedges (solidDistance over world.boxes and
// world.wedges -- the proof of concept took every solid for a box and never
// saw world.wedges), and a small subject's arm starts at least radius + skin
// above its feet (the proof of concept started it at half the height: under
// 0.4 m that is inside the floor's room, and the eye sat in the floor). Neither
// changes a boxes-only world or a subject of 0.56 m or more. And the camera can save() and load() its private state.

import { cameraBasis, frontOf, moveFromView, rightOf, wrapAngle, yawOf } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { solidDistance } from "@keel-engine/physics";
import type { Solid, Wedge } from "@keel-engine/physics";

// ---- the pieces a camera talks about

/** An AABB: [x0, y0, z0, x1, y1, z1]. */
export type Bounds6 = readonly [number, number, number, number, number, number];

/**
 * Anything a camera watches. `pos` is its feet; `yaw` its front (else its
 * velocity's heading); `wall` a wall-run's normal (the chase swings out off
 * it); `bounds` what `frame` fits (else a cylinder of radius and height).
 */
export interface Subject {
  readonly pos: Vec3Like;
  readonly yaw?: number | undefined;
  readonly vel?: Vec3Like | undefined;
  readonly height?: number | undefined;
  readonly radius?: number | undefined;
  readonly mode?: string | undefined;
  readonly wall?: Vec3Like | null | undefined;
  readonly bounds?: Bounds6 | { readonly min: Vec3Like; readonly max: Vec3Like } | undefined;
}

/**
 * What the camera must not enter: the solids physics collides with (boxes,
 * wedges given among them with kind "wedge", or on their own list), a floor
 * plane, and any SDF of your own.
 */
export interface CameraWorld {
  readonly boxes?: readonly Solid[] | undefined;
  readonly wedges?: readonly Wedge[] | undefined;
  readonly floorY?: number | undefined;
  readonly distance?: ((p: Vec3Like) => number) | undefined;
}

/** What turns a camera: radians of look this step (+ yaw to the screen's right, + pitch up). An input sample is one. */
export interface LookInput {
  readonly look?: readonly [number, number] | undefined;
}

/** What a rig makes each step. */
export interface RigView {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly fov?: number | undefined;
}
/** What to render. */
export interface View {
  eye: Vec3;
  target: Vec3;
  fov: number;
}

/** The camera as a rig sees it. */
export interface CameraLike {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly width: number;
  readonly height: number;
  readonly aspect: number;
  readonly baseFov: number;
}

/**
 * A rig: { name, opt, enter(cam, subject, fresh), step(...) -> { eye, target, fov? } }.
 * `save`/`load` carry its private state (Camera.save reads them); `hidesSubject`
 * says the game shouldn't draw the subject while it's the mode.
 */
export interface Rig<O extends object = object> {
  readonly name: string;
  readonly opt: O;
  readonly hidesSubject?: boolean;
  enter?(cam: CameraLike, subject: Subject, fresh: boolean): void;
  step(dt: number, subject: Subject, world: CameraWorld, input: LookInput, cam: CameraLike | null): RigView;
  save?(): unknown;
  load?(state: unknown): void;
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const add = (a: Vec3Like, b: Vec3Like): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3Like, b: Vec3Like): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3Like, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3Like): number => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: Vec3Like, b: Vec3Like, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const copy3 = (a: Vec3Like): Vec3 => [a[0], a[1], a[2]];
const smoothstep = (k: number): number => k * k * (3 - 2 * k);
/** The share of the way covered in dt when closing at `rate` per second (frame-rate free). */
const ease = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
/** The direction a view at (yaw, pitch) looks along. */
export const dirOf = (yaw: number, pitch: number): Vec3 => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
/** From a toward b, `t` along. */
const along = (a: Vec3Like, b: Vec3Like, t: number): Vec3 => { const d = sub(b, a); const l = len(d); return l < 1e-9 ? copy3(a) : add(a, scale(d, t / l)); };

/** The fov (vertical, radians) a target size wants: fewer pixels, a tighter frame, so a subject keeps enough of them to read at 32. */
export const fovForTarget = (w: number, h: number, base = 1.15): number => base * clamp((Math.min(w, h) / 128) ** 0.3, 0.6, 1);
/** How much of the picture a framed subject fills: more at small targets. */
export const fillForTarget = (w: number, h: number): number => 0.72 + 0.14 * clamp((128 - Math.min(w, h)) / 96, 0, 1);

// ---- the world, as the camera sees it

const NONE: readonly Solid[] = [];

/** How far p is from the world's solids (negative inside one). */
export function clearance(world: CameraWorld | null | undefined, p: Vec3Like): number {
  let d = Infinity;
  // (Boxes -- a wedge among them dispatches as a wedge -- then the wedges given on their own.)
  for (const b of world?.boxes ?? NONE) { const q = solidDistance(p, b).d; if (q < d) d = q; }
  for (const b of world?.wedges ?? NONE) { const q = solidDistance(p, b).d; if (q < d) d = q; }
  if (world?.floorY !== undefined) d = Math.min(d, p[1] - world.floorY);
  if (world?.distance) d = Math.min(d, world.distance(p));
  return d;
}

/**
 * Sweep a ball of `radius` from `from` toward `to`: how far it gets before it
 * touches something (the whole way if nothing is in it). Sphere-traced, so a
 * point it returns always has at least `radius` of room -- a camera put there
 * is never inside a wall. (Starting inside something, it gets nowhere: 0.)
 */
export function sphereCast(world: CameraWorld | null | undefined, from: Vec3Like, to: Vec3Like, radius = 0.2): number {
  const d = sub(to, from);
  const L = len(d);
  if (L < 1e-9) return 0;
  let t = 0;
  for (let i = 0; i < 160; i += 1) {
    const c = clearance(world, add(from, scale(d, t / L))) - radius;
    if (c < 1e-3) return t;
    t += c;
    if (t >= L) return L;
  }
  return t; // (grazing along a face: as far as it has proven clear)
}

/** An arm: its length now and its spring's speed. */
interface Arm { arm: number | null; armVel: number }

// The arm: in at once when something is in the way; back out on a critically
// damped spring when it clears (it starts gently and never overshoots the room).
function armTo(rig: Arm, hit: number, dt: number, rate: number): number {
  if (rig.arm === null || hit <= rig.arm) { rig.arm = hit; rig.armVel = 0; return hit; }
  rig.armVel += (rate * rate * (hit - rig.arm) - 2 * rate * rig.armVel) * dt;
  rig.arm = Math.min(hit, rig.arm + Math.max(0, rig.armVel) * dt);
  return rig.arm;
}

/** A little room kept off a surface the arm stopped at, so the next sweep can start from there. */
export const SKIN = 0.08;

/** The outward normal of the nearest solid at p. */
export function normalAt(world: CameraWorld | null | undefined, p: Vec3Like): Vec3 {
  let best = Infinity;
  let n: Vec3 = [0, 1, 0];
  for (const b of world?.boxes ?? NONE) { const q = solidDistance(p, b); if (q.d < best) { best = q.d; n = q.n; } }
  for (const b of world?.wedges ?? NONE) { const q = solidDistance(p, b); if (q.d < best) { best = q.d; n = q.n; } }
  if (world?.floorY !== undefined && p[1] - world.floorY < best) { best = p[1] - world.floorY; n = [0, 1, 0]; }
  const distance = world?.distance;
  if (distance && distance(p) < best) {
    const e = 1e-3;
    const g = ([0, 1, 2] as const).map((i) => { const a = copy3(p); const b = copy3(p); a[i] += e; b[i] -= e; return distance(a) - distance(b); }) as Vec3;
    const l = len(g) || 1;
    n = scale(g, 1 / l);
  }
  return n;
}

/** An arm's path: a polyline and its length. */
export interface ArmPath {
  points: Vec3[];
  reach: number;
}

/**
 * The arm's path from `from` toward `to`: straight until it touches something;
 * then, if that is a ceiling or a floor, on along it (a camera in a low tunnel
 * slides back under the roof rather than folding into the subject's head).
 * Walls only pull it in. Every point on the path has `radius` of room.
 */
export function armPath(world: CameraWorld | null | undefined, from: Vec3Like, to: Vec3Like, radius = 0.2): ArmPath {
  const L = len(sub(to, from));
  const t = sphereCast(world, from, to, radius);
  const hit = along(from, to, t);
  const start = copy3(from);
  if (t >= L - 1e-9) return { points: [start, hit], reach: t };
  const n = normalAt(world, hit);
  const rest = sub(to, hit);
  const into = dot(rest, n);
  if (Math.abs(n[1]) < 0.7 || into >= 0) return { points: [start, hit], reach: t };
  const off = add(hit, scale(n, SKIN));
  if (clearance(world, off) < radius) return { points: [start, hit], reach: t };
  const slideTo = add(off, sub(rest, scale(n, into)));
  const t2 = sphereCast(world, off, slideTo, radius);
  return { points: [start, hit, off, along(off, slideTo, t2)], reach: t + SKIN + t2 };
}
/** The point `s` along a polyline. */
export function alongPath(points: readonly Vec3Like[], s: number): Vec3 {
  let left = s;
  for (let i = 0; i < points.length - 1; i += 1) {
    const l = len(sub(points[i + 1]!, points[i]!));
    if (left <= l || i === points.length - 2) return along(points[i]!, points[i + 1]!, Math.min(left, l));
    left -= l;
  }
  return copy3(points[0]!);
}

// The middle of the subject's body: always open space (the body itself keeps it clear) -- and never less than
// radius + SKIN over its feet, so a sweep from it starts with room even for a mouse. (The proof of concept took
// half the height, whatever it was: under 0.4 m the arm started inside the floor's room and got nowhere.)
const coreOf = (s: Subject, radius: number): Vec3 => [s.pos[0], s.pos[1] + Math.max((s.height ?? 1.1) * 0.5, radius + SKIN), s.pos[2]];
// A point over the subject's head, pulled down under a low ceiling (with a skin of room to spare).
function safePoint(world: CameraWorld, s: Subject, p: Vec3Like, radius: number): Vec3 {
  const core = coreOf(s, radius);
  const t = sphereCast(world, core, p, radius);
  return along(core, p, t >= len(sub(p, core)) - 1e-9 ? t : Math.max(0, t - SKIN));
}
const headingOf = (s: Subject): number => (s.yaw !== undefined ? s.yaw : Math.hypot(s.vel?.[0] ?? 0, s.vel?.[2] ?? 0) > 1e-6 ? yawOf(s.vel!) : 0);

// ---- rigs

export interface OrbitOptions {
  /** m: the full arm. */
  distance: number;
  /** m over the subject's head the arm hangs from (scaled with the fov). */
  above: number;
  /** m to the right of the subject (a shoulder view). */
  shoulder: number;
  /** The fresh pitch. */
  pitch: number;
  minPitch: number;
  maxPitch: number;
  /** The pivot's lag across and up (per s). */
  follow: number;
  followY: number;
  /** The arm's spring back out (per s). */
  recover: number;
  radius: number;
  /** s of idle look before it drifts round behind the run (0: never). */
  recenter: number;
  recenterRate: number;
}
export interface OrbitState { yaw: number; pitch: number; pivot: Vec3 | null; arm: number | null; armVel: number; idle: number }
export interface OrbitRig extends Rig<OrbitOptions>, OrbitState {
  save(): OrbitState;
  load(state: OrbitState): void;
}

/**
 * Third person, player-turned: yaw and pitch from the look input, the subject
 * a little below the middle (the arm hangs off a point over its head), an arm
 * that pulls in when a wall is behind and eases back out, an optional
 * shoulder offset, and (optional) a slow recentre behind the run when the
 * look has been left alone.
 */
export function orbitRig(o: Partial<OrbitOptions> = {}): OrbitRig {
  const opt: OrbitOptions = {
    distance: 3.4, above: 0.45, shoulder: 0, pitch: -0.28, minPitch: -1.2, maxPitch: 0.55,
    follow: 18, followY: 9, recover: 6, radius: 0.2, recenter: 0, recenterRate: 1.5, ...o,
  };
  const rig: OrbitRig = {
    name: "orbit", opt, yaw: 0, pitch: opt.pitch, pivot: null, arm: null, armVel: 0, idle: 0,
    enter(cam, s, fresh) {
      rig.yaw = fresh ? headingOf(s) : cam.yaw;
      rig.pitch = fresh ? opt.pitch : clamp(cam.pitch, opt.minPitch, opt.maxPitch);
      rig.pivot = null; rig.arm = null; rig.idle = 0;
    },
    step(dt, s, world, input = {}, cam = null) {
      const look = input.look ?? [0, 0];
      rig.yaw = wrapAngle(rig.yaw + look[0]);
      rig.pitch = clamp(rig.pitch + look[1], opt.minPitch, opt.maxPitch);
      // (Left alone and running: drift round behind the run, as a pad player expects.)
      const hv = Math.hypot(s.vel?.[0] ?? 0, s.vel?.[2] ?? 0);
      rig.idle = Math.abs(look[0]) + Math.abs(look[1]) > 1e-6 ? 0 : rig.idle + dt;
      if (opt.recenter > 0 && rig.idle > opt.recenter && hv > 2) rig.yaw = wrapAngle(rig.yaw + wrapAngle(headingOf(s) - rig.yaw) * ease(opt.recenterRate, dt));
      const r = rightOf(rig.yaw);
      // (The pivot's height over the subject's middle scales with the fov, so the subject sits the
      // same share below the middle at 32 pixels, in fovForTarget's tighter frame, as at 128.)
      const h = s.height ?? 1.1;
      const k = cam ? Math.tan(cam.baseFov / 2) / Math.tan(1.15 / 2) : 1;
      const want: Vec3 = [s.pos[0] + r[0] * opt.shoulder, s.pos[1] + h * 0.5 + (h * 0.5 + opt.above) * k, s.pos[2] + r[2] * opt.shoulder];
      if (!rig.pivot) rig.pivot = want;
      else {
        const kx = ease(opt.follow, dt);
        const ky = ease(opt.followY, dt);
        rig.pivot = [rig.pivot[0] + (want[0] - rig.pivot[0]) * kx, rig.pivot[1] + (want[1] - rig.pivot[1]) * ky, rig.pivot[2] + (want[2] - rig.pivot[2]) * kx];
      }
      const pivot = safePoint(world, s, rig.pivot, opt.radius);
      const f = dirOf(rig.yaw, rig.pitch);
      const path = armPath(world, pivot, sub(pivot, scale(f, opt.distance)), opt.radius);
      const arm = armTo(rig, path.reach, dt, opt.recover);
      const eye = alongPath(path.points, arm);
      // (Looking along the rig's direction through the pivot: a full arm out that is the pivot itself;
      // pulled in, a point past it, so the camera always has somewhere to look.)
      return { eye, target: add(pivot, scale(f, opt.distance - arm)) };
    },
    save: () => ({ yaw: rig.yaw, pitch: rig.pitch, pivot: rig.pivot && copy3(rig.pivot), arm: rig.arm, armVel: rig.armVel, idle: rig.idle }),
    load(st) { rig.yaw = st.yaw; rig.pitch = st.pitch; rig.pivot = st.pivot && copy3(st.pivot); rig.arm = st.arm; rig.armVel = st.armVel; rig.idle = st.idle; },
  };
  return rig;
}

export interface ChaseOptions {
  distance: number;
  height: number;
  /** Share of the distance the eye rises by as well. */
  rise: number;
  lookHeight: number;
  lookAhead: number;
  /** s of velocity the look leads by. */
  lead: number;
  turn: number;
  turnBySpeed: number;
  /** m out off a wall-run's wall. */
  swing: number;
  swingRate: number;
  eyeRate: number;
  lookRate: number;
  recover: number;
  radius: number;
  above: number;
  /** How much faster it comes round while a wall hides the subject. */
  unblock: number;
}
export interface ChaseState { yaw: number; side: [number, number]; eye: Vec3 | null; look: Vec3 | null; arm: number | null; armVel: number; reach: number }
export interface ChaseRig extends Rig<ChaseOptions>, ChaseState {
  save(): ChaseState;
  load(state: ChaseState): void;
}

/**
 * Third person, self-driving: turns after the subject's heading (faster the
 * faster it runs), looks ahead of the run, stands out over the open side when
 * the subject runs along a wall (subject.wall is the wall's normal), and pulls
 * in off walls like the orbit. WALLRUN's first camera, made frame-rate free.
 */
export function chaseRig(o: Partial<ChaseOptions> = {}): ChaseRig {
  const opt: ChaseOptions = {
    distance: 3, height: 1.5, rise: 0.12, lookHeight: 0.7, lookAhead: 1.4, lead: 0.12,
    turn: 1.45, turnBySpeed: 0.145, swing: 1.5, swingRate: 3.6, eyeRate: 7.4, lookRate: 14, recover: 6, radius: 0.2,
    above: 0.35, unblock: 4, ...o,
  };
  const rig: ChaseRig = {
    name: "chase", opt, yaw: 0, side: [0, 0], eye: null, look: null, arm: null, armVel: 0, reach: 0,
    enter(cam, s, fresh) {
      rig.yaw = fresh ? headingOf(s) : cam.yaw;
      rig.side = [0, 0]; rig.arm = null;
      rig.eye = fresh ? null : copy3(cam.eye);
      rig.look = fresh ? null : copy3(cam.target);
    },
    step(dt, s, world) {
      const vel = s.vel ?? [0, 0, 0];
      const hv = Math.hypot(vel[0], vel[2]);
      // (A wall between it and the subject -- the arm pulled in past half -- and it comes round faster.)
      const blocked = rig.arm !== null && rig.arm < 0.5 * rig.reach;
      const turn = (opt.turn + hv * opt.turnBySpeed) * (blocked ? opt.unblock : 1);
      if (hv > 1) rig.yaw = wrapAngle(rig.yaw + wrapAngle(headingOf(s) - rig.yaw) * ease(turn, dt));
      const wall = s.mode === "wall" && s.wall ? [s.wall[0] * opt.swing, s.wall[2] * opt.swing] as const : [0, 0] as const;
      const ks = ease(opt.swingRate, dt);
      rig.side = [rig.side[0] + (wall[0] - rig.side[0]) * ks, rig.side[1] + (wall[1] - rig.side[1]) * ks];
      const f = frontOf(rig.yaw);
      const wantEye: Vec3 = [s.pos[0] - f[0] * opt.distance + rig.side[0], s.pos[1] + opt.height + opt.distance * opt.rise, s.pos[2] - f[2] * opt.distance + rig.side[1]];
      const wantLook: Vec3 = [s.pos[0] + f[0] * opt.lookAhead + vel[0] * opt.lead, s.pos[1] + opt.lookHeight, s.pos[2] + f[2] * opt.lookAhead + vel[2] * opt.lead];
      const eye = rig.eye ? lerp3(rig.eye, wantEye, ease(opt.eyeRate * (blocked ? opt.unblock : 1), dt)) : wantEye;
      const look = rig.look ? lerp3(rig.look, wantLook, ease(opt.lookRate, dt)) : wantLook;
      rig.eye = eye; rig.look = look;
      // Collision last, on the smoothed eye: from over the subject's head out to it.
      const pivot = safePoint(world, s, [s.pos[0], s.pos[1] + (s.height ?? 1.1) + opt.above, s.pos[2]], opt.radius);
      const path = armPath(world, pivot, eye, opt.radius);
      const arm = armTo(rig, path.reach, dt, opt.recover);
      rig.reach = len(sub(eye, pivot));
      return { eye: alongPath(path.points, arm), target: look };
    },
    save: () => ({ yaw: rig.yaw, side: [rig.side[0], rig.side[1]], eye: rig.eye && copy3(rig.eye), look: rig.look && copy3(rig.look), arm: rig.arm, armVel: rig.armVel, reach: rig.reach }),
    load(st) { rig.yaw = st.yaw; rig.side = [st.side[0], st.side[1]]; rig.eye = st.eye && copy3(st.eye); rig.look = st.look && copy3(st.look); rig.arm = st.arm; rig.armVel = st.armVel; rig.reach = st.reach; },
  };
  return rig;
}

export interface FirstOptions {
  /** Share of the subject's height the eyes are at. */
  eyeHeight: number;
  minPitch: number;
  maxPitch: number;
}
export interface FirstState { yaw: number; pitch: number }
export interface FirstRig extends Rig<FirstOptions>, FirstState {
  readonly hidesSubject: true;
  save(): FirstState;
  load(state: FirstState): void;
}

/** First person: at the subject's eyes, turned by the look input. The subject is hidden (cam.hidesSubject). */
export function firstRig(o: Partial<FirstOptions> = {}): FirstRig {
  const opt: FirstOptions = { eyeHeight: 0.88, minPitch: -1.45, maxPitch: 1.45, ...o };
  const rig: FirstRig = {
    name: "first", opt, yaw: 0, pitch: 0, hidesSubject: true,
    enter(cam, s, fresh) { rig.yaw = fresh ? headingOf(s) : cam.yaw; rig.pitch = fresh ? 0 : clamp(cam.pitch, opt.minPitch, opt.maxPitch); },
    step(_dt, s, _world, input = {}) {
      const look = input.look ?? [0, 0];
      rig.yaw = wrapAngle(rig.yaw + look[0]);
      rig.pitch = clamp(rig.pitch + look[1], opt.minPitch, opt.maxPitch);
      const eye: Vec3 = [s.pos[0], s.pos[1] + (s.height ?? 1.1) * opt.eyeHeight, s.pos[2]];
      return { eye, target: add(eye, dirOf(rig.yaw, rig.pitch)) };
    },
    save: () => ({ yaw: rig.yaw, pitch: rig.pitch }),
    load(st) { rig.yaw = st.yaw; rig.pitch = st.pitch; },
  };
  return rig;
}

/** A subject's bounds as [x0, y0, z0, x1, y1, z1]: its own (array or {min, max}), or a cylinder of its radius and height. */
export function boundsOf(s: Subject): [number, number, number, number, number, number] {
  const b = s.bounds;
  if (Array.isArray(b) && b.length === 6) return b as unknown as [number, number, number, number, number, number];
  const mm = b as { readonly min?: Vec3Like; readonly max?: Vec3Like } | undefined;
  if (mm?.min && mm.max) return [mm.min[0], mm.min[1], mm.min[2], mm.max[0], mm.max[1], mm.max[2]];
  const r = s.radius ?? 0.3;
  const h = s.height ?? 1.1;
  return [s.pos[0] - r, s.pos[1], s.pos[2] - r, s.pos[0] + r, s.pos[1] + h, s.pos[2] + r];
}

export interface FrameViewOptions {
  /** A yaw or a direction overriding the subject's heading. */
  readonly front?: number | Vec3Like | null | undefined;
  /** Radians off square-on (a three-quarter view at ~0.45). */
  readonly turn?: number | undefined;
  readonly elevation?: number | undefined;
  readonly fov?: number | undefined;
  readonly aspect?: number | undefined;
  /** How much of the picture the bounds may fill. */
  readonly fill?: number | undefined;
  readonly near?: number | undefined;
}
export interface FrameViewResult { eye: Vec3; target: Vec3; distance: number; yaw: number }

/**
 * The view that shows a subject's FRONT, its bounds fitted in the picture.
 * The camera stands on the front side (the front is the subject's yaw, or
 * `front` -- a yaw or a direction), turned `turn` off square-on and raised by
 * `elevation`. The distance is solved, not searched: every corner of the
 * bounds lands inside `fill` of the picture at this fov and aspect, and the
 * aim is re-centred on what is seen (NOCTURNES' seenFrame: extents across the
 * view, nearer corners bigger).
 */
export function frameView(s: Subject, { front, turn = 0, elevation = 0.14, fov = 1.15, aspect = 1, fill = 0.8, near = 0.3 }: FrameViewOptions = {}): FrameViewResult {
  const fy = front === undefined || front === null ? headingOf(s) : Array.isArray(front) ? yawOf(front as Vec3Like) : (front as number);
  const a = fy + turn;
  const out: Vec3 = [Math.sin(a) * Math.cos(elevation), Math.sin(elevation), Math.cos(a) * Math.cos(elevation)]; // (subject -> camera: its front side)
  const fwd = scale(out, -1);
  const { right, up } = cameraBasis([0, 0, 0], fwd);
  const [x0, y0, z0, x1, y1, z1] = boundsOf(s);
  const corners: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) corners.push([x, y, z]);
  const ty = Math.tan(fov / 2) * fill;
  const tx = ty * aspect;
  let target: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  let D = near;
  for (let pass = 0; pass < 3; pass += 1) {
    // Near enough that every corner fits: |x| <= tx (D + z) and |y| <= ty (D + z).
    D = near;
    for (const p of corners) {
      const rel = sub(p, target);
      const z = dot(rel, fwd);
      D = Math.max(D, Math.abs(dot(rel, right)) / tx - z, Math.abs(dot(rel, up)) / ty - z, near - z);
    }
    if (pass === 2) break;
    // Then aim at the middle of what's seen from there.
    let lx = Infinity; let hx = -Infinity; let ly = Infinity; let hy = -Infinity;
    for (const p of corners) {
      const rel = sub(p, target);
      const z = D + dot(rel, fwd);
      const sx = dot(rel, right) / z;
      const sy = dot(rel, up) / z;
      lx = Math.min(lx, sx); hx = Math.max(hx, sx); ly = Math.min(ly, sy); hy = Math.max(hy, sy);
    }
    target = add(target, add(scale(right, ((lx + hx) / 2) * D), scale(up, ((ly + hy) / 2) * D)));
  }
  return { eye: add(target, scale(out, D)), target, distance: D, yaw: a + Math.PI };
}

export interface FrameOptions {
  /** Radians off square-on at the start. */
  turn: number;
  elevation: number;
  /** Radians a second (a turntable). */
  spin: number;
  /** Per s to ease to the fit (0: snap). */
  rate: number;
  /** How much of the picture the subject fills (else fillForTarget). */
  fill: number | null;
  /** The subject this many pixels tall instead. */
  pixels: number | null;
  /** A yaw or direction overriding the subject's heading. */
  front: number | Vec3Like | null;
  /** Pull the shot in front of any wall between it and the subject. */
  collide: boolean;
  radius: number;
}
export interface FrameState { turn: number; eye: Vec3 | null; target: Vec3 | null }
export interface FrameRig extends Rig<FrameOptions>, FrameState {
  save(): FrameState;
  load(state: FrameState): void;
}

/**
 * Still or turntable: frameView every step, eased to (or snapped with rate 0).
 * `spin` turns it (radians a second); the look input's yaw turns it by hand.
 * `pixels` asks for the subject that many pixels tall (else fillForTarget).
 * In a world with solids the shot is pulled in front of any wall (collide: false to let it through).
 */
export function frameRig(o: Partial<FrameOptions> = {}): FrameRig {
  const opt: FrameOptions = { turn: 0.45, elevation: 0.14, spin: 0, rate: 6, fill: null, pixels: null, front: null, collide: true, radius: 0.2, ...o };
  const rig: FrameRig = {
    name: "frame", opt, turn: opt.turn, eye: null, target: null,
    enter() { rig.turn = opt.turn; rig.eye = null; rig.target = null; },
    step(dt, s, world, input = {}, cam) {
      if (!cam) throw new TypeError("The frame rig steps inside a camera (it reads the target size).");
      rig.turn += opt.spin * dt + (input.look?.[0] ?? 0);
      const fill = opt.pixels ? clamp(opt.pixels / cam.height, 0.1, 0.95) : opt.fill ?? fillForTarget(cam.width, cam.height);
      const v = frameView(s, { front: opt.front, turn: rig.turn, elevation: opt.elevation, fov: cam.baseFov, aspect: cam.aspect, fill });
      const k = opt.rate > 0 && rig.eye ? ease(opt.rate, dt) : 1;
      const eye = rig.eye ? lerp3(rig.eye, v.eye, k) : v.eye;
      const target = rig.target ? lerp3(rig.target, v.target, k) : v.target;
      rig.eye = eye; rig.target = target;
      // (In a level, a wall between the shot and the subject brings the camera in front of it.)
      if (!opt.collide || !(world?.boxes?.length || world?.wedges?.length)) return { eye, target };
      const from = safePoint(world, s, target, opt.radius);
      return { eye: alongPath(armPath(world, from, eye, opt.radius).points, Infinity), target };
    },
    save: () => ({ turn: rig.turn, eye: rig.eye && copy3(rig.eye), target: rig.target && copy3(rig.target) }),
    load(st) { rig.turn = st.turn; rig.eye = st.eye && copy3(st.eye); rig.target = st.target && copy3(st.target); },
  };
  return rig;
}

// Catmull-Rom through four points.
function spline(p0: Vec3Like, p1: Vec3Like, p2: Vec3Like, p3: Vec3Like, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  return p1.map((_, i) => 0.5 * (2 * p1[i]! + (p2[i]! - p0[i]!) * t + (2 * p0[i]! - 5 * p1[i]! + 4 * p2[i]! - p3[i]!) * t2 + (3 * p1[i]! - p0[i]! - 3 * p2[i]! + p3[i]!) * t3)) as unknown as Vec3;
}

/** A rail's key: at `at` seconds the eye is here, looking at `target` (none: at the subject), with this fov (none: the camera's). */
export interface RailKey {
  readonly at: number;
  readonly eye: Vec3Like;
  readonly target?: Vec3Like | null | undefined;
  readonly fov?: number | undefined;
}
export interface RailOptions {
  keys: readonly RailKey[];
  loop: boolean;
  speed: number;
  /** A loop's length (else the keys' span plus one average gap). */
  period: number | null;
  name: string;
}
export interface RailState { t: number }
export interface RailRig extends Rig<RailOptions>, RailState {
  /** The view at rig time t (for scrubbing). */
  at(t: number, s?: Subject | null): RigView;
  save(): RailState;
  load(state: RailState): void;
}

/**
 * Scripted: keys [{ at: seconds, eye, target?, fov? }] passed through
 * smoothly (Catmull-Rom), looped or held at the end. A key without a target
 * looks at the subject. Time is the rig's own, advanced by the steps.
 */
export function railRig(o: Partial<RailOptions> = {}): RailRig {
  const opt: RailOptions = { keys: [], loop: true, speed: 1, period: null, name: "rail", ...o };
  const rig: RailRig = {
    name: opt.name, opt, t: 0,
    enter() { rig.t = 0; },
    at(t, s) {
      const keys = opt.keys;
      const aim = (k: RailKey): Vec3Like => (k.target ? k.target : s ? [s.pos[0], s.pos[1] + (s.height ?? 1.1) * 0.6, s.pos[2]] : [0, 0, 0]);
      if (keys.length === 1) return { eye: copy3(keys[0]!.eye), target: copy3(aim(keys[0]!)), fov: keys[0]!.fov };
      const n = keys.length;
      const first = keys[0]!.at;
      const last = keys[n - 1]!.at;
      const period = opt.period ?? last - first + (last - first) / (n - 1);
      let tt = first + t;
      if (opt.loop) tt = first + (((t % period) + period) % period);
      else tt = clamp(tt, first, last);
      let i = n - 1;
      while (i > 0 && keys[i]!.at > tt) i -= 1;
      const next = (j: number): RailKey => (opt.loop ? keys[((j % n) + n) % n]! : keys[clamp(j, 0, n - 1)]!);
      const end = i === n - 1 ? (opt.loop ? first + period : last) : keys[i + 1]!.at;
      const u = end > keys[i]!.at ? clamp((tt - keys[i]!.at) / (end - keys[i]!.at), 0, 1) : 0;
      const [k0, k1, k2, k3] = [next(i - 1), next(i), next(i + 1), next(i + 2)];
      const fov = k1.fov !== undefined && k2.fov !== undefined ? k1.fov + (k2.fov - k1.fov) * u : k1.fov;
      return { eye: spline(k0.eye, k1.eye, k2.eye, k3.eye, u), target: spline(aim(k0), aim(k1), aim(k2), aim(k3), u), fov };
    },
    step(dt, s) {
      rig.t += dt * opt.speed;
      return opt.keys.length ? rig.at(rig.t, s) : { eye: [0, 2, -4], target: [0, 1, 0] };
    },
    save: () => ({ t: rig.t }),
    load(st) { rig.t = st.t; },
  };
  return rig;
}

export interface FixedOptions extends Partial<RailOptions> {
  readonly eye?: Vec3Like | undefined;
  readonly target?: Vec3Like | null | undefined;
  readonly fov?: number | undefined;
}
/** A camera that stays put: one eye, looking at `target` (or at the subject). */
export const fixedRig = (o: FixedOptions = {}): RailRig => {
  const { eye, target, fov, ...rest } = o;
  return railRig({ name: "fixed", keys: eye ? [{ at: 0, eye, target, fov }] : [], ...rest });
};

// ---- the camera

/** A physics body as a camera reads it. */
export interface BodyLike {
  readonly pos: Vec3Like;
  readonly vel: Vec3Like;
  readonly facing: number;
  readonly mode: string;
  readonly wall: Vec3Like | null;
}
/** A subject from a @keel-engine/physics body: its position, heading, speed, mode and wall. */
export function subjectOf(body: BodyLike, { height = 1.1, radius = 0.26 }: { readonly height?: number; readonly radius?: number } = {}): Subject {
  return { pos: body.pos, yaw: body.facing, vel: body.vel, height, radius, mode: body.mode, wall: body.mode === "wall" ? body.wall : null };
}

/** The built-in modes (a camera takes more by name through `rigs`). */
export type BuiltinMode = "orbit" | "chase" | "first" | "frame" | "rail" | "fixed";
export type CameraMode = BuiltinMode | (string & {});

export interface ShakeOptions {
  /** Radians at full trauma. */
  readonly max?: number;
  /** Trauma a second. */
  readonly decay?: number;
}

export interface CameraOptions {
  readonly mode?: CameraMode;
  /** The target size: sets the fov (fovForTarget) and the aspect. */
  readonly width?: number;
  readonly height?: number;
  /** A fixed fov instead. */
  readonly fov?: number | null;
  /** s to blend eye/target/fov when the mode changes. */
  readonly blend?: number;
  /** Widen the fov by this share at speed (0: off), over kickSpeeds [from, to] m/s. */
  readonly fovKick?: number;
  readonly kickSpeeds?: readonly [number, number];
  /** An eye nearer the subject's surface than this hides it (hidesSubject). */
  readonly hideWithin?: number;
  readonly shake?: ShakeOptions;
  readonly orbit?: Partial<OrbitOptions>;
  readonly chase?: Partial<ChaseOptions>;
  readonly first?: Partial<FirstOptions>;
  readonly frame?: Partial<FrameOptions>;
  readonly rail?: Partial<RailOptions>;
  readonly fixed?: FixedOptions;
  /** More rigs by name (or replacements for the built-in ones). */
  readonly rigs?: Readonly<Record<string, Rig>>;
}

/** The built-in rigs, by mode, and any added. */
export interface Rigs {
  orbit: OrbitRig;
  chase: ChaseRig;
  first: FirstRig;
  frame: FrameRig;
  rail: RailRig;
  fixed: RailRig;
  [name: string]: Rig;
}

/** A blend from one view to the next, under way. */
export interface Blend { from: View; t: number; dur: number }

/** Everything a camera knows that its options don't: save() -> load() gives back the same camera, step for step. */
export interface CameraState {
  readonly schema: "keel-camera@1";
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly fov: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly mode: CameraMode;
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly trauma: number;
  readonly nod: number;
  readonly nodVel: number;
  /** (Infinity, before the first step, is saved as null: the state is plain JSON.) */
  readonly nearSubject: number | null;
  readonly entering: boolean;
  readonly fresh: boolean;
  readonly blending: Blend | null;
  readonly kick: number;
  /** Each rig's own state, by name (rigs without save() are left out). */
  readonly rigs: Readonly<Record<string, unknown>>;
}

export interface Camera extends CameraLike {
  eye: Vec3;
  target: Vec3;
  fov: number;
  /** The yaw and pitch of what is on the screen (target - eye), so movement follows the picture even mid-blend. */
  yaw: number;
  pitch: number;
  mode: CameraMode;
  width: number;
  height: number;
  /** The camera's own step clock (shake reads it). */
  time: number;
  /** Shake, 0..1. */
  trauma: number;
  /** A landing's nod (radians) and its spring's speed. */
  nod: number;
  nodVel: number;
  /** How far the eye is from the subject's surface, set each step. */
  nearSubject: number;
  readonly rigs: Rigs;
  readonly aspect: number;
  /** The fov before the speed kick: the fixed one, or the target size's. */
  readonly baseFov: number;
  readonly rig: Rig;
  /**
   * The game shouldn't draw the subject: first person (mostly blended in), or
   * an arm pulled in so far the eye is in its face (nearSubject under hideWithin).
   */
  readonly hidesSubject: boolean;
  /** The target size changed: a new fov (unless fixed) and aspect. */
  setTarget(w: number, h: number): void;
  /** Switch rigs, blending from the current view over `blend` seconds. */
  setMode(name: CameraMode, opts?: { readonly blend?: number }): Camera;
  /** One fixed step: the rig moves, blends, kicks; shake decays. */
  step(dt: number, subject: Subject, world?: CameraWorld, input?: LookInput): Camera;
  /** Add shake (0..1 trauma; it adds up and fades). */
  shake(amount: number): Camera;
  /** A thud (a landing): the view nods down by about `amount` radians and springs back. */
  thud(amount: number): Camera;
  /**
   * What to render: eye, target, fov -- with the shake and the nod applied.
   * (They turn the view, never move the eye, so the eye stays where the rig
   * proved it has room.)
   */
  view(): View;
  /** Camera-relative movement: forward 1 is where the view faces, strafe 1 its right. */
  move(forward: number, strafe: number): [number, number];
  /** Its whole state, as plain JSON (options are not in it: load into a camera made with the same options). */
  save(): CameraState;
  /** Take a saved state: the next steps are the ones the saved camera would have taken. */
  load(state: CameraState): Camera;
}

const copyBlend = (b: Blend | null): Blend | null => (b ? { from: { eye: copy3(b.from.eye), target: copy3(b.from.target), fov: b.from.fov }, t: b.t, dur: b.dur } : null);

/**
 * A camera with every rig ready; pick one with `mode` / setMode. See
 * CameraOptions (width, height, fov, blend, fovKick, kickSpeeds, hideWithin,
 * shake, and options for each rig; `rigs`: more rigs by name).
 */
export function createCamera(o: CameraOptions = {}): Camera {
  const opt = { mode: "orbit" as CameraMode, width: 128, height: 128, fov: null as number | null, blend: 0.3, fovKick: 0, kickSpeeds: [6, 12] as readonly [number, number], hideWithin: 0.35, ...o };
  const shakeOpt = { max: 0.05, decay: 1.6, ...o.shake };
  const rigs: Rigs = {
    orbit: orbitRig(o.orbit), chase: chaseRig(o.chase), first: firstRig(o.first),
    frame: frameRig(o.frame), rail: railRig(o.rail), fixed: fixedRig(o.fixed), ...o.rigs,
  } as Rigs;
  let entering = true;
  let fresh = true;
  let blending: Blend | null = null;
  let kick = 0;
  const rigOf = (name: CameraMode): Rig => {
    const r = rigs[name];
    if (!r) throw new Error(`no camera mode "${name}"`);
    return r;
  };
  const cam: Camera = {
    eye: [0, 2, -4], target: [0, 1, 0], fov: opt.fov ?? fovForTarget(opt.width, opt.height),
    yaw: 0, pitch: 0, mode: opt.mode, width: opt.width, height: opt.height,
    time: 0, trauma: 0, nod: 0, nodVel: 0, nearSubject: Infinity, rigs,
    get aspect() { return cam.width / cam.height; },
    get baseFov() { return opt.fov ?? fovForTarget(cam.width, cam.height); },
    get rig() { return rigOf(cam.mode); },
    get hidesSubject() { return (Boolean(rigOf(cam.mode).hidesSubject) && (!blending || blending.t > blending.dur * 0.5)) || cam.nearSubject < opt.hideWithin; },
    setTarget(w, h) { cam.width = w; cam.height = h; },
    setMode(name, { blend = opt.blend } = {}) {
      rigOf(name);
      if (name === cam.mode) return cam;
      blending = blend > 0 && !fresh ? { from: { eye: copy3(cam.eye), target: copy3(cam.target), fov: cam.fov }, t: 0, dur: blend } : null;
      cam.mode = name;
      entering = true;
      return cam;
    },
    step(dt, subject, world = {}, input = {}) {
      cam.time += dt;
      const rig = rigOf(cam.mode);
      if (entering) { rig.enter?.(cam, subject, fresh); entering = false; fresh = false; }
      const out = rig.step(dt, subject, world, input, cam);
      let fov = out.fov ?? cam.baseFov;
      if (opt.fovKick) {
        const hv = Math.hypot(subject.vel?.[0] ?? 0, subject.vel?.[2] ?? 0);
        const [s0, s1] = opt.kickSpeeds;
        kick += (clamp((hv - s0) / (s1 - s0), 0, 1) - kick) * ease(4, dt);
        fov *= 1 + opt.fovKick * kick;
      }
      let { eye, target } = out;
      if (blending) {
        blending.t += dt;
        const k = smoothstep(clamp(blending.t / blending.dur, 0, 1));
        eye = lerp3(blending.from.eye, eye, k);
        target = lerp3(blending.from.target, target, k);
        fov = blending.from.fov + (fov - blending.from.fov) * k;
        if (blending.t >= blending.dur) blending = null;
      }
      cam.eye = copy3(eye); cam.target = copy3(target); cam.fov = fov;
      // (How far the eye is from the subject's surface, a capsule of its radius and height.)
      const r = subject.radius ?? 0.3;
      const ay = clamp(eye[1], subject.pos[1] + r, subject.pos[1] + Math.max(r, (subject.height ?? 1.1) - r));
      cam.nearSubject = len(sub(eye, [subject.pos[0], ay, subject.pos[2]])) - r;
      const f = sub(target, eye);
      const fl = len(f) || 1;
      if (Math.hypot(f[0], f[2]) > 1e-9) cam.yaw = yawOf(f);
      cam.pitch = Math.asin(clamp(f[1] / fl, -1, 1));
      // Shake fades; the nod (a landing's thud) is a spring settling back.
      cam.trauma = Math.max(0, cam.trauma - shakeOpt.decay * dt);
      cam.nodVel += (-180 * cam.nod - 13.4 * cam.nodVel) * dt;
      cam.nod += cam.nodVel * dt;
      return cam;
    },
    shake(amount) { cam.trauma = clamp(cam.trauma + amount, 0, 1); return cam; },
    thud(amount) { cam.nodVel -= amount * 24.5; return cam; }, // (the spring's first dip is ~0.041 of the kick)
    view() {
      const d = sub(cam.target, cam.eye);
      const L = len(d) || 1;
      const t = cam.time;
      const s = cam.trauma * cam.trauma * shakeOpt.max;
      const jy = s * (0.6 * Math.sin(t * 37.1 + 1.3) + 0.4 * Math.sin(t * 61.7));
      const jp = s * (0.6 * Math.sin(t * 43.3 + 0.7) + 0.4 * Math.sin(t * 71.9 + 2.1)) + cam.nod;
      if (jy === 0 && jp === 0) return { eye: copy3(cam.eye), target: copy3(cam.target), fov: cam.fov };
      return { eye: copy3(cam.eye), target: add(cam.eye, scale(dirOf(cam.yaw + jy, clamp(cam.pitch + jp, -1.55, 1.55)), L)), fov: cam.fov };
    },
    move(forward, strafe) { return moveFromView(cam.yaw, forward, strafe); },
    save() {
      const rigState: Record<string, unknown> = {};
      for (const [name, r] of Object.entries(rigs)) if (r.save) rigState[name] = r.save();
      return {
        schema: "keel-camera@1", eye: copy3(cam.eye), target: copy3(cam.target), fov: cam.fov, yaw: cam.yaw, pitch: cam.pitch,
        mode: cam.mode, width: cam.width, height: cam.height, time: cam.time, trauma: cam.trauma, nod: cam.nod, nodVel: cam.nodVel,
        nearSubject: Number.isFinite(cam.nearSubject) ? cam.nearSubject : null,
        entering, fresh, blending: copyBlend(blending), kick, rigs: rigState,
      };
    },
    load(st) {
      if (st?.schema !== "keel-camera@1") throw new TypeError("Not a saved camera (keel-camera@1).");
      rigOf(st.mode);
      cam.eye = copy3(st.eye); cam.target = copy3(st.target); cam.fov = st.fov; cam.yaw = st.yaw; cam.pitch = st.pitch;
      cam.mode = st.mode; cam.width = st.width; cam.height = st.height; cam.time = st.time;
      cam.trauma = st.trauma; cam.nod = st.nod; cam.nodVel = st.nodVel; cam.nearSubject = st.nearSubject ?? Infinity;
      entering = st.entering; fresh = st.fresh; blending = copyBlend(st.blending); kick = st.kick;
      for (const [name, s] of Object.entries(st.rigs)) rigs[name]?.load?.(s);
      return cam;
    },
  };
  return cam;
}
