# Live runtime entries

The broad bake, entity, buildings and particles entries keep their existing
public APIs. Select `/runtime` for live game code that needs the explicit
exports in `tools/profiles/*-runtime.json`. These entries reuse the same
implementations and data; they do not trim species, city archetypes, tree
climates, particle presets or seed ranges.

| Entry | Included runtime work | Optional work left behind |
| --- | --- | --- |
| `bake/runtime` | live meshes and LOD, cards, camera/culling, sprite instances/cache, look tables, indexed sprites, volumes, sway and mesh worker creation | population/hybrid registries, portraits, specimen authoring and unrelated bake helpers |
| `entity/runtime` | seeded entities, skin, skeleton posing, humanoid clips and idle posing | entity definition/catalogue helpers and unrelated fit/animator helpers |
| `buildings/runtime` | complete city catalogue/streets and seeded tree generation/season paint | legacy building content pack, look profiles and standalone object factories |
| `particles/runtime` | recipe definitions, pooled simulation, snapshot saves, presets, palette, renderer and damage effects | legacy simple particle pool and codec byte persistence |

The explicit runtime export lists are contracts, rather than interchangeable
aliases for the broad entries. Other public helpers remain available through
the broad entries and existing leaf paths. Type-only exports on bake, entity
and buildings do not execute the broad entry at runtime.

```ts
import { createRuntimeParticlePool, PRESETS } from '@keel-engine/particles/runtime';
import type { RuntimeParticlePool } from '@keel-engine/particles/runtime';
import { withParticlePersistence } from '@keel-engine/particles/persistence';

const pool: RuntimeParticlePool = createRuntimeParticlePool({ seed: 7, recipes: PRESETS });
const snapshot = pool.save();
pool.load(snapshot);
const persisted = withParticlePersistence(pool);
const bytes = persisted.saveBytes();
persisted.loadBytes(bytes);
```

`RuntimeParticlePool` retains all simulation, rendering, recipe, inspection and
snapshot methods. `ParticlePool` extends that contract with `saveBytes` and
`loadBytes`. Existing `createParticlePool` and `particles/pool` callers receive
the complete `ParticlePool` contract. The adapter extends the same object,
retaining live getters, typed buffers and closure state. It encodes the existing
`keel/particles/pool` schema; it does not create a new format.

Particle rendering and damage APIs accept `RuntimeParticlePool`, so either
factory works. Code that needs byte persistence imports the adapter explicitly.
Code must not redirect a broad `createParticlePool` import to the narrower
factory without migrating its authoring contract.

## Build checks

Each profile names every supported selected value, forbids the omitted source
families and enforces gzip and Brotli budgets. `buildEngineFeatures` checks
actual runtime exports before tree shaking, so a requested absent value fails
closed instead of being erased as a TypeScript type. The profiles' bytes include
their selected implementations and required dependencies. Values below are
whole profile builds; they are not additive savings in a combined game.

Measured locally on 2026-10-01 with esbuild 0.25.9 and literal shader compaction:

| Profile | Raw JavaScript | Gzip 9 | Brotli 11 |
| --- | ---: | ---: | ---: |
| bake-runtime | 173,526 | 64,552 | 52,705 |
| entity-runtime | 55,877 | 25,012 | 22,082 |
| buildings-runtime | 69,949 | 26,357 | 22,683 |
| particles-runtime | 86,483 | 31,940 | 27,682 |

```sh
node tools/build-features.mjs tools/profiles/particles-runtime.json out/particles-runtime
node --test packages/keel/test/runtime-profiles.test.ts packages/particles/test/runtime.test.ts
```

Compression round trips reconstruct the exact JavaScript. Native Game Boy/GBC
games still use their compiled C and tile assets; these are browser/onchain
JavaScript feature builds, not ROM sizes or deployment receipts.
