// The KEEL build: the builder bundles into one module that reaches only what
// its manifest needs, starts on a page (a VM standing in for KEEL's frame)
// with just its closure loaded, and does its work there -- a creature
// generated, rigged and posed, a pack file's voxels decoded.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleModule, closureOf, linkRecord, readWorkspace, resolveModules } from "@keel-engine/keel";
import { splitRef } from "@keel-engine/runtime";

const ID = "keel/builder";
const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, "..");
const root = resolve(pkgDir, "..", "..");

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

test(`${ID} bundles to a module that reaches only what it needs, and works on a page`, async () => {
  const workspace = await readWorkspace(root);
  const me = workspace.find((w) => w.manifest.id === ID)!;
  assert.ok(me, `${ID} is in the workspace`);
  const b = await bundleModule(me, workspace);
  const map = (await linkRecord(me, workspace)).imports;
  const needs = new Set(me.manifest.needs.filter((n) => !n.startsWith("contract:")).map((n) => splitRef(n).name));
  for (const id of Object.values(map)) assert.ok(needs.has(id), `${ID} reaches ${id} without needing it`);
  console.log(`\n${ID}: ${b.bytes.length} bytes minified, ${gzipSync(b.bytes, { level: 9 }).length} gzip'd`);
  const closure = closureOf(ID, workspace);
  const r = resolveModules(closure.map((c) => c.manifest));
  assert.ok(r.ok, r.problems.map((p) => `${p.module}: ${p.detail}`).join("\n"));
  const page: Record<string, unknown> = { console, TextEncoder, TextDecoder, atob, btoa };
  page["globalThis"] = page;
  vm.createContext(page);
  for (const id of r.order) vm.runInContext((await bundleModule(closure.find((c) => c.manifest.id === id)!, workspace)).code, page);
  const engine = page["KEEL_ENGINE"] as { start(): Promise<unknown>; get(id: string): Record<string, (...a: unknown[]) => unknown> };
  await engine.start();
  const api = engine.get(ID);
  const g = api["generate"]!("critter", "3", { plan: "quadruped" }) as { model: unknown };
  const rig = api["autoRig"]!(g.model) as { plan: string; missing: string[]; skin: { boxes: unknown[] } };
  assert.equal(rig.plan, "quadruped");
  assert.deepEqual([...rig.missing], []);
  assert.ok(rig.skin.boxes.length > 0);
  const text = api["voxelsToText"]!(g.model) as string;
  assert.equal((api["decodeVoxels"]!(text) as { count: number }).count, (g.model as { count: number }).count);
});
