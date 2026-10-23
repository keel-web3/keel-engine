import { defineManifest } from "@keel-engine/runtime";
import { PACK_ID, PACK_VERSION, pack } from "./pack.ts";
export const manifest = defineManifest({ id: PACK_ID, version: PACK_VERSION, kind: "pack", needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/pinball-arena@^0.1", "keel/object@^0.1", "keel/bake@^0.1", "packs/foliage@^1.0"], provides: ["objects/pinball-world@0.1.0"], contents: pack.contents(), title: "Pinball machinery and framing art", description: "Optional original machinery, gateways and canonical foliage that frame generated pinball structures." });
