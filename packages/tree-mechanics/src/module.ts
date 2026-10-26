import { defineManifest } from "@keel-engine/runtime";

// (Renderer-free: it reads a tree's branch graph and pose as plain arrays and writes a posed copy.)
export const manifest = defineManifest({
  id: "keel/tree-mechanics",
  version: "0.1.0",
  kind: "runtime",
  needs: [],
  title: "KEEL Engine tree mechanics",
  description: "Tree mechanics: per-branch stiffness from the beam law, hierarchical wind sway, sag under snow and animals, storm breaks and falling limbs, and the climbable wood as capsules with what each piece can carry.",
});
