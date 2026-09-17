// The KEEL build: engine packages become classic-script modules that define
// themselves on KEEL_ENGINE, reach only what they declared, and assemble into
// a KEEL local document -- checked here without a browser (a VM stands in for
// the page's child frame).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encode, encodeSchema, schemaEntry, schemaId, toBase64 } from "@keel-engine/codec";
import { defineManifest } from "@keel-engine/runtime";
import { bundleModule } from "../src/bundle.ts";
import { buildGameDocument, closureOf, keelAudioScripts } from "../src/document.ts";
import { MODULE_ENTRY, entryFor } from "../src/link.ts";
import { readProject, readWorkspace, schemasOf, withSchemas } from "../src/workspace.ts";
import { BLOB } from "./fixtures/hello/pack/src/schemas.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// (A project outside the engine, reaching it by package name, as any creator's would.)
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hello");
const workspace = await readWorkspace(root, { projects: [fixture] });
const find = (id: string) => { const w = workspace.find((m) => m.manifest.id === id); assert.ok(w, id); return w; };

async function runOnPage(ids: readonly string[], minify: boolean, globals: Record<string, unknown> = {}) {
  const page: Record<string, unknown> = { console, ...globals };
  page["globalThis"] = page;
  vm.createContext(page);
  for (const id of ids) vm.runInContext((await bundleModule(find(id), workspace, { minify })).code, page);
  const engine = page["KEEL_ENGINE"] as { start(): Promise<unknown>; get(id: string): unknown };
  await engine.start();
  return Object.assign(engine, { page });
}

test("the workspace lists its modules", () => {
  for (const id of ["keel/runtime", "fixtures/hello-pack", "fixtures/hello"]) assert.ok(workspace.some((w) => w.manifest.id === id), id);
});

test("modules define themselves on the page and start, minified or not", async () => {
  for (const minify of [false, true]) {
    const engine = await runOnPage(["keel/runtime", "fixtures/hello-pack", "fixtures/hello"], minify);
    const game = engine.get("fixtures/hello") as { main: unknown; setup: unknown };
    assert.equal(typeof game.main, "function");
    const pack = engine.get("fixtures/hello-pack") as { pack: { entities: unknown[] } };
    assert.equal(pack.pack.entities.length, 2);
  }
});

test("a module can't import an engine package it didn't declare", async () => {
  const game = find("fixtures/hello");
  const undeclared = { ...game, manifest: defineManifest({ ...game.manifest, needs: ["contract:body/blob@^1"] }) };
  await assert.rejects(bundleModule(undeclared, workspace), /doesn't need keel\/runtime/);
});

test("a game's closure takes every provider of a contract it needs, and the registry", () => {
  const ids = closureOf("fixtures/hello", workspace).map((m) => m.manifest.id).sort();
  assert.deepEqual(ids, ["fixtures/hello", "fixtures/hello-pack", "keel/runtime"]);
});

test("a game becomes a KEEL local document, modules in slot order", async () => {
  const doc = await buildGameDocument("fixtures/hello", workspace);
  assert.deepEqual(doc.resolution.order, ["keel/runtime", "fixtures/hello-pack", "fixtures/hello"]);
  const html = new TextDecoder().decode(doc.html);
  assert.ok(html.startsWith("<!doctype html>") || html.includes("<html"), "an html document");
  for (const m of doc.modules) assert.ok(m.stored > 0 && m.stored < m.bytes, `${m.id} is stored compressed`);
});


test("page scripts (Tone, keel-audio) go in as classic runtime slots at KEEL's audio weights, before the modules", async () => {
  const scripts = await keelAudioScripts(join(root, "vendor"));
  assert.deepEqual(scripts.map((s) => [s.id, s.weight]), [["tone-native", -200], ["keel-audio", -100]]);
  const doc = await buildGameDocument("fixtures/hello", workspace, { pageScripts: scripts });
  const slots = doc.document.parts.flatMap((p) => (p.kind === "existing" && p.role === "module" ? [[p.moduleId, p.execution, p.phase, p.weight]] : []));
  const at = (id: string) => slots.findIndex((s) => s[0] === id);
  assert.deepEqual(slots[at("tone-native")], ["tone-native", "classic", "runtime", -200]);
  assert.deepEqual(slots[at("keel-audio")], ["keel-audio", "classic", "runtime", -100]);
  assert.ok(at("tone-native") < at("keel-audio") && at("keel-audio") < at("fixtures/hello"), "Tone, then keel-audio, then the game");
  const tone = doc.modules.find((m) => m.id === "tone-native");
  assert.ok(tone && tone.kind === "page-script" && tone.bytes === scripts[0]!.bytes.byteLength && tone.stored < tone.bytes);
  const plain = await buildGameDocument("fixtures/hello", workspace);
  assert.ok(doc.html.byteLength > plain.html.byteLength + 50_000, "Tone is in the document");
});

test("the vendored page scripts are exactly KEEL's registered Tone and keel-audio objects (published once, shared by every piece)", async () => {
  const { createHash } = await import("node:crypto");
  const { KEEL_AUDIO_RUNTIME, KEEL_TONE_15 } = await import("@keel/sdk");
  const scripts = await keelAudioScripts(join(root, "vendor"));
  for (const [script, registered] of [[scripts[0]!, KEEL_TONE_15], [scripts[1]!, KEEL_AUDIO_RUNTIME]] as const) {
    assert.equal(`sha256:${createHash("sha256").update(script.bytes).digest("hex")}`, registered.digest, `${script.id} is KEEL's ${registered.id}@${registered.version}`);
    assert.equal(script.bytes.byteLength, registered.byteLength);
  }
});

test("a package's src/schemas.ts: every named codec schema it exports rides in its manifest, bytes embedded", async () => {
  const pack = find("fixtures/hello-pack");
  const blob = pack.manifest.contents?.schemas?.find((e) => e.id === "fixtures/hello/blob@1");
  assert.deepEqual(blob, { id: "fixtures/hello/blob@1", hash: schemaId(BLOB), schema: toBase64(encodeSchema(BLOB)) });
  assert.equal(pack.manifest.contents?.entities?.length, 2, "the manifest's own contents stay");
  assert.ok(Object.isFrozen(pack.manifest), "a manifest as defineManifest makes one");
  assert.deepEqual(await schemasOf(find("fixtures/hello").dir), [], "no src/schemas.ts, nothing added");
  // (An entry the manifest lists itself wins over the export of the same id.)
  const own = { id: "fixtures/hello/blob@1", hash: schemaId(BLOB) };
  const kept = await withSchemas(defineManifest({ id: "fixtures/other", version: "1.0.0", kind: "pack", contents: { schemas: [own] } }), pack.dir);
  assert.deepEqual(kept.contents?.schemas, [own]);
  // (The bundled module's define() carries it: on the page, the manifest the registry holds has the entry, bytes and all.)
  const engine = await runOnPage(["keel/runtime", "fixtures/hello-pack"], false);
  const onPage = (engine as unknown as { list(): Array<{ id: string; contents?: { schemas?: unknown[] } }> }).list().find((m) => m.id === "fixtures/hello-pack");
  assert.deepEqual(JSON.parse(JSON.stringify(onPage?.contents?.schemas)), [schemaEntry(BLOB)], "the bundled module's define() carries it");
});

test("on the page, keel/codec registers every module's embedded schemas before anything starts", async () => {
  for (const minify of [false, true]) {
    const engine = await runOnPage(["keel/runtime", "keel/codec", "fixtures/hello-pack"], minify, { TextEncoder, TextDecoder });
    const codec = engine.get("keel/codec") as {
      lookupSchema(key: string): unknown;
      readDocument(bytes: Uint8Array): { value: unknown };
      pendingSchemas(): readonly unknown[];
      schemaLoadReport(): { registered: readonly string[] };
    };
    assert.ok(codec.lookupSchema("fixtures/hello/blob@1"), "the pack's schema, by name");
    assert.ok(codec.lookupSchema(schemaId(BLOB)), "and by id");
    assert.ok(codec.lookupSchema("keel/builder/voxels@1"), "the engine's own schemas");
    assert.deepEqual([...codec.schemaLoadReport().registered], ["fixtures/hello/blob@1"]);
    assert.equal(codec.pendingSchemas().length, 0);
    // (A document written in Node reads on the page from its header alone.)
    const doc = encode(BLOB, { hue: 271 });
    const bytes = (vm.runInContext("Uint8Array", engine.page) as typeof Uint8Array).from(doc);
    assert.deepEqual(JSON.parse(JSON.stringify(codec.readDocument(bytes).value)), { hue: 271 });
  }
});

test("a module may read another's manifest (<package>/module): the build puts the manifest in as data, if it's needed", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "keel-manifest-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.ts"), 'import { manifest } from "@keel-engine/runtime/module";\nexport const runtimeVersion = manifest.version;\n');
  const reader = { manifest: defineManifest({ id: "fixtures/reader", version: "0.1.0", kind: "game", needs: ["keel/runtime@^0.1"] }), packageName: "@fixture/reader", dir, origin: "project" as const };
  const page: Record<string, unknown> = { console };
  page["globalThis"] = page;
  vm.createContext(page);
  vm.runInContext((await bundleModule(find("keel/runtime"), workspace)).code, page);
  vm.runInContext((await bundleModule(reader, [...workspace, reader])).code, page);
  const engine = page["KEEL_ENGINE"] as { start(): Promise<unknown>; get(id: string): unknown };
  await engine.start();
  assert.equal((engine.get("fixtures/reader") as { runtimeVersion: string }).runtimeVersion, find("keel/runtime").manifest.version);
  const undeclared = { ...reader, manifest: defineManifest({ ...reader.manifest, needs: [] }) };
  await assert.rejects(bundleModule(undeclared, [...workspace, undeclared]), /doesn't need keel\/runtime/);
});

test("TypeScript is the default, not a requirement: a project in plain JavaScript is found, linked and runs the same way", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "keel-plain-js-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "package.json"), '{ "name": "@fixture/plain", "private": true, "type": "module" }\n');
  const manifest = defineManifest({ id: "fixtures/plain", version: "0.1.0", kind: "game", needs: ["keel/runtime@^0.1"] });
  writeFileSync(join(dir, "src", "module.js"), `export const manifest = ${JSON.stringify(manifest)};\n`);
  writeFileSync(join(dir, "src", "greet.js"), "export const greet = (v) => `runtime ${v}`;\n");
  writeFileSync(join(dir, "src", "index.js"), 'import { manifest } from "@keel-engine/runtime/module";\nimport { greet } from "./greet.js";\nexport const hello = greet(manifest.version);\n');
  const [plain] = await readProject(dir);
  assert.ok(plain, "src/module.js makes it a module");
  assert.equal(plain.manifest.id, "fixtures/plain");
  assert.match(entryFor(plain), /require\("\.\.\/src\/index\.js"\)/);
  assert.equal(entryFor(find("fixtures/hello")), MODULE_ENTRY, "a TypeScript module's entry is unchanged");
  const page: Record<string, unknown> = { console };
  page["globalThis"] = page;
  vm.createContext(page);
  vm.runInContext((await bundleModule(find("keel/runtime"), workspace)).code, page);
  vm.runInContext((await bundleModule(plain, [...workspace, plain])).code, page);
  const engine = page["KEEL_ENGINE"] as { start(): Promise<unknown>; get(id: string): unknown };
  await engine.start();
  assert.equal((engine.get("fixtures/plain") as { hello: string }).hello, `runtime ${find("keel/runtime").manifest.version}`);
});
