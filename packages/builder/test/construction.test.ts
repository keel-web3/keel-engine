import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode, VOXEL_CONSTRUCTION } from "@keel-engine/codec";
import { compileVoxelConstruction, createVoxels, generate, GENERATOR_KINDS, loadModel, sameVoxels, storeModelText, storeVoxels } from "../src/index.ts";
import { loadPrimitiveModel } from '../src/construction-runtime.ts';

test("every generator, plan and edited model replays exactly; selection never grows the document", () => {
  let before = 0, after = 0;
  for (const kind of GENERATOR_KINDS) for (const seed of [1, 7, 42]) for (const plan of ["humanoid", "quadruped"] as const) {
    const model = generate(kind, seed, { plan }).model, result = compileVoxelConstruction(model);
    assert.ok(sameVoxels(loadModel(result.bytes), model));
    assert.equal(loadModel(result.bytes).name, model.name);
    assert.deepEqual(compileVoxelConstruction(model).bytes, result.bytes);
    assert.ok(result.bytes.length <= storeVoxels(model).length);
    assert.ok(sameVoxels(loadModel(storeModelText(model)), model));
    before += storeVoxels(model).length; after += result.bytes.length;
    model.set(0, 0, 0, "accent"); model.set(35, 0, 0, "new-role"); model.set(-35, 0, 0, null);
    model.name = "edited"; model.groups.set("detail", [{ min: [35, 0, 0], max: [35, 0, 0] }]);
    const edited = compileVoxelConstruction(model);
    assert.ok(sameVoxels(loadModel(edited.bytes), model));
    assert.equal(loadModel(edited.bytes).name, "edited");
  }
  console.log({ models: 36, originalBytes: before, selectedBytes: after });
  assert.ok(after < before * .5);
});

test("source-derived repeated boxes preserve metadata, roles and irregular fallback", () => {
  const m = createVoxels({ name: "fence", unit: .125, origin: [0, 0, 0] });
  for (let n = 0; n < 80; n++) for (let y = 0; y < 20; y++) m.set(n * 3, y, 0, "primary");
  const r = compileVoxelConstruction(m), primitive = r.candidates.find(c => c.kind === "boxes");
  assert.ok(primitive); assert.ok(sameVoxels(loadModel(r.bytes), m));
  assert.ok(sameVoxels(loadPrimitiveModel(r.bytes), m));
  if (r.kind === "boxes") assert.ok(decode(VOXEL_CONSTRUCTION, r.bytes).source.kind === "boxes");
  const noisy = createVoxels({ name: "noise" });
  for (let i = 0; i < 400; i++) noisy.set(i % 20, Math.floor(i / 20), i % 7, i % 2 ? "trim" : "primary");
  const q = compileVoxelConstruction(noisy);
  assert.ok(q.bytes.length <= storeVoxels(noisy).length);
  assert.ok(sameVoxels(loadModel(q.bytes), noisy));
  assert.ok(sameVoxels(loadModel(storeVoxels(m)), m));
});

test("generator drift, malformed volumes and damaged construction are refused", () => {
  const m = generate("tree", 42).model, r = compileVoxelConstruction(m);
  assert.equal(r.kind, "generator");
  assert.throws(() => loadPrimitiveModel(r.bytes), /not enabled/);
  const record = decode(VOXEL_CONSTRUCTION, r.bytes);
  const source = record.source;
  assert.ok(source.kind === "generator");
  assert.throws(() => loadModel(encode(VOXEL_CONSTRUCTION, { ...record, source: { ...source, revision: 99 } })), /revision/);
  assert.throws(() => loadModel(encode(VOXEL_CONSTRUCTION, { ...record, source: { ...source, seed: "another" } })), /drift/);
  assert.throws(() => loadModel(encode(VOXEL_CONSTRUCTION, { ...record, metadata: { name: "huge", unit: .1, origin: null, roles: ["primary"], groups: {} }, source: { kind: "boxes", parts: [{ min: [0, 0, 0], size: [512, 512, 512], count: 1, step: [0, 0, 0], role: 1 }] } })), /volume/);
  assert.throws(() => loadModel(r.bytes.subarray(0, r.bytes.length - 1)));
});
