// node packages/keel/src/cli.ts <command> [--project <dir>]... [--out <dir>]
//
// The engine as KEEL verified modules (every command below goes through the
// SDK's module pipeline, @keel/builder -- `keel module build/test`):
//   prepare [--check]         write each engine package's pipeline files (keel.module.json,
//                             tsconfig.json, keel/entry.ts, keel/link.json); --check fails on a stale one
//   build [--check]           every engine module through `keel module build`, dependency order
//   test                      build, then every module's vectors (`keel module test`)
//   index [--revision <sha>]  build, then write catalog/catalog.json (keel-engine-module-catalog@1)
//   reproduce                 build every module twice from clean dist/ and compare every digest
//   plan [--chain-id <id>]    the publish dry run: sizes, chunks, calldata, gas estimates (no keys, no network)
//   verify-origin --commit <sha>   every catalog module rebuilt from github.com/keel-web3/keel-engine at that commit
//
// Games:
//   modules                   every module the build can see: id, version, kind, needs, where from
//   module <id>               one module's bytes -> <out>/modules/<id>/<version>/module.js (+ manifest.json)
//   document <game-id>        a game as a KEEL local document -> <out>/documents/<game>/index.html (+ report.json)
//
// `module` and `document` use the verified bytes by default; --dev uses the fast
// in-memory bundle instead (same behaviour, no receipt; --readable unminifies it).
//
// A game whose modules include keel/audio gets Tone and keel-audio from the
// engine's vendor/ as page scripts (classic runtime slots at KEEL's audio
// weights, as a piece's `extends` would bring them); --no-audio leaves them out.
//
// --project adds a project directory outside the engine (an example, a creator's
// game or pack): its modules build beside the engine's, reaching it through the
// SDK's names (staged under <its dir>/out/keel-module for the pipeline). --out
// defaults to the engine's out/ (or the first project's out/).

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundleModule } from "./bundle.ts";
import { buildCatalog, catalogText, writeCatalog, ENGINE_CATALOG_FILE } from "./catalog.ts";
import { buildGameDocument, closureOf, keelAudioScripts } from "./document.ts";
import { buildVerifiedModule, dependencyOrder, prepareModule, staleFiles, testVerifiedModule, verifyFromGitHub, writeModuleFiles } from "./pipeline.ts";
import type { VerifiedModule } from "./pipeline.ts";
import { publishPlan, publishPlanText } from "./plan.ts";
import { ENGINE_ROOT, readWorkspace } from "./workspace.ts";

export { ENGINE_ROOT };

export async function run(argv: readonly string[], { engineRoot = ENGINE_ROOT, cwd = process.cwd() } = {}): Promise<void> {
  const args = [...argv];
  const flag = (name: string) => { const out: string[] = []; for (let i = args.indexOf(name); i >= 0; i = args.indexOf(name)) { out.push(args[i + 1] ?? ""); args.splice(i, 2); } return out; };
  const projects = flag("--project").map((p) => resolve(cwd, p));
  const outFlag = flag("--out")[0];
  const revision = flag("--revision")[0] ?? null;
  const chainId = Number(flag("--chain-id")[0] ?? 11155111);
  const dev = args.includes("--dev");
  const check = args.includes("--check");
  const minify = !args.includes("--readable");
  const [command, id] = args.filter((a) => !a.startsWith("--"));
  const out = outFlag ? resolve(cwd, outFlag) : join(projects[0] ?? engineRoot, "out");
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const workspace = await readWorkspace(engineRoot, { projects });
  const engineModules = () => dependencyOrder(workspace.filter((w) => w.origin === "engine"));
  const buildAll = async (): Promise<VerifiedModule[]> => {
    const done: VerifiedModule[] = [];
    for (const m of engineModules()) {
      const v = await buildVerifiedModule(m, workspace, engineRoot, { write: !check, fresh: true });
      console.log(`  ${v.id}@${v.version}  ${v.name}.min.js  ${kb(v.bytes.byteLength)}  ${v.outputDigest}  ${v.disposition}`);
      done.push(v);
    }
    return done;
  };
  switch (command) {
    case "prepare": {
      let stale = 0;
      for (const m of engineModules()) {
        const p = await prepareModule(m, workspace, engineRoot);
        const files = check ? staleFiles(p) : writeModuleFiles(p);
        if (files.length) { stale += files.length; console.log(`${m.manifest.id}: ${check ? "stale" : "wrote"} ${files.join(", ")}`); }
      }
      if (check && stale) throw new Error(`${stale} pipeline file(s) are not current: run \`node packages/keel/src/cli.ts prepare\`.`);
      console.log(stale ? `${stale} file(s) ${check ? "stale" : "written"}.` : "Every engine module's pipeline files are current.");
      break;
    }
    case "build": {
      const all = await buildAll();
      console.log(`${all.length} modules built through keel module build, ${all.filter((v) => v.disposition === "reproducible-build").length} reproducible.`);
      break;
    }
    case "test": {
      const all = await buildAll();
      let vectors = 0;
      const failed: string[] = [];
      for (const v of all) {
        const t = await testVerifiedModule(v);
        vectors += t.vectors;
        console.log(`  ${v.id}: ${t.vectors ? `${t.passed ? "passed" : "FAILED"} (${t.vectors} vectors)` : "no vectors"}${t.failures.length ? `: ${t.failures.join("; ")}` : ""}`);
        if (!t.passed || !t.vectors) failed.push(v.id);
      }
      if (failed.length) throw new Error(`Vectors failed or missing: ${failed.join(", ")}`);
      console.log(`${all.length} modules, ${vectors} vectors, each run against the readable build and the shipped bytes.`);
      break;
    }
    case "index": {
      const { readFileSync } = await import("node:fs");
      const version = (JSON.parse(readFileSync(join(engineRoot, "package.json"), "utf8")) as { version: string }).version;
      const catalog = await buildCatalog(await buildAll(), { revision, version });
      if (check) {
        const file = join(engineRoot, ENGINE_CATALOG_FILE);
        if (!existsSync(file) || readFileSync(file, "utf8") !== catalogText(catalog)) throw new Error(`${ENGINE_CATALOG_FILE} is not what the modules index to: run \`node packages/keel/src/cli.ts index\`.`);
        console.log(`${ENGINE_CATALOG_FILE} is current.`);
      } else console.log(`Wrote ${writeCatalog(engineRoot, catalog)}: ${catalog.modules.length} modules, ${catalog.modules.filter((m) => m.verified).length} verified.`);
      break;
    }
    case "reproduce": {
      const runs: Array<Map<string, string>> = [];
      for (const pass of [1, 2]) {
        for (const m of engineModules()) rmSync(join(m.dir, "dist"), { recursive: true, force: true });
        console.log(`build ${pass} (clean dist/):`);
        runs.push(new Map((await buildAll()).map((v) => [v.id, `${v.outputDigest} ${v.receiptDigest}`])));
      }
      const differ = [...runs[0]!].filter(([k, v]) => runs[1]!.get(k) !== v).map(([k]) => k);
      if (differ.length) throw new Error(`Not reproducible: ${differ.join(", ")}`);
      console.log(`${runs[0]!.size} modules: both builds produced identical output and receipt digests.`);
      break;
    }
    case "verify-origin": {
      // (keel module verify, for every module in the committed catalog: fetch keel-web3/keel-engine at the commit,
      // rebuild each module at its path, compare with the catalog's digest. Needs the commit to be public.)
      const commit = flag("--commit")[0] ?? revision;
      if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("verify-origin --commit <full 40-hex sha>");
      const { readFileSync } = await import("node:fs");
      const catalog = JSON.parse(readFileSync(join(engineRoot, ENGINE_CATALOG_FILE), "utf8")) as { modules: Parameters<typeof verifyFromGitHub>[0][] };
      const bad: string[] = [];
      for (const entry of catalog.modules) {
        const r = await verifyFromGitHub(entry, commit);
        console.log(`  ${r.id}: ${r.matches ? "reproduced" : "MISMATCH"} ${r.outputDigest}${r.matches ? "" : ` (catalog ${r.expected})`}`);
        if (!r.matches) bad.push(r.id);
      }
      if (bad.length) throw new Error(`Not reproduced from ${commit}: ${bad.join(", ")}`);
      console.log(`${catalog.modules.length} modules rebuilt from github.com/keel-web3/keel-engine@${commit} to their catalog digests.`);
      break;
    }
    case "plan": {
      // (The release record -- the catalog, deployments filled in -- is the last object; today's catalog stands in for its size.)
      const catalogFile = join(engineRoot, ENGINE_CATALOG_FILE);
      const { readFileSync } = await import("node:fs");
      const plan = await publishPlan(await buildAll(), { chainId, ...(existsSync(catalogFile) ? { catalog: new Uint8Array(readFileSync(catalogFile)) } : {}) });
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "publish-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
      console.log(publishPlanText(plan));
      break;
    }
    case "modules":
      for (const w of workspace) console.log(`${w.manifest.id}@${w.manifest.version}  ${w.manifest.kind}  ${w.origin}  needs [${w.manifest.needs.join(", ")}]${w.manifest.provides.length ? `  provides [${w.manifest.provides.join(", ")}]` : ""}`);
      break;
    case "module": {
      const mod = workspace.find((w) => w.manifest.id === id);
      if (!mod) throw new Error(`No module ${id}.`);
      const b = dev ? await bundleModule(mod, workspace, { minify }) : await buildVerifiedModule(mod, workspace, engineRoot);
      const dir = join(out, "modules", mod.manifest.id, mod.manifest.version);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "module.js"), b.bytes);
      writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(mod.manifest, null, 2)}\n`);
      console.log(`${mod.manifest.id}@${mod.manifest.version} ${kb(b.bytes.byteLength)}${"outputDigest" in b ? ` ${b.outputDigest} (${b.disposition})` : " (dev bundle)"} -> ${dir}`);
      break;
    }
    case "document": {
      if (!id) throw new Error("document <game-id>");
      const audio = !args.includes("--no-audio") && closureOf(id, workspace).some((m) => m.manifest.id === "keel/audio") && existsSync(join(engineRoot, "vendor"));
      const doc = await buildGameDocument(id, workspace, { minify, engineRoot, modules: dev ? "dev" : "verified", ...(audio ? { pageScripts: await keelAudioScripts(join(engineRoot, "vendor")) } : {}) });
      const dir = join(out, "documents", id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), doc.html);
      writeFileSync(join(dir, "report.json"), `${JSON.stringify({ game: id, bytes: dev ? "dev" : "verified", order: doc.resolution.order, modules: doc.modules, document: doc.html.byteLength }, null, 2)}\n`);
      for (const m of doc.modules) console.log(`  ${m.id}@${m.version}  ${m.kind}/${m.phase}@${m.weight}  ${kb(m.bytes)} (${kb(m.stored)} stored)${m.digest ? `  ${m.digest}` : ""}`);
      console.log(`${id}: ${doc.modules.length} modules (${dev ? "dev bundles" : "verified bytes"}), document ${kb(doc.html.byteLength)} -> ${join(dir, "index.html")}`);
      break;
    }
    default:
      console.log("commands: prepare [--check] | build [--check] | test | index [--revision <sha>] [--check] | reproduce | verify-origin --commit <sha> | plan [--chain-id <id>] | modules | module <id> | document <game-id>   [--project <dir>]... [--out <dir>] [--dev] [--readable] [--no-audio]");
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("packages/keel/src/cli.ts")) await run(process.argv.slice(2));
