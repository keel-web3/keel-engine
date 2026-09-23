// Levels of detail as ONE mesh: a generated thing's solids in runs, coarsest
// first ([what level 2 draws][what level 1 adds][what level 0 adds]), so each
// level is a PREFIX of the index buffer -- a switch is an index count
// (MeshDraw.range), a cross-fade dithers only the delta, and the whole chain
// costs what its finest level costs. keel/lod picks the level; this lays it out.
//
//   const m = layeredMesh([lod2, only1, only0]);          // runs: the solids each level ADDS
//   sr.setMesh(key, m);
//   const levels = m.layers.map((l) => l.indices).reverse(); // [c0, c1, c2] for a LodNode
//   sr.drawMeshes(view, [{ mesh: key, matrix, look, range: [0, levels[1]] }]);

import type { BakeBox, BakeCapsule, BakeWorld } from "./bake.ts";
import { bodySpace, lookMesh, meshBounds, mergeMeshes, worldsBounds } from "./mesh.ts";
import type { LookMesh, LookMeshOptions } from "./mesh.ts";

/** Where a run ends: the index and vertex counts of every run up to and including it. */
export interface MeshLayer { readonly indices: number; readonly vertices: number }

export interface LayeredMesh extends LookMesh {
  /** Per run, in order: the prefix that draws it and every run before it. */
  readonly layers: readonly MeshLayer[];
}

/**
 * Runs of solids as one mesh in order (each run its own parts, as mergeMeshes keeps them), with each run's end. Body
 * space is measured over ALL the runs (or `bounds`), so a coarse level and a fine one paint alike.
 */
export function layeredMesh(runs: readonly BakeWorld[], options: LookMeshOptions = {}): LayeredMesh {
  const parts = runs.map((w) => lookMesh(w, options));
  const merged = mergeMeshes(parts);
  const layers: MeshLayer[] = [];
  let indices = 0, vertices = 0;
  for (const p of parts) { indices += p.indices.length; vertices += p.positions.length / 3; layers.push({ indices, vertices }); }
  const bodies = bodySpace(merged.positions, options.bounds ?? meshBounds(merged.positions));
  return { ...merged, bodies, layers };
}

/** A layered mesh cut to its first `count` runs: a coarse level on its own (a far tile's share), nothing copied twice. */
export function prefixMesh(mesh: LayeredMesh, count: number): LookMesh {
  const layer = mesh.layers[Math.max(0, Math.min(mesh.layers.length, count) - 1)];
  const nv = count > 0 && layer ? layer.vertices : 0, ni = count > 0 && layer ? layer.indices : 0;
  return {
    positions: mesh.positions.slice(0, nv * 3), normals: mesh.normals.slice(0, nv * 3), attrs: mesh.attrs.slice(0, nv * 4),
    bodies: mesh.bodies.slice(0, nv * 3), indices: mesh.indices.slice(0, ni),
    ...(mesh.facade ? { facade: mesh.facade.slice(0, nv) } : {}),
  };
}

/**
 * How big a solid reads (m): the middle of its three extents. A long thin cornice is its thickness, a sign its height,
 * a rooftop unit its size -- what a coarser level loses when it drops it (keel/lod's geometric error).
 */
export function solidSize(solid: BakeBox | BakeCapsule): number {
  if ("r" in solid) return 2 * solid.r;
  const e = [solid.h[0] ?? 0, solid.h[1] ?? 0, solid.h[2] ?? 0].sort((a, b) => a - b);
  return 2 * e[1]!;
}

/** The biggest solid in a world by solidSize (0 when empty): the error of dropping all of it. */
export function worldError(world: BakeWorld): number {
  let e = 0;
  for (const b of world.boxes ?? []) e = Math.max(e, solidSize(b));
  for (const b of world.wedges ?? []) e = Math.max(e, solidSize(b));
  for (const c of world.capsules ?? []) e = Math.max(e, solidSize(c));
  return e;
}

/** A cached fine mesh and a prebuilt capsule approximation. All levels come from the SAME posed world. */
export interface MeshDetail {
  readonly mesh: string;
  readonly lod: { readonly mesh: string; readonly error: number };
}
/** The owner controls cache lifetime/refcounts; hit callbacks must not run, as with REDLINE's holdMesh. */
export type MeshHolder = (key: string, make: () => LookMesh) => string;

/**
 * Prepare reusable high/low geometry for any generated capsule-based object. Boxes/wedges, slots, part IDs and
 * paint space stay intact; capsules use a sagitta tolerance. No generation happens in the frame's LOD selector.
 * Use layeredMesh instead when a generator knows which ornaments can be dropped (e.g. buildings).
 * `key` must name this world's geometry/pose, full resolution and paint-space bounds; the coarse recipe is versioned independently.
 */
export function prepareMeshDetail(key: string, world: () => BakeWorld, hold: MeshHolder, chordError: number, options: Omit<LookMeshOptions, "chordError"> = {}): MeshDetail {
  if (!(chordError > 0) || !Number.isFinite(chordError)) throw new RangeError("chordError must be finite and positive");
  let posed: BakeWorld | undefined, fine: LookMesh | undefined;
  const pose = () => posed ??= world();
  const mesh = hold(key, () => fine = lookMesh(pose(), options));
  const coarse = hold(`${key}:capsule-lod1:${options.around ?? 12}:${options.rings ?? 3}:${chordError}`, () => lookMesh(pose(), {
    ...options, bounds: options.bounds ?? (fine ? meshBounds(fine.positions) : worldsBounds([pose()], options)), chordError,
  }));
  // Both polygon meshes approximate the analytic surface, so reserve both error bounds when replacing one.
  return { mesh, lod: { mesh: coarse, error: 2 * chordError } };
}
