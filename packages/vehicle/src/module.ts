import { defineManifest } from "@keel-engine/runtime";

// (Car dynamics on core's deterministic maths alone: the physics never pulls in a renderer.)
export const manifest = defineManifest({
  id: "keel/vehicle",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/runtime@^0.1"],
  title: "KEEL Engine vehicle",
  description: "Deterministic car dynamics: a rigid body on raycast wheels, tyre curves, powertrain, brakes, handbrake, aero and contacts.",
});
