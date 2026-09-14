import { contentsOf, defineManifest } from "@keel-engine/runtime";
import { pack } from "./pack.ts";

// (Attributes only: it needs no body code -- a design is capsules and boxes in a socket's frame, keel/entity's
// convention, and the socket is handed to build(). It names the two packs it's made for, and they name it back.)
export const manifest = defineManifest({
  id: "packs/cloth",
  version: "1.0.0",
  kind: "pack",
  needs: ["keel/runtime@^0.1"],
  provides: ["attributes/wearable@1.0.0"],
  compatible: ["packs/humans@^1", "packs/animals@^1"],
  contents: contentsOf(pack),
  title: "Cloth",
  description: "Hats (beanie, cap, top hat, hood, horned helmet), backpacks (round, tall), a flag and a cape, a scarf, glasses and boots -- each with shape variants and look roles -- built to the head, back, neck, face and foot sockets of packs/humans' characters and packs/animals' animals.",
});
