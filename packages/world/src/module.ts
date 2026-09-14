import { defineManifest } from "@keel-engine/runtime";

// (The world holds and steps everything below it: bodies, cameras, input, particles, objects and entities; its
// snapshots go to bytes through the codec.)
export const manifest = defineManifest({
  id: "keel/world",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/physics@^0.1", "keel/camera@^0.1", "keel/input@^0.1", "keel/particles@^0.1", "keel/object@^0.1", "keel/entity@^0.1", "keel/codec@^0.1"],
  title: "KEEL Engine world",
  description: "The world runtime: systems on a fixed step, settings layers and locks, generation through settings, target rules, a headless frame, snapshots and replays.",
});
