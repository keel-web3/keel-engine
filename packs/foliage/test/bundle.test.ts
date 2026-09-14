// The KEEL build: packs/foliage bundles into one KEEL module that reaches only
// keel/object (every engine import a lookup through its context), never
// reaches into another package by path, starts on a page (a VM standing in for
// KEEL's frame) with just its closure loaded -- and builds its things there, in
// pixel; with keel/builder on the page too, in voxel (the builder registers
// the voxel style with keel/object's registry as it loads). Sizes are printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleModule, closureOf, linkRecord, readWorkspace, resolveModules } from "@keel-engine/keel";
import { splitRef } from "@keel-engine/runtime";

const ID = "packs/foliage";
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

async function page(ids: readonly string[]) {
  const closure = [...new Map(ids.flatMap((id) => closureOf(id, workspace)).map((c) => [c.manifest.id, c])).values()];
  const r = resolveModules(closure.map((c) => c.manifest));
  assert.ok(r.ok, r.problems.map((p) => `${p.module}: ${p.detail}`).join("\n"));
  const ctx: Record<string, unknown> = { console, TextEncoder, TextDecoder, atob, btoa };
  ctx["globalThis"] = ctx;
  vm.createContext(ctx);
  let bytes = 0;
  for (const id of r.order) { const b = await bundleModule(closure.find((c) => c.manifest.id === id)!, workspace); bytes += b.bytes.length; vm.runInContext(b.code, ctx); }
  const engine = ctx["KEEL_ENGINE"] as { start(): Promise<unknown>; get(id: string): Record<string, unknown> };
  await engine.start();
  return { engine, order: r.order, bytes };
}

type Pack = { objects: Array<{ id: string; build(o: object): { style: string; def: { parts: unknown[] } } }> };

test(`${ID} bundles to a module that reaches only keel/core (dmath) and keel/object, starts on a page and builds its things there`, async () => {
  assert.ok(me, `${ID} is in the workspace`);
  const b = await bundleModule(me, workspace);
  const map = (await linkRecord(me, workspace)).imports;
  const needs = new Set(me.manifest.needs.filter((n) => !n.startsWith("contract:")).map((n) => splitRef(n).name));
  for (const id of Object.values(map)) assert.ok(needs.has(id), `${ID} reaches ${id} without needing it`);
  assert.deepEqual(Object.values(map).sort(), ["keel/core", "keel/object"]);
  const object = await bundleModule(workspace.find((w) => w.manifest.id === "keel/object")!, workspace);
  const readable = await bundleModule(me, workspace, { minify: false });
  const { engine, order, bytes } = await page([ID]);
  const pack = engine.get(ID)["pack"] as Pack;
  for (const o of pack.objects) {
    const built = o.build({ seed: 1, style: "voxel" });
    // (No builder on this page: a voxel request draws pixel.)
    assert.equal(built.style, "pixel", o.id);
    assert.ok(built.def.parts.length > 0);
  }
  console.log(`${ID}: ${b.bytes.length} B minified (${gzipSync(b.bytes).length} B gzip, KEEL's stored form); ${readable.bytes.length} B readable; keel/object with the style contract: ${object.bytes.length} B (${gzipSync(object.bytes).length} B gzip); the page's closure ${order.join(", ")}: ${bytes} B`);
});

test(`${ID} on a page with keel/builder: the voxel style is there`, async () => {
  const { engine } = await page([ID, "keel/builder"]);
  const pack = engine.get(ID)["pack"] as Pack;
  const o = pack.objects[1]!;
  assert.equal(o.build({ seed: 1, style: "voxel" }).style, "voxel");
});
