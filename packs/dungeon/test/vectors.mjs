// Test vectors for packs/dungeon, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":47,"digest":"719e366ce01815d09a003729a0fe7ba2223423ee71ebf4e8ded350ea4d2fee47"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "be1de0a4ada04bbc8a146246e0786d74d910f51ec252d98c6d557c1cc74b83b1",
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
