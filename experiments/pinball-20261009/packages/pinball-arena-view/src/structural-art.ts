import { lookMesh, mergeMeshes, type LookMesh, type BakeWorld } from "@keel-engine/bake";
import { slotOf, type WorldRoles } from "@keel-engine/object";
import type { ArenaSurface, ArenaFlipper, ArenaField, ArenaStation } from "@keel-engine/pinball-arena";
import { type PinballSceneGenome } from "@keel-engine/pinball-world-art";
import { arenaSubstrateVolume } from "./substrate.ts";

/** Complete, distinct material slots for authored structure. Physical body
 * and surface paints use their own existing roles; no missing role falls to0. */
export const ARENA_STRUCTURE_ROLES = {
  body: { as: "primary", stuff: "paint" }, steel: { as: "metal", stuff: "metal" },
  rail: { as: "cloth", stuff: "metal" }, core: { as: "glow", stuff: "glow" }, trim: { as: "trim", stuff: "metal" }, dark: { as: "dark", stuff: "paint" },
  bark: { as: "hair", stuff: "wood" }, leaf: { as: "clothAlt", stuff: "cloth" }, stone: { as: "detail", stuff: "bone" }, gold: { as: "accent", stuff: "metal" }, ground: { as: "furAlt", stuff: "paint" },
} as const satisfies WorldRoles;
const structureSlot = (scene: PinballSceneGenome, role: string): number => {
  if (!(role in ARENA_STRUCTURE_ROLES) || !scene.material.tones[role]) throw new RangeError(`Unbound pinball structure material: ${role}`);
  return slotOf(ARENA_STRUCTURE_ROLES, role);
};

/** The native silhouette becomes the actual surrounding chassis. Authored
 * sections sit below the source top; they neither add a support plane nor
 * cover the physical route with a decorative floor. */
export function arenaStructuralRim(surface: ArenaSurface, scale: number, scene: PinballSceneGenome): LookMesh {
  const p = surface.polygon, heights = surface.vertexElevations ?? p.map(() => surface.height), boxes: NonNullable<BakeWorld["boxes"]>[number][] = [];
  const winding = Math.sign(p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]!; return sum + a.x * b.y - b.x * a.y; }, 0));
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); if (length < .001) continue; const nx = -dy / length * winding, ny = dx / length * winding;
    for (const band of scene.structure?.rim ?? []) {
      boxes.push({ c: [((a.x + b.x) * .5 + nx * band.inset) * scale, (Math.min(heights[i]!, heights[(i + 1) % p.length]!) - band.drop + band.height * .5) * scale, ((a.y + b.y) * .5 + ny * band.inset) * scale], h: [length * scale * .5, band.height * scale * .5, band.width * scale * .5], yaw: -Math.atan2(dy, dx), mat: structureSlot(scene, band.role) });
    }
  }
  return lookMesh({ boxes });
}

/** A visibly recessed scene foundation surrounds the real support geometry.
 * It is presentation-only, never a physical deck or a traversal surface. */
export function arenaEnvironmentFloor(field: ArenaField, scale: number, scene: PinballSceneGenome, bounds = field.bounds, layer = 0, surround = true, moving = false): LookMesh {
  const floor = scene.environment?.floor; if (!floor) return lookMesh({ boxes: [] });
  const [x0, y0, x1, y1] = bounds, z = arenaFoundationHeight(field, scene), margin = surround ? floor.margin : 0;
  const volumes = arenaSubstrateVolume(field, scale, scene, [x0 - margin, y0 - margin, x1 + margin, y1 + margin], z, role => structureSlot(scene, role), moving);
  if (moving) return volumes;
  const boxes: NonNullable<BakeWorld["boxes"]>[number][] = [{ c: [(x0 + x1) * .5 * scale, (z - 6) * scale, (y0 + y1) * .5 * scale], h: [(x1 - x0 + margin * 2) * .5 * scale, 6 * scale, (y1 - y0 + margin * 2) * .5 * scale], mat: structureSlot(scene, floor.role) }];
  // The foundation has its own dimensional grammar. Repeating catch artwork
  // over the whole map makes a plain downfield floor, rather than a room.
  return mergeMeshes([lookMesh({boxes}), volumes]);
}

/** One native-height foundation stays fixed while the camera changes layer. */
export function arenaFoundationHeight(field: ArenaField, scene: PinballSceneGenome): number {
  const heights = field.surfaces.flatMap(s => s.vertexElevations ?? [s.height]);
  return (heights.length ? Math.min(...heights) : 0) - (scene.environment?.floor?.depth ?? 0);
}

/** A theme's authored local machine grammar attaches to each real pivot. Its
 * consumer-admitted envelope stays <=half a blade radius above the native
 * plane; a high, unrelated statue is never placed in the stroke fan. */
export function arenaPivotHousing(flipper: ArenaFlipper, scale: number, scene: PinballSceneGenome, yaw: number, moving: boolean): LookMesh {
  const r = flipper.radius * scale, co = Math.cos(yaw), si = Math.sin(yaw), boxes: NonNullable<BakeWorld["boxes"]>[number][] = [], capsules: NonNullable<BakeWorld["capsules"]>[number][] = [];
  const point = (p: readonly number[]) => [flipper.pivotX * scale + (co * p[0]! + si * p[2]!) * r, flipper.elevation * scale + p[1]! * r, flipper.pivotY * scale + (-si * p[0]! + co * p[2]!) * r];
  for (const primitive of scene.structure?.hubs ?? []) {
    if ((primitive.motion === "pulse") !== moving) continue;
    if (primitive.kind === "box") boxes.push({ c: point(primitive.a), h: primitive.size.map(n => n * r), yaw, mat: structureSlot(scene, primitive.role) });
    else capsules.push({ a: point(primitive.a), b: point(primitive.kind === "ball" ? primitive.a : primitive.b), r: primitive.size[0] * r, mat: structureSlot(scene, primitive.role) });
  }
  return lookMesh({ boxes, capsules }, { around: 10, rings: 1 });
}

/** Substantial local housings follow the actual connected funnel guide chain.
 * Their inner face stays outside the native collider radius; the open stroke
 * fan remains the exact geometry between those guides. */
export function arenaCatchSideMachinery(field: ArenaField, bank: ArenaStation, scale: number, scene: PinballSceneGenome): LookMesh {
  const boxes: NonNullable<BakeWorld["boxes"]>[number][] = [], visited = new Set<string>();
  for (const blade of field.flippers.filter(f => bank.flipperIds.includes(f.id))) {
    let x = blade.pivotX, y = blade.pivotY;
    for (let step = 0; step < 8; step++) {
      const connected = field.rails.filter(r => r.kind === "guide" && r.layer === bank.layer && r.elevation === bank.elevation && (r.elevationB ?? r.elevation) === bank.elevation && !visited.has(r.id) && (Math.hypot(r.ax - x, r.ay - y) < .01 || Math.hypot(r.bx - x, r.by - y) < .01));
      if (connected.length !== 1) break; const rail = connected[0]!; visited.add(rail.id);
      const dx = rail.bx - rail.ax, dy = rail.by - rail.ay, length = Math.hypot(dx, dy); if (length < .01) break;
      const mx = (rail.ax + rail.bx) * .5, my = (rail.ay + rail.by) * .5, sign = Math.sign((-dy * (mx - bank.x) + dx * (my - bank.y))) || 1, nx = -dy / length * sign, ny = dx / length * sign;
      const bands = scene.structure?.rim ?? [];
      for (let i = 0; i < bands.length; i++) { const band = bands[i]!, width = Math.max(12, band.width * 1.6), outward = rail.radius + width * .5 + i * 2, height = Math.max(12, Math.min(30, band.height * .5));
        boxes.push({ c: [(mx + nx * outward) * scale, (bank.elevation + height * .5 - i * 5) * scale, (my + ny * outward) * scale], h: [length * .5 * scale, height * .5 * scale, width * .5 * scale], yaw: -Math.atan2(dy, dx), mat: structureSlot(scene, band.role) });
      }
      if (Math.hypot(rail.ax - x, rail.ay - y) < .01) { x = rail.bx; y = rail.by; } else { x = rail.ax; y = rail.ay; }
    }
  }
  return lookMesh({ boxes });
}
