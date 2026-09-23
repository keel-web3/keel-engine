// Sidewalks: the band beside every road -- a kerb at the carriageway's edge,
// then the pavement, its width by the road's class (a highway has none, just
// its shoulder) -- and the crossings at every junction: a zebra across each
// road that meets it, set back from the junction's box. One table, read by
// whatever needs it: the lots (they start past the pavement), the ground's
// paint, the physics' surfaces, whoever places lamps and benches.

import type { RoadClass, RoadGraph } from "@keel-engine/road";

/** Per road class: the kerb's width and the pavement's beyond it (m, from the carriageway's edge). */
export const SIDEWALK: Readonly<Record<RoadClass, { readonly kerb: number; readonly slab: number }>> = {
  highway: { kerb: 0.6, slab: 0 },
  arterial: { kerb: 0.45, slab: 4.5 },
  street: { kerb: 0.4, slab: 3.2 },
  alley: { kerb: 0, slab: 1 },
  ramp: { kerb: 0.6, slab: 0 },
  freeway: { kerb: 0.6, slab: 1.6 },
};

/** How far from a road's centreline its sidewalk reaches (m): half width, kerb and pavement. */
export const sidewalkReach = (cls: RoadClass, half: number): number => half + SIDEWALK[cls].kerb + SIDEWALK[cls].slab;

/** How far a junction's box reaches from its node (m): the widest road there, and a margin (keel/road's junction). */
export function junctionRadius(g: RoadGraph, node: number): number {
  const i = g.nodes.findIndex((n) => n.id === node);
  const es = (g.at[i] ?? []).map((id) => g.edges[id]!);
  return es.length ? Math.max(...es.map((e) => e.half)) + 1.5 : 0;
}
