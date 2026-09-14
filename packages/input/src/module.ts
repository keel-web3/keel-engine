import { defineManifest } from "@keel-engine/runtime";

// (Devices to intents: it reads core's frame for camera-relative moves.)
export const manifest = defineManifest({
  id: "keel/input",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1"],
  title: "KEEL Engine input",
  description: "Keyboard, mouse under pointer lock, gamepad and touch to per-step intents; the autopilot arbiter.",
});
