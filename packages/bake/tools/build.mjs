// Bundles the bake tools into tools/dist/ (gitignored): the sprite bench and
// the bake bench. Engine packages resolve to their workspace source, linked or not.
//   node packages/bake/tools/build.mjs
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
const common = { bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info", plugins: [engine] };
for (const name of ["bench", "bake-bench"]) await build({ ...common, entryPoints: [resolve(here, `${name}.ts`)], outfile: resolve(here, `dist/${name}.js`) });
