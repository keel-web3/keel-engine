// Bundles the worldgen tools into tools/dist/ (gitignored): the GPU ground's parity tool.
// Engine packages resolve to their workspace source, linked or not.
//   node packages/worldgen/tools/build.mjs    ->  http://localhost:4300/packages/worldgen/tools/ground-parity.html
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
await build({ bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info", plugins: [engine], entryPoints: [resolve(here, "ground-parity.ts")], outfile: resolve(here, "dist/ground-parity.js") });
