import { defineManifest } from "@keel-engine/runtime";

export const manifest = defineManifest({
  id: "keel/pipeline", version: "0.1.0", kind: "runtime", needs: ["keel/runtime@^0.1"],
  title: "Pipeline", description: "Generate once, compile through independently pinned modules, reuse unchanged artifacts.",
  provides: ["asset/pipeline@1.0.0"],
});
