import { bodySpace, lookMesh, meshBounds, poseMatrices, type BakeWorld, type LookMesh } from "@keel-engine/bake";
import { slotOf } from "@keel-engine/object";
import { FIELD_ROLES } from "@keel-engine/pinball-world-art";
import type { ArenaField, ArenaStation, ArenaSurface, ArenaPoint } from "@keel-engine/pinball-arena";
import { triangulateArenaPolygon } from "./geometry.ts";

type Point3 = readonly [number, number, number];
const slot = (role: string) => slotOf(FIELD_ROLES, role);

const READOUT_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  H: ["101", "101", "111", "101", "101"], O: ["111", "101", "101", "101", "111"], L: ["100", "100", "100", "100", "111"], D: ["110", "101", "101", "101", "110"],
  T: ["111", "010", "010", "010", "010"], R: ["110", "101", "110", "101", "101"], A: ["010", "101", "111", "101", "101"], N: ["101", "111", "111", "111", "101"], S: ["111", "100", "111", "001", "111"], I: ["111", "010", "010", "010", "111"],
  B: ["110", "101", "110", "101", "110"], C: ["111", "100", "100", "100", "111"], K: ["101", "101", "110", "101", "101"], E: ["111", "100", "110", "100", "111"], M: ["101", "111", "111", "101", "101"], U: ["101", "101", "101", "101", "111"],
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"], "2": ["110", "001", "010", "100", "111"], "3": ["110", "001", "010", "001", "110"], "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "110", "001", "110"], "6": ["011", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"], "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "110"], " ": ["000", "000", "000", "000", "000"],
};

/** A shallow readout fixed beside the admitted mouth. Letters are actual KEEL
 * mesh pixels on its case, not a detached DOM label or substitute ball. */
export function arenaCaptureReadoutMesh(label: string, location: string): LookMesh {
  if (!["HOLD", "TRANSIT", "BLOCKED"].includes(label) || location.length > 14 || [...location].some(c => !READOUT_GLYPHS[c])) throw new RangeError("Capture readout vocabulary");
  const boxes: NonNullable<BakeWorld["boxes"]>[number][] = [
    { c: [0, .032, 0], h: [2.65, .032, 1.10], mat: slot("steel") },
    { c: [0, .068, 0], h: [2.50, .018, 1.00], mat: slot("dark") },
  ];
  const text = (word: string, pitch: number, z: number): void => {
    const width = (word.length * 4 - 1) * pitch;
    for (let i = 0; i < word.length; i++) for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) if (READOUT_GLYPHS[word[i]!]![row]![col] === "1")
      boxes.push({ c: [-width * .5 + (i * 4 + col + .5) * pitch, .095, z - row * pitch], h: [pitch * .42, .012, pitch * .42], mat: slot("core") });
  };
  text(label, .18, .78); text(location, Math.min(.11, 4.55 / Math.max(1, location.length * 4 - 1)), -.35);
  return lookMesh({ boxes });
}

/** A compass arrow has one invariant footprint; only its bearing is posed.
 * +X points from the capture entry toward the authority-selected destination. */
export function arenaCaptureLocatorMesh(remote = false): LookMesh {
  return lookMesh({ boxes: remote ? [
    { c: [0, .07, 0], h: [.31, .025, .38], mat: slot("core") },
    { c: [0, .10, 0], h: [.18, .035, .27], mat: slot("dark") },
  ] : [
    { c: [-.14, .06, 0], h: [.40, .025, .07], mat: slot("core") },
    { c: [.35, .06, -.15], h: [.28, .025, .07], yaw: -.65, mat: slot("core") },
    { c: [.35, .06, .15], h: [.28, .025, .07], yaw: .65, mat: slot("core") },
  ] });
}

function patches(parts: readonly { points: readonly Point3[]; role: string }[]): LookMesh {
  const ps: number[] = [], ns: number[] = [], attrs: number[] = [], indices: number[] = [];
  for (const part of parts) {
    const base = ps.length / 3, triangles = triangulateArenaPolygon(part.points.map(p => ({ x: p[0], y: p[2] })));
    for (const p of part.points) { ps.push(...p); ns.push(0, 0, 0); attrs.push(slot(part.role), p[0] % 1, p[2] % 1, 0); }
    for (let i = 0; i < triangles.length; i += 3) {
      let a = triangles[i]!, b = triangles[i + 1]!, c = triangles[i + 2]!;
      const pa = part.points[a]!, pb = part.points[b]!, pc = part.points[c]!;
      const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
      indices.push(base + a, base + b, base + c);
      for (const vertex of [a, b, c]) { const offset = (base + vertex) * 3; ns[offset] = ns[offset]! + nx; ns[offset + 1] = ns[offset + 1]! + ny; ns[offset + 2] = ns[offset + 2]! + nz; }
    }
  }
  for (let i = 0; i < ns.length; i += 3) { const n = Math.hypot(ns[i]!, ns[i + 1]!, ns[i + 2]!); ns[i] = ns[i]! / n; ns[i + 1] = ns[i + 1]! / n; ns[i + 2] = ns[i + 2]! / n; }
  const positions = Float32Array.from(ps);
  return { positions, normals: Float32Array.from(ns), attrs: Float32Array.from(attrs), bodies: bodySpace(positions, meshBounds(positions)), indices: Uint32Array.from(indices) };
}

/** Mechanical deck edging and ribs remain inside the exact supported quad.
 * They are shallow engraved/inlaid geometry, never new ball guides or holes. */
export function arenaTrackDetailMesh(surface: ArenaSurface, scale: number, family: string, open = false): LookMesh {
  if (surface.polygon.length !== 4) return patches([]);
  const p = surface.polygon, h = surface.vertexElevations ?? p.map(() => surface.height);
  const at = (u: number, v: number, lift = .022): Point3 => {
    const w = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
    return [p.reduce((n, point, i) => n + point.x * w[i]!, 0) * scale, h.reduce((n, z, i) => n + z * w[i]!, 0) * scale + lift, p.reduce((n, point, i) => n + point.y * w[i]!, 0) * scale];
  };
  const parts: { points: Point3[]; role: string }[] = [];
  for (const v of [0.035, .905]) parts.push({ points: [at(0, v), at(1, v), at(1, v + .06), at(0, v + .06)], role: open || family === "return" ? "steel" : "core" });
  const length = Math.hypot((p[1]!.x + p[2]!.x - p[0]!.x - p[3]!.x) * .5, (p[1]!.y + p[2]!.y - p[0]!.y - p[3]!.y) * .5);
  // Wireforms expose the place below them. Crossbars are narrower than the
  // admitted body and spaced below its diameter; the support plane stays real.
  const count = open ? Math.max(1, Math.min(40, Math.ceil(length / 18))) : Math.max(1, Math.min(4, Math.floor(length / 80)));
  for (let i = 0; i < count; i++) {
    const u = (i + .5) / count, du = Math.min(.045, (open ? 1 : 2) / Math.max(1, length));
    parts.push({ points: [at(u - du, open ? .035 : .18), at(u + du, open ? .035 : .18), at(u + du, open ? .965 : .82), at(u - du, open ? .965 : .82)], role: open ? "steel" : surface.layer > 0 || surface.kind === "ramp" ? "dark" : "steel" });
    if (open && i % 4 !== 0) continue;
    for (const v of [.13, .87]) parts.push({ points: [at(u - du * 1.8, v - .025, .035), at(u + du * 1.8, v - .025, .035), at(u + du * 1.8, v + .025, .035), at(u - du * 1.8, v + .025, .035)], role: "trim" });
  }
  return patches(parts);
}

/** A coaster's running rails and slim under-slung ties follow the exact
 * supported quad. Canonical outside collision guides are drawn separately;
 * no narrower fake corridor replaces them. Ramps/catches retain solid beds. */
export function arenaCoasterTrackMesh(surface: ArenaSurface, scale: number): LookMesh {
  if (surface.polygon.length !== 4) return arenaWireApronMesh(surface, scale);
  const p = surface.polygon, heights = surface.vertexElevations ?? p.map(() => surface.height), capsules: NonNullable<BakeWorld["capsules"]>[number][] = [];
  const at = (u: number, v: number, lift: number): Point3 => { const weights = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v]; return [p.reduce((n, q, i) => n + q.x * weights[i]!, 0) * scale, heights.reduce((n, h, i) => n + h * weights[i]!, 0) * scale + lift, p.reduce((n, q, i) => n + q.y * weights[i]!, 0) * scale]; };
  for (const v of [.28, .72]) capsules.push({ a: at(0, v, -.055), b: at(1, v, -.055), r: .055, mat: slot("steel") });
  capsules.push({ a: at(0, .5, -.20), b: at(1, .5, -.20), r: .07, mat: slot("dark") });
  const length = Math.hypot((p[1]!.x + p[2]!.x - p[0]!.x - p[3]!.x) * .5, (p[1]!.y + p[2]!.y - p[0]!.y - p[3]!.y) * .5), count = Math.max(1, Math.min(16, Math.ceil(length / 42)));
  for (let i = 0; i < count; i++) {
    const u = (i + .5) / count, a = at(u, 0, -.13), b = at(u, 1, -.13), width = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const inset = Math.max(.035, Math.min(.45, .036 / Math.max(.08, width)));
    capsules.push({ a: at(u, inset, -.13), b: at(u, 1 - inset, -.13), r: .035, mat: slot("rail") });
  }
  return lookMesh({ capsules }, { around: 6, rings: 1 });
}

/** Open native endpoint landings retain the declared convex support polygon.
 * Narrow clipped crossbars and perimeter bands do not cover the place below. */
export function arenaWireApronMesh(surface: ArenaSurface, scale: number): LookMesh {
  const polygon = surface.polygon;
  if (polygon.length < 3 || polygon.length > 32) return patches([]);
  const heights = surface.vertexElevations ?? polygon.map(() => surface.height);
  const a = polygon[0]!, b = polygon[1]!, c = polygon[2]!;
  const den = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(den) < 1e-8) return patches([]);
  const zx = ((heights[1]! - heights[0]!) * (c.y - a.y) - (heights[2]! - heights[0]!) * (b.y - a.y)) / den;
  const zy = ((b.x - a.x) * (heights[2]! - heights[0]!) - (c.x - a.x) * (heights[1]! - heights[0]!)) / den;
  const at = (p: ArenaPoint): Point3 => [p.x * scale, (heights[0]! + (p.x - a.x) * zx + (p.y - a.y) * zy) * scale + .022, p.y * scale];
  const center = polygon.reduce((sum, p) => ({ x: sum.x + p.x / polygon.length, y: sum.y + p.y / polygon.length }), { x: 0, y: 0 });
  const inset = (p: ArenaPoint): ArenaPoint => { const d = Math.hypot(p.x - center.x, p.y - center.y), f = Math.max(0, 1 - 2 / Math.max(2, d)); return { x: center.x + (p.x - center.x) * f, y: center.y + (p.y - center.y) * f }; };
  const parts: { points: Point3[]; role: string }[] = [];
  for (let i = 0; i < polygon.length; i++) { const p = polygon[i]!, next = polygon[(i + 1) % polygon.length]!; parts.push({ points: [p, next, inset(next), inset(p)].map(at), role: "steel" }); }
  const clip = (input: readonly ArenaPoint[], boundary: number, above: boolean): ArenaPoint[] => {
    const out: ArenaPoint[] = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!, next = input[(i + 1) % input.length]!, pin = above ? p.y >= boundary : p.y <= boundary, nin = above ? next.y >= boundary : next.y <= boundary;
      if (pin) out.push(p);
      if (pin !== nin) { const t = (boundary - p.y) / (next.y - p.y); out.push({ x: p.x + (next.x - p.x) * t, y: boundary }); }
    }
    return out;
  };
  const low = Math.min(...polygon.map(p => p.y)), high = Math.max(...polygon.map(p => p.y)), count = Math.max(1, Math.min(40, Math.ceil((high - low) / 18)));
  for (let i = 0; i < count; i++) { const y = low + (i + .5) / count * (high - low), points = clip(clip(polygon, y - 1, true), y + 1, false); if (points.length >= 3) parts.push({ points: points.map(at), role: "steel" }); }
  return patches(parts);
}

function guideChain(field: ArenaField, start: ArenaPoint, layer: number, elevation: number): ArenaPoint[] {
  const out = [start], seen = new Set<string>(); let point = start;
  for (let i = 0; i < 8; i++) {
    const choices = field.rails.filter(r => r.kind === "guide" && r.layer === layer && r.elevation === elevation && (r.elevationB ?? r.elevation) === elevation && !seen.has(r.id) && (Math.hypot(r.ax - point.x, r.ay - point.y) < .01 || Math.hypot(r.bx - point.x, r.by - point.y) < .01));
    if (choices.length !== 1) break;
    const rail = choices[0]!; seen.add(rail.id);
    point = Math.hypot(rail.ax - point.x, rail.ay - point.y) < .01 ? { x: rail.bx, y: rail.by } : { x: rail.ax, y: rail.ay };
    out.push(point);
  }
  return out;
}

/** Narrow catch edging follows connected native guides and paired pivots.
 * The actual native bed and its authored central panels remain uncovered. */
export function arenaCatchPlateMesh(field: ArenaField, bank: ArenaStation, scale: number): LookMesh | null {
  const left = field.flippers.find(f => bank.flipperIds.includes(f.id) && f.side === "left"), right = field.flippers.find(f => bank.flipperIds.includes(f.id) && f.side === "right");
  if (!left || !right) return null;
  if (left.layer !== bank.layer || right.layer !== bank.layer || left.elevation !== bank.elevation || right.elevation !== bank.elevation) return null;
  const l = guideChain(field, { x: left.pivotX, y: left.pivotY }, bank.layer, bank.elevation), r = guideChain(field, { x: right.pivotX, y: right.pivotY }, bank.layer, bank.elevation);
  if (l.length < 2 || r.length < 2) return null;
  const outline = [...l.reverse(), ...r], parts: { points: Point3[]; role: string }[] = [];
  // Native surfaces already provide the receiving fan. Only perimeter bands
  // belong to this mechanical overlay; a second full center plate would sit
  // above authored matte panels and erase the actual bed's material hierarchy.
  const at = (p: { readonly x: number; readonly y: number }, factor: number, lift: number): Point3 => [(bank.x + (p.x - bank.x) * factor) * scale, bank.elevation * scale + lift, (bank.y + (p.y - bank.y) * factor) * scale];
  for (const [outer, inner, lift, role] of [[.94, .90, .012, "steel"], [.90, .84, .010, "dark"]] as const) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]!, b = outline[(i + 1) % outline.length]!;
      parts.push({ points: [at(a, outer, lift), at(b, outer, lift), at(b, inner, lift), at(a, inner, lift)], role });
    }
  }
  return patches(parts);
}

/** A spring/plunger is mounted behind a declared shooter port. The geometry
 * has a bounded footprint; its pose follows the admitted captured/launch state. */
export function arenaShooterMesh(width: number): LookMesh {
  return lookMesh(arenaShooterRig(width), { around: 6, rings: 1 });
}

/** Housing parts remain fixed; only the head, rod and coils form a posed rig. */
export function arenaShooterRig(width: number): BakeWorld {
  const half = width * .38, boxes = [
    { c: [-.57, .11, 0], h: [.12, .11, half], mat: slot("steel") },
    { c: [-.35, .04, 0], h: [.33, .025, half], mat: slot("dark") },
    { c: [-.38, .12, -half], h: [.3, .07, .055], mat: slot("trim") },
    { c: [-.38, .12, half], h: [.3, .07, .055], mat: slot("trim") },
    { c: [-.15, .15, 0], h: [.055, .13, width * .22], mat: slot("steel") },
  ];
  const capsules = [{ a: [-.59, .12, 0], b: [-.14, .12, 0], r: .045, mat: slot("steel") }];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 8, b = (i + 1) / 28 * Math.PI * 8;
    capsules.push({ a: [-.56 + i / 28 * .36, .14 + Math.cos(a) * .07, Math.sin(a) * .07], b: [-.56 + (i + 1) / 28 * .36, .14 + Math.cos(b) * .07, Math.sin(b) * .07], r: .022, mat: slot("trim") });
  }
  return { boxes, capsules };
}

export function arenaShooterPose(width: number, recoil: number): Float32Array {
  const rest = arenaShooterRig(width), travel = Math.max(0, Math.min(1, Number.isFinite(recoil) ? recoil : 0)) * .18;
  const boxes = rest.boxes!.map((b, i) => i === 4 ? { ...b, c: [b.c[0]! - travel, b.c[1]!, b.c[2]!] } : b);
  const compression = 1 - travel / .36;
  const capsules = rest.capsules!.map((c, i) => i === 0 ? { ...c, b: [c.b[0]! - travel, c.b[1]!, c.b[2]!] } : { ...c,
    a: [-.56 + (c.a[0]! + .56) * compression, c.a[1]!, c.a[2]!],
    b: [-.56 + (c.b[0]! + .56) * compression, c.b[1]!, c.b[2]!],
  });
  return poseMatrices(rest, { boxes, capsules });
}
