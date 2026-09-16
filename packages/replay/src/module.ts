import { defineManifest } from "@keel-engine/runtime";

// (Deterministic runs, verified by replay: a tape of inputs, checksums along the way, a transcript that commits to all of it.)
export const manifest = defineManifest({
  id: "keel/replay",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/codec@^0.1"],
  title: "KEEL Engine replay",
  description: "Input tapes, state checksums, checkpointed recording and replay verification: a run's result derived from its seed, rules and inputs, never trusted.",
});
