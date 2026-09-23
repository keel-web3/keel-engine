// What a city is made of, as data: the site it stands on, its road graph
// (keel/road), its blocks and the lots in them. A lot is a promise, not a
// building: an oriented box, a height band and a use -- a buildings pack reads
// lots (building:lot) and decides what stands there.

import type { RoadClass, RoadGraph } from "@keel-engine/road";

/** What lies past the city's edge on one bearing. */
export type EdgeTrait = "ocean" | "mountain" | "river" | "desert" | "forest";

export interface CitySite {
  readonly seed: string;
  /** The slab's side (m), centred on the origin. */
  readonly size: number;
  /** The buildable core's radius (m): flat, where the grid is. */
  readonly core: number;
  /** The grid's turn (rad) and its spacing (m): arterials this far apart. */
  readonly yaw: number;
  readonly spacing: number;
  /** What's beyond the edge, and on which bearing (rad, frame convention: 0 is +z). */
  readonly edges: readonly { readonly trait: EdgeTrait; readonly bearing: number }[];
  /**
   * Where it sits in a world of cities (one minted city a cell, each `size` across), or null for a city on its own. Its
   * roads out to its neighbours leave through gates on its borders that belong to the BORDER, not to either city -- so
   * two neighbours' roads always meet, whoever minted them.
   */
  readonly cell: CellRef | null;
}

/** A city's cell in a world grid: the world's seed and the cell's coordinates. */
export interface CellRef {
  readonly world: string;
  readonly x: number;
  readonly z: number;
}

/** A road out of the city: where it crosses the border (city frame) and which side it's on. */
export interface Gate {
  readonly x: number;
  readonly z: number;
  readonly side: "west" | "east" | "south" | "north";
}

/** An oriented box on the ground: centre, half extents along its own right and forward, and its turn. */
export interface Obb {
  readonly x: number;
  readonly z: number;
  readonly hw: number;
  readonly hd: number;
  readonly yaw: number;
}

export type LotUse = "tower" | "block" | "shop" | "garage" | "yard";

/** A road a lot touches, and which face of its box fronts it: 0 +z, 1 +x, 2 -z, 3 -x (its own frame). */
export interface LotFront {
  readonly edge: number;
  readonly face: 0 | 1 | 2 | 3;
  readonly cls: RoadClass;
}

export interface Lot {
  readonly obb: Obb;
  /** Storeys, low and high: what a building here may rise to. */
  readonly height: readonly [number, number];
  readonly use: LotUse;
  /** The road it fronts (an edge id): where its door and its drive face. */
  readonly frontage: number;
  /** Which block it's in. */
  readonly block: number;
  /** Its stable name, "block:k:row" -- the seed of everything built here (never its place in the list). */
  readonly key: string;
  /** Which district it's in (City.districts). */
  readonly district: number;
  /** Every road it touches (a corner lot has two), and the face of its box that fronts each. */
  readonly fronts: readonly LotFront[];
  /** Its neighbours along the frontage (lot keys, or null at the block's ends): party walls. */
  readonly left: string | null;
  readonly right: string | null;
}

/** What a district is: downtown towers, the old brick quarter, the docks... what reads different at a glance. */
export type DistrictKind = "core" | "midtown" | "oldtown" | "industrial" | "docks" | "strip" | "suburb";

/** A district: a run of neighbouring blocks of one kind, and its character. */
export interface District {
  readonly id: number;
  readonly kind: DistrictKind;
  /** How built up (0..1), how rich (0..1), and how run down: the share of its lots gone derelict (0..1). */
  readonly density: number;
  readonly wealth: number;
  readonly decay: number;
  /** Its neon's hues (degrees): two to four of the synthwave set. */
  readonly hues: readonly number[];
  readonly blocks: readonly number[];
}

/** A city block: the land between roads, as a four-cornered outline (x, z pairs, round the way). */
export interface Block {
  readonly id: number;
  readonly corners: readonly (readonly [number, number])[];
  /** Its lattice cell (i, j): two blocks share one where a street splits it. */
  readonly cell: readonly [number, number];
}

/**
 * What a game wants a city to keep a place for: a speedway, a plaza, a port. Asked for BEFORE the lots are laid,
 * which is the whole point -- land claimed first is land the city grows around.
 */
export interface LandmarkWant {
  /** What it is, in the game's own words ("speedway"). */
  readonly kind: string;
  /** What it is called, for a sign and a map. */
  readonly name: string;
  /** How much ground it needs: half its length along the road it fronts, half its depth back from it (m). */
  readonly halfL: number;
  readonly halfD: number;
  /** The districts it belongs in, if it is fussy. */
  readonly districts?: readonly DistrictKind[];
  /** The smallest road it will front ("highway" being the biggest, "alley" the smallest). */
  readonly road?: RoadClass;
}

/**
 * A place the city was built around: its ground is its own, no lot was laid in it, and the road meets it at a gate.
 * A game stands its scene on this rather than searching the finished city for somewhere that looks free.
 */
export interface Landmark {
  readonly kind: string;
  readonly name: string;
  /** Its ground: where it stands, how big it is, and which way it faces (along the road it fronts). */
  readonly obb: Obb;
  /** The block it took. Nothing was built there. */
  readonly block: number;
  /** Where its road meets it. */
  readonly gate: { readonly edge: number; readonly x: number; readonly z: number; readonly yaw: number };
}

/** A game's asks of its city's layout, beyond the seed (the same asks everywhere the city is built, or its roads differ). */
export interface CityOptions {
  /** How many bridges to carry its freeway over its sea: 0 none; absent, the seed decides (rarely any). */
  readonly bridges?: number;
}

export interface City {
  readonly site: CitySite;
  readonly graph: RoadGraph;
  /** The arterial grid's junctions by grid coordinates "i,j" (node ids): what routes and districts are laid on. */
  readonly lattice: ReadonlyMap<string, number>;
  readonly blocks: readonly Block[];
  readonly lots: readonly Lot[];
  readonly districts: readonly District[];
  /** The places the city was laid out around (empty when none were asked for). */
  readonly landmarks: readonly Landmark[];
}
