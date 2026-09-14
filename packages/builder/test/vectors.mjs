// Test vectors for keel/builder, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":110,"digest":"6137c782e1f7b1efb3e8bbfa8db72a861efbdf0f226e3a4b450139b7bb87023a"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "2b1ce921e0b5629825015dadc0daf587ec7af269839466ce7a64c60904c1039c",
  },
  {
    name: "base64 round-trips",
    run: ({ toBase64, fromBase64 }) => { const b = toBase64(new Uint8Array([0, 1, 2, 250, 255])); return [b, Array.from(fromBase64(b))]; },
    expect: ["AAEC-v8",[0,1,2,250,255]],
  },
  {
    name: "an empty voxel model",
    run: ({ createVoxels, voxelStats }) => { const v = createVoxels({ unit: 0.1, name: "v" }); return [v.name, v.unit, voxelStats(v)]; },
    expect: ["v",0.1,{"box":0,"bytes":15,"cells":0,"text":24}],
  },
]);
