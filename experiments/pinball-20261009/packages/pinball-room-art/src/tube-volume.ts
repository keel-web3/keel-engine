import { PixelCanvas } from '@keel-engine/pinball-pixel-art';
import { dcos, dhypot, dsin } from '@keel-engine/core';
import type { ArenaField, ArenaFrame, ArenaWorldDefinition } from '@keel-engine/pinball-arena';
import type { RoomArtTheme, RoomProjection } from './index.ts';
import { createTubeMaterialSampler, type TubeMaterialSampler } from './tube-material.ts';

type Point = { x: number; y: number; elevation: number };
type Ring = Point & { layer: number; sourceSpan:number; nx: number; ny: number; along: number };
type Vertex = Point & { along: number; side: number; light: number };
type Triangle = { vertices: readonly [Vertex, Vertex, Vertex]; floor: boolean; opening: boolean; rim: boolean; lining: boolean; collar: boolean; underside: boolean; light: number; nx: number; ny: number; nz: number };
type ScreenVertex = Vertex & { sx: number; sy: number; depth: number };
type Cut = { id: string; sx: number; sy: number; radius: number; depth: number; tx: number; ty: number; alongRadius: number; acrossRadius: number; extentX: number; extentY: number; longitudinal: boolean };
export type NativeTubeVolumePlan = Readonly<{
  worldSha256: string; arenaId: string; pathId: string; theme: RoomArtTheme;
  scope: 'cosmetic-circular-sleeve-on-native-support';
  minimumBallRadius: number; maximumBallRadius: number;
  boreRadius: number; axisHeight: number;
  heightConvention: 'sphere-on-plane';
}>;
type Prepared = { rings: Ring[]; spanLayers:readonly (readonly number[])[]; half: number; clearHalf: number; collars: number; triangles: Triangle[]; length: number; material: TubeMaterialSampler };
const plans = new WeakMap<NativeTubeVolumePlan, Prepared>();
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6;
function dense<T>(a: readonly T[], max: number, empty = false) {
  if (!Array.isArray(a) || (!empty && !a.length) || a.length > max) throw Error('Tube volume array budget');
  for (let i = 0; i < a.length; i++) if (!Object.hasOwn(a, i)) throw Error('Tube volume sparse array');
}
function supported(poly: readonly Point[], x: number, y: number) {
  let odd = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!, b = poly[i]!, dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
    const t = d2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / d2)) : 0;
    if (dhypot(x - a.x - t * dx, y - a.y - t * dy) <= 1 / 1024) return true;
    if ((a.y > y) !== (b.y > y) && x < a.x + dx * (y - a.y) / dy) odd = !odd;
  }
  return odd;
}

/** A circular cosmetic sleeve around the registered native path plane.
 * The native floor/rails remain authoritative;
 * this is neither a new path nor a physical ceiling. Width comes from clearWidth. */
export function prepareNativeTubeVolume(world: ArenaWorldDefinition, field: ArenaField, pathId: string, theme: RoomArtTheme,
  profile: { minimumBallRadius: number; maximumBallRadius: number }): NativeTubeVolumePlan {
  if (!world.arenas.includes(field) || !['ion-relay', 'grove', 'vaporwave'].includes(theme)) throw Error('Tube volume member/theme');
  const path = field.pinball?.paths.find(v => v.id === pathId);
  if (!path || !finite(path.clearWidth) || path.clearWidth < 8 || path.clearWidth > 256) throw Error('Tube volume native path');
  dense(path.vertices, 128); dense(path.surfaceIds, 256);
  if (path.vertices.length < 2) throw Error('Tube volume path length');
  if (path.clearWidths !== undefined) {
    dense(path.clearWidths, 128);
    if (path.clearWidths.length !== path.vertices.length || path.clearWidths.some(v => v !== path.clearWidth)) throw Error('Tube volume variable width requires a separate profile');
  }
  const source = path.vertices.map(v => {
    if (!v || ![v.x, v.y, v.elevation].every(finite) || !Number.isSafeInteger(v.layer)) throw Error('Tube volume native vertex');
    return { x: v.x, y: v.y, elevation: v.elevation, layer: v.layer };
  });
  const supports = path.surfaceIds.map(id => {
    const s = field.surfaces.find(v => v.id === id);
    if (!s) throw Error('Tube volume support member');
    dense(s.polygon, 32);
    if (s.polygon.length < 3) throw Error('Tube volume support polygon');
    return s.polygon.map((v, i) => {
      const elevation = s.vertexElevations?.[i] ?? s.height;
      if (!v || ![v.x, v.y, elevation].every(finite)) throw Error('Tube volume support coordinate');
      return { x: v.x, y: v.y, elevation };
    });
  });
  if (!profile || Array.isArray(profile)) throw Error('Tube volume explicit radius profile');
  const clearHalf = path.clearWidth / 2, { minimumBallRadius: minimum, maximumBallRadius: maximum } = profile;
  if (!finite(minimum) || !finite(maximum) || minimum <= 0 || minimum > maximum || maximum > clearHalf) throw Error('Tube volume explicit radius profile');
  // A flat native floor cuts a chord through the bore. A bottom-tangent circle
  // would squeeze legal lateral ball positions. Enclose both radius endpoints;
  // the required radius is convex in body radius, so intermediate sizes fit.
  const delta = maximum - minimum, a = clearHalf - minimum,
    axisHeight = delta === 0 ? minimum : minimum + delta * (a - delta / 4) / (2 * a - delta),
    half = clearHalf + axisHeight - (minimum + maximum) / 2,
    required = (radius: number) => dhypot(clearHalf - radius, radius - axisHeight) + radius;
  if (![axisHeight, half].every(finite) || required(minimum) > half + 1 / 1024 || required(maximum) > half + 1 / 1024) throw Error('Tube volume radius envelope');
  const thickness = Math.min(3, half * .12), outerHalf = half + thickness;
  const spans = source.slice(1).map((b, i) => {
    const a = source[i]!, d = dhypot(b.x - a.x, b.y - a.y);
    if (d <= 0 || d > 32768) throw Error('Tube volume degenerate span');
    const ramp=a.layer===b.layer?undefined:field.ramps.find(r=>
      r.ax===a.x&&r.ay===a.y&&r.bx===b.x&&r.by===b.y&&r.fromElevation===a.elevation&&r.toElevation===b.elevation&&r.fromLayer===a.layer&&r.toLayer===b.layer||
      r.bidirectional&&r.bx===a.x&&r.by===a.y&&r.ax===b.x&&r.ay===b.y&&r.toElevation===a.elevation&&r.fromElevation===b.elevation&&r.toLayer===a.layer&&r.fromLayer===b.layer);
    if(a.layer!==b.layer&&!ramp)throw Error('Tube volume layer transition lacks native ramp');
    return { a, b, d, sourceSpan:i, layers:ramp?[ramp.fromLayer,ramp.toLayer]:[a.layer], nx: -(b.y - a.y) / d, ny: (b.x - a.x) / d };
  });
  // Reject oversized sampled paths before constructing their cross sections.
  const prospectiveRings = 1 + spans.reduce((sum, s) => sum + Math.ceil(s.d / 32), 0),
    prospectiveLength = spans.reduce((sum, s) => sum + s.d, 0);
  if (prospectiveRings > 224 || prospectiveLength > 65536) throw Error('Tube volume mesh budget');
  const sides = 16, collarRadius = outerHalf + Math.min(1.5, thickness * .6),
    floorTriangles = supports.reduce((sum, p) => sum + p.length - 2, 0);
  const collars: { before: Ring; after: Ring }[] = [];
  const phase = parseInt(world.sha256.slice(0, 8), 16);
  if (!Number.isFinite(phase)) throw Error('Tube volume world identity');
  for (let j = 1; j <= 6; j++) {
    const wanted = prospectiveLength * j / 7 + phase % 13 - 6; let start = 0;
    for (const s of spans) {
      const local = wanted - start;
      if (local >= 10 && local <= s.d - 10) {
        const at = (delta: number): Ring => {
          const t = (local + delta) / s.d;
          return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t,
            elevation: s.a.elevation + (s.b.elevation - s.a.elevation) * t, layer: s.a.layer,
            sourceSpan:s.sourceSpan,nx: s.nx, ny: s.ny, along: wanted + delta };
        };
        collars.push({ before: at(-2), after: at(2) }); break;
      }
      start += s.d;
    }
  }
  if ((prospectiveRings - 1) * sides * 4 + sides * 8 + collars.length * sides * 6 + floorTriangles > 8192) throw Error('Tube volume complete mesh budget');
  const rings: Ring[] = []; let along = 0;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!, steps = Math.ceil(s.d / 32);
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      let nx = s.nx, ny = s.ny;
      if (j === 0 && i > 0) {
        const prior = spans[i - 1]!, dot = prior.nx * nx + prior.ny * ny;
        if (dot < -.5) throw Error('Tube volume sharp reversal requires a separate connector');
        const n = dhypot(prior.nx + nx, prior.ny + ny);
        nx = (prior.nx + nx) / n; ny = (prior.ny + ny) / n;
      }
      rings.push({ x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t,
        elevation: s.a.elevation + (s.b.elevation - s.a.elevation) * t, layer: s.a.layer,sourceSpan:s.sourceSpan, nx, ny, along: along + s.d * t });
    }
    along += s.d;
  }
  const last = spans.at(-1)!;
  rings.push({ ...last.b,sourceSpan:last.sourceSpan, nx: last.nx, ny: last.ny, along });
  if (rings.length > 224 || along > 65536) throw Error('Tube volume mesh budget');
  // Both sides of each sampled section must remain over declared native support.
  // The raised hood is permitted beyond its *screen* footprint, not its XY route.
  let supportWork = 0;
  const admitSupport = (x: number, y: number) => supports.some(p => {
    supportWork += p.length;
    if (supportWork > 1048576) throw Error('Tube volume support inspection budget');
    return supported(p, x, y);
  });
  for (const r of rings) for (const side of [-1, 0, 1]) {
    if (!admitSupport(r.x + r.nx * outerHalf * side, r.y + r.ny * outerHalf * side)) throw Error('Tube volume unsupported exterior section');
  }
  const section = (r: Ring, radius: number) => {
    const make = (side: number, rise: number): Vertex => {
      return { x: r.x + r.nx * outerHalf * side, y: r.y + r.ny * outerHalf * side,
        elevation: r.elevation + axisHeight + rise, along: r.along, side, light: 0 };
    };
    const vertices: Vertex[] = [];
    for (let j = 0; j < sides; j++) {
      const angle = j * Math.PI * 2 / sides, c = dcos(angle), s = dsin(angle);
      vertices.push(make(c * radius / outerHalf, radius * s));
    }
    return vertices;
  };
  const cross = rings.map(r => section(r, outerHalf));
  const innerCross = rings.map(r => section(r, half));
  for (const ring of cross) for (const v of ring) if (!admitSupport(v.x, v.y)) throw Error('Tube volume unsupported exterior vertex');
  const triangles: Triangle[] = [];
  for (const polygon of supports) {
    const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      on = (a: Point, b: Point, c: Point) => Math.abs(turn(a, b, c)) <= 1e-9 &&
        c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
      if (a.x === b.x && a.y === b.y) throw Error('Tube volume zero floor edge');
      for (let j = i + 1; j < polygon.length; j++) {
        if (j === i + 1 || i === 0 && j === polygon.length - 1) continue;
        const c = polygon[j]!, d = polygon[(j + 1) % polygon.length]!,
          abC = turn(a, b, c), abD = turn(a, b, d), cdA = turn(c, d, a), cdB = turn(c, d, b);
        if (Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)) throw Error('Tube volume non-simple floor');
      }
    }
    let winding = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, c = polygon[(i + 2) % polygon.length]!,
        cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) <= 1e-9) continue;
      const sign = Math.sign(cross);
      if (winding && sign !== winding) throw Error('Tube volume concave floor needs explicit triangulation');
      winding = sign;
    }
    if (!winding) throw Error('Tube volume degenerate floor');
    const vertices = polygon.map(v => ({ ...v, along: 0, side: 0, light: 0 }));
    for (let i = 2; i < vertices.length; i++) triangles.push({ vertices: [vertices[0]!, vertices[i - 1]!, vertices[i]!],
      floor: true, opening: false, rim: false, lining: false, collar: false, underside: false, light: 0, nx: 0, ny: 0, nz: 1 });
  }
  const add = (a: Vertex, b: Vertex, c: Vertex, opening = false, rim = false, lining = false, collar = false) => {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.elevation - a.elevation,
      vx = c.x - a.x, vy = c.y - a.y, vz = c.elevation - a.elevation;
    // Ring/path winding is inward, so reverse its exact 3D face normal.
    // Both parametric tangents contribute; projecting an initial normal off
    // only the path tangent is not perpendicular to a sloped vault surface.
    const nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux,
      n = dhypot(dhypot(nx, ny), nz), raw = n > 0 ? Math.max(0, Math.min(1, (-.45 * nx - .55 * ny + .70 * nz) / n)) : 0,
      light = Math.round(raw * 4096) / 4096;
    triangles.push({ vertices: [a, b, c], floor: false, opening, rim, lining, collar, underside: n > 0 && nz / n < -.2, light,
      nx: n > 0 ? nx / n : 0, ny: n > 0 ? ny / n : 0, nz: n > 0 ? nz / n : 0 });
  };
  for (let i = 1; i < cross.length; i++) for (let j = 0; j < cross[i]!.length; j++) {
    const next = (j + 1) % cross[i]!.length,
      a = cross[i - 1]![j]!, b = cross[i]![j]!, c = cross[i]![next]!, d = cross[i - 1]![next]!;
    add(a, b, c); add(a, c, d);
    const ia = innerCross[i - 1]![j]!, ib = innerCross[i]![j]!, ic = innerCross[i]![next]!, id = innerCross[i - 1]![next]!;
    add(ia, ic, ib, true, false, true); add(ia, id, ic, true, false, true);
  }
  for (const { before, after } of collars) {
    const baseA = section(before, outerHalf), baseB = section(after, outerHalf), edgeA = section(before, collarRadius), edgeB = section(after, collarRadius);
    for (const ring of [edgeA, edgeB]) for (const v of ring) if (!admitSupport(v.x, v.y)) throw Error('Tube volume unsupported collar exterior');
    for (let j = 0; j < sides; j++) {
      const next = (j + 1) % sides;
      add(edgeA[j]!, edgeB[j]!, edgeB[next]!, false, false, false, true);
      add(edgeA[j]!, edgeB[next]!, edgeA[next]!, false, false, false, true);
      add(baseA[j]!, edgeA[j]!, edgeA[next]!, false, true, false, true);
      add(baseA[j]!, edgeA[next]!, baseA[next]!, false, true, false, true);
      add(baseB[j]!, edgeB[next]!, edgeB[j]!, false, true, false, true);
      add(baseB[j]!, baseB[next]!, edgeB[next]!, false, true, false, true);
    }
  }
  // Aperture planes sit inside the outer section. Depth testing selects the
  // visible entrance; a rear aperture cannot blacken a nearer wall or bend.
  for (const i of [0, cross.length - 1]) {
    const r = rings[i]!, neighbour = rings[i === 0 ? 1 : rings.length - 2]!, d = dhypot(neighbour.x - r.x, neighbour.y - r.y),
      inset = Math.min(half * .3, d * .25), outer = cross[i]!, inner = section(r, half),
      throatRing = { ...r, x: r.x + (neighbour.x - r.x) * inset / d, y: r.y + (neighbour.y - r.y) * inset / d,
        elevation: r.elevation + (neighbour.elevation - r.elevation) * inset / d }, throat = section(throatRing, half);
    for (let j = 0; j < outer.length; j++) {
      const next = (j + 1) % outer.length;
      const start = i === 0, mouth = (a: Vertex, b: Vertex, c: Vertex, opening: boolean, rim: boolean) =>
        add(a, start ? c : b, start ? b : c, opening, rim);
      // The two mouths face in opposite directions. Cavity walls face into
      // the hole; their winding differs from the outward recessed fan.
      mouth(outer[j]!, inner[j]!, inner[next]!, false, true);
      mouth(outer[j]!, inner[next]!, outer[next]!, false, true);
      mouth(inner[j]!, throat[j]!, throat[next]!, true, false);
      mouth(inner[j]!, throat[next]!, inner[next]!, true, false);
      // A hollow mouth has no opaque fan closing the bore. Its native deck
      // and the inward-facing continuous lining remain visible beyond the lip.
    }
  }
  if (triangles.length > 8192) throw Error('Tube volume triangle budget');
  const plan = Object.freeze({ worldSha256: world.sha256, arenaId: field.id, pathId, theme, scope: 'cosmetic-circular-sleeve-on-native-support' as const,
    minimumBallRadius: minimum, maximumBallRadius: maximum, boreRadius: half, axisHeight, heightConvention: 'sphere-on-plane' as const });
  plans.set(plan, { rings,spanLayers:spans.map(s=>s.layers), half, clearHalf, collars: collars.length, triangles, length: along, material: createTubeMaterialSampler(theme, world.sha256 + '/' + pathId) });
  return plan;
}

/** Use the SAME camera sample as the court. This indexed mesh has a local depth
 * buffer; the host still draws real active balls last. No transport pose is made. */
export function paintNativeTubeVolume(p: PixelCanvas, plan: NativeTubeVolumePlan, project: RoomProjection,
  options: { scale: number; elevationScale: number; frame?: ArenaFrame; ownerId?: number }) {
  const data = plans.get(plan), { scale, elevationScale } = options;
  if (!data || p.W > 2048 || p.H > 2048 || p.W * p.H > 1048576 || p.palette.length < 32 || p.offsetX !== 0 || p.offsetY !== 0 ||
    !finite(scale) || scale <= 0 || scale > 4 || !finite(elevationScale) || elevationScale <= 0 || elevationScale > 4 ||
    options.ownerId !== undefined && (!Number.isSafeInteger(options.ownerId) || options.ownerId < 0)) throw Error('Tube volume canvas/camera');
  const checked = (v: Point) => {
    const q = project(v.x, v.y, v.elevation);
    if (!Array.isArray(q) || q.length !== 2 || ![0, 1].every(i => Object.hasOwn(q, i) && finite(q[i]))) throw Error('Tube volume projection');
    return q as readonly [number, number];
  };
  const origin = data.rings[0]!, o = checked(origin), x = checked({ ...origin, x: origin.x + 256 }),
    y = checked({ ...origin, y: origin.y + 256 }), z = checked({ ...origin, elevation: origin.elevation + 256 });
  // Admit our canonical orthographic projection, including integer rounding.
  // Guessing a perspective/depth metric from an arbitrary callback is unsafe.
  if (Math.abs(x[0] - o[0] - scale * 256) > 2 || Math.abs(x[1] - o[1]) > 1 ||
    Math.abs(y[0] - o[0]) > 1 || Math.abs(y[1] - o[1] + scale * 256) > 2 ||
    Math.abs(z[0] - o[0]) > 1 || Math.abs(z[1] - o[1] + elevationScale * 256) > 2) throw Error('Tube volume incompatible camera');
  const canonical = (v: Point) => {
    const q = checked(v), expectedX = o[0] + (v.x - origin.x) * scale,
      expectedY = o[1] - (v.y - origin.y) * scale - (v.elevation - origin.elevation) * elevationScale;
    if (Math.abs(q[0] - expectedX) > 2 || Math.abs(q[1] - expectedY) > 2) throw Error('Tube volume non-affine camera');
    return q;
  };
  const ratio = elevationScale / scale, cuts: Cut[] = [];
  if (!Number.isFinite(ratio) || ratio > 16) throw Error('Tube volume camera depth ratio');
  const depthOf = (v: Point) => {
    const depth = v.elevation - v.y * ratio;
    if (!Number.isFinite(depth)) throw Error('Tube volume camera depth');
    return depth;
  };
  if (options.frame) {
    dense(options.frame.balls, 128, true);
    for (const b of options.frame.balls) {
      if (!b || ![b.x, b.y, b.elevation, b.radius].every(finite) || b.radius <= 0 || b.radius > 256 ||
        !Number.isSafeInteger(b.layer) || !Number.isSafeInteger(b.ownerId) || typeof b.active !== 'boolean' || typeof b.eliminated !== 'boolean') throw Error('Tube volume native body');
      if (!b.active || b.eliminated || b.transport !== null || b.arenaId !== plan.arenaId ||
        options.ownerId !== undefined && options.ownerId !== b.ownerId) continue;
      if (typeof b.id !== 'string' || !b.id.length || b.id.length > 256) throw Error('Tube volume native body identity');
      if (b.radius < plan.minimumBallRadius || b.radius > plan.maximumBallRadius) throw Error('Tube volume body outside explicit radius profile');
      const visual = { ...b, elevation: b.elevation + b.radius }, q = canonical(visual);
      let nearest: { a: Ring; b: Ring; distance: number; height: number } | undefined;
      for (let i = 1; i < data.rings.length; i++) {
        const a = data.rings[i - 1]!, end = data.rings[i]!, dx = end.x - a.x, dy = end.y - a.y, d2 = dx * dx + dy * dy,
          t = d2 ? Math.max(0, Math.min(1, ((b.x - a.x) * dx + (b.y - a.y) * dy) / d2)) : 0,
          distance = dhypot(b.x - a.x - t * dx, b.y - a.y - t * dy), height = a.elevation + (end.elevation - a.elevation) * t;
        if (data.spanLayers[a.sourceSpan]!.includes(b.layer)&&distance + b.radius <= data.clearHalf + 1 / 1024 && Math.abs(height - b.elevation) <= 1 / 1024 &&
          (!nearest || distance < nearest.distance)) nearest = { a, b: end, distance, height };
      }
      let tx = 1, ty = 0;
      const longitudinal = !!nearest;
      if (longitudinal && nearest) {
        const a = canonical({ ...nearest.a, elevation: nearest.a.elevation + b.radius }), end = canonical({ ...nearest.b, elevation: nearest.b.elevation + b.radius }),
          length = dhypot(end[0] - a[0], end[1] - a[1]);
        if (length > 0) { tx = (end[0] - a[0]) / length; ty = (end[1] - a[1]) / length; }
      }
      const radius = b.radius * scale * 1.65, alongRadius = longitudinal ? b.radius * scale * 3 : radius,
        acrossRadius = longitudinal ? b.radius * scale * 1.35 : radius;
      // Select visibility by camera rays through the *actual* actor silhouette.
      // A raised roof's native XY/profile centre is not its intersection with
      // those rays. This also handles a real actor passing below another layer.
      cuts.push({ id: b.id, sx: q[0], sy: q[1], radius, depth: depthOf(visual), tx, ty, alongRadius, acrossRadius,
        extentX: Math.abs(tx) * alongRadius + Math.abs(ty) * acrossRadius,
        extentY: Math.abs(ty) * alongRadius + Math.abs(tx) * acrossRadius, longitudinal });
    }
  }
  const clip = p.clip;
  if (clip !== null) {
    dense(clip, 4);
    if (clip.length !== 4 || !clip.every(finite) || clip[0] > clip[2] || clip[1] > clip[3]) throw Error('Tube volume clip');
  }
  const viewLength = dhypot(ratio, 1), lightLength = dhypot(dhypot(.45, .55), .70),
    hx = -.45 / lightLength, hy = -.55 / lightLength - ratio / viewLength, hz = .70 / lightLength + 1 / viewLength,
    halfLength = dhypot(dhypot(hx, hy), hz), vertexCache = new Map<Vertex, ScreenVertex>();
  const projected = data.triangles.map(t => {
    const facing = Math.round((t.nz - t.ny * ratio) / viewLength * 4096) / 4096,
      specular = Math.round(Math.min(1, Math.max(0, (t.nx * hx + t.ny * hy + t.nz * hz) / halfLength)) * 4096) / 4096;
    return { ...t, facing, specular, vertices: t.vertices.map(v => {
      let screen = vertexCache.get(v);
      if (!screen) { const q = canonical(v); screen = { ...v, sx: q[0], sy: q[1], depth: depthOf(v) }; vertexCache.set(v, screen); }
      return screen;
    }) as [ScreenVertex, ScreenVertex, ScreenVertex] };
  });
  let work = 0, visibilityWork = 0;
  const mesh = projected.map(t => {
    if (!t.floor && t.facing <= 0) return { ...t, minX: 0, maxX: -1, minY: 0, maxY: -1, cuts: [] as Cut[] };
    const minX = Math.max(0, clip ? Math.ceil(clip[0]) : 0, Math.floor(Math.min(...t.vertices.map(v => v.sx)))),
      maxX = Math.min(p.W - 1, clip ? Math.floor(clip[2]) : p.W - 1, Math.ceil(Math.max(...t.vertices.map(v => v.sx)))),
      minY = Math.max(0, clip ? Math.ceil(clip[1]) : 0, Math.floor(Math.min(...t.vertices.map(v => v.sy)))),
      maxY = Math.min(p.H - 1, clip ? Math.floor(clip[3]) : p.H - 1, Math.ceil(Math.max(...t.vertices.map(v => v.sy))));
    const area = Math.max(0, maxX - minX + 1) * Math.max(0, maxY - minY + 1), maxDepth = Math.max(...t.vertices.map(v => v.depth)),
      visibleCuts = t.floor || t.opening ? [] : cuts.filter(c => maxDepth > c.depth && c.sx + c.extentX >= minX && c.sx - c.extentX <= maxX && c.sy + c.extentY >= minY && c.sy - c.extentY <= maxY);
    work += area; visibilityWork += area * visibleCuts.length;
    return { ...t, minX, maxX, minY, maxY, cuts: visibleCuts };
  });
  if (work > 8388608 || visibilityWork > 8388608) throw Error('Tube volume raster/visibility budget');
  // Every projection and bound has been checked before allocating the stage.
  const stage = new Uint8Array(p.pixels.length); stage.fill(255);
  const depth = new Float64Array(stage.length); depth.fill(-Infinity);
  let cutawayPixels = 0; const revealed = new Set<string>();
  for (const t of mesh) {
    const [a, b, c] = t.vertices, area = (b.sy - c.sy) * (a.sx - c.sx) + (c.sx - b.sx) * (a.sy - c.sy);
    if (Math.abs(area) < 1e-6) continue;
    for (let py = t.minY; py <= t.maxY; py++) for (let px = t.minX; px <= t.maxX; px++) {
      const sx = px + .5, sy = py + .5, u = ((b.sy - c.sy) * (sx - c.sx) + (c.sx - b.sx) * (sy - c.sy)) / area,
        v = ((c.sy - a.sy) * (sx - c.sx) + (a.sx - c.sx) * (sy - c.sy)) / area, w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-8) continue;
      const at = py * p.W + px, z = a.depth * u + b.depth * v + c.depth * w;
      if (z < depth[at]!) continue;
      // Seed the local depth with the EXISTING native deck. Lower tube skin
      // cannot paint over an opaque supported floor lying closer to the view.
      // This writes no new floor pixels and creates no rolling-floor collision.
      if (t.floor) { depth[at] = z; continue; }
      const along = a.along * u + b.along * v + c.along * w,
        side = Math.max(-1, Math.min(1, a.side * u + b.side * v + c.side * w)), light = t.light;
      let ink = data.material.sample(light, side, along, t.lining ? 'lining' : t.collar ? 'collar' : t.opening ? 'throat' : t.rim ? 'rim' : t.underside ? 'underside' : 'shell', Math.max(0, Math.min(1, t.facing)), t.specular);
      if (!t.opening) {
        let reveal = false;
        for (const cut of t.cuts) {
          if (z <= cut.depth) continue;
          const dx = sx - cut.sx, dy = sy - cut.sy, alongCut = (dx * cut.tx + dy * cut.ty) / cut.alongRadius,
            across = (-dx * cut.ty + dy * cut.tx) / cut.acrossRadius, ellipse = alongCut * alongCut + across * across;
          if (ellipse < 1) {
            // The border is clipped to the actual curved hood, while its
            // centre follows the projected ball rather than floating above it.
            if (ellipse > .80) ink = data.material.sample(across < 0 ? Math.min(1, light + .12) : light * .65, side, along, 'rim', Math.max(0, Math.min(1, t.facing)), t.specular);
            else { reveal = true; cutawayPixels++; revealed.add(cut.id); }
            break;
          }
        }
        // A real mask leaves the native deck/other previously painted material
        // untouched. Painting a dark fragment at roof depth would be a liner,
        // not an opening, and would still hide the floor under the current ball.
        if (reveal) continue;
      }
      depth[at] = z; stage[at] = ink;
    }
  }
  let pixels = 0;
  for (let i = 0; i < stage.length; i++) if (stage[i] !== 255) { p.pixels[i] = stage[i]!; pixels++; }
  return { pathId: plan.pathId, pixels, cutawayPixels, activeBodyCutaways: revealed.size, visibilityCandidates: cuts.length, triangles: mesh.length,
    longitudinalWindows: cuts.filter(c => c.longitudinal).length, collars: data.collars, projectedVertices: vertexCache.size,
    rasterWork: work, visibilityWork, nativeSupportUnchanged: true, ceilingCollisionAdded: false, actorPoseUnchanged: true,
    existingDeckDepthPreserved: true,
    heightConvention: plan.heightConvention, boreRadius: plan.boreRadius, axisHeight: plan.axisHeight,
    visibilityRule: 'actual-body-projection-and-camera-depth' as const, projection: 'canonical-orthographic' as const };
}
