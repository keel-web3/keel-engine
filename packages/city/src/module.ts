import { defineManifest } from "@keel-engine/runtime";

// (A city is data: a road graph and its lots, on core's deterministic maths. It never imports a pack -- a buildings
// pack reads its lots through the building:lot contract, not the other way round.)
export const manifest = defineManifest({
  id: "keel/city",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/elevation@^0.1", "keel/road@^0.1", "keel/runtime@^0.1"],
  title: "KEEL Engine city",
  description: "Cities from a seed: a site, arterials, a ring road, streets, blocks and lots -- a road graph and the lots to build on.",
});
