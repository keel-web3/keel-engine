// The storage seam on the bit codec: every generated and hand-built model
// round-trips through its codec document (bytes and "KC1:" text), the old KV1
// bytes and text and the old JSON op lists and data still load, every op in
// OPS stores and loads, and asset data keeps -0 and its nesting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { HEADER_ID, readHeader, shortId, VOXELS } from "@keel-engine/codec";
import {
  GENERATOR_KINDS, OPS, STORE_FORMAT, createVoxels, encodeVoxels, generate, loadData, loadOps, loadVoxels, roleCounts, sameVoxels, storeData, storeOps, storeVoxels,
  storeVoxelsText, voxelsToText,
} from "../src/index.ts";
import type { VoxelModel } from "../src/index.ts";
import { blockPerson, dog, doorway, flag, knight, topHat } from "./models.ts";

const SEEDS = ["1", "7", "42"];
const rolesInUse = (m: VoxelModel) => Object.keys(roleCounts(m)).sort();

/** Same model back: cells by role, unit, origin, groups (sameVoxels), and its name and the roles it uses. */
function assertSame(back: VoxelModel, m: VoxelModel, what: string): void {
  assert.ok(sameVoxels(back, m), `${what}: the same cells, unit, origin and groups`);
  assert.equal(back.name, m.name, `${what}: its name`);
  assert.deepEqual(rolesInUse(back), rolesInUse(m), `${what}: the roles it uses`);
  assert.deepEqual([...back.groups.keys()], [...m.groups.keys()].filter((k) => m.groups.get(k)!.length), `${what}: its groups, in order`);
}

function models(): Array<[string, VoxelModel]> {
  const out: Array<[string, VoxelModel]> = [];
  for (const kind of GENERATOR_KINDS) for (const seed of SEEDS) out.push([`${kind} ${seed}`, generate(kind, seed).model]);
  for (const plan of ["humanoid", "quadruped"] as const) out.push([`critter ${plan}`, generate("critter", "5", { plan }).model]);
  for (const make of [blockPerson, dog, knight, topHat, flag, doorway]) out.push([make.name, make()]);
  return out;
}

test("every generated and hand-built model round-trips through its codec document, bytes and text; sizes against KV1", () => {
  let kv1 = 0, kc = 0, kv1gz = 0, kcgz = 0, kv1Text = 0, kcText = 0;
  for (const [what, m] of models()) {
    const bytes = storeVoxels(m);
    assert.equal(bytes[0], HEADER_ID, `${what}: a codec document`);
    assert.equal(readHeader(bytes).id, shortId(VOXELS), `${what}: written with ${STORE_FORMAT.voxels}`);
    assertSame(loadVoxels(bytes), m, `${what} (bytes)`);
    const text = storeVoxelsText(m);
    assert.ok(text.startsWith(`${STORE_FORMAT.voxelsText}:`), `${what}: text behind its tag`);
    assertSame(loadVoxels(text), m, `${what} (text)`);
    assert.deepEqual(storeVoxels(loadVoxels(bytes)), bytes, `${what}: stores to the same bytes again`);
    const old = encodeVoxels(m);
    kv1 += old.length; kc += bytes.length;
    kv1gz += gzipSync(old, { level: 9 }).length; kcgz += gzipSync(bytes, { level: 9 }).length;
    kv1Text += voxelsToText(m).length; kcText += text.length;
  }
  const n = models().length;
  console.log(`\n${n} models: KV1 ${kv1} B (gzip ${kv1gz} B, text ${kv1Text} ch) -> codec ${kc} B (gzip ${kcgz} B, text ${kcText} ch): ${(100 * kc / kv1).toFixed(1)}% of KV1`);
});

test("stored voxels are deterministic: the same cells store the same bytes, whatever roles sit unused in the palette", () => {
  const m = dog();
  assert.deepEqual(storeVoxels(m.clone()), storeVoxels(m));
  const padded = createVoxels({ unit: m.unit, roles: ["unused", ...m.roles, "spare"], name: m.name });
  m.forEach((x, y, z) => padded.set(x, y, z, m.roleAt(x, y, z)));
  for (const [g, rs] of m.groups) padded.groups.set(g, rs);
  assert.deepEqual(storeVoxels(padded), storeVoxels(m));
  assert.deepEqual([...loadVoxels(storeVoxels(padded)).roles].sort(), rolesInUse(m), "only the roles it uses");
});

test("an empty model, an origin in half voxels, an odd unit and a long name round-trip", () => {
  const empty = createVoxels({ name: "nothing" });
  assertSame(loadVoxels(storeVoxels(empty)), empty, "empty");
  const odd = createVoxels({ unit: 1 / 48, origin: [0.5, -3, 12.5] as never, name: "a-very-long-model-name-with-dashes-and-digits-0123456789" });
  odd.set(-2048, 0, 2047, "primary");
  odd.set(5, -7, 3, "trim");
  odd.groups.set("far", [{ min: [-2048, 0, 2047], max: [-2048, 0, 2047] }]);
  assertSame(loadVoxels(storeVoxels(odd)), odd, "odd");
  assert.equal(loadVoxels(storeVoxels(odd)).unit, 1 / 48, "the unit exactly (KV1 kept tenths of a millimetre)");
  // (A group with no regions isn't stored, as KV1 didn't store one.)
  odd.groups.set("empty", []);
  assert.deepEqual([...loadVoxels(storeVoxels(odd)).groups.keys()], ["far"]);
});

test("old KV1 bytes and text still load, and store again as codec documents", () => {
  for (const [what, m] of models()) {
    assertSame(loadVoxels(encodeVoxels(m)), m, `${what} (KV1 bytes)`);
    assertSame(loadVoxels(voxelsToText(m)), m, `${what} (KV1 text)`);
  }
  // (A KV1 string as an exported pack file carried it before the codec: a 4x4 cap with a trim brim.)
  const cap = loadVoxels("KV1:S1YBBMgBAgR0cmltB3ByaW1hcnkJAA8KBBABCQAdAQkAHQEJAB0CjwMBCQAdAQkAHQEJAB0DY2Fw");
  assert.equal(cap.name, "cap");
  assert.ok(cap.count > 0);
  assertSame(loadVoxels(storeVoxelsText(cap)), cap, "the old cap");
  assert.throws(() => loadVoxels("KX9:AAAA"), /unknown format/);
  assert.throws(() => loadVoxels(Uint8Array.of(0x4a, 1, 2)), /unknown format/);
});

test("every op's example stores and loads as a keel/builder/ops document; unknown ops and fields say what's wrong", () => {
  const examples = Object.values(OPS).map((s) => s.example as { op: string });
  const bytes = storeOps(examples);
  assert.equal(bytes[0], HEADER_ID);
  assert.deepEqual(loadOps(bytes), examples);
  for (const ex of examples) assert.deepEqual(loadOps(storeOps([ex])), [ex], ex.op);
  const json = new TextEncoder().encode(JSON.stringify(examples));
  console.log(`\n${examples.length} op examples: JSON ${json.length} B (gzip ${gzipSync(json, { level: 9 }).length} B) -> codec ${bytes.length} B (gzip ${gzipSync(bytes, { level: 9 }).length} B)`);
  assert.throws(() => storeOps([{ op: "box", from: [0, 0, 0], to: [1, 1, 1], role: "primary" } as { op: string }, { op: "bx" }]), /op 1: "bx" isn't a builder op/);
  assert.throws(() => storeOps([{ op: "box", from: [0, 0, 0], to: [1, 1, 1], role: "primary", colour: "red" } as never]), /Can't store these ops: .*Unknown field "colour"/);
  assert.throws(() => storeOps([{ op: "set", role: "dark" } as never]), /Can't store these ops/);
});

test("old JSON op lists and data (\"J\" 1) still load", () => {
  const j1 = (v: unknown) => { const b = new TextEncoder().encode(JSON.stringify(v)); const out = new Uint8Array(b.length + 2); out.set([0x4a, 0x01]); out.set(b, 2); return out; };
  const ops = [{ op: "generate", kind: "crate", seed: "3" }, { op: "target", as: "object", id: "crate" }];
  assert.deepEqual(loadOps(j1(ops)), ops);
  assert.deepEqual(loadData(j1({ plan: "quadruped" })), { plan: "quadruped" });
  assert.throws(() => loadOps(j1({ op: "box" })), /aren't a list/);
  assert.throws(() => loadData(Uint8Array.of(7, 7)), /unknown format/);
});

test("asset data round-trips as a keel/builder/data document: nesting, -0, big and small numbers, strings, nulls", () => {
  const value = {
    plan: "quadruped", joints: { neck: [0, 12, 6], "tail.1": [-0.5, 9.25, -7] }, zero: -0, list: [-0, 0, 1e-9, 1e300, -(2 ** 53), 0.1, "x", null, true, false, [], {}],
    deep: { a: { b: { c: { d: [{ e: "é ✓" }] } } } },
  };
  const bytes = storeData(value);
  assert.equal(bytes[0], HEADER_ID);
  const back = loadData(bytes) as typeof value;
  assert.deepEqual(back, value);
  assert.ok(Object.is(back.zero, -0) && Object.is(back.list[0], -0), "-0 stays -0");
  assert.ok(Object.is(loadData(storeData(-0)), -0));
  for (const v of [null, 0, "text", [1, [2, [3]]], true]) assert.deepEqual(loadData(storeData(v)), v);
  const json = new TextEncoder().encode(JSON.stringify(value));
  console.log(`\nasset data: JSON ${json.length} B -> codec ${bytes.length} B`);
});
