// The shapes keel/lod works on: a view (read structurally -- keel/bake's
// Projection has every field), a node of the hierarchy with its levels' prefix
// counts and what each coarser level drops, and what the selector hands back.

export type Vec3 = readonly [number, number, number];

/** What a view must offer (keel/bake's Projection has all of it). */
export interface LodView {
  readonly kind: "ortho" | "persp";
  /** The eye (perspective) or the view's centre (orthographic). */
  readonly origin: Vec3;
  readonly forward: Vec3;
  /** Orthographic: picture pixels a metre. */
  readonly k: number;
  /** Perspective: tan(fov / 2). */
  readonly tanHalfFov: number;
  /** The viewport's own height in pixels (a mirror passes its box, not the screen). */
  readonly height: number;
}

/**
 * Which way a dropped solid faces, for the view-angle term: `roof` stands on a roof (hidden from below the parapet),
 * `wall` is mounted on a facade (a sliver from straight above), `free` is anything else.
 */
export type Facing = "roof" | "wall" | "free";

/** One class of what a coarser level drops: how big (metres), which way it faces, and for a roof the parapet's height. */
export interface LodTerm {
  readonly error: number;
  readonly facing?: Facing;
  readonly roofY?: number;
}

/** One boundary of a chain (level i -> i + 1): what the coarser level drops, as one or more terms (the worst decides). */
export interface LodStep {
  readonly terms: readonly LodTerm[];
}

/** A node of the hierarchy (a lot, a block, a tile): its box and its levels' prefix counts. */
export interface LodNode {
  /** A recipe key: the same key always names the same bytes. */
  readonly key: string;
  readonly lo: Vec3;
  readonly hi: Vec3;
  /** Index count a level draws, finest first: [c0, c1, c2] with c0 >= c1 >= c2 (each a prefix of the one before). */
  readonly levels: readonly number[];
  /** steps[i]: what level i + 1 drops from level i. One fewer than levels. */
  readonly steps: readonly LodStep[];
}

export interface LodPolicy {
  /** The largest pixel error left undrawn (default 1: nothing a picture pixel wide is dropped). */
  readonly tau?: number;
  /** Hysteresis: coarsen only once the error is under tau / band (default 1.4). */
  readonly band?: number;
  /** Seconds a node holds a level after a switch before it coarsens again (default 0.3). */
  readonly dwell?: number;
  /** Seconds a dithered transition takes (default 0.25; 0 switches at once). */
  readonly fade?: number;
  /** The frame's triangle budget: the farthest nodes are coarsened first until it fits (default none). */
  readonly triangles?: number;
}

/** A node's state this frame: its level (drawn whole), and the delta to another level fading in or out. */
export interface LodPick {
  readonly key: string;
  readonly level: number;
  /** When fading: the other level, and 0..1 of the delta between the two drawn (a dithered screen). */
  readonly fading?: { readonly to: number; readonly t: number };
  /** Radial distance from the view to the node's box (m; 0 inside it). */
  readonly distance: number;
}

/** What to draw for a pick: index ranges [offset, count] into the node's one buffer, and how much of each is drawn. */
export interface LodRange {
  readonly offset: number;
  readonly count: number;
  /** 1: whole; less: a dithered fade of this much. */
  readonly fade: number;
}
