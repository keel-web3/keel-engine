import { defineManifest } from "@keel-engine/runtime";

// (Particles draw from core's seeded streams and build their palette with core's OKLCH, and save as bytes through
// the codec; bake's pixel view is a type only -- the renderer takes any view of that shape -- so nothing else
// needs to be loaded.)
export const manifest = defineManifest({
  id: "keel/particles",
  version: "0.1.1",
  kind: "runtime",
  needs: ["keel/core@^0.1", "keel/codec@^0.1"],
  title: "KEEL Engine particles",
  description: "Particles for the pixel engine: a fixed pool with budgets, priorities and LOD, emitters as recipes (bursts, streams, trails; sockets; sub-emitters), a preset library, closed-form motion drawn on the GPU beside the sprites -- and the proof of concept's pool.",
});
