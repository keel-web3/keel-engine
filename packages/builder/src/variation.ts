// Variation: a built model as a generative base. Rules say what may change --
// a region's size (legs longer, ears bigger, the tail shorter), whether an
// optional group is there (horns, a saddle), which of a set of groups is kept
// (one of three hats), the overall size -- and each seed draws them. Roles
// never change here: recolouring is a look's job, applied later.
//
//   const rules = {
//     scale: { legs: { region: "legs", y: [0.8, 1.3], anchor: "top" }, ears: { region: "ears", uniform: [0.7, 1.4], anchor: "bottom" } },
//     optional: { horns: 0.4 },
//     pick: { hat: ["cap", "crown", "none"] },
//     size: [0.8, 1.2],
//   };
//   applyVariation(model, rules, S, pins) -> { model, picked }    // picked: what each rule chose
//
// Every rule draws from its own stream (derived from one draw of S by the
// rule's name), so adding a rule never moves another's draw; a pin (by the
// rule's name) wins without moving anything either.

import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { Choice, Pins, Stream } from "@keel-engine/runtime";
import { inRegion, regionOf } from "./voxels.ts";
import type { Region, V3, Vec3i, VoxelModel } from "./voxels.ts";

export type ScaleAnchor = "bottom" | "top" | "center" | "front" | "back" | "left" | "right" | readonly [number, number, number];

export interface ScaleRule {
  /** A group's name, or a region of voxels. */
  readonly region: string | { readonly from: Vec3i; readonly to: Vec3i };
  readonly x?: readonly [number, number];
  readonly y?: readonly [number, number];
  readonly z?: readonly [number, number];
  /** All three axes by one draw (used for any axis not given its own). */
  readonly uniform?: readonly [number, number];
  /** The point that stays put (default "bottom": grows up from where it stands; a leg anchored "top" grows down from the body). */
  readonly anchor?: ScaleAnchor;
}

export interface VariationRules {
  /** Choice name -> a region scaled by a drawn factor. */
  readonly scale?: Readonly<Record<string, ScaleRule>>;
  /** Group -> the chance it's there. */
  readonly optional?: Readonly<Record<string, number>>;
  /** Choice name -> groups: one is kept, the rest removed ("none" keeps none). */
  readonly pick?: Readonly<Record<string, readonly string[]>>;
  /** The whole thing's size, as a factor on the voxel unit. */
  readonly size?: readonly [number, number];
}

/** The choices the rules offer (for defineAttribute / defineEntity): ranges and lists. */
export function variationChoices(rules: VariationRules): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const [name, r] of Object.entries(rules.scale ?? {})) {
    const range = r.uniform ?? r.y ?? r.x ?? r.z;
    if (range) out[name] = { range: [range[0], range[1]] };
  }
  for (const g of Object.keys(rules.optional ?? {})) out[g] = [true, false];
  for (const [name, list] of Object.entries(rules.pick ?? {})) out[name] = [...list];
  if (rules.size) out["size"] = { range: [rules.size[0], rules.size[1]] };
  return out;
}

/** Check rules against a model: groups named must exist, ranges must be positive and ordered. Returns problems (empty: fine). */
export function checkVariation(model: VoxelModel, rules: VariationRules): string[] {
  const bad: string[] = [];
  const range = (what: string, r: readonly number[] | undefined): void => {
    if (r === undefined) return;
    if (!Array.isArray(r) || r.length !== 2 || !(r[0]! > 0) || !(r[1]! >= r[0]!)) bad.push(`${what}: a range [lo, hi] with 0 < lo <= hi (got ${JSON.stringify(r)}).`);
  };
  for (const [name, r] of Object.entries(rules.scale ?? {})) {
    if (typeof r.region === "string" && !model.groups.has(r.region)) bad.push(`scale.${name}: no group "${r.region}" (groups: ${[...model.groups.keys()].join(", ") || "none"}).`);
    if (!r.x && !r.y && !r.z && !r.uniform) bad.push(`scale.${name}: give uniform, or x / y / z ranges.`);
    range(`scale.${name}.x`, r.x); range(`scale.${name}.y`, r.y); range(`scale.${name}.z`, r.z); range(`scale.${name}.uniform`, r.uniform);
  }
  for (const [g, p] of Object.entries(rules.optional ?? {})) {
    if (!model.groups.has(g)) bad.push(`optional.${g}: no such group.`);
    if (!(p >= 0 && p <= 1)) bad.push(`optional.${g}: a chance 0..1 (got ${p}).`);
  }
  for (const [name, list] of Object.entries(rules.pick ?? {})) {
    if (!list.length) bad.push(`pick.${name}: list the groups to pick from.`);
    for (const g of list) if (g !== "none" && !model.groups.has(g)) bad.push(`pick.${name}: no group "${g}".`);
  }
  range("size", rules.size);
  return bad;
}

const cellsOf = (m: VoxelModel, region: ScaleRule["region"]): Array<[number, number, number, number]> => {
  const out: Array<[number, number, number, number]> = [];
  if (typeof region === "string") m.forEach((x, y, z, v) => { if (m.groupAt(x, y, z) === region) out.push([x, y, z, v]); });
  else { const r = regionOf(region.from, region.to); m.forEach((x, y, z, v) => { if (inRegion(r, x, y, z)) out.push([x, y, z, v]); }); }
  return out;
};

/** Scale a region's voxels by s about an anchor (nearest-cell resampling); the group's regions scale with them. */
export function scaleRegion(m: VoxelModel, region: ScaleRule["region"], s: readonly [number, number, number], anchor: ScaleAnchor = "bottom"): void {
  const cells = cellsOf(m, region);
  if (!cells.length) return;
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  const src = new Map<string, number>();
  for (const [x, y, z, v] of cells) {
    src.set(`${x},${y},${z}`, v);
    const p = [x, y, z];
    for (let i = 0; i < 3; i += 1) { lo[i] = Math.min(lo[i]!, p[i]!); hi[i] = Math.max(hi[i]!, p[i]! + 1); }
  }
  const mid: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const A: V3 = Array.isArray(anchor) ? [anchor[0]!, anchor[1]!, anchor[2]!]
    : anchor === "bottom" ? [mid[0], lo[1], mid[2]] : anchor === "top" ? [mid[0], hi[1], mid[2]]
    : anchor === "front" ? [mid[0], mid[1], hi[2]] : anchor === "back" ? [mid[0], mid[1], lo[2]]
    : anchor === "left" ? [lo[0], mid[1], mid[2]] : anchor === "right" ? [hi[0], mid[1], mid[2]] : mid;
  for (const [x, y, z] of cells) m.setIndex(x, y, z, 0);
  const nlo = [0, 1, 2].map((i) => Math.floor(A[i]! + (lo[i]! - A[i]!) * s[i]! + 1e-9));
  const nhi = [0, 1, 2].map((i) => Math.ceil(A[i]! + (hi[i]! - A[i]!) * s[i]! - 1e-9));
  for (let z = nlo[2]!; z < nhi[2]!; z += 1) for (let y = nlo[1]!; y < nhi[1]!; y += 1) for (let x = nlo[0]!; x < nhi[0]!; x += 1) {
    const sx = Math.floor(A[0] + (x + 0.5 - A[0]) / s[0]);
    const sy = Math.floor(A[1] + (y + 0.5 - A[1]) / s[1]);
    const sz = Math.floor(A[2] + (z + 0.5 - A[2]) / s[2]);
    const v = src.get(`${sx},${sy},${sz}`);
    if (v) m.setIndex(x, y, z, v);
  }
  if (typeof region === "string") {
    const rs = m.groups.get(region) ?? [];
    m.groups.set(region, rs.map((r): Region => {
      const a = [0, 1, 2].map((i) => Math.floor(A[i]! + (r.min[i]! - A[i]!) * s[i]! + 1e-9));
      const b = [0, 1, 2].map((i) => Math.ceil(A[i]! + (r.max[i]! + 1 - A[i]!) * s[i]! - 1e-9) - 1);
      return { min: [a[0]!, a[1]!, a[2]!], max: [Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!), Math.max(a[2]!, b[2]!)] };
    }));
  }
}

/** Remove a group's voxels (and the group). */
export function removeGroup(m: VoxelModel, group: string): void {
  for (const [x, y, z] of cellsOf(m, group)) m.setIndex(x, y, z, 0);
  m.groups.delete(group);
}

/** A seed from a stream: four 16-bit draws (what every rule's own stream is derived from). */
const seedOf = (S: Pick<Stream, "f">): string => { let h = "0x"; for (let i = 0; i < 4; i += 1) h += Math.floor(S.f() * 65536).toString(16).padStart(4, "0"); return h; };

/** The model varied by the rules, drawn from S (pins by rule name win). */
export function applyVariation(base: VoxelModel, rules: VariationRules, S: Stream, pins: Pins = {}): { model: VoxelModel; picked: Record<string, unknown> } {
  const seed = typeof pins["seed"] === "string" || typeof pins["seed"] === "number" ? String(pins["seed"]) : seedOf(S);
  const own = (name: string): Stream => stream(createRoll(deriveSeed(seed, `vary:${name}`)), 0);
  const m = base.clone();
  const picked: Record<string, unknown> = {};
  // Picks and optionals first (they remove groups a scale might otherwise grow).
  for (const [name, list] of Object.entries(rules.pick ?? {})) {
    const drawn = own(name).pick(list);
    const pin = pins[name];
    if (pin !== undefined && !list.includes(pin as string)) throw new RangeError(`${name} = ${JSON.stringify(pin)} is not one of ${JSON.stringify(list)}.`);
    const keep = (pin as string | undefined) ?? drawn;
    picked[name] = keep;
    for (const g of list) if (g !== keep && g !== "none") removeGroup(m, g);
  }
  for (const [g, p] of Object.entries(rules.optional ?? {})) {
    const drawn = own(g).chance(p);
    const pin = pins[g];
    if (pin !== undefined && typeof pin !== "boolean") throw new TypeError(`${g}: true or false (got ${JSON.stringify(pin)}).`);
    const keep = (pin as boolean | undefined) ?? drawn;
    picked[g] = keep;
    if (!keep) removeGroup(m, g);
  }
  for (const [name, r] of Object.entries(rules.scale ?? {})) {
    const S2 = own(name);
    const u = r.uniform ? S2.between(r.uniform[0], r.uniform[1]) : 1;
    const axes = ([r.x, r.y, r.z] as const).map((range) => (range ? S2.between(range[0], range[1]) : u)) as [number, number, number];
    const pin = pins[name];
    const s: [number, number, number] = typeof pin === "number" ? [pin, pin, pin] : pin && typeof pin === "object" ? (() => { const o = pin as Record<string, number>; return [o["x"] ?? axes[0], o["y"] ?? axes[1], o["z"] ?? axes[2]] as [number, number, number]; })() : axes;
    picked[name] = s;
    if (typeof r.region !== "string" || m.groups.has(r.region)) scaleRegion(m, r.region, s, r.anchor ?? "bottom");
  }
  if (rules.size) {
    const drawn = own("size").between(rules.size[0], rules.size[1]);
    const pin = pins["size"];
    const k = typeof pin === "number" ? pin : drawn;
    picked["size"] = k;
    m.unit = base.unit * k;
  }
  return { model: m, picked };
}

/** N seeded variants of a model (seeds "0".."n-1" through deriveSeed, so the same n always gives the same set). */
export function variantsOf(base: VoxelModel, rules: VariationRules, n: number, seed = "variants"): Array<{ model: VoxelModel; picked: Record<string, unknown> }> {
  return Array.from({ length: n }, (_, i) => applyVariation(base, rules, stream(createRoll(deriveSeed(seed, i)), 0)));
}

