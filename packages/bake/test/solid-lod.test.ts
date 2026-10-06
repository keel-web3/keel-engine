import test from "node:test";
import assert from "node:assert/strict";
import { solidLodSteps } from "../src/solid-lod.ts";
import type { LodSolid } from "../src/solid-lod.ts";

test("roof error, free error, layers and detail levels remain independent", () => {
  const solids: LodSolid[] = [
    { lod: 2, box: { c:[0,5,0], h:[10,5,10], slot:0 } },
    { lod: 0, box: { c:[0,11,0], h:[2,1,3], slot:0 } },
    { lod: 0, box: { c:[90,3,0], h:[.5,.5,4], slot:0 } },
    { lod: 1, capsule: { a:[0,10.2,0], b:[0,13,0], r:.2, slot:0 } },
    { lod: 0, layer:1, box: { c:[0,11,0], h:[8,1,8], slot:0 } }
  ];
  assert.deepEqual(solidLodSteps([{ solids }]), [{ terms:[{ error:1 }, { error:4, facing:"roof", roofY:10 }] }, { terms:[{ error:0 }, { error:.4, facing:"roof", roofY:10 }] }]);
  assert.deepEqual(solidLodSteps([{ solids }], 1), [{ terms:[{ error:16 }] }, { terms:[{ error:0 }] }]);
  assert.deepEqual(solidLodSteps([]), [{ terms:[{ error:0 }] }, { terms:[{ error:0 }] }]);
});

test("roof classification keeps the strict height and support-height thresholds", () => {
  const support: LodSolid = { lod:2, box:{c:[0,2,0],h:[10,2,10],slot:0} };
  const on: LodSolid = { lod:0, box:{c:[0,5,0],h:[1,1,1],slot:0} };
  assert.deepEqual(solidLodSteps([{solids:[support,on]}])[0], {terms:[{error:2}]}, "bottom at 4 remains a free term");
  const high: LodSolid = { lod:2, box:{c:[0,4,0],h:[10,4,10],slot:0} };
  const far: LodSolid = { lod:0, box:{c:[100,9,0],h:[1,1,1],slot:0} };
  assert.deepEqual(solidLodSteps([{solids:[high,far]}])[0], {terms:[{error:2}]}, "unrelated distant masses do not support the detail");
});
