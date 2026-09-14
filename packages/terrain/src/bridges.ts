// Bridge spans: where a bridge can cross water or a gap in a straight line
// between two walkable tiles at one level. The terrain only SUGGESTS (with
// what each would join) and, once one is chosen, marks the deck so the walk
// rules use it (applyBridge); the bridge itself is an object from the
// content packs, placed by the level on bridgePlacement(span).
//
//   const spans = bridgeSpans(t, { maxSpan: 8, prefer: (i, j) => isRoad(i, j) });
//   applyBridge(t, spans[0]);                  // deck tiles: walkable along the span
//   level.place({ pack: "packs/buildings", id: "bridge", ...bridgePlacement(t, spans[0]) });

import { DX4, DZ4, FLAG, WATER_NONE } from "./types.ts";
import type { Terrain } from "./grid.ts";
import { cornerLevels } from "./cliffs.ts";

export interface BridgeSpan {
  /** The walkable tiles at each end (outside the deck). */
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  /** 0: along z (north), 1: along x (east). */
  readonly axis: 0 | 1;
  /** Tiles the deck covers (between the ends). */
  readonly length: number;
  /** The deck's level (steps): the ends' level. */
  readonly level: number;
  /** What it crosses: water (any tile wet) or a gap (dry, lower ground). */
  readonly over: "water" | "gap";
  /** Tiles of deep water under it. */
  readonly deep: number;
  /** It joins two regions the ground can't otherwise walk between (when regions were given). */
  readonly joins: boolean;
  /** Higher is better: short, joining, preferred ends. */
  readonly score: number;
}

export interface SpanOptions {
  /** Longest deck (tiles, default 8) and shortest (default 1). */
  readonly maxSpan?: number;
  readonly minSpan?: number;
  /** Ends that are wanted (a road's tiles): +4 each. */
  readonly prefer?: (i: number, j: number) => boolean;
  /** A region label per tile (pathing regions().label): spans joining two regions score +10. */
  readonly regions?: Int32Array | null;
  /** Consider only spans whose ends are both preferred. */
  readonly preferredOnly?: boolean;
}

// A tile a bridge can stand on at its end: dry, flat, not blocked, not a deck already.
function endLevel(t: Terrain, i: number, j: number): number | null {
  if (!t.inside(i, j)) return null;
  const k = t.index(i, j);
  if (t.flags[k]! & (FLAG.BLOCKED | FLAG.BRIDGE | FLAG.RAMP)) return null;
  if (t.water[k] !== WATER_NONE && t.water[k]! > t.height[k]!) return null;
  const c = cornerLevels(t, i, j);
  return c[0] === c[1] && c[1] === c[2] && c[2] === c[3] ? c[0] : null;
}

/** Every straight span a bridge could take (both directions of a run are one span), best first. */
export function bridgeSpans(t: Terrain, { maxSpan = 8, minSpan = 1, prefer, regions = null, preferredOnly = false }: SpanOptions = {}): BridgeSpan[] {
  const out: BridgeSpan[] = [];
  for (let j = 0; j < t.depth; j += 1) for (let i = 0; i < t.width; i += 1) {
    const L = endLevel(t, i, j);
    if (L === null) continue;
    for (const d of [0, 1] as const) { // (north and east only: each span found once, from its lower end)
      const dx = DX4[d]!, dz = DZ4[d]!;
      let s = 1, wet = false, deep = 0, ok = true;
      for (; s <= maxSpan + 1; s += 1) {
        const a = i + dx * s, b = j + dz * s;
        if (!t.inside(a, b)) { ok = false; break; }
        const k = t.index(a, b);
        if (s > 1 && endLevel(t, a, b) === L) break; // (the far end)
        // (A deck tile: lower than the deck or wet below it; never higher, never another deck, never blocked.)
        if (t.flags[k]! & (FLAG.BRIDGE | FLAG.BLOCKED)) { ok = false; break; }
        const top = Math.max(...cornerLevels(t, a, b));
        const w = t.water[k]!;
        const wetHere = w !== WATER_NONE && w > t.height[k]!;
        if (top > L || (wetHere && w > L)) { ok = false; break; }
        if (!wetHere && top === L) { ok = false; break; } // (walkable at the deck's level already: not a gap)
        if (wetHere) { wet = true; if (w - t.height[k]! >= 2) deep += 1; }
      }
      const length = s - 1;
      if (!ok || length < minSpan || length > maxSpan) continue;
      const to: [number, number] = [i + dx * s, j + dz * s];
      const pi = prefer ? prefer(i, j) : false, pj = prefer ? prefer(to[0], to[1]) : false;
      if (preferredOnly && !(pi && pj)) continue;
      const joins = regions ? regions[t.index(i, j)] !== regions[t.index(to[0], to[1])] : false;
      const score = (joins ? 10 : 0) + (pi ? 4 : 0) + (pj ? 4 : 0) - length * 0.5 + deep * 0.1;
      out.push({ from: [i, j], to, axis: d === 0 ? 0 : 1, length, level: L, over: wet ? "water" : "gap", deep, joins, score });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.length - b.length || a.from[1] - b.from[1] || a.from[0] - b.from[0] || a.axis - b.axis);
}

/** The deck tiles of a span. */
export function spanTiles(s: BridgeSpan): Array<[number, number]> {
  const dx = s.axis === 1 ? 1 : 0, dz = s.axis === 0 ? 1 : 0;
  return Array.from({ length: s.length }, (_, n) => [s.from[0] + dx * (n + 1), s.from[1] + dz * (n + 1)]);
}

/** Mark a span's deck: its tiles walk at the deck's level, along its axis. */
export function applyBridge(t: Terrain, s: BridgeSpan): void {
  t.batch(() => { for (const [i, j] of spanTiles(s)) t.setDeck(i, j, s.level, s.axis); });
}

/** Take a span's deck off. */
export function removeBridge(t: Terrain, s: BridgeSpan): void {
  t.batch(() => { for (const [i, j] of spanTiles(s)) t.setDeck(i, j, null); });
}

/**
 * Where the bridge object goes: the middle of the span at deck height, turned
 * along it (yaw 0 runs along z, PI/2 along x: the object's +z along the span),
 * and the sizes a bridge takes (metres): its length end to end (the deck plus
 * `overlap` onto each bank) and width.
 */
export function bridgePlacement(t: Terrain, s: BridgeSpan, { overlap = 0.5, width = 1 }: { readonly overlap?: number; readonly width?: number } = {}): { pos: [number, number, number]; yaw: number; length: number; width: number; level: number } {
  const ts = t.tileSize;
  const mi = (s.from[0] + s.to[0]) / 2 + 0.5, mj = (s.from[1] + s.to[1]) / 2 + 0.5;
  return { pos: [mi * ts, s.level * t.stepHeight, mj * ts], yaw: s.axis === 0 ? 0 : Math.PI / 2, length: (s.length + 2 * overlap) * ts, width: width * ts, level: s.level };
}
