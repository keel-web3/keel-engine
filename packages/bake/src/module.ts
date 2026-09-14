import { defineManifest } from "@keel-engine/runtime";

export const manifest = defineManifest({
  id: "keel/bake", version: "0.1.0", kind: "runtime", needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/entity@^0.1", "keel/codec@^0.1"],
  title: "Bake and draw", description: "Designs baked once into sprite atlases through the pixel renderer (entities posed and dressed, trimmed, anchored, cached) -- or as indexed sprites (slot, shade, surface coordinate) that any look paints at draw time, with rigid attributes as their own layers; a streaming loader (what's on screen first, the rest while the game plays, in a bake worker where it can, tiers, stand-ins, a live atlas); instanced, pixel-snapped sprites through an orthographic pixel view; a spatial hash grid for culling and queries; generated populations, stored as hybrid records (recipe, re-rolls, pins, explicit parts).",
});
