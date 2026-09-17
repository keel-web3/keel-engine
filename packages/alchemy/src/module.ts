import { defineManifest } from "@keel-engine/runtime";

// (The element matrix: generated programs, bounded by a contract, content-addressed, cached forever.)
export const manifest = defineManifest({
  id: "keel/alchemy",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/codec@^0.1", "keel/replay@^0.1"],
  title: "KEEL Engine alchemy",
  description: "A combination matrix whose cells are programs -- stat mods, bounded formulas, triggers, looks -- read through a versioned contract that clamps and prices them to a budget by depth, content-addresses them, and lays them on a hero's sheet deterministically; with a seeded oracle and a relay queue for the AI bridge.",
});
