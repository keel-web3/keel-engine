import { bodySpace, meshBounds, lookMesh, type LookMesh } from "@keel-engine/bake";
import { bakeForRenderer, placeObject, slotOf, type BuiltObject } from "@keel-engine/object";
import type { ArenaSurface, ArenaPoint, ArenaRamp, ArenaField, ArenaBounds } from "@keel-engine/pinball-arena";
import { FIELD_ROLES } from "@keel-engine/pinball-world-art";

const cross = (a: ArenaPoint, b: ArenaPoint, c: ArenaPoint): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const inTriangle = (p: ArenaPoint, a: ArenaPoint, b: ArenaPoint, c: ArenaPoint, direction: number): boolean => cross(a, b, p) * direction >= -1e-8 && cross(b, c, p) * direction >= -1e-8 && cross(c, a, p) * direction >= -1e-8;

/** Triangulates the generator's actual concave polygon; no rectangular replacement. */
export function triangulateArenaPolygon(points: readonly ArenaPoint[]): number[] {
  if (points.length < 3 || points.length > 512 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new RangeError("Arena surface polygon needs 3..512 finite points.");
  const area = points.reduce((a, p, i) => { const q = points[(i + 1) % points.length]!; return a + p.x * q.y - q.x * p.y; }, 0);
  if (Math.abs(area) < 1e-8) throw new RangeError("Arena surface polygon has zero area.");
  const direction = area > 0 ? 1 : -1, remaining = points.map((_, i) => i), out: number[] = [];
  while (remaining.length > 3) {
    let cut = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length]!, b = remaining[i]!, c = remaining[(i + 1) % remaining.length]!;
      if (cross(points[a]!, points[b]!, points[c]!) * direction <= 1e-8) continue;
      if (remaining.some(n => n !== a && n !== b && n !== c && inTriangle(points[n]!, points[a]!, points[b]!, points[c]!, direction))) continue;
      out.push(a, b, c); remaining.splice(i, 1); cut = true; break;
    }
    if (!cut) throw new RangeError("Arena surface polygon must be simple without repeated points.");
  }
  out.push(...remaining); return out;
}

/** World-owned surface vertices and elevation, with palette-role coordinates. */
export function arenaSurfaceMesh(surface: ArenaSurface, unitScale: number, sideMaterial?: keyof typeof FIELD_ROLES): LookMesh {
  const tris = triangulateArenaPolygon(surface.polygon);
  const heights = surface.vertexElevations ?? surface.polygon.map(() => surface.height);
  if (heights.length !== surface.polygon.length || heights.some(h => !Number.isFinite(h))) throw new RangeError("Arena surface heights must match its finite polygon vertices.");
  const positions = Float32Array.from(surface.polygon.flatMap((p, i) => [p.x * unitScale, heights[i]! * unitScale, p.y * unitScale]));
  const normals = new Float32Array(positions.length), attrs = new Float32Array(surface.polygon.length * 4);
  const role = surface.kind === "water" ? "water" : /ice|glacier/.test(surface.material) ? "ice" : /steel|metal|bridge/.test(surface.material) ? "steel" : /wood|root/.test(surface.material) ? "bark" : /stone|ruin/.test(surface.material) ? "stone" : "ground";
  for (let i = 0; i < surface.polygon.length; i++) {
    const p = surface.polygon[i]!; attrs.set([slotOf(FIELD_ROLES, role), (p.x * unitScale % 8) / 8, (p.y * unitScale % 8) / 8, 0], i * 4);
  }
  // KEEL's face winding, seen from above, is x/z clockwise.
  const indices = Uint32Array.from(tris);
  for (let i = 0; i < indices.length; i += 3) {
    const a = surface.polygon[indices[i]!]!, b = surface.polygon[indices[i + 1]!]!, c = surface.polygon[indices[i + 2]!]!;
    if (cross(a, b, c) > 0) { const t = indices[i + 1]!; indices[i + 1] = indices[i + 2]!; indices[i + 2] = t; }
    const ia = indices[i]! * 3, ib = indices[i + 1]! * 3, ic = indices[i + 2]! * 3;
    const ux = positions[ib]! - positions[ia]!, uy = positions[ib + 1]! - positions[ia + 1]!, uz = positions[ib + 2]! - positions[ia + 2]!;
    const vx = positions[ic]! - positions[ia]!, vy = positions[ic + 1]! - positions[ia + 1]!, vz = positions[ic + 2]! - positions[ia + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const vertex of [ia, ib, ic]) { normals[vertex] = normals[vertex]! + nx; normals[vertex + 1] = normals[vertex + 1]! + ny; normals[vertex + 2] = normals[vertex + 2]! + nz; }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (!(length > 0 && Number.isFinite(length))) throw new RangeError("Arena surface has a degenerate normal.");
    normals[i] = normals[i]! / length; normals[i + 1] = normals[i + 1]! / length; normals[i + 2] = normals[i + 2]! / length;
  }
  if (surface.kind === "water") return { positions, normals, attrs, bodies: bodySpace(positions, meshBounds(positions)), indices };
  // The descriptor's top stays exact. The visible bed/deck thickness below it
  // gives banks and raised crossings real side faces, depth and cast shadows.
  const thickness = surface.kind === "bridge" || surface.kind === "ramp" ? .24 : surface.kind === "platform" ? .7 : 1.35;
  const ps = Array.from(positions), ns = Array.from(normals), as = Array.from(attrs), ix = Array.from(indices);
  const area = surface.polygon.reduce((a, p, i) => { const q = surface.polygon[(i + 1) % surface.polygon.length]!; return a + p.x * q.y - q.x * p.y; }, 0), direction = area > 0 ? 1 : -1;
  for (let i = 0; i < surface.polygon.length; i++) {
    const a = surface.polygon[i]!, b = surface.polygon[(i + 1) % surface.polygon.length]!, dx = b.x - a.x, dz = b.y - a.y, len = Math.hypot(dx, dz), normal = [direction * dz / len, 0, -direction * dx / len];
    const offset = ps.length / 3, topA = heights[i]! * unitScale, topB = heights[(i + 1) % heights.length]! * unitScale;
    ps.push(a.x * unitScale, topA, a.y * unitScale, b.x * unitScale, topB, b.y * unitScale, b.x * unitScale, topB - thickness, b.y * unitScale, a.x * unitScale, topA - thickness, a.y * unitScale);
    const sideRole = sideMaterial ?? (surface.kind === "playfield" || /track|grate|wire/.test(surface.material) ? "steel" : role === "ground" ? "stone" : role);
    for (let v = 0; v < 4; v++) { ns.push(...normal); as.push(slotOf(FIELD_ROLES, sideRole), v < 2 ? v : 3 - v, v < 2 ? 1 : 0, 0); }
    if (direction > 0) ix.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    else ix.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
    if (surface.kind === "playfield") for (const depth of [.18, .94]) {
      const band = ps.length / 3;
      ps.push(a.x * unitScale, topA - depth, a.y * unitScale, b.x * unitScale, topB - depth, b.y * unitScale, b.x * unitScale, topB - depth - .065, b.y * unitScale, a.x * unitScale, topA - depth - .065, a.y * unitScale);
      for (let v = 0; v < 4; v++) { ns.push(...normal); as.push(slotOf(FIELD_ROLES, depth < .5 ? "trim" : "dark"), v < 2 ? v : 3 - v, v < 2 ? 1 : 0, 0); }
      if (direction > 0) ix.push(band, band + 1, band + 2, band, band + 2, band + 3); else ix.push(band, band + 2, band + 1, band, band + 3, band + 2);
    }
  }
  const expanded = Float32Array.from(ps);
  return { positions: expanded, normals: Float32Array.from(ns), attrs: Float32Array.from(as), bodies: bodySpace(expanded, meshBounds(expanded)), indices: Uint32Array.from(ix) };
}

/** A ramp's actual endpoints and elevation interpolation, in the same depth space. */
export function arenaRampMesh(ramp: ArenaRamp, unitScale: number): LookMesh {
  const dx = ramp.bx - ramp.ax, dz = ramp.by - ramp.ay, length = Math.hypot(dx, dz);
  if (!(length > 0 && ramp.width > 0)) throw new RangeError("Arena ramp needs positive length and width.");
  const nx = -dz / length * ramp.width * 0.5, nz = dx / length * ramp.width * 0.5;
  const positions = Float32Array.from([
    ramp.ax + nx, ramp.fromElevation, ramp.ay + nz,
    ramp.bx + nx, ramp.toElevation, ramp.by + nz,
    ramp.bx - nx, ramp.toElevation, ramp.by - nz,
    ramp.ax - nx, ramp.fromElevation, ramp.ay - nz,
  ].map(n => n * unitScale));
  const dy = ramp.toElevation - ramp.fromElevation, normalLength = Math.hypot(dy, length);
  const normal = [-dy * dx / length / normalLength, length / normalLength, -dy * dz / length / normalLength];
  const normals = Float32Array.from(Array.from({ length: 4 }, () => normal).flat());
  const attrs = Float32Array.from([slotOf(FIELD_ROLES, "steel"), 0, 0, 0, slotOf(FIELD_ROLES, "steel"), 0, 1, 0, slotOf(FIELD_ROLES, "steel"), 1, 1, 0, slotOf(FIELD_ROLES, "steel"), 1, 0, 0]);
  return { positions, normals, attrs, bodies: bodySpace(positions, meshBounds(positions)), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
}

/** A depth-tested annular lamp/footprint, measured in renderer metres. */
export function arenaIndicatorRing(radius: number, width: number, height: number, role = "core", segments = 32): LookMesh {
  if (!(radius > 0 && width > 0 && width < radius && Number.isFinite(height))) throw new RangeError("Arena lamp ring needs finite positive dimensions.");
  const ps: number[] = [], ns: number[] = [], attrs: number[] = [], indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = i / segments * Math.PI * 2;
    for (const r of [radius, radius - width]) { ps.push(Math.cos(angle) * r, height, Math.sin(angle) * r); ns.push(0, 1, 0); attrs.push(slotOf(FIELD_ROLES, role), i / segments, r === radius ? 1 : 0, 0); }
    const a = i * 2, b = (i + 1) % segments * 2;
    indices.push(a, b + 1, b, a, a + 1, b + 1);
  }
  const positions = Float32Array.from(ps);
  return { positions, normals: Float32Array.from(ns), attrs: Float32Array.from(attrs), bodies: bodySpace(positions, meshBounds(positions)), indices: Uint32Array.from(indices) };
}

export function builtArtWorld(built: BuiltObject) {
  const mats = Object.fromEntries(Object.keys(built.roles).map(role => [role, slotOf(built.roles, role)]));
  const world = bakeForRenderer([placeObject(built.def)], { mats });
  if (world.skipped.length) throw new Error(`World art ${built.id} has unrenderable parts.`);
  return world;
}

export function builtArtMesh(built: BuiltObject, far = false): LookMesh {
  return lookMesh(builtArtWorld(built), { around: far ? 6 : 10, rings: far ? 1 : 2, chordError: far ? 0.12 : 0.025 });
}

/** Exact static colliders, optionally partitioned by canonical spatial bounds. */
export function arenaPhysicalMesh(field: Pick<ArenaField, "bounds" | "rails" | "bumpers">, scale: number, bounds?: ArenaBounds): LookMesh {
  const capsules = [], boxes = [];
  const owns = (x: number, y: number): boolean => !bounds || (x >= bounds[0] && y >= bounds[1] && (x < bounds[2] || x === bounds[2] && bounds[2] === field.bounds[2]) && (y < bounds[3] || y === bounds[3] && bounds[3] === field.bounds[3]));
  for (const rail of field.rails) {
    if (!owns((rail.ax + rail.bx) * 0.5, (rail.ay + rail.by) * 0.5)) continue;
    const role = rail.material === "wood" ? "bark" : rail.material === "ice" ? "ice" : rail.material === "steel" ? "rail" : rail.material;
    capsules.push({ a: [rail.ax * scale, (rail.elevation + rail.radius) * scale, rail.ay * scale], b: [rail.bx * scale, ((rail.elevationB ?? rail.elevation) + rail.radius) * scale, rail.by * scale], r: rail.radius * scale, mat: slotOf(FIELD_ROLES, role) });
  }
  for (const b of field.bumpers) {
    if (!owns(b.x, b.y)) continue;
    const r = b.radius * scale, x = b.x * scale, z = b.y * scale, h = b.elevation * scale;
    // Collision footprint is exact; the sculpture rises within that footprint.
    if (b.kind === "crystal") {
      for (let i = 0; i < 3; i++) boxes.push({ c: [x + Math.cos(i * 2.1) * r * 0.30, h + r * (0.45 + i * 0.10), z + Math.sin(i * 2.1) * r * 0.30], h: [r * 0.24, r * (0.45 + i * 0.10), r * 0.24], yaw: i * 0.55, kind: "wedge" as const, lo: 0.02, mat: slotOf(FIELD_ROLES, "glass") });
    } else {
      capsules.push({ a: [x, h + r * 0.12, z], b: [x, h + r * 0.23, z], r: r * 0.85, mat: slotOf(FIELD_ROLES, b.kind === "fungus" ? "bark" : "steel") });
      capsules.push({ a: [x, h + r * 0.33, z], b: [x, h + r * 0.47, z], r: r * 0.50, mat: slotOf(FIELD_ROLES, b.kind === "fungus" ? "ground" : "core") });
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        boxes.push({ c: [x + Math.cos(a) * r * 0.74, h + r * 0.20, z + Math.sin(a) * r * 0.74], h: [r * 0.12, r * 0.15, r * 0.12], yaw: a, mat: slotOf(FIELD_ROLES, "trim") });
      }
    }
  }
  return lookMesh({ capsules, boxes }, { around: 8, rings: 1, chordError: 0.035 });
}
