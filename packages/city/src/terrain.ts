// The land a city sits on: flat across its core (where the roads are -- v1
// roads are flat), rising or falling past it toward what lies beyond each edge:
// the sea drops away, mountains climb, a desert stays low and bare. What the
// skyline and the ground colour read; the drivable surface never does.

import { dcos, dsin } from "@keel-engine/core";
import type { CitySite, EdgeTrait } from "./types.ts";

export interface Ground {
  /** Metres above the road plane (0 across the core). */
  readonly height: number;
  /** What the ground is here: the city, or the edge trait it has blended into. */
  readonly biome: "city" | EdgeTrait;
}

/** The sea's level (m): below it, the land is under water (keel/city region and a game's water agree on it). */
export const SEA_LEVEL = -2.5;

/** How far past the core (m) the edges start to rise or fall: clear of the ring road. */
const EDGE_FROM = 130;

/** The ground at a point. */
export function groundAt(site: CitySite, x: number, z: number): Ground {
  const r = Math.sqrt(x * x + z * z);
  // (A feathered edge: nothing changes inside the core and out past the ring road round it (~70 m beyond); it's all
  // the edge's another 220 m on -- so the ring runs on the city's own ground, not cut into a mountainside.)
  const t = Math.max(0, Math.min(1, (r - site.core - EDGE_FROM) / 220));
  if (t <= 0) return { height: 0, biome: "city" };
  let best: EdgeTrait | null = null, weight = 0;
  for (const e of site.edges) {
    // (How squarely this point lies on the trait's bearing.)
    const w = Math.max(0, (x * dsin(e.bearing) + z * dcos(e.bearing)) / Math.max(1, r));
    if (w > weight) { weight = w; best = e.trait; }
  }
  if (!best || weight < 0.35) return { height: 0, biome: "city" };
  const k = t * Math.min(1, (weight - 0.35) / 0.4);
  const rise = best === "mountain" ? 140 * k * k : best === "ocean" || best === "river" ? -6 * k : best === "forest" ? 8 * k : 2 * k;
  return { height: rise, biome: k > 0.25 ? best : "city" };
}
