import { defineManifest } from "@keel-engine/runtime";

// (The UI draws from core's seeded streams, OKLCH and dither screens, and stores themes, fonts and screens as
// codec records -- its schemas are in src/schemas.ts, which the KEEL build lists in contents.schemas. It needs
// nothing else: it composes its own pixel layer, which a game shows on a canvas above its own or draws into its
// own WebGL2 context.)
export const manifest = defineManifest({
  id: "keel/ui",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/codec@^0.1"],
  title: "KEEL Engine UI",
  description: "The generative UI system: themes from a seed and a culture, generative and imported pixel fonts, generative icons, retained-mode widgets in one palette-true pixel layer, and one-call HUDs, menus and loading screens.",
});
