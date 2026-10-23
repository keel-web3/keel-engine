import type { ArenaBounds, ArenaField, ArenaRail, ArenaBumper } from "@keel-engine/pinball-arena";

export interface ArenaPhysicalPartition {
  readonly id: string; readonly bounds: ArenaBounds;
  readonly rails: readonly ArenaRail[]; readonly bumpers: readonly ArenaBumper[];
}

/** Static physics is partitioned by its own geometry, independently of sparse
 * or overlapping scenery chunks. Every collider belongs to exactly one mesh;
 * the culling bounds include its complete horizontal extent. */
export function arenaPhysicalPartitions(field: Pick<ArenaField, "rails" | "bumpers">): readonly ArenaPhysicalPartition[] {
  const groups = new Map<string, { rails: ArenaRail[]; bumpers: ArenaBumper[] }>();
  const group = (x: number, y: number) => {
    const key = `${Math.floor(x / 768)}.${Math.floor(y / 768)}`, values = groups.get(key) ?? { rails: [], bumpers: [] };
    groups.set(key, values); return values;
  };
  for (const rail of field.rails) group((rail.ax + rail.bx) * .5, (rail.ay + rail.by) * .5).rails.push(rail);
  for (const bumper of field.bumpers) group(bumper.x, bumper.y).bumpers.push(bumper);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, values]) => {
    const colliders = [...values.rails.map(rail => ({ rail })), ...values.bumpers.map(bumper => ({ bumper }))];
    return Array.from({ length: Math.ceil(colliders.length / 128) }, (_, index) => {
      const subset = colliders.slice(index * 128, (index + 1) * 128), rails: ArenaRail[] = [], bumpers: ArenaBumper[] = [];
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      const include = (ax: number, ay: number, bx: number, by: number, radius: number) => { bounds[0] = Math.min(bounds[0]!, ax - radius, bx - radius); bounds[1] = Math.min(bounds[1]!, ay - radius, by - radius); bounds[2] = Math.max(bounds[2]!, ax + radius, bx + radius); bounds[3] = Math.max(bounds[3]!, ay + radius, by + radius); };
      for (const collider of subset) {
        if ("rail" in collider) { const rail = collider.rail; rails.push(rail); include(rail.ax, rail.ay, rail.bx, rail.by, rail.radius); }
        else { const bumper = collider.bumper; bumpers.push(bumper); include(bumper.x, bumper.y, bumper.x, bumper.y, bumper.radius); }
      }
      return { id: `${key}.${index}`, rails, bumpers, bounds: bounds as unknown as ArenaBounds };
    });
  });
}

/** Cosmetic framing may extend beyond the authority's battle/storm rectangle.
 * Map/overview cameras fit those extents without changing the world record. */
export function arenaPresentationBounds(field: Pick<ArenaField, "bounds" | "chunks">): ArenaBounds {
  const bounds = [...field.bounds];
  for (const chunk of field.chunks) { bounds[0] = Math.min(bounds[0]!, chunk.bounds[0]); bounds[1] = Math.min(bounds[1]!, chunk.bounds[1]); bounds[2] = Math.max(bounds[2]!, chunk.bounds[2]); bounds[3] = Math.max(bounds[3]!, chunk.bounds[3]); }
  return bounds as unknown as ArenaBounds;
}
