// Fairness for N-player maps (keel-rts RTS.md 6.1): where the bases go (by a
// symmetry: mirror, rot2, rot4, or N wedges round the middle), and how fair
// the result MEASURES -- per player, the path distance main -> natural, main ->
// nearest enemy, main -> the contested middle, the choke width out of the
// main, resources within 20 tiles, and high ground. A metric's spread is
// (max - min) / mean; a map passes when every spread is within `tolerance`
// (5%). Rotation on a grid is never exact, so fairness is measured, never assumed.

import { buildPathGrid, clearance, flowField, followField, UNREACHED } from "@keel-engine/terrain";
import type { MoveClass, PathGrid } from "@keel-engine/terrain";
import type { Level, Tile } from "./document.ts";
import { datan2, dcos, dhypot, dsin } from "@keel-engine/core";

export type Symmetry = "none" | "mirror" | "rot2" | "rot4" | "wedges";
export const SYMMETRIES: readonly Symmetry[] = ["none", "mirror", "rot2", "rot4", "wedges"];

/**
 * A point's place in the canonical wedge: the map folded by its symmetry, so
 * a field evaluated there repeats for every player. `mirror` folds across the
 * vertical middle line; `rot2` turns the far half by 180 degrees; `rot4` by
 * quarter turns (exact on a square map); `wedges` N ways round the middle.
 */
export function canonical(x: number, z: number, cx: number, cz: number, sym: Symmetry, n: number): [number, number] {
  const dx = x - cx, dz = z - cz;
  switch (sym) {
    case "mirror": return [cx - Math.abs(dx), z];
    case "rot2": return dz < 0 || (dz === 0 && dx < 0) ? [cx - dx, cz - dz] : [x, z];
    case "rot4": {
      // (Quarter turns until the point is in the wedge between -45 and 45 degrees above the middle.)
      let a = dx, b = dz;
      for (let q = 0; q < 4; q += 1) { if (b >= Math.abs(a) && !(b === -a && b !== 0)) break; [a, b] = [-b, a]; }
      return [cx + a, cz + b];
    }
    case "wedges": {
      if (n < 2) return [x, z];
      const r = dhypot(dx, dz);
      const w = (Math.PI * 2) / n;
      let th = datan2(dx, dz);
      th = ((th % w) + w) % w;
      return [cx + dsin(th) * r, cz + dcos(th) * r];
    }
    default: return [x, z];
  }
}

/** Player positions round the middle by a symmetry: `radius` out (a share of the half map, 0..1), turned by `turn` radians. */
export function symmetricPositions(n: number, sym: Symmetry, width: number, depth: number, { radius = 0.72, turn = 0 }: { readonly radius?: number; readonly turn?: number } = {}): Array<[number, number]> {
  const cx = width / 2, cz = depth / 2;
  const R = radius * Math.min(cx, cz);
  const at = (th: number): [number, number] => [cx + dsin(th) * R, cz + dcos(th) * R];
  if (sym === "mirror") {
    // (Pairs across the middle line: player 2k on the left, 2k+1 mirrored on the right.)
    const out: Array<[number, number]> = [];
    const pairs = Math.ceil(n / 2);
    for (let p = 0; p < pairs; p += 1) {
      const z = depth * ((p + 0.5) / pairs) * 0.8 + depth * 0.1;
      out.push([cx - R, z], [cx + R, z]);
    }
    return out.slice(0, n);
  }
  if (sym === "rot2") return Array.from({ length: n }, (_, p) => at(turn + Math.PI * (p % 2) + Math.floor(p / 2) * ((Math.PI * 2) / Math.max(2, n))));
  const k = sym === "rot4" ? 4 : n;
  return Array.from({ length: n }, (_, p) => at(turn + (Math.PI * 2 * (sym === "rot4" ? p % 4 : p)) / k + (sym === "rot4" ? Math.floor(p / 4) * (Math.PI / 4) : 0)));
}

export interface PlayerMetrics {
  readonly player: number;
  /** Path cost (tiles, orthogonal steps) to its natural, the nearest enemy main, the middle. */
  readonly toNatural: number;
  readonly toEnemy: number;
  readonly toMiddle: number;
  /** The narrowest opening (tiles) on the way from the main to the middle. */
  readonly choke: number;
  /** Resources (nodes and sites) within 20 tiles of walking. */
  readonly resources: number;
  /** The main's level (steps). */
  readonly height: number;
}

export interface FairnessReport {
  readonly players: readonly PlayerMetrics[];
  /** Per metric: (max - min) / mean (0: perfectly even). */
  readonly spread: Readonly<Record<"toNatural" | "toEnemy" | "toMiddle" | "choke" | "resources" | "height", number>>;
  /** The worst spread, and the metric it's in. */
  readonly worst: { readonly metric: string; readonly spread: number };
  readonly pass: boolean;
  readonly tolerance: number;
  /** Every main can reach every other (a map split in two is never fair). */
  readonly connected: boolean;
}

/** Measure a level's fairness for its spawns. */
export function fairness(level: Level, { moveClass = "ground", tolerance = 0.05, grid: g = null, middle }: { readonly moveClass?: MoveClass; readonly tolerance?: number; readonly grid?: PathGrid | null; readonly middle?: Tile } = {}): FairnessReport {
  const t = level.terrain;
  const grid = g ?? buildPathGrid(t, { moveClass, blocked: level.blocked() });
  const W = t.width;
  // The middle: the tiles round the map's centre (a 2 x 2 block on an even map: symmetric under every symmetry), or one given.
  const mids: number[] = [];
  if (middle) mids.push(middle[1] * W + middle[0]);
  else for (let j = Math.floor((t.depth - 1) / 2); j <= Math.ceil((t.depth - 1) / 2); j += 1) for (let i = Math.floor((t.width - 1) / 2); i <= Math.ceil((t.width - 1) / 2); i += 1) mids.push(j * W + i);
  const clear = clearance(grid);
  // (Units of path cost: an orthogonal step onto a cost-1 tile is 5; report tiles.)
  const tiles = (d: number): number => (d === UNREACHED ? Infinity : d / 5);
  // (A field from the middle: every player's way there, and its narrowest opening.)
  const toMid = flowField(grid, mids.filter((k) => grid.cost[k]));
  const players: PlayerMetrics[] = [];
  let connected = true;
  const fields = level.spawns.map((s) => flowField(grid, [s.at[1] * W + s.at[0]]));
  level.spawns.forEach((s, p) => {
    const f = fields[p]!;
    const natural = s.natural ? tiles(f.dist[s.natural[1] * W + s.natural[0]]!) : 0;
    let enemy = Infinity;
    level.spawns.forEach((o, q) => { if (q !== p && o.team !== s.team) { const d = tiles(f.dist[o.at[1] * W + o.at[0]]!); if (d === Infinity) connected = false; enemy = Math.min(enemy, d); } });
    const toMiddle = tiles(toMid.dist[s.at[1] * W + s.at[0]]!);
    // Choke: the narrowest clearance on the walk from the main to the middle.
    let choke = Infinity;
    if (toMiddle !== Infinity) for (const [i, j] of followField(toMid, s.at[0], s.at[1])) choke = Math.min(choke, clear[j * W + i]!);
    const resources = level.resources.filter((r) => tiles(f.dist[r.at[1] * W + r.at[0]]!) <= 20).length;
    players.push({ player: s.player, toNatural: natural, toEnemy: enemy, toMiddle, choke: choke === Infinity ? 0 : choke * 2 - 1, resources, height: t.height[s.at[1] * W + s.at[0]]! });
  });
  const keys = ["toNatural", "toEnemy", "toMiddle", "choke", "resources", "height"] as const;
  const spread = {} as Record<(typeof keys)[number], number>;
  for (const key of keys) {
    const v = players.map((p) => p[key]);
    if (!v.length || v.some((x) => !Number.isFinite(x))) { spread[key] = v.length ? Infinity : 0; continue; }
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const range = Math.max(...v) - Math.min(...v);
    // (Heights are levels: any difference is a real advantage; spread them over the map's relief instead of the mean.)
    spread[key] = range === 0 ? 0 : key === "height" ? range / Math.max(1, mean) : range / Math.max(1e-9, Math.abs(mean));
  }
  let worst = { metric: "none", spread: 0 };
  for (const key of keys) if (spread[key] > worst.spread) worst = { metric: key, spread: spread[key] };
  return { players, spread, worst, pass: connected && worst.spread <= tolerance, tolerance, connected };
}
