import { defineManifest, contentsOf } from "@keel-engine/runtime";
import { pack } from "./pack.ts";
export const manifest = defineManifest({ id: "packs/pinball-robots", version: "0.3.0", kind: "pack", needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/entity@^0.1", "keel/object@^0.1", "keel/bake@^0.1"], provides: ["body/rollable-robot@1.0.0"], contents: contentsOf(pack), title: "Original rollable robots", description: "Seeded named robot families with one resolved portrait, folded-shell and unfolded prototype identity." });
