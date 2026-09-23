// What a tyre is on: the materials a road world is made of, as the physics and
// the effects both need them -- how much it grips, whether a tyre skating
// across it sideways digs in (and trips a car over), and what it throws up when
// a wheel slides or spins on it (tyre smoke off tarmac, a brown cloud off dirt,
// tan sand, clods of turf). A game says which surface is where; the car, the
// particles and the ground shader all read the same table.

import type { Ground } from "./ground.ts";

/** What a sliding or spinning wheel kicks up. */
export type Kick = "smoke" | "dust" | "sand" | "turf" | "gravel" | "spray";

export interface Surface {
  readonly name: string;
  /** Grip as a share of dry tarmac. */
  readonly grip: number;
  /** How much it catches a tyre skating sideways (0 slides, 1 a kerb's face): see Ground.trip. */
  readonly trip: number;
  /** What a wheel throws up on it, and that cloud's colour (0..255). */
  readonly kick: Kick;
  readonly colour: readonly [number, number, number];
  /** Rolling drag it adds (a share of the car's weight): soft ground bogs a car down. */
  readonly drag: number;
}

const surface = (name: string, grip: number, trip: number, kick: Kick, colour: readonly [number, number, number], drag = 0): Surface => ({ name, grip, trip, kick, colour, drag });

/** The common surfaces. A game can make its own (ice, mud, wet cobbles) with the same fields. */
export const SURFACES = {
  tarmac: surface("tarmac", 1, 0, "smoke", [214, 214, 222]),
  wet: surface("wet", 0.72, 0, "spray", [190, 205, 220]),
  kerb: surface("kerb", 0.92, 0.8, "smoke", [214, 214, 222]),
  pavement: surface("pavement", 0.85, 0.05, "smoke", [200, 200, 205]),
  gravel: surface("gravel", 0.62, 0.35, "gravel", [150, 145, 135], 0.04),
  dirt: surface("dirt", 0.66, 0.55, "dust", [140, 104, 70], 0.03),
  sand: surface("sand", 0.5, 0.45, "sand", [214, 186, 132], 0.09),
  grass: surface("grass", 0.58, 0.7, "turf", [96, 110, 60], 0.02),
} as const satisfies Record<string, Surface>;

/**
 * A Ground from a height function and a surface function (what's under a world point). The surface is asked where
 * each tyre touches; `memo` metres of rounding (default 0.5) lets neighbouring asks reuse an answer -- a surface query
 * can be a road-field lookup, and a car asks it four wheels times eight sub-steps a frame.
 */
export function surfaceGround(height: (x: number, z: number) => number, surfaceAt: (x: number, z: number) => Surface, memo = 0.5): Ground & { surface(x: number, z: number): Surface } {
  let kx = Number.NaN, kz = Number.NaN, last: Surface = SURFACES.tarmac;
  const cache = new Map<number, Surface>();
  const at = (x: number, z: number): Surface => {
    const qx = Math.round(x / memo), qz = Math.round(z / memo);
    if (qx === kx && qz === kz) return last;
    const key = qx * 131071 + qz;
    let s = cache.get(key);
    if (!s) {
      if (cache.size > 4096) cache.clear();
      s = surfaceAt(qx * memo, qz * memo);
      cache.set(key, s);
    }
    kx = qx; kz = qz; last = s;
    return s;
  };
  return { height, grip: (x, z) => at(x, z).grip, trip: (x, z) => at(x, z).trip, drag: (x, z) => at(x, z).drag, surface: at };
}
