import { defineManifest } from "@keel-engine/runtime";

// (The foundation: seeded streams, the frame, math, SDFs, palettes, screens, the quantizer. It needs nothing.)
export const manifest = defineManifest({
  id: "keel/core",
  version: "0.1.0",
  kind: "runtime",
  needs: [],
  title: "KEEL Engine core",
  description: "Seeded streams, the frame convention, math, SDF primitives, OKLCH palettes, dither screens, the quantizer, the GIF encoder.",
});
