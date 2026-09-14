import { defineManifest } from "@keel-engine/runtime";

// (Rigs and their collision: core's frame, and physics' solids for the arm.)
export const manifest = defineManifest({
  id: "keel/camera",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/physics@^0.1"],
  title: "KEEL Engine camera",
  description: "Camera rigs -- orbit, chase, first person, frame, rail, fixed -- with blends, shake, the landing nod, arm collision and saved state.",
});
