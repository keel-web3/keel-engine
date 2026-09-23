// Plans as worlds: a building's solids at a level of detail, and a block's
// buildings merged into one world (one mesh, one draw, one look).

import type { BakeBox, BakeCapsule, BakeWorld } from "@keel-engine/bake";
import type { BuildingPlan, Lod, Solid } from "./types.ts";

/** A plan's solids that still show at a level of detail (0 is closest: everything), in one layer. */
export function worldOf(plan: BuildingPlan, lod: Lod = 0, layer: 0 | 1 = 0): BakeWorld {
  return blockWorld([plan], lod, layer);
}

/** A block's buildings (layer 0) or its street layer (1: parks, plazas, murals) as one world. */
export function blockWorld(plans: readonly { readonly solids: readonly Solid[] }[], lod: Lod = 0, layer: 0 | 1 = 0): BakeWorld {
  const boxes: BakeBox[] = [], capsules: BakeCapsule[] = [];
  for (const p of plans) for (const s of p.solids) {
    if (s.lod < lod || (s.layer ?? 0) !== layer) continue;
    if (s.box) boxes.push(s.box);
    if (s.capsule) capsules.push(s.capsule);
  }
  return { boxes, capsules };
}
