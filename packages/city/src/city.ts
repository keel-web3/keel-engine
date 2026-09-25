// A city from a seed: its site, its roads, its districts, blocks and lots -- all of it a
// function of the seed alone, the same on every machine.

import { layRoads } from "./arterials.ts";
import { cutBlocks } from "./blocks.ts";
import { siteOf } from "./site.ts";
import type { CellRef, City, CityOptions, CitySite, LandmarkWant } from "./types.ts";

/** The site a city stands on: the seed's own, with the edges a world of places asks for in place of its draw. */
export function citySite(seed: string, size = 1500, cell: CellRef | null = null, options: CityOptions = {}): CitySite {
  const site = siteOf(seed, size, cell);
  return options.edges ? { ...site, edges: options.edges.map((e) => ({ trait: e.trait, bearing: e.bearing })) } : site;
}

/**
 * A city from its seed -- and, in a world of cities, its cell (so its roads meet its neighbours').
 *
 * `wants` are the places the city is to be built AROUND: each takes a whole block and no lot is laid inside it.
 * They are claimed before the lots because that is the only order in which it works -- a landmark chosen after the
 * fact has the city's lamp posts and trees standing in the middle of it.
 */
export function generateCity(seed: string, size = 1500, cell: CellRef | null = null, wants: readonly LandmarkWant[] = [], options: CityOptions = {}): City {
  const site = citySite(seed, size, cell, options);
  const net = layRoads(site, options);
  const { blocks, lots, districts, landmarks } = cutBlocks(site, net, wants);
  return { site, graph: net.graph, lattice: net.lattice, blocks, lots, districts, landmarks, portals: net.portals };
}
