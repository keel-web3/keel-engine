import type { ArenaBiomeBlend } from "@keel-engine/pinball-arena";
import { slotOf, type WorldRoles } from "@keel-engine/object";
import type { LayerPaint } from "@keel-engine/bake";
import { worldArtPaint, type PinballSceneGenome } from "@keel-engine/pinball-world-art";

/** Recessed scenery is opaque and quiet. Authored hues/material breaks remain,
 * while rail-like edge glow, metal mirrors and brilliant cyan inserts cannot
 * turn the surrounding foundation into a second set of playable paths. */
export function arenaFoundationPaint(roles: WorldRoles, seed: string, biome: ArenaBiomeBlend, scene: PinballSceneGenome): LayerPaint {
  const paint = worldArtPaint(roles, seed, biome, scene.material.tones), floor = scene.environment?.floor;
  const base = Math.max(.20, Math.min(.28, floor ? scene.material.tones[floor.role]![2] * .66 : .24));
  const names = new Map(Object.keys(roles).map(role => [slotOf(roles, role), role]));
  return paint.map((part, index) => {
    if (!part) return part;
    const role = names.get(index), offset = role === "dark" ? -.045 : role === "ground" ? 0 : role === "stone" || role === "rail" ? .045 : role === "core" || role === "trim" ? .035 : .02;
    return { ...part, sheen: "none" as const, mirror: 0, look: { ...part.look, light: Math.max(.15, Math.min(.34, base + offset)), span: .065, chroma: Math.min(.075, part.look.chroma * .55), finish: "matte" as const } };
  });
}

/** Native-bound retaining structures establish volume with matte materials;
 * their trim remains quieter than actual rail/capture/shot signals. Nearby
 * semantic lamp assets keep their own independent light vocabulary. */
export function arenaBoundaryPaint(roles: WorldRoles, seed: string, biome: ArenaBiomeBlend, scene: PinballSceneGenome): LayerPaint {
  return worldArtPaint(roles, seed, biome, scene.material.tones).map(part => part ? { ...part, sheen: "none", mirror: 0, look: { ...part.look, light: Math.min(.49, part.look.light), span: .12, chroma: Math.min(.10, part.look.chroma), finish: "matte" } } : part);
}

/** Only scenery loses lighting/animation emphasis with distance. Bodies,
 * blades, physical guides and source-backed mechanism cues have other budgets.
 * Quantized bands prevent camera drift from allocating a new look each frame. */
export function arenaSceneryPriority(distance: number, overview: boolean): { readonly light: number; readonly signal: number } {
  if (overview || distance >= 40) return { light: .62, signal: .10 };
  if (distance >= 25) return { light: .74, signal: .28 };
  if (distance >= 14) return { light: .86, signal: .55 };
  return { light: 1, signal: 1 };
}
