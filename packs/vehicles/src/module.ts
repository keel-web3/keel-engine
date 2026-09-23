import { defineManifest } from "@keel-engine/runtime";

export const PACK_ID = "packs/vehicles";
export const PACK_VERSION = "1.0.1";

// (Cars are generated, not listed: the pack provides the generator, its bake shapes and its handling. Its bake shapes
// are keel/bake's indexed designs and layer paints; its moving parts -- the engine cover, the convertible's roof --
// are posed with keel/bake's matrices, so it needs keel/bake at runtime too.)
export const manifest = defineManifest({
  id: PACK_ID,
  version: PACK_VERSION,
  kind: "pack",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/bake@^0.1", "keel/vehicle@^0.1"],
  provides: ["vehicles/car@1.0.0"],
  title: "Vehicles",
  description: "Generative cars: every seed its own -- continuous dials on curves (length, width, stance, cabin, glass rake, fastback, wheels and stagger, aero, flares, ride, power, mass), eight archetypes as biases (hyper, GT, muscle, rally, kei, pickup, buggy, prototype), gated parts and weighted forms (lights, spoilers, scoops, splitters, cages, beds, exhausts, rims, livery), colours as curves, a rarity and a tier -- built as indexed bake shapes: a body, and wheels as their own layers that spin and steer; every part wearing its own finish and dither screen; handling from the same dials.",
});
