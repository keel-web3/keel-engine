import { defineManifest } from "@keel-engine/runtime";

export const manifest = defineManifest({
  id: "keel/lit",
  version: "0.1.0",
  kind: "runtime",
  needs: [],
  title: "KEEL Engine lit",
  description: "The full-colour lit renderer (WebGL2): meshes and instances lit by sun, moon and sky, physically based and toon surfaces, soft shadows, fog, render targets and custom shaders.",
});
