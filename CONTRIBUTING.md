# Contributing to KEEL Engine

Thanks for helping. The engine is small on purpose: it is a pixel-art engine,
and every byte of it ends up on chain.

## Setup

The engine builds with the KEEL SDK beside it. `packages/keel` links
`../keel-sdk` for the module pipeline.

```bash
git clone https://github.com/keel-web3/keel-sdk
git clone https://github.com/keel-web3/keel-engine
(cd keel-sdk && pnpm install && node scripts/build.mjs)
cd keel-engine && pnpm install
```

Node 22.18 or later runs the TypeScript directly: tests need no build step.

## Before you open a pull request

```bash
npm run typecheck          # the whole repository, strict
npm test                   # every package's tests
npm run modules:prepare    # regenerate the pipeline files if a package's imports or manifest changed
npm run modules:test       # every module through `keel module build`, then its vectors on both builds
npm run modules:index      # regenerate catalog/catalog.json, and commit it with your change
```

CI runs the same commands. It fails when:

- a package's pipeline files are stale;
- the catalog isn't byte-identical to a fresh index;
- any module doesn't reproduce;
- any vector differs between the readable build and the shipped bytes.

## How a package is written

`docs/CONVENTIONS.md` has the details. In short:

- **Strict, readable TypeScript.** The readable source is the verified
  portion. Minification is the pipeline's job, not yours.
- **One package, one module.** A package's `src/index.ts` is its one entry.
  Anything a game needs is exported from there, not from a subpath.
- **Imports of other engine packages go by name** (`@keel-engine/core`), never
  by path. The pipeline links them, and the package's manifest
  (`src/module.ts`) must `need` every module it imports. The build refuses an
  undeclared one.
- **No ambient network, no CDN, no globals** besides `KEEL_ENGINE`. On chain,
  everything a module has arrives through its context.
- **Deterministic.** Anything seeded must replay exactly: tests pin it, and the
  vectors pin it against the minified bytes.

## Test vectors

Every module has `test/vectors.mjs`: a few deterministic
`{ name, run(api, engine), expect }` cases that `keel module test` runs
against the readable build and the shipped bytes (see
`packages/keel/src/vectors.ts`). When you change a module's behaviour on
purpose, update its vectors' `expect` in the same change and say why.

## Chain

Nothing goes on chain from a pull request. Publishing is the maintainers'
call, through a wallet, after review (`docs/PUBLISHING.md`).

## License

By contributing, you agree that your contributions are licensed under the MIT
License in `LICENSE`.
