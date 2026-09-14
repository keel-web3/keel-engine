import { contentsOf, defineManifest } from "@keel-engine/runtime";
import { pack } from "./pack.ts";

// (Compatible with packs/cloth only -- a handshake, not an open door: fits() lets another pack's wearables onto
// these animals only when that pack names this one AND this one names it. "*" would open the animals to every
// wearables pack that lists them; see the README.)
export const manifest = defineManifest({
  id: "packs/animals",
  version: "1.0.0",
  kind: "pack",
  needs: ["keel/runtime@^0.1", "keel/entity@^0.1"],
  provides: ["body/quadruped@1.0.0", "attributes/wearable@1.0.0"],
  compatible: ["packs/cloth@^1"],
  contents: contentsOf(pack),
  title: "Animals",
  description: "Dogs, cats, foxes, bears, rabbits, mice and deer on four legs (body/quadruped@1.0.0), each with its own choices; a collar and saddlebags only they wear.",
});
