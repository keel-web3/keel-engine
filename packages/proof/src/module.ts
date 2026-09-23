import { defineManifest } from "@keel-engine/runtime";

// (A simulation whose result a chain can accept from a proof: the bytes it reads, the bytes it commits, the one roll both languages share.)
export const manifest = defineManifest({
  id: "keel/proof",
  version: "0.1.0",
  kind: "runtime",
  needs: ["keel/codec@^0.1"],
  title: "KEEL Engine proof",
  description: "Provable simulations: packed canonical inputs and results, a portable integer roll, the public-values envelope a zkVM guest commits, parity vectors for the Rust twin.",
});
