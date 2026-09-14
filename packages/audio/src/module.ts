// The audio module's engine manifest: an engine part that needs only the
// codec (music recipes, songs and sfx settings are stored as its bytes). Tone
// and KEEL_AUDIO are the page's globals, not modules; the runtime builds the
// manifest at build time (the module never reaches it at run time).
import { defineManifest } from "@keel-engine/runtime";

export const manifest = defineManifest({
  id: "keel/audio",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/codec@^0.1"],
  title: "Audio",
  description: "Generative lo-fi records from a mood and a seed, live intensity, seeded game SFX, KEEL audio.",
});
