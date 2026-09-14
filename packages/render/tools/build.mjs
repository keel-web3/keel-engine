// Bundles the parity page's scripts into tools/dist/ (gitignored): the
// TypeScript renderer and the scene (tools/parity.ts), and -- as a fallback
// for when the proof of concept's own server (localhost:4200) can't be
// imported from this page -- its renderer, bundled read-only from its source.
//   node packages/render/tools/build.mjs
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const POC = resolve(process.env.KEEL_POC ?? resolve(here, "../../../../keel-pixel-engine"));
const common = { bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info" };

await build({ ...common, entryPoints: [resolve(here, "parity.ts")], outfile: resolve(here, "dist/parity.js") });
const pocEntry = `${POC}/src/gpu/pixel-renderer.js`;
if (existsSync(pocEntry)) await build({ ...common, entryPoints: [pocEntry], outfile: resolve(here, "dist/poc-renderer.js") });
else console.warn(`no proof of concept at ${POC}: the page can only import it from its server`);
