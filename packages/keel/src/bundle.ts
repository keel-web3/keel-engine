// One engine package -> one KEEL browser module, the fast way: the same entry
// the pipeline compiles (keel/entry.ts, with its link record inlined), bundled
// in memory by esbuild alone -- no typecheck, no compact stage, no receipt.
// It is what the dev server and quick iterations run; the bytes that ship are
// the pipeline's (pipeline.ts: `keel module build`, verified and reproducible),
// and they behave the same: a classic script that defines the package on
// KEEL_ENGINE, with every other module it imports answered by ctx.use(id).

import { build } from "esbuild";
import type { ModuleManifest } from "@keel-engine/runtime";
import { entryFor, linkRecord, linkedSpecifiers } from "./link.ts";
import type { WorkspaceModule } from "./workspace.ts";

export interface BundledModule {
  readonly manifest: ModuleManifest;
  /** The classic script, as stored. */
  readonly code: string;
  readonly bytes: Uint8Array;
}

export interface BundleOptions {
  /** Minify (smaller, like what goes on chain); readable when false (what you debug). Default true. */
  readonly minify?: boolean;
}

const LINK_IMPORT = 'import link from "./link.json" with { type: "json" };';

export async function bundleModule(mod: WorkspaceModule, workspace: readonly WorkspaceModule[], { minify = true }: BundleOptions = {}): Promise<BundledModule> {
  const link = await linkRecord(mod, workspace);
  const entry = entryFor(mod);
  if (!entry.includes(LINK_IMPORT)) throw new Error("The module entry no longer imports its link record the way bundleModule inlines it.");
  const result = await build({
    // (Resolved from the package itself: a project has no keel/ directory of its own.)
    stdin: { contents: entry.replace(LINK_IMPORT, `const link = ${JSON.stringify(link)};`).replaceAll('"../src/index.ts"', '"./src/index.ts"'), resolveDir: mod.dir, sourcefile: "keel/entry.ts", loader: "ts" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify,
    legalComments: "none",
    charset: "ascii",
    external: linkedSpecifiers(link),
    logLevel: "silent",
  });
  const code = result.outputFiles[0]?.text ?? "";
  return { manifest: mod.manifest, code, bytes: new TextEncoder().encode(code) };
}
