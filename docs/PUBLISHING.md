# Publishing the engine's modules (Sepolia): the dry run

This page is a **plan**. Nothing here has been sent: no transaction, no key,
no signature. Publishing is the owner's call, made through a wallet after
review. The numbers below come from the verified bytes of the working tree on
2026-09-14. Re-run `npm run modules:plan` at release time for current
figures.

## What a release is

A release is one engine version (the root `package.json` version, now
`0.1.0`) at one commit. On chain it is:

1. **One KeelHold object per module.** Its bytes are exactly
   `dist/<name>.min.js`: what `keel module build` produced and what its
   `keel-source-receipt.json` binds to the readable source. The bytes are
   stored gzip'd, so a browser can read them back with `DecompressionStream`
   and needs no decoder module.
2. **One KeelHold object for the release record.** This is the engine catalog
   (`keel-engine-module-catalog@1`), with `revision` set to the release
   commit and each module's `deployments` filled in (KeelHold address and
   object id). It is written last. Its object id and sha256 are the
   **release pin** (`EngineReleasePin`) that editors and games resolve the
   engine by (`@keel-engine/keel/resolver`, `loadEngineRelease`).

Tone.js and keel-audio are **not** published by the engine. The engine's
`vendor/` copies are byte-identical to KEEL's registered `tone-native` and
`keel-audio` objects, and a test checks this. Games reuse those shared
objects.

### KEEL contracts and records written

| Where | What | How |
| --- | --- | --- |
| **KeelHold** on Sepolia, `0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267` (instance "showcase", from the SDK's module registry, `resolveModuleTarget({ module: "keel-hold", contract: "KeelHold", chainId: 11155111 })`) | 31 module objects + 1 release record | `castSlugs(bytes[])` (carriers of at most 23,000 bytes, three per transaction), then one `weldObject(bytes32[],bytes32,uint64,uint8,string)` per object. Content-addressed: a carrier or object that already exists is skipped |
| No registry contract | none | `KeelModuleReviewRegistry` has no Sepolia deployment in the SDK registry. A review is a separate, later step. The catalog says `verified` (by receipt) and `deployed` (by record) independently |
| This repository (a commit after the publish) | `<package>/deployments/11155111.json` (`keel.jsmodule-deployment@1`, one per module: hold address, object id, version, output and receipt digests, block, tx hash), then `npm run modules:index` | These records feed `catalog/catalog.json`'s `deployments` |
| keel-sdk `packages/game-engine/engine.lock.json` | the release: repository, tag, commit, and the pin (chain id, hold, object id, digest) | What `@keel/game-engine` resolves by default |

Games published after the engine also write their own KEEL module-slot objects
and their root. That is the SDK's game flow (`pnpm game:publish`), not this
release.

## The modules, in publish order

The order is the registry's start order: dependencies first. It is
`catalog.order`, and `node packages/keel/src/cli.ts plan` prints it.

The figures come from a model, not a gas quote:

- **Stored** is gzip -9 of the bytes.
- **Gas** is KeelHold's measured storage cost (keel-sdk `docs/STORAGE.md`:
  3 × 23,000-byte carriers in one `castSlugs` = 14,181,827 gas, about 205.5
  gas per stored byte), plus 21,000 intrinsic gas per transaction, plus a
  modelled `weldObject`.

| # | Module | Object | Bytes | Stored | Carriers | Tx | Mgas | Output digest |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | `keel/runtime` | `keel-engine-runtime.min.js` | 10,389 | 4,006 | 1 | 2 | 0.98 | `0x791d5664c0153904…` |
| 2 | `keel/codec` | `keel-engine-codec.min.js` | 106,977 | 38,563 | 2 | 2 | 8.11 | `0x86596c2a7c257e27…` |
| 3 | `keel/audio` | `keel-engine-audio.min.js` | 87,861 | 34,178 | 2 | 2 | 7.21 | `0xb33f3b28eb20013f…` |
| 4 | `keel/core` | `keel-engine-core.min.js` | 43,245 | 20,855 | 1 | 2 | 4.44 | `0x9228054dc7d3d5a7…` |
| 5 | `keel/scene` | `keel-engine-scene.min.js` | 30,182 | 12,557 | 1 | 2 | 2.74 | `0x3b74f1d599d3e6d2…` |
| 6 | `keel/entity` | `keel-engine-entity.min.js` | 56,044 | 20,516 | 1 | 2 | 4.37 | `0x8749f2d49ecb5deb…` |
| 7 | `keel/bake` | `keel-engine-bake.min.js` | 128,816 | 46,270 | 3 | 2 | 9.72 | `0x2c7aac72731aeb1b…` |
| 8 | `keel/physics` | `keel-engine-physics.min.js` | 10,077 | 4,300 | 1 | 2 | 1.04 | `0x0ddc478b53caec19…` |
| 9 | `keel/object` | `keel-engine-object.min.js` | 41,105 | 15,249 | 1 | 2 | 3.29 | `0xe945c04cf886289b…` |
| 10 | `keel/builder` | `keel-engine-builder.min.js` | 129,496 | 46,146 | 3 | 2 | 9.69 | `0xc7449b289a6947de…` |
| 11 | `keel/camera` | `keel-engine-camera.min.js` | 14,325 | 6,036 | 1 | 2 | 1.40 | `0xf94410e3ab5df13b…` |
| 12 | `keel/capture` | `keel-engine-capture.min.js` | 4,667 | 2,325 | 1 | 2 | 0.63 | `0xeafb3437f775ad1d…` |
| 13 | `keel/import` | `keel-engine-import.min.js` | 112,924 | 44,030 | 2 | 2 | 9.23 | `0xf66c56b1d871e2dc…` |
| 14 | `keel/input` | `keel-engine-input.min.js` | 6,865 | 3,250 | 1 | 2 | 0.82 | `0x50c4d7f76a7545c8…` |
| 15 | `keel/particles` | `keel-engine-particles.min.js` | 77,925 | 26,347 | 2 | 2 | 5.60 | `0x6e569a1fcb2234f7…` |
| 16 | `keel/world` | `keel-engine-world.min.js` | 31,771 | 12,487 | 1 | 2 | 2.72 | `0x478e37dc2dd8340a…` |
| 17 | `keel/terrain` | `keel-engine-terrain.min.js` | 138,125 | 50,804 | 3 | 2 | 10.65 | `0xa6477f72ae1dac1c…` |
| 18 | `keel/level` | `keel-engine-level.min.js` | 64,999 | 23,667 | 2 | 2 | 5.05 | `0x2f2446ec63edd577…` |
| 19 | `keel/render` | `keel-engine-render.min.js` | 59,987 | 21,234 | 1 | 2 | 4.52 | `0x6247989e29031ec9…` |
| 20 | `keel/ui` | `keel-engine-ui.min.js` | 155,997 | 57,924 | 3 | 2 | 12.11 | `0x5e51cd9807dabfcc…` |
| 21 | `keel/view` | `keel-engine-view.min.js` | 15,055 | 6,695 | 1 | 2 | 1.53 | `0xbe69e2a71b7d7eae…` |
| 22 | `keel/worldgen` | `keel-engine-worldgen.min.js` | 210,366 | 74,308 | 4 | 3 | 15.53 | `0x6415c74b0fc2981b…` |
| 23 | `packs/animals` | `keel-engine-packs-animals.min.js` | 8,099 | 3,173 | 1 | 2 | 0.81 | `0x68bc6674babbc0b6…` |
| 24 | `packs/buildings` | `keel-engine-packs-buildings.min.js` | 50,737 | 15,620 | 1 | 2 | 3.37 | `0x7b771335e83b1029…` |
| 25 | `packs/cloth` | `keel-engine-packs-cloth.min.js` | 20,267 | 7,023 | 1 | 2 | 1.60 | `0xe58b0740e25d85a7…` |
| 26 | `packs/creatures` | `keel-engine-packs-creatures.min.js` | 40,274 | 14,686 | 1 | 2 | 3.18 | `0xb97a71fc0776b640…` |
| 27 | `packs/dungeon` | `keel-engine-packs-dungeon.min.js` | 61,260 | 17,609 | 1 | 2 | 3.78 | `0xf18f5b4b03d9079f…` |
| 28 | `packs/foliage` | `keel-engine-packs-foliage.min.js` | 35,997 | 10,959 | 1 | 2 | 2.41 | `0xb7369555d6094136…` |
| 29 | `packs/humans` | `keel-engine-packs-humans.min.js` | 4,488 | 1,935 | 1 | 2 | 0.55 | `0xd02931ece11ce763…` |
| 30 | `ai/herd` | `keel-engine-ai-herd.min.js` | 7,453 | 3,448 | 1 | 2 | 0.87 | `0x4779a714aa2e0e5a…` |
| 31 | `ai/wander` | `keel-engine-ai-wander.min.js` | 6,494 | 3,043 | 1 | 2 | 0.78 | `0x4afd00a3bc5e3e33…` |
| 32 | release record | `catalog.json` (with deployments) | ~137,189 | ~34,773 | 2 | 2 | 7.33 | its sha256 is the pin |
| | **total** | 32 objects | **1,909,456** | **684,016** | **49** | **65** | **146.06** | |

At Sepolia gas prices this is about:

- 0.073 ETH at 0.5 gwei;
- 0.29 ETH at 2 gwei;
- 1.46 ETH at 10 gwei.

These are Sepolia test ether. A module published once is reused by every
game after it.

## The commands the owner runs

Every step up to 4 is read-only.

### 0. Prerequisites

The KEEL SDK's module-pipeline changes are committed and pushed in
keel-web3/keel-sdk:

- `keel.module.json` `build` settings;
- `--no-types`;
- terser's script mode for classic output;
- `keel module plan --compression`;
- the `keel module verify --format/--external` flags.

keel-engine's CI builds against keel-sdk `main`.

### 1. A release candidate that proves itself

In keel-engine, with `../keel-sdk` built:

```bash
pnpm install
npm run typecheck && npm test
npm run modules:prepare && npm run modules:index   # regenerate; commit anything that changed
npm run modules:check                              # pipeline files current, catalog byte-identical
npm run modules:test                               # 31 modules, every vector on both builds
npm run modules:reproduce                          # everything twice from clean dist/, identical digests
```

### 2. Commit, push, tag. Then the stranger's check

```bash
git tag v0.1.0 && git push origin main v0.1.0
node packages/keel/src/cli.ts verify-origin --commit "$(git rev-parse HEAD)"
```

`verify-origin` is `keel module verify` for every module. For each one it:

- fetches github.com/keel-web3/keel-engine at the commit;
- rebuilds the module at its path, with the format and externals its recipe
  recorded;
- compares the result with the catalog's digest.

Any single module can be checked the same way:

```bash
keel module verify --repo keel-web3/keel-engine --commit <sha> --path packages/scene \
  --entry keel/entry.ts --format iife --external @keel-engine/core --expect <catalog outputDigest>
```

### 3. Dry runs

No key and no transaction:

```bash
# Modelled: sizes, carriers, gas (writes out/publish-plan.json)
node packages/keel/src/cli.ts plan --chain-id 11155111

# The SDK's reviewable operations per module: castSlugs + weldObject descriptors,
# review-only, gzip so a browser reads them back (writes each dist/keel-publish-plan.json)
for d in $(node -e 'for (const m of require("./catalog/catalog.json").modules) console.log(m.sourceRepository.path)'); do
  node ../keel-sdk/packages/builder/dist/cli.js module plan "$d" --chain-id 11155111 --compression gzip
done

# Measured: forks Sepolia into a local anvil (read-only calls to a Sepolia RPC),
# runs the real publishes there from anvil's unlocked account, reads everything
# back byte for byte, and prices it at Sepolia's current gas price.
(cd ../keel-sdk && pnpm game:sepolia-dry-run --game examples/hello=examples/game-engine/hello)
```

### 4. Publish (owner, wallet, Sepolia)

This goes through the KEEL desktop editor's publish flow. The wallet approves
each transaction: in the order above, each module's `castSlugs`, then its
`weldObject`, and the release record last. The flow is keel-sdk
`packages/game-engine/chain/engine-release.mjs` `publishEngineRecord`, which
publishes the verified bytes and then the filled-in catalog as the release
record, and returns the pin.

The practice chain rehearses the same flow first:

```bash
cd ../keel-sdk
pnpm game:sandbox        # local Anvil (31337) with KeelHold deployed
pnpm game:publish examples/hello --project examples/game-engine/hello --include-engine
```

### 5. Record it

In keel-engine:

1. Write each module's `deployments/11155111.json` from the receipts.
2. Run `npm run modules:index`.
3. Commit.

In keel-sdk, set `engine.lock.json` (tag, commit, and the on-chain pin
`{ chainId: 11155111, hold, objectId, digest }`).

From then on, `@keel/game-engine` and the editor resolve `0.1.0` from chain:
`loadEngineRelease(pin)` and then `resolveEngineModules`. Every module is
checked against the digest its receipt binds.

## After a release

- **A new engine version is new objects.** Changed modules get new digests,
  so new objects. Unchanged modules keep their bytes and their objects: they
  are content-addressed and reused. The release record is always new.
- **Old releases stay resolvable by their pins.** A deployment is never
  edited. A superseded one is marked `superseded` in the records.
