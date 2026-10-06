
import { lookMesh, lookMeshSteps, worldsBounds } from "../src/mesh.ts";
import type { BakeWorld, BakeBox } from "../src/bake.ts";
import type { LookMeshOptions } from "../src/mesh.ts";
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

const worlds: BakeWorld[] = [
  {},
  { boxes: [{ c: [-0, 1, -3], h: [1, .5, 2], yaw: .71, mat: 7, grid: [3, 3.5, 2, -.5] }], wedges: [{ c: [-2, 1, 0], h: [.8, 2, 3], yaw: -2.3, lo: .2, skin: .1, top: [-.3, .7], mat: 4 }] },
  { capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: .2, mat: 3 }, { a: [-1, 2, 3], b: [4, 1, -2], r: .43 }, { a: [2, 2, 2], b: [2, 2, 2], r: .7 }, { a: [1, 2, 3], b: [1, 2, 3], r: 0 }] },
  { boxes: Array.from({ length: 96 }, (_, i): BakeBox => ({ c: [i * .1, 1, -i * .3], h: [i % 2 ? 0 : .7, 1, 2], yaw: i * .71, mat: i % 32 })), wedges: [{ c: [1, 2, 3], h: [0, 1, 0], lo: .4 }], capsules: [{ a: [1, 2, 3], b: [1, 2, 3], r: .007 }] },
];
const options: LookMeshOptions[] = [{}, { around: 4, rings: 1 }, { around: 17, rings: 5 }, { chordError: .01, bounds: [-10, -10, -10, 10, 10, 10] }];
const fields = ["positions", "normals", "attrs", "bodies", "indices", "facade"] as const;

function fingerprint(world: BakeWorld, options: LookMeshOptions): string {
  const hash = createHash("sha256"), mesh = lookMesh(world, options);
  for (const field of fields) {
    const value = mesh[field];
    hash.update(field + ":" + (value?.byteLength ?? -1) + ":");
    if (value) hash.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  hash.update(new Uint8Array(Float64Array.from(worldsBounds([world], options)).buffer));
  return hash.digest("hex");
}

// Recorded from the canonical mesh emitter before per-vertex scratch reuse.
const expected = [
  [
    "f31a88ff1f80fac414d3f0d62cad047b2cbd04cbc44fa69e80f3bc4226fa9358",
    "f31a88ff1f80fac414d3f0d62cad047b2cbd04cbc44fa69e80f3bc4226fa9358",
    "f31a88ff1f80fac414d3f0d62cad047b2cbd04cbc44fa69e80f3bc4226fa9358",
    "f31a88ff1f80fac414d3f0d62cad047b2cbd04cbc44fa69e80f3bc4226fa9358"
  ],
  [
    "42319bc0690411af438407051b74071f54ee894dd66c24a340549bf1e64588b3",
    "42319bc0690411af438407051b74071f54ee894dd66c24a340549bf1e64588b3",
    "42319bc0690411af438407051b74071f54ee894dd66c24a340549bf1e64588b3",
    "556d968255dfa68f044147535c56b66348ec3defc2c956164041ce118133db24"
  ],
  [
    "5712baf2a08bb7d3f3b87135ac667c6cb942dfe44ee0b62fcb669407ff2d4645",
    "aec3ddb1f2f63b99b3313712fdc2b2a1280cfbd31015ce4ed94eabf687de5947",
    "1c9b44da6a68a24c2dd6ba8f0ff6bb557adeb2b803cd212bd1caf1d057ca44ef",
    "907456a4ddadb5abda30a6423c26ffedccd60fe5756c19e67a0976fca9d6b2a2"
  ],
  [
    "ff16ad0f92a24cda0224b26d4992846a4f505adcae76b0305f425debf85d465a",
    "6047978418b76ab95848c31315be9e125387a74f3eb7c5516e702c8ddfe16658",
    "01bac15db2dae10b967bdda53f473ffaf16ca7a523c3cd38a1e86d15def80ed5",
    "332cbf3c911e59c51287ccf070f009bbf82759fee493cdc43be824a153cd9c9a"
  ]
];

test("mesh emission keeps exact Float32 geometry, normals, UVs, part IDs, facade data, indices and bounds", () => {
  for (let w = 0; w < worlds.length; w++) for (let o = 0; o < options.length; o++) {
    assert.equal(fingerprint(worlds[w]!, options[o]!), expected[w]![o], "world " + w + ", options " + o);
  }
});

test("yielding mesh construction shares finalization without changing pauses or mutating inputs", () => {
  const before = structuredClone(worlds);
  for (const world of worlds) for (const option of options) {
    const steps = lookMeshSteps(world, option); let yields = 0, result = steps.next();
    while (!result.done) { yields++; result = steps.next(); }
    const solids = (world.boxes?.length ?? 0) + (world.wedges?.length ?? 0) + (world.capsules?.length ?? 0);
    assert.equal(yields, Math.floor(solids / 32) + 1);
    assert.deepEqual(result.value, lookMesh(world, option));
  }
  assert.deepEqual(worlds, before);
});
