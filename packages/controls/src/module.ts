import { defineManifest } from "@keel-engine/runtime";

// (Devices to actions, and the on-screen controls a phone needs -- no game rules, no renderer.)
export const manifest = defineManifest({
  id: "keel/controls",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/runtime@^0.1"],
  title: "KEEL Engine controls",
  description: "An action map over keyboard, gamepads and touch; device detection; on-screen mobile control schemes styled by CSS.",
});
