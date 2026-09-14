import { defineManifest } from "./manifest.ts";

// (The registry itself: it puts KEEL_ENGINE on the page, so it runs first -- in KEEL's data phase,
// just after the onchain-data layer at -32768.)
export const manifest = defineManifest({
  id: "keel/runtime",
  version: "0.1.0",
  kind: "runtime",
  phase: "data",
  weight: -32000,
  title: "KEEL Engine runtime",
  description: "The KEEL_ENGINE registry: module manifests, dependency and compatibility resolution, packs, entities, attributes and their targeting.",
});
