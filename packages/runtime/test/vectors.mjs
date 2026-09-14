// Test vectors for keel/runtime, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":20,"digest":"b23ebf4fda2b73915f6a3d8ddb1077ced149471d3650e636ec878fb331b6e074"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "e9a97907d1bc2817b9b95589218fcfa664666b5f5a4593f1ae3aa4928bcffb61",
  },
  {
    name: "satisfies and splitRef read version ranges",
    run: ({ satisfies, splitRef }) => [satisfies("1.4.2", "^1.2"), satisfies("2.0.0", "^1"), satisfies("0.1.9", "^0.1"), splitRef("keel/core@^0.1")],
    expect: [true,false,true,{"name":"keel/core","range":"^0.1"}],
  },
  {
    name: "defineManifest fills defaults",
    run: ({ defineManifest }) => defineManifest({ id: "vectors/pack", version: "1.0.0", kind: "pack", needs: ["keel/runtime@^0.1"] }),
    expect: {"compatible":[],"id":"vectors/pack","kind":"pack","needs":["keel/runtime@^0.1"],"phase":"runtime","provides":[],"schema":"keel-engine-module@1","version":"1.0.0","weight":-500},
  },
  {
    name: "a registry resolves needs, contracts and start order",
    run: ({ createEngine, defineManifest }) => { const e = createEngine(); e.define(defineManifest({ id: "v/a", version: "1.0.0", kind: "pack", provides: ["body/v@1.0.0"] }), () => ({})); e.define(defineManifest({ id: "v/b", version: "1.0.0", kind: "game", needs: ["contract:body/v@^1"] }), () => ({})); e.define(defineManifest({ id: "v/c", version: "1.0.0", kind: "runtime", needs: ["v/missing@^1"] }), () => ({})); const r = e.resolve(); return { ok: r.ok, order: r.order, problems: r.problems }; },
    expect: {"ok":false,"order":["v/c","v/a","v/b"],"problems":[{"detail":"needs v/missing@^1, which isn't loaded.","kind":"missing","module":"v/c"}]},
  },
]);
