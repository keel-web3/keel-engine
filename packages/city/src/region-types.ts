import type { RallyStage, RegionVenues } from "./venues.ts";

/** What the land is, on one bearing. */
export type RegionLand = "plains" | "farmland" | "hills" | "mountains" | "valley" | "forest" | "desert" | "ocean" | "sprawl";
export interface RegionSector { readonly bearing: number; readonly land: RegionLand; readonly backdrop: number; /** A sea not on the site's own edge starts this far past it (m). */ readonly shore?: number }

export interface Lake { readonly x: number; readonly z: number; readonly r: number; readonly level: number }
export interface River { readonly x: readonly number[]; readonly z: readonly number[]; readonly width: number; readonly level: number }
export interface RegionWater {
  /** The sea's level (m), and its bearing; null for an inland city. */
  readonly sea: { readonly bearing: number; readonly level: number } | null;
  readonly lakes: readonly Lake[];
  readonly river: River | null;
}

/** An "industrial" town: works, yards and a rail spur, a through road down its middle (drift and rally country). */
export type SettlementKind = "metro" | "city" | "town" | "village" | "industrial";
/** A place on the horizon: where, how far it sprawls, how tall it stands, and its own seed (its skyline's). */
export interface Settlement { readonly kind: SettlementKind; readonly x: number; readonly z: number; readonly y: number; readonly r: number; readonly top: number; readonly seed: string }

export type SiteKind =
  | "airport" | "windfarm" | "solar" | "powerplant" | "quarry" | "mast" | "farm" | "orchard" | "truckstop" | "drivein"
  | "golf" | "marina" | "lighthouse" | "park" | "trailers" | "motel" | "billboard" | "substation" | "dam"
  /** The venues (region.venues has their courses): a dirt track, a drift park, a demolition-derby bowl. */
  | "dirttrack" | "driftpark" | "derby"
  /** A tank farm by the industry, its pipelines in region.pipes. */
  | "tankfarm";
/** A thing standing out in the region: what, where (and its ground), which way it faces, how big (m), its seed. */
export interface RegionSite { readonly kind: SiteKind; readonly x: number; readonly z: number; readonly y: number; readonly yaw: number; readonly size: number; readonly seed: string; readonly tier?: number }

/** The airport: every city has one. Tier 0 a regional strip, 1 a city airport, 2 an international with two runways. */
export interface Airport {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  /** The runways' heading (rad) and length (m); a second runway runs parallel `spacing` m off the first (tier 2). */
  readonly yaw: number;
  readonly length: number;
  readonly runways: number;
  readonly spacing: number;
  readonly tier: 0 | 1 | 2;
}

/** The sky: the wind the clouds drift on (m/s), how much of it is cloud (0..1), and the clouds at their start. */
export interface RegionSky {
  readonly wind: readonly [number, number];
  readonly cover: number;
  readonly clouds: readonly { readonly x: number; readonly z: number; readonly y: number; readonly r: number; readonly seed: number }[];
}

/** "dirt": the rally stage (region.rally), graded into the land, a ford where it meets the river. */
export type RegionRoadKind = "freeway" | "road" | "rail" | "dirt";
/** A road out in the region: its line every ~20 m, its deck's height there, its half width; `pier` where it's a viaduct. */
export interface RegionRoad {
  readonly kind: RegionRoadKind;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly y: Float64Array;
  readonly pier: Uint8Array;
  readonly half: number;
}
/**
 * A line across the land: its supports' feet (and the ground under each), in order. "pylon": a transmission line on
 * lattice towers; "pole": a distribution line on wooden poles; "pipe": a pipeline on its supports. `feed`: it brings
 * power into the city (a game's streets carry it on from its end nearest the city).
 */
export interface RegionLine { readonly kind: "pylon" | "pole" | "pipe"; readonly feed: boolean; readonly x: readonly number[]; readonly z: readonly number[]; readonly y: readonly number[] }

/** What the ground is at a point: its land, water over it (and the water's level), and what grows or lies on it. */
export interface RegionGround {
  readonly land: RegionLand;
  /** The water's surface here (m), or null on dry land. */
  readonly water: number | null;
  /** 0..1: trees, rock, snow, sand. */
  readonly forest: number;
  readonly rock: number;
  readonly snow: number;
  readonly sand: number;
  /** A field's id (farmland), or -1: fields are patches, each its own crop. */
  readonly field: number;
}

export interface Region {
  readonly seed: string;
  /** Where the region takes over from the city's own ground (m from the middle), and how far it reaches (m). */
  readonly edge: number;
  readonly reach: number;
  /** 0: the city stops at its ring and the country starts; 1: it sprawls on, towns strung along its freeways. */
  readonly sprawl: number;
  readonly sectors: readonly RegionSector[];
  readonly water: RegionWater;
  readonly settlements: readonly Settlement[];
  readonly sites: readonly RegionSite[];
  readonly roads: readonly RegionRoad[];
  readonly lines: readonly RegionLine[];
  readonly airport: Airport;
  /** Every city's three venues, out past its edge on levelled ground, a road to each gate (venues.ts). */
  readonly venues: RegionVenues;
  /** Every city's rally stage: a dirt road out through the country, start to finish (its road is region.roads' "dirt"). */
  readonly rally: RallyStage;
  /** The industrial town (a through road down its middle), in about half the regions; null elsewhere. */
  readonly industry: Settlement | null;
  /** Pipelines: from the tank farm to the works and away over the land. */
  readonly pipes: readonly RegionLine[];
  readonly sky: RegionSky;
  /** The bearings the freeways leave the city on (rad): where a game joins its ring to them. */
  readonly exits: readonly number[];
  /** The ground's height (m): the land, carved by the water, graded under the roads. */
  heightAt(x: number, z: number): number;
  ground(x: number, z: number): RegionGround;
}
