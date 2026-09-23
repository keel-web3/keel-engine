// The district look's 32 slots: what each part of a building is painted as.
// A block is one mesh and one look; a building's variety is which of these
// slots its parts choose -- red brick or blue glass, warm storefront or cool,
// which of the district's four neons. A catalogue gives each slot its colours.

export const SLOT = {
  redBrick: 0, brownBrick: 1, limestone: 2, buffBrick: 3, concreteLight: 4, concreteDark: 5,
  glassBlue: 6, glassGreen: 7, glassBronze: 8, stucco: 9, siding: 10,
  trim: 11, roof: 12, metal: 13, shopWarm: 14, shopCool: 15,
  neonA: 16, neonB: 17, neonC: 18, neonD: 19, led: 20, backlit: 21, billboard: 22, beacon: 23,
  boarded: 24, derelict: 25, sodium: 26, corrugated: 27, officeGrid: 28, stoneArched: 29, timber: 30, darkGlass: 31,
} as const;
export type SlotName = keyof typeof SLOT;
export const SLOT_NAMES = Object.keys(SLOT) as SlotName[];
/** The four neon slots, in the order a district's hues fill them. */
export const NEON_SLOTS: readonly SlotName[] = ["neonA", "neonB", "neonC", "neonD"];

/**
 * The street look's 32 slots: what a block's street layer -- lamps, furniture, parks, plazas, art -- is painted as.
 * A block draws two meshes (its buildings, its street), each through its district's look for that layer.
 */
export const STREET_SLOT = {
  pole: 0, lampWarm: 1, lampCool: 2, lampSodium: 3, wood: 4, binGreen: 5, hydrant: 6, shelterGlass: 7,
  frame: 8, adPanel: 9, newsBox: 10, planter: 11, foliage: 12, foliageAlt: 13, trunk: 14, grass: 15,
  paving: 16, water: 17, jet: 18, plinth: 19, bronze: 20, sculpture: 21, housing: 22, signalRed: 23,
  signalAmber: 24, signalGreen: 25, signBlue: 26, bollard: 27, muralA: 28, muralB: 29, gravel: 30, artNeon: 31,
} as const;
export type StreetSlotName = keyof typeof STREET_SLOT;
export const STREET_SLOT_NAMES = Object.keys(STREET_SLOT) as StreetSlotName[];

/** Any slot a solid can wear: a building's or the street's. */
export type AnySlot = SlotName | StreetSlotName;
/** 0: the building layer; 1: the street layer. */
export type Layer = 0 | 1;
export const layerOf = (s: AnySlot): Layer => (s in STREET_SLOT ? 1 : 0);
export const slotIndex = (s: AnySlot): number => (s in STREET_SLOT ? STREET_SLOT[s as StreetSlotName] : SLOT[s as SlotName]);
