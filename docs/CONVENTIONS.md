# Conventions

## Packages

```
packages/<name>/
  package.json     @keel-engine/<name>; "exports": { ".": "./src/index.ts" }; other engine packages as "workspace:*"
  src/index.ts     the public API -- the only thing other packages import
  src/module.ts    export const manifest = defineManifest({ id: "keel/<name>", version, kind: "runtime", needs: [...] })
  test/*.test.ts   node:test, run straight on the TypeScript source
  test/vectors.mjs the module's vectors: `keel module test` runs them on the readable build and the shipped bytes
  keel.module.json, tsconfig.json, keel/entry.ts, keel/link.json
                   the KEEL module pipeline's files, written by `npm run modules:prepare` (never by hand)
```

- **Imports:** relative imports carry `.ts` (`import { x } from "./x.ts"`); another
  package only through its name (`import { stream } from "@keel-engine/core"`).
  Every `@keel-engine/<pkg>` a package imports must be in its manifest's `needs`
  (`"keel/<pkg>@^0.1"`): the KEEL build links those imports (they resolve
  through the module's context, never copied in), so a module can only reach
  what it declared. A package has one entry, `src/index.ts`: no subpath exports besides `./module` (its manifest, read as data).
- **TypeScript:** strict as configured in `tsconfig.base.json` --
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
  `erasableSyntaxOnly` (no enums, namespaces or parameter properties: Node runs
  the source directly). Typecheck everything from the root: `npx tsc -p tsconfig.json`.
- **Tests:** `node --test packages/<name>/test/*.test.ts`; all of them: `pnpm test`.
- **Deterministic:** randomness only from seeded streams (`@keel-engine/core`);
  simulation on a fixed step; no `Math.random`, no clock in logic. A budget
  that bounds generation counts steps, never milliseconds.
- **Deterministic math: sim and generation use core dmath; presentation may use Math.**
  See [Deterministic math](#deterministic-math) below.
- **The frame convention** (`@keel-engine/core` frame): +z is a thing's front,
  +x its right hand, +y up; `yaw = atan2(dx, dz)`.
- **Pixel art is the model:** palette ramps, dither screens, outlines. No
  art-piece limits (GIF tables, 32 colours) in anything a game uses; GIF is an
  optional export in `@keel-engine/capture`.
- **Comments:** short, plain English, parenthetical asides for the why --
  as in the proof of concept (`../keel-pixel-engine`).

## Deterministic math

**Simulation and generation use core's dmath; presentation may use Math.**

ECMAScript does not pin `Math.sin` and friends to the bit, and in practice
they differ. V8 runs fdlibm for them, compiled by each platform's C compiler,
and on arm64 that compiler fuses `a*b+c` into single-rounding FMA
instructions. Node 22 on an arm64 Mac, on arm64 Linux and on x64 therefore
return different last bits for sin, cos, tan, asin, acos, atan2, log, log10,
cbrt, sinh, cosh and tanh. The diagnostic behind this, run 2026-09-14 on
GitHub's runners against the owner's Mac over 49,000 calls:

| vs darwin-arm64 (Node 22.22.1) | differing calls |
|---|---|
| linux-x64, win32-x64 (Node 22.23.2) | sin 18/2825, cos 14, tan 21, asin 19/1012, acos 11, atan2 4/2311, log 8/1220, log10 9, log1p 2, sinh/cosh 1/1525, tanh 2 |
| linux-arm64 (GCC's contraction, not clang's) | log 8, log2 8, log10 9, log1p 3, atan2 2 |
| darwin-arm64 (GitHub's Mac) | none |

Every mismatch is 1 ulp (log10 2). The fdlibm C sources compiled with
`-ffp-contract=on` reproduce the Mac's bits exactly, and with
`-ffp-contract=off` they reproduce x64's. Math.hypot, exp, pow, sqrt and cbrt
matched on these runners, but only because of V8's own code, and another
engine is free to differ. One ulp is enough to break things: the physics
goldens pinned on the Mac failed on x64 CI; a replay forks; a lockstep peer
desyncs; a recipe rebuilds a different unit.

`@keel-engine/core` exports **dmath**: `dsin dcos dtan datan datan2 dexp dlog
dlog10 dpow dcbrt dscalbn` are plain-JavaScript ports of fdlibm. `dhypot` and
`dlen` use V8's hypot algorithm, and `dasin dacos dlog2` are built from those.
They are made only of IEEE-exact operations, so every engine and CPU gets the
same result. `test/dmath.test.ts` holds them to a table from the reference
fdlibm (`tools/dmath-table.ts`) and to a fingerprint of 350,000 more calls,
and CI runs both on x64 Linux. On x64 they equal V8's own Math.

- **Simulation and generation** use dmath. That means anything stored, compared,
  replayed or hashed, and anything that decides *which* unit, shape, look or
  layout: physics, world, entity, level, object, scene, builder, codec, terrain,
  worldgen, bake (what decides a sprite, and picking), packs, ai, audio plans, and core's frame, rng and look. `packages/core/test/sim-math.test.ts`
  fails if a file there calls `Math.sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/exp/expm1/log/log1p/log2/log10/pow/cbrt/hypot`,
  `Math.random`, or `**` other than `2 ** n` or `x ** 2`. `2 ** n` and `x ** 2`
  are exact everywhere.
- **Presentation** may use Math: a sprite's screen position, a shader, a
  particle's sparkle, a camera's ease, audio synthesis. Its output is looked at,
  never fed back into the simulation.
- **No clock** in simulation and generation either: the same test fails on
  `performance.now`, `Date.now` or `new Date` there. A result that depends on
  how long something took is a different result on a slower or busier machine.
  WFC used to stop on a 250 ms budget, so a crawl floor came out different under
  the full parallel test run ("wfc/crypt/d1: the key can't be reached", passing
  on rerun). Its budget is now a count of decisions and backtracks. A file that
  only times itself for a report, or paces work over frames without changing
  what the work makes, is listed in the test's `CLOCK`, with its reason.
- **Terrain, worldgen and bake are enforced** like the rest. Their presentation
  files are listed in the test's `PRESENTATION`, each with its reason: the
  ground's raster and GPU paths, the dungeon's WebGL renderer, the sprite
  renderer and sway, and the baked pixels (below). Terrain's `viewAxes` and
  `footprintToward` are dmath, like bake's `pixelView`, because the ground's
  depth and a sprite's must agree to the bit.

### Baked pixels

**A bake's pixels are presentation. What decides a bake is simulation.**

- **dmath:** everything that decides *which* sprite exists and where it goes.
  That is its key and size (`plan`, `shapes`' size ladder and bounds,
  `entity-design`'s bounds, `stages`' solids), its atlas place (`atlas`, in
  integers), and the maths players must agree on: the pixel view's projection
  and `ground()` picking (`view`), texel depth and the occlusion gate
  (`depth`), exact ray picking against a design's solids (`raycast`), and the
  unit grid's nearest-thing queries (`grid`).
- **Math is fine for** the raster that fills a sprite in: the bake camera
  (`bake.ts`), the software baker's per-pixel rays and shading (`soft.ts`),
  portraits and their animation, the sprite and sway shaders' uniforms, and the
  ground's texel relief and lighting.

Why: a bake is a local cache, keyed by its design. Nothing stores its pixels
onchain, hashes them into a recipe or level, or sends them to another player.
Each player bakes their own copy, and the GPU bake mode fills in the same
sprites with the driver's own `sin` and `cos`, which are not bit-exact across
GPUs anyway, so bit-exact CPU raster would buy nothing. A last-bit difference
moves a pixel only on a silhouette's knife edge, and only the player looking at
it sees that. Picking, which must agree between players in a lockstep game,
never reads baked texels. It reads `depth`, `raycast`, `view` and `grid`, which
are dmath. The raster also runs per texel, where dmath's `dsin` costs about 2.3
times `Math.sin`. If baked pixels ever become content that is stored or
compared across machines (a sprite hashed onchain, say), the raster files move
out of `PRESENTATION`.
- **Core's math, palette, dither, sdf, quantize and gif, and scene's kit, stay on Math.**
  NOCTURNES renders with them, and its published output must not move (`npm run guard`
  in `../keel-pixel-engine`). Moving the kit's rotations to dmath moved genome #13
  in the guard, so they stay on Math until the owner re-captures NOCTURNES. `cmax` (palette) was checked over its whole
  domain, and dmath and an arm64 Mac's Math give the same results.
- Equality tests against the proof of concept keep comparing to the bit. The
  reference's transcendental functions are swapped for dmath's
  (`test/reference.ts`, `usePortableMath`), so the tests compare the ports and not
  the host's libm.

## Porting from the proof of concept

`../keel-pixel-engine` is the reference. A port keeps behaviour identical and
proves it: its tests come across (as `.test.ts`), and where the JS module is
still importable, an equality test compares the TS output with the JS output
over many seeds. The JS proof of concept is never edited.

## Nothing onchain without the owner

Building, sandboxing and local KEEL documents are free; publishing any module
is the owner's decision.
