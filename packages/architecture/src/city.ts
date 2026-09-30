// A whole city's buildings: every lot planned, grouped by block, each block
// with the look its district gives it -- what a game turns into one mesh and
// one draw a block.

import type { City, CityHeight } from "@keel-engine/city";
import { blockVariant, lookOf } from "./paint.ts";
import { lakeLevel, lakeOf } from "./commons.ts";
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
  const steps = planCitySteps(cat, city, height);
  for (;;) { const next = steps.next(); if (next.done) return next.value; }
}

/** The same city plan, pausing after small batches of lots and blocks for a loading screen. */
export function* planCitySteps(cat: Catalogue, city: City, height?: CityHeight): Generator<number, BlockPlan[], void> {
  const byBlock = new Map<number, BuildingPlan[]>();
  const firstDistrict = new Map<number, number>();
  let made = 0;
  for (const lot of city.lots) {
    let plans = byBlock.get(lot.block);
    if (!plans) { plans = []; byBlock.set(lot.block, plans); firstDistrict.set(lot.block, lot.district); }
    plans.push(planLot(cat, city, lot, height));
    if (++made % 16 === 0) yield made / Math.max(1, city.lots.length) * 0.9;
  }
  const zoning = zoningOf(cat, city);
  const out: BlockPlan[] = [];
  let grouped = 0;
  for (const [block, plans] of byBlock) {
    const district = city.districts[firstDistrict.get(block)!]!;
    const c = zoning.commons.get(block);
    // (The lake's level: a hand over the highest ground under it, as its lots lay it.)
    const lake = c?.water ? lakeOf(c, height ? lakeLevel(c, height)[1] : 0.1) : null;
    out.push({ key: `${cat.version}|${city.site.seed}|block${block}`, block, look: lookOf(cat, district, blockVariant(cat, city.site.seed, district, block)), plans, ...(lake ? { lake } : {}) });
    if (++grouped % 8 === 0) yield 0.9 + grouped / byBlock.size * 0.1;
  }
  return out;
}
