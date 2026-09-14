// Objects: things that don't move -- ported from the proof of concept's
// src/object/object.js; test/poc-equality.test.ts proves every output
// identical over many seeds. A pillar, a wall, a bench, a sign, a lamp post --
// defined once in their own frame (+z front, +x right, +y up; the core
// frame), placed anywhere by a position, a yaw and a scale, and handing back
// everything the rest of the engine needs:
//
//   bounds       local and world AABBs, and the footprint on the ground
//   colliders    boxes { c, h, yaw, mat } in the world, as @keel-engine/physics
//                createCharacter({ boxes }) and the renderer's setWorld({ boxes }) take
//   rails        polylines in the world, for createCharacter({ rails })
//   sockets      named points in the object's frame: tops you can put things
//                on (with their extent), seats (with their facing), grab
//                points, the spot to view it from
//   front        declared, and checked (@keel-engine/scene detectFront)
//   resting      settle() drops it onto the highest support under it; restsOn() checks
//
//   const bench = defineObject({ key: "bench", parts: [...], front: "+z", tags: ["prop"] });
//   const b = placeObject(bench, { pos: [2, 0, 5], yaw: Math.PI / 2 });
//   worldColliders(b); socketOf(b, "seat"); bakeForRenderer([b]);
//
// A definition is plain data plus its parts' SDFs; an instance is a scene
// entity (createEntity) with the definition riding along.
//
// One thing differs from the proof of concept, on purpose: movedObject (and so
// settle) keeps the instance's own tags -- the proof of concept rebuilt the
// instance from its definition's tags alone and dropped the ones given to
// placeObject. An instance with no tags of its own moves exactly as before.

import { datan2, dcos, dhypot, dlen, dsin, localToWorld, worldToLocal, wrapAngle } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { aabbOf, createEntity, detectFront, dirToWorld, localAabbOf, lowest, overTop, parseFront, toPart, toWorld } from "@keel-engine/scene";
import type { Bounds, Entity, EntityId, FrontOptions, FrontResult, FrontSpec, FrontThing, PartLike, Prim, SdfPart } from "@keel-engine/scene";
import { isWedgeLike, wedgeFromLike } from "./wedge.ts";
import type { WedgePartLike, WedgePrim } from "./wedge.ts";

/** What a socket is for: a surface to put things on, where hips go, a hand hold, where to look from, or your own. */
export type SocketKind = "top" | "seat" | "grab" | "view" | "anchor" | "hang" | "spawn" | (string & {});
export const SOCKET_KINDS: ReadonlySet<string> = new Set(["top", "seat", "grab", "view", "anchor", "hang", "spawn"]);
/** "base": stands on its lowest point · "hang": needs no support (a sign on a wall) · "float". */
export type RestMode = "base" | "hang" | "float";
const REST_MODES: ReadonlySet<string> = new Set(["base", "hang", "float"]);

/** A material: a name (mapped through `mats` when baked) or the renderer's index. */
export type Mat = string | number;

/** A part as an object keeps it: a scene part (an SDF and bounds), maybe the prim it was, and its flags. */
export type ObjectPart = SdfPart & {
  readonly name?: string | undefined;
  readonly mat?: Mat | null | undefined;
  readonly prim?: Prim | undefined;
  /** A wedge part (wedge.ts): the ramp it is. */
  readonly wedge?: WedgePrim | undefined;
  /** false: no collider · "bounds": an SDF part collides as its bounds. */
  readonly collide?: boolean | "bounds" | undefined;
  /** false: not baked for the renderer. */
  readonly render?: boolean | undefined;
};

/** A collider box in the object's own frame (or the world's, from worldColliders). */
export interface Collider {
  c: Vec3;
  h: Vec3;
  yaw: number;
  mat: Mat;
  /** The part it came from. */
  part?: string;
  /** A slanted capsule's AABB: not its shape (physics has boxes turned about y only). */
  approx?: true;
  capsule?: true;
  /** A wedge (a ramp: physics' wedge -- its top slopes from `lo` x its height at local +z to full at -z). */
  kind?: "wedge";
  lo?: number;
}
/** A collider as given to defineObject (yaw and mat defaulted). */
export interface ColliderSpec {
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number | undefined;
  readonly mat?: Mat | undefined;
  readonly part?: string | undefined;
  readonly approx?: boolean | undefined;
  readonly capsule?: boolean | undefined;
  readonly kind?: "wedge" | undefined;
  readonly lo?: number | undefined;
}
/** A box in the world, as physics and the renderer take it (a wedge says so by its kind, as both read it). */
export interface WorldBox {
  c: Vec3;
  h: Vec3;
  yaw: number;
  mat: Mat;
  kind?: "wedge";
  lo?: number;
}

/** A socket as given: its kind (else its name, if that is a kind; else "anchor"), where, which way, how big. */
export interface SocketSpec {
  readonly kind?: SocketKind | undefined;
  readonly pos: Vec3Like;
  /** A front in any spelling (parseFront). */
  readonly yaw?: FrontSpec;
  /** Half-extents across x and z of the socket's own frame. */
  readonly extent?: readonly [number, number] | undefined;
  readonly normal?: Vec3Like | undefined;
  readonly meta?: unknown;
}
/** A socket in the object's own frame. */
export interface Socket {
  name: string;
  kind: SocketKind;
  pos: Vec3;
  /** The way it faces (a seat: the way a sitter faces), or null. */
  yaw: number | null;
  extent?: [number, number];
  normal?: Vec3;
  meta?: unknown;
  /** Added by defineObject (the biggest free top, the view point). */
  auto?: true;
}
/** A socket in the world: its yaw turned with the instance, `dir` the way that faces, extent scaled. */
export interface WorldSocket extends Socket {
  dir?: Vec3;
}

/** A box top nothing sits on. */
export interface Top {
  pos: Vec3;
  yaw: number;
  extent: [number, number];
  area: number;
  part: string | undefined;
}

export interface ObjectSpec<M extends object = Record<string, unknown>> {
  readonly key: string;
  /** In the object's own frame: origin at its pivot (the middle of its base, for things that stand), +z its front. */
  readonly parts: readonly (PartLike | WedgePartLike)[];
  /** The declared front: a yaw, a direction, "+z"/"-x"..., or null (none). */
  readonly front?: FrontSpec;
  /** The side to show a viewer, when it isn't the front (default: the front). */
  readonly show?: FrontSpec;
  readonly tags?: readonly string[];
  /** Default: from the parts. */
  readonly colliders?: readonly ColliderSpec[] | null;
  readonly sockets?: Readonly<Record<string, SocketSpec>>;
  readonly rest?: RestMode;
  /** Grind lines, in the own frame. */
  readonly rails?: readonly (readonly Vec3Like[])[];
  readonly meta?: M;
}

/** A definition: plain data plus its parts' SDFs. */
export interface ObjectDef<M extends object = Record<string, unknown>> {
  kind: "object";
  key: string;
  parts: ObjectPart[];
  front: number | null;
  show: number | null;
  /** Sorted, unique. */
  tags: string[];
  colliders: Collider[];
  sockets: Record<string, Socket>;
  rest: RestMode;
  rails: Vec3[][];
  /** The local AABB. */
  bounds: Bounds;
  meta: M;
  /** A catalogue piece: the realm and seed it was made from. */
  realm?: string;
  seed?: unknown;
}

/** An instance: a scene entity with its definition and key riding along. */
export interface ObjectInstance<M extends object = Record<string, unknown>> extends Entity<ObjectPart> {
  readonly def: ObjectDef<M>;
  readonly key: string;
}

export interface Placement {
  readonly pos?: Vec3Like;
  readonly yaw?: number;
  readonly scale?: number;
  readonly id?: EntityId | null;
  /** The instance's own tags (beside its definition's). */
  readonly tags?: readonly string[];
}

// ---------------------------------------------------------------- colliders from parts

// A capsule's collider: a box along it when it is upright or level (a pole, a
// beam, a rail's bar), its box otherwise (turned solids beyond yaw are not
// something physics has).
function capsuleCollider({ a, b, r }: { readonly a: Vec3Like; readonly b: Vec3Like; readonly r: number }, mat: Mat): Collider {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = dlen(d);
  const c: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const flat = dhypot(d[0], d[2]);
  if (L < 1e-9 || flat / (L || 1) < 0.02) return { c, h: [r, Math.abs(d[1]) / 2 + r, r], yaw: 0, mat };
  if (Math.abs(d[1]) / L < 0.02) return { c, h: [r, r, flat / 2 + r], yaw: datan2(d[0], d[2]), mat };
  const bb = [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r] as const;
  return { c: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2], h: [(bb[3] - bb[0]) / 2, (bb[4] - bb[1]) / 2, (bb[5] - bb[2]) / 2], yaw: 0, mat, approx: true };
}

/**
 * The colliders a set of parts implies, in their own frame: a box part is its
 * box; a capsule part a box along it; an SDF part its bounds, when it asks
 * (`collide: "bounds"`). `collide: false` on any part leaves it out.
 */
export function collidersFromParts(parts: readonly ObjectPart[]): Collider[] {
  const out: Collider[] = [];
  for (const p of parts) {
    if (p.collide === false) continue;
    const mat = p.mat ?? 0;
    const prim = p.prim;
    if (p.wedge) out.push({ c: [...p.wedge.c], h: [...p.wedge.h], yaw: p.wedge.yaw, mat, part: p.name!, kind: "wedge", lo: p.wedge.lo });
    else if (prim?.type === "box") out.push({ c: [...prim.c], h: [...prim.h], yaw: prim.yaw ?? 0, mat, part: p.name! });
    else if (prim?.type === "capsule") out.push({ ...capsuleCollider(prim, mat), part: p.name!, capsule: true });
    else if (p.collide === "bounds") {
      const b = p.bounds;
      out.push({ c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h: [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], yaw: 0, mat, part: p.name! });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sockets

function normSocket(name: string, s: SocketSpec): Socket {
  if (!s || !Array.isArray(s.pos) || s.pos.length !== 3) throw new TypeError(`Socket ${name} needs pos [x, y, z].`);
  const kind = s.kind ?? (SOCKET_KINDS.has(name) ? name : "anchor");
  const out: Socket = { name, kind, pos: [...s.pos] as Vec3, yaw: s.yaw === undefined ? null : parseFront(s.yaw) };
  if (s.extent) out.extent = [s.extent[0], s.extent[1]]; // (half-extents across x and z of the socket's own frame)
  if (s.normal) out.normal = [...s.normal] as Vec3;
  if (s.meta) out.meta = s.meta;
  return out;
}

/**
 * The tops of an object's box colliders that nothing sits on: surfaces you can
 * put things on, each { pos (the middle of the top), yaw, extent [hx, hz], area }.
 * Biggest first, then highest. (A pole's end, a capsule's box, or a sliver
 * thinner than `minHalf` across is not somewhere to put things.)
 */
export function topsOf(parts: readonly ObjectPart[], colliders: readonly Collider[] = collidersFromParts(parts), { minHalf = 0.03 }: { readonly minHalf?: number } = {}): Top[] {
  const tops: Top[] = [];
  for (const b of colliders) {
    if (b.approx || b.capsule || b.kind === "wedge" || b.h[0] < minHalf || b.h[2] < minHalf) continue;
    const y = b.c[1] + b.h[1];
    const pos: Vec3 = [b.c[0], y, b.c[2]];
    // (Covered: another part is right on top of its middle.)
    const probe: Vec3 = [b.c[0], y + Math.max(0.01, b.h[1] * 0.05), b.c[2]];
    const covered = parts.some((p) => p.name !== b.part && p.sdf(probe[0], probe[1], probe[2], 0, null) < 0);
    if (covered) continue;
    tops.push({ pos, yaw: b.yaw ?? 0, extent: [b.h[0], b.h[2]], area: 4 * b.h[0] * b.h[2], part: b.part });
  }
  return tops.sort((a, b) => b.area - a.area || b.pos[1] - a.pos[1]);
}

// ---------------------------------------------------------------- definitions

/**
 * defineObject({ key, parts, front, show, tags, colliders, sockets, rest, rails, meta }) -> definition
 *   key        string (required)
 *   parts      [{ box:{c,h,yaw} | capsule:{a,b,r} | wedge:{c,h,yaw,lo} | shape:{f,b} | sdf+bounds, name, mat, role, collide }]
 *              in the object's own frame: origin at its pivot (the middle of its
 *              base, for things that stand), +z its front
 *   front      the declared front: a yaw, a direction, "+z"/"-x"..., or null (none)
 *   show       the side to turn to a viewer, when it isn't the front (default: the front)
 *   tags       string[]
 *   colliders  boxes { c, h, yaw, mat } in the own frame (default: from the parts)
 *   sockets    { name: { kind, pos, yaw, extent, normal } } in the own frame; a
 *              "top" (the biggest free box top) and a "view" (in front, looking
 *              back at it) are added when not given
 *   rest       "base" (stands on its lowest point; default), "hang" (needs no
 *              support: a sign on a wall), "float"
 *   rails      [[ [x,y,z], ... ]] polylines in the own frame (grind lines)
 *   meta       anything else, kept
 */
export function defineObject<M extends object = Record<string, unknown>>(spec: ObjectSpec<M>): ObjectDef<M> {
  const { key, parts, front = null, show = null, tags = [], colliders = null, sockets = {}, rest = "base", rails = [], meta = {} as M } = spec ?? ({} as ObjectSpec<M>);
  if (typeof key !== "string" || !key) throw new TypeError("An object needs a string key.");
  if (!Array.isArray(parts) || !parts.length) throw new TypeError(`Object ${key} needs parts.`);
  if (!REST_MODES.has(rest)) throw new RangeError(`Object ${key}: rest is "base", "hang" or "float".`);
  const ps = parts.map((p) => (isWedgeLike(p) ? wedgeFromLike(p) : toPart(p as PartLike)) as ObjectPart);
  const cols: Collider[] = (colliders ?? collidersFromParts(ps)).map((b) => ({
    c: [...b.c] as Vec3, h: [...b.h] as Vec3, yaw: b.yaw ?? 0, mat: b.mat ?? 0,
    ...(b.part ? { part: b.part } : {}), ...(b.approx ? { approx: true as const } : {}), ...(b.capsule ? { capsule: true as const } : {}),
    ...(b.kind === "wedge" ? { kind: "wedge" as const, lo: b.lo ?? 0 } : {}),
  }));
  const local = localAabbOf({ parts: ps });
  const frontYaw = parseFront(front);
  // (The side to show a viewer, when it isn't the front: a piggy bank three-quarters, a stapler side-on.)
  const showYaw = show === null ? frontYaw : parseFront(show);
  const sock: Record<string, Socket> = {};
  for (const [name, s] of Object.entries(sockets)) sock[name] = normSocket(name, s);
  // The biggest free top, and where to look at it from, unless given.
  if (!sock["top"]) {
    const t = topsOf(ps, cols)[0];
    if (t) sock["top"] = { name: "top", kind: "top", pos: t.pos, yaw: t.yaw, extent: t.extent, auto: true };
  }
  if (!sock["view"] && showYaw !== null) {
    const size = Math.max(local[3] - local[0], local[4] - local[1], local[5] - local[2]);
    const reach = Math.max(Math.abs(local[0]), Math.abs(local[3]), Math.abs(local[2]), Math.abs(local[5]));
    const dist = reach + Math.max(1, size * 1.2);
    const f = [dsin(showYaw), dcos(showYaw)] as const;
    sock["view"] = { name: "view", kind: "view", pos: [f[0] * dist, (local[1] + local[4]) / 2, f[1] * dist], yaw: wrapAngle(showYaw + Math.PI), auto: true };
  }
  return {
    kind: "object",
    key,
    parts: ps,
    front: frontYaw,
    show: showYaw,
    tags: [...new Set(tags)].sort(),
    colliders: cols,
    sockets: sock,
    rest,
    rails: rails.map((r) => r.map((p) => [...p] as Vec3)),
    bounds: local,
    meta: { ...meta },
  };
}

/** The object's lowest point in its own frame (exact for box and capsule parts, marched for SDFs). Cached. */
const BOTTOMS = new WeakMap<object, number>();
export function bottomOf(def: Pick<ObjectDef<object>, "parts" | "bounds">): number {
  const have = BOTTOMS.get(def);
  if (have !== undefined) return have;
  const allPrims = def.parts.every((p) => p.prim);
  const y = allPrims ? def.bounds[1] : lowest(def.parts);
  BOTTOMS.set(def, y);
  return y;
}

// ---------------------------------------------------------------- instances

let nextInstance = 1;

/**
 * placeObject(def, { pos, yaw, scale, id, tags }) -> instance: a scene entity
 * (createEntity) with `def` and `key`. Objects stand upright: position, yaw
 * and a uniform scale only.
 */
export function placeObject<M extends object>(def: ObjectDef<M>, { pos = [0, 0, 0], yaw = 0, scale = 1, id = null, tags = [] }: Placement = {}): ObjectInstance<M> {
  if (!def || def.kind !== "object") throw new TypeError("placeObject needs a definition from defineObject.");
  const e = createEntity<ObjectPart>({
    id: id ?? `${def.key}#${nextInstance++}`,
    transform: { pos, yaw: wrapAngle(yaw), scale },
    parts: def.parts,
    tags: [...def.tags, ...tags],
    components: { object: { key: def.key } },
  });
  return { ...e, def, key: def.key };
}

/**
 * A copy moved/turned (fields merged over the old placement). It keeps the
 * instance's own tags (the proof of concept dropped them; give `tags` to replace them).
 */
export const movedObject = <M extends object>(inst: ObjectInstance<M>, patch: Placement): ObjectInstance<M> =>
  placeObject(inst.def, { pos: inst.transform.pos, yaw: inst.transform.yaw, scale: inst.transform.scale, id: inst.id, tags: inst.tags, ...patch });

/** World AABB. */
export const worldAabb = (inst: ObjectInstance<object>): Bounds => aabbOf(inst);
/** Local AABB (the definition's). */
export const localAabb = (inst: ObjectInstance<object> | ObjectDef<object>): Bounds => ("def" in inst ? inst.def : inst).bounds;

/** The footprint on the ground: its four corners (the local box turned and moved, x-z), and the world rectangle round them [x0, z0, x1, z1]. */
export interface Footprint {
  corners: [number, number][];
  rect: [number, number, number, number];
}
export function footprint(inst: ObjectInstance<object>): Footprint {
  const b = inst.def.bounds;
  const { pos, yaw, scale } = inst.transform;
  const corners = ([[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]] as const).map(([x, z]): [number, number] => {
    const w = localToWorld(pos, yaw, [x * scale, 0, z * scale]);
    return [w[0], w[2]];
  });
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return { corners, rect: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
}

/** A local collider box into the world (the instance's yaw adds to the box's). */
export function colliderToWorld(inst: { readonly transform: ObjectInstance<object>["transform"] }, b: ColliderSpec): WorldBox {
  const { pos, yaw, scale } = inst.transform;
  const out: WorldBox = {
    c: localToWorld(pos, yaw, [b.c[0] * scale, b.c[1] * scale, b.c[2] * scale]),
    h: [b.h[0] * scale, b.h[1] * scale, b.h[2] * scale],
    yaw: wrapAngle(yaw + (b.yaw ?? 0)),
    mat: b.mat ?? 0,
  };
  // (A wedge stays a wedge: physics' createCharacter and the renderer's setWorld read the kind.)
  if (b.kind === "wedge") { out.kind = "wedge"; out.lo = b.lo ?? 0; }
  return out;
}

/** Collider boxes in the world, ready for createCharacter({ boxes }) and setWorld({ boxes }). */
export const worldColliders = (inst: ObjectInstance<object>): WorldBox[] => inst.def.colliders.map((b) => colliderToWorld(inst, b));

/** Rails (polylines) in the world, for createCharacter({ rails }). */
export const worldRails = (inst: ObjectInstance<object>): Vec3[][] => inst.def.rails.map((r) => r.map((p) => toWorld(inst, p)));

/** One socket in the world: { name, kind, pos, yaw, dir, extent, ... } or null. */
export function socketOf(inst: ObjectInstance<object>, name: string): WorldSocket | null {
  const s = inst.def.sockets[name];
  if (!s) return null;
  const { yaw, scale } = inst.transform;
  const out: WorldSocket = { ...s, pos: toWorld(inst, s.pos) };
  if (s.yaw !== null && s.yaw !== undefined) {
    out.yaw = wrapAngle(s.yaw + yaw);
    out.dir = [dsin(out.yaw), 0, dcos(out.yaw)];
  }
  if (s.extent) out.extent = [s.extent[0] * scale, s.extent[1] * scale];
  if (s.normal) out.normal = dirToWorld(inst, s.normal);
  return out;
}

/** Every socket in the world, by name. */
export function worldSockets(inst: ObjectInstance<object>): Record<string, WorldSocket> {
  const out: Record<string, WorldSocket> = {};
  for (const name of Object.keys(inst.def.sockets)) out[name] = socketOf(inst, name)!;
  return out;
}

/** Sockets of a kind (in the world). */
export const socketsOfKind = (inst: ObjectInstance<object>, kind: SocketKind): WorldSocket[] => Object.values(worldSockets(inst)).filter((s) => s.kind === kind);

/** Is a world point on a top socket (inside its extent, within `tol` of its height)? For "can I put this here". */
export function onSocket(inst: ObjectInstance<object>, name: string, p: Vec3Like, tol = 0.02): boolean {
  const s = socketOf(inst, name);
  if (!s || !s.extent) return false;
  const l = worldToLocal(s.pos, s.yaw ?? 0, p);
  return Math.abs(l[0]) <= s.extent[0] && Math.abs(l[2]) <= s.extent[1] && Math.abs(l[1]) <= tol;
}

// ---------------------------------------------------------------- fronts

/** The object's front: declared (checked) or detected. See @keel-engine/scene detectFront. */
export const frontOfObject = (thing: ObjectInstance<object> | ObjectDef<object> | FrontThing, opts: FrontOptions = {}): FrontResult => detectFront(thing as FrontThing, opts);

/** The yaw that turns an instance's show side (its front, unless it declares another) toward a point: placeObject(def, { yaw: yawToShow(def, pos, eye) }). */
export function yawToShow(def: Pick<ObjectDef<object>, "show" | "front">, pos: Vec3Like, target: Vec3Like): number {
  const side = def.show ?? def.front ?? 0;
  return wrapAngle(datan2(target[0] - pos[0], target[2] - pos[2]) - side);
}

// ---------------------------------------------------------------- resting

/** What an object may rest on: an instance (its colliders), a box { c, h, yaw }, a number (a floor at that height), or { y } (the same). */
export type Support =
  | ObjectInstance<object>
  | { readonly c: Vec3Like; readonly h: Vec3Like; readonly yaw?: number | undefined; readonly name?: string | undefined }
  | number
  | { readonly y: number; readonly name?: string | undefined };

type SupportBox = { plane: number; from: EntityId; box?: undefined } | { box: { c: Vec3Like; h: Vec3Like; yaw: number }; from: EntityId; plane?: undefined };

function supportBoxes(supports: readonly Support[]): SupportBox[] {
  const out: SupportBox[] = [];
  for (const s of supports) {
    const o = s as Record<string, unknown> | null;
    if (typeof s === "number") out.push({ plane: s, from: "floor" });
    else if (o && typeof o["y"] === "number" && !o["c"]) out.push({ plane: o["y"], from: (o["name"] as string | undefined) ?? "floor" });
    // (A wedge's top slopes: it isn't a flat support -- things settle past it.)
    else if (o && o["def"] && o["transform"]) for (const b of worldColliders(s as ObjectInstance<object>)) { if (b.kind !== "wedge") out.push({ box: b, from: (s as ObjectInstance<object>).id }); }
    else if (o && o["c"] && o["h"]) out.push({ box: { c: o["c"] as Vec3Like, h: o["h"] as Vec3Like, yaw: (o["yaw"] as number | undefined) ?? 0 }, from: (o["name"] as string | undefined) ?? "box" });
    else throw new TypeError("A support is an object instance, a box { c, h, yaw }, a number or { y }.");
  }
  return out;
}

// Points on the underside: the bottoms of the parts that reach the lowest point, in the world.
function contactPoints(inst: ObjectInstance<object>, n = 5): Vec3[] {
  const def = inst.def;
  const low = bottomOf(def);
  const size = Math.max(def.bounds[4] - def.bounds[1], 1e-6);
  const feet = def.parts.filter((p) => p.bounds[1] <= low + size * 0.05 + 1e-6);
  const pts: Vec3[] = [];
  for (const p of feet) {
    const b = p.bounds;
    for (let i = 0; i < n; i += 1) for (let k = 0; k < n; k += 1) {
      const x = b[0] + ((b[3] - b[0]) * (i + 0.5)) / n;
      const z = b[2] + ((b[5] - b[2]) * (k + 0.5)) / n;
      // (Only where the part really reaches down: a column under a round foot, not its box's corners.)
      if (p.sdf(x, low + size * 0.06, z, 0, null) > size * 0.03) continue;
      pts.push(toWorld(inst, [x, low, z]));
    }
  }
  if (!pts.length) pts.push(toWorld(inst, [0, low, 0]));
  return pts;
}

export interface SettleOptions {
  /** How far above its underside a support's top may be (a thing sunk a little comes up). */
  readonly stepUp?: number;
  /** The furthest it may drop. */
  readonly maxDrop?: number;
  /** The share of its underside a support must cover. */
  readonly minCover?: number;
}
export interface SettleResult<M extends object = Record<string, unknown>> {
  /** The object moved so its lowest point is on the highest support under it. */
  instance: ObjectInstance<M>;
  /** How far it was above that support before (negative: sunk into it); null when nothing is under it. */
  gap: number | null;
  /** What it rests on (an id / "floor" / a name), or null. */
  support: EntityId | null;
  /** The share of its underside over that support (0..1). */
  cover: number;
  /** It now rests (or needs no support: rest "hang"/"float"). */
  rests: boolean;
}

/**
 * settle(inst, supports, { stepUp, maxDrop, minCover }): the object moved
 * straight down (or up) onto the highest support under it. A support counts
 * when its top is under the object's underside (within `stepUp` above it, so a
 * thing sunk a little comes up) and covers at least `minCover` of it. Nothing
 * floats: with no support, it is left where it is and `rests` is false.
 */
export function settle<M extends object>(inst: ObjectInstance<M>, supports: readonly Support[], { stepUp = 0.05, maxDrop = Infinity, minCover = 0.25 }: SettleOptions = {}): SettleResult<M> {
  const S = supportBoxes(supports.filter((s) => s !== inst && !(s && typeof s === "object" && "id" in s && s.id !== undefined && s.id === inst.id)));
  const bottom = inst.transform.pos[1] + bottomOf(inst.def) * inst.transform.scale;
  const pts = contactPoints(inst);
  let best: { top: number; from: EntityId; cover: number } | null = null;
  const offer = (top: number, from: EntityId, covered: number): void => {
    const cover = covered / pts.length;
    if (cover < minCover) return;
    if (top > bottom + stepUp || bottom - top > maxDrop) return;
    if (!best || top > best.top) best = { top, from, cover };
  };
  for (const s of S) {
    if (s.plane !== undefined) { offer(s.plane, s.from, pts.length); continue; }
    const top = s.box.c[1] + s.box.h[1];
    offer(top, s.from, pts.filter((p) => overTop(p, s.box)).length);
  }
  const found = best as { top: number; from: EntityId; cover: number } | null;
  if (!found) return { instance: inst, gap: null, support: null, cover: 0, rests: inst.def.rest !== "base" };
  const gap = bottom - found.top;
  const pos: Vec3 = [inst.transform.pos[0], inst.transform.pos[1] - gap, inst.transform.pos[2]];
  return { instance: movedObject(inst, { pos }), gap, support: found.from, cover: found.cover, rests: true };
}

/** Does it rest on this support: its underside within `tol` of the support's top, over it? */
export function restsOn(inst: ObjectInstance<object>, support: Support, { tol = 1e-3, minCover = 0.25 }: { readonly tol?: number; readonly minCover?: number } = {}): boolean {
  const bottom = inst.transform.pos[1] + bottomOf(inst.def) * inst.transform.scale;
  const pts = contactPoints(inst);
  for (const s of supportBoxes([support])) {
    if (s.plane !== undefined) { if (Math.abs(bottom - s.plane) <= tol) return true; continue; }
    const top = s.box.c[1] + s.box.h[1];
    if (Math.abs(bottom - top) <= tol && pts.filter((p) => overTop(p, s.box)).length / pts.length >= minCover) return true;
  }
  return false;
}

// ---------------------------------------------------------------- baking

/** Material names -> the renderer's indices (numbers pass through; an unknown name is 0). */
export type MatTable = Readonly<Record<string, number>>;
const matIndex = (m: Mat | null | undefined, mats: MatTable | null): number => (typeof m === "number" ? m : mats && typeof m === "string" && m in mats ? mats[m]! : 0);

/** A box for the renderer (a wedge among them says so by its kind, as setWorld reads it). */
export interface RendererBox { c: Vec3; h: Vec3; yaw: number; mat: number; kind?: "wedge"; lo?: number }
export interface RendererCapsule { a: Vec3; b: Vec3; r: number; mat: number }
export interface RendererBake {
  boxes: RendererBox[];
  capsules: RendererCapsule[];
  /** SDF parts the renderer can't draw. */
  skipped: { id: EntityId; part: string | undefined }[];
}
export interface PhysicsBake {
  boxes: RendererBox[];
  rails: Vec3[][];
}

/**
 * bakeForRenderer(instances, { mats, bounds }) -> { boxes, capsules, skipped }
 * for the GPU renderer's setWorld({ boxes, capsules }): box parts as boxes,
 * capsule parts as capsules, in the world. `mats` maps material names to the
 * renderer's material indices (numbers pass through). SDF parts the renderer
 * can't draw are listed in `skipped` -- or drawn as their bounds with
 * `bounds: true`.
 */
export function bakeForRenderer(instances: readonly ObjectInstance<object>[], { mats = null, bounds = false }: { readonly mats?: MatTable | null; readonly bounds?: boolean } = {}): RendererBake {
  const boxes: RendererBox[] = [];
  const capsules: RendererCapsule[] = [];
  const skipped: RendererBake["skipped"] = [];
  for (const inst of instances) {
    const { scale } = inst.transform;
    for (const p of inst.def.parts) {
      if (p.render === false) continue;
      const mat = matIndex(p.mat, mats);
      const prim = p.prim;
      if (p.wedge) boxes.push({ ...colliderToWorld(inst, { ...p.wedge, kind: "wedge" }), mat });
      else if (prim?.type === "box") boxes.push({ ...colliderToWorld(inst, prim), mat });
      else if (prim?.type === "capsule") capsules.push({ a: toWorld(inst, prim.a), b: toWorld(inst, prim.b), r: prim.r * scale, mat });
      else if (bounds) {
        const b = p.bounds;
        boxes.push({ ...colliderToWorld(inst, { c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h: [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], yaw: 0 }), mat });
      } else skipped.push({ id: inst.id, part: p.name });
    }
  }
  return { boxes, capsules, skipped };
}

/** bakeForPhysics(instances) -> { boxes, rails } for createCharacter({ boxes, rails }). */
export function bakeForPhysics(instances: readonly ObjectInstance<object>[], { mats = null }: { readonly mats?: MatTable | null } = {}): PhysicsBake {
  const boxes: RendererBox[] = [];
  const rails: Vec3[][] = [];
  for (const inst of instances) {
    for (const b of worldColliders(inst)) boxes.push({ ...b, mat: matIndex(b.mat, mats) });
    rails.push(...worldRails(inst));
  }
  return { boxes, rails };
}
