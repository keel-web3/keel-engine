// A block given over whole to a park -- or to a lake in a ring of park. Every
// lot of the block draws its own share of one design laid out on the block:
// the lawn, a loop path and paths across it, groves of trees, lamps and
// benches along the paths, the park's pieces (a pond, a fountain, a
// playground, a bandstand); a lake's water standing level across its lots, its
// stone edge, a pier with a boathouse, boats. Nothing is drawn twice and
// nothing falls in the gaps: a point belongs to the lot whose box holds it.
// (Off the street, its lamps, benches and trees aren't the street's props --
// only a piece a car could plough into, the fountain, is one.)

import { dcos, dsin } from "@keel-engine/core";
import type { CityHeight } from "@keel-engine/city";
import { addBox, addCapsule, subPlacer, toWorld } from "./frame.ts";
import { keepLevel, thing } from "./foundations.ts";
import type { Build } from "./frame.ts";
import { art } from "./street/art.ts";
import { bench, lamp, tree } from "./street/furniture.ts";
import type { LampStyle, MassOp, PropSpot, WaterSpec } from "./types.ts";
import type { AnySlot } from "./slots.ts";
import type { CommonsBlock, Rect } from "./zoning.ts";

const LANTERN: LampStyle = { kind: "lantern", height: 3.6, arm: 0, heads: 1, head: "lampWarm", reach: 10 };
const PATH = 0.9;

const inside = (r: Rect, u: number, v: number): boolean => u >= r.x0 && u < r.x1 && v >= r.z0 && v < r.z1;
const meet = (a: Rect, b: Rect): Rect | null => {
  const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) };
  return r.x1 - r.x0 > 0.05 && r.z1 - r.z0 > 0.05 ? r : null;
};
const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });
/** How far a point is from a box (0 inside it). */
const away = (r: Rect, u: number, v: number): number => dist(Math.max(r.x0 - u, 0, u - r.x1), Math.max(r.z0 - v, 0, v - r.z1));
const dist = (a: number, b: number): number => Math.sqrt(a * a + b * b);

/** The paths: a loop (round a park, or round a lake's shore), and across a park, or out from the lake to the street. */
function paths(c: CommonsBlock): { loop: Rect; segs: Rect[] } {
  const R = c.rect, loop = c.water ? grow(c.water, 3.2) : grow(R, -3.5);
  const segs = [
    { x0: loop.x0 - PATH, x1: loop.x1 + PATH, z0: loop.z0 - PATH, z1: loop.z0 + PATH }, { x0: loop.x0 - PATH, x1: loop.x1 + PATH, z0: loop.z1 - PATH, z1: loop.z1 + PATH },
    { x0: loop.x0 - PATH, x1: loop.x0 + PATH, z0: loop.z0, z1: loop.z1 }, { x0: loop.x1 - PATH, x1: loop.x1 + PATH, z0: loop.z0, z1: loop.z1 },
  ];
  if (!c.water) segs.push({ x0: R.x0, x1: R.x1, z0: -PATH, z1: PATH }, { x0: -PATH, x1: PATH, z0: R.z0, z1: R.z1 });
  else segs.push({ x0: -PATH, x1: PATH, z0: R.z0, z1: loop.z0 }, { x0: -PATH, x1: PATH, z0: loop.z1, z1: R.z1 }, { x0: R.x0, x1: loop.x0, z0: -PATH, z1: PATH }, { x0: loop.x1, x1: R.x1, z0: -PATH, z1: PATH });
  return { loop, segs };
}

/** Points every `step` metres round a box's edge, from its corner. */
function round(r: Rect, step: number): [number, number][] {
  const out: [number, number][] = [], w = r.x1 - r.x0, d = r.z1 - r.z0, len = 2 * (w + d);
  for (let t = step / 2; t < len; t += step) {
    out.push(t < w ? [r.x0 + t, r.z0] : t < w + d ? [r.x1, r.z0 + t - w] : t < 2 * w + d ? [r.x1 - (t - w - d), r.z1] : [r.x0, r.z1 - (t - 2 * w - d)]);
  }
  return out;
}

export function commons(b: Build, _op: Extract<MassOp, { op: "commons" }>): void {
  const site = b.commons;
  if (!site) return;
  const c = site.info, D = c.D, own = c.lots.get(b.key)!, ext = meet(grow(own, 1.2), c.rect) ?? own;
  // (Block to frame: this lot's frame is the block's axes, from the lot's middle.)
  const fx = (u: number): number => u - site.u, fz = (v: number): number => v - site.v;
  const box = (r: Rect, lod: 0 | 1 | 2, y: number, h: number, slot: AnySlot): void => addBox(b, lod, fx((r.x0 + r.x1) / 2), y, fz((r.z0 + r.z1) / 2), (r.x1 - r.x0) / 2, h, (r.z1 - r.z0) / 2, slot);
  const prop = (kind: PropSpot["kind"], u: number, v: number, r: number, breaks: boolean): void => {
    if (r <= 0) return;
    const [wx, , wz] = toWorld(b, fx(u), 0, fz(v));
    b.props.push({ kind, x: wx, z: wz, r, breaks });
  };
  box(ext, 2, 0.04, 0.04, "grass");
  const W = c.water, level = site.level, wet = W ? meet(ext, W) : null, lakeFrom = b.solids.length;
  // (The basin reaches down to the lowest ground under the lake: on a slope it's a pool standing in its stone edge.)
  const floor = Math.min(level - 0.3, site.floor ?? -0.2) - 0.1;
  if (wet && W) {
    // The lake: its water level across the block, its stone edge; nobody drives into it.
    box(wet, 2, (level + floor) / 2, (level - floor) / 2, "water");
    b.masses.push(thing({ x: fx((wet.x0 + wet.x1) / 2), z: fz((wet.z0 + wet.z1) / 2), hw: (wet.x1 - wet.x0) / 2, hd: (wet.z1 - wet.z0) / 2, y0: 0, y1: level, slot: "concreteDark" }));
    const [wx, wy, wz] = toWorld(b, fx((wet.x0 + wet.x1) / 2), level, fz((wet.z0 + wet.z1) / 2));
    const spec: WaterSpec = { obb: { x: wx, z: wz, hw: (wet.x1 - wet.x0) / 2, hd: (wet.z1 - wet.z0) / 2, yaw: b.frame.yaw }, y: wy };
    b.water.push(spec);
    const edge = grow(W, 0.5);
    for (const e of [{ ...edge, z1: W.z0 }, { ...edge, z0: W.z1 }, { ...edge, x1: W.x0, z0: W.z0, z1: W.z1 }, { ...edge, x0: W.x1, z0: W.z0, z1: W.z1 }]) {
      const r = meet(e, ext);
      if (r) box(r, 1, (level + 0.12 + floor) / 2, (level + 0.12 - floor) / 2, "plinth");
    }
    keepLevel(b, lakeFrom);
  }
  // Paths.
  const { loop, segs } = paths(c);
  for (const s of segs) { const r = meet(s, ext); if (r) box(r, 1, 0.09, 0.02, W ? "paving" : "gravel"); }
  // The pieces this lot has.
  for (const f of c.features) {
    if (f.lot !== b.key) continue;
    const x = fx(f.u), z = fz(f.v);
    if (f.kind === "pond" || f.kind === "fountain") prop("art", f.u, f.v, art(subPlacer(b, x, z), f.kind), false);
    else if (f.kind === "playground") {
      box({ x0: f.u - f.r, x1: f.u + f.r, z0: f.v - f.r, z1: f.v + f.r }, 1, 0.1, 0.03, "gravel");
      // (Swings, a slide, a climbing frame.)
      for (const sx of [-1, 1]) addBox(b, 0, x - 2 + sx * 1.6, 1.2, z - 2, 0.06, 1.2, 0.06, "frame");
      addBox(b, 0, x - 2, 2.4, z - 2, 1.7, 0.06, 0.06, "frame");
      addBox(b, 0, x + 2, 1, z + 1.5, 0.5, 1, 1.4, "artNeon", { wedge: true, lo: 0.05 });
      addBox(b, 0, x + 2, 1.1, z - 2, 1, 1.1, 1, "frame");
    } else {
      // (A bandstand: an octagonal stage, posts, a roof, a warm light under it.)
      addBox(b, 1, x, 0.35, z, f.r * 0.8, 0.35, f.r * 0.8, "plinth");
      addBox(b, 1, x, 0.35, z, f.r * 0.8, 0.35, f.r * 0.8, "plinth", { turn: Math.PI / 4 });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) addCapsule(b, 1, [x + sx * f.r * 0.6, 0.7, z + sz * f.r * 0.6], [x + sx * f.r * 0.6, 3.3, z + sz * f.r * 0.6], 0.12, "frame");
      for (const side of [1, -1]) addBox(b, 1, x, 4.1, z + (side * f.r * 0.45), f.r * 0.9, 0.8, f.r * 0.45, "roof", { wedge: true, turn: side > 0 ? 0 : Math.PI });
      addBox(b, 0, x, 3.2, z, 0.3, 0.1, 0.3, "lampWarm");
      const [wx, , wz] = toWorld(b, x, 0, z);
      b.lights.push({ x: wx, z: wz, r: 8 });
    }
  }
  // The pier and boathouse, and boats out on the water.
  const p = c.pier, pierFrom = b.solids.length;
  if (p && W && p.lot === b.key) {
    const ex = p.u + p.du * p.len, ez = p.v + p.dv * p.len, x = fx((p.u + ex) / 2), z = fz((p.v + ez) / 2);
    const hw = p.du ? p.len / 2 + 0.5 : 0.8, hd = p.dv ? p.len / 2 + 0.5 : 0.8, deck = level + 0.35;
    addBox(b, 1, x, deck, z, hw, 0.1, hd, "wood");
    for (let t = 0; t <= p.len; t += 3) for (const s of [-0.75, 0.75]) addBox(b, 0, fx(p.u + p.du * t + (p.dv ? s : 0)), deck / 2 - 0.1, fz(p.v + p.dv * t + (p.du ? s : 0)), 0.08, deck / 2 + 0.1, 0.08, "wood");
    const end = lamp(subPlacer(b, fx(ex), fz(ez)), LANTERN);
    b.lights.push(...end.lights);
    // (The boathouse: half on the bank, half over the water, beside the pier's root.)
    const bu = p.u - p.du * 1 + p.dv * 4.5, bv = p.v - p.dv * 1 + p.du * 4.5, bx = fx(bu), bz = fz(bv);
    b.masses.push({ x: bx, z: bz, hw: 2.6, hd: 2.6, y0: 0, y1: 3.4, slot: "timber" });
    addBox(b, 2, bx, 1.7, bz, 2.6, 1.7, 2.6, "timber");
    for (const side of [1, -1]) addBox(b, 1, bx, 4.1, bz + side * 1.4, 2.9, 0.7, 1.4, "roof", { wedge: true, turn: side > 0 ? 0 : Math.PI });
    for (let k = 0; k < 1 + Math.floor(D.u("boats") * 3); k += 1) {
      const u = W.x0 + 3 + (W.x1 - W.x0 - 6) * D.u("boatU", k), v = W.z0 + 3 + (W.z1 - W.z0 - 6) * D.u("boatV", k);
      addBox(b, 0, fx(u), level + 0.2, fz(v), 0.7, 0.2, 1.7, "wood", { wedge: true, lo: 0.4, turn: D.flat("boatTurn", k) * 3 });
    }
    keepLevel(b, pierFrom);
  }
  // Lamps and benches along the loop, each on the lot it stands on.
  round(loop, 21).forEach(([u, v], k) => {
    const out = u <= loop.x0 + 0.01 ? -1 : u >= loop.x1 - 0.01 ? 1 : 0, outZ = v <= loop.z0 + 0.01 ? -1 : v >= loop.z1 - 0.01 ? 1 : 0;
    const lu = u + out * 1.5, lv = v + outZ * 1.5;
    if (inside(own, lu, lv)) b.lights.push(...lamp(subPlacer(b, fx(lu), fz(lv)), LANTERN).lights);
    const su = u - out * 1.6 + (outZ ? 7 : 0), sv = v - outZ * 1.6 + (out ? 7 : 0);
    if (k % 2 === 0 && inside(own, su, sv) && !(W && inside(grow(W, 0.5), su, sv))) {
      // (Facing the path -- or, round a lake, facing the water.)
      const turn = out ? (out > 0 ? -Math.PI / 2 : Math.PI / 2) : outZ > 0 ? Math.PI : 0;
      bench(subPlacer(b, fx(su), fz(sv), W ? turn + Math.PI : turn));
    }
  });
  // Trees: a seeded grid over the block, thick in its groves, thin between; clear of paths, water, pieces, the edge.
  const R = c.rect;
  for (let i = 0; R.x0 + 4 + 8 * i < R.x1; i += 1) for (let j = 0; R.z0 + 4 + 8 * j < R.z1; j += 1) {
    const u = R.x0 + 4 + 8 * i + D.flat("treeU", i, j) * 2.5, v = R.z0 + 4 + 8 * j + D.flat("treeV", i, j) * 2.5;
    if (!inside(own, u, v)) continue;
    if (D.u("tree", i, j) > (D.u("grove", i >> 2, j >> 2) < 0.55 ? 0.75 : 0.2)) continue;
    const r = D.u("treeKind", i, j), kind = r < 0.3 ? "conifer" : r < 0.9 ? "tree" : "bush", size = 0.8 + 0.4 * D.u("treeS", i, j);
    const crown = (kind === "tree" ? 3.5 : kind === "conifer" ? 2.6 : 1.4) * size;
    if (u - R.x0 < crown + 0.5 || R.x1 - u < crown + 0.5 || v - R.z0 < crown + 0.5 || R.z1 - v < crown + 0.5) continue;
    if (segs.some((s) => away(s, u, v) < 1.8) || (W && away(W, u, v) < crown + 0.5) || c.features.some((f) => dist(f.u - u, f.v - v) < f.r + crown)) continue;
    if (c.pier && dist(c.pier.u - u, c.pier.v - v) < 9) continue;
    tree(b, fx(u), fz(v), size, kind);
  }
  // (Every lot of it shows it's the park's: a lantern -- or, out on the lake, a lit jet.)
  if (!b.lights.length && !b.plants.length && !b.props.length) {
    const u = (own.x0 + own.x1) / 2, v = (own.z0 + own.z1) / 2;
    if (W && inside(W, u, v)) {
      addCapsule(b, 1, [fx(u), level, fz(v)], [fx(u), level + 4, fz(v)], 0.25, "jet");
      const [wx, , wz] = toWorld(b, fx(u), 0, fz(v));
      b.lights.push({ x: wx, z: wz, r: 6 });
    } else b.lights.push(...lamp(subPlacer(b, fx(u), fz(v)), LANTERN).lights);
  }
}

/** A lake's water as a block plan shows it: its surface's box (world) and its level. */
/**
 * The ground under a block's lake, lowest and highest (m): the lake stands a hand over the highest (never the ground
 * showing through its water), its basin down past the lowest (on a slope, a pool standing in its stone edge).
 */
export function lakeLevel(c: CommonsBlock, height: CityHeight): [number, number] {
  const o = lakeOf(c, 0)?.obb;
  if (!o) return [0, 0];
  const [lo, hi] = height.under(o.x, o.z, o.hw, o.hd, o.yaw);
  return [lo, hi + 0.1];
}

export function lakeOf(c: CommonsBlock, level: number): WaterSpec | null {
  const W = c.water;
  if (!W) return null;
  const u = (W.x0 + W.x1) / 2, v = (W.z0 + W.z1) / 2, co = dcos(c.yaw), si = dsin(c.yaw);
  return { obb: { x: c.cx + u * co + v * si, z: c.cz - u * si + v * co, hw: (W.x1 - W.x0) / 2, hd: (W.z1 - W.z0) / 2, yaw: c.yaw }, y: level };
}
