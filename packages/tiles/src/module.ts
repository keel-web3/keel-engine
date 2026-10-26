import { defineManifest } from "@keel-engine/runtime";

// (The surface is one keel/lit mesh and material; the systems and atlases are plain data.)
export const manifest = defineManifest({
  id: "keel/tiles",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/lit@^0.1"],
  title: "KEEL Engine tiles",
  description: "Tile surfaces for keel/lit: one grid, a tile system per material (organic blend, blob47, wang16, cardinal16, dual-grid), painted or imported atlases, pixel-snapped edges with rims and drop shadows.",
});
