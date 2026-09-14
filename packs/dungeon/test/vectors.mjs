// Test vectors for packs/dungeon, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":43,"digest":"20e8823b864312927999a4d6b2e5380aa0a3689c421e8f2f413b54f1c40eb9dd"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "904bff2ef79c0ccd57b0bc97c5acf14fe6795ad3de5bbc20bed16b0f90f4607b",
  },
  {
    name: "prop info",
    run: ({ propInfo }) => [propInfo("chest"), propInfo("torch"), propInfo("nothing")],
    expect: [{"block":true,"destructible":false,"light":null,"openable":true,"place":"wall","radius":0.5},{"block":false,"destructible":false,"light":"torch","openable":false,"place":"wall","radius":0.2},{"block":false,"destructible":false,"light":null,"openable":false,"place":"floor","radius":0.4}],
  },
  {
    name: "the pack's objects",
    run: ({ pack }) => (pack.objects ?? []).map((o) => o.id),
    expect: ["torch","brazier","candelabra","crystals","mushrooms","barrel","crate","urn","chest","bones","skull-pile","stain","rubble","cobweb","chains","banner","roots","bookshelf","table","weapon-rack","cage","altar","sarcophagus","tombstone","throne","statue","stalagmite","anvil","furnace","ore-cart","key"],
  },
]);
