// How each prop is placed and what a game may do with it: its footprint,
// where it goes (against a wall, in a corner, on the floor, flat on it), if
// it blocks the way, breaks, opens, gives light (and what kind). keel/worldgen's
// dungeon dressing places by these rules; a game reads the flags.

/** Where a prop goes. */
export type PropPlacement = "wall" | "corner" | "floor" | "centre" | "decal";

export interface PropInfo {
  /** Its footprint radius, metres (what it keeps clear of). */
  readonly radius: number;
  readonly place: PropPlacement;
  /** It stands in the way (the path grid avoids it). */
  readonly block: boolean;
  readonly destructible: boolean;
  readonly openable: boolean;
  /** The light it gives (the renderer's kinds), if any. */
  readonly light: "torch" | "sconce" | "brazier" | "candle" | "crystal" | "fungus" | "key" | null;
}

const P = (radius: number, place: PropPlacement, block: boolean, extra: Partial<PropInfo> = {}): PropInfo => ({ radius, place, block, destructible: false, openable: false, light: null, ...extra });

export const PROPS: Readonly<Record<string, PropInfo>> = {
  torch: P(0.2, "wall", false, { light: "torch" }),
  brazier: P(0.45, "floor", true, { light: "brazier" }),
  candelabra: P(0.3, "floor", false, { light: "candle" }),
  crystals: P(0.5, "floor", true, { light: "crystal" }),
  mushrooms: P(0.3, "floor", false, { light: "fungus" }),
  barrel: P(0.4, "corner", true, { destructible: true }),
  crate: P(0.45, "corner", true, { destructible: true }),
  urn: P(0.3, "wall", true, { destructible: true }),
  chest: P(0.5, "wall", true, { openable: true }),
  bones: P(0.5, "decal", false),
  "skull-pile": P(0.45, "corner", false),
  stain: P(0.6, "decal", false),
  rubble: P(0.6, "floor", false),
  cobweb: P(0.3, "corner", false),
  chains: P(0.2, "wall", false),
  banner: P(0.2, "wall", false),
  roots: P(0.2, "wall", false),
  bookshelf: P(0.9, "wall", true),
  table: P(1.0, "centre", true, { light: "candle" }),
  "weapon-rack": P(0.8, "wall", true),
  cage: P(0.6, "floor", true),
  altar: P(0.9, "centre", true, { light: "candle" }),
  sarcophagus: P(1.2, "centre", true),
  tombstone: P(0.4, "floor", true),
  throne: P(1.1, "centre", true),
  statue: P(0.5, "wall", true),
  stalagmite: P(0.5, "floor", true),
  anvil: P(0.45, "floor", true),
  furnace: P(0.9, "wall", true, { light: "brazier" }),
  "ore-cart": P(0.6, "floor", true, { destructible: true }),
  key: P(0.35, "centre", false, { light: "key" }),
};

/** A prop's info (a default for an id this pack hasn't got). */
export const propInfo = (id: string): PropInfo => PROPS[id] ?? P(0.4, "floor", false);
