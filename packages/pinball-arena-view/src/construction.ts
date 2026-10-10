import { lookMesh, type LookMesh, type BakeWorld } from "@keel-engine/bake";
import type { ArenaField, ArenaSurface, ArenaArtInstance, ArenaSceneStructure } from "@keel-engine/pinball-arena";
import { pinballEnvironmentClear, pinballCatchFronts, pinballCatchFrontClear, type PinballSceneGenome } from "@keel-engine/pinball-world-art";
import { slotOf } from "@keel-engine/object";
import { ARENA_STRUCTURE_ROLES, arenaFoundationHeight } from "./structural-art.ts";
import { createRoll, deriveSeed } from "@keel-engine/core/rng";

type Part = ArenaSceneStructure["hubs"][number];
type Geometry = { boxes: NonNullable<BakeWorld["boxes"]>[number][]; capsules: NonNullable<BakeWorld["capsules"]>[number][] };
const empty = (): Geometry => ({ boxes: [], capsules: [] });
const role = (scene: PinballSceneGenome, value: string): number => {
  if (!(value in ARENA_STRUCTURE_ROLES) || !scene.material.tones[value]) throw new RangeError(`Unbound construction material: ${value}`);
  return slotOf(ARENA_STRUCTURE_ROLES, value);
};
function section(out: Geometry, scene: PinballSceneGenome, parts: readonly Part[], identity: string, center: readonly [number, number], bottom: number, length: number, height: number, width: number, yaw: number, moving: boolean, scale: number): void {
  const co = Math.cos(yaw), si = Math.sin(yaw), point = (p: readonly number[]) => [(center[0] + co * p[0]! * length + si * p[2]! * width) * scale, (bottom + p[1]! * height) * scale, (center[1] - si * p[0]! * length + co * p[2]! * width) * scale];
  for (const [index, part] of parts.entries()) {
    if ((part.motion === "pulse") !== moving) continue;
    const roll = createRoll(deriveSeed(scene.seed, `construction:${identity}:part:${index}`)), girth = .90 + roll.index(0, 256) / 255 * .10;
    // The declared envelope stays conservative. Continuous section length and
    // exact foundation/object heights stay fixed; only inward girth varies.
    if (part.kind === "box") out.boxes.push({ c: point(part.a), h: [part.size[0] * length * scale, part.size[1] * height * scale, part.size[2] * width * scale * girth], yaw, mat: role(scene, part.role) });
    else out.capsules.push({ a: point(part.a), b: point(part.kind === "ball" ? part.a : part.b), r: part.size[0] * width * scale * girth, mat: role(scene, part.role) });
  }
}

/** Complete horizontal envelope of one normalized construction section.
 * It includes capsule radii and every box extent, independent of its height. */
function footprint(parts: readonly Part[], length: number, width: number): readonly [number, number, number] {
  let low = 0, high = 0, cross = 0;
  for (const p of parts) { const rx = p.kind === "box" ? p.size[0] * length : p.size[0] * width, rz = p.kind === "box" ? p.size[2] * width : p.size[0] * width;
    low = Math.min(low, Math.min(p.a[0], p.b[0]) * length - rx); high = Math.max(high, Math.max(p.a[0], p.b[0]) * length + rx); cross = Math.max(cross, Math.max(Math.abs(p.a[2]), Math.abs(p.b[2])) * width + rz);
  }
  return [low, high, cross];
}

/** Connected authored sections occupy only safe exterior boundary intervals.
 * Sampling discs cover the entire declared rectangle, including between
 * samples; gaps at real ports/other decks remain actual architectural openings. */
export function arenaChamberBoundary(field: ArenaField, surface: ArenaSurface, scale: number, scene: PinballSceneGenome, moving = false): LookMesh {
  const boundary = scene.environment?.construction?.boundary, out = empty(); if (!boundary) return lookMesh(out);
  const p = surface.polygon, heights = surface.vertexElevations ?? p.map(() => surface.height), winding = Math.sign(p.reduce((n, a, i) => { const b = p[(i + 1) % p.length]!; return n + a.x * b.y - b.x * a.y; }, 0)) || 1;
  const catchFronts = pinballCatchFronts(field);
  let admitted = 0;
  for (let edge = 0; edge < p.length && admitted < 48; edge++) {
    const a = p[edge]!, b = p[(edge + 1) % p.length]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); if (length < 80) continue;
    const count = Math.min(12, Math.max(1, Math.ceil(length / boundary.spacing))), span = length / count, [low, high, radius] = footprint(boundary.parts, span, boundary.width), nx = winding * dy / length, ny = -winding * dx / length;
    const stepCount = Math.max(1, Math.ceil((high - low) / 80)), coverage = radius + (high - low) / stepCount * .5, outward = coverage + boundary.offset + 28;
    for (let i = 0; i < count && admitted < 48; i++) {
      const t = (i + .5) / count, center = [a.x + dx * t + nx * outward, a.y + dy * t + ny * outward] as const;
      const edgeHeight = heights[edge]! + (heights[(edge + 1) % p.length]! - heights[edge]!) * t;
      if (!pinballCatchFrontClear(catchFronts, { x: center[0], y: center[1] }, Math.hypot(Math.max(-low, high), radius), surface.layer, edgeHeight, edgeHeight + boundary.rise)) continue;
      let clear = true;
      for (let j = 0; j <= stepCount; j++) { const along = low + (high - low) * j / stepCount;
        if (!pinballEnvironmentClear(field, { x: center[0] + dx / length * along, y: center[1] + dy / length * along }, coverage, 24)) { clear = false; break; }
      }
      if (!clear) continue; admitted++;
      const bottom = scene.environment?.floor ? arenaFoundationHeight(field, scene) : edgeHeight - boundary.drop;
      section(out, scene, boundary.parts, `${surface.id}/edge:${edge}/section:${i}`, center, bottom, span, edgeHeight + boundary.rise - bottom, boundary.width, -Math.atan2(dy, dx), moving, scale);
    }
  }
  return lookMesh(out, { around: 8, rings: 1 });
}

/** A semantic support reaches the exact scenery object's base from its own
 * chamber/foundation. It never raises the object or invents a physical deck. */
export function arenaEnvironmentMount(field: ArenaField, item: ArenaArtInstance, layer: number, scale: number, scene: PinballSceneGenome, moving = false): LookMesh {
  const mount = scene.environment?.construction?.mounts.find(m => m.assetId === item.assetId), out = empty(); if (!mount) return lookMesh(out);
  const candidates = field.surfaces.filter(s => s.layer === layer), anchor = item.anchorSurfaceId ? candidates.find(s => s.id === item.anchorSurfaceId) : candidates.reduce<ArenaSurface | undefined>((a, b) => !a || nativeEdgeAt(b, item.x, item.y).distance < nativeEdgeAt(a, item.x, item.y).distance ? b : a, undefined);
  if (!anchor) throw new RangeError("Scenery mounting surface absent from its native layer");
  const bottom = mount.from === "foundation" ? arenaFoundationHeight(field, scene) : nativeEdgeAt(anchor, item.x, item.y).height, height = item.z - bottom;
  if (height <= 4) return lookMesh(out);
  const [low, high, radius] = footprint(mount.parts, mount.width, mount.width), bound = Math.hypot(Math.max(-low, high), radius);
  if (!pinballEnvironmentClear(field, item, bound, 16)) return lookMesh(out);
  section(out, scene, mount.parts, `${item.id}/mount`, [item.x, item.y], bottom, mount.width, height, mount.width, item.yaw, moving, scale);
  return lookMesh(out, { around: 8, rings: 1 });
}

/** Sparse supports are tied to path segment identity and the actual native
 * under-deck height. Safe feet stay outside every playable footprint; a
 * diagonal brace reaches the real spine, rather than lifting the track. */
export function arenaTrackFoundation(field: ArenaField, surface: ArenaSurface, pathSegment: number, scale: number, scene: PinballSceneGenome): LookMesh {
  const vocabulary = scene.environment?.construction?.mounts[0], out = empty(); if (!vocabulary || surface.polygon.length !== 4 || pathSegment < 0 || pathSegment % 6 !== 0) return lookMesh(out);
  const p = surface.polygon, heights = surface.vertexElevations ?? p.map(() => surface.height), height = heights.reduce((n, h) => n + h, 0) / heights.length;
  if (height < 64) return lookMesh(out);
  const center = p.reduce<[number, number]>((a, q) => [a[0] + q.x / 4, a[1] + q.y / 4], [0, 0]), dx = (p[1]!.x + p[2]!.x - p[0]!.x - p[3]!.x) * .5, dy = (p[1]!.y + p[2]!.y - p[0]!.y - p[3]!.y) * .5, length = Math.hypot(dx, dy); if (length < 1) return lookMesh(out);
  const corridor = Math.max(Math.hypot(p[3]!.x - p[0]!.x, p[3]!.y - p[0]!.y), Math.hypot(p[2]!.x - p[1]!.x, p[2]!.y - p[1]!.y)), width = Math.min(48, vocabulary.width), [low, high, radius] = footprint(vocabulary.parts, width, width), bound = Math.hypot(Math.max(-low, high), radius), nx = -dy / length, ny = dx / length;
  const bottom = scene.environment?.floor ? arenaFoundationHeight(field, scene) : Math.min(...field.surfaces.map(s => s.height)) - 160, top = height - 12;
  for (const side of [-1, 1]) { const offset = corridor * .5 + bound + 32, foot = [center[0]! + nx * offset * side, center[1]! + ny * offset * side] as const;
    if (!pinballEnvironmentClear(field, { x: foot[0], y: foot[1] }, bound, 24)) continue;
    section(out, scene, vocabulary.parts, `${surface.id}/support:${pathSegment}/side:${side}`, foot, bottom, width, top - bottom, width, -Math.atan2(dy, dx), false, scale);
    const material = vocabulary.parts.find(p => p.motion === "static")!.role;
    out.capsules.push({ a: [foot[0] * scale, (top - Math.min(80, Math.max(0, top - 32))) * scale, foot[1] * scale], b: [center[0]! * scale, top * scale, center[1]! * scale], r: 3 * scale, mat: role(scene, material) });
    break;
  }
  return lookMesh(out, { around: 8, rings: 1 });
}

/** Scenery lies outside the bed, so its anchor height is interpolated at the
 * nearest actual source edge, rather than extrapolated into empty space. */
function nativeEdgeAt(surface: ArenaSurface, x: number, y: number): { distance: number; height: number } {
  const p = surface.polygon, heights = surface.vertexElevations ?? p.map(() => surface.height); let result = { distance: Infinity, height: surface.height };
  for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!, dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(.000001, dx * dx + dy * dy))), distance = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    if (distance < result.distance) result = { distance, height: heights[i]! + (heights[(i + 1) % p.length]! - heights[i]!) * t };
  }
  return result;
}
