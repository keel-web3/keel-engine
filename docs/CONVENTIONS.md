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
  simulation on a fixed step; no `Math.random`, no clock in logic.
- **The frame convention** (`@keel-engine/core` frame): +z is a thing's front,
  +x its right hand, +y up; `yaw = atan2(dx, dz)`.
- **Pixel art is the model:** palette ramps, dither screens, outlines. No
  art-piece limits (GIF tables, 32 colours) in anything a game uses; GIF is an
  optional export in `@keel-engine/capture`.
- **Comments:** short, plain English, parenthetical asides for the why --
  as in the proof of concept (`../keel-pixel-engine`).

## Porting from the proof of concept

`../keel-pixel-engine` is the reference. A port keeps behaviour identical and
proves it: its tests come across (as `.test.ts`), and where the JS module is
still importable, an equality test compares the TS output with the JS output
over many seeds. The JS proof of concept is never edited.

## Nothing onchain without the owner

Building, sandboxing and local KEEL documents are free; publishing any module
is the owner's decision.
