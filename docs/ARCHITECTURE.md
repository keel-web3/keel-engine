# KEEL Engine — architecture

A pixel-art game engine whose every part — the engine itself, packs of
characters, attributes, FX, sounds, AI and systems, and the games built from
them — is a KEEL onchain module. KEEL is what makes an engine like this
possible on chain; this is the engine KEEL ships for pixel-art games.
TypeScript in the repo; classic-script modules on chain; the editor lives in
KEEL's own desktop app (`keel-sdk/apps/desktop`), with KEEL's agent and MCP
layer, so people and agents can make onchain games with it.

The JavaScript proof of concept is `../keel-pixel-engine` (WALLRUN, the
garden, NOCTURNES' guard). It stays the reference until each part here has
matched it.

## What KEEL gives us, and what we add

KEEL (per `../keel-sdk`) stores bytes in KeelHold (≤23 KB slugs, welded into
objects, gzip per leaf, content-addressed by SHA-256). A token's document is
assembled on chain as one `data:text/html`: shell · module slots · creator
assets · creator entry · shell suffix. Each module slot is a gzip'd,
hash-checked script ordered by `phase` (data → runtime → render) and `weight`,
run inside an opaque sandboxed iframe (`connect-src 'none'`, no storage). A
piece declares what it extends with `defineModule(name, { target, extends })`;
libraries in practice are **classic scripts that publish a global** (Tone,
KEEL_AUDIO). KEEL has **no pack primitive** and namespaces only by descriptor
id — globals share one namespace.

So the engine brings its own contract, on top of KEEL's:

- **One global, `KEEL_ENGINE`** — a registry every engine module registers into,
  by namespaced id (`keel/render@1`, `packs/animals@1`, `ai/herd@1`). Nothing
  else touches the global namespace. Modules declare what they `need` and
  `provide`; the registry resolves them in dependency order at load and fails
  loudly on a missing or incompatible one.
- **Packs are the storage unit.** A pack is one module holding many entities
  (and/or attributes, FX, sounds, props): one slot, one read, one gzip over all
  of it — shared code and shape data compress together, so carrying a few
  entities a game doesn't use costs little. A single entity *can* be its own
  module; packs are how you avoid dozens of reads.
- **Behaviour is separate from bodies.** AI and systems are their own modules
  (`ai/herd`, `ai/rts-unit`, `sys/grind`), bound to entities by *interface*
  (`needs: ["body:quadruped@1"]`), so an animal pack works with any animal AI
  and an AI works with any pack that provides the body contract.

## Module kinds (engine-level; KEEL's own `kind` is only a label)

| kind | what it holds | examples |
| --- | --- | --- |
| `runtime` | an engine part | `keel/core`, `keel/render`, `keel/physics`, `keel/entity`, `keel/audio`, `keel/world` |
| `pack` | entities, attributes, props, fx, sounds — data + builders | `packs/animals`, `packs/humans`, `packs/cloth`, `packs/sci-fi-props`, `packs/lofi-sounds` |
| `system` | a gameplay system stepped by the world | `sys/resources`, `sys/combat`, `sys/fog-of-war` |
| `ai` | behaviour bound to bodies by interface | `ai/wander`, `ai/herd`, `ai/rts-unit`, `ai/rts-commander` |
| `game` | a game's rules, UI and entry; the creator entry | `games/rts`; the examples: `examples/wallrun`, `examples/garden` |
| `map` | a map or scenario for a game | `maps/rts/ring-of-seven` |

Every module carries an **engine manifest** (`keel-engine-module@1`): `id`,
`version` (exact semver), `kind`, `needs` (ids with semver ranges, and
interface contracts), `provides` (asset ids and contracts), `phase`/`weight`
for KEEL's slot order, and for packs a table of contents (entities,
attributes, …) so the editor, the loader and agents can read what's inside
without running it. The build also writes KEEL's own declaration
(`keel.module.json`, `defineModule`) and the inline fragment
(`buildKeelInlineModuleFragment`) from the same manifest.

## Assets in code: one file, one thing

Characters, attributes and props are TypeScript files you can read — one
default export each, a typed definition — and the editor shows each one:

```ts
// packs/animals/src/entities/dog.ts
export default defineEntity({
  id: "dog", body: "body/quadruped@1.0.0",
  choices: { coat: ["short", "shaggy", "spotted"], ears: ["floppy", "pointed"], size: [0.45, 0.7] },
  build: (S, pins) => ({ /* rig proportions, features, colours */ }),
  sockets: { head: …, back: …, neck: …, tail: … },
});

// packs/cloth/src/attributes/beanie.ts
export default defineAttribute({
  id: "beanie", slot: "head",
  targets: [{ body: "body/humanoid@^1" }, { body: "body/quadruped@^1", packs: ["packs/animals@^1"] }],
  fit: "socket:head", variants: { pompom: [true, false], stripe: [0, 1, 2] },
  build: (S, fit) => ({ /* parts sized to the socket it lands on */ }),
});
```

## Attributes target packs and bodies, not everything

An attribute says which **body contracts** it fits (`humanoid@1`,
`quadruped@1`, …) and, optionally, which **packs** (a dog from another pack
doesn't get this hat unless that pack is listed, or the two packs declare each
other compatible). It **fits by sockets**: each body exposes sockets (head,
back, hand.R, neck…) with a frame and a size, and the attribute is built *to
that socket* — so one design yields variants that sit right on a mouse, a dog
or a bear. Attributes can be generative (variants from a seed), pinned, or
minted as NFTs (an attribute id + variant + seed is what a token names).

## The loader: design once, then draw sprites

Designing a thing (building its SDF/capsule model and posing it) is expensive;
drawing a sprite is not. When a game loads, the **baker** turns every design
the game uses into cached pixel art at the target size:

- entities → sprite sheets: N directions (8 or 16) × each animation clip's
  frames, rendered once through the pixel pipeline (palette, dither, outline);
- objects and props → sprites or static meshes;
- attributes → their own layers: a rigid wearable is baked once per shape and
  socket size, drawn on its wearer's socket for the frame shown (what bends,
  boots, is baked into the body).

Only SHAPES are baked. A thing's choices are shape (geometry: the cache key) or
look (colour profile per role, pattern, finish, an outfit's coverage): sprites
are baked INDEXED -- slot, shade, surface coordinate per texel -- and each unit's
look is painted by the sprite shader at draw time, palette-true, dithered,
outlined. One baked shape wears any number of looks (`@keel-engine/bake`'s
README: shapes, looks and layers).

Frames then draw **instanced sprites** (one draw call per atlas), with a
**spatial hash grid** for culling, picking and neighbour queries, and a
**BVH** for static geometry. The simulation runs on a **fixed step**,
separate from drawing (deterministic — which is also what lockstep networking
needs). Target: **120 fps**. The picture can be any size; the **pixel scale**
is a real setting (world units per pixel, dither screen and ramp length follow
it), not fixed offsets. The raymarched renderer from the proof of concept
stays for hero shots, previews and bake time.

## Editor, sandbox, agents

- **The editor is part of the KEEL desktop app** (`keel-sdk/apps/desktop`, the
  KEEL Editor): a "Game" creation workflow beside Image/GIF, Edition,
  Collection and Interactive Art, and an engine workspace — the module graph a
  game includes (what's loaded, from where, how big), every pack's contents
  with live previews (turntables at any pixel size), attributes on any
  compatible entity, the game running in KEEL's sandboxed preview, and
  Scratch-like blocks for wiring systems and behaviours. The engine repo
  provides what it needs (`packages/editor-kit`: the engine's services,
  previews and block definitions); the desktop app hosts it, added through its
  own extension points.
- **`packages/mcp`** — engine tools for agents: find assets ("a hat that fits
  a dog"), create an entity/attribute/pack from a template, check
  compatibility, bake a preview, build and sandbox a module. Publishing goes
  through KEEL's own MCP (`keel-inline-prepare`, `publish-plan`): review-only;
  the owner's wallet signs.
- **Sandbox** — every module and game builds a local KEEL document
  (`buildKeelInlineLocalDocument`) and a sandbox report (`@keel/sandbox-sdk`),
  so what runs locally is what runs on chain.

## Repo layout

```
packages/   runtime core codec scene entity object physics bake render particles audio world
            terrain level worldgen view camera input ui builder import capture
            keel                                   (the build: every package through the KEEL module pipeline)
packs/      animals humans cloth creatures foliage buildings dungeon
ai/         wander herd                            (behaviour: bound to bodies by contract)
systems/    (reserved: gameplay systems the world steps)
catalog/    catalog.json                           (every verified module: digests, sources, deployments)
vendor/     Tone.js and keel-audio                 (KEEL's registered page scripts; see NOTICE)
docs/       ARCHITECTURE.md CONVENTIONS.md PUBLISHING.md
```

Examples live in the KEEL SDK (`keel-sdk/examples/game-engine`), and real
games have their own repositories: the SDK carries the engine
(`@keel/game-engine`), and that is how they reach it. The editor UI is
`keel-sdk/apps/desktop`.

## Verified modules

Every package is a KEEL verified module: the SDK's module pipeline
(`keel module build`) compiles its readable TypeScript into the exact bytes
that go on chain, plus a receipt binding the two. `packages/keel` prepares
each package for the pipeline:

- `keel.module.json`, with `build.format: "iife"` and the linked imports as
  `build.external`;
- a strict `tsconfig.json`;
- `keel/entry.ts`, identical everywhere;
- `keel/link.json`, the engine manifest and the import-to-id map.

It then builds, tests (vectors on the readable build and the shipped bytes)
and indexes (`catalog/catalog.json`) in dependency order.

The entry defines the package on `KEEL_ENGINE` and evaluates it inside its
factory. The bundler's lazy init runs the package there, and each linked
import resolves through the module's context (`ctx.use(id)`) while the package
evaluates. So each package's code is stored once, and a module reaches only
what it needs. The bytes a document carries are the bytes the receipt binds.

Games load a version from chain through the resolver
(`@keel-engine/keel/resolver`). Each module is checked against its catalog
digest. A local checkout, or a clone at a tag, is compiled through the same
pipeline and compared. See `README.md` and `docs/PUBLISHING.md`.

## Phases

1. **Contract** — `packages/runtime` (the `KEEL_ENGINE` registry, manifests,
   dependency and compatibility resolution, pack/attribute targeting) and
   `packages/keel` (build: every package through the KEEL module pipeline to a
   verified classic-script module, the catalog, the resolver, inline
   fragments, local documents). Tests.
2. **Port** the proof of concept into typed packages (core, render + fx,
   physics, entity, object, world with locks, camera/input, audio, capture),
   each matched against the JS reference by tests.
3. **Bake and draw fast** — the baker, atlases, instanced sprites, spatial
   hash, culling, pixel scale, a perf harness (120 fps budget).
4. **Packs** — animals (+ `ai/wander`, `ai/herd` as separate modules),
   humans, cloth (attributes with socket fitting and variants), props, FX,
   sounds.
5. **Editor + MCP + skill.**
6. **WALLRUN** (keel-sdk `examples/game-engine/wallrun`), at parity with the proof of concept.
7. **The RTS** (its design lives with the game: `keel-rts` `docs/RTS.md`).

Onchain publishing of any module is the owner's call, after local sandbox
parity.
