// Bundles the world-content showcase into tools/dist/ (gitignored). Engine
// packages and packs resolve to their workspace source, linked or not.
//   node packs/buildings/tools/build.mjs
import { build } from "esbuild";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
// (Every workspace package by its name: packages/*, packs/*.)
const byName = new Map();
for (const group of ["packages", "packs"]) {
  for (const d of readdirSync(join(root, group))) {
    const pkg = join(root, group, d, "package.json");
    if (existsSync(pkg)) byName.set(JSON.parse(readFileSync(pkg, "utf8")).name, join(root, group, d));
  }
}
const engine = {
  name: "keel-engine-source",
  setup(b) {
    b.onResolve({ filter: /^@keel-engine\/[\w-]+$/ }, (a) => {
      const dir = byName.get(a.path);
      const file = dir && join(dir, "src/index.ts");
      return file && existsSync(file) ? { path: file } : undefined;
    });
  },
};
await build({ bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info", plugins: [engine], entryPoints: [resolve(here, "showcase.ts")], outfile: resolve(here, "dist/showcase.js") });
