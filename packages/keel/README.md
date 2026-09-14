# @keel-engine/keel

The engine's build, as KEEL verified modules. Node only: it is tooling, not a
module.

- **`link.ts`** writes each package's pipeline files: `keel.module.json`,
  `tsconfig.json`, `keel/entry.ts` (the same in every package) and
  `keel/link.json` (its manifest and which module id each linked import
  reaches).
- **`pipeline.ts`** runs a package through the SDK's own
  `keel module build` / `keel module test` (`@keel/builder`), in the
  registry's dependency order. It builds engine packages in place. A project
  outside the engine is staged under `<its dir>/out/keel-module`.
  `verifyFromGitHub` is `keel module verify` for one catalog entry.
- **`catalog.ts`** writes `catalog/catalog.json`
  (`keel-engine-module-catalog@1`), built from committed files and verified
  bytes only.
- **`resolver.ts`** (`@keel-engine/keel/resolver`, browser-safe) resolves an
  engine version: the release record from chain by its pin, each module's
  bytes checked against its catalog digest, local builds compared, and
  readable source on GitHub.
- **`document.ts`** builds a game as the KEEL local document the chain
  assembles, from verified bytes by default (`modules: "dev"` uses
  `bundle.ts`, the fast in-memory path).
- **`plan.ts`** is the publish dry run.
- **`vectors.ts`** is the harness every module's `test/vectors.mjs` runs on.

```bash
node packages/keel/src/cli.ts prepare [--check]
node packages/keel/src/cli.ts build | test | index [--revision <sha>] [--check] | reproduce | plan
node packages/keel/src/cli.ts verify-origin --commit <sha>
node packages/keel/src/cli.ts document <game-id> [--project <dir>] [--dev]
```

See the repository `README.md` and `docs/PUBLISHING.md`.
