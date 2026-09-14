// Front detection: which way a thing faces, worked out from what it is made
// of -- and a declared front checked against that. Ported from the proof of
// concept's src/scene/front.js; test/poc-equality.test.ts proves the results
// identical.
//
//   detectFront(thing, opts) -> {
//     yaw, dir          the front, in the world when the thing has a transform
//                       (an entity, an object instance), else in its own frame
//     confidence        0..1
//     declared          was a front declared (a `front` field, or NOCTURNES' facing flag)?
//     agrees            does the evidence agree with it? (true / false / null: can't tell)
//     symmetric         nothing tells a front (a ball, a vase, a plain table)
//     symmetry          "round" | "mirror" | null
//     axisYaw           the front lies along +-this (a bench: square to its length)
//     detected          { yaw, dir, confidence } from the evidence alone
//     local             { yaw, dir } in the thing's own frame
//     layers            { features, useCase, geometry }: each { yaw, strength, ... }
//     why               [plain-English lines]
//   }
//
// The evidence, in layers (all in the thing's own frame, +z front, core frame):
//   a. DECLARED   a `front` (yaw, direction or "+z"-style) wins -- but is checked.
//   b. FEATURES   parts named like a face, a screen, a cone, a door (FEATURES,
//                 extendable): where they are seen from, round a ring of views,
//                 where they sit off the body, and any normal a part carries
//                 (NOCTURNES screens carry their axes).
//   c. GEOMETRY   with nothing named: round a ring of views, which side is
//                 recessed (a chair's seat, a shelf), busier with edges and small
//                 parts, a broad flat face; which side the mass leans away from.
//                 Symmetric things come back symmetric, with low confidence.
//   d. USE        a seat faces out from its backrest; a screen away from its
//                 stand; shelves away from their back; a lamp where its head reaches.
//
// Everything is measured in the thing's own frame and turned by its transform,
// so the answer turns exactly with the thing. Raw world-space boxes and
// capsules (no transform) are measured where they are: the ring of views is
// laid along the thing's own principal axis, so that turns with it too.

import { wrapAngle } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { dirToWorld } from "./entity.ts";
import type { Turned } from "./entity.ts";
import { unionBounds } from "./kit.ts";
import type { Bounds, BoundsLike, Mat3Like, SdfPart } from "./kit.ts";
import { rayAabb } from "./bounds.ts";
import { toPart } from "./prims.ts";
import type { BoxSpec, CapsuleSpec, PartExtras, PartLike } from "./prims.ts";

// ---------------------------------------------------------------- types

export type FeatureSide = "front" | "back";
/** What a word says: the part is on the front (a screen, an eye) or behind (a backrest, a tail), and how sure. */
export interface Feature {
  readonly side: FeatureSide;
  readonly weight: number;
}
/** A feature found on a part, and the word that found it. */
export interface FeatureHit extends Feature {
  readonly word: string;
}
/** From the parts named in `from` toward the parts named in `to` is the front. */
export interface UseCase {
  readonly why: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
}

/**
 * A front, in any of its spellings: a yaw, a direction [x, y, z], "+z" /
 * "-z" / "+x" / "-x" (or front/back/right/left), true (+z), or { yaw } / { dir }.
 * null, undefined and false mean none.
 */
export type FrontSpec = number | boolean | string | Vec3Like | { readonly yaw?: FrontSpec; readonly dir?: Vec3Like } | null | undefined;

/** A thing to find the front of: parts (or raw boxes and capsules), maybe placed, maybe with a declared front. */
export interface FrontSource {
  readonly parts?: readonly PartLike[];
  readonly boxes?: ReadonlyArray<PartExtras & BoxSpec>;
  readonly capsules?: ReadonlyArray<PartExtras & CapsuleSpec>;
  /** Only its rotation is read: the front is turned into the world by it. */
  readonly transform?: Turned;
  readonly front?: FrontSpec;
  readonly def?: { readonly front?: FrontSpec };
  readonly components?: Readonly<Record<string, unknown>>;
  /** NOCTURNES' facing flag: true reads as "+z"; false says it was authored with no front. */
  readonly facing?: boolean;
}
/** An object definition or instance, an entity, an array of parts/prims, or { boxes, capsules }. */
export type FrontThing = readonly PartLike[] | FrontSource;

export interface FrontOptions {
  /** A declared front to check (overrides the thing's own; null also ignores a facing flag). */
  readonly front?: FrontSpec;
  /** Words added to the vocabulary for this call. */
  readonly features?: Readonly<Record<string, Feature>>;
  /** Replaces USE_CASES for this call. */
  readonly useCases?: readonly UseCase[];
  /** The ring's sampling. */
  readonly dirs?: number;
  readonly grid?: number;
  readonly elevation?: number;
  readonly steps?: number;
  readonly massGrid?: number;
  /** A frontEvidence() result to reuse (the same parts, another placement). */
  readonly evidence?: FrontEvidence;
}

export type Symmetry = "round" | "mirror" | null;

export interface FrontLayers {
  readonly features: { yaw: number; strength: number; words: string[]; seen: number; offset: number; up: number } | null;
  readonly useCase: { yaw: number; strength: number } | null;
  readonly geometry: { yaw: number; strength: number; recess: number; edges: number; flat: number; mass: number };
}

/** The evidence alone, in the parts' own frame. */
export interface FrontEvidence {
  readonly yaw: number;
  readonly dir: Vec3;
  readonly confidence: number;
  readonly symmetric: boolean;
  readonly symmetry: Symmetry;
  /** How much of the named front faces up: a lying phone, a keyboard's keys. */
  readonly up: number;
  /** Square to the long axis: where a front would be, either way. */
  readonly axisYaw: number;
  readonly layers: FrontLayers;
  readonly agreement: number;
  readonly why: string[];
}

export interface FrontResult {
  readonly yaw: number;
  readonly dir: Vec3;
  readonly confidence: number;
  readonly declared: boolean;
  readonly declaredYaw: number | null;
  readonly agrees: boolean | null;
  readonly symmetric: boolean;
  readonly symmetry: Symmetry;
  readonly axisYaw: number;
  readonly detected: { yaw: number; dir: Vec3; confidence: number };
  readonly local: { yaw: number; dir: Vec3; detectedYaw: number };
  readonly layers: FrontLayers;
  readonly why: string[];
}

/** A horizontal vector [x, z]. */
type V2 = [number, number];

// Fields front detection reads off a part besides its shape (all optional, all checked).
const fieldOf = (p: object, k: string): unknown => (p as Record<string, unknown>)[k];

// ---------------------------------------------------------------- vocabulary

/**
 * What a part's name says about the front. side "front": the part is on the
 * front (a screen, an eye); "back": it is behind (a backrest, a tail).
 * Weight: how sure the word is. Extend with defineFeature().
 */
export const FEATURES = new Map<string, Feature>();
const F = (weight: number): Feature => ({ side: "front", weight });
const B = (weight: number): Feature => ({ side: "back", weight });
for (const [word, spec] of Object.entries({
  // (Faces: what looks out.)
  face: F(1.2), eye: F(1), nose: F(1), mouth: F(0.8), snout: F(1), beak: F(1), visor: F(1), grin: F(0.8), brow: F(0.6),
  // (What shows.)
  screen: F(1.5), display: F(1.5), lcd: F(1.2), lens: F(1.2), dial: F(0.8), gauge: F(0.8), bezel: F(0.8), clockface: F(1.2), readout: F(1),
  photo: F(1.2), picture: F(1.2), portrait: F(1.2), poster: F(1), soundhole: F(1), fretboard: F(0.6), chute: F(0.8),
  // (What sounds.)
  cone: F(1.1), speaker: F(1), grille: F(1), grill: F(1), woofer: F(1.1), tweeter: F(1.1),
  // (What's worked from the front.)
  knob: F(0.6), button: F(0.5), buttons: F(0.5), key: F(0.3), keypad: F(0.5), slot: F(0.5), tray: F(0.5), switch: F(0.3),
  // (What opens.)
  door: F(1.2), drawer: F(1.2), opening: F(1), hatch: F(1), headlight: F(1), front: F(1.5), fascia: F(1), label: F(0.4),
  // (Behind.)
  back: B(1.2), backrest: B(1.5), rear: B(1.2), tail: B(1), hinge: B(0.5), cable: B(0.3), cord: B(0.3), plug: B(0.3), vent: B(0.3),
})) FEATURES.set(word, spec);

/** Add (or replace) a feature word: defineFeature("porthole", { side: "front", weight: 1 }). */
export function defineFeature(word: string, { side = "front", weight = 1 }: Partial<Feature> = {}): void {
  if (side !== "front" && side !== "back") throw new RangeError('A feature side is "front" or "back".');
  if (!(weight > 0)) throw new RangeError("A feature weight must be positive.");
  FEATURES.set(String(word).toLowerCase(), { side, weight });
}

/**
 * Use cases: from the parts named in `from` toward the parts named in `to`
 * is the front. Extend with defineUseCase().
 */
export const USE_CASES: UseCase[] = [
  { why: "a seat faces out from its backrest", from: ["backrest", "back"], to: ["seat", "cushion", "saddle"] },
  { why: "a screen faces away from its stand", from: ["stand", "neck", "mount", "bracket", "easel", "kickstand"], to: ["screen", "display", "panel", "sign", "board", "face"] },
  { why: "a picture faces away from the leg it leans on", from: ["leg", "easel", "kickstand"], to: ["photo", "picture", "portrait", "canvas"] },
  { why: "shelves open away from their back", from: ["back", "backboard", "backpanel"], to: ["shelf", "drawer", "door"] },
  { why: "a lamp faces where its head reaches", from: ["post", "pole", "column"], to: ["head", "lantern", "shade", "bulb", "lamp"] },
];
export function defineUseCase({ why, from, to }: { readonly why?: string; readonly from: readonly string[]; readonly to: readonly string[] }): void {
  if (!Array.isArray(from) || !Array.isArray(to) || !from.length || !to.length) throw new TypeError("A use case needs from[] and to[] words.");
  USE_CASES.push({ why: why ?? `${to[0]} faces away from ${from[0]}`, from: from.map((w) => w.toLowerCase()), to: to.map((w) => w.toLowerCase()) });
}

/** A part's words: its name (and role) split on spaces, dashes and camelCase, lower-cased. */
export function wordsOf(p: object): string[] {
  const text = [fieldOf(p, "role"), fieldOf(p, "name"), fieldOf(p, "feature")].filter((v): v is string => typeof v === "string").join(" ");
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

// A word, or its singular: [the table's word, its entry], or null.
const lookup = (w: string, table: ReadonlyMap<string, Feature>): [string, Feature] | null => {
  if (table.has(w)) return [w, table.get(w)!];
  const one = w.slice(0, -1);
  return w.endsWith("s") && table.has(one) ? [one, table.get(one)!] : null;
};

/** What a part says about the front: { side, weight, word } or null. Screen materials count as screens. */
export function featureOf(p: object, table: ReadonlyMap<string, Feature> = FEATURES): FeatureHit | null {
  if (fieldOf(p, "feature") === false) return null;
  let best: FeatureHit | null = null;
  for (const w of wordsOf(p)) {
    const hit = lookup(w, table);
    if (hit && (!best || hit[1].weight > best.weight)) best = { ...hit[1], word: hit[0] };
  }
  const mat = fieldOf(p, "mat");
  if (!best && (mat === "screen" || mat === "lcd")) best = { ...(table.get("screen") ?? F(1.5)), word: `mat:${mat}` };
  return best;
}

const hasWord = (p: object, list: readonly string[]): boolean => wordsOf(p).some((w) => list.includes(w) || (w.endsWith("s") && list.includes(w.slice(0, -1))));

// ---------------------------------------------------------------- fronts as data

/**
 * A declared front, in any of its spellings, as a yaw in the thing's own frame:
 * a yaw number, a direction [x, y, z], "+z" / "-z" / "+x" / "-x", or
 * { yaw } / { dir }. Null for none.
 */
export function parseFront(front: FrontSpec): number | null {
  if (front === null || front === undefined || front === false) return null;
  if (typeof front === "number") return wrapAngle(front);
  if (front === true) return 0;
  if (typeof front === "string") {
    const names: Record<string, number> = { "+z": 0, z: 0, front: 0, "-z": Math.PI, back: Math.PI, "+x": Math.PI / 2, x: Math.PI / 2, right: Math.PI / 2, "-x": -Math.PI / 2, left: -Math.PI / 2 };
    const m = names[front.trim().toLowerCase()];
    if (m === undefined) throw new RangeError(`Unknown front "${front}".`);
    return wrapAngle(m);
  }
  if (Array.isArray(front)) {
    const v = front as unknown as Vec3Like;
    if (Math.hypot(v[0], v[2]) < 1e-9) throw new RangeError("A front direction needs a horizontal part.");
    return Math.atan2(v[0], v[2]);
  }
  if (typeof front === "object") {
    const o = front as { readonly yaw?: FrontSpec; readonly dir?: Vec3Like };
    if (o.yaw !== undefined) return parseFront(o.yaw);
    if (o.dir) return parseFront(o.dir);
  }
  throw new TypeError("A front is a yaw, a direction, a '+z'-style name, or { yaw } / { dir }.");
}

const dirOfYaw = (y: number): Vec3 => [Math.sin(y), 0, Math.cos(y)];
const yawOfV = (v: V2): number => Math.atan2(v[0], v[1]); // (v is horizontal [x, z])
/** The unsigned angle between two yaws, 0..PI. */
export const angleBetween = (a: number, b: number): number => Math.abs(wrapAngle(a - b));

// ---------------------------------------------------------------- the thing, normalised

interface Normalised {
  parts: SdfPart[];
  transform: Turned | null;
  declared: number | null;
  declaredFrom: string | null;
  facingFlag: boolean | undefined;
}

function normalise(thing: FrontThing, opts: FrontOptions): Normalised {
  let parts: SdfPart[];
  let transform: Turned | null = null;
  let declared: number | null = null;
  let declaredFrom: string | null = null;
  const src: FrontSource = Array.isArray(thing) ? { parts: thing as readonly PartLike[] } : (thing as FrontSource);
  if (!src || typeof src !== "object") throw new TypeError("detectFront needs an object, an entity, parts, or { boxes, capsules }.");
  if (Array.isArray(src.parts)) parts = src.parts.map(toPart);
  else parts = [];
  for (const b of src.boxes ?? []) parts.push(toPart({ name: b.name ?? "box", ...b }));
  for (const c of src.capsules ?? []) parts.push(toPart({ name: c.name ?? "capsule", ...c }));
  if (!parts.length) throw new RangeError("detectFront: the thing has no parts.");
  if (src.transform) transform = src.transform;
  const pick: Array<[string, unknown]> = [["opts.front", opts.front], ["front", src.front], ["def.front", src.def?.front], ["components.front", src.components?.["front"]]];
  for (const [from, v] of pick) {
    if (v !== undefined && v !== null) { declared = parseFront(v as FrontSpec); declaredFrom = from; break; }
  }
  if (declared === null && src.facing === true && opts.front !== null) { declared = 0; declaredFrom = "facing flag (+z)"; }
  return { parts, transform, declared, declaredFrom, facingFlag: src.facing };
}

// ---------------------------------------------------------------- sampling

interface Hit { t: number; part: number; p: Vec3 }
interface Field {
  dist(x: number, y: number, z: number): number;
  hit(o: Vec3Like, dir: Vec3Like, eps: number, steps: number): Hit | null;
}

/** The parts as a field: distance, and first hit along a ray with the parts it could meet. */
function fieldOf3(parts: readonly SdfPart[], pad: number): Field {
  const boxes: Bounds[] = parts.map((p) => [p.bounds[0] - pad, p.bounds[1] - pad, p.bounds[2] - pad, p.bounds[3] + pad, p.bounds[4] + pad, p.bounds[5] + pad]);
  const dist = (x: number, y: number, z: number): number => {
    let d = Infinity;
    for (let i = 0; i < parts.length; i += 1) {
      const b = boxes[i]!;
      // (Outside a part's padded box, the box is a lower bound on its distance: skip the SDF.)
      const ox = Math.max(b[0] - x, 0, x - b[3]);
      const oy = Math.max(b[1] - y, 0, y - b[4]);
      const oz = Math.max(b[2] - z, 0, z - b[5]);
      const lb = Math.hypot(ox, oy, oz);
      if (lb >= d) continue;
      const v = parts[i]!.sdf(x, y, z, 0, null);
      if (v < d) d = v;
    }
    return d;
  };
  const hit = (o: Vec3Like, dir: Vec3Like, eps: number, steps: number): Hit | null => {
    const cand: number[] = [];
    let t0 = Infinity;
    let t1 = -Infinity;
    for (let i = 0; i < parts.length; i += 1) {
      const s = rayAabb(o, dir, boxes[i]!);
      if (!s) continue;
      cand.push(i);
      if (s[0] < t0) t0 = s[0];
      if (s[1] > t1) t1 = s[1];
    }
    if (!cand.length) return null;
    let t = t0;
    for (let n = 0; n < steps && t <= t1; n += 1) {
      const x = o[0] + dir[0] * t;
      const y = o[1] + dir[1] * t;
      const z = o[2] + dir[2] * t;
      let d = Infinity;
      let who = -1;
      for (const i of cand) {
        const v = parts[i]!.sdf(x, y, z, 0, null);
        if (v < d) { d = v; who = i; }
      }
      if (d < eps) return { t, part: who, p: [x, y, z] };
      t += Math.max(d * 0.9, eps);
    }
    return null;
  };
  return { dist, hit };
}

interface Mass { centroid: Vec3; axisYaw: number; ratio: number; mid: Vec3; n: number; cell?: number }

/** Occupied samples on a grid: centroid, principal axis (a yaw), the spread along it. */
function massOf(field: Field, B: BoundsLike, n: number): Mass {
  const ext = [B[3] - B[0], B[4] - B[1], B[5] - B[2]] as const;
  const cell = Math.max(...ext) / n;
  let m = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const pts: number[] = [];
  const nx = Math.max(2, Math.ceil(ext[0] / cell));
  const ny = Math.max(2, Math.ceil(ext[1] / cell));
  const nz = Math.max(2, Math.ceil(ext[2] / cell));
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < ny; j += 1) for (let k = 0; k < nz; k += 1) {
    const x = B[0] + ((i + 0.5) * ext[0]) / nx;
    const y = B[1] + ((j + 0.5) * ext[1]) / ny;
    const z = B[2] + ((k + 0.5) * ext[2]) / nz;
    // (Near the surface counts: a sign a few cells thin still has its weight.)
    if (field.dist(x, y, z) < cell * 0.5) { m += 1; sx += x; sy += y; sz += z; pts.push(x, z); }
  }
  if (!m) {
    const c: Vec3 = [(B[0] + B[3]) / 2, (B[1] + B[4]) / 2, (B[2] + B[5]) / 2];
    return { centroid: c, axisYaw: 0, ratio: 1, mid: c, n: 0 };
  }
  const c: Vec3 = [sx / m, sy / m, sz / m];
  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i]! - c[0];
    const dz = pts[i + 1]! - c[2];
    cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
  }
  // The long axis of the footprint (as a yaw: the direction [sin, cos]).
  const tr = cxx + czz;
  const det = cxx * czz - cxz * cxz;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  let ex = cxz;
  let ez = l1 - cxx;
  if (Math.hypot(ex, ez) < 1e-12) { ex = cxx >= czz ? 1 : 0; ez = cxx >= czz ? 0 : 1; }
  const axisYaw = Math.atan2(ex, ez);
  // The middle of the footprint's extent along its own axes (not the world box's): turns with the thing.
  const a1: V2 = [Math.sin(axisYaw), Math.cos(axisYaw)];
  const a2: V2 = [a1[1], -a1[0]];
  let lo1 = Infinity; let hi1 = -Infinity; let lo2 = Infinity; let hi2 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i]! - c[0];
    const dz = pts[i + 1]! - c[2];
    const u = dx * a1[0] + dz * a1[1];
    const v = dx * a2[0] + dz * a2[1];
    if (u < lo1) lo1 = u;
    if (u > hi1) hi1 = u;
    if (v < lo2) lo2 = v;
    if (v > hi2) hi2 = v;
  }
  const m1 = (lo1 + hi1) / 2;
  const m2 = (lo2 + hi2) / 2;
  const mid: Vec3 = [c[0] + a1[0] * m1 + a2[0] * m2, c[1], c[2] + a1[1] * m1 + a2[1] * m2];
  return { centroid: c, axisYaw, ratio: l1 > 0 ? l2 / l1 : 1, mid, n: m, cell };
}

// Add the outward normal of the part hit, at the hit, to its running sum (features only).
function addNormal(nsum: Float64Array, parts: readonly SdfPart[], h: Hit, e: number, w: number): void {
  const f = parts[h.part]!.sdf;
  const [x, y, z] = h.p;
  const gx = f(x + e, y, z, 0, null) - f(x - e, y, z, 0, null);
  const gy = f(x, y + e, z, 0, null) - f(x, y - e, z, 0, null);
  const gz = f(x, y, z + e, 0, null) - f(x, y, z - e, 0, null);
  const l = Math.hypot(gx, gy, gz);
  if (!(l > 0)) return;
  nsum[h.part * 4] = nsum[h.part * 4]! + (gx / l) * w;
  nsum[h.part * 4 + 1] = nsum[h.part * 4 + 1]! + (gy / l) * w;
  nsum[h.part * 4 + 2] = nsum[h.part * 4 + 2]! + (gz / l) * w;
  nsum[h.part * 4 + 3] = nsum[h.part * 4 + 3]! + w;
}

interface View {
  yaw: number;
  uh: Vec3;
  hits: number;
  front: number;
  behind: number;
  edges: number;
  recess: number;
  flat: number;
  parts: number;
  perPart: Float64Array;
}
type ViewMeasure = "hits" | "front" | "behind" | "edges" | "recess" | "flat";

interface RingSpec {
  dirs: number; grid: number; elevation: number; phase: number; center: Vec3; radius: number; R: number; B: BoundsLike; eps: number; steps: number; nsum: Float64Array;
}

/**
 * Views round a ring: for each direction u_k (horizontal, from the thing
 * toward the viewer), an orthographic grid of rays looking back at it from a
 * little above. Per view: feature and back-feature visibility, edges
 * (depth steps and part changes), recess (how far in the surface is), a broad
 * flat face.
 */
function ringOf(parts: readonly SdfPart[], field: Field, feats: ReadonlyArray<FeatureHit | null>, { dirs, grid, elevation, phase, center, radius, R, B, eps, steps, nsum }: RingSpec): View[] {
  const views: View[] = [];
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  const diam = 2 * radius;
  // (The grid spans the footprint's circle, the same from every side: a ball
  // looks the same from everywhere, and a turned thing is sampled as it was.)
  const s0 = -R;
  const s1 = R;
  const v0 = (B[1] - center[1]) * ce - R * se;
  const v1 = (B[4] - center[1]) * ce + R * se;
  const supp = R;
  for (let k = 0; k < dirs; k += 1) {
    const th = phase + (k * 2 * Math.PI) / dirs;
    const uh: Vec3 = [Math.sin(th), 0, Math.cos(th)];
    const u: Vec3 = [uh[0] * ce, se, uh[2] * ce]; // (toward the viewer)
    const d: Vec3 = [-u[0], -u[1], -u[2]];
    const r: Vec3 = [Math.cos(th), 0, -Math.sin(th)];
    const up: Vec3 = [-uh[0] * se, ce, -uh[2] * se];
    const back = radius * 2.2;
    const depth = new Float64Array(grid * grid).fill(NaN);
    const who = new Int32Array(grid * grid).fill(-1);
    // (Seen area per part: cells times each cell's area, so views and the top view compare.)
    const cellArea = ((s1 - s0) / grid) * ((v1 - v0) / grid);
    const perPart = new Float64Array(parts.length);
    let hits = 0;
    let front = 0;
    let behind = 0;
    let recess = 0;
    for (let i = 0; i < grid; i += 1) {
      const s = s0 + ((i + 0.5) * (s1 - s0)) / grid;
      for (let j = 0; j < grid; j += 1) {
        const v = v0 + ((j + 0.5) * (v1 - v0)) / grid;
        const o: Vec3 = [
          center[0] + u[0] * back + r[0] * s + up[0] * v,
          center[1] + u[1] * back + r[1] * s + up[1] * v,
          center[2] + u[2] * back + r[2] * s + up[2] * v,
        ];
        const h = field.hit(o, d, eps, steps);
        if (!h) continue;
        hits += 1;
        const proj = (h.p[0] - center[0]) * uh[0] + (h.p[2] - center[2]) * uh[2];
        depth[i * grid + j] = proj;
        who[i * grid + j] = h.part;
        perPart[h.part] = perPart[h.part]! + cellArea;
        recess += (supp - proj) / diam;
        const f = feats[h.part];
        if (f) {
          if (f.side === "front") front += f.weight; else behind += f.weight;
          addNormal(nsum, parts, h, eps * 4, cellArea);
        }
      }
    }
    const rays = grid * grid;
    // Edges: neighbouring rays that both hit but step in depth, or change part.
    let edges = 0;
    let pairs = 0;
    let top = -Infinity;
    for (let n = 0; n < rays; n += 1) if (depth[n]! > top) top = depth[n]!;
    let flat = 0;
    for (let i = 0; i < grid; i += 1) for (let j = 0; j < grid; j += 1) {
      const a = i * grid + j;
      if (Number.isNaN(depth[a])) continue;
      if (depth[a]! >= top - 0.025 * diam) flat += 1;
      for (const b of [i + 1 < grid ? a + grid : -1, j + 1 < grid ? a + 1 : -1]) {
        if (b < 0 || Number.isNaN(depth[b])) continue;
        pairs += 1;
        if (who[a] !== who[b] || Math.abs(depth[a]! - depth[b]!) > 0.04 * diam) edges += 1;
      }
    }
    views.push({
      yaw: th, uh, hits: hits / rays,
      front: front / rays, behind: behind / rays,
      edges: pairs ? edges / pairs : 0,
      recess: hits ? recess / hits : 0,
      flat: flat / rays,
      parts: new Set(Array.from(who).filter((w) => w >= 0)).size,
      perPart,
    });
  }
  return views;
}

// Front/back contrast of one measure round the ring, as a horizontal vector
// [x, z] (length about 1 for a clean one-sided profile).
function contrast(views: readonly View[], key: ViewMeasure, floor: number): V2 {
  const n = views.length;
  const half = n / 2;
  let x = 0;
  let z = 0;
  for (let k = 0; k < n; k += 1) {
    const a = views[k]![key];
    const b = views[(k + half) % n]![key];
    const c = (a - b) / (a + b + floor);
    x += c * views[k]!.uh[0];
    z += c * views[k]!.uh[2];
  }
  return [(2 * x) / n, (2 * z) / n];
}

const len2 = (v: V2): number => Math.hypot(v[0], v[1]);
const scale2 = (v: V2, k: number): V2 => [v[0] * k, v[1] * k];
const clamp2 = (v: V2, m = 1): V2 => { const l = len2(v); return l > m ? scale2(v, m / l) : v; };
const deg = (a: number): string => `${Math.round((a * 180) / Math.PI)}°`;

// What is seen from straight above: each part's share of a grid of rays
// looking down (a lying screen, keys, face buttons: things that face up).
function topView(parts: readonly SdfPart[], field: Field, feats: ReadonlyArray<FeatureHit | null>, { center, R, B, grid, eps, steps, nsum }: Pick<RingSpec, "center" | "R" | "B" | "grid" | "eps" | "steps" | "nsum">): Float64Array {
  const seen = new Float64Array(parts.length);
  const y = B[4] + (B[4] - B[1]) * 0.1 + eps * 10;
  for (let i = 0; i < grid; i += 1) for (let j = 0; j < grid; j += 1) {
    const o: Vec3 = [center[0] - R + ((i + 0.5) * 2 * R) / grid, y, center[2] - R + ((j + 0.5) * 2 * R) / grid];
    const h = field.hit(o, [0, -1, 0], eps, steps);
    if (!h) continue;
    seen[h.part] = seen[h.part]! + ((2 * R) / grid) ** 2;
    if (feats[h.part]) addNormal(nsum, parts, h, eps * 4, ((2 * R) / grid) ** 2);
  }
  return seen;
}

// A part's centroid from inside it (its bounds can be far bigger than it: a
// swivelling seat's bounds are the circle it sweeps). Falls back to the bounds' middle.
function solidCentroid(p: SdfPart, n = 8): [number, number, number, number] {
  const b = p.bounds;
  let m = 0; let x = 0; let y = 0; let z = 0;
  const cell = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / n;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) for (let k = 0; k < n; k += 1) {
    const px = b[0] + ((i + 0.5) * (b[3] - b[0])) / n;
    const py = b[1] + ((j + 0.5) * (b[4] - b[1])) / n;
    const pz = b[2] + ((k + 0.5) * (b[5] - b[2])) / n;
    if (p.sdf(px, py, pz, 0, null) < cell * 0.35) { m += 1; x += px; y += py; z += pz; }
  }
  return m ? [x / m, y / m, z / m, m] : [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, 0];
}

function centroidOf(list: readonly SdfPart[]): Vec3 | null {
  let w = 0; let x = 0; let y = 0; let z = 0;
  for (const p of list) {
    const c = solidCentroid(p);
    const b = p.bounds;
    const v = Math.max(1e-9, (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2])) ** (1 / 3);
    w += v; x += c[0] * v; y += c[1] * v; z += c[2] * v;
  }
  return w ? [x / w, y / w, z / w] : null;
}

// The rotation a NOCTURNES-style part carries (present() leaves `rot`), applied to a direction.
const applyRot = (m: Mat3Like | undefined, v: Vec3Like): Vec3Like => (m ? [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]] : v);
const cross = (a: Vec3Like, b: Vec3Like): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A normal a part declares: `normal`, or a NOCTURNES screen's axes (ax x ay), turned by its `rot`. */
function declaredNormal(p: object): Vec3Like | null {
  const normal = fieldOf(p, "normal");
  if (Array.isArray(normal)) return normal as unknown as Vec3Like;
  const screen = fieldOf(p, "screen") as { ax?: unknown; ay?: unknown } | null | undefined;
  if (screen && Array.isArray(screen.ax) && Array.isArray(screen.ay)) {
    return applyRot(fieldOf(p, "rot") as Mat3Like | undefined, cross(screen.ax as unknown as Vec3Like, screen.ay as unknown as Vec3Like));
  }
  return null;
}

// ---------------------------------------------------------------- the evidence

interface Layer { v: V2 }

/**
 * The evidence alone, in the parts' own frame: { yaw, confidence, layers,
 * symmetric, symmetry, axisYaw, why }.
 */
export function frontEvidence(partsIn: readonly PartLike[], opts: FrontOptions = {}): FrontEvidence {
  const parts = partsIn.map(toPart);
  const table: ReadonlyMap<string, Feature> = opts.features ? new Map([...FEATURES, ...Object.entries(opts.features)]) : FEATURES;
  const B = unionBounds(parts.map((p) => p.bounds));
  const size = Math.max(B[3] - B[0], B[4] - B[1], B[5] - B[2]) || 1;
  const field = fieldOf3(parts, size * 0.002);
  const mass = massOf(field, B, opts.massGrid ?? 16);
  const center = mass.centroid;
  let radius = 0;
  for (const x of [B[0], B[3]]) for (const y of [B[1], B[4]]) for (const z of [B[2], B[5]]) radius = Math.max(radius, Math.hypot(x - center[0], y - center[1], z - center[2]));
  const corners: ReadonlyArray<readonly [number, number]> = [[B[0], B[2]], [B[0], B[5]], [B[3], B[2]], [B[3], B[5]]];
  const R = Math.max(1e-6, Math.max(...corners.map(([x, z]) => Math.hypot(x - center[0], z - center[2]))));
  const feats = parts.map((p) => featureOf(p, table));
  const why: string[] = [];

  // (Per part: the sum of the outward normals where it was seen, and the area they stand for.)
  const nsum = new Float64Array(parts.length * 4);
  const views = ringOf(parts, field, feats, {
    dirs: opts.dirs ?? 24, grid: opts.grid ?? 12, elevation: opts.elevation ?? 0.2, phase: mass.axisYaw,
    center, radius, R, B, eps: size * 0.0015, steps: opts.steps ?? 90, nsum,
  });

  // ---- b. features
  const featured = parts.map((p, i) => ({ p, f: feats[i]!, i })).filter((q) => q.f);
  let features: (Layer & { vis: V2; surf: V2; offset: V2; normal: V2 | null; up: number; words: string[] }) | null = null;
  let up = 0;
  if (featured.length) {
    // Which way each feature's visible surface faces (from the sides and from
    // above): out (a screen), or up (keys, face buttons, a lying screen).
    topView(parts, field, feats, { center, R, B, grid: opts.grid ?? 12, eps: size * 0.0015, steps: opts.steps ?? 90, nsum });
    const upness = new Map<number, number>();
    let sx = 0; let sz = 0; let sw = 0;
    // (A feature barely seen -- tucked inside another part -- has a noisy normal: it counts by how much of it shows.)
    const amax = Math.max(1e-12, ...featured.map(({ i }) => nsum[i * 4 + 3]!));
    for (const { f, i } of featured) {
      const a = nsum[i * 4 + 3]!;
      if (!(a > 0)) { upness.set(i, 0); continue; }
      const n: Vec3 = [nsum[i * 4]! / a, nsum[i * 4 + 1]! / a, nsum[i * 4 + 2]! / a];
      const l = Math.hypot(...n) || 1;
      upness.set(i, Math.max(0, n[1]) / l);
      const sgn = f.side === "front" ? 1 : -1;
      const w = f.weight * Math.min(1, (4 * a) / amax);
      sx += sgn * w * n[0]; sz += sgn * w * n[2]; sw += w;
    }
    const surf = sw ? clamp2([(sx / sw) * 1.25, (sz / sw) * 1.25]) : [0, 0] as V2;
    let vx = 0; let vz = 0; let tot = 0;
    for (const v of views) {
      for (const { f, i } of featured) {
        const w = v.perPart[i]! * f.weight;
        const sgn = f.side === "front" ? 1 : -1;
        vx += sgn * w * v.uh[0]; vz += sgn * w * v.uh[2]; tot += w;
      }
    }
    const vis = tot > 1e-9 ? clamp2([(vx / tot) * 1.25, (vz / tot) * 1.25]) : [0, 0] as V2;
    // Where the features sit off the body; a feature on top says little about the front.
    let cx = 0; let cz = 0; let cw = 0; let uw = 0;
    let nx = 0; let nz = 0; let nw = 0;
    for (const { p, f, i } of featured) {
      const c = solidCentroid(p);
      const s = f.side === "front" ? 1 : -1;
      const out = 1 - upness.get(i)!;
      cx += s * f.weight * out * (c[0] - center[0]); cz += s * f.weight * out * (c[2] - center[2]); cw += f.weight;
      up += upness.get(i)! * f.weight; uw += f.weight;
      const n = declaredNormal(p);
      if (n) {
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        nx += (s * f.weight * n[0]) / l; nz += (s * f.weight * n[2]) / l; nw += f.weight;
      }
    }
    up = uw ? up / uw : 0;
    const off = cw ? clamp2([cx / (cw * 0.25 * R), cz / (cw * 0.25 * R)]) : [0, 0] as V2;
    // (A declared normal that points up adds little sideways: its horizontal part is what counts.)
    const nrm = nw ? clamp2([nx / nw, nz / nw]) : null;
    const parts3: Array<[V2, number]> = [[surf, 1], [vis, 0.7], [off, 0.4], ...(nrm ? [[nrm, 1.2] as [V2, number]] : [])];
    const W = parts3.reduce((acc, [, w]) => acc + w, 0);
    const sum = parts3.reduce<V2>((acc, [q, w]) => [acc[0] + q[0] * w, acc[1] + q[1] * w], [0, 0]);
    const v: V2 = [sum[0] / W, sum[1] / W];
    const amount = Math.min(1, featured.reduce((acc, q) => acc + q.f.weight, 0));
    features = { v: scale2(v, amount), vis, surf, offset: off, normal: nrm, up, words: [...new Set(featured.map((q) => q.f.word))] };
    const say = (q: V2): string => (len2(q) > 0.05 ? `${deg(yawOfV(q))} (${len2(q).toFixed(2)})` : "none");
    why.push(`features [${features.words.join(", ")}]: their surfaces face ${say(surf)}, seen most from ${say(vis)}, sit off the body toward ${say(off)}${nrm ? `, declare normals toward ${say(nrm)}` : ""}${up > 0.5 ? `; mostly on top (${up.toFixed(2)} face up)` : ""}`);
  }

  // ---- d. use cases
  let useCase: Layer | null = null;
  {
    let ux = 0; let uz = 0; let uw = 0;
    const said: string[] = [];
    for (const rule of opts.useCases ?? USE_CASES) {
      const from = parts.filter((p) => hasWord(p, rule.from));
      const to = parts.filter((p) => hasWord(p, rule.to) && !from.includes(p));
      if (!from.length || !to.length) continue;
      const a = centroidOf(from)!;
      const b = centroidOf(to)!;
      const off: V2 = [b[0] - a[0], b[2] - a[2]];
      if (len2(off) < 0.02 * R) continue;
      const s = Math.min(1, len2(off) / (0.15 * R));
      ux += (off[0] / len2(off)) * s; uz += (off[1] / len2(off)) * s; uw += 1;
      said.push(`${rule.why} (${deg(yawOfV(off))})`);
    }
    if (uw) { useCase = { v: clamp2([ux / uw, uz / uw]) }; why.push(`use: ${said.join("; ")}`); }
  }

  // ---- c. geometry
  const recess = contrast(views, "recess", 0.05);
  const edges = contrast(views, "edges", 0.03);
  const flat = contrast(views, "flat", 0.05);
  const mo: V2 = [mass.centroid[0] - mass.mid[0], mass.centroid[2] - mass.mid[2]];
  const massV = clamp2(scale2(mo, 1 / (0.15 * R)));
  const GW = { recess: 1, edges: 0.8, flat: 0.5, mass: 0.5 };
  const gv: V2 = [
    (recess[0] * GW.recess + edges[0] * GW.edges + flat[0] * GW.flat - massV[0] * GW.mass) / (GW.recess + GW.edges + GW.flat + GW.mass),
    (recess[1] * GW.recess + edges[1] * GW.edges + flat[1] * GW.flat - massV[1] * GW.mass) / (GW.recess + GW.edges + GW.flat + GW.mass),
  ];
  // (Small contrasts are sampling noise, not a front.)
  const gs = Math.max(0, len2(gv) - 0.04) / (1 - 0.04);
  const geometry: Layer = { v: len2(gv) > 1e-9 ? scale2(gv, gs / len2(gv)) : [0, 0] };
  // Round: every view alike. Mirror: each view like its opposite.
  const spread = (key: ViewMeasure): number => { const xs = views.map((v) => v[key]); const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / (Math.abs(m) + 0.02); };
  const round = mass.ratio > 0.85 && spread("hits") < 0.06 && spread("recess") < 0.12 && spread("edges") < 0.25
    && Math.max(len2(recess), len2(edges), len2(flat)) < 0.15;
  why.push(`geometry: recess ${deg(yawOfV(recess))} (${len2(recess).toFixed(2)}), edges ${deg(yawOfV(edges))} (${len2(edges).toFixed(2)}), flat face ${deg(yawOfV(flat))} (${len2(flat).toFixed(2)}), mass leans ${deg(yawOfV(massV))} (${len2(massV).toFixed(2)})${round ? "; round: every view alike" : ""}`);

  // ---- combined
  const layers = ([
    ["features", features, 3, 0.95],
    ["useCase", useCase, 2.5, 0.9],
    ["geometry", geometry, 1, 0.6],
  ] as Array<[string, Layer | null, number, number]>).filter(([, L]) => L && len2(L.v) > 1e-6);
  let sx = 0; let sz = 0; let sabs = 0; let miss = 1;
  for (const [, L, W, q] of layers) {
    const lv = L!.v;
    sx += lv[0] * W; sz += lv[1] * W; sabs += len2(lv) * W;
    miss *= 1 - Math.min(1, len2(lv)) * q;
  }
  const agreement = sabs > 0 ? Math.hypot(sx, sz) / sabs : 0;
  let confidence = agreement * (1 - miss);
  const yaw = Math.hypot(sx, sz) > 1e-9 ? Math.atan2(sx, sz) : 0;
  const onlyGeometry = !features && !useCase;
  const symmetric = onlyGeometry && (round || gs < 0.12);
  if (symmetric) confidence = Math.min(confidence, 0.15);
  const out = (L: Layer): { yaw: number; strength: number } => ({ yaw: yawOfV(L.v), strength: len2(L.v) });
  return {
    yaw, dir: dirOfYaw(yaw), confidence,
    symmetric, symmetry: round ? "round" : symmetric ? "mirror" : null,
    // (How much of the named front faces up: a lying phone, a keyboard's keys.)
    up,
    // (Square to the long axis: where a front would be, either way.)
    axisYaw: wrapAngle(mass.axisYaw + Math.PI / 2),
    layers: {
      features: features ? { ...out(features), words: features.words, seen: yawOfV(features.vis), offset: yawOfV(features.offset), up: features.up } : null,
      useCase: useCase ? out(useCase) : null,
      geometry: { ...out(geometry), recess: len2(recess), edges: len2(edges), flat: len2(flat), mass: len2(massV) },
    },
    agreement,
    why,
  };
}

// ---------------------------------------------------------------- the ask

/**
 * detectFront(thing, opts): see the top of this file. `thing` is an object
 * definition or instance, an entity with parts, an array of parts/prims, or
 * { boxes, capsules } (raw renderer/physics solids, world space).
 */
export function detectFront(thing: FrontThing, opts: FrontOptions = {}): FrontResult {
  const T = normalise(thing, opts);
  const E = opts.evidence ?? frontEvidence(T.parts, opts);
  const why = [...E.why];
  let local = E.yaw;
  let confidence = E.confidence;
  let agrees: boolean | null = null;
  if (T.declared !== null) {
    const off = angleBetween(T.declared, E.yaw);
    if (E.confidence >= 0.2) agrees = off <= Math.PI / 4;
    why.unshift(`declared ${deg(T.declared)} (${T.declaredFrom}); the evidence says ${deg(E.yaw)} at ${E.confidence.toFixed(2)}${agrees === null ? " -- too weak to check" : agrees ? " -- agrees" : ` -- DISAGREES by ${deg(off)}`}`);
    local = T.declared;
    confidence = agrees === true ? Math.max(0.9, E.confidence) : agrees === false ? 0.5 : 0.8;
  } else if (T.facingFlag === false) {
    why.unshift("authored with no front (facing: false)");
  }
  if (E.symmetric && T.declared === null) why.push(`symmetric (${E.symmetry}): no front to find`);
  // Into the world, when there is a transform.
  const toWorld = (y: number): { yaw: number; dir: Vec3 } => {
    if (!T.transform) return { yaw: wrapAngle(y), dir: dirOfYaw(y) };
    const d = dirToWorld({ transform: T.transform }, dirOfYaw(y));
    const h = Math.hypot(d[0], d[2]) || 1;
    return { yaw: Math.atan2(d[0], d[2]), dir: [d[0] / h, 0, d[2] / h] };
  };
  const w = toWorld(local);
  const det = toWorld(E.yaw);
  return {
    yaw: w.yaw, dir: w.dir, confidence,
    declared: T.declared !== null, declaredYaw: T.declared === null ? null : toWorld(T.declared).yaw,
    agrees,
    symmetric: E.symmetric, symmetry: E.symmetry,
    axisYaw: toWorld(E.axisYaw).yaw,
    detected: { yaw: det.yaw, dir: det.dir, confidence: E.confidence },
    local: { yaw: wrapAngle(local), dir: dirOfYaw(local), detectedYaw: E.yaw },
    layers: E.layers,
    why,
  };
}

/** Does a thing at `pos` facing `yaw` show its front to a viewer at `eye`? The angle off, 0..PI. */
export function frontOffFrom(pos: Vec3Like, yaw: number, eye: Vec3Like): number {
  return angleBetween(yaw, Math.atan2(eye[0] - pos[0], eye[2] - pos[2]));
}
