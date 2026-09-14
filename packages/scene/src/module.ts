import { defineManifest } from "@keel-engine/runtime";

// (Transforms, bounds, the shape kit, asset registries and front detection: all built on core.)
export const manifest = defineManifest({
  id: "keel/scene",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/core@^0.1"],
  title: "KEEL Engine scene",
  description: "Transforms, bounds, the shape kit, primitives as parts, asset registries, front detection.",
});
