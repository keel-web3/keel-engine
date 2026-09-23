// A whole city's buildings: every lot planned, grouped by block, each block
// with the look its district gives it -- what a game turns into one mesh and
// one draw a block.

import type { City, CityHeight } from "@keel-engine/city";
import { blockVariant, lookOf } from "./paint.ts";
import { lakeOf } from "./commons.ts";
import { planLot } from "./plan.ts";
import type { BuildingPlan, Catalogue, DistrictLook, WaterSpec } from "./types.ts";
import { zoningOf } from "./zoning.ts";

export interface BlockPlan {
  /** Stable: the catalogue's version, the city's seed and the block. */
  readonly key: string;
  readonly block: number;
  readonly look: DistrictLook;
  readonly plans: readonly BuildingPlan[];
  /** A lake's water, if the block is one: its surface's box (world) and its level -- for reflections and the ground. */
  readonly lake?: WaterSpec;
}

/** Every lot planned, grouped by block (on the city's height, if given). */
export function planCity(cat: Catalogue, city: City, height?: CityHeight): BlockPlan[] {
  const byBlock = new Map<number, BuildingPlan[]>();
  for (const lot of city.lots) { const l = byBlock.get(lot.block) ?? []; l.push(planLot(cat, city, lot, height)); byBlock.set(lot.block, l); }
  const zoning = zoningOf(cat, city);
  return [...byBlock].map(([block, plans]) => {
    const lots = city.lots.filter((l) => l.block === block), district = city.districts[lots[0]!.district]!;
    const c = zoning.commons.get(block);
    // (The lake's level: a hand over the highest of its lots' pads, as its lots lay it.)
    const lake = c?.water ? lakeOf(c, (height ? Math.max(...lots.map((l) => height.pad(l))) : 0) + 0.1) : null;
    return { key: `${cat.version}|${city.site.seed}|block${block}`, block, look: lookOf(cat, district, blockVariant(cat, city.site.seed, district, block)), plans, ...(lake ? { lake } : {}) };
  });
}
