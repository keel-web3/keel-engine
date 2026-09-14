import { defineManifest } from "@keel-engine/runtime";

// (Behaviour, not a body: it provides the ai/animal contract and binds to any pack providing body/quadruped --
// it reads only what that contract promises, so it drives this engine's animals or anyone else's.)
export const manifest = defineManifest({
  id: "ai/wander",
  version: "1.0.0",
  kind: "ai",
  needs: ["keel/core@^0.1", "contract:body/quadruped@^1"],
  provides: ["ai/animal@1.0.0"],
  title: "Wander",
  description: "One animal on its own: meander, stand and look about, sit, bolt from a threat. Deterministic, seeded, fixed-step steering on the ground plane.",
});
