import { defineManifest } from "@keel-engine/runtime";

// (Ads never touch a simulation: slots are data a game declares, creatives come from sources it composes.)
export const manifest = defineManifest({
  id: "keel/ads",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/runtime@^0.1"],
  title: "KEEL Engine ads",
  description: "Ad slots, sources (house, list, chain -- first answer wins), safe links, and picking the slot under a pointer.",
});
