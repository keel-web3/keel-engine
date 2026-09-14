import { defineManifest } from "@keel-engine/runtime";

// (Pure code: no other engine part. It runs in KEEL's data phase, right after the registry, so a pack's
// data module can decode its contents before anything reads them.)
export const manifest = defineManifest({
  id: "keel/codec",
  version: "0.1.0",
  kind: "runtime",
  phase: "data",
  weight: -31000,
  title: "KEEL Engine bit codec",
  description: "Typed schemas, canonical bit-packed encoding, self-describing documents with a schema registry, a JSON view and a bit inspector; the engine's packed formats for objects, looks, worlds, particles, sounds and scripts.",
});
