import { contentsOf, defineManifest } from "@keel-engine/runtime";
import { pack } from "./pack.ts";

// (Its entities ride keel/entity's rigs and carry their contracts' sockets, but they draw their own geometry -- an
// animal AI bound by contract:body/quadruped would find a crawler, not an animal -- so the pack provides its own
// contract, creatures/plans, and not the body contracts; and no other pack's wearables are declared compatible.)
export const manifest = defineManifest({
  id: "packs/creatures",
  version: "1.0.0",
  kind: "pack",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/entity@^0.1"],
  provides: ["creatures/plans@1.0.0"],
  compatible: [],
  contents: contentsOf(pack),
  title: "Creatures",
  description: "Body plans a roster reads apart by -- crawler, walker, strider, floater, flyer, rider, serpent -- each its own geometry over a keel/entity rig, animated by the rig's clips.",
});
