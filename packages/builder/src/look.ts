// Looks: what roles wear. A model carries roles; a look gives each role a
// ramp and a renderer material. The builder's default look is here so a
// built thing can be seen at once; a game's looks (and the baker's) replace
// it -- recolouring is a look, never an edit.
//
//   const look = builderLook({ primary: [0.55, 0.12, 30] });    // OKLCH per role, the rest defaulted
//   px.setPalette(look.palette.colours, look.palette.ramps); px.setMaterials(look.materials);
//   look.table.primary   // the material number primary wears
//
// Material numbers: 4 and 5 are the renderer's water and sky (left as they
// are), so roles start at 6; "glow" is emissive and "glow-dim" is the same
// ramp unlit (what a flickering lamp drops to).

import { oklch } from "@keel-engine/core";
import type { Role as EntityRole } from "@keel-engine/entity";
import { ROLES } from "./voxels.ts";

export type Oklch = readonly [number, number, number];

/** A material as the pixel renderer (and the baker) takes it. */
export interface LookMaterial { readonly ramp: string; readonly light?: number; readonly pattern?: number; readonly glow?: number }
export interface Look {
  readonly palette: { readonly colours: Array<[number, number, number]>; readonly ramps: Record<string, [number, number]> };
  readonly materials: LookMaterial[];
  /** Role -> material number (every standard role, "glow-dim", and any extra role asked for). */
  readonly table: Readonly<Record<string, number>>;
  readonly colours: Readonly<Record<string, Oklch>>;
}

/** The default colour each role wears (OKLCH). */
export const DEFAULT_COLOURS: Readonly<Record<string, Oklch>> = Object.freeze({
  primary: [0.62, 0.11, 55], secondary: [0.52, 0.08, 215], trim: [0.8, 0.07, 85], accent: [0.6, 0.17, 25],
  skin: [0.78, 0.07, 60], dark: [0.26, 0.02, 280], glow: [0.9, 0.15, 95],
});

/** How the builder's roles play on an engine entity's materials (for attributes worn by packs' characters). */
export const ENTITY_ROLE_OF: Readonly<Record<string, EntityRole>> = Object.freeze({
  primary: "cloth", secondary: "clothAlt", trim: "furAlt", accent: "accent", skin: "fur", dark: "dark", glow: "blush",
});
export const entityRoleOf = (role: string): EntityRole => ENTITY_ROLE_OF[role] ?? "cloth";

// A ramp of n entries dark to light round a colour (as the baker's rampAround): chroma easing off at both ends, the hue turning a little.
function rampAround([L, C, h]: Oklch, n: number): Array<[number, number, number]> {
  const L0 = Math.max(0.1, L - 0.42), L1 = Math.min(0.98, L + 0.16), c = Math.max(C, 0.015), turn = 12;
  return Array.from({ length: n }, (_, i) => {
    const k = n > 1 ? i / (n - 1) : 0.5;
    const [r, g, b] = oklch(L0 + (L1 - L0) * k, c * Math.sin(Math.PI * (0.15 + 0.7 * k)), h + turn * (k - 0.5));
    return [r, g, b];
  });
}

/** A look: a ramp round each role's colour, a material each. Extra roles (beyond the standard seven) wear primary unless coloured. */
export function builderLook(colours: Readonly<Record<string, Oklch>> = {}, { rampLength = 5, extra = [] as readonly string[] } = {}): Look {
  const all: Record<string, Oklch> = { ...DEFAULT_COLOURS, ...colours };
  const roles = [...ROLES, ...extra.filter((r) => !(ROLES as readonly string[]).includes(r))];
  const list: Record<string, Array<[number, number, number]>> = {};
  for (const r of roles) list[r] = rampAround(all[r] ?? all["primary"]!, r === "dark" ? Math.max(3, rampLength - 1) : rampLength);
  const colourList: Array<[number, number, number]> = [];
  const ramps: Record<string, [number, number]> = {};
  for (const [name, r] of Object.entries(list)) { ramps[name] = [colourList.length, r.length]; colourList.push(...r); }
  // (0..3 dark; 4 water and 5 sky, the renderer's; then a material per role; glow emissive, glow-dim its unlit twin.)
  const materials: LookMaterial[] = [{ ramp: "dark" }, { ramp: "dark" }, { ramp: "dark" }, { ramp: "dark", light: 0.8 }, { ramp: "dark" }, { ramp: "dark" }];
  const table: Record<string, number> = {};
  for (const r of roles) {
    table[r] = materials.length;
    materials.push(r === "glow" ? { ramp: "glow", light: 0.7, glow: 0.7 } : r === "dark" ? { ramp: "dark", light: 0.85 } : { ramp: r, light: r === "skin" ? 1.1 : 1 });
  }
  table["glow-dim"] = materials.length;
  materials.push({ ramp: "glow", light: 0.45 });
  const used: Record<string, Oklch> = {};
  for (const r of roles) used[r] = all[r] ?? all["primary"]!;
  return { palette: { colours: colourList, ramps }, materials, table, colours: used };
}

/** A role's material number in a look (unknown roles wear primary's). */
export const materialOf = (look: Pick<Look, "table">, role: string): number => look.table[role] ?? look.table["primary"] ?? 6;
