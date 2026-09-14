import { defineManifest } from "@keel-engine/runtime";

// (Things that move, and the standard bodies they're built on. It DEFINES the body contracts
// -- body/humanoid@1.0.0, body/quadruped@1.0.0, their bones, clips and sockets -- but provides
// none: a contract is provided by the pack whose entities keep it, so a game needing
// "contract:body/quadruped@^1" is satisfied only when some pack actually brings quadrupeds.)
export const manifest = defineManifest({
  id: "keel/entity",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/scene@^0.1"],
  provides: [],
  title: "KEEL Engine entity",
  description: "Humanoid and quadruped rigs, species, clips and gaits, the animator, skins, entity fronts; the standard body contracts, their sockets, and attribute fitting.",
});
