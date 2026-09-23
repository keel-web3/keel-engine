import { defineManifest } from "@keel-engine/runtime";

// (Matches between staked tokens that a contract settles from a zk proof: the bytes it commits to, the bytes it applies, any format.)
export const manifest = defineManifest({
  id: "keel/arena",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/codec@^0.1", "keel/proof@^0.1"],
  title: "KEEL Engine arena",
  description: "Staked matches settled from a proof: the generic match input and entrant chain, placings with inline or Merkle settlement, and match formats that plug in without touching the contract.",
});
