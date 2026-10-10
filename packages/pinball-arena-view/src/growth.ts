import { poseMatrices, type BakeWorld } from "@keel-engine/bake";
import { createRoll, deriveSeed } from "@keel-engine/core";
import { slotOf, type WorldRoles } from "@keel-engine/object";
import type { ArenaBallFrame, ArenaSurface } from "@keel-engine/pinball-arena";

export const ARENA_GROWTH_ROLES = { bark: { as: "hair", stuff: "wood" }, leaf: { as: "clothAlt", stuff: "cloth" } } as const satisfies WorldRoles;
export interface ArenaGrateGrowth { readonly rest: BakeWorld; readonly anchors: readonly { readonly x: number; readonly y: number; readonly side: number; readonly phase: number }[] }

/** Low vines grow only over the outer strip of an actual four-corner grate.
 * Their full lateral motion remains within the outer7 physical units, beyond
 * the admitted12-unit body centre corridor. Source identity owns all choices. */
export function arenaGrateGrowth(surface: ArenaSurface, scale: number, seed: string, density = .72): ArenaGrateGrowth | null {
  if (surface.polygon.length !== 4 || !/wireform/.test(surface.material)) return null;
  const p = surface.polygon, heights = surface.vertexElevations ?? p.map(() => surface.height), roll = createRoll(deriveSeed(seed, `grate-growth:${surface.id}`));
  if (roll.index(0, 1024) / 1024 >= Math.max(0, Math.min(1, density))) return null;
  const at = (u: number, v: number) => {
    const w = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
    return [p.reduce((n, point, i) => n + point.x * w[i]!, 0) * scale, heights.reduce((n, h, i) => n + h * w[i]!, 0) * scale, p.reduce((n, point, i) => n + point.y * w[i]!, 0) * scale] as const;
  };
  const boxes: NonNullable<BakeWorld["boxes"]>[number][] = [], capsules: NonNullable<BakeWorld["capsules"]>[number][] = [], anchors: { x: number; y: number; side: number; phase: number }[] = [];
  const length = Math.hypot((p[1]!.x + p[2]!.x - p[0]!.x - p[3]!.x) * .5, (p[1]!.y + p[2]!.y - p[0]!.y - p[3]!.y) * .5);
  if (length < 36) return null;
  const yaw = -Math.atan2(p[1]!.y - p[0]!.y, p[1]!.x - p[0]!.x), count = Math.max(1, Math.min(5, Math.floor(length / 28)));
  for (const side of [0, 1]) {
    const v = side ? .965 : .035, a = at(.14, v), b = at(.86, v);
    capsules.push({ a: [a[0], a[1] + .033, a[2]], b: [b[0], b[1] + .033, b[2]], r: scale * .70, mat: slotOf(ARENA_GROWTH_ROLES, "bark") });
    for (let i = 0; i < count; i++) {
      const u = .18 + (i + .5) / count * .64, point = at(u, v), leafSize = 3.5 + roll.index(2 + side * 8 + i, 4) * .40;
      boxes.push({ c: [point[0], point[1] + .06, point[2]], h: [leafSize * scale, .018, 1.2 * scale], yaw: yaw + (side ? -.2 : .2), kind: "wedge", lo: .004, mat: slotOf(ARENA_GROWTH_ROLES, "leaf") });
      anchors.push({ x: point[0] / scale, y: point[2] / scale, side, phase: roll.index(30 + side * 8 + i, 256) / 256 * Math.PI * 2 });
    }
  }
  return { rest: { boxes, capsules }, anchors };
}

/** Stateless cosmetic response: wind bends each leaf; a nearby real sphere
 * briefly lifts it. It cannot change capture, support, collision or replay. */
export function arenaGrateGrowthPose(growth: ArenaGrateGrowth, scale: number, seconds: number, balls: readonly ArenaBallFrame[], reducedMotion = false): Float32Array | undefined {
  if (reducedMotion) return undefined;
  const posed = { boxes: growth.rest.boxes!.map((b, i) => {
    const anchor = growth.anchors[i]!, response = balls.reduce((amount, ball) => ball.transport === null && !ball.eliminated ? Math.max(amount, Math.max(0, 1 - Math.hypot(ball.x - anchor.x, ball.y - anchor.y) / 80)) : amount, 0);
    return { ...b, c: [b.c[0]!, b.c[1]! + Math.sin(seconds * 2.4 + anchor.phase) * .012 + response * .025, b.c[2]!] };
  }), capsules: growth.rest.capsules };
  return poseMatrices(growth.rest, posed);
}
