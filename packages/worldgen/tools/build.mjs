// Bundles the worldgen tools into tools/dist/ (gitignored): the GPU ground's parity tool, the occlusion check.
// Engine packages resolve to their workspace source, linked or not.
//   node packages/worldgen/tools/build.mjs    ->  http://localhost:4300/packages/worldgen/tools/ground-parity.html
//                                              http://localhost:4300/packages/worldgen/tools/occlusion-check.html
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
      const name = a.path.slice("@keel-engine/".length);
      for (const dir of ["packages", "packs"]) { const file = resolve(root, dir, name, "src/index.ts"); if (existsSync(file)) return { path: file }; }
      return undefined;
    });
  },
};
for (const name of ["ground-parity", "occlusion-check"]) await build({ bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info", plugins: [engine], entryPoints: [resolve(here, `${name}.ts`)], outfile: resolve(here, `dist/${name}.js`) });
