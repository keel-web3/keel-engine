// Where a module's code is: src/<name> in whichever language it's written.
// TypeScript is the default and the recommendation, never a requirement --
// src/module.js, src/index.js and src/schemas.js build, link and verify the
// same way as their .ts twins (the pipeline's typecheck covers the TypeScript;
// plain JavaScript goes through the same bundle, recipe and receipt).
// (Node built-ins only: vectors.ts reads it too.)

import { existsSync } from "node:fs";
import { basename, join } from "node:path";

/** What a module's source files may be written in, in the order they're looked for. */
export const SOURCE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"] as const;

/** A module's src/<name> file in whichever language it's written (TypeScript first), or null. */
export function sourceFile(dir: string, name: string): string | null {
  for (const ext of SOURCE_EXTENSIONS) {
    const file = join(dir, "src", name + ext);
    if (existsSync(file)) return file;
  }
  return null;
}

/** A module's src/index file: the code its module runs. */
export function indexOf(mod: { readonly manifest: { readonly id: string }; readonly dir: string }): string {
  const file = sourceFile(mod.dir, "index");
  if (!file) throw new Error(`${mod.manifest.id} has no src/index file (index.ts or index.js): that's the code its module runs.`);
  return file;
}

/** Its file name ("index.ts", "index.js"), as the module entry requires it. */
export const indexName = (mod: Parameters<typeof indexOf>[0]): string => basename(indexOf(mod));
