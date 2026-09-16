# KEEL Engine

KEEL Engine is the pixel-art game engine for [KEEL](https://github.com/keel-web3/keel-sdk)
onchain games. It is TypeScript here and classic-script modules on chain.

Every part of the engine is a **KEEL verified module**, and so is every
standard pack and every AI:

- Each is readable, strict TypeScript in this repository.
- Each ships as minified bytes on chain.
- A hash-linked receipt proves the bytes on chain are the build of this source.
  You don't have to trust us: anyone with a commit hash can rebuild the exact
  published bytes (see "Check it yourself" below).

Games and the KEEL desktop editor normally load the engine from chain at a
chosen version. Each module's bytes are checked against the digest its
receipt binds. With a local checkout or a clone at a tag, you can compile the
engine through the same pipeline and compare the digests.

## The parts

| Package | Module | What it is |
| --- | --- | --- |
| `packages/runtime` | `keel/runtime` | The `KEEL_ENGINE` registry: manifests (`keel-engine-module@1`), needs and contracts, start order, packs, entities, attributes, `fits()` |
| `packages/core` | `keel/core` | Seeded streams, the frame convention, math, SDFs, OKLCH palettes, dither screens, the quantizer, the GIF encoder |
| `packages/codec` | `keel/codec` | The bit codec: typed schemas, canonical bit-packed documents, the JSON view, the bit inspector |
| `packages/scene` | `keel/scene` | Transforms, bounds, the shape kit, asset registries, front detection |
| `packages/entity` | `keel/entity` | Things that move: humanoid and quadruped rigs, species, skins, clips, the animator |
| `packages/object` | `keel/object` | Things that don't move: pieces, colliders, sockets, settling, styles |
| `packages/physics` | `keel/physics` | The kinematic character controller |
| `packages/bake` | `keel/bake` | Design once, draw fast: sprite atlases baked at load, instanced sprites, culling |
| `packages/render` | `keel/render` | The WebGL2 pixel renderer and its FX passes |
| `packages/particles` | `keel/particles` | Pooled, seeded particle emitters |
| `packages/audio` | `keel/audio` | Generative music from a mood and a seed, seeded SFX, on KEEL's shared audio runtime |
| `packages/world` | `keel/world` | The world runtime: systems on a fixed step, settings, rules, snapshots |
| `packages/terrain` | `keel/terrain` | Tile terrain: heights, auto-tiling, cliffs, ramps, water, bridges, pathing, GPU ground |
| `packages/level` | `keel/level` | Levels: versioned documents of terrain and placed things |
| `packages/worldgen` | `keel/worldgen` | Biomes, the infinite chunked overworld, action-RPG dungeons, foliage scatter, generator pipelines |
| `packages/view` | `keel/view` | View modes: deep zoom, possession, first person |
| `packages/camera` | `keel/camera` | Camera rigs: orbit, chase, first person, frame, rail |
| `packages/input` | `keel/input` | Keyboard, mouse, gamepad and touch to intents |
| `packages/ui` | `keel/ui` | Generative UI: themes from a seed and a culture, pixel fonts, icons, widgets, HUDs |
| `packages/builder` | `keel/builder` | The voxel builder: models by role, ops, rigging, conversion to objects and attributes |
| `packages/import` | `keel/import` | 3D model import: glTF/GLB, OBJ, STL, `.vox`, which it voxelises, segments and converts to assets |
| `packages/capture` | `keel/capture` | Optional stills, video and GIF export |
| `packs/animals` · `humans` · `cloth` · `creatures` | `packs/*` | Characters and wearables, each pack one module |
| `packs/foliage` · `buildings` · `dungeon` | `packs/*` | World dressing as styled objects |
| `ai/wander` · `ai/herd` | `ai/*` | Behaviour: `ai/animal@1.0.0` for any `body/quadruped` |
| `packages/keel` | (Node) | The build: runs each package through the KEEL module pipeline, and handles the catalog, the resolver and game documents |

`docs/ARCHITECTURE.md` explains how the parts fit. `docs/CONVENTIONS.md`
explains how a package is written.

## Quick start (through the SDK)

You make games with the engine through the KEEL SDK, which carries it as
`@keel/game-engine`:

The SDK's [friend quickstart](https://github.com/keel-web3/keel-sdk/blob/codex/friend-test-setup/docs/FRIEND_QUICKSTART.md)
installs these engine parts, the editor, MCP and skills together. It also includes
the original JavaScript pixel engine under `packages/pixel-engine`. They are
parts of the same KEEL SDK workflow; a tester does not need to arrange sibling
checkouts manually.

```bash
git clone https://github.com/keel-web3/keel-sdk
cd keel-sdk && pnpm install && node scripts/build.mjs
pnpm game:new top-down "My Game"      # a project that reaches the engine by name; prints its game id
node packages/game-engine/src/cli.ts document <game-id> --project games   # the KEEL document the chain assembles
```

The SDK's `examples/game-engine/` holds working games (hello, garden, zoo,
army, wallrun, worlds, ui-demo, level-demo). The KEEL desktop editor builds
and runs the same projects.

## The verified module model

Each package carries four small files for `keel module build` (the SDK's
module pipeline, `@keel/builder`). `node packages/keel/src/cli.ts prepare`
generates all four, and the tests check they are current:

| File | What it is |
| --- | --- |
| `keel.module.json` | `keel-module-manifest@1`: the module's pipeline name, license and source location. It also says how the module links: `build.format: "iife"` (a classic script, as KEEL's module slots run) and `build.external` (every other engine module it imports, left as an import instead of copied in) |
| `tsconfig.json` | The strict flags the pipeline insists on |
| `keel/entry.ts` | The entry the pipeline compiles. It is the same in every package. It defines the package on `KEEL_ENGINE` and evaluates it inside its factory, where every linked import is answered by the module's context (`ctx.use(id)`) |
| `keel/link.json` | `keel-engine-link@1`: the package's engine manifest (codec schemas embedded) and which module id each linked import reaches |

Then, for each module in dependency order:

1. **Build.** `keel module build` runs:
   - a strict typecheck;
   - esbuild with the recipe's options;
   - the terser compact stage;
   - `dist/keel-build-recipe.json`;
   - `dist/keel-source-receipt.json`, written only if a rebuild reproduced the
     bytes (disposition `reproducible-build`).
2. **Test.** `keel module test` runs the module's `test/vectors.mjs` in clean
   processes, against the readable build and against the shipped bytes. They
   must agree with each other and with the vectors.
3. **Index.** `catalog/catalog.json` (`keel-engine-module-catalog@1`) records
   every module's:
   - id and version, needs and provides;
   - readable source files, each with its sha256;
   - output, recipe and receipt digests;
   - deployments.

   It is built from committed files and verified bytes only. Indexing twice
   gives an identical file.

The bytes a game document carries are exactly `dist/<name>.min.js`: nothing
is wrapped around them afterwards.

```bash
npm run modules:prepare     # write the pipeline files
npm run modules:test        # build every module, run every vector on both builds
npm run modules:index       # write catalog/catalog.json
npm run modules:reproduce   # build everything twice from clean dist/ and compare every digest
npm run modules:check       # CI: pipeline files current, and the catalog byte-identical to a fresh index
npm run modules:plan        # the publish dry run: sizes, carriers, modelled gas (no keys, no network)
```

### Check it yourself

For any module in a published catalog, one command rebuilds its bytes from
GitHub at the release commit and compares:

```bash
keel module verify --repo keel-web3/keel-engine --commit <sha> --path packages/scene \
  --entry keel/entry.ts --format iife --external @keel-engine/core --expect 0x...
```

`node packages/keel/src/cli.ts verify-origin --commit <sha>` does this for
every module in the catalog.

### Loading by version

The resolver is `@keel-engine/keel/resolver`. It is browser-safe, and the
editor and `@keel/game-engine` use it.

A version is pinned by one KeelHold object, the release record: the catalog,
with each module's deployment filled in. Each pin records its address, its
object id and its sha256.

- **Default, from chain.** `loadEngineRelease(pin, read)` reads the release
  record and checks its digest. Then `resolveEngineModules(release, ids, { chainId, read })`
  reads each module's object and uses it only if its sha256 equals the
  catalog's output digest.
- **Local.** A checkout, or a clone at a tag, builds through the same pipeline
  (`localEngineModules`). `compareToRelease` then reports every module as
  `match` or `mismatch`.
- **Readable source.** `readableSource(release, id)` gives GitHub URLs at the
  release commit, the pinned sha256 of every file, and the exact
  `keel module verify` command. `fetchReadableSource` fetches the files and
  checks each one.

`docs/PUBLISHING.md` covers the publish dry run and what a release writes.

## Developing

The engine builds with the KEEL SDK beside it: `packages/keel` links
`../keel-sdk` for the module pipeline (`@keel/builder`), the protocol and the
SDK.

```bash
git clone https://github.com/keel-web3/keel-sdk
git clone https://github.com/keel-web3/keel-engine
(cd keel-sdk && pnpm install && node scripts/build.mjs)
cd keel-engine && pnpm install
npm run typecheck && npm test
```

Node 22.18 or later runs the TypeScript directly, so the tests need no build
step.

Some tests compare the engine with its reference implementations: the
JavaScript proof of concept (`../keel-pixel-engine`, or `KEEL_POC=path`) and
NOCTURNES (`../keel-nocturnes`, or `NOCTURNES=path`). Where a reference isn't
present, those tests skip.

## Links

- KEEL SDK (the protocol, the module pipeline, `@keel/game-engine`, the desktop editor): https://github.com/keel-web3/keel-sdk
- KEEL modules (the community library of verified modules): https://github.com/keel-web3/keel-modules
- `CONTRIBUTING.md`, `SECURITY.md`, `NOTICE` (third-party licenses)

## License

MIT. See `LICENSE`. Third-party code in `vendor/` keeps its own license; see
`NOTICE`.
