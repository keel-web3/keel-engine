// A city from a seed: its site, its roads, its districts, blocks and lots -- all of it a
// function of the seed alone, the same on every machine.

import { layRoads } from "./arterials.ts";
import { cutBlocks } from "./blocks.ts";
import { siteOf } from "./site.ts";
import type { CellRef, City, CityOptions, LandmarkWant } from "./types.ts";

/**
 * A city from its seed -- and, in a world of cities, its cell (so its roads meet its neighbours').
 *
 * `wants` are the places the city is to be built AROUND: each takes a whole block and no lot is laid inside it.
 * They are claimed before the lots because that is the only order in which it works -- a landmark chosen after the
 * fact has the city's lamp posts and trees standing in the middle of it.
 */
export function generateCity(seed: string, size = 1500, cell: CellRef | null = null, wants: readonly LandmarkWant[] = [], options: CityOptions = {}): City {
  const site = siteOf(seed, size, cell);
  const net = layRoads(site, options);
  const { blocks, lots, districts, landmarks } = cutBlocks(site, net, wants);
  return { site, graph: net.graph, lattice: net.lattice, blocks, lots, districts, landmarks };
}
