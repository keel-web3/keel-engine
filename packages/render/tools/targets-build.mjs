import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("./targets.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("./dist/targets.js", import.meta.url)),
  bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "info",
  // A sibling game's dependency links may point at a pinned release. This bench uses this checkout.
  alias: Object.fromEntries(["core", "capture"].map((name) => [`@keel-engine/${name}`, fileURLToPath(new URL(`../../${name}/src/index.ts`, import.meta.url))])),
});
