# `@keel-engine/scene`

Transforms, bounds, the shape kit, primitives as parts, asset registries and
front detection. Module `keel/scene@0.1.0` (`kind: "runtime"`, needs
`keel/core@^0.1`). Units are world units (NOCTURNES: 1 unit = 10 cm on a
desk); y is up, +z is a thing's front (the core frame).

```ts
import { createEntity, mk, sphere, aabbOf, raycast, detectFront } from "@keel-engine/scene";
import type { Entity, Part, Bounds, FrontResult } from "@keel-engine/scene";
```

A TypeScript port of the proof of concept's `src/scene` (and
`src/object/prims.js`, which front detection needs), names unchanged.
`config.js` (settings and locks) is not here: the world owns it.

- `test/poc-equality.test.ts` — every export against the proof of concept's JS:
  shapes, rotations and bounds, transforms and world SDFs, boxes, spheres,
  rays and contact, registries over 600 seeds, prims in every spelling, and
  whole `detectFront` results (reasons included) for 80 random assemblies and
  kit-built things at many yaws.
- `test/kit.test.ts` — the kit against NOCTURNES' `kit.js` / `parts.js`.
- `test/scene.test.ts`, `test/front.test.ts`, `test/frame.test.ts` — the proof
  of concept's own tests, ported.

| Module | What |
| --- | --- |
| `kit.ts` | shapes with bounds, booleans, rotations, parts (NOCTURNES `kit.js` / `parts.js`; `part` / `mk` / `lathePart` are the engine's own) |
| `entity.ts` | `createEntity`, transforms, world-space SDFs |
| `bounds.ts` | AABB, bounding sphere, overlap, SDF distance, rays, contact |
| `registry.ts` | realms of seeded builders; `makeAsset(seed, { realm, key })` |
| `prims.ts` | the renderer's and physics' solids (a turned box, a capsule) as parts |
| `front.ts` | which way a thing faces, from what it is made of |

## Concepts and types

| Type | What |
| --- | --- |
| `Bounds` / `BoundsLike` | `[x0, y0, z0, x1, y1, z1]` / its readonly form |
| `Mat3` / `Mat3Like` | 3x3 row-major rotation (local -> world) |
| `Sdf` | `(x, y, z, t?, V?) => distance` (negative inside) |
| `Shape` | `{ f: Sdf, b: Bounds }` — booleans keep bounds, so a model always knows its box |
| `PartSpec` / `Part` / `PartOf<S>` | `{ sdf, bounds, id?, name?, mat?, m? }` / a part with `id`, `name`, `mat`, `m` settled / a part keeping spec S's extra fields (`accent`, `dynamic`, `light`...) |
| `SdfPart` | anything with `sdf` and `bounds` |
| `Transform` / `TransformInput` | `{ pos, yaw, pitch, roll, scale }` / the same, every field defaulted |
| `Entity<P>` / `EntitySpec<P>` | `{ id, transform, parts: P[], tags, components }` |
| `Placed` / `Oriented` / `Body` | has a transform / has a rotation / has a transform and parts (what bounds read) |
| `Sphere` / `RayHit` | `{ center, radius }` / `{ t, point }` |
| `Realm` / `Registry` / `BuilderSpec` / `Asset` | the catalogues |
| `BoxSpec` / `CapsuleSpec` / `Prim` / `PartLike` | the two solids / what a prim part remembers / anything `toPart` takes |
| `FrontThing` / `FrontOptions` / `FrontResult` / `FrontEvidence` / `FrontSpec` / `Feature` / `UseCase` | front detection |

**Entity** — `world = pos + R(yaw, pitch, roll) * (scale * local)`,
`R = rotation(yaw, pitch, roll)` (`Ry * Rx * Rz`). Scale is uniform, so world
distance = local distance x scale and SDFs stay SDFs.

**Realm** — a weighted catalogue of builders `{ key, weight, role, build(S, ctx, info) }`.
Picks draw from a seeded stream exactly as NOCTURNES' `pickBuilder` does, so a
builder chosen by key leaves every later draw where it would have been.

## kit.ts

| Export | Signature | Returns |
| --- | --- | --- |
| `box` | `(c, h, r = 0.01)` | `Shape`; centre, half-extents, rounding |
| `cyl` | `(c, r, h, axis: Axis = "y", round = 0)` | `Shape`; half-length `h` along `axis` |
| `sphere` / `ellipsoid` / `capsule` | `(c, r)` / `(c, [rx, ry, rz])` / `(a, b, r)` | `Shape` |
| `torus` | `(c, R, r, axis = "y")` | `Shape`; ring normal to `axis` |
| `U` / `cut` / `inter` | `(...shapes)` / `(a, ...holes)` / `(a, b)` | union / subtraction / intersection (bounds of `a`) |
| `turned` | `(shape, m, pivot = [0,0,0])` | a shape rotated by `m` about `pivot` |
| `rotateBounds` / `unionBounds` / `ball` | `(b, m, pivot)` / `(boxes)` / `(x, y, z, r)` | `Bounds` |
| `rotation` / `mat3mul` / `rotateOnto` | `(yaw, pitch, roll)` / `(a, b)` / `(a, b)` | `Mat3` |
| `placed` / `rotatedSdf` | `(sdf, pos, m?)` / `(f, R)` | `Sdf` |
| `angleOf` | `(x, z)` | turns around y |
| `lowest` | `(parts)` | the parts' true lowest y (marched, then refined) |
| `part` | `(spec, materials = null)` | `PartOf<spec>`; `m` looked up in `materials[spec.mat]` |
| `mk` | `(shape, fields = {}, materials = null)` | a part from a shape |
| `lathePart` | `(spec: LatheSpec, materials = null)` | a surface-of-revolution part from `spec.points` `[[r, y], ...]` (`round`, `y` offset; `axisym: true`) |

```ts
const mug = cut(cyl([0, 0.4, 0], 0.3, 0.4), cyl([0, 0.5, 0], 0.25, 0.4));
const handle = box([0.36, 0.4, 0], [0.06, 0.18, 0.03]);
const parts = [mk(U(mug, handle), { name: "mug", mat: "ceramic" })];
```

## entity.ts

| Export | Signature | Returns |
| --- | --- | --- |
| `createEntity` | `({ id, transform, parts, tags, components })` | `Entity` (parts checked for `sdf` and 6-number `bounds`; tags sorted, unique) |
| `makeTransform` / `rotationOf` | `(t)` / `(transform)` | `Transform` / `Mat3Like` |
| `withTransform` / `withComponent` | `(entity, patch)` / `(entity, name, data)` | a copy (`undefined` data removes) |
| `hasTag` / `byTag` | `(entity, tag)` / `(entities, ...tags)` | boolean / filtered list |
| `toWorld` / `toLocal` | `(entity, p)` | a point through the transform / back |
| `dirToWorld` / `dirToLocal` | `(entity, d)` | a direction (rotation only) |
| `worldSdf` / `entitySdf` | `(entity, part)` / `(entity)` | world-space `Sdf` (one part / the union) |

## bounds.ts

| Export | Signature | Returns |
| --- | --- | --- |
| `localAabbOf` / `aabbOf` / `partAabbOf` | `(entity)` / `(entity)` / `(entity, part)` | `Bounds` (world: each part transformed, then unioned) |
| `transformAabb` | `(box, transform)` | a local box in the world |
| `sphereOf` | `(entity)` | `Sphere` around the world AABB |
| `overlaps` / `containsPoint` | `(a, b, margin = 0)` / `(a, p)` | boxes or entities; touching counts |
| `mergeAabb` | `(a, b)` | union box |
| `distance` / `nearestPart` / `normalAt` | `(entity, point, t = 0)` | signed distance / `{ part, distance }` / unit normal |
| `rayAabb` | `(o, d, box)` | `[tNear, tFar]` (t >= 0) or `null` |
| `raycast` | `(entity, o, d, { far, t, eps, steps })` | `RayHit` or `null`; `d` unit |
| `touching` | `(a, b, { margin = 0, n = 8, t = 0 })` | surfaces within `margin` (an `n`^3 sample grid: half a cell of slack) |

## registry.ts

| Export | Signature | Returns |
| --- | --- | --- |
| `createRegistry` | `()` | `Registry`: `defineRealm`, `realm`, `realms`, `pickRealm`, `makeAsset` (independent state) |
| `defineRealm` / `makeAsset` / `defaultRegistry` | | the default registry's |
| `roleMatches` | `(entryRole, wanted)` | "any"/null asks all; "both"/"any" serve all; arrays list roles |
| `ASSET_SLOTS` | | `{ REALM: 0, BUILD: 1 }` |

Realm: `add({ key, weight = 1, role = "both", build, keyOnly = false, ...meta })`
(chainable), `pick(S, role = "any", { key })` (the weighted draw always
happens first; the result stamps `key` on what it builds), `pool`, `entries`,
`keys`, `get`. `makeAsset(seed, opts)` draws a realm from slot REALM (always;
`opts.realm` overrides), the builder from the BUILD stream (`opts.key` forces
one after the draw), calls `build(S, ctx, { seed, role, state, realm, roll })`
and stamps `key`, `realm` and `seed` on the result.

## prims.ts

`boxBounds(box)`, `capsuleBounds(capsule)`, `boxSdf(box)`, `capsuleSdf(capsule)`,
`boxPart(box, extra)` / `capsulePart(capsule, extra)` (parts that remember
their `prim`), `toPart(partLike)` (`{ box }`, `{ capsule }`, `{ shape }`, a
bare `{ c, h, yaw? }` or `{ a, b, r }`, or a part as it is), `overTop(p, box, margin)`.
A box's yaw is the frame's: its own +z face looks along `frontOf(yaw)`.

## front.ts

`detectFront(thing, opts): FrontResult` — `thing` is an entity, an object
definition or instance, an array of parts/prims, or `{ boxes, capsules }` (raw
world-space solids). The evidence, all in the thing's own frame and turned by
its transform (so the answer turns exactly with it):

- **declared** — a `front` (on opts, the thing, `def` or `components`; or
  NOCTURNES' `facing: true`) wins, but is checked (`agrees`);
- **features** — parts named like a face, screen, cone, door (`FEATURES`,
  `defineFeature`), where they are seen from, where they sit, normals they declare;
- **use** — a seat faces out from its backrest, a screen away from its stand
  (`USE_CASES`, `defineUseCase`);
- **geometry** — recess, edges, a flat face, which way the mass leans.
  Symmetric things come back `symmetric` (`"round"` / `"mirror"`), confidence <= 0.15.

Result: `{ yaw, dir, confidence, declared, declaredYaw, agrees, symmetric,
symmetry, axisYaw, detected, local, layers, why }`. Options: `front`,
`features`, `useCases`, `dirs`, `grid`, `elevation`, `steps`, `massGrid`,
`evidence` (a `frontEvidence()` result to reuse). Also `parseFront`,
`featureOf`, `wordsOf`, `angleBetween`, `frontOffFrom(pos, yaw, eye)`.
