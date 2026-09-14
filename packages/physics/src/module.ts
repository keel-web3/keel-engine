import { defineManifest } from "@keel-engine/runtime";

// (The character body and its solids: it reads only core's types.)
export const manifest = defineManifest({
  id: "keel/physics",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1"],
  title: "KEEL Engine physics",
  description: "The kinematic character controller: run, jump, wall-run, grind, skim; turned boxes, wedges, rails, water.",
});
