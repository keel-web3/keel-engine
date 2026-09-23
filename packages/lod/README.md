# `@keel-engine/lod`

Level of detail for generated worlds. Module `keel/lod@0.1.0` (`kind: "runtime"`,
needs nothing). Pure and GL-free: it reads a view structurally, so keel/bake's
`Projection` satisfies `LodView` without an import. Design:
[`docs/LOD_SYSTEM.md`](../../docs/LOD_SYSTEM.md).

```ts
import { createLodSelector, rangesOf, gridTiles, createWorkQueue, pixelError } from "@keel-engine/lod";
import type { LodNode, LodPick, LodView } from "@keel-engine/lod";
```

- **Nested prefixes.** A node's levels are prefixes of one index buffer, coarse
  first (keel/bake `layeredMesh`): `levels = [c0, c1, c2]`, finest first. A level
  is an index count; `rangesOf(pick, node)` gives the `[offset, count]` ranges a
  draw needs (`MeshDraw.range`), and a transition dithers only the delta.
- **Selection.** `createLodSelector({ tau, band, dwell, fade, triangles })`:
  the coarsest level whose dropped detail is under `tau` pixels, measured from
  the true (radial) distance to the node's box -- turning never changes a
  level. Each step's error is one or more terms; a `roof` term is invisible
  from under its parapet, a `wall` term thins from above. Hysteresis band,
  dwell, dithered fades (refine at once, coarsen late), and a triangle budget
  that coarsens the farthest nodes first.
- **Tiles.** `gridTiles(boxes, n)`: nodes into an n x n grid for a far pass.
- **Work queue.** `createWorkQueue({ blocking, labels })`: jobs in stages,
  nearest first, run a budget of work units at a time (never a clock), with
  progress over the blocking stages for a loader.

Tests: `test/lod.test.ts`; vectors: `test/vectors.mjs`.
