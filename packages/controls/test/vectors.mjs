// Test vectors for keel/controls, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":28,"digest":"282337ee8db1132a2062bcb94c8b48392e9de3d31183c000f85186ef5aa55991"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "a5b96ffc270d386417feb199fc827ab6fb180c6e264f4710366c116b84c0997b",
  },
  {
    name: "an iPad asking for the desktop site is still a tablet, and a DualSense shows Cross",
    run: ({ classifyDevice, padFamily, PAD_GLYPHS }) => {
      const ipad = classifyDevice({ touchPoints: 5, coarse: true, anyFine: false, hover: false, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", standalone: false, orientation: true });
      return [ipad.kind, ipad.os, PAD_GLYPHS[padFamily("DualSense Wireless Controller (Vendor: 054c)")].a.label];
    },
    expect: ["tablet", "ios", "✕"],
  },
]);
