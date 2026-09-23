import { defineManifest } from "@keel-engine/runtime";

// (Drivers read a road and a car and answer with pedals -- no renderer, no game rules.)
export const manifest = defineManifest({
  id: "keel/driver",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/road@^0.1", "keel/runtime@^0.1", "keel/vehicle@^0.1"],
  title: "KEEL Engine driver",
  description: "AI drivers: racing line, pure-pursuit steering, speed planning, overtaking -- pedals for any car on any road.",
});
