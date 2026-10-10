import { arenaSceneForRegion, type ArenaField, type ArenaSceneGenome } from "@keel-engine/pinball-arena";

/** Exactly the authority's nearest-center rule, including source-order ties.
 * Region rectangles may overlap; they are never ownership tests. */
export function arenaArtRegionAt(field: ArenaField, x: number, y: number): string {
  const distance = (region: ArenaField["regions"][number]) => (region.center.x - x) ** 2 + (region.center.y - y) ** 2;
  return field.regions.reduce((best, region) => distance(region) < distance(best) ? region : best).id;
}
export function arenaArtSceneAt(field: ArenaField, x: number, y: number, layer: number, canonicalRegionId?: string): ArenaSceneGenome | undefined {
  return arenaSceneForRegion(field, canonicalRegionId ?? arenaArtRegionAt(field, x, y), layer);
}
