// The plant catalogue: each kind a recipe over a handful of growth habits, so
// a new plant is a line of numbers (or definePlant with your own builder), not
// a new shape. Sizes are the placement's: every kind is one unit tall here.

import { LEAF_BLADE, LEAF_NEEDLE, LEAF_OVAL, LEAF_ROUND, PlantBuilder, ROLE_BLOOM, ROLE_LEAF, ROLE_OWN, v3 } from "./shapes.ts";
import type { PartStyle, V3 } from "./shapes.ts";
import type { ColorRepresentation, Geometry } from "@keel-engine/lit";

const { add, mul, unit } = v3;
const TAU = Math.PI * 2;
const UP: V3 = [0, 1, 0];
const BARK = "#6a4a34", GREEN_STEM = "#5c7d3f", STONE = "#85817a";

/** A point on a curve from the root: out along `yaw`, rising, falling at the tip. */
function arc(yaw: number, reach: number, height: number, droop: number, steps = 5, from: V3 = [0, 0, 0]): V3[] {
  const path: V3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps, out = reach * t;
    path.push(add(from, [Math.cos(yaw) * out, height * t - droop * height * t * t, Math.sin(yaw) * out]));
  }
  return path;
}

export interface ShrubOptions {
  readonly height?: number; readonly spread?: number; readonly canes?: number; readonly leaves?: number;
  readonly leaf?: readonly [number, number]; readonly outline?: readonly number[]; readonly droop?: number;
  /** A dark core under the leaves, so the mass reads solid. */
  readonly core?: number;
  readonly wood?: ColorRepresentation;
  /** own: the leaves take this colour rather than the placement's tint. */
  readonly own?: ColorRepresentation;
  readonly blooms?: number; readonly bloomSize?: number; readonly bloomForm?: "puff" | "star" | "truss" | "spire";
  readonly berries?: number; readonly berry?: ColorRepresentation;
  /** Raises the mass of leaves off the ground (on roots or a stem). */
  readonly lift?: number;
}

function shrub(b: PlantBuilder, o: ShrubOptions): void {
  const h = o.height ?? 1, spread = o.spread ?? 0.75, r = b.random, lift = o.lift ?? 0;
  const leafStyle = (phase: number): PartStyle => o.own ? { role: ROLE_OWN, tone: o.own, phase, flutter: 1 } : { role: ROLE_LEAF, phase, flutter: 1 };
  const canes: V3[][] = [];
  for (let i = 0; i < b.many(o.canes ?? 5); i += 1) {
    const yaw = r() * TAU, path = arc(yaw, spread * (0.4 + 0.5 * r()), h * (0.6 + 0.3 * r()), 0.15, 4);
    canes.push(path);
    b.tube(path, 0.022, 0.006, 4, { role: ROLE_OWN, tone: o.wood ?? BARK, phase: i / 5 });
  }
  if ((o.core ?? 0.7) > 0) b.lump([0, lift + h * 0.5, 0], [spread * (o.core ?? 0.7), h * 0.46, spread * (o.core ?? 0.7)], 0.16, 1, { role: o.own ? ROLE_OWN : ROLE_LEAF, tone: o.own ?? BARK, shade: 0.5, phase: r() });
  const [len, wid] = o.leaf ?? [0.16, 0.09];
  const shell = (spot: number): { p: V3; out: V3 } => {
    const a = spot * TAU * 7.3 + r() * 1.2, u = 0.08 + 0.92 * r(), y = Math.sqrt(u), ring = Math.sqrt(1 - u * 0.96), k = 0.72 + 0.34 * r();
    const out: V3 = [Math.cos(a) * ring, y, Math.sin(a) * ring];
    return { p: [out[0] * spread * k, lift + h * 0.08 + out[1] * h * 0.9 * k, out[2] * spread * k], out };
  };
  const leaves = b.many(o.leaves ?? 130);
  for (let i = 0; i < leaves; i += 1) {
    // With no core to sit on, leaves grow from the canes rather than on a shell of air.
    const spot = shell(i / leaves);
    const out = spot.out, p = (o.core ?? 0.7) > 0 ? spot.p : canes[i % canes.length]![1 + Math.floor(r() * 4)]!;
    const dir = unit(add(out, [(r() - 0.5) * 0.9, (r() - 0.3) * 0.8, (r() - 0.5) * 0.9]));
    b.leaf(p, dir, unit(add(out, [0, 0.6, 0])), len * (0.7 + 0.6 * r()), wid * (0.7 + 0.6 * r()), { ...leafStyle(Math.floor(i / 9) * 0.137 % 1), outline: o.outline ?? LEAF_OVAL, droop: o.droop ?? 0.15, shade: 0.74 + 0.36 * p[1] / h });
  }
  const size = o.bloomSize ?? 0.1, form = o.bloomForm ?? "puff";
  for (let i = 0; i < b.many(o.blooms ?? 0); i += 1) {
    const { p, out } = shell(r());
    const phase = r();
    if (form === "puff") b.lump(add(p, mul(out, 0.03)), [size, size * 0.85, size], 0.2, 1, { role: ROLE_BLOOM, phase, flutter: 0.3 });
    else if (form === "truss") for (let k = 0; k < 5; k += 1) b.lump(add(p, [(r() - 0.5) * size * 1.6, (r() - 0.2) * size, (r() - 0.5) * size * 1.6]), [size * 0.5, size * 0.5, size * 0.5], 0.1, 0, { role: ROLE_BLOOM, phase });
    else if (form === "spire") b.lump(add(p, [0, size * 1.2, 0]), [size * 0.4, size * 1.4, size * 0.4], 0.2, 1, { role: ROLE_BLOOM, phase, flutter: 0.3 });
    else for (let k = 0; k < 5; k += 1) { const a = (k / 5) * TAU; b.leaf(p, unit(add(out, [Math.cos(a), 0, Math.sin(a)])), out, size * 1.1, size * 0.8, { role: ROLE_BLOOM, phase, outline: LEAF_ROUND, fold: 0.1 }); }
  }
  for (let i = 0; i < b.many(o.berries ?? 0); i += 1) {
    const { p } = shell(r());
    b.lump(p, [0.028, 0.028, 0.028], 0, 0, { role: ROLE_OWN, tone: o.berry ?? "#a52a2a", phase: r() });
  }
}

export interface FlowerOptions {
  readonly stems?: number; readonly lean?: number; readonly leaves?: number; readonly leaf?: readonly [number, number];
  readonly basal?: number; readonly head?: "daisy" | "cup" | "spike" | "bells" | "ball" | "umbel" | "disc" | "trumpet";
  readonly size?: number; readonly petals?: number; readonly eye?: ColorRepresentation; readonly stem?: ColorRepresentation;
  /** Whether the leaves take the plant's tint (default) or stay the stem's colour. */
  readonly nod?: number;
}

function flower(b: PlantBuilder, o: FlowerOptions): void {
  const r = b.random, stems = o.stems ?? 1, size = o.size ?? 0.14, petals = o.petals ?? 10, head = o.head ?? "daisy";
  const stemTone = o.stem ?? GREEN_STEM;
  for (let s = 0; s < stems; s += 1) {
    const yaw = r() * TAU, phase = r(), h = stems === 1 ? 1 : 0.7 + 0.3 * r();
    const path = arc(yaw, (o.lean ?? 0.1) * (stems === 1 ? 0.5 : 1 + r()), h, o.nod ?? 0.04, 5);
    b.tube(path, 0.012, 0.007, 4, { role: ROLE_OWN, tone: stemTone, phase });
    for (let i = 0; i < b.many(o.leaves ?? 3); i += 1) {
      const t = 0.15 + 0.6 * r(), at = path[Math.floor(t * 5)]!, a = r() * TAU;
      const [len, wid] = o.leaf ?? [0.26, 0.07];
      b.leaf(at, [Math.cos(a), 0.65, Math.sin(a)], UP, len, wid, { phase, outline: LEAF_BLADE, droop: 0.3, flutter: 0.6 });
    }
    const top = path[5]!, axis = unit(add(top, mul(path[4]!, -1)));
    const bloom: PartStyle = { role: ROLE_BLOOM, phase, flutter: 0.35 };
    if (head === "daisy" || head === "disc") {
      const cup = head === "disc" ? 0.1 : 0.35;
      for (let i = 0; i < b.many(petals); i += 1) {
        const a = (i / petals) * TAU, out: V3 = [Math.cos(a), cup, Math.sin(a)];
        b.leaf(top, out, axis, size * (head === "disc" ? 0.9 : 1), size * (head === "disc" ? 0.36 : 0.42), { ...bloom, outline: LEAF_OVAL, fold: 0.15 });
      }
      b.lump(add(top, mul(axis, size * 0.1)), [size * (head === "disc" ? 0.7 : 0.34), size * 0.2, size * (head === "disc" ? 0.7 : 0.34)], 0.05, 1, { role: ROLE_OWN, tone: o.eye ?? "#d9a527", phase });
    } else if (head === "cup" || head === "trumpet") {
      const rise = head === "cup" ? 1.5 : 0.8;
      for (let i = 0; i < b.many(petals); i += 1) {
        const a = (i / petals) * TAU;
        b.leaf(top, [Math.cos(a), rise, Math.sin(a)], [Math.cos(a), -0.6, Math.sin(a)], size * 1.5, size * 0.95, { ...bloom, outline: LEAF_ROUND, fold: -0.25 });
      }
      if (head === "trumpet") b.lump(add(top, [0, size * 0.3, 0]), [size * 0.12, size * 0.5, size * 0.12], 0, 0, { role: ROLE_OWN, tone: o.eye ?? "#d9a527", phase });
    } else if (head === "spike") {
      for (let i = 0; i < b.many(16); i += 1) {
        const t = i / 15, a = i * 2.4, y = 1 - t * size * 3;
        const c: V3 = add(top, [Math.cos(a) * size * 0.26 * (0.6 + t), y - 1, Math.sin(a) * size * 0.26 * (0.6 + t)]);
        b.lump(c, [size * 0.17 * (0.6 + t), size * 0.17, size * 0.17 * (0.6 + t)], 0, 0, { ...bloom, shade: 0.85 + 0.25 * r() });
      }
    } else if (head === "bells") {
      for (let i = 0; i < b.many(6); i += 1) {
        const t = i / 5, a = i * 2.2, c: V3 = add(top, [Math.cos(a) * size * 0.8, -t * size * 3, Math.sin(a) * size * 0.8]);
        for (let k = 0; k < 4; k += 1) { const q = (k / 4) * TAU; b.leaf(c, [Math.cos(q) * 0.5, -1, Math.sin(q) * 0.5], [Math.cos(q), 0, Math.sin(q)], size * 0.9, size * 0.6, { ...bloom, outline: LEAF_ROUND, fold: -0.2 }); }
      }
    } else if (head === "ball") {
      b.lump(top, [size, size, size], 0.08, 2, bloom);
    } else {
      for (let i = 0; i < b.many(9); i += 1) {
        const a = i * 2.4, q = Math.sqrt(i / 9) * size * 1.3;
        b.tube([top, add(top, [Math.cos(a) * q, size * 0.6, Math.sin(a) * q])], 0.004, 0.003, 3, { role: ROLE_OWN, tone: stemTone, phase });
        b.lump(add(top, [Math.cos(a) * q, size * 0.65, Math.sin(a) * q]), [size * 0.22, size * 0.14, size * 0.22], 0, 0, bloom);
      }
    }
  }
  for (let i = 0; i < b.many(o.basal ?? 0); i += 1) {
    const a = r() * TAU;
    b.leaf([0, 0.01, 0], [Math.cos(a), 0.55, Math.sin(a)], UP, 0.34, 0.1, { outline: LEAF_BLADE, droop: 0.35, phase: r(), flutter: 0.5 });
  }
}

export interface TuftOptions {
  readonly blades?: number; readonly spread?: number; readonly width?: number; readonly droop?: number; readonly curl?: number;
  readonly crown?: "plume" | "cattail" | "seed" | "none"; readonly crowns?: number; readonly crownTone?: ColorRepresentation;
  readonly own?: ColorRepresentation;
}

/** Grasses, reeds, sedges: blades fanning from one root. */
function tuft(b: PlantBuilder, o: TuftOptions): void {
  const r = b.random, blades = b.many(o.blades ?? 26), spread = o.spread ?? 0.3, wide = o.width ?? 0.035;
  for (let i = 0; i < blades; i += 1) {
    const yaw = r() * TAU, h = 0.55 + 0.45 * r(), phase = r(), reach = spread * (0.4 + r()), foot: V3 = [Math.cos(yaw) * 0.05, 0, Math.sin(yaw) * 0.05];
    const path = arc(yaw, reach, h, o.droop ?? 0.35, 4, foot);
    for (let k = 0; k < 4; k += 1) {
      const a = path[k]!, c = path[k + 1]!;
      const style: PartStyle = o.own ? { role: ROLE_OWN, tone: o.own, phase, flutter: 0.5 } : { phase, flutter: 0.5, shade: 0.72 + 0.1 * k };
      b.leaf(a, add(c, mul(a, -1)), [-Math.sin(yaw), 0.2, Math.cos(yaw)], Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), wide * (1 - k * 0.2), { ...style, outline: k === 3 ? [1, 0.5, 0] : [1, 1], fold: 0.1 });
    }
  }
  const crown = o.crown ?? "none", tone = o.crownTone ?? "#d8c8a0";
  for (let i = 0; i < b.many(o.crowns ?? 0); i += 1) {
    const yaw = r() * TAU, phase = r(), path = arc(yaw, spread * 0.3, 1, 0.02, 4);
    b.tube(path, 0.0055, 0.0025, 3, { role: ROLE_OWN, tone: GREEN_STEM, phase });
    const top = path[4]!;
    if (crown === "cattail") b.lump(add(top, [0, -0.1, 0]), [0.028, 0.1, 0.028], 0, 1, { role: ROLE_OWN, tone: "#5a3a22", phase });
    else if (crown === "plume") {
      // A plume is a loose feather along the stem's tip: slim sprays lying close to it, not a fan.
      const sprays = b.many(14);
      for (let k = 0; k < sprays; k += 1) {
        const up = k / sprays, turn = k * 2.4, out = 0.14 + 0.16 * (1 - up);
        b.leaf(add(top, [0, -0.3 * (1 - up), 0]), [Math.cos(turn) * out, 1, Math.sin(turn) * out], [Math.sin(turn), 0, -Math.cos(turn)], 0.13 + 0.09 * (1 - up), 0.016, { role: ROLE_OWN, tone, phase, flutter: 1, outline: LEAF_BLADE, fold: 0.05 });
      }
    }
    else b.lump(add(top, [0, -0.04, 0]), [0.016, 0.06, 0.016], 0.1, 0, { role: ROLE_OWN, tone, phase });
  }
}

export interface RosetteOptions {
  readonly leaves?: number; readonly length?: number; readonly width?: number; readonly droop?: number; readonly rise?: number;
  readonly outline?: readonly number[]; readonly stalk?: boolean; readonly bloom?: boolean; readonly fold?: number;
  readonly own?: ColorRepresentation;
}

/** Agaves, hostas, bromeliads, aloes: leaves from one centre. */
function rosette(b: PlantBuilder, o: RosetteOptions): void {
  const r = b.random, n = b.many(o.leaves ?? 18);
  for (let i = 0; i < n; i += 1) {
    const t = i / n, a = i * 2.399, rise = (o.rise ?? 0.9) * (1.4 - t);
    b.leaf([0, 0.02, 0], [Math.cos(a), rise, Math.sin(a)], UP, (o.length ?? 0.9) * (0.65 + 0.35 * (1 - t) + 0.1 * r()), o.width ?? 0.2, { ...(o.own ? { role: ROLE_OWN, tone: o.own } : {}), phase: r(), flutter: 0.3, outline: o.outline ?? LEAF_BLADE, droop: o.droop ?? 0.25, fold: o.fold ?? 0.35, shade: 0.8 + 0.3 * t });
  }
  if (o.stalk) {
    const phase = r();
    b.tube(arc(0, 0.03, 1.8, 0, 4), 0.03, 0.012, 5, { role: ROLE_OWN, tone: GREEN_STEM, phase });
    if (o.bloom ?? true) for (let i = 0; i < b.many(16); i += 1) b.lump([(r() - 0.5) * 0.2, 1.3 + r() * 0.5, (r() - 0.5) * 0.2], [0.05, 0.05, 0.05], 0.1, 0, { role: ROLE_BLOOM, phase });
  }
}

export interface CrownOptions {
  readonly trunk?: number; readonly girth?: number; readonly fronds?: number; readonly length?: number; readonly width?: number;
  readonly droop?: number; readonly feather?: boolean; readonly wood?: ColorRepresentation; readonly stems?: number; readonly outline?: readonly number[];
}

/** Palms, tree ferns, bananas, papyrus: a stem with a head of big leaves. */
function crown(b: PlantBuilder, o: CrownOptions): void {
  const r = b.random, h = o.trunk ?? 0.7, len = o.length ?? 0.6;
  for (let s = 0; s < (o.stems ?? 1); s += 1) {
    const yaw = r() * TAU, lean = (o.stems ?? 1) > 1 ? 0.18 : 0.04, phase = r(), top: V3 = [Math.cos(yaw) * lean, h * (0.8 + 0.2 * r()), Math.sin(yaw) * lean];
    const path: V3[] = [[0, 0, 0], mul(top, 0.33), mul(top, 0.66), top];
    if (h > 0.02) b.tube(path, o.girth ?? 0.04, (o.girth ?? 0.04) * 0.6, 5, { role: ROLE_OWN, tone: o.wood ?? BARK, phase: 0 });
    const fronds = b.many(o.fronds ?? 9);
    for (let i = 0; i < fronds; i += 1) {
      const a = (i / fronds) * TAU + r() * 0.4, rise = 0.2 + r() * 0.9, out: V3 = [Math.cos(a), rise, Math.sin(a)], fp = r();
      if (o.feather) {
        const stem = arc(a, len * 0.9, len * rise * 0.7, o.droop ?? 1, 6, top);
        b.tube(stem, 0.006, 0.002, 3, { role: ROLE_OWN, tone: GREEN_STEM, phase: fp });
        for (let k = 1; k < 7; k += 1) for (const side of [-1, 1]) {
          const at = stem[Math.min(6, k)]!, pin: V3 = [-Math.sin(a) * side, -0.15, Math.cos(a) * side];
          b.leaf(at, pin, UP, (o.width ?? 0.2) * (1.15 - k * 0.14), 0.05, { phase: fp, flutter: 0.8, outline: LEAF_BLADE, fold: 0.05 });
        }
      } else b.leaf(top, out, UP, len, o.width ?? 0.2, { phase: fp, flutter: 0.5, outline: o.outline ?? LEAF_OVAL, droop: o.droop ?? 0.5, fold: 0.2 });
    }
  }
}

export interface ColumnOptions { readonly girth?: number; readonly arms?: number; readonly ribs?: number; readonly tone?: ColorRepresentation; readonly bloom?: boolean; readonly squat?: boolean }

/** Cacti: ribbed columns, arms turning up. */
function column(b: PlantBuilder, o: ColumnOptions): void {
  const r = b.random, g = o.girth ?? 0.09, tone = o.tone ?? "#4f7a4c", ribs = o.ribs ?? 8;
  const ribbed = (path: readonly V3[], r0: number, r1: number, phase: number): void => {
    for (let i = 0; i < ribs; i += 2) {
      const a = (i / ribs) * TAU, s: V3 = [Math.cos(a) * r0 * 0.72, 0, Math.sin(a) * r0 * 0.72];
      b.tube(path.map((p) => add(p, s)), r0 * 0.46, r1 * 0.3, 5, { role: ROLE_OWN, tone, phase, shade: 0.88 + 0.2 * r() });
    }
    b.tube(path, r0 * 0.85, r1 * 0.5, 7, { role: ROLE_OWN, tone, phase, shade: 0.72 });
  };
  const trunk: V3[] = [[0, 0, 0], [0, 0.3, 0], [0, 0.62, 0], [0, 0.88, 0], [0, 1, 0]];
  ribbed(trunk, g, g * 0.8, 0);
  for (let i = 0; i < (o.arms ?? 2); i += 1) {
    const a = r() * TAU + i * 2.2, y = 0.36 + r() * 0.26, out = 0.2 + r() * 0.08, top = y + 0.24 + r() * 0.16;
    ribbed([[0, y, 0], [Math.cos(a) * out * 0.6, y + 0.01, Math.sin(a) * out * 0.6], [Math.cos(a) * out, y + 0.08, Math.sin(a) * out], [Math.cos(a) * out, top, Math.sin(a) * out]], g * 0.62, g * 0.5, 0);
  }
  if (o.bloom) b.lump([0, 1.01, 0], [g * 0.5, g * 0.3, g * 0.5], 0.2, 1, { role: ROLE_BLOOM });
}

function barrel(b: PlantBuilder): void {
  const r = b.random;
  for (let i = 0; i < b.many(14); i += 1) { const a = (i / 14) * TAU; b.lump([Math.cos(a) * 0.34, 0.44, Math.sin(a) * 0.34], [0.13, 0.46, 0.13], 0, 1, { role: ROLE_OWN, tone: "#5a8150", shade: 0.85 + 0.2 * r() }); }
  b.lump([0, 0.44, 0], [0.4, 0.5, 0.4], 0, 2, { role: ROLE_OWN, tone: "#46693f", shade: 0.8 });
  for (let i = 0; i < b.many(6); i += 1) { const a = r() * TAU; b.lump([Math.cos(a) * 0.12, 0.95, Math.sin(a) * 0.12], [0.05, 0.05, 0.05], 0.1, 0, { role: ROLE_BLOOM }); }
}

function pads(b: PlantBuilder): void {
  const r = b.random;
  const pad = (at: V3, yaw: number, size: number, depth: number): void => {
    const c = add(at, [Math.cos(yaw) * size * 0.3, size * 0.9, Math.sin(yaw) * size * 0.3]);
    b.lump(c, [size * 0.72, size, size * 0.2], 0.05, 1, { role: ROLE_OWN, tone: "#5e8c52", shade: 0.85 + 0.2 * r() });
    if (depth <= 0) { b.lump(add(c, [0, size, 0]), [0.03, 0.04, 0.03], 0, 0, { role: ROLE_BLOOM }); return; }
    for (let i = 0; i < 2; i += 1) pad(add(c, [0, size * 0.75, 0]), yaw + 1 + r() * 2, size * 0.8, depth - 1);
  };
  for (let i = 0; i < 2; i += 1) pad([0, 0, 0], i * 3 + r(), 0.2, 2);
}

function rock(b: PlantBuilder, o: { readonly tone?: ColorRepresentation; readonly flat?: number; readonly count?: number; readonly rough?: number; readonly moss?: boolean }): void {
  const r = b.random, n = o.count ?? 1, tone = o.tone ?? STONE;
  for (let i = 0; i < n; i += 1) {
    const s = n === 1 ? 1 : 0.35 + 0.5 * r(), a = r() * TAU, q = n === 1 ? 0 : r() * 1.2;
    b.lump([Math.cos(a) * q, s * 0.34, Math.sin(a) * q], [s * (0.7 + 0.4 * r()) * (1 / (o.flat ?? 1)), s * 0.62, s * (0.7 + 0.4 * r())], o.rough ?? 0.14, 2, { role: ROLE_OWN, tone, facets: true, shade: 0.82 + 0.25 * r() });
    if (o.moss) b.lump([Math.cos(a) * q, s * 0.72, Math.sin(a) * q], [s * 0.55, s * 0.22, s * 0.55], 0.25, 1, { phase: r(), shade: 0.85 });
  }
}

function log(b: PlantBuilder, o: { readonly tone?: ColorRepresentation; readonly moss?: boolean; readonly stump?: boolean }): void {
  const r = b.random, tone = o.tone ?? "#5d4634";
  if (o.stump) {
    b.tube([[0, 0, 0], [0, 0.5, 0], [0, 1, 0]], 0.55, 0.42, 9, { role: ROLE_OWN, tone });
    b.lump([0, 1, 0], [0.42, 0.04, 0.42], 0, 2, { role: ROLE_OWN, tone: "#b49a70" });
  } else {
    b.tube([[-1.8, 0.28, 0], [-0.6, 0.3, 0.05], [0.6, 0.27, -0.04], [1.8, 0.24, 0]], 0.3, 0.2, 8, { role: ROLE_OWN, tone });
    b.tube([[0.3, 0.45, 0], [0.5, 0.8, 0.25]], 0.07, 0.03, 5, { role: ROLE_OWN, tone });
  }
  if (o.moss) for (let i = 0; i < 6; i += 1) b.lump(o.stump ? [(r() - 0.5) * 0.7, r() * 0.8, (r() - 0.5) * 0.7] : [(r() - 0.5) * 3, 0.5, (r() - 0.5) * 0.25], [0.26, 0.09, 0.2], 0.3, 1, { shade: 0.9 });
}

function toadstool(b: PlantBuilder, o: { readonly count?: number; readonly flat?: number; readonly spots?: boolean }): void {
  const r = b.random;
  for (let i = 0; i < (o.count ?? 3); i += 1) {
    const s = 0.5 + 0.5 * r(), a = r() * TAU, q = i === 0 ? 0 : 0.2 + 0.3 * r(), x = Math.cos(a) * q, z = Math.sin(a) * q;
    b.tube([[x, 0, z], [x, s * 0.5, z], [x, s * 0.9, z]], 0.07 * s, 0.05 * s, 5, { role: ROLE_OWN, tone: "#e8dfc8" });
    b.lump([x, s * 0.92, z], [0.34 * s, 0.17 * s / (o.flat ?? 1), 0.34 * s], 0, 2, { role: ROLE_BLOOM });
    if (o.spots) for (let k = 0; k < 5; k += 1) { const q2 = r() * TAU; b.lump([x + Math.cos(q2) * 0.18 * s, s * 1.04, z + Math.sin(q2) * 0.18 * s], [0.04, 0.015, 0.04], 0, 0, { role: ROLE_OWN, tone: "#f4efe2" }); }
  }
}

function padLeaves(b: PlantBuilder, bloom: boolean): void {
  const r = b.random;
  for (let i = 0; i < b.many(5); i += 1) {
    const a = r() * TAU, q = i === 0 ? 0 : 0.25 + r() * 0.5, c: V3 = [Math.cos(a) * q, 0.03, Math.sin(a) * q];
    for (let k = 0; k < 9; k += 1) { const t = (k / 9) * TAU * 0.94; b.leaf(c, [Math.cos(t), 0.02, Math.sin(t)], UP, 0.3, 0.2, { outline: [0.25, 0.9, 1], fold: 0, phase: r(), flutter: 0.1 }); }
  }
  // (A speck at unit height, so finish() keeps the pads flat rather than scaling them up to one tall.)
  b.lump([0, 1, 0], [0.002, 0.002, 0.002], 0, 0, {});
  if (bloom) for (let k = 0; k < 8; k += 1) { const t = (k / 8) * TAU; b.leaf([0, 0.06, 0], [Math.cos(t), 0.8, Math.sin(t)], UP, 0.26, 0.11, { role: ROLE_BLOOM, fold: -0.1 }); }
}

export interface HangOptions {
  readonly strands?: number; readonly spread?: number; readonly leaves?: number; readonly leaf?: readonly [number, number];
  readonly tone?: ColorRepresentation; readonly tips?: boolean; readonly beard?: boolean; readonly outline?: readonly number[];
}

/** Lianas, ivy curtains, Spanish moss, wisteria, aerial roots: all fall from an anchor. */
function hanging(b: PlantBuilder, o: HangOptions): void {
  const r = b.random, spread = o.spread ?? 0.25;
  for (let s = 0; s < b.many(o.strands ?? 6); s += 1) {
    const a = r() * TAU, q = r() * spread, x = Math.cos(a) * q, z = Math.sin(a) * q, len = 0.5 + 0.5 * r(), phase = r();
    const path: V3[] = [];
    for (let i = 0; i <= 6; i += 1) { const t = i / 6; path.push([x + Math.sin(t * 5 + phase * 6) * 0.015, -len * t, z + Math.cos(t * 4 + phase * 6) * 0.015]); }
    b.tube(path, 0.006, 0.002, 3, { role: ROLE_OWN, tone: o.tone ?? GREEN_STEM, phase });
    const n = b.many(o.leaves ?? 10);
    for (let i = 0; i < n; i += 1) {
      const t = (i + 0.5) / n, at = path[Math.floor(t * 6)]!, q2 = r() * TAU;
      if (o.beard) b.leaf(at, [Math.cos(q2) * 0.3, -1, Math.sin(q2) * 0.3], [Math.cos(q2), 0, Math.sin(q2)], 0.09, 0.012, { role: ROLE_OWN, tone: o.tone ?? "#8f9a84", phase, flutter: 1, outline: LEAF_NEEDLE, fold: 0 });
      else { const [l, w] = o.leaf ?? [0.05, 0.035]; b.leaf(at, [Math.cos(q2), -0.5, Math.sin(q2)], [Math.cos(q2), 0.5, Math.sin(q2)], l, w, { phase, flutter: 1, outline: o.outline ?? LEAF_OVAL }); }
    }
    if (o.tips) for (let i = 0; i < 9; i += 1) b.lump(add(path[6]!, [(r() - 0.5) * 0.02 * (9 - i), 0.02 * (9 - i), (r() - 0.5) * 0.02 * (9 - i)]), [0.016, 0.014, 0.016], 0, 0, { role: ROLE_BLOOM, phase });
  }
}

function proproots(b: PlantBuilder): void {
  const r = b.random;
  for (let i = 0; i < b.many(9); i += 1) {
    const a = (i / 9) * TAU + r() * 0.3, q = 0.28 + r() * 0.2;
    b.tube([[Math.cos(a) * q, 0, Math.sin(a) * q], [Math.cos(a) * q * 0.75, 0.22, Math.sin(a) * q * 0.75], [Math.cos(a) * q * 0.3, 0.42, Math.sin(a) * q * 0.3], [0, 0.5, 0]], 0.022, 0.018, 4, { role: ROLE_OWN, tone: "#4e4034" });
  }
  b.tube([[0, 0.4, 0], [0, 0.8, 0]], 0.045, 0.03, 5, { role: ROLE_OWN, tone: "#4e4034" });
  shrub(b, { height: 0.75, spread: 0.6, canes: 1, leaves: 170, leaf: [0.09, 0.05], core: 0.62, lift: 0.55 });
}

function bambooClump(b: PlantBuilder): void {
  const r = b.random;
  for (let i = 0; i < b.many(9); i += 1) {
    const a = r() * TAU, q = r() * 0.14, base: V3 = [Math.cos(a) * q, 0, Math.sin(a) * q], h = 0.7 + r() * 0.3, phase = r();
    const path = arc(a, 0.12, h, 0.02, 6, base);
    b.tube(path, 0.016, 0.009, 5, { role: ROLE_OWN, tone: "#7a9a4c", phase });
    for (let k = 2; k <= 6; k += 1) for (let l = 0; l < 4; l += 1) {
      const q2 = r() * TAU;
      b.leaf(path[k]!, [Math.cos(q2), -0.1, Math.sin(q2)], UP, 0.14, 0.022, { phase, flutter: 1, outline: LEAF_BLADE, droop: 0.3 });
    }
  }
}

function fern(b: PlantBuilder, o: { readonly fronds?: number; readonly wide?: number }): void {
  const r = b.random;
  for (let i = 0; i < b.many(o.fronds ?? 9); i += 1) {
    const a = (i / (o.fronds ?? 9)) * TAU + r() * 0.3, phase = r(), reach = 0.72 + r() * 0.3;
    const path = arc(a, reach, 1, 0.82, 7);
    b.tube(path, 0.008, 0.002, 3, { role: ROLE_OWN, tone: GREEN_STEM, phase });
    for (let k = 1; k <= 7; k += 1) for (const s of [-1, 1]) b.leaf(path[k]!, [-Math.sin(a) * s + Math.cos(a) * 0.4, -0.1, Math.cos(a) * s + Math.sin(a) * 0.4], UP, (o.wide ?? 0.25) * (1.25 - k * 0.15), 0.05, { phase, flutter: 0.7, outline: LEAF_BLADE, fold: 0.08 });
  }
}

type Recipe = (b: PlantBuilder) => void;
export interface PlantDef {
  readonly make: Recipe;
  readonly group: "bush" | "flower" | "grass" | "understory" | "desert" | "wetland" | "object" | "hanging" | "fungus";
  /** Bend's power: 0 stands rigid, 1 a stiff lever, 2 a whip. */
  readonly give?: number;
  /** How far wind and bodies move it, 0..1. */
  readonly sway?: number;
  /** Turns its normals out, so a mass of leaves shades as one. */
  readonly round?: number;
  readonly hang?: boolean;
  readonly shadow?: boolean;
}

const bush = (o: ShrubOptions): PlantDef => ({ make: (b) => { shrub(b, o); }, group: "bush", give: 1.3, sway: 0.5, round: 0.65, shadow: true });
const bloom = (o: FlowerOptions): PlantDef => ({ make: (b) => { flower(b, o); }, group: "flower", give: 1.8, sway: 1 });
const grass = (o: TuftOptions): PlantDef => ({ make: (b) => { tuft(b, o); }, group: "grass", give: 2, sway: 1 });
const wet = (o: TuftOptions): PlantDef => ({ ...grass(o), group: "wetland" });
const under = (make: Recipe, sway = 0.7): PlantDef => ({ make, group: "understory", give: 1.7, sway, round: 0.35, shadow: true });
const thing = (make: Recipe, shadow = true): PlantDef => ({ make, group: "object", give: 0, sway: 0, shadow });
const dry = (make: Recipe, sway = 0): PlantDef => ({ make, group: "desert", give: 1.2, sway, shadow: true });
const fall = (o: HangOptions): PlantDef => ({ make: (b) => { hanging(b, o); }, group: "hanging", give: 1.3, sway: 1, hang: true });
const shroom = (o: Parameters<typeof toadstool>[1]): PlantDef => ({ make: (b) => { toadstool(b, o); }, group: "fungus", give: 0, sway: 0 });

export const PLANTS: Record<string, PlantDef> = {
  // Bushes, round the world.
  boxwood: bush({ leaves: 170, leaf: [0.09, 0.055], core: 0.8 }),
  hydrangea: bush({ leaves: 110, leaf: [0.2, 0.14], blooms: 12, bloomSize: 0.13 }),
  azalea: bush({ height: 0.8, spread: 0.85, leaves: 100, leaf: [0.09, 0.05], blooms: 34, bloomSize: 0.05, bloomForm: "star" }),
  rhododendron: bush({ leaves: 80, leaf: [0.3, 0.1], blooms: 12, bloomSize: 0.09, bloomForm: "truss", spread: 0.8 }),
  holly: bush({ leaves: 130, leaf: [0.13, 0.08], outline: [0.2, 1, 0.5, 1, 0.5, 1, 0], berries: 22 }),
  juniper: bush({ height: 0.55, spread: 1.1, leaves: 200, leaf: [0.16, 0.024], outline: LEAF_NEEDLE, core: 0.72, berries: 10, berry: "#3f4f7a" }),
  gorse: bush({ leaves: 150, leaf: [0.13, 0.016], outline: LEAF_NEEDLE, blooms: 34, bloomSize: 0.035, bloomForm: "truss" }),
  heather: bush({ height: 0.5, spread: 1, canes: 7, leaves: 110, leaf: [0.08, 0.02], outline: LEAF_NEEDLE, blooms: 34, bloomSize: 0.05, bloomForm: "spire", core: 0.68 }),
  sagebrush: bush({ canes: 8, leaves: 130, leaf: [0.14, 0.035], outline: LEAF_BLADE, core: 0.5, wood: "#7a6f60" }),
  creosote: bush({ canes: 11, spread: 0.8, leaves: 60, leaf: [0.07, 0.03], core: 0, wood: "#4f4a3e" }),
  saltbush: bush({ height: 0.6, spread: 1, leaves: 120, leaf: [0.09, 0.05], core: 0.7, wood: "#8a8370" }),
  bramble: bush({ canes: 11, spread: 1, height: 0.8, leaves: 90, leaf: [0.14, 0.09], core: 0.42, wood: "#6c3550", berries: 20, berry: "#2a1a33", blooms: 7, bloomSize: 0.035, bloomForm: "star" }),
  blueberry: bush({ height: 0.6, leaves: 110, leaf: [0.08, 0.05], berries: 24, berry: "#34407a" }),
  rose: bush({ canes: 8, leaves: 100, leaf: [0.1, 0.07], core: 0.45, wood: "#4e6a3a", blooms: 12, bloomSize: 0.08, bloomForm: "puff" }),
  lilac: bush({ height: 1.3, leaves: 100, leaf: [0.15, 0.1], blooms: 14, bloomSize: 0.1, bloomForm: "spire" }),
  oleander: bush({ height: 1.3, leaves: 120, leaf: [0.3, 0.05], outline: LEAF_BLADE, blooms: 18, bloomSize: 0.05, bloomForm: "star" }),
  manzanita: bush({ canes: 9, wood: "#8a3a24", leaves: 70, leaf: [0.09, 0.06], core: 0.3, berries: 8, berry: "#9c5a32" }),
  protea: bush({ canes: 6, leaves: 70, leaf: [0.22, 0.07], outline: LEAF_BLADE, core: 0.28, blooms: 5, bloomSize: 0.17 }),
  "dwarf-willow": bush({ height: 0.35, spread: 1.2, canes: 9, leaves: 90, leaf: [0.1, 0.04], core: 0.55 }),
  mangrove: { make: proproots, group: "bush", give: 1.1, sway: 0.25, round: 0.5, shadow: true },
  // Flowers.
  sunflower: bloom({ head: "disc", size: 0.24, petals: 16, leaves: 4, leaf: [0.3, 0.2], nod: 0.14, eye: "#4a2f1a" }),
  tulip: bloom({ head: "cup", size: 0.11, petals: 6, leaves: 0, basal: 4 }),
  poppy: bloom({ head: "cup", size: 0.15, petals: 4, leaves: 2, lean: 0.2, eye: "#1a1a1a" }),
  lily: bloom({ head: "trumpet", size: 0.18, petals: 6, leaves: 7, leaf: [0.2, 0.05] }),
  lupin: bloom({ head: "spike", size: 0.13, leaves: 5, leaf: [0.14, 0.04] }),
  foxglove: bloom({ head: "bells", size: 0.09, leaves: 3, basal: 7 }),
  lavender: bloom({ head: "spike", size: 0.06, stems: 9, lean: 0.34, leaves: 2, leaf: [0.18, 0.02] }),
  daisy: bloom({ head: "daisy", stems: 3, lean: 0.2, leaves: 1, size: 0.11, basal: 5 }),
  coneflower: bloom({ head: "daisy", stems: 2, size: 0.15, eye: "#6a3320", lean: 0.15 }),
  allium: bloom({ head: "ball", size: 0.14, leaves: 0, basal: 4 }),
  bluebell: bloom({ head: "bells", size: 0.05, stems: 3, leaves: 0, basal: 5, nod: 0.15, lean: 0.14 }),
  crocus: bloom({ head: "cup", size: 0.16, stems: 3, petals: 6, leaves: 0, basal: 6, lean: 0.2 }),
  dandelion: bloom({ head: "ball", size: 0.09, stems: 2, leaves: 0, basal: 7, lean: 0.2 }),
  iris: bloom({ head: "trumpet", size: 0.16, petals: 6, leaves: 0, basal: 8 }),
  gentian: bloom({ head: "cup", size: 0.2, stems: 4, petals: 5, leaves: 3, leaf: [0.14, 0.05], lean: 0.25 }),
  edelweiss: bloom({ head: "daisy", size: 0.2, stems: 4, petals: 9, leaves: 3, leaf: [0.14, 0.05], lean: 0.3, eye: "#d8c868" }),
  orchid: bloom({ head: "umbel", size: 0.18, leaves: 0, basal: 4, nod: 0.3 }),
  "bird-of-paradise": bloom({ head: "disc", size: 0.2, petals: 5, leaves: 0, basal: 7, nod: 0.3, eye: "#3a5a9a" }),
  // Grasses.
  bunchgrass: grass({ blades: 34, spread: 0.3 }),
  tussock: grass({ blades: 60, spread: 0.65, droop: 0.72, width: 0.026 }),
  pampas: grass({ blades: 44, spread: 0.45, droop: 0.5, crown: "plume", crowns: 5 }),
  marram: grass({ blades: 34, spread: 0.45, droop: 0.42, width: 0.02 }),
  spinifex: grass({ blades: 70, spread: 0.85, droop: 0.15, width: 0.012 }),
  wheatgrass: grass({ blades: 20, spread: 0.16, droop: 0.2, crown: "seed", crowns: 7, crownTone: "#d6bc76" }),
  feathergrass: grass({ blades: 34, spread: 0.3, droop: 0.65, width: 0.012, crown: "plume", crowns: 7, crownTone: "#e9e2c8" }),
  // Forest floor and jungle.
  fern: under((b) => { fern(b, {}); }),
  "tree-fern": under((b) => { crown(b, { trunk: 0.72, girth: 0.05, fronds: 11, length: 0.62, width: 0.15, feather: true, droop: 0.9, wood: "#3f3026" }); }, 0.35),
  hosta: under((b) => { rosette(b, { leaves: 14, length: 0.8, width: 0.42, outline: LEAF_ROUND, droop: 0.4, stalk: false }); }),
  monstera: under((b) => { rosette(b, { leaves: 9, length: 0.95, width: 0.62, outline: [0, 1, 0.7, 1, 0.65, 0.8, 0], droop: 0.55, fold: 0.15 }); }),
  banana: under((b) => { crown(b, { trunk: 0.55, girth: 0.06, fronds: 8, length: 0.72, width: 0.26, droop: 0.6, wood: "#7a8a4a" }); }, 0.45),
  bromeliad: under((b) => { rosette(b, { leaves: 20, length: 0.9, width: 0.15, droop: 0.15, rise: 1.2, stalk: true }); }),
  heliconia: under((b) => { flower(b, { head: "bells", size: 0.11, leaves: 7, leaf: [0.44, 0.13], nod: 0.2 }); }),
  taro: under((b) => { rosette(b, { leaves: 8, length: 1, width: 0.56, outline: LEAF_ROUND, rise: 1.3, droop: 0.65, fold: 0.1 }); }),
  bamboo: { make: bambooClump, group: "understory", give: 1.5, sway: 0.8, shadow: true },
  palmetto: under((b) => { crown(b, { trunk: 0.02, fronds: 12, length: 1, width: 0.5, droop: 0.2, outline: [0, 0.8, 1, 1, 0.9] }); }, 0.3),
  cycad: under((b) => { crown(b, { trunk: 0.28, girth: 0.09, fronds: 12, length: 0.72, width: 0.14, feather: true, droop: 0.4, wood: "#5c4a38" }); }, 0.3),
  // Desert.
  saguaro: dry((b) => { column(b, { arms: 3 }); }),
  barrel: dry(barrel),
  "prickly-pear": dry(pads),
  agave: dry((b) => { rosette(b, { leaves: 24, length: 1, width: 0.2, droop: 0.04, rise: 1.1, own: "#7e9c8a", fold: 0.5 }); }, 0.05),
  yucca: dry((b) => { crown(b, { trunk: 0.5, girth: 0.05, fronds: 26, length: 0.5, width: 0.05, droop: 0.05, outline: LEAF_BLADE, wood: "#6a5a48" }); }, 0.2),
  aloe: dry((b) => { rosette(b, { leaves: 16, length: 0.82, width: 0.18, droop: 0.3, rise: 1.1, own: "#6d9378", stalk: true, fold: 0.5 }); }, 0.1),
  ocotillo: dry((b) => { const r = b.random; for (let i = 0; i < 10; i += 1) { const a = r() * TAU, p = r(); const path = arc(a, 0.3 + r() * 0.25, 0.8 + r() * 0.2, 0.02, 5); b.tube(path, 0.012, 0.004, 3, { role: ROLE_OWN, tone: "#6a5a48", phase: p }); for (let k = 1; k < 5; k += 1) b.leaf(path[k]!, [Math.cos(k * 2), 0.5, Math.sin(k * 2)], UP, 0.05, 0.022, { phase: p, flutter: 1 }); } }, 0.5),
  tumbleweed: { make: (b) => { shrub(b, { canes: 16, leaves: 26, leaf: [0.04, 0.012], core: 0, wood: "#a68f62", spread: 0.55 }); }, group: "desert", give: 1, sway: 0.4 },
  // Wetland.
  cattail: wet({ blades: 12, spread: 0.2, droop: 0.2, crown: "cattail", crowns: 4, width: 0.03 }),
  reed: wet({ blades: 26, spread: 0.2, droop: 0.2, crown: "plume", crowns: 4, width: 0.024, crownTone: "#9c8460" }),
  sedge: wet({ blades: 54, spread: 0.5, droop: 0.58, width: 0.02 }),
  papyrus: { make: (b) => { crown(b, { trunk: 1, girth: 0.012, stems: 7, fronds: 22, length: 0.3, width: 0.016, droop: 0.28, wood: "#66864a", outline: LEAF_BLADE }); }, group: "wetland", give: 1.7, sway: 0.9 },
  horsetail: wet({ blades: 12, spread: 0.08, droop: 0, width: 0.016, crown: "seed", crowns: 5, crownTone: "#3e4a2e" }),
  "pitcher-plant": { make: (b) => { const r = b.random; for (let i = 0; i < 6; i += 1) { const a = r() * TAU; const p = arc(a, 0.3, 0.85 + r() * 0.15, 0, 4); b.tube(p, 0.03, 0.09, 6, { role: ROLE_BLOOM, phase: r() }); } }, group: "wetland", give: 1.4, sway: 0.3 },
  "water-lily": { make: (b) => { padLeaves(b, true); }, group: "wetland", give: 0, sway: 0 },
  "lily-pad": { make: (b) => { padLeaves(b, false); }, group: "wetland", give: 0, sway: 0 },
  sphagnum: { make: (b) => { const r = b.random; for (let i = 0; i < 8; i += 1) b.lump([(r() - 0.5) * 1.6, 0.25, (r() - 0.5) * 1.6], [0.5, 0.42, 0.5], 0.16, 1, { shade: 0.85 + 0.25 * r() }); }, group: "wetland", give: 0, sway: 0 },
  // Fungi.
  toadstool: shroom({ spots: true }),
  bolete: shroom({ count: 2, flat: 0.65 }),
  bracket: shroom({ count: 5, flat: 1.6 }),
  // Things on the ground.
  boulder: thing((b) => { rock(b, {}); }),
  "mossy-boulder": thing((b) => { rock(b, { moss: true, tone: "#6c6f66" }); }),
  slab: thing((b) => { rock(b, { flat: 0.42, tone: "#8c8476" }); }),
  scree: thing((b) => { rock(b, { count: 9, rough: 0.2, tone: "#7d7b78" }); }),
  sandstone: thing((b) => { rock(b, { flat: 0.7, tone: "#b57a50", rough: 0.08 }); }),
  basalt: thing((b) => { rock(b, { count: 3, rough: 0.26, tone: "#37353a" }); }),
  "ice-block": thing((b) => { rock(b, { count: 2, rough: 0.06, tone: "#bfe2ee" }); }),
  log: thing((b) => { log(b, {}); }),
  "mossy-log": thing((b) => { log(b, { moss: true }); }),
  stump: thing((b) => { log(b, { stump: true, moss: true }); }),
  driftwood: thing((b) => { log(b, { tone: "#a6988a" }); }),
  "termite-mound": thing((b) => { b.lump([0, 0.5, 0], [0.33, 0.55, 0.33], 0.2, 2, { role: ROLE_OWN, tone: "#a4633c", facets: true }); b.lump([0.12, 0.72, 0.05], [0.13, 0.32, 0.13], 0.2, 1, { role: ROLE_OWN, tone: "#a4633c" }); }),
  // Hanging from an anchor.
  liana: fall({ strands: 4, leaves: 7, leaf: [0.06, 0.04], tone: "#5a4a30" }),
  "ivy-curtain": fall({ strands: 9, leaves: 15, leaf: [0.05, 0.05], outline: LEAF_ROUND }),
  "spanish-moss": fall({ strands: 14, leaves: 14, beard: true }),
  wisteria: fall({ strands: 8, leaves: 8, leaf: [0.06, 0.02], tips: true }),
  "aerial-roots": fall({ strands: 12, leaves: 0, tone: "#5a4a38", spread: 0.32 }),
};

export const PLANT_KINDS = Object.keys(PLANTS);

/** Adds a kind, or replaces one, for every field built after. */
export function definePlant(kind: string, def: PlantDef): void { PLANTS[kind] = def; }

/** One kind's geometry: the same seed makes the same plant; `detail` 0..1 thins its parts. */
export function plantGeometry(kind: string, { seed = 1, detail = 1 }: { readonly seed?: number; readonly detail?: number } = {}): Geometry {
  const def = PLANTS[kind];
  if (def === undefined) throw new Error(`Unknown plant ${kind}.`);
  const builder = new PlantBuilder(seed, detail);
  def.make(builder);
  return builder.finish({ give: def.give || 1, hang: def.hang ?? false, round: def.round ?? 0 });
}
