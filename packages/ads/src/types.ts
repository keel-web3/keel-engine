// What an ad slot is and what fills it. A slot is a face in a game's world
// (a billboard, a roof sign, a bus shelter's panel) with a stable id; a
// creative is what shows there -- its picture (by content id), its words, and
// where it links. Sources answer which creative a slot shows.

export type AdKind = "billboard" | "wallscape" | "screen" | "backlit" | "pole" | "shelter";

export interface AdSlot {
  /** Stable across builds of the same world: what a registry leases. */
  readonly id: string;
  readonly kind: AdKind;
  /** Width and height (m). */
  readonly size: readonly [number, number];
  /** Its middle (world), and the way its face looks (ground plane). */
  readonly pos: readonly [number, number, number];
  readonly normal: readonly [number, number];
}

export interface AdCreative {
  /** A content id for its picture (IPFS CIDv1), or null for a house ad drawn in the engine. */
  readonly cid: string | null;
  /** Its words: a brand, a line. */
  readonly title: string;
  readonly line?: string;
  /** Where a click on it goes: http(s) only (safeHref); null for nowhere. */
  readonly href: string | null;
  /** Its colour (hue, degrees): a house ad's brand colour. */
  readonly hue?: number;
}

/** Where creatives come from: what each slot shows at a time (epoch seconds), or null for nothing from this source. */
export interface AdSource {
  resolve(slots: readonly AdSlot[], at: number): Promise<ReadonlyMap<string, AdCreative | null>>;
}
