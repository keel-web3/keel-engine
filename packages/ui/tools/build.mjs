// Bundles the UI tool page into tools/dist/ (gitignored). Engine packages resolve to their workspace
// source, linked or not.
//   node packages/ui/tools/build.mjs
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const engine = {
  name: "keel-engine-source",
  setup(b) {
    b.onResolve({ filter: /^@keel-engine\/[\w-]+$/ }, (a) => {
      const file = resolve(root, "packages", a.path.slice("@keel-engine/".length), "src/index.ts");
      return existsSync(file) ? { path: file } : undefined;
    });
  },
};
await build({ bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info", plugins: [engine], entryPoints: [resolve(here, "ui.ts")], outfile: resolve(here, "dist/ui.js") });
