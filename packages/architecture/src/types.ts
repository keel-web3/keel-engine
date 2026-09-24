// What a building generator reads and what it makes, as data. A CATALOGUE
// (a pack's content: archetypes, facade styles, materials, district looks and
// the district x archetype weights) goes in with a city's lot; a PLAN comes
// out -- the solids that stand there, by the slot each is painted with and the
// coarsest level of detail it still shows at, and the footprint a car hits.

import type { BakeBox, BakeCapsule, PaintScreen, WallDetail } from "@keel-engine/bake";
import type { City, DistrictKind, Obb } from "@keel-engine/city";
import type { Finish } from "@keel-engine/core";
import type { RoadClass } from "@keel-engine/road";
import type { TrafficSignSpec } from "./street/roadside.ts";
import type { SlotName, StreetSlotName } from "./slots.ts";

export type Range = readonly [number, number];
/** Weights by name (a missing name is weight 0). Order matters only as data order: draws walk it as written. */
export type Weights<K extends string> = Readonly<Partial<Record<K, number>>>;

export type CrownKind = "flat" | "parapet" | "stepped" | "spire" | "mast" | "fins" | "pyramid" | "helipad" | "slant";
export type RoofKind = "flat" | "gable" | "sawtooth";

/** A massing operation (keel/architecture massing.ts): composed in order, each building on the masses before it. */
export type MassOp =
  | { readonly op: "extrude" }
  | { readonly op: "podium"; readonly storeys: Range }
  | { readonly op: "tower"; readonly inset: Range; readonly tiers?: Range; readonly slab?: boolean }
  | { readonly op: "setbacks"; readonly tiers: Range; readonly step: Range }
  | { readonly op: "wings"; readonly shapes: readonly ("L" | "U")[]; readonly depth: Range }
  | { readonly op: "cantilever"; readonly out: Range }
  | { readonly op: "rows"; readonly units: Range }
  | { readonly op: "nave" }
  | { readonly op: "canopy" }
  | { readonly op: "decks" }
  | { readonly op: "diner" }
  // (Car culture and the roadside: business.ts.)
  | { readonly op: "showroom" }
  | { readonly op: "bigbox"; readonly mall?: boolean }
  | { readonly op: "drivethru" }
  | { readonly op: "bays"; readonly doors: Range; readonly kind: BayKind }
  | { readonly op: "carwash" }
  | { readonly op: "parking" }
  | { readonly op: "forecourt"; readonly vehicle: VehicleKind; readonly fill: Range }
  | { readonly op: "trailers" }
  // (Civic, transport and utilities: civic.ts.)
  | { readonly op: "campus"; readonly kind: "school" | "college" }
  | { readonly op: "hall"; readonly tops: Weights<"dome" | "clock"> }
  | { readonly op: "stadium" }
  | { readonly op: "cemetery" }
  | { readonly op: "station" }
  | { readonly op: "containers" }
  | { readonly op: "substation" }
  | { readonly op: "waterTower" }
  | { readonly op: "tanks"; readonly kind: "farm" | "gasometer" }
  | { readonly op: "stacks"; readonly count: Range }
  // (A block given over whole to a park or a lake: commons.ts.)
  | { readonly op: "commons" }
  | { readonly op: "park"; readonly art: Weights<ArtKind> }
  | { readonly op: "plaza"; readonly art: Weights<ArtKind> }
  | { readonly op: "roof"; readonly kinds: Weights<RoofKind> }
  | { readonly op: "crown"; readonly kinds: Weights<CrownKind> }
  | { readonly op: "cornice" }
  | { readonly op: "bands"; readonly every: Range };

export type SignKind = "storefront" | "blade" | "awning" | "rooftop" | "billboard" | "pole" | "ledCrown" | "ledEdges" | "marquee" | "floodlight" | "fascia" | "cross" | "flags";
/** What a service building's bays are for: a garage's cars, a tuner's, a fire station's engines, a depot's buses. */
export type BayKind = "garage" | "tuning" | "fire" | "bus";
/** What stands parked on a lot. */
export type VehicleKind = "car" | "patrol" | "ambulance" | "truck" | "bus";
export interface SignRule { readonly kind: SignKind; readonly chance: number }
export type RoofItem = "waterTower" | "hvac" | "bulkhead" | "antenna" | "chimney";
export interface RoofRule { readonly kind: RoofItem; readonly chance: number; readonly count?: Range }

/** A facade's control attributes, chosen once a building (so it's coherent while its neighbours differ). */
export interface FacadeStyle {
  readonly id: string;
  /** Bay width and storey height (m): the metric window grid. */
  readonly bay: Range;
  readonly storey: Range;
  /** The shopfront's height (m), 0 for none. */
  readonly groundH: Range;
}

export interface Archetype {
  readonly id: string;
  /** What lot it needs: frontage and depth (m), a corner, a road of one of these classes. */
  readonly fits: { readonly minFront: number; readonly minDepth: number; readonly corner?: boolean };
  readonly storeys: Range;
  /** Front, side and rear setbacks (m) off the lot's box. */
  readonly setbacks: readonly [number, number, number];
  readonly massing: readonly MassOp[];
  readonly facades: readonly string[];
  /** Its walls' slot, by weight. */
  readonly materials: Weights<SlotName>;
  readonly signs: readonly SignRule[];
  readonly roof: readonly RoofRule[];
  /**
   * How much likelier (or not) it is by where its lot is: by the class of the most important road it faces (a
   * dealership wants the arterial, not the side street), and on a corner. A missing entry is 1.
   */
  readonly affinity?: { readonly roads?: Readonly<Partial<Record<RoadClass, number>>>; readonly corner?: number };
  /** Never next door to another of its kind (two burger joints side by side), whatever its walls. */
  readonly solo?: boolean;
  /**
   * A stoop: its floor this far over the pavement at its door (m, low and high), up steps from the ground in front --
   * a walk-up's, a house's, a church's. Without one, the floor is level with the pavement: a shop, a garage, a lobby.
   */
  readonly stoop?: Range;
}

/**
 * A building a city gets one of (or one a district): the lot is chosen before the draws -- its biggest that fits, or
 * the one its seeded draw ranks first -- in these district kinds, fronting one of these roads.
 */
export interface UniqueRule {
  readonly archetype: string;
  readonly per: "city" | "district";
  readonly districts: readonly DistrictKind[];
  /** The biggest lot that fits (a stadium), rather than a seeded one. */
  readonly largest?: boolean;
  /** Per district: only in a district of at least this many lots. */
  readonly minLots?: number;
  readonly roads?: readonly RoadClass[];
}

export type WindowType = "punched" | "tall" | "ribbon" | "curtain" | "arched" | "boarded";
/** What one slot is painted as: a colour and finish, and for a wall its windows (type, pane fill, lit share, warmth). */
export interface MaterialSpec {
  readonly hue: number;
  readonly chroma: number;
  readonly light: number;
  readonly span: number;
  readonly finish: Finish;
  readonly windows?: { readonly type: WindowType; readonly fill: number; readonly share: number; readonly warm: boolean };
  /** How hard it burns at night (bloom, 0..1): neon, LEDs, backlit signs. */
  readonly bloom?: number;
  /** A neon slot takes its hue from the district. */
  readonly neon?: boolean;
  readonly mirror?: number;
  /** Its own dither screen and reach (keel/bake PAINT_SCREENS; default bayer4 and 0.6 for walls, 0.5 otherwise). */
  readonly screen?: PaintScreen;
  readonly dither?: number;
  /** A painted pattern (a mural): its marks wear the district's next neon hue. */
  readonly pattern?: { readonly kind: "stripes" | "camo" | "checks" | "spots"; readonly freq: number; readonly angle: number; readonly width: number };
  /**
   * A wall's surface between its windows (keel/bake WallDetail: brick, panel, corrugated, siding, stucco, glass, stone),
   * its sill streaks and foot grime -- the grime deepened by the district's dirt. Walls with a facade grid only.
   */
  readonly detail?: WallDetail;
}

/** A variant of a district kind's look: how much of it is lit, how warm, how dirty. */
export interface LookSpec { readonly share: number; readonly warm: number; readonly dirt: number }

export interface Catalogue {
  /** Part of every cache key: a new catalogue is a new city. */
  readonly version: string;
  readonly archetypes: readonly Archetype[];
  readonly facades: Readonly<Record<string, FacadeStyle>>;
  readonly materials: Readonly<Partial<Record<SlotName, MaterialSpec>>>;
  readonly looks: Readonly<Record<DistrictKind, readonly LookSpec[]>>;
  /** District kind -> archetype id -> weight. */
  readonly weights: Readonly<Record<DistrictKind, Readonly<Record<string, number>>>>;
  /** One lot a district is its landmark: this archetype (a plaza with its piece), if the catalogue has it. */
  readonly landmark?: string;
  /** Per district kind, the chance a building's blank side wall onto a road carries a mural. */
  readonly murals?: Readonly<Partial<Record<DistrictKind, number>>>;
  /** Buildings a city (or a district) has one of, placed first: a stadium, a hospital, a fire station a district. */
  readonly uniques?: readonly UniqueRule[];
  /** What takes the corner lot on an arterial (the gas station on the junction), by district kind, if it fits. */
  readonly corners?: { readonly archetype: string; readonly chance: Readonly<Partial<Record<DistrictKind, number>>> };
  /**
   * Whole blocks given over to a park (the chance a block is one, by district kind; every city has one), and the
   * chance a city has a lake -- one to three neighbouring blocks of water in a ring of park. `archetype` runs the
   * block's lots (its massing: a commons op).
   */
  readonly commons?: { readonly archetype: string; readonly park: Readonly<Partial<Record<DistrictKind, number>>>; readonly lake: number };
  /**
   * Zone blending: a lot within `reach` metres of a district of another kind draws that kind's archetypes too, and
   * its storeys lean to that kind's, by up to `max` at the border (default 80 m, 0.55).
   */
  readonly blend?: { readonly reach: number; readonly max: number };
}

/** 2: always (the masses); 1: at mid range (crowns, big signs, LED); 0: close only (rooftop kit, small signs). */
export type Lod = 0 | 1 | 2;
/** A solid, at the coarsest level of detail it still shows at, in its layer (0 the building look, 1 the street look). */
export interface Solid { readonly lod: Lod; readonly layer?: 0 | 1; readonly box?: BakeBox; readonly capsule?: BakeCapsule }

export type Condition = "pristine" | "worn" | "derelict";
export interface BuildingPlan {
  readonly key: string;
  readonly archetype: string;
  readonly condition: Condition;
  /** Its walls' slot. */
  readonly wall: SlotName;
  readonly solids: readonly Solid[];
  /** Collision: one box a mass at the ground (world). */
  readonly footprint: readonly Obb[];
  /** Its highest point (m). */
  readonly height: number;
  /**
   * The level its ground floor (or a park's lawn) stands at (m), and the foot of the foundation under it: on a city's
   * ground the floor is at the highest ground under it (never buried) and the foundation reaches the lowest (never
   * floating). Both 0 on flat ground.
   */
  readonly base?: number;
  readonly foot?: number;
  /** On a city's ground: its door (the middle of its front) and the pavement's height abreast of it. */
  readonly door?: Door;
  /** Lamps it lights the ground with (a park's lanterns): world x, z and reach (m). */
  readonly lights?: readonly LightSpot[];
  /** Small things standing on it a car could hit (a park's trees and benches): collision candidates. */
  readonly props?: readonly PropSpot[];
  /** Plants to draw as foliage sprites (a game's own: packs/foliage): trees, bushes, flowers, grass. */
  readonly plants?: readonly PlantSpot[];
  /** Advertising faces it carries (billboards, roof signs): what an ad registry fills. */
  readonly ads?: readonly AdSlotSpec[];
  /** Water it lays (a lake's share on this lot): the surface's box on the ground (world) and its level (m). */
  readonly water?: readonly WaterSpec[];
  /** Points other systems tie to: a substation's gantry tops, where the power lines come in (world). */
  readonly anchors?: readonly AnchorSpot[];
}

/**
 * A building's door (world x, z: the middle of its front), the ground a step out of it (what its floor was set by: a
 * hair over it, or a stoop up from it) and the pavement's height abreast of it on the road it faces.
 */
export interface Door { readonly x: number; readonly z: number; readonly ground: number; readonly pave: number }

export interface WaterSpec { readonly obb: Obb; readonly y: number }
export interface AnchorSpot { readonly kind: "substation"; readonly x: number; readonly y: number; readonly z: number }

/**
 * A plant to draw where it stands (world; y its foot), its kind (a street tree in its grate, a park's tree, a palm, a
 * conifer, a bush, a hedge, flowers, grass), its size (1: as drawn) and a seed for which of its kind's shapes.
 */
export type PlantKind = "street" | "tree" | "palm" | "conifer" | "bush" | "hedge" | "flowers" | "grass";
export interface PlantSpot { readonly kind: PlantKind; readonly x: number; readonly y: number; readonly z: number; readonly scale: number; readonly seed: number }
/** An advertising face: a stable id (lot key and a number), its kind, size (m), middle (world) and the way it faces (ground plane). */
export interface AdSlotSpec {
  readonly id: string;
  readonly kind: "billboard" | "backlit" | "shelter";
  readonly size: readonly [number, number];
  readonly pos: readonly [number, number, number];
  readonly normal: readonly [number, number];
}

/** A lamp's pool of light on the ground: where (world) and how far it reaches (m). */
export interface LightSpot { readonly x: number; readonly z: number; readonly r: number }
/** A small thing standing in the street a car can hit: its kind, where (world), its radius (m), and whether it breaks. */
export interface PropSpot { readonly sign?: TrafficSignSpec; readonly kind: PropKind; readonly x: number; readonly z: number; readonly r: number; readonly breaks: boolean }
/**
 * Where a street prop's own solids are in the street's meshes: its chunk's key (StreetChunk.key) and the run of that
 * chunk's solids that are its, [from, to) -- so a game can take a knocked-over prop out of the baked chunk and draw it
 * (or its wreck) on its own. A prop drawn only as a plant (a street tree) has an empty run.
 */
export interface PropPart { readonly chunk: string; readonly from: number; readonly to: number }

export type ArtKind = "none" | "fountain" | "pond" | "statue" | "sculpture" | "obelisk" | "neonRing" | "giantStatue";
export type PropKind = "lamp" | "bench" | "bin" | "hydrant" | "busStop" | "newsBoxes" | "planter" | "bollards" | "tree" | "signal" | "signpost" | "art"
  // (The roadside's infrastructure: utility poles, transmission pylons and poles, sign gantries' legs, billboards'
  // monopoles, radio masts, highway signs and cameras.)
  | "pole" | "pylon" | "gantry" | "billboard" | "mast" | "sign" | "camera";
export type FurnitureKind = "bench" | "bin" | "hydrant" | "busStop" | "newsBoxes" | "planter" | "bollards" | "tree";
/** One kind of furniture along a district's pavements: about every `every` metres, on the kerb side or the inner side. */
export interface FurnitureRule { readonly kind: FurnitureKind; readonly every: number; readonly chance: number; readonly roads: readonly RoadClass[]; readonly plant?: PlantKind }
export type LampKind = "lantern" | "arm" | "mast" | "globe";
export interface LampStyle {
  readonly kind: LampKind;
  /** Pole height and arm reach (m), heads a pole, and the head's glow slot. */
  readonly height: number;
  readonly arm: number;
  readonly heads: number;
  readonly head: StreetSlotName;
  /** Its pool of light on the ground (m). */
  readonly reach: number;
}

/** The street catalogue: lamps by district, their spacing by road, furniture rules, the street look's materials. */
export interface StreetCatalogue {
  readonly version: string;
  readonly lampStyles: Readonly<Record<string, LampStyle>>;
  /** Which lamp style each district kind lights its streets with; `highway` for the highways. */
  readonly lamps: Readonly<Record<DistrictKind | "highway", string>>;
  /** Metres between lamps along a road, by class (0: none), staggered side to side (a highway's masts one side, then the other). */
  readonly spacing: Readonly<Record<RoadClass, number>>;
  /** Maximum repeat spacing for road signs, per direction (m); zero omits that road class. */
  readonly signEvery?: Readonly<Partial<Record<RoadClass, number>>>;
  /**
   * The widest crown each kind of plant is drawn with at scale 1 (m): a street tree is set back from the kerb (or drawn
   * smaller) so its crown never hangs over the carriageway. Kinds not listed are taken as 2 m.
   */
  readonly crowns?: Readonly<Partial<Record<PlantKind, number>>>;
  readonly furniture: Readonly<Record<DistrictKind, readonly FurnitureRule[]>>;
  readonly materials: Readonly<Partial<Record<StreetSlotName, MaterialSpec>>>;
  /** A district's lamp style by road class, where it differs from `lamps` (globes on midtown's side streets, cobras on a suburb's arterials). */
  readonly lampsBy?: Readonly<Partial<Record<DistrictKind, Readonly<Partial<Record<RoadClass, string>>>>>>;
  /** The roadside's infrastructure (none if absent): power, utility poles, the highway's furniture, billboards, masts. */
  readonly infra?: InfraSpec;
}

/**
 * The roadside's infrastructure, as a city's engineers would put it up -- all of it outside the carriageway, a function of
 * the city's seed.
 */
export interface InfraSpec {
  /**
   * The high-voltage line: lattice pylons round the ring highway's outside, `offset` m past its kerb, every `spacing` m,
   * `height` m tall, conductors sagging `sag` of each span. `whole`: the chance it follows the whole ring (else a sector);
   * `radial`: the chance of a second line from the ring out to the city's edge. With substations (planStreets' `grid`)
   * a line of steel poles runs in from the ring along the arterials to the nearest.
   */
  readonly power?: { readonly spacing: Range; readonly offset: number; readonly height: number; readonly sag: number; readonly whole: number; readonly radial: number };
  /** Wooden utility poles along these districts' roads (of these classes), at the pavement's back edge, `every` m, wires pole to pole. */
  readonly poles?: { readonly districts: readonly DistrictKind[]; readonly roads: readonly RoadClass[]; readonly every: number; readonly height: number; readonly transformer: number };
  /**
   * The highway's furniture: guard rails on the outside of any bend tighter than `railCurve` (1/m), a sign gantry on
   * every ring stretch longer than `gantryMin` m (exits named by district), sound walls `wallHeight` m tall where it
   * passes these districts, billboards on monopoles every `billboards` m, speed signs past every junction, a camera
   * on a share `cameras` of the stretches.
   */
  readonly highway?: { readonly railCurve: number; readonly gantryMin: number; readonly soundWalls: readonly DistrictKind[]; readonly wallHeight: number; readonly billboards: Range; readonly cameras: number };
  /** Radio masts on the city's high ground (lattice, a red beacon on top): how many and how tall (m). */
  readonly masts?: { readonly count: Range; readonly height: Range };
  /**
   * Ground cover (grass, flowers, bushes, hedges -- plants the game draws as sprites) round the feet of the roadside's
   * poles, pylons and signs, behind its walls and rails, along the pavements' back edges and the highway's shoulders,
   * and in the gaps between lots: how thick by district (0..1; `highway` for its verges), and the districts that tend
   * theirs (flowers and hedges; elsewhere it's weeds and scrub).
   */
  readonly cover?: { readonly density: Readonly<Partial<Record<DistrictKind | "highway", number>>>; readonly lush: readonly DistrictKind[] };
}

/** A board with words on it (an exit gantry's): an id, its text, size (m), middle (world) and facing (ground plane). */
export interface StreetSign {
  readonly id: string;
  readonly text: string;
  readonly size: readonly [number, number];
  readonly pos: readonly [number, number, number];
  readonly normal: readonly [number, number];
}

/** What the generator reads of a city (a hand-authored level can hand it lots too). */
export type CityLike = Pick<City, "site" | "districts" | "lots">;

/** A district's look: its kind's variant, its neon hues, how lit, warm and dirty -- one look table entry. */
export interface DistrictLook {
  readonly key: string;
  readonly kind: DistrictKind;
  readonly hues: readonly number[];
  readonly share: number;
  readonly warm: number;
  readonly dirt: number;
  readonly wealth: number;
}
