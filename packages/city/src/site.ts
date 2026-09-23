// Where a city stands: its size, its flat buildable core, the way its grid
// runs, and what lies past its edges -- the sea on one bearing, mountains on
// another. And the seeded draws every other part of the generator makes its
// choices with (hashed per name, so adding a choice never moves another).

import { hash2 } from "@keel-engine/core";
import type { CellRef, CitySite, EdgeTrait, Gate } from "./types.ts";

/** Seeded draws: `u` is 0..1, `flat` -1..1, both by name (and up to two indices). */
export interface Draws {
  u(tag: string, i?: number, j?: number): number;
  flat(tag: string, i?: number, j?: number): number;
}

const fnv = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h | 0;
};

export function drawsFor(seed: string, part: string): Draws {
  const base = fnv(`keel-city|${seed}|${part}`);
  const u = (tag: string, i = 0, j = 0): number => hash2(fnv(tag) ^ Math.imul(i, 0x2c1b3c6d), j, base);
  return { u, flat: (tag, i, j) => u(tag, i, j) * 2 - 1 };
}

const TRAITS: readonly EdgeTrait[] = ["ocean", "mountain", "river", "desert", "forest"];

/**
 * The gates on a cell's borders. A border is keyed by the two cells it lies between (never by either city's seed), so
 * the gates the city on one side finds are exactly the gates its neighbour finds: one or two a border, well in from the
 * corners.
 */
export function gatesOf(cell: CellRef, size: number): Gate[] {
  const border = (key: string): number[] => {
    const D = drawsFor(cell.world, `border|${key}`);
    const count = D.u("count") < 0.6 ? 1 : 2;
    return count === 1 ? [D.flat("at0") * 0.3] : [-0.12 - 0.2 * D.u("at0"), 0.12 + 0.2 * D.u("at1")];
  };
  const h = size / 2, out: Gate[] = [];
  // (A vertical border at the cell's west edge is shared with the cell to its west, keyed by the eastern cell's x.)
  for (const t of border(`v|${cell.x}|${cell.z}`)) out.push({ x: -h, z: t * size, side: "west" });
  for (const t of border(`v|${cell.x + 1}|${cell.z}`)) out.push({ x: h, z: t * size, side: "east" });
  for (const t of border(`h|${cell.x}|${cell.z}`)) out.push({ x: t * size, z: -h, side: "south" });
  for (const t of border(`h|${cell.x}|${cell.z + 1}`)) out.push({ x: t * size, z: h, side: "north" });
  return out;
}

/** The site for a seed: a 1.5 km slab, a core most of it, a grid turned and spaced, one or two edge traits. */
export function siteOf(seed: string, size = 1500, cell: CellRef | null = null): CitySite {
  const D = drawsFor(seed, "site");
  const core = size * 0.5 * (0.72 + 0.1 * D.u("core"));
  const yaw = D.flat("yaw") * 0.5;
  const spacing = 170 + 70 * D.u("spacing");
  const count = D.u("edges") < 0.55 ? 1 : 2;
  const first = Math.floor(D.u("trait0") * TRAITS.length);
  const edges = [{ trait: TRAITS[first]!, bearing: D.u("bearing0") * Math.PI * 2 }];
  if (count === 2) {
    // (A second trait, different from the first, roughly across the city from it.)
    const second = (first + 1 + Math.floor(D.u("trait1") * (TRAITS.length - 1))) % TRAITS.length;
    edges.push({ trait: TRAITS[second]!, bearing: edges[0]!.bearing + Math.PI * (0.6 + 0.8 * D.u("bearing1")) });
  }
  return { seed, size, core, yaw, spacing, edges, cell };
}
