// A city's climate: the one vegetation zone everything green in it comes from -- its street trees, its parks, its
// verges and the forests out to the horizon. One climate a city, so a palm never stands next to a spruce: a boreal
// town is spruce, fir and pine; a warm coast is palms and jacarandas; a desert town is palo verde, joshua trees and
// cactus. Drawn from the site's edge traits and its seed (pure: the same seed is the same climate everywhere), and
// the altitude rules that go with it (conifers only above a height, no trees past the treeline or on snow).

import type { CitySite } from "./types.ts";
import { drawsFor } from "./site.ts";

/** The climates a city can have. */
export const CLIMATES = ["temperate", "boreal", "subtropical", "mediterranean", "arid"] as const;
export type Climate = (typeof CLIMATES)[number];

/** What a climate asks of the land's height (m): conifers only above one height, nothing above another. */
export interface ClimateAltitude {
  /** Above this, only the climate's conifers (or its hardy species) stand. */
  readonly conifersAbove: number;
  /** Above this, nothing grows (the region's snow starts round 430 m). */
  readonly treeline: number;
}

const ALTITUDE: Readonly<Record<Climate, ClimateAltitude>> = {
  temperate: { conifersAbove: 200, treeline: 420 },
  boreal: { conifersAbove: 0, treeline: 380 },
  subtropical: { conifersAbove: 260, treeline: 440 },
  mediterranean: { conifersAbove: 240, treeline: 430 },
  arid: { conifersAbove: 300, treeline: 450 },
};

/** A climate's altitude rules. */
export const climateAltitude = (c: Climate): ClimateAltitude => ALTITUDE[c];

/**
 * The site's climate -- leaning warm and coastal (palms read as the game's night drive), without touching the site's
 * own edge traits. A coast is subtropical (palms, jacaranda) most of the time, now and then mediterranean (cypress,
 * stone pine, olive); only forest behind it makes a cool wet coast. A desert edge is arid unless the sea is there too
 * (then often a warm coast). Inland: mountains or forest are temperate or boreal, a river valley temperate or warm.
 */
export function climateOf(site: CitySite): Climate {
  const D = drawsFor(site.seed, "climate"), u = D.u("zone");
  const has = (t: string): boolean => site.edges.some((e) => e.trait === t);
  if (has("ocean")) {
    if (has("desert")) return u < 0.45 ? "subtropical" : u < 0.7 ? "mediterranean" : "arid";
    if (has("forest")) return u < 0.35 ? "subtropical" : u < 0.8 ? "temperate" : "boreal";
    if (has("mountain")) return u < 0.55 ? "subtropical" : u < 0.85 ? "mediterranean" : "temperate";
    return u < 0.8 ? "subtropical" : u < 0.93 ? "mediterranean" : "temperate";
  }
  if (has("desert")) return u < 0.2 ? "subtropical" : "arid";
  if (has("river")) return u < 0.35 ? "subtropical" : u < 0.8 ? "temperate" : "mediterranean";
  if (has("mountain")) return u < 0.55 ? "temperate" : "boreal";
  if (has("forest")) return u < 0.6 ? "temperate" : "boreal";
  return "temperate";
}
