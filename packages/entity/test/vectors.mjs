// Test vectors for keel/entity, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":81,"digest":"b94fcb2d08e7163a2cf74b30e54106527323cd5afab7a2dc7eaf77569309ed9a"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "f5b2f1db6065a7cd81a97c1a7bb831c638a2bb8175978cf9d530cdc22c61c142",
  },
  {
    name: "an entity's choices for a species",
    run: ({ choicesFor }) => choicesFor("quadruped", "dog"),
    expect: {"accessory":["none","scarf","cap","goggles","headband","collar"],"antlers":[true,false],"arms":{"range":[0.92,1.08]},"coat":["plain","muzzle","socks"],"earSize":{"range":[0.85,1.15]},"ears":["flop","point"],"eyes":{"range":[0.85,1.2]},"girth":{"range":[0.85,1.15]},"hair":["none","short","long","bun","spiky","pony"],"head":{"range":[0.88,1.12]},"height":{"range":[0.9,1.1]},"hood":[true,false],"legs":{"range":[0.92,1.08]},"pack":["round","tall","small","none"],"pants":["long","shorts","none"],"shoes":["sneakers","boots","bare"],"snout":{"range":[0.85,1.2]},"stride":{"range":[0.9,1.1]},"tail":{"range":[0.8,1.2]},"top":["jacket","hoodie","tee","vest","none"]},
  },
  {
    name: "rotation matrices",
    run: ({ euler, rotY }) => [euler(0.1, 0.2, 0.3), rotY(1)],
    expect: [[0.9421546635113683,-0.2706814883919034,0.19767681165408385,0.2940438365518558,0.9505637859220633,-0.09983341664682815,-0.16088136066569614,0.15218416716418803,0.9751703272018158],[0.5403023058681398,0,0.8414709848078965,0,1,0,-0.8414709848078965,0,0.5403023058681398]],
  },
  {
    name: "a blank pose",
    run: ({ blankPose }) => blankPose(),
    expect: {"cycle":0,"ears":0,"ik":{},"root":{"off":[0,0,0],"pitch":0,"roll":0,"yaw":0},"rot":{}},
  },
]);
