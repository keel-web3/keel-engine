// Auto-tiling: which variant each tile wears, from its neighbours, by a
// RULES TABLE. A rule says which tiles it applies to (`self`), which
// neighbours count (`other`, relative to the tile) and the set it picks from:
//
//   blob47       8 neighbours -> 47 variants (a corner counts only when both
//                edges beside it do: Wang's blob set): edges between types,
//                shorelines, foam, cliff tops
//   cardinal16   4 neighbours -> 16 variants (N E S W joins): roads and paths
//
// The result per tile and rule is the raw 8-bit mask (bit d = dir8 d: N NE E
// SE S SW W NW) and its variant index; plus, for the "overlay" relation, WHICH
// type lies over the tile's edges (the highest-priority neighbour at its
// level). A tileset renderer picks sprites by (rule, index, variant); the
// ground baker paints the same answers analytically -- a fringe of the overlay
// type along each masked edge and corner -- so the rules drive both.
//
// Rules are plain data (names, not functions), so a level can carry its own
// table and the editor can show it; `custom` relations take a function.

import { DX8, DZ8, FLAG } from "./types.ts";
import { edgeLevels } from "./cliffs.ts";
import type { Terrain } from "./grid.ts";
import { hash2 } from "@keel-engine/core";

/** Which tiles a rule applies to. A list names terrain types. */
export type TileClass = "any" | "land" | "water" | "shallow" | "deep" | readonly string[];
/**
 * Which neighbours count, relative to the tile:
 *   overlay   land at the tile's level whose type's priority is higher (the edge that lies over it)
 *   water     wet (any depth)          land      dry
 *   shallow   one step of water        deep      two or more
 *   higher    its top stands above the tile's edge (a cliff rises there)
 *   lower     its top is below the tile's edge (a cliff drops there)
 *   same      the tile's own type (at any level)
 *   a list    those terrain types (a bridge counts as "road")
 */
export type Relation = "overlay" | "water" | "land" | "shallow" | "deep" | "higher" | "lower" | "same" | readonly string[];

export interface AutoRule {
  readonly name: string;
  readonly shape: "blob47" | "cardinal16";
  readonly self: TileClass;
  readonly other: Relation;
  /** Off the map counts as matching (default false; shores true, so the sea runs off the edge). */
  readonly edges?: boolean;
}

/** The engine's rules. */
export const AUTOTILE_RULES: readonly AutoRule[] = [
  { name: "overlay", shape: "blob47", self: "land", other: "overlay" },
  { name: "shore", shape: "blob47", self: "land", other: "water" },
  { name: "foam", shape: "blob47", self: "water", other: "land" },
  { name: "deep", shape: "blob47", self: "deep", other: "shallow" },
  { name: "cliff", shape: "blob47", self: "any", other: "lower" },
  { name: "road", shape: "cardinal16", self: ["road"], other: ["road"] },
  { name: "path", shape: "cardinal16", self: ["path"], other: ["path", "road"] },
];

// ---------------------------------------------------------------- the sets

/** A blob mask reduced: corner bits kept only where both edges beside them are set. */
export function reduceBlob(mask: number): number {
  let m = mask & 0x55; // (the four edges: bits 0, 2, 4, 6)
  for (let c = 1; c < 8; c += 2) {
    const a = (c + 7) & 7, b = (c + 1) & 7;
    if (mask & (1 << c) && mask & (1 << a) && mask & (1 << b)) m |= 1 << c;
  }
  return m;
}
/** The 47 reduced masks, in ascending order: variant i is BLOB47[i]. */
export const BLOB47: readonly number[] = [...new Set(Array.from({ length: 256 }, (_, m) => reduceBlob(m)))].sort((a, b) => a - b);
const BLOB_INDEX = new Uint8Array(256);
for (let m = 0; m < 256; m += 1) BLOB_INDEX[m] = BLOB47.indexOf(reduceBlob(m));
/** A raw 8-bit mask's blob47 variant (0..46). */
export const blobIndex = (mask: number): number => BLOB_INDEX[mask & 255]!;
/** A raw 8-bit mask's cardinal16 variant (0..15: N=1, E=2, S=4, W=8). */
export const cardinalIndex = (mask: number): number => (mask & 1) | ((mask >> 1) & 2) | ((mask >> 2) & 4) | ((mask >> 3) & 8);

// ---------------------------------------------------------------- evaluating

interface Compiled {
  readonly rule: AutoRule;
  self: (k: number) => boolean;
  other: (k: number, n: number, i: number, j: number, ni: number, nj: number, d: number) => boolean;
}

function compile(t: Terrain, rule: AutoRule): Compiled {
  const depthK = (k: number): number => { const w = t.water[k]!; return w === -32768 ? 0 : Math.max(0, w - t.height[k]!); };
  const ids = (names: readonly string[]): Set<number> => new Set(names.filter((n) => t.types.has(n)).map((n) => t.types.id(n)));
  const roadId = t.types.has("road") ? t.types.id("road") : -1;
  let self: (k: number) => boolean;
  if (typeof rule.self !== "string") { const s = ids(rule.self); self = (k) => s.has(t.type[k]!) && depthK(k) === 0; }
  else switch (rule.self) {
    case "land": self = (k) => depthK(k) === 0; break;
    case "water": self = (k) => depthK(k) > 0; break;
    case "shallow": self = (k) => depthK(k) === 1; break;
    case "deep": self = (k) => depthK(k) >= 2; break;
    default: self = () => true;
  }
  // The top's level at the shared edge (dir8: an edge's two corners; a corner's one).
  const levelToward = (i: number, j: number, d: number): number => {
    if (d & 1) { const e = edgeLevels(t, i, j, (d - 1) >> 1); const f = edgeLevels(t, i, j, ((d + 1) & 7) >> 1); return Math.max(e[0], e[1], f[0], f[1]); }
    const e = edgeLevels(t, i, j, d >> 1); return Math.max(e[0], e[1]);
  };
  const opp8 = (d: number): number => (d + 4) & 7;
  let other: Compiled["other"];
  if (typeof rule.other !== "string") {
    const s = ids(rule.other);
    const bridges = s.has(roadId);
    other = (_k, n) => (s.has(t.type[n]!) && depthK(n) === 0) || (bridges && (t.flags[n]! & FLAG.BRIDGE) !== 0);
  } else switch (rule.other) {
    case "water": other = (_k, n) => depthK(n) > 0; break;
    case "land": other = (_k, n) => depthK(n) === 0; break;
    case "shallow": other = (_k, n) => depthK(n) === 1; break;
    case "deep": other = (_k, n) => depthK(n) >= 2; break;
    case "same": other = (k, n) => t.type[k] === t.type[n]; break;
    case "higher": other = (_k, _n, i, j, ni, nj, d) => levelToward(ni, nj, opp8(d)) > levelToward(i, j, d); break;
    case "lower": other = (_k, _n, i, j, ni, nj, d) => levelToward(ni, nj, opp8(d)) < levelToward(i, j, d); break;
    default: { // overlay: land at the same level, a higher priority
      const pr = t.types.list.map((ty) => ty.priority);
      other = (k, n) => depthK(n) === 0 && t.height[n] === t.height[k] && !((t.flags[n]! | t.flags[k]!) & FLAG.RAMP) && pr[t.type[n]!]! > pr[t.type[k]!]!;
    }
  }
  return { rule, self, other };
}

/** The auto-tiling of a map (or a rectangle of it). */
export interface AutoTiles {
  readonly rules: readonly AutoRule[];
  /** Per rule, per tile: the raw 8-bit neighbour mask (0 where the rule doesn't apply). */
  readonly masks: readonly Uint8Array[];
  /** Per rule, per tile: does the rule apply (its `self` test)? */
  readonly applies: readonly Uint8Array[];
  /** Per tile: the type lying over its edges ("overlay"), 255 for none. */
  readonly overlay: Uint8Array;
  /** Per tile: 0..3, a stable hash of its place (a tileset's alternates). */
  readonly variant: Uint8Array;
  /** A rule's index by name (-1: none). */
  rule(name: string): number;
  /** One tile's answer for a rule: its mask, the set's variant index, and the tile's alternate. */
  at(i: number, j: number, rule: string | number): { mask: number; index: number; variant: number; applies: boolean };
}

/**
 * Auto-tile a terrain by a rules table (default AUTOTILE_RULES), over the
 * whole map or a rectangle [i0, j0, i1, j1) of it (the arrays are map-sized;
 * only the rectangle is written). `into` refreshes an earlier result in place.
 */
export function autoTile(t: Terrain, { rules = AUTOTILE_RULES, rect = [0, 0, t.width, t.depth], into, seed = 0 }: { readonly rules?: readonly AutoRule[]; readonly rect?: readonly [number, number, number, number]; readonly into?: AutoTiles; readonly seed?: number } = {}): AutoTiles {
  const n = t.width * t.depth;
  const out: AutoTiles = into ?? {
    rules,
    masks: rules.map(() => new Uint8Array(n)),
    applies: rules.map(() => new Uint8Array(n)),
    overlay: new Uint8Array(n).fill(255),
    variant: new Uint8Array(n),
    rule: (name) => rules.findIndex((r) => r.name === name),
    at(i, j, r) {
      const ri = typeof r === "number" ? r : rules.findIndex((x) => x.name === r);
      if (ri < 0) throw new RangeError(`No auto-tile rule "${String(r)}".`);
      const k = t.index(i, j);
      const mask = out.masks[ri]![k]!;
      return { mask, index: rules[ri]!.shape === "blob47" ? blobIndex(mask) : cardinalIndex(mask), variant: out.variant[k]!, applies: out.applies[ri]![k] === 1 };
    },
  };
  const compiled = out.rules.map((r) => compile(t, r));
  const overlayRule = out.rules.findIndex((r) => r.other === "overlay");
  const pr = t.types.list.map((ty) => ty.priority);
  const [i0, j0, i1, j1] = [Math.max(0, rect[0]), Math.max(0, rect[1]), Math.min(t.width, rect[2]), Math.min(t.depth, rect[3])];
  for (let j = j0; j < j1; j += 1) for (let i = i0; i < i1; i += 1) {
    const k = t.index(i, j);
    out.variant[k] = Math.floor(hash2(i, j, seed + 0x5eed) * 4);
    for (let r = 0; r < compiled.length; r += 1) {
      const c = compiled[r]!;
      if (!c.self(k)) { out.masks[r]![k] = 0; out.applies[r]![k] = 0; continue; }
      out.applies[r]![k] = 1;
      let mask = 0;
      const cardinal = c.rule.shape === "cardinal16";
      for (let d = 0; d < 8; d += cardinal ? 2 : 1) {
        const ni = i + DX8[d]!, nj = j + DZ8[d]!;
        const hit = t.inside(ni, nj) ? c.other(k, t.index(ni, nj), i, j, ni, nj, d) : (c.rule.edges ?? false);
        if (hit) mask |= 1 << d;
      }
      if (r === overlayRule && mask) {
        // (The overlay is ONE type: the highest priority among the neighbours that count; the mask keeps only its tiles.)
        let best = -1;
        for (let d = 0; d < 8; d += 1) if (mask & (1 << d)) { const ty = t.type[t.index(i + DX8[d]!, j + DZ8[d]!)]!; if (best < 0 || pr[ty]! > pr[best]! || (pr[ty] === pr[best] && ty < best)) best = ty; }
        let m = 0;
        for (let d = 0; d < 8; d += 1) if (mask & (1 << d) && t.type[t.index(i + DX8[d]!, j + DZ8[d]!)] === best) m |= 1 << d;
        mask = m;
        out.overlay[k] = best;
      } else if (r === overlayRule) out.overlay[k] = 255;
      out.masks[r]![k] = mask;
    }
  }
  return out;
}
