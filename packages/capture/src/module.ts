import { defineManifest } from "@keel-engine/runtime";

// (The GIF export loads core's encoder on first use; stills and video need nothing else.)
export const manifest = defineManifest({
  id: "keel/capture",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1"],
  title: "KEEL Engine capture",
  description: "Optional stills, video (blown up nearest-neighbour) and GIF export.",
});
