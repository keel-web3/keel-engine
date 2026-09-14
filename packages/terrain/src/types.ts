// Terrain types and directions: the table every other part reads.
//
// A tile's TYPE is its ground (grass, sand, rock ...). Water is not a type:
// it is a layer (a surface level over a bed of any type), so a lake has a
// sandy bed and a river a muddy one. Lava is a type (it is ground that burns).
// Each type says how it paints (an OKLCH ramp for its tops, the type whose
// ramp paints its cliff faces, a texture), how it walks (a path cost, 0 for
// never) and where it wins at a border (priority: the higher one's edge lies
// over the lower one's tile).
//
// Directions follow the core frame: +z is "north" (up the picture at yaw 0),
// +x "east".
//   dir4   0 N (+z)   1 E (+x)   2 S (-z)   3 W (-x)
//   dir8   0 N  1 NE  2 E  3 SE  4 S  5 SW  6 W  7 NW   (dir4 d is dir8 2d)

/** How a type's surface is textured by the ground baker. */
export type TextureKind = "grass" | "dirt" | "sand" | "rock" | "snow" | "crystal" | "lava" | "ash" | "mud" | "cobble" | "path" | "ice" | "plain"
  | "flagstone" | "gravel" | "moss" | "clay" | "litter" | "brick" | "creep";

export interface TerrainTypeSpec {
  readonly name: string;
  /** At a border, the higher priority's edge lies over the lower one's tile. */
  readonly priority: number;
  /** Path cost per tile (1 is a road; 0: never walkable). */
  readonly cost: number;
  /** Buildings may stand on it. */
  readonly buildable?: boolean;
  /** Its tops' ramp in OKLCH: lightness from dark to light, chroma, hue. */
  readonly colour: { readonly L: readonly [number, number]; readonly C: number; readonly h: number };
  /** The type whose face ramp paints its cliff sides (default: "rock"). */
  readonly face?: string;
  readonly texture: TextureKind;
  /** Lifts its lightness (lava, crystal): emissive. */
  readonly glow?: number;
  /** Its surface cycles through its ramp (lava): the ground shader animates it. */
  readonly cycle?: boolean;
}

export interface TerrainType extends TerrainTypeSpec {
  readonly id: number;
  readonly buildable: boolean;
  readonly face: string;
  readonly glow: number;
  readonly cycle: boolean;
}

export interface TerrainTable {
  readonly list: readonly TerrainType[];
  /** By name; throws on an unknown one. */
  id(name: string | number): number;
  get(id: number): TerrainType;
  has(name: string): boolean;
}

/** The engine's default terrain types (append only: a type's id is its place). */
export const TERRAIN_TYPES: readonly TerrainTypeSpec[] = [
  { name: "grass", priority: 30, cost: 2, buildable: true, colour: { L: [0.3, 0.78], C: 0.13, h: 132 }, face: "dirt", texture: "grass" },
  { name: "dirt", priority: 20, cost: 2, buildable: true, colour: { L: [0.28, 0.7], C: 0.07, h: 62 }, face: "rock", texture: "dirt" },
  { name: "sand", priority: 15, cost: 3, buildable: true, colour: { L: [0.5, 0.92], C: 0.08, h: 88 }, face: "sandstone", texture: "sand" },
  { name: "rock", priority: 40, cost: 3, colour: { L: [0.26, 0.74], C: 0.02, h: 250 }, face: "rock", texture: "rock" },
  { name: "snow", priority: 50, cost: 3, buildable: true, colour: { L: [0.62, 0.98], C: 0.03, h: 235 }, face: "ice", texture: "snow" },
  { name: "crystal", priority: 45, cost: 3, colour: { L: [0.32, 0.9], C: 0.16, h: 300 }, face: "rock", texture: "crystal", glow: 0.12 },
  { name: "lava", priority: 60, cost: 0, colour: { L: [0.32, 0.9], C: 0.2, h: 38 }, face: "ash", texture: "lava", glow: 0.35, cycle: true },
  { name: "ash", priority: 25, cost: 2, buildable: true, colour: { L: [0.2, 0.55], C: 0.015, h: 30 }, face: "rock", texture: "ash" },
  { name: "mud", priority: 18, cost: 4, colour: { L: [0.22, 0.52], C: 0.05, h: 55 }, face: "dirt", texture: "mud" },
  { name: "road", priority: 70, cost: 1, colour: { L: [0.36, 0.78], C: 0.025, h: 70 }, face: "rock", texture: "cobble" },
  { name: "path", priority: 65, cost: 1, colour: { L: [0.36, 0.76], C: 0.06, h: 64 }, face: "dirt", texture: "path" },
  { name: "ice", priority: 48, cost: 3, colour: { L: [0.55, 0.95], C: 0.06, h: 215 }, face: "ice", texture: "ice" },
  { name: "sandstone", priority: 35, cost: 3, colour: { L: [0.35, 0.8], C: 0.07, h: 70 }, face: "sandstone", texture: "rock" },
  // (Worldgen's materials: dungeon floors and walls, forest floor, cracked clay, gravel beds, moss, a race's creep.)
  { name: "flagstone", priority: 62, cost: 1, buildable: true, colour: { L: [0.26, 0.7], C: 0.025, h: 250 }, face: "brick", texture: "flagstone" },
  { name: "gravel", priority: 22, cost: 2, buildable: true, colour: { L: [0.3, 0.74], C: 0.02, h: 60 }, face: "rock", texture: "gravel" },
  { name: "moss", priority: 32, cost: 2, buildable: true, colour: { L: [0.24, 0.66], C: 0.1, h: 138 }, face: "rock", texture: "moss" },
  { name: "clay", priority: 16, cost: 2, buildable: true, colour: { L: [0.38, 0.8], C: 0.075, h: 52 }, face: "sandstone", texture: "clay" },
  { name: "litter", priority: 26, cost: 2, buildable: true, colour: { L: [0.24, 0.62], C: 0.08, h: 70 }, face: "dirt", texture: "litter" },
  { name: "brick", priority: 55, cost: 0, colour: { L: [0.16, 0.56], C: 0.03, h: 265 }, face: "brick", texture: "brick" },
  { name: "creep", priority: 75, cost: 2, colour: { L: [0.18, 0.62], C: 0.13, h: 320 }, face: "ash", texture: "creep", glow: 0.04 },
];

/** A table over type specs (the defaults unless given): ids are places in the list. */
export function terrainTypes(specs: readonly TerrainTypeSpec[] = TERRAIN_TYPES): TerrainTable {
  const list: TerrainType[] = specs.map((s, id) => ({ ...s, id, buildable: s.buildable ?? false, face: s.face ?? "rock", glow: s.glow ?? 0, cycle: s.cycle ?? false }));
  if (list.length > 255) throw new RangeError("At most 255 terrain types.");
  const byName = new Map(list.map((t) => [t.name, t.id]));
  if (byName.size !== list.length) throw new RangeError("Terrain type names must be unique.");
  for (const t of list) if (!byName.has(t.face)) throw new RangeError(`Terrain type ${t.name}: its face "${t.face}" is not a type.`);
  return {
    list,
    id(name) {
      if (typeof name === "number") { if (!list[name]) throw new RangeError(`No terrain type #${name}.`); return name; }
      const id = byName.get(name);
      if (id === undefined) throw new RangeError(`No terrain type "${name}" (${list.map((t) => t.name).join(", ")}).`);
      return id;
    },
    get(id) { const t = list[id]; if (!t) throw new RangeError(`No terrain type #${id}.`); return t; },
    has: (name) => byName.has(name),
  };
}

export const DX4 = [0, 1, 0, -1] as const;
export const DZ4 = [1, 0, -1, 0] as const;
export const DX8 = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const DZ8 = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export type Dir4 = 0 | 1 | 2 | 3;
export const DIR4_NAMES = ["n", "e", "s", "w"] as const;
/** The opposite of a dir4. */
export const opposite4 = (d: number): Dir4 => ((d + 2) & 3) as Dir4;

/** Tile flags (a byte per tile). */
export const FLAG = Object.freeze({
  /** A ramp: a wedge rising one step toward its rampDir. */
  RAMP: 1,
  /** A bridge deck crosses it (at the tile's deck level, along its rampDir axis). */
  BRIDGE: 2,
  /** Nothing walks here (a building, a wall): set by the level. */
  BLOCKED: 4,
  /** Nothing may be built here. */
  NOBUILD: 8,
  /** Carved by a river (the generator's mark; the editor shows it). */
  RIVER: 16,
});

/** A tile's water level when it has none. */
export const WATER_NONE = -32768;
