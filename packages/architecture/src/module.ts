import { defineManifest } from "@keel-engine/runtime";

// (Buildings are data: a plan per lot, boxes a block. It reads a city's lots and a catalogue it's handed -- it never
// imports a pack; packs/buildings provides the default catalogue.)
export const manifest = defineManifest({
  id: "keel/architecture",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/city@^0.1", "keel/core@^0.1", "keel/road@^0.1", "keel/runtime@^0.1"],
  title: "KEEL Engine architecture",
  description: "The built city: buildings (envelopes, massing, facade grids, crowns, rooftop kit, neon), parks, plazas, art, street lamps and furniture -- a plan a lot, a world a block, a look a district.",
});
