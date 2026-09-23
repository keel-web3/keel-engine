// The engine as KEEL verified modules: each package through the SDK's module
// pipeline (@keel/builder, `keel module build`), the catalog that pins them,
// a stranger's reproduction from a source archive alone, and the resolver that
// picks a version's bytes from chain, a local build, or neither -- and says why.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_CATALOG_FILE, parseEngineRelease } from "../src/index.ts";
import type { EngineCatalog } from "../src/index.ts";
import { MODULE_ENTRY, pipelineName } from "../src/link.ts";
import { buildVerifiedModule, dependencyOrder, prepareModule, staleFiles, verifyFromGitHub } from "../src/pipeline.ts";
import { publishPlan } from "../src/plan.ts";
import { compareToRelease, fetchReadableSource, loadEngineRelease, readableSource, resolveEngineModules, sha256 } from "../src/resolver.ts";
import type { ObjectRef } from "../src/resolver.ts";
import { readWorkspace } from "../src/workspace.ts";
import { archiveFetch, committedFiles, tarGz } from "./archive.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workspace = await readWorkspace(root);
const engine = workspace.filter((w) => w.origin === "engine");
const find = (id: string) => { const w = workspace.find((m) => m.manifest.id === id); assert.ok(w, id); return w; };
const catalog = parseEngineRelease(JSON.parse(readFileSync(join(root, ENGINE_CATALOG_FILE), "utf8")));
const entryOf = (id: string) => { const e = catalog.modules.find((m) => m.id === id); assert.ok(e, id); return e; };
const hex = (b: Uint8Array | string) => `0x${createHash("sha256").update(b).digest("hex")}`;

test("every engine package carries current pipeline files: keel.module.json, tsconfig.json, keel/entry.ts, keel/link.json", async () => {
  assert.equal(engine.length, catalog.modules.length);
  for (const m of engine) {
    const p = await prepareModule(m, workspace, root);
    assert.deepEqual(staleFiles(p), [], `${m.manifest.id}: run \`node packages/keel/src/cli.ts prepare\``);
    const pipeline = JSON.parse(p.files["keel.module.json"]!);
    assert.equal(pipeline.protocol, "keel-module-manifest@1");
    assert.equal(pipeline.license, "MIT");
    assert.equal(pipeline.sourceRepository.url, "https://github.com/keel-web3/keel-engine");
    assert.equal(pipeline.build.format, "iife", "a classic script, as KEEL's module slots run");
    if (m.manifest.id !== "keel/runtime") assert.equal(p.files["keel/entry.ts"], MODULE_ENTRY, "the same entry in every package");
  }
});

test("the committed catalog pins the readable source on disk, file by file, in the registry's start order", () => {
  assert.deepEqual(catalog.order, dependencyOrder(engine).map((w) => w.manifest.id));
  assert.equal(entryOf("keel/render").build.compactSelection, "gzip-9", "render selects the smaller stored object");
  assert.equal(entryOf("keel/audio").build.compactSelection, undefined, "sound keeps its existing build");
  for (const m of catalog.modules) {
    const w = find(m.id);
    assert.equal(m.version, w.manifest.version);
    assert.equal(m.name, pipelineName(w));
    assert.equal(m.verified, true, `${m.id} is verified`);
    assert.equal(m.disposition, "reproducible-build");
    assert.ok(m.sourceFiles.some((f) => f.path === m.githubPath), "the entry is a pinned input");
    for (const f of m.sourceFiles) assert.equal(hex(readFileSync(join(root, f.path))), f.sha256, `${f.path} is what the catalog pinned (rebuild and re-index)`);
    assert.ok(m.vectors, `${m.id} has vectors`);
    assert.equal(hex(readFileSync(join(root, m.vectors.path))), m.vectors.sha256);
    assert.deepEqual(m.deployments, [], "verified, not deployed: the normal starting state");
  }
});

test("verified bytes are the catalog's, run on a page, link through ctx.use, and leave nothing behind", async () => {
  const ids = ["keel/runtime", "keel/core", "keel/scene"];
  const built = [];
  for (const id of ids) built.push(await buildVerifiedModule(find(id), workspace, root));
  for (const v of built) {
    assert.equal(v.outputDigest, entryOf(v.id).output.digest, `${v.id} rebuilds to the catalog's digest`);
    assert.equal(hex(v.bytes), v.outputDigest);
    assert.equal(v.disposition, "reproducible-build");
  }
  assert.deepEqual(built[2]!.external, ["@keel-engine/core"], "scene links core; it doesn't copy it");
  const page: Record<string, unknown> = { console, atob, btoa, TextEncoder, TextDecoder };
  page["globalThis"] = page;
  vm.createContext(page);
  for (const v of built) vm.runInContext(new TextDecoder().decode(v.bytes), page);
  const E = page["KEEL_ENGINE"] as { start(): Promise<unknown>; get<T>(id: string): T };
  await E.start();
  const scene = E.get<{ box(c: number[], h: number[]): { f(x: number, y: number, z: number): number } }>("keel/scene");
  assert.ok(Math.abs(scene.box([0, 1, 0], [1, 1, 1]).f(3, 1, 0) - 2) < 0.02, "scene works, core reached through its context");
  assert.equal("require" in page, false, "the linking lookup is gone once the package has evaluated");
});

test("a stranger with only the source archive rebuilds the exact published bytes (keel module verify), and a flipped byte is caught", { skip: !existsSync(join(root, ".git")) && "not a git checkout" }, async () => {
  const files = committedFiles(root);
  assert.ok(![...files.keys()].some((p) => p.includes("node_modules/") || /(^|\/)dist\//.test(p) || p.startsWith("out/")), "the archive is only what git would commit");
  const commit = "0".repeat(40);
  const archive = tarGz(`keel-engine-${commit}`, files);
  for (const id of ["keel/runtime", "keel/scene", "packs/animals"]) {
    const asked: string[] = [];
    const r = await verifyFromGitHub(entryOf(id), commit, archiveFetch(archive, asked));
    assert.ok(asked[0]?.startsWith("https://codeload.github.com/keel-web3/keel-engine/"), asked[0]);
    assert.equal(r.reproduced, true, `${id} reproduces`);
    assert.equal(r.outputDigest, entryOf(id).output.digest, `${id}: the archive rebuilds to the published digest`);
    assert.equal(r.matches, true);
  }
  // (Tamper: one character of scene's readable source, in code the minifier keeps.)
  const path = "packages/scene/src/index.ts";
  const text = new TextDecoder().decode(files.get(path)!);
  const tampered = new Map(files);
  tampered.set(path, new TextEncoder().encode(`${text}\nexport const tampered = 1;\n`));
  const r = await verifyFromGitHub(entryOf("keel/scene"), commit, archiveFetch(tarGz(`keel-engine-${commit}`, tampered)));
  assert.equal(r.matches, false, "a changed source doesn't match the published digest");
});

// ------------------------------------------------------------ the resolver

/** A release as the chain would hold it: the catalog, pinned to a commit, with every module deployed on 31337. */
function releaseOf(c: EngineCatalog, objects: Map<string, Uint8Array>): EngineCatalog {
  const hold = "0x000000000000000000000000000000000000beef";
  return {
    ...c,
    revision: "1".repeat(40),
    modules: c.modules.map((m) => {
      const objectId = `0x${createHash("sha256").update(m.id).digest("hex")}`;
      const dist = join(root, m.sourceRepository.path, "dist", `${m.name}.min.js`);
      if (existsSync(dist)) objects.set(objectId, new Uint8Array(readFileSync(dist)));
      return { ...m, sourceRepository: { ...m.sourceRepository, revision: "1".repeat(40) }, deployed: true, deployments: [{ chainId: 31337, hold: { address: hold, objectId }, version: m.version, outputDigest: m.output.digest, receiptDigest: m.receiptDigest, block: null, txHash: null, publishedAt: "2026-09-14", status: "current" as const }] };
    }),
  };
}

test("the resolver takes a version's bytes from chain, verified digest by digest; a local build is compared, never silently preferred", async () => {
  const objects = new Map<string, Uint8Array>();
  for (const id of ["keel/runtime", "keel/core", "keel/scene", "keel/entity", "packs/animals"]) await buildVerifiedModule(find(id), workspace, root);
  const release = releaseOf(catalog, objects);
  const releaseBytes = new TextEncoder().encode(JSON.stringify(release));
  const RELEASE_ID = `0x${"e".repeat(64)}`;
  objects.set(RELEASE_ID, releaseBytes);
  const reads: ObjectRef[] = [];
  const read = async (ref: ObjectRef) => { reads.push(ref); const b = objects.get(ref.objectId); if (!b) throw new Error("no such object"); return b; };
  const pin = { version: release.version, chainId: 31337, hold: "0x000000000000000000000000000000000000beef", objectId: RELEASE_ID, digest: await sha256(releaseBytes) };

  const loaded = await loadEngineRelease(pin, read);
  await assert.rejects(loadEngineRelease({ ...pin, digest: `0x${"0".repeat(64)}` }, read), /hashes to/, "a pin is a digest: another record is refused");

  const resolved = await resolveEngineModules(loaded, ["packs/animals"], { chainId: 31337, read });
  assert.deepEqual(resolved.map((r) => r.id), ["keel/runtime", "keel/core", "keel/scene", "keel/entity", "packs/animals"], "the closure, in start order");
  for (const r of resolved) {
    assert.equal(r.onchain, "verified", r.id);
    assert.equal(r.from, "chain");
    assert.equal(await sha256(r.bytes!), r.digest);
  }

  // (A tampered object on chain: refused, with the digest it actually has.)
  const scene = loaded.modules.find((m) => m.id === "keel/scene")!.deployments[0]!.hold.objectId;
  const good = objects.get(scene)!;
  objects.set(scene, new Uint8Array([...good, 32]));
  const [bad] = (await resolveEngineModules(loaded, ["keel/scene"], { chainId: 31337, read })).filter((r) => r.id === "keel/scene");
  assert.equal(bad!.onchain, "mismatch");
  assert.equal(bad!.bytes, null);

  // (Local checkout: its digests compared with the release's. Where the chain's bytes can't be had, a matching local build is the same bytes.)
  const localScene = await buildVerifiedModule(find("keel/scene"), workspace, root);
  const withLocal = (await resolveEngineModules(loaded, ["keel/scene"], { chainId: 31337, read, local: [localScene] })).find((r) => r.id === "keel/scene")!;
  assert.equal(withLocal.onchain, "mismatch");
  assert.equal(withLocal.local, "match");
  assert.equal(withLocal.from, "local");
  objects.set(scene, good);
  const offChain = (await resolveEngineModules(loaded, ["keel/scene"], { chainId: 1, local: [localScene] })).find((r) => r.id === "keel/scene")!;
  assert.equal(offChain.onchain, "not-deployed");
  assert.equal(offChain.from, "local");
  const rows = compareToRelease(loaded, [localScene, { ...localScene, id: "keel/core", outputDigest: `0x${"0".repeat(64)}` }]);
  assert.equal(rows.find((r) => r.id === "keel/scene")!.status, "match");
  assert.equal(rows.find((r) => r.id === "keel/core")!.status, "mismatch");
  assert.equal(rows.find((r) => r.id === "keel/view")!.status, "absent");
});

test("the resolver points at the readable source on GitHub, checks every file against the recipe's digest, and names the verify command", async () => {
  const release = releaseOf(catalog, new Map());
  assert.match(readableSource(release, "keel/render").verifyCommand ?? "", / --gzip-compact --expect /);
  const src = readableSource(release, "keel/scene");
  assert.equal(src.commit, "1".repeat(40));
  assert.ok(src.files.every((f) => f.url?.startsWith(`https://raw.githubusercontent.com/keel-web3/keel-engine/${"1".repeat(40)}/packages/scene/`)));
  assert.equal(src.verifyCommand, `keel module verify --repo keel-web3/keel-engine --commit ${"1".repeat(40)} --path packages/scene --entry keel/entry.ts --format iife --external @keel-engine/core --expect ${entryOf("keel/scene").output.digest}`);
  const served = (tamper: boolean): typeof fetch => (async (url: string | URL | Request) => {
    const path = String(url).split(`${"1".repeat(40)}/`)[1]!;
    const bytes = new Uint8Array(readFileSync(join(root, path)));
    return new Response((tamper && path.endsWith("index.ts") ? new Uint8Array([...bytes, 10]) : bytes) as Uint8Array<ArrayBuffer>);
  }) as typeof fetch;
  const files = await fetchReadableSource(release, "keel/scene", served(false));
  assert.deepEqual([...files.keys()].sort(), src.files.map((f) => f.path).sort());
  await assert.rejects(fetchReadableSource(release, "keel/scene", served(true)), /hashes to/);
});

test("the publish plan is a dry run: sizes, carriers and modelled gas from the verified bytes, nothing signed or sent", async () => {
  const built = [];
  for (const id of ["keel/runtime", "keel/core"]) built.push(await buildVerifiedModule(find(id), workspace, root));
  const plan = await publishPlan(built, { chainId: 11155111 });
  assert.equal(plan.status, "dry-run");
  assert.equal(plan.signing, "not-performed");
  assert.equal(plan.submission, "not-performed");
  for (const m of plan.modules) {
    assert.ok(m.stored > 0 && m.stored < m.bytes);
    assert.equal(m.carriers, Math.ceil(m.stored / 23_000));
    assert.equal(m.transactions, Math.ceil(m.carriers / 3) + 1);
  }
  assert.equal(plan.totals.gas, plan.modules.reduce((s, m) => s + m.gas, 0));
});
