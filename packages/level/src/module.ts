import { defineManifest } from "@keel-engine/runtime";

// (Settings and their locks are keel/world's; the terrain is keel/terrain's; things are keel/object's definitions; the document's packed form is keel/codec's.)
export const manifest = defineManifest({
  id: "keel/level",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/object@^0.1", "keel/world@^0.1", "keel/codec@^0.1", "keel/terrain@^0.1"],
  title: "KEEL Engine levels",
  description: "A level document (terrain, placed objects by pack/id/pins/look/style, foliage scatter, buildings, roads, water, spawns, markers, trigger regions), versioned and codec-packed; seeded generation where every choice is a lockable setting; RTS fairness metrics; an edit op list that streams change events.",
});
