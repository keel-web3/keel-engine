import { contentsOf, defineManifest } from "@keel-engine/runtime";
import { pack } from "./pack.ts";

// (Compatible with packs/cloth: the two name each other, so cloth's wearables fit these characters. Another
// wearables pack gets on only when both it and this manifest list each other.)
export const manifest = defineManifest({
  id: "packs/humans",
  version: "1.0.0",
  kind: "pack",
  needs: ["keel/runtime@^0.1", "keel/entity@^0.1"],
  provides: ["body/humanoid@1.0.0"],
  compatible: ["packs/cloth@^1"],
  contents: contentsOf(pack),
  title: "Humans",
  description: "A person and anthro cats, foxes, bunnies, bears, mice, frogs and dogs on two legs (body/humanoid@1.0.0), each with its own choices.",
});
