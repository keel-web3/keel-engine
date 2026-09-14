import { defineManifest } from "@keel-engine/runtime";

// (The renderer reads core's frame (cameraBasis) and its dither screens.)
export const manifest = defineManifest({
  id: "keel/render",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1"],
  title: "KEEL Engine render",
  description: "The WebGL2 pixel renderer and its fx passes: palette ramps, dither screens, outlines, at any target size.",
});
