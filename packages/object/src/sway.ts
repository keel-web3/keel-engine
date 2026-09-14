// Wind. Foliage sways; thousands of grass tufts sway; nothing about it may
// cost a bake per frame per tuft. Two ways, one set of parameters (design.ts
// SwaySpec: amp, hz, bend, from, groups):
//
//   1. IN THE SPRITE SHADER (the default, and the cheap good-looking one): a
//      baked sprite's texel rows are shifted sideways by whole pixels --
//      shift(row) = round(ampPx * s(t) * w(row)), w = ((row - from) / (top - from))^bend,
//      s(t) = sin(2π (hz t + phase)) + 0.35 sin(2π (2.3 hz t + 1.7 phase)) (a gust
//      riding the sway). The phase comes from the instance's ground position
//      (a wave travels across a field), so one baked sprite, any number of
//      instances, every one moving, zero extra bakes and zero memory; the rows
//      move by whole pixels, so it stays pixel art (no smear). It needs one
//      float per instance (ampPx) and a quad widened by ampPx each side --
//      the change the bake's sprite shader needs is listed in the pack READMEs.
//      swayShift() below is the reference the shader must match.
//   2. BAKED FRAMES (where the shader can't: a hero shot, the raymarched
//      preview, today's bake): swayPose() bends the parts themselves --
//      capsules at each end (a branch bends), boxes and wedges moved by their
//      middle's height -- and a thing bakes a "sway" clip of N frames (4 is
//      plenty at pixel scale). N x the sprites; fine for a hero tree, not for grass.

import type { Vec3 } from "@keel-engine/core";
import type { SwaySpec } from "./design.ts";
import type { ObjectPart } from "./object.ts";

/** The sway signal at time t (seconds) for a phase (0..1): about -1.35..1.35. */
export function swaySignal(t: number, hz: number, phase: number): number {
  return Math.sin(2 * Math.PI * (hz * t + phase)) + 0.35 * Math.sin(2 * Math.PI * (2.3 * hz * t + 1.7 * phase));
}

/** How much a height sways, 0..1: nothing below `from`, all of it at the top. */
export function swayWeight(y: number, top: number, sway: Pick<SwaySpec, "bend" | "from">): number {
  if (y <= sway.from || top <= sway.from) return 0;
  return Math.min(1, (y - sway.from) / (top - sway.from)) ** sway.bend;
}

/**
 * The shader's reference: how many whole pixels a sprite row shifts. `rowUp` is the row's height above the
 * sprite's ground anchor in pixels, `heightPx` the thing's height in pixels (its top), `pxPerMetre` the scale,
 * `phase` the instance's (phaseAt).
 */
export function swayShift(rowUp: number, heightPx: number, pxPerMetre: number, sway: SwaySpec, t: number, phase: number): number {
  const top = heightPx / pxPerMetre;
  const w = swayWeight(rowUp / pxPerMetre, top, sway);
  return Math.round(sway.amp * top * pxPerMetre * swaySignal(t, sway.hz, phase) * w) || 0; // (never -0)
}

/** An instance's phase from where it stands: a gust travelling along `wind` (a yaw) at `speed` m/s -- neighbours sway nearly together. */
export function phaseAt(x: number, z: number, hz: number, wind = 0, speed = 3): number {
  const along = x * Math.sin(wind) + z * Math.cos(wind);
  const across = -x * Math.cos(wind) + z * Math.sin(wind);
  // (Along the wind: the wave's travel. Across it: a little hash, so a row of tufts isn't a marching line.)
  const jitter = ((Math.sin(across * 12.9898 + along * 0.3) * 43758.5453) % 1 + 1) % 1;
  return ((-along * hz) / speed + jitter * 0.15) % 1;
}

/** Where the sway pushes (metres along x of the own frame, for a wind along +x) at height y, frame `frame` of `frames`. */
const offsetAt = (y: number, top: number, sway: SwaySpec, frame: number, frames: number): number =>
  sway.amp * top * Math.sin((2 * Math.PI * frame) / frames) * swayWeight(y, top, sway);

/**
 * Parts bent for a frame of an N-frame sway clip (baked frames: see the top). `top` is the thing's height.
 * Capsules bend (each end moves by its own height), boxes and wedges move by their middle. Only parts in
 * `sway.groups` when it lists some. Returns new part-likes: { box | capsule | wedge, role, name, group }.
 */
export function swayPose(parts: readonly ObjectPart[], top: number, sway: SwaySpec, frame: number, frames = 4): Array<{ part: ObjectPart; box?: { c: Vec3; h: Vec3; yaw: number }; capsule?: { a: Vec3; b: Vec3; r: number }; wedge?: { c: Vec3; h: Vec3; yaw: number; lo: number } }> {
  return parts.map((part) => {
    const grp = (part as { group?: string | null }).group ?? null;
    const moves = !sway.groups || (grp !== null && sway.groups.includes(grp));
    const dx = (y: number): number => (moves ? offsetAt(y, top, sway, frame, frames) : 0);
    if (part.wedge) { const w = part.wedge; return { part, wedge: { c: [w.c[0] + dx(w.c[1]), w.c[1], w.c[2]], h: [...w.h], yaw: w.yaw, lo: w.lo } }; }
    const prim = part.prim;
    if (prim?.type === "capsule") return { part, capsule: { a: [prim.a[0] + dx(prim.a[1]), prim.a[1], prim.a[2]], b: [prim.b[0] + dx(prim.b[1]), prim.b[1], prim.b[2]], r: prim.r } };
    if (prim?.type === "box") return { part, box: { c: [prim.c[0] + dx(prim.c[1]), prim.c[1], prim.c[2]], h: [...prim.h], yaw: prim.yaw } };
    return { part };
  });
}
