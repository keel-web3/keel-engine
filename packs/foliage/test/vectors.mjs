// Test vectors for packs/foliage, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":22,"digest":"7c67cb1af163ce6727ab85e1341bbc779756ecbd141b59c300e29c2edec2deb1"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "91baea6de1a1e5e311b22003a7f32fd9de82af7a7bb265fb96f8d7cc2742cc6c",
  },
  {
    name: "the pack's objects",
    run: ({ pack }) => (pack.objects ?? []).map((o) => o.id),
    expect: ["oak","pine","birch","palm","dead-tree","mushroom","alien-tree","bush","grass","flowers","reeds","cactus","rock","log","stump","crystal"],
  },
  {
    name: "wind",
    run: ({ WIND }) => WIND,
    expect: {"bush":{"amp":0.05,"bend":1.2,"from":0.1,"hz":0.5},"conifer":{"amp":0.025,"bend":2,"from":1.5,"hz":0.3},"flower":{"amp":0.12,"bend":1.5,"from":0,"hz":0.6},"grass":{"amp":0.16,"bend":1.6,"from":0,"hz":0.7},"palm":{"amp":0.05,"bend":2.2,"from":1,"hz":0.3},"reed":{"amp":0.1,"bend":1.8,"from":0.05,"hz":0.45},"tree":{"amp":0.035,"bend":1.8,"from":1.2,"hz":0.35}},
  },
]);
