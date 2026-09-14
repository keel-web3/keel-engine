import { defineManifest } from "@keel-engine/runtime";

export const manifest = defineManifest({
  id: "fixtures/hello", version: "0.1.0", kind: "game",
  needs: ["keel/runtime@^0.1", "contract:body/blob@^1"],
  title: "Hello", description: "Every blob from every pack providing body/blob, each in a hat that fits it.",
});
