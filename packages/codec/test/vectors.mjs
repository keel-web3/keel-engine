// Test vectors for keel/codec, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":198,"digest":"489a004db102842317b2734ff0517ba65273c34b3d2aae3e204326b63ce2ccc2"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "d0231ab2ca9381b112a250de6d108e385d38da24e7455542e8b3dea9fe7078f5",
  },
  {
    name: "a struct round-trips through canonical bytes",
    run: ({ struct, uint, string, encode, decode, toBase64 }) => { const T = struct({ n: uint(12), s: string() }); const bytes = encode(T, { n: 271, s: "keel" }); return [toBase64(bytes), decode(T, bytes)]; },
    expect: ["sa4kqBkEEPKAa2VlbA",{"n":271,"s":"keel"}],
  },
  {
    name: "schema ids are stable",
    run: ({ struct, uint, bool, schemaId, named }) => [schemaId(struct({ a: uint(8), b: bool() })), schemaId(named("vectors/x@1", struct({ a: uint(8) })))],
    expect: ["7837ce045be7db8aa951faa0a0095d295d4b01230e59080b617d2e608398d566","5e1e5846f500c004e80623af116b6b0d50aa78280ee2e61a4bfab466fbd5d352"],
  },
  {
    name: "the engine's schemas are all named",
    run: ({ ENGINE_SCHEMAS, schemaName }) => Object.values(ENGINE_SCHEMAS).map((s) => schemaName(s)).sort(),
    expect: [{"doc":"Every schema, as data: a document can carry its own.","name":"keel/codec/schema","version":1},{"doc":"An object definition: prims in millimetres, sockets, rails, tags.","name":"keel/object","version":1},{"doc":"Objects in a world: definitions and placements.","name":"keel/object/placed","version":1},{"doc":"A look: what each role wears (core's lookOf, without its derived signature).","name":"keel/look","version":1},{"doc":"An entity's seed and pins: everything its spec is rebuilt from.","name":"keel/entity/make","version":1},{"doc":"An attribute: id + pins + seed (what a wearable token names), and its look.","name":"keel/attribute/pin","version":1},{"doc":"A cast and its units: each a body, a coverage, a look and what it wears.","name":"keel/population","version":1},{"doc":"A population stored as its recipe, its look re-rolls, per-unit pins by layer and explicit parts.","name":"keel/population/hybrid","version":1},{"doc":"A world's settings: scopes (engine, project, scene, seed, runtime, tag:*, id:*, seed:*), their values and locks.","name":"keel/world/settings","version":1},{"doc":"A world's snapshot: everything the simulation needs to go on exactly (world.restore takes it back).","name":"keel/world/snapshot","version":1},{"doc":"A particle pool's save(): every live particle.","name":"keel/particles/save","version":1},{"doc":"The particle pool's snapshot: particles and emitter slots, exactly.","name":"keel/particles/pool","version":1},{"doc":"A script as blocks: handlers of statements over typed expressions.","name":"keel/script/blocks","version":1},{"doc":"A script compiled: a stack machine's ops per handler (6-bit opcodes, typed immediates).","name":"keel/script/bytecode","version":1},{"doc":"Music as its recipe: a seed and a mood; the plan comes back from scoreOf exactly.","name":"keel/audio/recipe","version":1},{"doc":"A music plan, packed: sections of chords, the tune delta-coded, drums as step masks.","name":"keel/audio/song","version":1},{"doc":"A project's sound palette and how its sounds are played.","name":"keel/audio/sfx","version":1},{"doc":"A voxel model: palette-indexed cells by role, as runs over its box.","name":"keel/builder/voxels","version":1}],
  },
]);
