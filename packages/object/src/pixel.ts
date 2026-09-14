// The pixel style (`style/pixel@1.0.0`): a design drawn with the engine's own
// generative primitives -- the renderer's and the physics' solids, boxes
// turned about y, wedges and capsules -- so every part bakes through the
// pixel pipeline (palette ramps, dither, outline) and costs the renderer
// nothing it can't draw. Always available: it is the fallback every other
// style falls back to.
//
//   box, wedge, capsule   as they are
//   ball                  a sphere; a capsule along a long axis; else a cloud
//                         of spheres (a canopy's lumpy pixel silhouette)
//   cone                  a stack of shrinking slabs: by default a star (two
//                         squares a step, one turned 45° -- needles, a spiky
//                         crown), or an octagon (sides 8) or a square (sides 4:
//                         a stepped pyramid)
//   cylinder              a thin one a capsule (its round foot on the base);
//                         a thick one an octagonal prism (four boxes: an
//                         octagon is the union of four bars, 45° apart) or a
//                         square one (sides 4)
//
// `detail` (default 1) scales how many spheres a cloud and steps a cone get.

import type { Vec3 } from "@keel-engine/core";
import type { BallSolid, ConeSolid, CylinderSolid, Design, DesignSolid } from "./design.ts";
import { drawnIn } from "./design.ts";
import type { ObjectStyle, StyledPart, StyleParams, StyledParts } from "./style.ts";
import { dcbrt, dcos, dsin, dtan } from "@keel-engine/core";

const OCT = dcos(Math.PI / 8); // (a star of two squares with its points at r: each square's half-side is r cos 22.5°)
const BAR = dtan(Math.PI / 8); // (an octagon of apothem a is four bars a long, a tan 22.5° wide, 45° apart)

/** An octagonal slab of apothem a (four bars 45° apart), or a square one. */
function slab(c: Vec3, a: number, hy: number, sides: 4 | 8): Array<{ c: Vec3; h: Vec3; yaw: number }> {
  if (sides === 4) return [{ c, h: [a, hy, a], yaw: 0 }];
  return [0, 1, 2, 3].map((k) => ({ c: [...c] as Vec3, h: [a, hy, a * BAR] as Vec3, yaw: (k * Math.PI) / 4 }));
}

function base(s: DesignSolid): { name: string; mat: string; role: string; group: string | null; collide: false } {
  // (Colliders are the design's: parts never make their own.)
  return { name: s.name ?? s.role, mat: s.role, role: s.role, group: s.group ?? null, collide: false };
}

/** A ball as capsules: a sphere when round, a capsule along a long axis, else a cloud of spheres. */
export function ballPrims(s: BallSolid, detail = 1): Array<{ a: Vec3; b: Vec3; r: number }> {
  const [cx, cy, cz] = s.c;
  const r = [s.r[0], s.r[1], s.r[2]] as const;
  const order = [0, 1, 2].sort((i, j) => r[i]! - r[j]!);
  const lo = r[order[0]!]!, mid = r[order[1]!]!, hi = r[order[2]!]!;
  if (hi <= lo * 1.3) {
    const R = dcbrt(r[0] * r[1] * r[2]);
    return [{ a: [cx, cy, cz], b: [cx, cy, cz], r: R }];
  }
  if (mid <= lo * 1.3) {
    // (Long along one axis: a capsule along it, as thick as the other two.)
    const R = Math.sqrt(lo * mid);
    const ax = order[2]!;
    const a: Vec3 = [cx, cy, cz], b: Vec3 = [cx, cy, cz];
    a[ax] = a[ax]! - (hi - R);
    b[ax] = b[ax]! + (hi - R);
    return [{ a, b, r: R }];
  }
  // A cloud: spheres of the thinnest radius over the ellipse of the other two, and one in the middle.
  const t = order[0]!;
  const [u, w] = [0, 1, 2].filter((i) => i !== t) as [number, number];
  const ru = r[u]!, rw = r[w]!;
  const sR = lo;
  const reach = Math.max(ru, rw) - sR;
  const n = Math.max(5, Math.min(Math.round(9 * detail), Math.round((2 * Math.PI * reach) / (1.5 * sR))));
  const out: Array<{ a: Vec3; b: Vec3; r: number }> = [];
  for (let k = 0; k < n; k += 1) {
    const th = (k / n) * Math.PI * 2 + 0.3;
    const p: Vec3 = [cx, cy, cz];
    p[u] = p[u]! + dcos(th) * (ru - sR);
    p[w] = p[w]! + dsin(th) * (rw - sR);
    out.push({ a: p, b: [...p], r: sR });
  }
  // (The middle: as big as fills it, never past the thin radius -- a cloud stays inside its ball.)
  const inner = Math.min(Math.min(ru, rw) - sR * 0.6, sR);
  if (inner > sR * 0.3) out.push({ a: [cx, cy, cz], b: [cx, cy, cz], r: inner });
  return out;
}

/** A cone as stacked slabs: { c, h, yaw } boxes -- a star (two a step), an octagon (four) or a square (one). */
export function conePrims(s: ConeSolid, detail = 1): Array<{ c: Vec3; h: Vec3; yaw: number }> {
  const top = s.top ?? 0;
  const steps = s.steps !== undefined ? Math.max(1, Math.round(s.steps * detail)) : Math.max(2, Math.min(Math.round(7 * detail), Math.round((detail * s.h) / (0.45 * Math.max(s.r, 0.05)))));
  const out: Array<{ c: Vec3; h: Vec3; yaw: number }> = [];
  const dy = s.h / steps;
  for (let i = 0; i < steps; i += 1) {
    const ri = s.r + (top - s.r) * ((i + 0.35) / steps);
    if (ri <= 1e-4) continue;
    const c: Vec3 = [s.c[0], s.c[1] + dy * (i + 0.5), s.c[2]];
    const sides = s.sides ?? "star";
    if (sides === "star") {
      const hh: Vec3 = [ri * OCT, dy / 2, ri * OCT];
      out.push({ c, h: hh, yaw: 0 }, { c: [...c], h: [...hh], yaw: Math.PI / 4 });
    } else out.push(...slab(c, sides === 8 ? ri * OCT : ri * Math.SQRT1_2, dy / 2, sides));
  }
  return out;
}

/** A cylinder: a capsule when thin (its round foot resting on the base), an octagonal prism when thick. */
export function cylinderPrims(s: CylinderSolid): { capsule?: { a: Vec3; b: Vec3; r: number }; boxes: Array<{ c: Vec3; h: Vec3; yaw: number }> } {
  if (s.r < 0.12 && s.h >= s.r * 3) {
    return { capsule: { a: [s.c[0], s.c[1] + s.r, s.c[2]], b: [s.c[0], s.c[1] + s.h - s.r, s.c[2]], r: s.r }, boxes: [] };
  }
  const c: Vec3 = [s.c[0], s.c[1] + s.h / 2, s.c[2]];
  // (Its corners on the circle: the octagon's apothem is r cos 22.5°; a square's half-side r / sqrt 2 -- or r, when it's asked for square.)
  return { boxes: (s.sides ?? 8) === 8 ? slab(c, s.r * OCT, s.h / 2, 8) : slab(c, s.r * Math.SQRT1_2, s.h / 2, 4) };
}

/** One solid as pixel-style parts. */
export function pixelParts(s: DesignSolid, detail = 1): StyledPart[] {
  const b = base(s);
  switch (s.kind) {
    case "box": return [{ ...b, box: { c: [...s.c], h: [...s.h], yaw: s.yaw ?? 0 } }];
    case "wedge": return [{ ...b, wedge: { c: [...s.c], h: [...s.h], yaw: s.yaw ?? 0, lo: s.lo ?? 0 } }];
    case "capsule": return [{ ...b, capsule: { a: [...s.a], b: [...s.b], r: s.r } }];
    case "ball": return ballPrims(s, detail).map((c) => ({ ...b, capsule: c }));
    case "cone": return conePrims(s, detail).map((x) => ({ ...b, box: x }));
    case "cylinder": { const p = cylinderPrims(s); return p.capsule ? [{ ...b, capsule: p.capsule }] : p.boxes.map((x) => ({ ...b, box: x })); }
  }
}

/** The pixel style: the renderer's own solids. */
export const pixelStyle: ObjectStyle = {
  name: "pixel",
  contract: "style/pixel@1.0.0",
  title: "Pixel (the engine's primitives)",
  build(design: Design, params: StyleParams): StyledParts {
    const detail = typeof params.detail === "number" && params.detail > 0 ? params.detail : 1;
    const parts = design.solids.filter((s) => drawnIn(s, "pixel")).flatMap((s) => pixelParts(s, detail));
    return { parts, stats: { solids: design.solids.length, parts: parts.length } };
  },
};
