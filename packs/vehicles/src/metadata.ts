// A car as a token: its ONCHAIN attributes and its PAPERS, the Pixel Marine's
// two tiers (keel-pixel-pfps src/metadata.js). On chain: one chip per site,
// always there ("None" when bare), each the RAREST thing filed there; the
// score and tier; a few numbers. The papers: everything -- every trait at every
// site with how it varies, the dials, the handling -- the script's own tier,
// never the marketplace grid.

import type { Car } from "./car.ts";
import { SITES, TIER_LADDER, points } from "./traits.ts";

export interface Attribute { readonly trait_type: string; readonly value: string | number; readonly display_type?: string; readonly max_value?: number }

/** The token's onchain attributes (OpenSea-standard). */
export function onchainAttributes(car: Car): Attribute[] {
  const out: Attribute[] = [{ trait_type: "Class", value: car.archetype.toUpperCase() === "GT" ? "GT" : car.archetype[0]!.toUpperCase() + car.archetype.slice(1) }];
  for (const site of SITES) out.push({ trait_type: site, value: car.chips[site].name });
  // (The rare kind is its own chip too, shown not scored: it already carries the Paint site's odds.)
  if (car.paints.type) out.push({ trait_type: "Type", value: car.chips.Paint.name });
  const tier = TIER_LADDER.find((t) => t.id === car.tier)!;
  out.push(
    { trait_type: "Tier", value: tier.label },
    { display_type: "number", trait_type: "Rarity Score", value: car.score },
    { display_type: "number", trait_type: "Top Speed", value: Math.round(car.handling.topSpeed * 3.6) },
    { display_type: "boost_number", trait_type: "Grip", value: Math.round(car.handling.grip * 10) / 10 },
  );
  return out;
}

/** The papers: every site with everything at it (the rarest first), how each varies, and its points. */
export function papers(car: Car): { site: string; chip: string; points: number; lines: string[] }[] {
  return SITES.map((site) => {
    const here = car.traits.filter((t) => t.site === site).sort((a, b) => a.ppm - b.ppm);
    return {
      site, chip: car.chips[site].name, points: points(car.chips[site].ppm),
      lines: here.map((t) => `${t.name}${t.detail ? ` (${t.detail})` : ""} -- 1 in ${Math.max(1, Math.round(1_000_000 / Math.max(1, t.ppm)))}`),
    };
  });
}
