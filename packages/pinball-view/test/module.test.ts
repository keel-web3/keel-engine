import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleModule, closureOf, engineModuleFiles, linkRecord, readWorkspace, resolveModules } from "@keel-engine/keel";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = await readWorkspace(resolve(directory, "../.."));
const module = workspace.find(item => item.manifest.id === "keel/pinball-view")!;

test("pinball view uses current standard entry/link bytes and only the runtime dependency", async () => {
  assert.ok(module);
  const link = await linkRecord(module, workspace);
  assert.deepEqual(link.imports, { "@keel-engine/runtime": "keel/runtime" });
  for (const [name, contents] of Object.entries(engineModuleFiles(module, link, "packages/pinball-view"))) {
    assert.equal(readFileSync(join(directory, name), "utf8"), contents, name);
  }
});

test("view loads through the real KEEL registry without allocating a canvas or requiring physics", async () => {
  const closure = closureOf(module.manifest.id, workspace);
  const resolution = resolveModules(closure.map(item => item.manifest));
  assert.ok(resolution.ok, JSON.stringify(resolution.problems));
  const page: Record<string, unknown> = { console, TextEncoder, TextDecoder, atob, btoa };
  page.globalThis = page; vm.createContext(page);
  for (const id of resolution.order) vm.runInContext((await bundleModule(closure.find(item => item.manifest.id === id)!, workspace)).code, page);
  const engine = page.KEEL_ENGINE as { start(): Promise<unknown>; get(id: string): Record<string, unknown> };
  await engine.start();
  const api = engine.get("keel/pinball-view");
  assert.equal(typeof api.createPinballView, "function");
  assert.equal(typeof api.createDefaultPinballBiome, "function");
  assert.equal(Object.keys(api.PINBALL_THEME_PALETTES as object).length, 5);
});
