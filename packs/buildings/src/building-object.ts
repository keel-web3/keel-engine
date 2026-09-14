// A building variant as a styled object: its own choices, mapped onto the
// generator's parameters (generator.ts). Every variant is the generator with
// a personality -- which footprints, roofs, doors and extras it draws from.
import { defineStyledObject } from "@keel-engine/object";
import type { StyledObjectDef, StyledObjectSpec, Values } from "@keel-engine/object";
import { DEFAULT_PARAMS, buildingDesign } from "./generator.ts";
import { roles } from "./kit.ts";

/** Every role the generator may paint: a variant's own come first (they lead its look), the rest follow. */
const GENERATOR_ROLES = roles("wall", "roof", "trim", "wood", "stone", "glass", "door", "metal", "glow", "cloth", "sign", "dark");
import type { BuildingParams } from "./generator.ts";

export interface BuildingVariant {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly choices: StyledObjectSpec["choices"];
  readonly look: StyledObjectSpec["look"];
  readonly tier?: StyledObjectSpec["tier"];
  readonly variants?: number;
  /** The generator's parameters from this variant's values. */
  params(v: Values): Partial<BuildingParams>;
}

export function buildingObject(b: BuildingVariant): StyledObjectDef {
  return defineStyledObject({
    id: b.id, title: b.title, tags: ["building", ...b.tags], tier: b.tier ?? "main", instancing: "few", variants: b.variants ?? 4,
    choices: b.choices, look: { ...b.look, roles: { ...b.look.roles, ...Object.fromEntries(Object.entries(GENERATOR_ROLES).filter(([k]) => !(k in b.look.roles))) } }, sway: null,
    design(J, v) {
      const d = buildingDesign(J, { ...DEFAULT_PARAMS, ...b.params(v) });
      const P = { ...DEFAULT_PARAMS, ...b.params(v) };
      // (Voxels a storey an eighth high: a window stays a window. The style coarsens past its box budget.)
      return { solids: d.solids, sockets: d.sockets, front: "+z", tags: d.tags, meta: d.meta, voxel: { unit: Math.round(Math.max(0.25, Math.min(0.45, Math.max(P.width, P.depth) / 28)) * 200) / 200 } };
    },
  });
}
