import type { ArenaField } from "@keel-engine/pinball-arena";

export interface PinballCatchFront {
  readonly stationId: string; readonly layer: number; readonly elevation: number;
  readonly x: number; readonly y: number;
  readonly upX: number; readonly upY: number;
  readonly halfWidth: number; readonly depth: number;
}

/** A catch owns a down-table architectural opening. Its actual pair supplies
 * the axis and its native drain supplies the downhill side, including rotated
 * and mirrored banks. This reserves scenery only, never physical geometry. */
export function pinballCatchFronts(field: ArenaField): readonly PinballCatchFront[] {
  return field.stations.flatMap(bank => {
    const blades = field.flippers.filter(f => bank.flipperIds.includes(f.id)), left = blades.find(f => f.side === "left"), right = blades.find(f => f.side === "right");
    if (!left || !right) return [];
    const dx = right.pivotX - left.pivotX, dy = right.pivotY - left.pivotY, span = Math.hypot(dx, dy);
    if (span < 1) return [];
    const x = (left.pivotX + right.pivotX) * .5, y = (left.pivotY + right.pivotY) * .5;
    const drains = field.hazards?.filter(h => h.kind === "drain" && h.layer === bank.layer && Math.abs(h.elevation - bank.elevation) <= Math.max(left.radius, right.radius) * 2) ?? [];
    const drain = drains.find(h => h.id === `${bank.id}.drain`) ?? drains.filter(h => Math.hypot(h.x - x, h.y - y) <= Math.max(left.length, right.length) * 5).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    // The same no-drain convention as the consumer camera. Scenery cannot
    // change the bank's orientation by inventing a replacement hazard.
    const normal = [-dy / span, dx / span] as const, side = drain && normal[0] * (drain.x - x) + normal[1] * (drain.y - y) < -1e-6 ? 1 : -1;
    return [{ stationId: bank.id, layer: bank.layer, elevation: bank.elevation, x, y, upX: normal[0] * side, upY: normal[1] * side, halfWidth: Math.max(span * 1.1, Math.max(left.length, right.length) * 2), depth: Math.max(400, span * 3) }];
  });
}

/** Intersect a complete horizontal envelope with the catch front window.
 * Recessed scenery remains eligible; raised galleries and fixture silhouettes
 * leave a real opening above the existing native rim and drain apron. */
export function pinballCatchFrontClear(fronts: readonly PinballCatchFront[], point: { readonly x: number; readonly y: number }, radius: number, layer: number, sourceHeight: number, top: number): boolean {
  if (!Number.isFinite(point.x + point.y + radius + sourceHeight + top) || radius < 0) return false;
  for (const front of fronts) {
    if (front.layer !== layer || Math.abs(sourceHeight - front.elevation) > 24 || top < front.elevation - 12) continue;
    const dx = point.x - front.x, dy = point.y - front.y, along = dx * front.upX + dy * front.upY, cross = dx * front.upY - dy * front.upX;
    if (along <= radius && along >= -front.depth - radius && Math.abs(cross) <= front.halfWidth + radius) return false;
  }
  return true;
}
