import { defineManifest } from "@keel-engine/runtime";

// (A product model for keel/studio: geometry and prints are generated from measured dimensions at load; nothing is
// downloaded. Opt-in: no other module depends on it.)
export const manifest = defineManifest({
  id: "keel/handheld",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/runtime@^0.1", "keel/studio@^0.1"],
  title: "KEEL Engine handheld",
  description: "A handheld console built from parts for keel/studio: shell halves with real bevels, cover glass over a pixel-exact screen, keys on pivots, a cartridge, screws and the board inside; crisp printed graphics; hit testing and key travel; grid and solo detail.",
});
