import { defineManifest } from "@keel-engine/runtime";

// (Pure and GL-free: it reads a view structurally, so keel/bake's Projection satisfies it without an import.)
export const manifest = defineManifest({
  id: "keel/lod",
  version: "0.1.0",
  kind: "runtime",
  needs: [],
  title: "KEEL Engine level of detail",
  description: "Level of detail for generated worlds: nested prefix chains, screen-space-error selection with hysteresis and dithered fades, tiles for a far pass, and a generation work queue.",
});
