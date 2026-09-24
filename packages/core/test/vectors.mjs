// Test vectors for keel/core, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":135,"digest":"9a32931f085470bb13a17197edcfd37c3db455038fdbad1890ff49509b1fe2a7"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "4ee25dc4bd568d542acb727f0d615e1c98dc3fa0d9d58aeecc8cdfc78224a3ca",
  },
  {
    name: "value noise and fbm are deterministic",
    run: ({ vnoise2, fbm2, hash2 }) => [vnoise2(0.5, 1.5), vnoise2(3.25, -2, 7), fbm2(0.3, 0.7, 11), hash2(4, 9, 3)],
    expect: [0.2912852555164136,0.2597379146318417,0.38955764171135526,0.5850013650488108],
  },
  {
    name: "the curl field (presentation: the particle pool's and volume smoke's flow)",
    run: ({ curlNoise }) => { const o = [0, 0, 0, 0, 0, 0]; curlNoise(0.5, 1.5, -2.25, 0, o, 0); curlNoise(13.7, -4.1, 8.9, 123.4, o, 3); return o; },
    expect: [-1.4093363280773463,0.4328855713626694,-0.6003181658278559,-0.6810558155988391,-0.058824263866600605,-0.7143881532533333],
  },
  {
    // (x64's V8 Math gives these too; an arm64 Mac's gives other last bits for the first, and for dcbrt's input.)
    name: "dmath is fdlibm to the bit, on every engine",
    run: ({ dsin, dcos, datan2, dhypot, dexp, dlog, dpow, dcbrt }) => [dsin(2.726480366621625), dcos(1.2814), datan2(-92.649, 37.967), dhypot(3, 4, 12), dexp(-3.2), dlog(0.645), dpow(1.7, 2.2), dcbrt(0.00036736180214211344), dsin(1e22)],
    expect: [0.4032926834807777,0.2853737068848235,-1.1818755030481294,13,0.040762203978366204,-0.43850496218636453,3.213568983362493,0.07161950784354873,-0.8522008497671888],
  },
  {
    name: "oklch converts to sRGB",
    run: ({ oklch, hueName }) => [oklch(0.7, 0.1, 200), oklch(0.4, 0.15, 30), hueName(200)],
    expect: [[64,177,183],[134,19,9],"Teal"],
  },
  {
    name: "seeded streams replay",
    run: ({ createRoll, stream, deriveSeed }) => { const s = stream(createRoll(deriveSeed("0x2a", "vectors")), 3); return [s.f(), s.int(1, 6), s.between(-1, 1), s.pick(["a", "b", "c"])]; },
    expect: [0.7616729736328125,6,-0.70257568359375,"b"],
  },
]);
