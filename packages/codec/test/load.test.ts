// Schemas registered at load: setup(ctx) puts the engine's schemas and every
// defined module's embedded ones into the default registry, once; entries
// without their bytes wait in pendingSchemas(); a bad entry is reported, not
// fatal. Through a real engine too, the way a page's KEEL bundle calls it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine, defineManifest } from "@keel-engine/runtime";
import {
  createRegistry, defaultRegistry, encode, lookupSchema, named, pendingSchemas, readDocument, registerManifests, registerSchema, schemaEntry, schemaId, setup, string,
  struct, uint,
} from "../src/index.ts";

const TILE = named("tests/load/tile", struct({ hue: uint(9), name: string() }));
const LATER = named("tests/load/later", struct({ n: uint(4) }));
const BAD = named("tests/load/bad", struct({ x: uint(3) }));

const pack = defineManifest({
  id: "tests/tiles", version: "1.0.0", kind: "pack",
  contents: { schemas: [schemaEntry(TILE), schemaEntry(LATER, { embed: false }), { ...schemaEntry(BAD), hash: "00".repeat(32) }] },
});

test("setup registers the engine's schemas and every embedded manifest schema; the rest wait, bad ones are reported", () => {
  const doc = encode(TILE, { hue: 300, name: "moss" });
  assert.throws(() => readDocument(doc), /isn't in the registry/);
  const report = setup({ modules: () => [pack] });
  assert.ok(lookupSchema("keel/builder/voxels@1"), "the engine's own schemas");
  assert.ok(lookupSchema("keel/object@1"));
  assert.equal(schemaId(lookupSchema("tests/load/tile@1")!), schemaId(TILE));
  assert.deepEqual(readDocument(doc).value, { hue: 300, name: "moss" });
  assert.deepEqual(report.registered, ["tests/load/tile@1"]);
  assert.deepEqual(report.pending.map((p) => [p.module, p.entry.id]), [["tests/tiles", "tests/load/later@1"]]);
  assert.deepEqual(report.problems.map((p) => [p.module, p.id]), [["tests/tiles", "tests/load/bad@1"]]);
  assert.match(report.problems[0]!.detail, /hash/);
  assert.ok(!defaultRegistry.has("tests/load/bad@1"));
  // (The module registers what it didn't embed; then nothing is pending.)
  registerSchema("tests/load/later@1", LATER);
  assert.deepEqual(pendingSchemas(), []);
});

test("setup is idempotent, and picks up modules defined since", () => {
  const first = setup({ modules: () => [pack] });
  const again = setup({ modules: () => [pack] });
  assert.deepEqual(again.registered, first.registered);
  assert.equal(again.problems.length, first.problems.length, "the same entries aren't retried");
  const ROCK = named("tests/load/rock", struct({ size: uint(5) }));
  const more = defineManifest({ id: "tests/rocks", version: "0.2.0", kind: "pack", contents: { schemas: [schemaEntry(ROCK)] } });
  const next = setup({ modules: () => [pack, more] });
  assert.deepEqual(next.registered, [...first.registered, "tests/load/rock@1"]);
  assert.deepEqual(readDocument(encode(ROCK, { size: 17 })).value, { size: 17 });
});

test("another registry gets its own engine schemas and its own report", () => {
  const reg = createRegistry();
  const r = registerManifests([pack], reg);
  assert.deepEqual(r.registered, ["tests/load/tile@1"]);
  assert.ok(reg.has("keel/look@1") && reg.has("tests/load/tile@1"));
  assert.equal(r.pending.length, 1, "LATER isn't in this registry");
});

test("through an engine: the codec's setup, in the data phase, sees every defined module before it starts", async () => {
  const engine = createEngine();
  const CRATE = named("tests/load/crate", struct({ slats: uint(4) }));
  const codec = defineManifest({ id: "keel/codec", version: "0.1.0", kind: "runtime", phase: "data", weight: -31000 });
  engine.define(codec, (ctx) => { setup(ctx); return { lookupSchema }; });
  engine.define(defineManifest({ id: "tests/crates", version: "1.0.0", kind: "pack", contents: { schemas: [schemaEntry(CRATE)] } }), () => {
    // (By the time a pack starts, its documents already read.)
    return { first: readDocument(encode(CRATE, { slats: 9 })).value };
  });
  await engine.start();
  assert.deepEqual(engine.get("tests/crates"), { first: { slats: 9 } });
  assert.equal(engine.get<{ lookupSchema: typeof lookupSchema }>("keel/codec").lookupSchema("tests/load/crate@1"), lookupSchema("tests/load/crate@1"));
});
