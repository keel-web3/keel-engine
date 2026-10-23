import { meshBounds, type LookMesh, type Projection } from "@keel-engine/bake";

type Vertex = { p: number[]; n: number[]; a: number[]; b: number[]; screen: readonly number[] };
/** Local geometry cut, never a ghosted whole scene. Only triangles in front
 * of the actual depth-tested body's projected aperture are removed. The rest
 * of the structure retains its original opacity and spatial position. */
export function arenaBodyCutaway(mesh: LookMesh, projection: Projection, body: readonly number[], radiusPixels: number, offset: readonly [number, number] = [0, 0]): LookMesh | null {
  const minX = body[0]! - radiusPixels, maxX = body[0]! + radiusPixels, minY = body[1]! - radiusPixels, maxY = body[1]! + radiusPixels;
  if (!mesh.positions.length) return null;
  const bounds = meshBounds(mesh.positions), corners = [bounds[0], bounds[3]].flatMap(x => [bounds[1], bounds[4]].flatMap(y => [bounds[2], bounds[5]].map(z => projection.project([x! + offset[0], y!, z! + offset[1]]))));
  if (corners.every(p => p[0] < minX) || corners.every(p => p[0] > maxX) || corners.every(p => p[1] < minY) || corners.every(p => p[1] > maxY) || corners.every(p => p[2] >= body[2]!)) return null;
  const vertex = (index: number): Vertex => { const p = Array.from(mesh.positions.slice(index * 3, index * 3 + 3)); return { p, n: Array.from(mesh.normals.slice(index * 3, index * 3 + 3)), a: Array.from(mesh.attrs.slice(index * 4, index * 4 + 4)), b: Array.from(mesh.bodies.slice(index * 3, index * 3 + 3)), screen: projection.project([p[0]! + offset[0], p[1]!, p[2]! + offset[1]]) }; };
  const clip = (input: readonly Vertex[], axis: number, boundary: number, above: boolean): Vertex[] => {
    const out: Vertex[] = [], inside = (v: Vertex) => above ? v.screen[axis]! >= boundary : v.screen[axis]! <= boundary;
    for (let i = 0; i < input.length; i++) { const a = input[i]!, b = input[(i + 1) % input.length]!, aa = inside(a), bb = inside(b); if (aa) out.push(a);
      if (aa !== bb) { const t = (boundary - a.screen[axis]!) / (b.screen[axis]! - a.screen[axis]!), mix = (x: readonly number[], y: readonly number[]) => x.map((n, j) => n + (y[j]! - n) * t); out.push({ p: mix(a.p, b.p), n: mix(a.n, b.n), a: mix(a.a, b.a), b: mix(a.b, b.b), screen: mix(a.screen, b.screen) }); }
    } return out;
  };
  const ps: number[] = [], ns: number[] = [], attrs: number[] = [], bodies: number[] = [], indices: number[] = [];
  const append = (polygon: readonly Vertex[]) => { if (polygon.length < 3) return; const base = ps.length / 3;
    for (const v of polygon) { ps.push(...v.p); const length = Math.hypot(...v.n) || 1; ns.push(...v.n.map(n => n / length)); attrs.push(...v.a); bodies.push(...v.b); }
    for (let i = 1; i + 1 < polygon.length; i++) indices.push(base, base + i, base + i + 1);
  };
  let cut = false;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const triangle = [vertex(mesh.indices[i]!), vertex(mesh.indices[i + 1]!), vertex(mesh.indices[i + 2]!)];
    if (triangle.every(v => v.screen[0]! < minX) || triangle.every(v => v.screen[0]! > maxX) || triangle.every(v => v.screen[1]! < minY) || triangle.every(v => v.screen[1]! > maxY) || triangle.every(v => v.screen[2]! >= body[2]!)) { append(triangle); continue; }
    const back = clip(triangle, 2, body[2]!, true); append(back);
    let remaining = clip(triangle, 2, body[2]!, false);
    for (const [axis, boundary, outsideAbove] of [[0, minX, false], [0, maxX, true], [1, minY, false], [1, maxY, true]] as const) { append(clip(remaining, axis, boundary, outsideAbove)); remaining = clip(remaining, axis, boundary, !outsideAbove); }
    if (remaining.length >= 3) cut = true;
  }
  if (!cut) return null;
  const positions = Float32Array.from(ps);
  return { positions, normals: Float32Array.from(ns), attrs: Float32Array.from(attrs), indices: Uint32Array.from(indices), bodies: Float32Array.from(bodies) };
}

/** Pose and transform the exact scenery vertices before cutting. The returned
 * mesh is already in world space, so no pose is applied twice by the renderer. */
export function arenaTransformedBodyCutaway(mesh: LookMesh, projection: Projection, body: readonly number[], radius: number, matrix: ArrayLike<number>, parts?: Float32Array): LookMesh | null {
  const transform = (m: ArrayLike<number>, p: readonly number[], normal = false, start = 0): number[] => [0, 1, 2].map(row => m[start + row]! * p[0]! + m[start + 4 + row]! * p[1]! + m[start + 8 + row]! * p[2]! + (normal ? 0 : m[start + 12 + row]!));
  const bounds = meshBounds(mesh.positions), localCorners = [bounds[0]!, bounds[3]!].flatMap(x => [bounds[1]!, bounds[4]!].flatMap(y => [bounds[2]!, bounds[5]!].map(z => [x, y, z])));
  // Every part can rotate or scale as well as translate. Applying all poses to
  // the original envelope is conservative even when only one group owns it.
  const posedCorners = parts ? localCorners.flatMap(p => [p, ...Array.from({ length: parts.length / 16 }, (_, i) => transform(parts, p, false, i * 16))]) : localCorners;
  const corners = posedCorners.map(p => projection.project(transform(matrix, p) as [number, number, number]));
  if (corners.every(p => p[0] < body[0]! - radius) || corners.every(p => p[0] > body[0]! + radius) || corners.every(p => p[1] < body[1]! - radius) || corners.every(p => p[1] > body[1]! + radius) || corners.every(p => p[2] >= body[2]!)) return null;
  const positions = new Float32Array(mesh.positions.length), normals = new Float32Array(mesh.normals.length);
  for (let i = 0; i < mesh.positions.length / 3; i++) {
    let p = Array.from(mesh.positions.slice(i * 3, i * 3 + 3)), n = Array.from(mesh.normals.slice(i * 3, i * 3 + 3)); const index = Math.round(mesh.attrs[i * 4 + 3]!);
    if (parts && index >= 0 && index * 16 + 15 < parts.length) { p = transform(parts, p, false, index * 16); n = transform(parts, n, true, index * 16); }
    positions.set(transform(matrix, p), i * 3); n = transform(matrix, n, true); const length = Math.hypot(...n) || 1; normals.set(n.map(v => v / length), i * 3);
  }
  return arenaBodyCutaway({ ...mesh, positions, normals }, projection, body, radius);
}
