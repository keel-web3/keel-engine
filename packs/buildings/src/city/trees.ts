// The city's own trees and plants, designed for a pixel-art night city, and sorted by CLIMATE: a city grows one
// climate's plants and no other's (keel/city climateOf), so a palm never stands beside a spruce.
//
//   temperate      linden and birch on the streets; oak, maple, birch, the odd cherry in flower in the parks; scots
//                  pine and spruce; round shrubs, box hedges, tulip beds
//   boreal         subalpine fir, spruce and pine only; juniper, yew hedges, heather, tussock grass
//   subtropical    fan palms down the streets; jacaranda in violet flower, ficus, curved coconut palms; bird of
//                  paradise, hibiscus, bougainvillea hedges, fountain grass
//   mediterranean  olive and cypress on the streets; umbrella (stone) pines; oleander, rosemary, myrtle, lavender
//   arid           palo verde, joshua trees, saguaro; yucca, barrel cactus, sage; bunchgrass (and bare gravel)
//
// Every PlantKind keel/architecture places (street, tree, palm, conifer, bush, hedge, flowers, grass) resolves to a
// species of the city's climate (TREE_FLORA): a "palm" asked for in a boreal city is a spruce, a "conifer" in a
// subtropical one a palm. Placement never needs to know.
//
// Each species is built from solids (keel/bake's boxes and capsules): crowns in CLUMPS, each one tone that melts into
// one lumpy mass (lower clumps deep and teal, top clumps lit) with sprigs breaking its outline -- the bake outlines only
// the crown's silhouette (cityflora's wide depth gap), so it reads as painted masses, not a pile of balls; trunks that
// fork into limbs, and every clump grows from wood (nothing floats: test/trees.test.ts); silhouettes that differ at a
// glance (a columnar cypress, a spreading oak, a weeping birch, a palm's drooping, feathered fronds on a ringed, curved
// trunk, a spruce's tiered skirts). Surface marks ride each part's own coordinate: furrowed bark, knots, a birch's
// lenticels, a palm's rings, leaf speckle. Each is baked once into an indexed sprite and painted through its climate's
// palette -- through the year (autumn colour, blossom seasons, bare broadleaf in a temperate winter) and under snow --
// in two lights: the night, and under a street lamp.

import { dcos, dhypot, dsin, hash2 } from "@keel-engine/core";
import type { BakeBox, BakeCapsule, BakeWorld, LayerPaint, SlotPaint } from "@keel-engine/bake";
import type { RoleLook } from "@keel-engine/core";
import type { PlantKind } from "@keel-engine/architecture";

/** A city's climate (keel/city's Climate: the same five, kept here so this pack needn't depend on keel/city). */
export type TreeClimate = "temperate" | "boreal" | "subtropical" | "mediterranean" | "arid";
export const TREE_CLIMATES: readonly TreeClimate[] = ["temperate", "boreal", "subtropical", "mediterranean", "arid"];

/** The slots a tree is painted through (its climate's paint says what each wears). */
export const TREE_SLOT = {
  trunk: 0, bark: 1, leafDeep: 2, leafMid: 3, leafLight: 4, blossom: 5, frond: 6, frondLight: 7, needle: 8, needleLight: 9,
  grate: 10, soil: 11, hedge: 12, flowerA: 13, flowerB: 14, grass: 15, blossomPale: 16, petal: 17,
  trunkPale: 18, thatch: 19, cactus: 20, cactusLight: 21, spine: 22, gravel: 23, leafSilver: 24, needleDeep: 25, blossomDeep: 26, straw: 27, ringed: 28,
} as const;
type Slot = keyof typeof TREE_SLOT;
type V3 = readonly [number, number, number];

export interface TreeDesign {
  /** Stable: species and variant. */
  readonly key: string;
  readonly species: string;
  readonly height: number;
  /** How far its widest part reaches from its foot (m). */
  readonly radius: number;
  readonly world: BakeWorld;
}

/** A design under construction: its solids, in metres, its foot at the origin. */
class Kit {
  boxes: BakeBox[] = []; capsules: BakeCapsule[] = [];
  /** Winter: the leaves are down -- a clump is its twigs, sprays and petals aren't there. */
  bare = false;
  box(x: number, y: number, z: number, w: number, h: number, d: number, slot: Slot, yaw = 0): void { this.boxes.push({ c: [x, y, z], h: [w, h, d], yaw, mat: TREE_SLOT[slot] }); }
  ball(x: number, y: number, z: number, r: number, slot: Slot): void { this.capsules.push({ a: [x, y, z], b: [x, y + 0.01, z], r, mat: TREE_SLOT[slot] }); }
  limb(a: V3, b: V3, r: number, slot: Slot): void { this.capsules.push({ a, b, r, mat: TREE_SLOT[slot] }); }
  /** A limb tapering from `ra` to `rb` over `n` pieces. */
  taper(a: V3, b: V3, ra: number, rb: number, slot: Slot, n = 2): void {
    for (let k = 0; k < n; k += 1) {
      const t0 = k / n, t1 = (k + 1) / n;
      this.limb(lerp3(a, b, t0), lerp3(a, b, t1), ra + (rb - ra) * (t0 + t1) / 2, slot);
    }
  }
  /** Its extent: the height of its top and the reach of its widest part from the foot. */
  extent(): { height: number; radius: number } {
    let height = 0, radius = 0;
    for (const c of this.capsules) for (const p of [c.a, c.b]) { height = Math.max(height, p[1]! + c.r); radius = Math.max(radius, dhypot(p[0]!, p[2]!) + c.r); }
    for (const b of this.boxes) { height = Math.max(height, b.c[1]! + b.h[1]!); radius = Math.max(radius, dhypot(b.c[0]!, b.c[2]!) + dhypot(b.h[0]!, b.h[2]!)); }
    return { height, radius };
  }
  world(): BakeWorld { return { boxes: this.boxes, capsules: this.capsules }; }
  /**
   * The nearest point on the wood so far (trunks, limbs, stems) to p, and how far it is -- or the ground under p when
   * there's no wood yet (a shrub grows from the ground).
   */
  nearestWood(p: V3): { at: V3; d: number } {
    // (`d`: the gap from p to that wood's surface.)
    let best: { at: V3; d: number } = { at: [p[0], 0, p[2]], d: p[1] };
    for (const c of this.capsules) {
      if (!WOOD.has(c.mat ?? -1)) continue;
      const a = c.a, b = c.b, ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], l2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]!) * ab[0]! + (p[1] - a[1]!) * ab[1]! + (p[2] - a[2]!) * ab[2]!) / l2));
      const q: V3 = [a[0]! + ab[0]! * t, a[1]! + ab[1]! * t, a[2]! + ab[2]! * t], d = dhypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - c.r;
      if (d < best.d) best = { at: q, d };
    }
    return best;
  }
}

const lerp3 = (a: V3, b: V3, t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const TAU = Math.PI * 2;
/** The slots that are wood (what a clump must grow from). */
const WOOD: ReadonlySet<number> = new Set([TREE_SLOT.trunk, TREE_SLOT.bark, TREE_SLOT.trunkPale, TREE_SLOT.ringed, TREE_SLOT.thatch, TREE_SLOT.cactus]);

/** A leaf palette: the slots a clump shades through, deep to light. */
interface Tones { readonly deep: Slot; readonly mid: Slot; readonly light: Slot }
const LEAF: Tones = { deep: "leafDeep", mid: "leafMid", light: "leafLight" };
const NEEDLE: Tones = { deep: "needleDeep", mid: "needle", light: "needleLight" };
const SILVER: Tones = { deep: "leafDeep", mid: "leafMid", light: "leafSilver" };
const BLOOM: Tones = { deep: "blossomDeep", mid: "blossom", light: "blossomPale" };
const tone = (t: Tones, v: number): Slot => (v > 0.35 ? t.light : v < -0.3 ? t.deep : t.mid);

/** A seeded 0..1 draw for a design: its species' own stream, its variant, which draw. */
type Draw = (k: number) => number;
const drawFor = (species: string, v: number): Draw => {
  let h = 0x811c9dc5;
  for (let i = 0; i < species.length; i += 1) h = Math.imul(h ^ species.charCodeAt(i), 0x01000193) >>> 0;
  return (k) => hash2(h & 0xffff, v * 977 + k, 0x7ee5);
};

/**
 * A clump of leaves round (cx, cy, cz), `s` across, massed the way a pixel artist paints foliage: one tone for the
 * whole clump (its place in the crown decides which -- `lift` -1 deep, a skirt in shadow, .. 1 light, the crown's
 * top), its balls the SAME slot so they melt into one lumpy mass that the light shades as a whole (lit over the top,
 * falling off underneath), and small sprigs past its edge so the outline breaks into leafy lobes instead of rounding
 * off. The outline only rings the crown's silhouette (cityflora bakes with a wide depth gap), so what reads inside is
 * the clumps' painted masses against each other, not a pile of balls. `flat` squashes it (a pine's pad, an umbrella).
 */
function clump(K: Kit, r: Draw, k0: number, cx: number, cy: number, cz: number, s: number, n: number, t: Tones = LEAF, lift = 0, flat = 1): void {
  // (Every clump grows on the tree: a branch from the nearest wood into its heart when it doesn't already sit on one --
  // hidden in the leaves, a bare winter tree's limb -- so nothing floats, whatever a variant's lean did to the crown.)
  const root: V3 = [cx, cy - s * 0.2 * flat, cz], wood = K.nearestWood(root);
  if (wood.d > 0.02) K.limb(wood.at, root, Math.min(0.09, 0.04 + s * 0.04), "bark");
  if (K.bare) { twigs(K, r, k0, cx, cy, cz, s, n, flat); return; }
  const slot = tone(t, lift);
  K.ball(cx, cy - s * 0.1 * flat, cz, s * 0.62, slot);
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU + r(k0 + i) * 0.9, el = r(k0 + 20 + i) * 0.9 - 0.25, d = s * (0.42 + 0.25 * r(k0 + 40 + i));
    const bx = cx + dcos(a) * d, by = cy + el * s * 0.8 * flat, bz = cz + dsin(a) * d, br = s * (0.38 + 0.14 * r(k0 + 60 + i));
    K.ball(bx, by, bz, br, slot);
    // (A sprig on its outer face, mostly up and out -- a ragged, leafy outline -- sitting in the ball it grows from.)
    const sa = a + (r(k0 + 100 + i) - 0.5) * 1.2, se = 0.2 + r(k0 + 120 + i) * 0.6, ce = dcos(se);
    K.ball(bx + dcos(sa) * ce * br * 0.85, by + dsin(se) * br * 0.85 * flat, bz + dsin(sa) * ce * br * 0.85, s * (0.16 + 0.1 * r(k0 + 160 + i)), slot);
  }
}

/**
 * A bare clump (winter): the twigs that held its leaves -- a fork from below its middle out to where its lobes were,
 * each splitting once near its end -- so a bare crown keeps the tree's silhouette as a fine tangle.
 */
function twigs(K: Kit, r: Draw, k0: number, cx: number, cy: number, cz: number, s: number, n: number, flat: number): void {
  const root: V3 = [cx, cy - s * 0.2 * flat, cz];
  for (let i = 0; i < n + 1; i += 1) {
    const a = (i / (n + 1)) * TAU + r(k0 + i) * 0.9, el = r(k0 + 20 + i) * 0.9 - 0.1, d = s * (0.6 + 0.3 * r(k0 + 40 + i));
    const tip: V3 = [cx + dcos(a) * d, cy + el * s * 0.8 * flat, cz + dsin(a) * d], mid = lerp3(root, tip, 0.55);
    K.limb(root, mid, 0.045, "bark"); K.limb(mid, tip, 0.028, "bark");
    K.limb(mid, [mid[0] + dcos(a + 0.9) * s * 0.3, mid[1] + s * 0.35 * flat, mid[2] + dsin(a + 0.9) * s * 0.3], 0.022, "bark");
  }
}

/** A clump in flower: a clump in the bloom's tones (deep, blossom, pale by `lift`) -- or, `share` of the time not, in leaf. */
function bloomClump(K: Kit, r: Draw, k0: number, cx: number, cy: number, cz: number, s: number, n: number, share: number, lift = 0, flat = 1): void {
  clump(K, r, k0, cx, cy, cz, s, n, r(k0 + 250) < share ? BLOOM : LEAF, lift, flat);
}

/** A trunk from the foot to `top` (leaning), tapering, in `n` pieces. */
function trunk(K: Kit, top: V3, r0: number, r1: number, slot: Slot = "trunk", n = 3): void {
  // (A gentle curve: the lean comes in late, as a trunk bends to the light.)
  let prev: V3 = [0, 0, 0];
  for (let k = 1; k <= n; k += 1) {
    const t = k / n, p: V3 = [top[0] * t * t, top[1] * t, top[2] * t * t];
    K.limb(prev, p, r0 + (r1 - r0) * (t - 0.5 / n), slot);
    prev = p;
  }
}

/** Fallen petals round the foot: flat flecks on the ground. */
function petals(K: Kit, r: Draw, s: number, n: number, slot: Slot = "petal"): void {
  if (K.bare) return;
  for (let k = 0; k < n; k += 1) {
    const a = r(300 + k) * TAU, d = s * (0.3 + 0.9 * r(320 + k));
    K.box(dcos(a) * d, 0.012, dsin(a) * d, 0.14, 0.012, 0.1, slot, a);
  }
}

/** A street tree's iron grate and its soil. */
function grate(K: Kit): void { K.box(0, 0.03, 0, 0.75, 0.03, 0.75, "grate"); K.box(0, 0.04, 0, 0.5, 0.03, 0.5, "soil"); }

/** A conifer's tiered skirts: rings of boughs sloping down and out round a core, narrowing to a leader. */
function skirts(K: Kit, r: Draw, h: number, base: number, from: number, tiers: number, boughs: number, droop = 0.35): void {
  for (let t = 0; t < tiers; t += 1) {
    const f = t / tiers, y = from + f * (h - from - 1) + (r(10 + t) - 0.5) * 0.2;
    const reach = base * (1 - f * 0.88) * (0.85 + 0.3 * r(20 + t)), thick = 0.2 * (1 - f * 0.4);
    const lift = 0.5 - f * 0.1 - (t === 0 ? 0.6 : 0);
    K.limb([0, y - 0.15, 0], [0, y + (h - from) / tiers + 0.1, 0], Math.max(0.12, reach * 0.42), "needleDeep");
    // (Boughs a little flat and many: out from the core, dipping at the tip -- a fringed, drooping skirt, not spokes.)
    const nb = boughs + 1;
    for (let k = 0; k < nb; k += 1) {
      const a = (k / nb) * TAU + t * 1.1 + r(30 + t * 9 + k) * 0.5, d = reach * (0.8 + 0.3 * r(90 + t * 9 + k));
      const tip: V3 = [dcos(a) * d, y - droop * d * 0.7, dsin(a) * d];
      K.limb([0, y + 0.25, 0], tip, thick, tone(NEEDLE, (dsin(a) > 0.3 ? 0.4 : -0.1) + lift - 0.3));
    }
  }
  K.limb([0, h - 1, 0], [0, h, 0], 0.1, "needleLight");
}

type Build = (K: Kit, r: Draw, v: number) => void;
interface Species { readonly build: Build; readonly variants?: number; /** Drops its leaves in winter (a bare design). */ readonly deciduous?: boolean }

/** Every species, by name. */
const SPECIES: Readonly<Record<string, Species>> = {
  // ---------------------------------------------------------------- temperate
  // A linden in its grate: a straight stem and a dense, upright oval crown of clumps.
  linden: { deciduous: true, build: (K, r) => {
    const h = 2.3 + 0.5 * r(1);
    grate(K);
    trunk(K, [0.1 * (r(2) - 0.5), h, 0], 0.14, 0.1, "trunk", 2);
    for (let k = 0; k < 4; k += 1) {
      const a = (k / 4) * TAU + r(3) * 2, y = h + 0.9 + (k % 2) * 0.6;
      clump(K, r, 10 + k * 100, dcos(a) * 0.55, y, dsin(a) * 0.55, 0.72, 4, LEAF, -0.25 + (k % 2) * 0.2);
    }
    clump(K, r, 500, 0, h + 2.2, 0, 0.7, 4, LEAF, 0.4);
  } },
  // A birch: one or two pale stems flecked dark, a light, narrow crown with trailing sprays.
  birch: { deciduous: true, build: (K, r, v) => {
    const h = 4.6 + 1 * r(1), stems = v === 1 ? 2 : 1;
    for (let s = 0; s < stems; s += 1) {
      const lx = (s ? -0.35 : 0.25) * (stems - 1) + (r(2 + s) - 0.5) * 0.4, top: V3 = [lx, h - s * 0.6, (r(4 + s) - 0.5) * 0.3];
      trunk(K, top, 0.1, 0.06, "trunkPale", 3);
      for (let k = 0; k < 4; k += 1) { const t = 0.2 + 0.18 * k; K.box(top[0] * t * t, top[1] * t, top[2] * t * t + 0.05, 0.06, 0.03, 0.05, "bark"); }
      for (let k = 0; k < 4; k += 1) {
        const t = 0.5 + k * 0.14, a = r(20 + k + s * 7) * TAU, c: V3 = [top[0] * t * t, top[1] * t, top[2] * t * t];
        const out: V3 = [c[0] + dcos(a) * 0.8, c[1] + 0.3, c[2] + dsin(a) * 0.8];
        K.limb(c, out, 0.03, "bark");
        clump(K, r, 100 + k * 60 + s * 400, out[0], out[1], out[2], 0.5, 3, LEAF, -0.2 + k * 0.2);
        // (A trailing spray: the birch's weep.)
        if (!K.bare) K.limb(out, [out[0] + dcos(a) * 0.35, out[1] - 0.9, out[2] + dsin(a) * 0.35], 0.1, "leafMid");
      }
      clump(K, r, 700 + s * 50, top[0], top[1] + 0.3, top[2], 0.45, 3, LEAF, 0.5);
    }
  } },
  // A maple: a trunk forking into three limbs, a rounded crown of clumps at their ends.
  maple: { deciduous: true, build: (K, r) => {
    const h = 2 + 0.6 * r(1), lean = (r(2) - 0.5) * 0.5;
    trunk(K, [lean, h, 0], 0.22, 0.17);
    for (let k = 0; k < 3; k += 1) {
      const a = (k / 3) * TAU + r(3) * 2, d = 1 + 0.3 * r(4 + k), end: V3 = [lean + dcos(a) * d, h + 1.3 + 0.4 * r(7 + k), dsin(a) * d];
      K.taper([lean, h - 0.1, 0], end, 0.13, 0.07, "bark", 1);
      clump(K, r, 10 + k * 90, end[0], end[1] + 0.2, end[2], 1.05, 5, LEAF, -0.15);
    }
    clump(K, r, 400, lean, h + 2.6, 0, 1, 5, LEAF, 0.45);
    clump(K, r, 500, lean + 0.2, h + 0.8, 0.3, 0.8, 3, LEAF, -0.7);
  } },
  // An oak: a short thick trunk, heavy limbs reaching out nearly level, a broad crown wider than it is tall.
  oak: { deciduous: true, build: (K, r) => {
    const h = 1.7 + 0.5 * r(1);
    trunk(K, [0.1, h, 0], 0.32, 0.26, "trunk", 2);
    const limbs = 4;
    for (let k = 0; k < limbs; k += 1) {
      const a = (k / limbs) * TAU + r(3) * 2 + r(4 + k) * 0.6, d = 1.9 + 0.5 * r(8 + k);
      const mid: V3 = [dcos(a) * d * 0.5, h + 0.7, dsin(a) * d * 0.5], end: V3 = [dcos(a) * d, h + 1.2 + 0.5 * r(12 + k), dsin(a) * d];
      K.limb([0.1, h - 0.1, 0], mid, 0.15, "bark"); K.limb(mid, end, 0.09, "bark");
      clump(K, r, 20 + k * 80, end[0], end[1] + 0.3, end[2], 1.1, 5, LEAF, -0.2, 0.8);
    }
    clump(K, r, 500, 0, h + 2.4, 0, 1.25, 5, LEAF, 0.5, 0.8);
    clump(K, r, 600, 0.5, h + 1.3, -0.4, 1, 3, LEAF, -0.6, 0.8);
  } },
  // A cherry in flower: a dark trunk forking into bare-looking limbs, a crown nearly all blossom, petals round its foot.
  cherry: { deciduous: true, build: (K, r) => {
    const h = 1.7 + 0.4 * r(1);
    trunk(K, [0, h, 0], 0.16, 0.13, "bark", 2);
    for (let k = 0; k < 4; k += 1) {
      const a = (k / 4) * TAU + r(3 + k) * 0.8, d = 1.1 + 0.3 * r(8 + k), end: V3 = [dcos(a) * d, h + 1 + 0.4 * r(12 + k), dsin(a) * d];
      K.limb([0, h * 0.9, 0], end, 0.07, "bark");
      bloomClump(K, r, 20 + k * 80, end[0], end[1] + 0.2, end[2], 0.85, 4, 0.8, -0.1);
    }
    bloomClump(K, r, 500, 0, h + 2, 0, 0.85, 4, 0.9, 0.4);
    petals(K, r, 1.6, 8);
  } },
  // A scots pine: a tall bare trunk with a lean, stub branches, flat needle pads at the top.
  pine: { build: (K, r) => {
    const h = 5.2 + 1.3 * r(1), lean = (r(2) - 0.5) * 1;
    trunk(K, [lean, h, 0], 0.2, 0.12, "trunk", 3);
    for (let k = 0; k < 2; k += 1) { const y = h * (0.35 + 0.15 * k), a = r(5 + k) * TAU; K.limb([lean * (y / h) ** 2, y, 0], [lean * (y / h) ** 2 + dcos(a) * 0.5, y + 0.1, dsin(a) * 0.5], 0.04, "bark"); }
    const pads = 4;
    for (let k = 0; k < pads; k += 1) {
      const a = (k / pads) * TAU + r(10 + k), d = 0.6 + 0.6 * r(14 + k), y = h - 1.4 + k * 0.45 + 0.3 * r(18 + k);
      const c: V3 = [lean + dcos(a) * d, y, dsin(a) * d];
      K.limb([lean * (y / h) ** 2, y - 0.3, 0], c, 0.06, "bark");
      clump(K, r, 30 + k * 70, c[0], c[1], c[2], 0.8, 4, NEEDLE, -0.2 + k * 0.25, 0.55);
    }
    clump(K, r, 600, lean, h + 0.1, 0, 0.7, 3, NEEDLE, 0.4, 0.6);
  } },
  // A spruce: a dense spire of tiered, drooping skirts, the lowest nearly to the ground.
  spruce: { build: (K, r) => {
    const h = 5.8 + 1.6 * r(1), base = 1.7 + 0.35 * r(2);
    K.limb([0, 0, 0], [0, 0.7, 0], 0.13, "trunk");
    skirts(K, r, h, base, 0.6, 6, 6);
  } },
  // A round shrub: clumps, deep at the foot.
  shrub: { variants: 2, build: (K, r) => {
    const s = 0.5 + 0.2 * r(1);
    clump(K, r, 10, 0, s * 0.9, 0, s, 4, LEAF, -0.1);
    clump(K, r, 100, s * 0.8, s * 0.65, 0.1, s * 0.7, 3, LEAF, -0.4);
  } },
  // A clipped box hedge: a block of leaves with a tufted top.
  hedge: { variants: 2, build: (K, r) => {
    const w = 1.2 + 0.5 * r(1);
    K.box(0, 0.42, 0, w, 0.42, 0.42, "hedge");
    for (let k = -2; k <= 2; k += 1) K.ball(k * w * 0.38, 0.84, 0, 0.3, k % 2 ? "leafMid" : "leafLight");
  } },
  // A tulip bed: rows of blooms on stems over dark soil.
  bed: { variants: 2, build: (K, r) => {
    K.box(0, 0.05, 0, 0.75, 0.05, 0.45, "soil");
    for (let k = 0; k < 8; k += 1) {
      const x = (k % 4 - 1.5) * 0.36 + (r(k) - 0.5) * 0.1, z = (k < 4 ? -0.18 : 0.18);
      K.limb([x, 0.08, z], [x, 0.3, z], 0.03, "leafMid"); K.ball(x, 0.34, z, 0.08, k % 3 ? "flowerA" : "flowerB");
    }
  } },
  // A tuft of grass: leaning blades.
  tuft: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 6; k += 1) K.limb([(k - 2.5) * 0.06, 0, 0], [(k - 2.5) * 0.14 + (r(k) - 0.5) * 0.2, 0.35 + 0.22 * r(k + 6), (r(k + 12) - 0.5) * 0.2], 0.035, k % 2 ? "grass" : "leafMid");
  } },

  // ---------------------------------------------------------------- boreal
  // A subalpine fir: a very narrow spire, dense to the ground.
  fir: { build: (K, r) => {
    const h = 5.5 + 1.8 * r(1), base = 0.95 + 0.25 * r(2);
    K.limb([0, 0, 0], [0, 0.5, 0], 0.1, "trunk");
    skirts(K, r, h, base, 0.4, 8, 4, 0.5);
  } },
  // A juniper: a low, spreading mound of needles.
  juniper: { variants: 2, build: (K, r) => {
    const s = 0.5 + 0.15 * r(1);
    for (let k = 0; k < 3; k += 1) clump(K, r, k * 70, (k - 1) * s * 0.9, s * 0.55, (r(40 + k) - 0.5) * 0.4, s * (k === 1 ? 1 : 0.75), 3, NEEDLE, k === 1 ? 0.1 : -0.3, 0.7);
  } },
  // A yew hedge: dark needles, clipped.
  yew: { variants: 2, build: (K, r) => {
    const w = 1.2 + 0.5 * r(1);
    K.box(0, 0.45, 0, w, 0.45, 0.42, "needleDeep");
    for (let k = -2; k <= 2; k += 1) K.ball(k * w * 0.38, 0.88, 0, 0.28, k % 2 ? "needle" : "needleLight");
  } },
  // Heather: low mauve-flowered mounds.
  heather: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 5; k += 1) { const x = (r(k) - 0.5) * 1.2, z = (r(k + 9) - 0.5) * 0.7; K.ball(x, 0.12, z, 0.18, "needleDeep"); K.ball(x, 0.22, z, 0.13, k % 2 ? "blossom" : "blossomPale"); }
  } },
  // Tussock: a tawny clump of grass.
  tussock: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 7; k += 1) { const a = (k / 7) * TAU; K.limb([0, 0, 0], [dcos(a) * 0.25 + (r(k) - 0.5) * 0.1, 0.4 + 0.2 * r(k + 7), dsin(a) * 0.2], 0.04, k % 2 ? "straw" : "grass"); }
  } },

  // ---------------------------------------------------------------- subtropical
  // A fan palm (washingtonia): a very tall, slim trunk, a skirt of dead thatch, a tight head of fans.
  fanpalm: { build: (K, r) => {
    const h = 9 + 2.5 * r(1), lean = (r(2) - 0.5) * 0.7, top: V3 = [lean, h, 0];
    trunk(K, top, 0.2, 0.15, "ringed", 4);
    K.limb([lean * 0.85, h - 2, 0], [lean, h - 0.3, 0], 0.42, "thatch");
    K.ball(lean, h - 2.1, 0, 0.3, "thatch");
    // (The head: stiff fans on short stalks, each a spray of spiky leaf ends -- a round, bristling head, not a ball.)
    const n = 10;
    K.ball(lean, h + 0.1, 0, 0.42, "frond");
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * TAU + r(10 + k) * 0.4, up = k % 3 === 0 ? 0.6 : 0.15 - 0.4 * r(20 + k), d = 0.75 + 0.2 * r(30 + k);
      const base: V3 = [lean + dcos(a) * d, h + up, dsin(a) * d], lit: Slot = up > 0.3 ? "frondLight" : up < -0.1 ? "leafDeep" : "frond";
      K.limb([lean, h, 0], base, 0.05, "frond");
      for (let j = -1; j <= 1; j += 1) {
        const b = a + j * 0.45;
        K.limb(base, [base[0] + dcos(b) * 0.55, base[1] + 0.12 - Math.abs(j) * 0.15 - (up < 0 ? 0.2 : 0), base[2] + dsin(b) * 0.55], 0.075, lit);
      }
    }
  } },
  // A coconut (or queen) palm: a curved, ringed trunk, a full head of arching fronds drooping at their tips.
  palm: { build: (K, r) => {
    const h = 6 + 2 * r(1), lean = 0.6 + 1 * r(2), rings = 6;
    let prev: V3 = [0, 0, 0];
    for (let k = 1; k <= rings; k += 1) {
      const t = k / rings, p: V3 = [lean * t * t, h * t, 0];
      K.limb(prev, p, 0.2 - 0.05 * t, "ringed");
      if (k % 2 === 0) K.ball(p[0], p[1] - 0.05, p[2], 0.23 - 0.05 * t, "bark");
      prev = p;
    }
    const top = prev, n = 9;
    K.ball(top[0], top[1] + 0.05, top[2], 0.5, "frond");
    for (let k = 0; k < 3; k += 1) K.ball(top[0] + (k - 1) * 0.2, top[1] - 0.35, top[2] + 0.2, 0.14, "bark");
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * TAU + r(10 + k) * 0.4, len = 2.4 + 0.8 * r(20 + k), up = k % 3 === 0 ? 0.55 : 0.2;
      const dx = dcos(a), dz = dsin(a);
      const p1: V3 = [top[0] + dx * len * 0.4, top[1] + up + 0.3, top[2] + dz * len * 0.4];
      const p2: V3 = [top[0] + dx * len * 0.75, top[1] + up - 0.2, top[2] + dz * len * 0.75];
      const p3: V3 = [top[0] + dx * len, top[1] - 0.9 - 0.4 * r(30 + k), top[2] + dz * len];
      const lit: Slot = up > 0.3 ? "frondLight" : "frond";
      K.limb(top, p1, 0.11, lit); K.limb(p1, p2, 0.09, lit); K.limb(p2, p3, 0.06, "frond");
      // (Leaflets hang off each side of the midrib, longest mid-frond: a feathered, drooping blade, not a stick.)
      for (const [q, w, drop] of [[p1, 0.7, 0.6], [p2, 0.55, 0.55]] as const) {
        for (const side of [-1, 1]) K.limb(q, [q[0] - dz * side * w + dx * 0.3, q[1] - drop, q[2] + dx * side * w + dz * 0.3], 0.07, side > 0 ? lit : "frond");
      }
    }
  } },
  // A jacaranda in flower: a vase of limbs holding a wide, flat-topped umbrella of violet bloom; petals below.
  jacaranda: { build: (K, r) => {
    const h = 2 + 0.5 * r(1);
    trunk(K, [0, h, 0], 0.18, 0.14, "trunk", 2);
    for (let k = 0; k < 4; k += 1) {
      const a = (k / 4) * TAU + r(3) * 2, d = 1.5 + 0.5 * r(6 + k), end: V3 = [dcos(a) * d, h + 1.6 + 0.3 * r(10 + k), dsin(a) * d];
      K.limb([0, h - 0.1, 0], end, 0.08, "bark");
      bloomClump(K, r, 20 + k * 80, end[0], end[1] + 0.2, end[2], 0.95, 4, 0.75, 0, 0.7);
    }
    bloomClump(K, r, 500, 0, h + 2.1, 0, 1, 4, 0.85, 0.4, 0.7);
    petals(K, r, 2, 9);
  } },
  // A ficus: several stems, a dense, glossy, dark dome.
  ficus: { build: (K, r) => {
    const h = 1.8 + 0.4 * r(1);
    for (let k = 0; k < 3; k += 1) { const a = (k / 3) * TAU + r(2); K.limb([dcos(a) * 0.3, 0, dsin(a) * 0.3], [dcos(a) * 0.5, h + 0.4, dsin(a) * 0.5], 0.13, k ? "bark" : "trunk"); }
    for (let k = 0; k < 5; k += 1) {
      const a = (k / 5) * TAU + r(10 + k) * 0.5, d = 1.6 + 0.4 * r(15 + k);
      clump(K, r, 30 + k * 60, dcos(a) * d, h + 1 + 0.4 * r(20 + k), dsin(a) * d, 1, 4, LEAF, -0.35, 0.85);
    }
    clump(K, r, 500, 0, h + 2.3, 0, 1.3, 5, LEAF, 0.35, 0.8);
  } },
  // Bird of paradise: a fan of paddle leaves on stems, orange flowers among them.
  paradise: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 7; k += 1) {
      const a = (k / 7) * TAU + r(k) * 0.5, lean = 0.25 + 0.2 * r(k + 10), top: V3 = [dcos(a) * lean, 0.8 + 0.4 * r(k + 20), dsin(a) * lean];
      K.limb([0, 0, 0], top, 0.03, "leafDeep");
      K.limb(top, [top[0] * 1.6, top[1] + 0.5, top[2] * 1.6], 0.13, k % 2 ? "leafMid" : "leafLight");
    }
    for (let k = 0; k < 2; k += 1) K.limb([0.1 * k, 0.9, 0.15], [0.35 - 0.6 * k, 1.05, 0.2], 0.06, "flowerB");
  } },
  // Hibiscus: a glossy round bush dotted with big red flowers.
  hibiscus: { variants: 2, build: (K, r) => {
    const s = 0.6 + 0.15 * r(1);
    clump(K, r, 10, 0, s, 0, s, 5, LEAF, -0.1);
    for (let k = 0; k < 5; k += 1) { const a = r(40 + k) * TAU; K.ball(dcos(a) * s * 0.75, s * (0.8 + 0.6 * r(50 + k)), dsin(a) * s * 0.75, 0.13, "flowerA"); }
  } },
  // A bougainvillea hedge: a clipped block, cascades of magenta over it.
  bougainvillea: { variants: 2, build: (K, r) => {
    const w = 1.2 + 0.5 * r(1);
    K.box(0, 0.45, 0, w, 0.45, 0.42, "hedge");
    for (let k = -2; k <= 2; k += 1) { K.ball(k * w * 0.38, 0.86, 0, 0.3, k % 2 ? "flowerA" : "blossomDeep"); K.ball(k * w * 0.38 + 0.2, 0.55, 0.3, 0.2, "flowerA"); }
  } },
  // A tropical bed: broad low leaves and hot flowers.
  tropicalbed: { variants: 2, build: (K, r) => {
    K.box(0, 0.05, 0, 0.75, 0.05, 0.45, "soil");
    for (let k = 0; k < 6; k += 1) { const x = (r(k) - 0.5) * 1.2, z = (r(k + 9) - 0.5) * 0.6; K.ball(x, 0.2, z, 0.17, k % 2 ? "leafLight" : "leafMid"); if (k % 2) K.ball(x + 0.1, 0.36, z, 0.08, k % 4 === 1 ? "flowerA" : "flowerB"); }
  } },
  // Fountain grass: arching blades with pale plumes.
  fountain: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 7; k += 1) {
      const a = (k / 7) * TAU + r(k), mid: V3 = [dcos(a) * 0.2, 0.5, dsin(a) * 0.15], tip: V3 = [dcos(a) * 0.45, 0.35 + 0.15 * r(k + 7), dsin(a) * 0.3];
      K.limb([0, 0, 0], mid, 0.035, "grass"); K.limb(mid, tip, 0.05, k % 2 ? "straw" : "grass");
    }
  } },

  // ---------------------------------------------------------------- mediterranean
  // An olive: a short, gnarled, twisting trunk, a low, wide crown of silvery clumps.
  olive: { build: (K, r) => {
    const h = 1.3 + 0.4 * r(1), tw = (r(2) - 0.5) * 0.6;
    K.limb([0, 0, 0], [tw, h * 0.5, 0.1], 0.2, "trunk"); K.limb([tw, h * 0.5, 0.1], [-tw * 0.5, h, 0], 0.17, "trunk");
    for (let k = 0; k < 3; k += 1) {
      const a = (k / 3) * TAU + r(3) * 2, d = 1 + 0.3 * r(5 + k), end: V3 = [dcos(a) * d, h + 0.9 + 0.3 * r(8 + k), dsin(a) * d];
      K.limb([-tw * 0.5, h - 0.1, 0], end, 0.08, "trunk");
      clump(K, r, 20 + k * 80, end[0], end[1], end[2], 0.85, 4, SILVER, -0.1, 0.8);
    }
    clump(K, r, 500, 0, h + 1.6, 0, 0.8, 4, SILVER, 0.5, 0.8);
  } },
  // An italian cypress: a tall, narrow, flame-shaped column.
  cypress: { build: (K, r) => {
    const h = 7 + 2 * r(1), w = 0.55 + 0.12 * r(2), sway = (r(3) - 0.5) * 0.3;
    K.limb([0, 0, 0], [0, 0.4, 0], 0.12, "trunk");
    K.limb([0, 0.7, 0], [sway * 0.5, h * 0.55, 0], w, "needle");
    K.limb([sway * 0.5, h * 0.55, 0], [sway, h - 0.9, 0], w * 0.7, "needle");
    K.limb([sway, h - 0.9, 0], [sway * 1.2, h - 0.2, 0], w * 0.3, "needleLight");
    // (Tufts down its sides: its outline ruffles, the lit side lighter, the foot deeper.)
    for (let k = 0; k < 9; k += 1) {
      const t = 0.12 + (k / 9) * 0.72, y = h * t, a = r(20 + k) * TAU, ww = w * (1 - t * 0.55) * 0.95, sx = sway * t;
      K.ball(sx + dcos(a) * ww, y, dsin(a) * ww, w * (0.45 - t * 0.2), t < 0.3 ? "needleDeep" : dcos(a) > 0 ? "needleLight" : "needle");
    }
  } },
  // An umbrella (stone) pine: a tall bare trunk forking high into limbs under a broad, flat canopy.
  stonepine: { build: (K, r) => {
    const h = 4.2 + 1.2 * r(1), lean = (r(2) - 0.5) * 1.2;
    trunk(K, [lean, h, 0], 0.22, 0.16, "trunk", 3);
    const n = 4;
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * TAU + r(3) * 2, d = 1.5 + 0.6 * r(5 + k), end: V3 = [lean + dcos(a) * d, h + 1 + 0.3 * r(9 + k), dsin(a) * d];
      K.limb([lean, h - 0.2, 0], end, 0.09, "trunk");
      clump(K, r, 20 + k * 80, end[0], end[1], end[2], 1.1, 4, NEEDLE, -0.1, 0.45);
    }
    clump(K, r, 500, lean, h + 1.35, 0, 1.3, 5, NEEDLE, 0.45, 0.4);
  } },
  // Oleander: an upright bush with pink flower clusters.
  oleander: { variants: 2, build: (K, r) => {
    const s = 0.55 + 0.12 * r(1);
    clump(K, r, 10, 0, s * 1.2, 0, s, 4, LEAF, 0, 1.2);
    clump(K, r, 100, s * 0.6, s * 0.7, 0.2, s * 0.7, 3, LEAF, -0.4);
    for (let k = 0; k < 5; k += 1) { const a = r(40 + k) * TAU; K.ball(dcos(a) * s * 0.7, s * (1.1 + 0.6 * r(50 + k)), dsin(a) * s * 0.6, 0.14, k % 2 ? "blossom" : "blossomPale"); }
  } },
  // Rosemary: a low, grey-green mound flecked with lilac.
  rosemary: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 4; k += 1) { const x = (k - 1.5) * 0.3, y = 0.3 + 0.1 * r(k); K.ball(x, y, (r(k + 5) - 0.5) * 0.3, 0.3, k % 2 ? "leafSilver" : "leafMid"); }
    for (let k = 0; k < 4; k += 1) K.ball((r(k + 10) - 0.5) * 1, 0.5, (r(k + 15) - 0.5) * 0.3, 0.06, "flowerA");
  } },
  // A myrtle hedge: dark, glossy, clipped.
  myrtle: { variants: 2, build: (K, r) => {
    const w = 1.2 + 0.5 * r(1);
    K.box(0, 0.42, 0, w, 0.42, 0.4, "hedge");
    for (let k = -2; k <= 2; k += 1) K.ball(k * w * 0.38, 0.82, 0, 0.26, k % 2 ? "leafDeep" : "leafSilver");
  } },
  // Lavender: rows of purple mounds on pale soil.
  lavender: { variants: 2, build: (K, r) => {
    K.box(0, 0.04, 0, 0.75, 0.04, 0.45, "gravel");
    for (let k = 0; k < 6; k += 1) { const x = (k % 3 - 1) * 0.45 + (r(k) - 0.5) * 0.08, z = k < 3 ? -0.2 : 0.2; K.ball(x, 0.18, z, 0.2, "leafSilver"); K.ball(x, 0.34, z, 0.14, "flowerA"); }
  } },
  // Dry grass: a straw-coloured tuft.
  drygrass: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 6; k += 1) K.limb([(k - 2.5) * 0.06, 0, 0], [(k - 2.5) * 0.14 + (r(k) - 0.5) * 0.2, 0.3 + 0.2 * r(k + 6), (r(k + 12) - 0.5) * 0.2], 0.035, k % 3 ? "straw" : "grass");
  } },

  // ---------------------------------------------------------------- arid
  // A palo verde: green stems splaying from the foot, an airy, flat crown of tiny leaves, yellow flowers.
  paloverde: { build: (K, r) => {
    const h = 1.6 + 0.4 * r(1);
    for (let k = 0; k < 3; k += 1) {
      const a = (k / 3) * TAU + r(2) * 2, end: V3 = [dcos(a) * 1.2, h + 0.6 * r(4 + k), dsin(a) * 1.2];
      K.limb([0, 0, 0], [dcos(a) * 0.3, h * 0.5, dsin(a) * 0.3], 0.1, "cactus"); K.limb([dcos(a) * 0.3, h * 0.5, dsin(a) * 0.3], end, 0.07, "cactus");
      for (let j = 0; j < 3; j += 1) {
        const b = a + (j - 1) * 0.8, c: V3 = [end[0] + dcos(b) * 0.7, end[1] + 0.4 + 0.3 * r(10 + k * 3 + j), end[2] + dsin(b) * 0.7];
        K.limb(end, c, 0.035, "cactus");
        K.ball(c[0], c[1], c[2], 0.42, j === 1 ? "leafLight" : "leafMid");
        K.ball(c[0] + 0.2, c[1] + 0.25, c[2], 0.16, "blossom");
      }
    }
    K.limb([0, 0, 0], [0, h + 0.8, 0], 0.07, "cactus");
    K.ball(0, h + 1, 0, 0.5, "leafLight");
  } },
  // A joshua tree: a shaggy trunk forking into crooked arms, each ending in a spiky rosette.
  joshua: { build: (K, r) => {
    const h = 2 + 0.7 * r(1);
    K.limb([0, 0, 0], [0.1, h, 0], 0.26, "thatch");
    const arms = 3 + (r(2) < 0.5 ? 1 : 0);
    for (let k = 0; k < arms; k += 1) {
      const a = (k / arms) * TAU + r(3 + k) * 0.8, d = 0.8 + 0.5 * r(8 + k), mid: V3 = [dcos(a) * d * 0.6, h + 0.5, dsin(a) * d * 0.6], end: V3 = [dcos(a) * d, h + 1 + 0.6 * r(12 + k), dsin(a) * d];
      K.limb([0.1, h, 0], mid, 0.17, "thatch"); K.limb(mid, end, 0.14, "thatch");
      for (let j = 0; j < 5; j += 1) { const b = (j / 5) * TAU; K.limb(end, [end[0] + dcos(b) * 0.35, end[1] + 0.25 + (j % 2) * 0.15, end[2] + dsin(b) * 0.35], 0.07, j % 2 ? "leafMid" : "leafLight"); }
    }
  } },
  // A saguaro: a ribbed column, one or two arms bending up.
  saguaro: { build: (K, r, v) => {
    const h = 4 + 1.5 * r(1);
    K.limb([0, 0, 0], [0, h, 0], 0.34, "cactus");
    K.limb([0.12, 0.3, 0.2], [0.12, h - 0.1, 0.2], 0.13, "cactusLight");
    const arms = 1 + (v % 2);
    for (let k = 0; k < arms; k += 1) {
      const s = k ? -1 : 1, y = h * (0.4 + 0.15 * r(5 + k)), out = 0.8 + 0.2 * r(8 + k), up = y + 1 + 0.7 * r(10 + k);
      K.limb([0, y, 0], [s * out, y + 0.1, 0], 0.22, "cactus");
      K.limb([s * out, y + 0.1, 0], [s * out, up, 0], 0.23, "cactus");
      K.limb([s * out + 0.07, y + 0.3, 0.13], [s * out + 0.07, up - 0.05, 0.13], 0.08, "cactusLight");
    }
    K.ball(0, h + 0.2, 0, 0.12, "spine");
  } },
  // A yucca: a rosette of spiky leaves round a tall cream flower spike.
  yucca: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 10; k += 1) { const a = (k / 10) * TAU + r(k) * 0.3, up = 0.5 + 0.35 * r(k + 10); K.limb([0, 0.1, 0], [dcos(a) * 0.55, up, dsin(a) * 0.55], 0.05, k % 2 ? "leafMid" : "leafSilver"); }
    K.limb([0, 0.2, 0], [0, 1.3, 0], 0.03, "leafMid");
    for (let k = 0; k < 3; k += 1) K.ball(0.04 * (k - 1), 1.05 + k * 0.17, 0, 0.1, "spine");
  } },
  // Barrel cactus: two or three ribbed barrels, yellow flowers round their crowns, a rock.
  barrel: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 3; k += 1) {
      const x = (k - 1) * 0.42 + (r(k) - 0.5) * 0.1, s = 0.2 + 0.1 * r(k + 3);
      K.limb([x, s, 0], [x, s * 1.6, 0], s, "cactus"); K.limb([x + s * 0.4, s * 0.8, s * 0.55], [x + s * 0.4, s * 1.8, s * 0.55], s * 0.3, "cactusLight");
      K.ball(x, s * 2.6, 0, s * 0.35, "flowerB");
    }
    K.box(0.6, 0.1, -0.2, 0.2, 0.1, 0.15, "gravel", 0.4);
  } },
  // Sage: a grey mound.
  sage: { variants: 2, build: (K, r) => {
    const s = 0.45 + 0.15 * r(1);
    for (let k = 0; k < 3; k += 1) { const rr = s * (k === 1 ? 0.8 : 0.6); K.ball((k - 1) * s * 0.7, rr * 0.9, (r(k + 3) - 0.5) * 0.3, rr, k === 1 ? "leafSilver" : "leafMid"); }
  } },
  // A row of sage for a hedge: mounds along a line.
  sagerow: { variants: 2, build: (K, r) => {
    for (let k = -2; k <= 2; k += 1) { const s = 0.36 + 0.1 * r(k + 3); K.ball(k * 0.55, s * 0.9, 0, s, k % 2 ? "leafSilver" : "leafMid"); }
  } },
  // A desert bed: gravel, a small agave, orange poppies.
  desertbed: { variants: 2, build: (K, r) => {
    K.box(0, 0.03, 0, 0.75, 0.03, 0.45, "gravel");
    for (let k = 0; k < 6; k += 1) { const a = (k / 6) * TAU; K.limb([-0.3, 0.05, 0], [-0.3 + dcos(a) * 0.3, 0.35, dsin(a) * 0.25], 0.05, "leafSilver"); }
    for (let k = 0; k < 4; k += 1) K.ball(0.15 + (r(k) - 0.5) * 0.7, 0.14, (r(k + 5) - 0.5) * 0.6, 0.08, k % 2 ? "flowerA" : "flowerB");
  } },
  // Bunchgrass: a thin, straw-coloured clump.
  bunchgrass: { variants: 2, build: (K, r) => {
    for (let k = 0; k < 5; k += 1) K.limb([(k - 2) * 0.05, 0, 0], [(k - 2) * 0.15 + (r(k) - 0.5) * 0.15, 0.3 + 0.15 * r(k + 5), (r(k + 10) - 0.5) * 0.15], 0.03, "straw");
  } },
};

/** Variants a (tree) species: distinct shapes. Ground cover has two. */
export const TREE_VARIANTS = 3;

/**
 * What each PlantKind is in each climate: its species, each as many times as its share (a plant's seed picks one).
 * "" is NOTHING: an arid city's grass is often bare gravel -- sparse, as a desert is.
 */
const FLORA: Readonly<Record<TreeClimate, Readonly<Record<PlantKind, Readonly<Record<string, number>>>>>> = {
  temperate: {
    street: { linden: 3, birch: 1 }, tree: { oak: 3, maple: 3, birch: 2, cherry: 1 }, palm: { oak: 1, maple: 1 },
    conifer: { pine: 1, spruce: 1 }, bush: { shrub: 1 }, hedge: { hedge: 1 }, flowers: { bed: 1 }, grass: { tuft: 1 },
  },
  boreal: {
    street: { fir: 1 }, tree: { spruce: 2, pine: 1, fir: 1 }, palm: { spruce: 1 },
    conifer: { spruce: 1, fir: 1 }, bush: { juniper: 1 }, hedge: { yew: 1 }, flowers: { heather: 1 }, grass: { tussock: 1 },
  },
  subtropical: {
    street: { fanpalm: 3, jacaranda: 1 }, tree: { ficus: 2, jacaranda: 2, palm: 2 }, palm: { palm: 2, fanpalm: 1 },
    conifer: { fanpalm: 1, palm: 1 }, bush: { hibiscus: 1, paradise: 1 }, hedge: { bougainvillea: 1 }, flowers: { tropicalbed: 1 }, grass: { fountain: 1 },
  },
  mediterranean: {
    street: { olive: 2, cypress: 1 }, tree: { stonepine: 2, olive: 2, cypress: 1 }, palm: { stonepine: 1 },
    conifer: { cypress: 2, stonepine: 1 }, bush: { oleander: 1, rosemary: 1 }, hedge: { myrtle: 1 }, flowers: { lavender: 1 }, grass: { drygrass: 1 },
  },
  arid: {
    street: { paloverde: 1 }, tree: { paloverde: 2, joshua: 1 }, palm: { joshua: 1 },
    conifer: { saguaro: 2, joshua: 1 }, bush: { yucca: 1, barrel: 1, sage: 1 }, hedge: { sagerow: 1 }, flowers: { desertbed: 1 }, grass: { bunchgrass: 1, "": 1 },
  },
};

/** Per climate, per PlantKind: the species a plant of that kind can be, in order, each as many times as its share. */
export const TREE_FLORA: Readonly<Record<TreeClimate, Readonly<Record<PlantKind, readonly string[]>>>> = Object.fromEntries(TREE_CLIMATES.map((c) => [c,
  Object.fromEntries(Object.entries(FLORA[c]).map(([kind, shares]) => [kind, Object.entries(shares).flatMap(([id, n]) => Array<string>(n).fill(id))])),
])) as unknown as Record<TreeClimate, Record<PlantKind, readonly string[]>>;

/**
 * The widest crown each kind of plant may be drawn with (m): what the street plan keeps over the pavement
 * (StreetCatalogue.crowns). The same in every climate -- placement never depends on it -- and a species wider than
 * its kind's crown is drawn scaled down to fit (treeFit).
 */
export const PLANT_CROWNS: Readonly<Record<PlantKind, number>> = {
  street: 1.8, tree: 3.4315474297944455, conifer: 2.4633885206189006, palm: 3.4, bush: 1.116802974039456, hedge: 1.7486448965035377, flowers: 0.8, grass: 0.35,
};

/** The species a plant is in a climate, by its kind and seed (null: nothing grows there -- bare ground). */
export function treeSpecies(climate: TreeClimate, kind: PlantKind, seed: number): string | null {
  const list = TREE_FLORA[climate][kind] ?? TREE_FLORA[climate].tree;
  const id = list[Math.abs(Math.floor(seed)) % list.length]!;
  return id === "" ? null : id;
}

/** The species a climate grows, in a stable order. */
export function climateSpecies(climate: TreeClimate): string[] {
  const out: string[] = [];
  for (const list of Object.values(TREE_FLORA[climate])) for (const id of list) if (id && !out.includes(id)) out.push(id);
  return out;
}

/** How much a design is drawn down to keep inside its kind's crown (1: as designed). */
export const treeFit = (design: TreeDesign, kind: PlantKind): number => Math.min(1, PLANT_CROWNS[kind] / Math.max(1e-3, design.radius));

/**
 * Every design (or a climate's): each species' variants, in a stable order (the gallery's). `bare`: the deciduous
 * species as they stand in winter (their keys end "~bare"), the rest as ever.
 */
export function cityTreeDesigns(climate?: TreeClimate, { bare = false }: { bare?: boolean } = {}): TreeDesign[] {
  const out: TreeDesign[] = [];
  const ids = climate ? climateSpecies(climate) : Object.keys(SPECIES);
  for (const species of ids) {
    const s = SPECIES[species]!, winter = bare && !!s.deciduous;
    for (let v = 0; v < (s.variants ?? TREE_VARIANTS); v += 1) {
      const K = new Kit();
      K.bare = winter;
      s.build(K, drawFor(species, v), v);
      const { height, radius } = K.extent();
      out.push({ key: `redline-city-tree/${species}${winter ? "~bare" : ""}#${v}`, species, height, radius, world: K.world() });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- the year
//
// SEASON: where the year is, 0..1 -- 0 the first of spring, .25 midsummer's start, .5 autumn, .75 winter (it wraps).
// The broadleaf climates turn with it: fresh yellow-green in spring, the cherries in blossom; full green through
// summer; amber, rust and gold in autumn; bare in winter. Evergreens (needles, palms, olives, cypress) stay green;
// each warm climate has its flowering season (jacaranda in late spring, oleander through summer, palo verde's gold in
// spring, heather in late summer). SNOW (0..1, from the weather) settles on what faces up: the lit tops of crowns and
// conifer tiers, the ground cover, then the mid tones as it deepens.

/** Whether a climate's deciduous trees are bare at a point in the year (temperate: from late autumn to early spring). */
export function treeBare(climate: TreeClimate, season: number): boolean {
  const y = ((season % 1) + 1) % 1;
  return climate === "temperate" && (y >= 0.74 || y < 0.02);
}

/** How far into flower a climate's blossom is (0: none -- its flowering slots wear leaf). */
function inBloom(climate: TreeClimate, y: number): number {
  const window: Readonly<Record<TreeClimate, readonly [number, number]>> = { temperate: [0.02, 0.2], boreal: [0.36, 0.56], subtropical: [0.1, 0.34], mediterranean: [0.2, 0.52], arid: [0.04, 0.24] };
  const [a, b] = window[climate];
  if (y < a || y > b) return 0;
  const t = (y - a) / (b - a);
  return Math.min(1, Math.min(t, 1 - t) * 6);
}

/** The broadleaf leaves' hues (deep, mid, light), chroma and lightness shift through a temperate year. */
function leafYear(P: ClimatePalette, y: number): { hue: [number, number, number]; c: number; dl: number } {
  const keys: readonly [number, [number, number, number], number, number][] = [
    [0, [P.leaf[0] - 12, P.leaf[1] - 18, P.leaf[2] - 25], P.leafC * 1.1, 0.03],
    [0.2, [P.leaf[0], P.leaf[1], P.leaf[2]], P.leafC, 0],
    [0.45, [P.leaf[0], P.leaf[1], P.leaf[2]], P.leafC, 0],
    [0.56, [25, 48, 78], 0.11, 0.03],
    [0.7, [20, 35, 55], 0.07, -0.03],
    [1, [P.leaf[0] - 12, P.leaf[1] - 18, P.leaf[2] - 25], P.leafC * 1.1, 0.03],
  ];
  let i = 0;
  while (i < keys.length - 2 && y > keys[i + 1]![0]) i += 1;
  const [ya, ha, ca, la] = keys[i]!, [yb, hb, cb, lb] = keys[i + 1]!, t = Math.max(0, Math.min(1, (y - ya) / (yb - ya)));
  // (Hues the short way round the wheel: green to amber passes through yellow, not blue.)
  const hue = ha.map((h, k) => { let d = hb[k]! - h; if (d > 180) d -= 360; if (d < -180) d += 360; return (h + d * t + 360) % 360; }) as [number, number, number];
  return { hue, c: ca + (cb - ca) * t, dl: la + (lb - la) * t };
}


type Marks = RoleLook["pattern"];
const NO_MARKS: Marks = { kind: "none", freq: 1, angle: 0, width: 4, shift: 0, ink: null };
const role = (hue: number, chroma: number, light: number, span: number, finish: RoleLook["finish"] = "matte", pattern: Marks = NO_MARKS): RoleLook => ({ hue, chroma, light, span, finish, pattern });
/** Leaf texture riding each ball's own surface: clusters of leaves a step lighter (or darker) than the mass. */
const marks = (freq: number, width: number, shift: number, kind: Marks["kind"] = "spots", angle = 0): Marks => ({ kind, freq, angle, width, shift, ink: null });

/** A climate's greens and accents: leaf hue (deep, mid, light), chroma, lightness (deep..light), and its colours. */
interface ClimatePalette {
  readonly leaf: readonly [number, number, number]; readonly leafC: number; readonly leafL: readonly [number, number, number];
  readonly needle: readonly [number, number, number]; readonly needleC: number; readonly needleL: readonly [number, number, number];
  readonly silver: readonly [number, number, number];
  readonly blossom: readonly [number, number]; readonly bloomL: number;
  readonly flowerA: readonly [number, number]; readonly flowerB: readonly [number, number];
  readonly trunk: readonly [number, number, number]; readonly pale: readonly [number, number, number];
  readonly grass: readonly [number, number, number]; readonly straw: readonly [number, number, number];
  readonly soil: readonly [number, number, number];
}
// (Night greens: dark, blue-shifted, low in chroma -- each climate its own family, so a city's plants sit together.)
const PALETTES: Readonly<Record<TreeClimate, ClimatePalette>> = {
  temperate: {
    leaf: [194, 162, 136], leafC: 0.07, leafL: [0.17, 0.27, 0.37], needle: [200, 178, 160], needleC: 0.06, needleL: [0.14, 0.22, 0.31],
    silver: [140, 0.03, 0.44], blossom: [345, 0.06], bloomL: 0.6, flowerA: [335, 0.12], flowerB: [70, 0.11],
    trunk: [45, 0.04, 0.27], pale: [95, 0.012, 0.68], grass: [138, 0.07, 0.32], straw: [85, 0.05, 0.46], soil: [40, 0.04, 0.2],
  },
  boreal: {
    leaf: [200, 172, 150], leafC: 0.06, leafL: [0.16, 0.25, 0.34], needle: [208, 186, 168], needleC: 0.055, needleL: [0.13, 0.2, 0.29],
    silver: [180, 0.025, 0.4], blossom: [318, 0.07], bloomL: 0.5, flowerA: [318, 0.08], flowerB: [60, 0.06],
    trunk: [35, 0.035, 0.24], pale: [90, 0.01, 0.62], grass: [120, 0.05, 0.36], straw: [75, 0.05, 0.5], soil: [45, 0.03, 0.18],
  },
  subtropical: {
    leaf: [188, 155, 128], leafC: 0.09, leafL: [0.17, 0.29, 0.4], needle: [192, 165, 145], needleC: 0.08, needleL: [0.16, 0.26, 0.36],
    silver: [135, 0.04, 0.46], blossom: [298, 0.11], bloomL: 0.52, flowerA: [350, 0.16], flowerB: [55, 0.15],
    trunk: [55, 0.035, 0.36], pale: [70, 0.02, 0.56], grass: [135, 0.08, 0.34], straw: [80, 0.06, 0.5], soil: [40, 0.04, 0.2],
  },
  mediterranean: {
    leaf: [190, 150, 128], leafC: 0.055, leafL: [0.18, 0.27, 0.36], needle: [198, 172, 155], needleC: 0.055, needleL: [0.14, 0.22, 0.3],
    silver: [128, 0.035, 0.46], blossom: [355, 0.08], bloomL: 0.58, flowerA: [300, 0.1], flowerB: [75, 0.1],
    trunk: [55, 0.025, 0.34], pale: [75, 0.02, 0.58], grass: [120, 0.055, 0.36], straw: [80, 0.06, 0.52], soil: [55, 0.03, 0.3],
  },
  arid: {
    leaf: [175, 135, 112], leafC: 0.065, leafL: [0.2, 0.31, 0.42], needle: [185, 150, 132], needleC: 0.05, needleL: [0.18, 0.27, 0.36],
    silver: [125, 0.03, 0.48], blossom: [95, 0.13], bloomL: 0.66, flowerA: [45, 0.14], flowerB: [90, 0.13],
    trunk: [60, 0.03, 0.4], pale: [80, 0.02, 0.56], grass: [110, 0.05, 0.4], straw: [80, 0.06, 0.55], soil: [60, 0.035, 0.38],
  },
};

/**
 * The trees' paint in a climate at a point in the year (SEASON above; default midsummer), with `snow` lying on them
 * (0..1): its night greens (blue-shifted, low) with a clear dither -- or, under a lamp, warmed and lifted, the pool of
 * light on their leaves. `hue` turns the flower beds (a district's neon, if you like).
 */
export function treePaint({ lit = false, hue, climate = "temperate", season = 0.3, snow = 0 }: { lit?: boolean; hue?: number; climate?: TreeClimate; season?: number; snow?: number } = {}): LayerPaint {
  const P = PALETTES[climate], L = lit ? 0.12 : 0, warm = lit ? -18 : 0, y = ((season % 1) + 1) % 1;
  const year = climate === "temperate" ? leafYear(P, y) : { hue: [P.leaf[0], P.leaf[1], P.leaf[2]] as [number, number, number], c: P.leafC, dl: 0 };
  const bloomNow = inBloom(climate, y), sn = Math.max(0, Math.min(1, snow));
  // (Snow on what faces up: `up` 1 the lit tops, .5 the mid tones, 0 the shade.)
  const snowy = (look: RoleLook, up: number): RoleLook => {
    const k = Math.max(0, Math.min(1, sn * 1.6 * up - (up < 1 ? 0.35 : 0)));
    return k <= 0 ? look : { ...look, hue: look.hue + (((248 - look.hue + 540) % 360) - 180) * k, chroma: look.chroma * (1 - k) + 0.02 * k, light: look.light * (1 - k) + (0.82 + L * 0.5) * k, pattern: k > 0.5 ? NO_MARKS : look.pattern };
  };
  // (Leaves: each clump shaded as one mass down a ramp from its lit top into shadow, the steps broken by the dither.
  // The deep tone leans blue: the shadowed skirts take the night's teal.)
  const leaf = (h: number, c: number, light: number, dither = 1.2, mk: Marks = marks(8, 2, -1), up = 0): SlotPaint => ({ look: snowy(role(h + warm, c, light + L, 0.36, "cloth", mk), up), ink: null, screen: "bayer4", dither });
  const flat = (h: number, c: number, light: number, screen: SlotPaint["screen"] = "bayer2", dither = 0.8, span = 0.4, mk: Marks = NO_MARKS): SlotPaint => ({ look: role(h, c, light + L, span, "matte", mk), ink: null, screen, dither });
  // (Out of flower, a flowering tree's blossom slots wear its leaves.)
  const bloom = (dl: number, dc: number, tone: 0 | 1 | 2): SlotPaint => bloomNow > 0
    ? { look: snowy(role(P.blossom[0] + (lit ? 8 : 0), P.blossom[1] * dc * (0.4 + 0.6 * bloomNow), P.bloomL + dl + L * 0.8, 0.35, "cloth", marks(8, 2, -1)), tone === 2 ? 1 : 0.5), ink: null, screen: "bayer4", dither: 1 }
    : leaf(year.hue[tone], year.c, P.leafL[tone] + year.dl, 1.2, marks(8, 2, -1), tone === 2 ? 1 : tone === 1 ? 0.5 : 0);
  const slots: Record<Slot, SlotPaint> = {
    // (Wood: furrows running up the trunk and limbs, knots on the bark, a birch's black lenticels, a palm's rings, the
    // dead thatch's hanging strands -- marks riding each part's own surface coordinate, so they wrap and follow it.)
    trunk: flat(P.trunk[0], P.trunk[1], P.trunk[2], "bayer2", 0.8, 0.45, marks(6, 2, -2, "stripes")),
    bark: flat(P.trunk[0] - 10, P.trunk[1] * 0.8, P.trunk[2] * 0.62, "bayer2", 0.8, 0.45, marks(4, 2, -1, "stripes")),
    trunkPale: flat(P.pale[0], P.pale[1], P.pale[2], "bayer2", 0.6, 0.3, marks(5, 2, -3, "spots")),
    ringed: flat(P.trunk[0] + 5, P.trunk[1], P.trunk[2] + 0.04, "bayer2", 0.8, 0.45, marks(8, 2, -2, "bands")),
    thatch: flat(P.straw[0] - 20, P.straw[1] * 0.9, P.straw[2] * 0.62, "hatch", 1, 0.4, marks(8, 3, -1, "stripes")),
    leafDeep: leaf(year.hue[0], year.c, P.leafL[0] + year.dl), leafMid: leaf(year.hue[1], year.c, P.leafL[1] + year.dl, 1.2, marks(8, 2, -1), 0.5),
    leafLight: leaf(year.hue[2], year.c * 1.05, P.leafL[2] + year.dl, 1.2, marks(8, 2, -1), 1),
    leafSilver: leaf(P.silver[0], P.silver[1], P.silver[2], 1, marks(8, 2, -1), 1),
    // (Fronds: leaflets as stripes across the blade.)
    frond: leaf(P.leaf[1] - 4, P.leafC, P.leafL[1] - 0.01, 1.3, marks(5, 3, -1, "stripes", 2), 0.5), frondLight: leaf(P.leaf[2] - 4, P.leafC, P.leafL[2], 1.3, marks(5, 3, -1, "stripes", 2), 1),
    // (Needles: a finer, denser speckle than leaves, a step lighter in the shade -- sprays catching the light.)
    needleDeep: leaf(P.needle[0], P.needleC, P.needleL[0], 1.4, marks(8, 1, 1)), needle: leaf(P.needle[1], P.needleC, P.needleL[1], 1.4, marks(8, 2, -1), 0.5),
    needleLight: leaf(P.needle[2], P.needleC, P.needleL[2], 1.4, marks(8, 1, -1), 1),
    // (Blossom: greyed and dimmer by night, only lifted, not warmed, by a lamp -- in clustered dither, so a crown reads
    // as masses of flower, not dots.)
    blossomDeep: bloom(-0.14, 0.9, 0), blossom: bloom(0, 1, 1), blossomPale: bloom(0.13, 0.5, 2),
    // (Fallen petals while it flowers; out of flower they're the grass they lie on.)
    petal: bloomNow > 0 ? { look: role(P.blossom[0], P.blossom[1] * 0.7, P.bloomL + 0.02 + L * 0.6, 0.2), ink: null, screen: "none", dither: 0 } : leaf(P.grass[0], P.grass[1], P.grass[2], 1.2, NO_MARKS, 1),
    cactus: leaf(P.leaf[1] + 8, P.leafC * 0.85, P.leafL[1] + 0.02, 0.9, marks(8, 1, 1, "stripes")), cactusLight: leaf(P.leaf[2] + 5, P.leafC * 0.8, P.leafL[2] + 0.04, 0.9, marks(8, 1, -1, "stripes"), 0.5),
    spine: flat(90, 0.03, 0.72, "none", 0, 0.2),
    grate: { look: role(240, 0.01, 0.22 + L, 0.4, "metal"), ink: null, screen: "checker", dither: 0.9 },
    soil: flat(P.soil[0], P.soil[1], P.soil[2], "ign", 1, 0.3),
    gravel: flat(P.soil[0] + 10, P.soil[1] * 0.7, P.soil[2] + 0.12, "ign", 1.1, 0.35),
    hedge: leaf(P.leaf[0] - 4, P.leafC, P.leafL[0] + 0.06, 1.2, marks(8, 2, -1), 0.5),
    flowerA: { look: role(hue ?? P.flowerA[0], P.flowerA[1], 0.52 + L, 0.4), ink: null, screen: "none", dither: 0 },
    flowerB: { look: role(P.flowerB[0], P.flowerB[1], 0.6 + L, 0.4), ink: null, screen: "none", dither: 0 },
    grass: leaf(P.grass[0], P.grass[1] * (climate === "temperate" && y > 0.7 ? 0.6 : 1), P.grass[2], 1.2, marks(8, 2, -1), 1),
    straw: leaf(P.straw[0], P.straw[1], P.straw[2] - 0.04, 1, marks(8, 2, -1), 1),
  };
  const out: (SlotPaint | null)[] = new Array<SlotPaint | null>(32).fill(null);
  for (const [k, p] of Object.entries(slots)) out[TREE_SLOT[k as Slot]] = p;
  return out;
}

/** A climate's tree paint at a point in the year with snow lying (the renderer swaps it in as the weather turns). */
export const treeSeasonPaint = (climate: TreeClimate, season: number, { lit = false, snow = 0, hue }: { lit?: boolean; snow?: number; hue?: number } = {}): LayerPaint =>
  treePaint({ lit, climate, season, snow, ...(hue === undefined ? {} : { hue }) });
