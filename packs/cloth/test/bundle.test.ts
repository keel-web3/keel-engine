// The KEEL build: this package bundles into one KEEL module whose code reaches
// only the modules its manifest needs (every engine import becomes a lookup
// through its context), its own source never reaches into another package,
// and it starts on a page (a VM standing in for KEEL's frame) with just what
// it needs loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleModule, closureOf, linkRecord, readWorkspace, resolveModules } from "@keel-engine/keel";
import { splitRef } from "@keel-engine/runtime";

const ID = "packs/cloth";
const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const root = resolve(pkgDir, "..", "..");
const workspace = await readWorkspace(root);
const me = workspace.find((w) => w.manifest.id === ID)!;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sources(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : []));
}

test(`${ID} imports other packages only by name, never by path`, () => {
  for (const file of sources(join(pkgDir, "src"))) {
    for (const m of readFileSync(file, "utf8").matchAll(/\bfrom\s+"(\.[^"]+)"/g)) {
      assert.ok(resolve(dirname(file), m[1]!).startsWith(join(pkgDir, "src")), `${file}: ${m[1]} leaves the package`);
    }
  }
});

test(`${ID} bundles to a module that reaches only what it needs, and starts on a page`, async () => {
  assert.ok(me, `${ID} is in the workspace`);
  const b = await bundleModule(me, workspace);
  const map = (await linkRecord(me, workspace)).imports;
  const needs = new Set(me.manifest.needs.filter((n) => !n.startsWith("contract:")).map((n) => splitRef(n).name));
  for (const id of Object.values(map)) assert.ok(needs.has(id), `${ID} reaches ${id} without needing it`);
  assert.deepEqual(Object.values(map).sort(), ["keel/runtime"]);
  const closure = closureOf(ID, workspace);
  const r = resolveModules(closure.map((c) => c.manifest));
  assert.ok(r.ok, r.problems.map((p) => `${p.module}: ${p.detail}`).join("\n"));
  const page: Record<string, unknown> = { console, TextEncoder, TextDecoder, atob, btoa };
  page["globalThis"] = page;
  vm.createContext(page);
  for (const id of r.order) vm.runInContext((await bundleModule(closure.find((c) => c.manifest.id === id)!, workspace)).code, page);
  const engine = page["KEEL_ENGINE"] as { start(): Promise<unknown>; get(id: string): Record<string, unknown> };
  await engine.start();
  const api = engine.get(ID);
  const pack = api["pack"] as { attributes: Array<{ id: string }> };
  assert.equal(pack.attributes.length, 13);
});
