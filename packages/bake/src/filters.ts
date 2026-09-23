// Paint filters: how the light a mesh already carries meets the palette.
//
// Pass 1 (mesh.ts MESH_GFS) lights the world exactly as it always has -- sun,
// shadow map, every point and spot light, the tint ramps, the emission a part
// carries this frame. A filter changes NONE of that. It sits in pass 2, where a
// pixel's shade picks an entry on its paint's ramp, and changes only how that
// choice is made: a few hard bands instead of a smooth fall, a silhouette with
// its middle dithered away, an unlit wireframe.
//
//   sr.drawMeshes(view, draws, { ...style, filter: "toon" });
//   sr.drawMeshes(view, draws, { ...style, markFilter: "ghost" });   // + MeshDraw.marked on the ghosts
//
// Because it is a pass-2 look and not a material, it costs a generated object
// nothing: a car, a building, a tree or a sign designed tomorrow wears it with
// no new data, no re-bake and no per-object work. Turning every filter off is
// byte-for-byte the picture the engine drew before they existed.
//
// TWO AT A TIME. One frame carries the picture's filter and one more, worn by
// the draws that ask for it (MeshDraw.marked) -- enough for a gallery whose
// known cars are painted and whose unknown ones are ghosts. A third filter is a
// second drawMeshes call.
//
// Pure and deterministic: filterUniforms() is the only thing the renderer
// copies into GL, and every bound is settled here rather than in the shader.

/** A filter by name, one of your own, `true` for "toon", or nothing for the painted look. */
export type MeshFilterInput = MeshFilter | FilterName | boolean | undefined;

/** The filters the paint pass knows. Their ids are the shader's -- 0 is "no filter". */
export type FilterKind = "cel" | "ghost";

/** A named look: a filter kind with its parameters already chosen. */
export type FilterName = "soft" | "toon" | "comic" | "ghost" | "wraith";

export interface MeshFilter {
  /** Which filter: how the shade meets the ramp at all. */
  readonly kind: FilterKind;
  /** The cel's own parameters (ignored by other kinds). */
  readonly cel?: CelParams;
  /** The ghost's own parameters (ignored by other kinds). */
  readonly ghost?: GhostParams;
}

/**
 * The cel: a cartoon light. A surface's light lands in a few HARD bands instead of falling smoothly down its ramp,
 * with a movable terminator, a highlight on the lit band, a rim along the silhouette and a fatter ink line.
 */
export interface CelParams {
  /** How many hard light bands a surface falls into, 2..8 (default 3: shadow, mid, light). */
  readonly bands?: number;
  /** Where light turns to shadow, 0.05..0.95 (default 0.5): higher puts more of the surface in shadow. */
  readonly terminator?: number;
  /** How crisp a band edge is, 0..1 (default 1): 1 leaves no dither across it at all, 0 dithers as usual. */
  readonly hardness?: number;
  /** A hard highlight on the lit band, in palette entries (default 0.8). */
  readonly specular?: number;
  /** A rim along the silhouette, in palette entries (default 1): where the surface turns away from the eye it climbs its ramp. */
  readonly rim?: number;
  /** How much of the edge the rim covers, 0..1 (default 0.38): the facing under which a surface counts as turned away. */
  readonly rimWidth?: number;
  /**
   * Where the DARKEST band sits on the ramp, 0..0.9 (default 0.26). Banding collapses a surface the sun never
   * reaches -- the back of a car, the inside of an arch -- onto one entry, and at 0 that entry is the bottom of the
   * ramp: black, whatever the paint. Lifting the floor keeps an unlit red panel dark RED. Raise it for fewer bands.
   */
  readonly floor?: number;
  /** A bounce light added to every surface before it is banded, 0..1 (default 0): lifts the whole thing, terminator and all. */
  readonly fill?: number;
  /** The ink line's thickness, 1..4 picture pixels (default 1, the classic one-pixel edge). */
  readonly ink?: number;
  /** A palette entry to ink with (default -1: the pixel's own ramp, `outline` entries darker, as always). */
  readonly inkEntry?: number;
}

/**
 * The ghost: a thing that is THERE but not yet known. Its silhouette holds -- the ink line stays whole, so the shape
 * reads at a glance -- while its middle dithers away to whatever is behind it, and what survives is drained toward
 * one cool entry rather than its own paint. A car in the gallery whose chain seed hasn't arrived is the case this
 * was built for: the collector sees a car-shaped absence, not the wrong car painted confidently.
 */
export interface GhostParams {
  /** How much of the middle survives, 0..1 (default 0.3): the dithered share of pixels the body keeps. */
  readonly body?: number;
  /** How solid the rim inside the silhouette is, 0..1 (default 1): the edge holds when the middle has gone. */
  readonly edge?: number;
  /** How far the surviving pixels are drained toward `entry`, 0..1 (default 0.8; 0 keeps the paint's own colour). */
  readonly drain?: number;
  /** The palette entry a ghost is drained toward (default -1: its own ramp, low down, so each paint keeps its hue). */
  readonly entry?: number;
  /** Rows shifted sideways now and then, in picture pixels (default 2; 0 for a still ghost). */
  readonly glitch?: number;
  /** How fast the ghost breathes and glitches, in Hz (default 0.7; 0 holds it still). */
  readonly rate?: number;
  /** The ink line's thickness, 1..4 picture pixels (default 1). */
  readonly ink?: number;
  /** A palette entry to ink the silhouette with (default -1: its own ramp darkened). */
  readonly inkEntry?: number;
}

/** The kind's id in the shader (0: no filter). */
export const FILTER_KIND: Readonly<Record<FilterKind, number>> = { cel: 1, ghost: 2 };

/**
 * The ready looks. `soft` bands a painted picture without flattening it; `toon` is the Saturday-morning one; `comic`
 * is ink and two tones. `ghost` is the gallery's stand-in; `wraith` is fainter still, for something barely there.
 */
export const FILTERS: Readonly<Record<FilterName, MeshFilter>> = {
  soft: { kind: "cel", cel: { bands: 4, terminator: 0.46, hardness: 0.55, specular: 0.4, rim: 0.6, floor: 0.18, ink: 1 } },
  toon: { kind: "cel", cel: { bands: 3, terminator: 0.5, hardness: 1, specular: 0.8, rim: 1, floor: 0.26, ink: 2 } },
  // (Two tones have nowhere to hide a dark side, so comic keeps the highest floor of the three.)
  comic: { kind: "cel", cel: { bands: 2, terminator: 0.54, hardness: 1, specular: 1.2, rim: 1.4, rimWidth: 0.45, floor: 0.36, ink: 3 } },
  ghost: { kind: "ghost", ghost: { body: 0.3, edge: 1, drain: 0.8, glitch: 2, rate: 0.7, ink: 1 } },
  wraith: { kind: "ghost", ghost: { body: 0.14, edge: 0.8, drain: 1, glitch: 3, rate: 1.2, ink: 1 } },
};

/**
 * The four vec4s the paint pass reads for one filter. `kind` is FILTER_KIND's id; a, b and c carry that kind's
 * parameters -- what they mean depends on the kind, and the shader reads only the ones its kind uses.
 */
export interface FilterUniforms {
  readonly kind: number;
  readonly a: readonly [number, number, number, number];
  readonly b: readonly [number, number, number, number];
  readonly c: readonly [number, number, number, number];
}

/** No filter: the painted look the engine has always drawn. */
export const FILTER_OFF: FilterUniforms = { kind: 0, a: [0, 0.5, 1, 0], b: [0, 1, -1, 0], c: [0, 0, 0, 0] };

const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
const entry = (v: number | undefined): number => Math.round(clamp(v ?? -1, -1, 65535));

/** A name, a filter of your own, or a bare `true` (= "toon"), as one filter -- null for none. */
export function resolveFilter(filter: MeshFilterInput): MeshFilter | null {
  if (filter === undefined || filter === false) return null;
  if (filter === true) return FILTERS.toon;
  if (typeof filter === "string") {
    if (!Object.hasOwn(FILTERS, filter)) throw new RangeError(`Unknown filter: ${filter}`);
    return FILTERS[filter];
  }
  if (!Object.hasOwn(FILTER_KIND, filter.kind)) throw new RangeError(`Unknown filter kind: ${String(filter.kind)}`);
  return filter;
}

/** The paint pass's uniforms for a filter. Pure: every bound is settled here, so the shader reads only numbers it can trust. */
export function filterUniforms(filter: MeshFilterInput): FilterUniforms {
  const f = resolveFilter(filter);
  if (!f) return FILTER_OFF;
  if (f.kind === "ghost") {
    const g = f.ghost ?? {};
    return {
      kind: FILTER_KIND.ghost,
      // (body, edge, drain, the entry drained toward)
      a: [clamp(g.body ?? 0.3, 0, 1), clamp(g.edge ?? 1, 0, 1), clamp(g.drain ?? 0.8, 0, 1), entry(g.entry)],
      // (the rim is the ghost's own edge share; ink px; ink entry; spare)
      b: [0, Math.round(clamp(g.ink ?? 1, 1, 4)), entry(g.inkEntry), 0],
      // (glitch px, rate Hz)
      c: [clamp(g.glitch ?? 2, 0, 16), clamp(g.rate ?? 0.7, 0, 8), 0, 0],
    };
  }
  const c = f.cel ?? {};
  const bands = Math.round(clamp(c.bands ?? 3, 2, 8));
  const hardness = clamp(c.hardness ?? 1, 0, 1);
  return {
    kind: FILTER_KIND.cel,
    a: [bands, clamp(c.terminator ?? 0.5, 0.05, 0.95), 1 - hardness, clamp(c.specular ?? 0.8, 0, 8)],
    b: [clamp(c.rim ?? 1, 0, 8), Math.round(clamp(c.ink ?? 1, 1, 4)), entry(c.inkEntry), clamp(c.rimWidth ?? 0.38, 0, 1)],
    c: [clamp(c.floor ?? 0.26, 0, 0.9), clamp(c.fill ?? 0, 0, 1), 0, 0],
  };
}
