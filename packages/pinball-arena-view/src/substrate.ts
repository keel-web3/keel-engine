import { lookMesh, type BakeWorld, type LookMesh } from "@keel-engine/bake";
import { createRoll, deriveSeed } from "@keel-engine/core";
import type { ArenaBounds, ArenaField, ArenaSceneStructure, ArenaSurface } from "@keel-engine/pinball-arena";
import { pinballCatchFronts, pinballEnvironmentClear, type PinballSceneGenome } from "@keel-engine/pinball-world-art";

type Part = ArenaSceneStructure["hubs"][number];
export interface ArenaSubstrateSection {
  readonly id: string; readonly sourceSurfaceId: string; readonly x: number; readonly y: number;
  readonly yaw: number; readonly length: number; readonly width: number;
  readonly low: number; readonly high: number; readonly cross: number;
}
const area = (surface: ArenaSurface): number => Math.abs(surface.polygon.reduce((sum, a, i) => { const b = surface.polygon[(i + 1) % surface.polygon.length]!; return sum + a.x * b.y - b.x * a.y; }, 0));
const contains = (surface: ArenaSurface, x: number, y: number): boolean => {
  let inside = false; const p = surface.polygon;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i]!, b = p[j]!;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
function envelope(parts: readonly Part[], length: number, width: number, rise: number): readonly [number, number, number] {
  let low = 0, high = 0, cross = 0;
  for (const p of parts) { const radius = p.size[0] * Math.min(length, width, rise), rx = p.kind === "box" ? p.size[0] * length : radius, rz = p.kind === "box" ? p.size[2] * width : radius;
    low = Math.min(low, Math.min(p.a[0], p.b[0]) * length - rx); high = Math.max(high, Math.max(p.a[0], p.b[0]) * length + rx); cross = Math.max(cross, Math.max(Math.abs(p.a[2]), Math.abs(p.b[2])) * width + rz);
  }
  return [low, high, cross];
}

/** A bank's largest real catch bed owns connected recessed edge construction.
 * It is absent under playable corridors and down-table openings. Every part's
 * complete footprint is covered by the native clearance test, not just its
 * anchor. IDs depend on native edge identity, never camera or draw order. */
export function arenaSubstrateSections(field: ArenaField, scene: PinballSceneGenome): readonly ArenaSubstrateSection[] {
  const vocabulary = scene.environment?.substrate; if (vocabulary?.layout !== "boundary") return [];
  const fronts = pinballCatchFronts(field), beds = field.surfaces.filter(s => s.kind === "playfield");
  const selected = new Map<string, ArenaSurface>();
  for (const front of fronts) {
    const bed = beds.filter(s => s.layer === front.layer && Math.abs(s.height - front.elevation) < 24 && contains(s, front.x, front.y)).sort((a, b) => area(b) - area(a) || a.id.localeCompare(b.id))[0];
    if (bed) selected.set(bed.id, bed);
  }
  if (!selected.size) for (const bed of [...beds].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 8)) selected.set(bed.id, bed);
  const out: ArenaSubstrateSection[] = [];
  for (const surface of [...selected.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const p = surface.polygon, winding = Math.sign(p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]!; return sum + a.x * b.y - b.x * a.y; }, 0)) || 1;
    for (let edge = 0; edge < p.length && out.length < 72; edge++) {
      const a = p[edge]!, b = p[(edge + 1) % p.length]!, dx = b.x - a.x, dy = b.y - a.y, edgeLength = Math.hypot(dx, dy); if (edgeLength < 80) continue;
      const count = Math.min(8, Math.max(1, Math.ceil(edgeLength / vocabulary.spacing))), length = edgeLength / count, width = Math.min(160, vocabulary.spacing * .32);
      const [low, high, cross] = envelope(vocabulary.parts, length, width, vocabulary.rise), samples = Math.max(1, Math.ceil((high - low) / 40)), cover = cross + (high - low) / samples * .5;
      const nx = winding * dy / edgeLength, ny = -winding * dx / edgeLength, outward = cross + 56;
      for (let section = 0; section < count && out.length < 72; section++) {
        const t = (section + .5) / count, x = a.x + dx * t + nx * outward, y = a.y + dy * t + ny * outward;
        const bound = Math.hypot(Math.max(-low, high), cross);
        if (fronts.some(f => { const along = (x - f.x) * f.upX + (y - f.y) * f.upY, across = (x - f.x) * f.upY - (y - f.y) * f.upX;
          return f.layer === surface.layer && along < bound && along > -f.depth - bound && Math.abs(across) < f.halfWidth + bound;
        })) continue;
        let clear = true;
        for (let sample = 0; sample <= samples; sample++) {
          const along = low + (high - low) * sample / samples;
          if (!pinballEnvironmentClear(field, { x: x + dx / edgeLength * along, y: y + dy / edgeLength * along }, cover, 32)) { clear = false; break; }
        }
        if (clear) out.push({ id: `${surface.id}/edge:${edge}/section:${section}`, sourceSurfaceId: surface.id, x, y, yaw: -Math.atan2(dy, dx), length, width, low, high, cross });
      }
    }
  }
  return out;
}

/** Scene-owned recessed volumes use declared boundary or legacy lattice
 * composition. Neither is a support plane or changes authority bounds. */
export function arenaSubstrateVolume(field: ArenaField, scale: number, scene: PinballSceneGenome, bounds: ArenaBounds, bottom: number, material: (role: string) => number, moving = false): LookMesh {
  const vocabulary = scene.environment?.substrate;
  if (!vocabulary) return lookMesh({ boxes: [] });
  const planes = field.surfaces.flatMap(s => s.vertexElevations ?? [s.height]), lowest = planes.length ? Math.min(...planes) : 0;
  if (!Number.isFinite(lowest) || bottom + vocabulary.rise > lowest - 32 + .00001) throw new RangeError("Scene substrate would enter a native playable plane");
  if (vocabulary.layout === "boundary") {
    const boxes: NonNullable<BakeWorld["boxes"]>[number][] = [], capsules: NonNullable<BakeWorld["capsules"]>[number][] = [];
    for (const section of arenaSubstrateSections(field, scene)) {
      if (section.x < bounds[0] || section.x >= bounds[2] || section.y < bounds[1] || section.y >= bounds[3]) continue;
      const roll = createRoll(deriveSeed(scene.seed, `substrate:${section.id}`)), rise = Math.min(section.width, section.length, vocabulary.rise * (.88 + roll.index(0, 256) / 255 * .12)), co = Math.cos(section.yaw), si = Math.sin(section.yaw);
      const point = (p: readonly number[]) => [(section.x + co * p[0]! * section.length + si * p[2]! * section.width) * scale, (bottom + p[1]! * rise) * scale, (section.y - si * p[0]! * section.length + co * p[2]! * section.width) * scale];
      for (const part of vocabulary.parts) {
        if ((part.motion === "pulse") !== moving) continue;
        if (part.kind === "box") boxes.push({ c: point(part.a), h: [part.size[0] * section.length * scale, part.size[1] * rise * scale, part.size[2] * section.width * scale], yaw: section.yaw, mat: material(part.role) });
        else capsules.push({ a: point(part.a), b: point(part.kind === "ball" ? part.a : part.b), r: part.size[0] * Math.min(section.length, section.width, rise) * scale, mat: material(part.role) });
      }
    }
    return lookMesh({ boxes, capsules }, { around: 8, rings: 1 });
  }
  const margin = Math.max(scene.environment?.floor?.margin ?? 0, field.scene?.environment?.floor?.margin ?? 0, ...field.sceneRegions?.map(r => r.scene.environment?.floor?.margin ?? 0) ?? []);
  const [x0, y0, x1, y1] = field.bounds, width = x1 - x0 + margin * 2, depth = y1 - y0 + margin * 2;
  let columns = Math.max(1, Math.ceil(width / vocabulary.spacing)), rows = Math.max(1, Math.ceil(depth / vocabulary.spacing));
  if (columns * rows > 160) { const factor = Math.sqrt(columns * rows / 160); columns = Math.min(160, Math.max(1, Math.floor(columns / factor))); rows = Math.min(Math.floor(160 / columns), Math.max(1, Math.floor(rows / factor))); }
  const dx = width / columns, dy = depth / rows, fronts = pinballCatchFronts(field);
  const paths = field.pinball?.paths.flatMap(path => path.vertices.slice(1).map((b, i) => ({ id: `${path.id}/span:${i}`, a: path.vertices[i]!, b }))) ?? [];
  const boxes: NonNullable<BakeWorld["boxes"]>[number][] = [], capsules: NonNullable<BakeWorld["capsules"]>[number][] = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const x = x0 - margin + (column + .5) * dx, y = y0 - margin + (row + .5) * dy;
    if (x < bounds[0] || x >= bounds[2] || y < bounds[1] || y >= bounds[3]) continue;
    let nearest = { id: field.id, distance: Infinity, yaw: 0 };
    for (const bank of fronts) { const distance = Math.hypot(x - bank.x, y - bank.y); if (distance < nearest.distance) nearest = { id: bank.stationId, distance, yaw: -Math.atan2(bank.upY, bank.upX) }; }
    for (const span of paths) {
      const vx = span.b.x - span.a.x, vy = span.b.y - span.a.y, t = Math.max(0, Math.min(1, ((x - span.a.x) * vx + (y - span.a.y) * vy) / Math.max(.000001, vx * vx + vy * vy)));
      const distance = Math.hypot(x - span.a.x - vx * t, y - span.a.y - vy * t);
      if (distance < nearest.distance) nearest = { id: span.id, distance, yaw: -Math.atan2(vy, vx) };
    }
    const identity = `${field.id}/substrate:${column}.${row}/${nearest.id}`, roll = createRoll(deriveSeed(scene.seed, identity));
    const yaw = nearest.yaw + (roll.index(0, 256) / 255 - .5) * .12, co = Math.cos(yaw), si = Math.sin(yaw), rise = vocabulary.rise * (.82 + roll.index(1, 256) / 255 * .18);
    const span = Math.min(dx, dy), length = span * (.91 + roll.index(2, 256) / 255 * .09), cross = span * (.91 + roll.index(3, 256) / 255 * .09);
    const point = (p: readonly number[]) => [(x + co * p[0]! * length + si * p[2]! * cross) * scale, (bottom + p[1]! * rise) * scale, (y - si * p[0]! * length + co * p[2]! * cross) * scale];
    for (const part of vocabulary.parts) {
      if ((part.motion === "pulse") !== moving) continue;
      if (part.kind === "box") boxes.push({ c: point(part.a), h: [part.size[0] * length * scale, part.size[1] * rise * scale, part.size[2] * cross * scale], yaw, mat: material(part.role) });
      else capsules.push({ a: point(part.a), b: point(part.kind === "ball" ? part.a : part.b), r: part.size[0] * Math.min(length, cross, rise) * scale, mat: material(part.role) });
    }
  }
  return lookMesh({ boxes, capsules }, { around: 8, rings: 1 });
}
