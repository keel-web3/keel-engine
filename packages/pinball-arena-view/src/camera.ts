import { projectionOf } from "@keel-engine/bake";
import type { ArenaBallFrame, ArenaField, ArenaStation } from "@keel-engine/pinball-arena";

export interface ArenaAimPoint { readonly x: number; readonly y: number; readonly elevation: number }
export interface ArenaAimContext { readonly id: string; readonly points: readonly ArenaAimPoint[]; readonly priority: number }

/** Add real nearby shot-mouth context only while the real body and bank retain
 * their readable scale. A distant destination never makes an active catch a
 * miniature overview. The caller can render excluded native routes normally. */
export function fitArenaLocalAim(essential: readonly ArenaAimPoint[], contexts: readonly ArenaAimContext[], scale: number, width: number, height: number, pitch: number, yaw: number, elevation: number, minimumK: number) {
  const points=[...essential],included:string[]=[],excluded:string[]=[];
  for(const context of [...contexts].sort((a,b)=>a.priority-b.priority || a.id.localeCompare(b.id))) {
    const next=[...points,...context.points],fit=fitArenaAim(next,scale,width,height,pitch,yaw,elevation);
    if(fit.k>=minimumK){points.push(...context.points);included.push(context.id);}else excluded.push(context.id);
  }
  const fit=fitArenaAim(points,scale,width,height,pitch,yaw,elevation);
  return {...fit,k:Math.max(minimumK,fit.k),points,included,excluded};
}

/** The pair supplies the horizontal axis; its actual local drain selects
 * which side of that axis is down-table. Native side labels alone are
 * insufficient because physical compilers can rotate or mirror a catch.
 * Input adapters map visible sides without changing canonical blade labels. */
export function arenaCatchYaw(field: ArenaField, bank: ArenaStation | undefined): number {
  const blades = bank && field.flippers.filter(f => bank.flipperIds.includes(f.id));
  const left = blades?.find(f => f.side === "left"), right = blades?.find(f => f.side === "right");
  if (!left || !right || !bank) return 0;
  const pairYaw = -Math.atan2(right.pivotY - left.pivotY, right.pivotX - left.pivotX), x = (left.pivotX + right.pivotX) * .5, y = (left.pivotY + right.pivotY) * .5;
  const drains = field.hazards?.filter(h => h.kind === "drain" && h.layer === bank.layer && Math.abs(h.elevation - bank.elevation) <= Math.max(left.radius, right.radius) * 2) ?? [];
  const local = drains.find(h => h.id === `${bank.id}.drain`) ?? drains.filter(h => Math.hypot(h.x - x, h.y - y) <= Math.max(left.length, right.length) * 5).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  if (!local) return pairYaw + Math.PI;
  const along = Math.sin(pairYaw) * (local.x - x) + Math.cos(pairYaw) * (local.y - y);
  return along < -1e-6 ? pairYaw : pairYaw + Math.PI;
}

/** Show an arrival before the next stroke, rather than fitting a distant bank
 * throughout a long descent. At120 Hz this is a300 ms speed-based horizon. */
export function arenaReceiverLookahead(body: ArenaBallFrame): number {
  return Math.max(350, Math.min(650, Math.hypot(body.vx, body.vy) * 36));
}

/** Outbound mouths matter at a real controlling pair, not while another tier
 * passes over the same XY. An inactive served body keeps prelaunch orientation. */
export function arenaCatchAimAvailable(field: ArenaField, body: ArenaBallFrame, station: ArenaStation): boolean {
  if (body.stationId !== station.id) return false;
  if (body.rampId !== null || body.layer !== station.layer || Math.abs(body.elevation - station.elevation) > body.radius * 2) return false;
  return field.flippers.some(f => station.flipperIds.includes(f.id) && Math.hypot(body.x - f.pivotX, body.y - f.pivotY) <= Math.max(300, f.length * 3));
}

/** A nearby return is an impending landing, even beyond the radial bank cut.
 * Layer/height and ramp identity keep crossing ground bodies on their own view. */
export function arenaReturnReceiver(field: ArenaField, body: ArenaBallFrame, maximumRemaining = 1000) {
  let best: { id: string; distance: number } | undefined;
  for (const path of field.pinball?.paths ?? []) {
    if (!path.receiverCatchId) continue;
    const start = path.returnStartVertex ?? (path.role === "inlane" ? 0 : path.vertices.length - 2);
    const activeRamp = body.rampId !== null && field.surfaces.some(s => s.rampId === body.rampId && path.surfaceIds.includes(s.id));
    for (let i = Math.max(0, start); i < path.vertices.length - 1; i++) {
      const a = path.vertices[i]!, b = path.vertices[i + 1]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!(length > 0)) continue;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > 1 && (body.vx * dx + body.vy * dy) / (speed * length) < -.15) continue;
      const t = Math.max(0, Math.min(1, ((body.x - a.x) * dx + (body.y - a.y) * dy) / (length * length)));
      const z = a.elevation + (b.elevation - a.elevation) * t;
      if (a.elevation !== b.elevation ? !activeRamp || Math.abs(z - body.elevation) > 2 : body.layer !== a.layer || body.layer !== b.layer || Math.abs(z - body.elevation) > 2) continue;
      const width = (path.clearWidths?.[i] ?? path.clearWidth) * (1 - t) + (path.clearWidths?.[i + 1] ?? path.clearWidth) * t;
      const sideways = Math.hypot(body.x - a.x - dx * t, body.y - a.y - dy * t);
      if (sideways > width * .5 + body.radius * 2) continue;
      let remaining = length * (1 - t);
      for (let j = i + 1; j < path.vertices.length - 1; j++) { const p = path.vertices[j]!, q = path.vertices[j + 1]!; remaining += Math.hypot(q.x - p.x, q.y - p.y); }
      if (remaining > maximumRemaining || best && sideways >= best.distance) continue;
      best = { id: path.receiverCatchId, distance: sideways };
    }
  }
  return best && field.stations.find(s => s.id === best.id);
}

/** Fit canonical catch/shot-mouth points into the aiming region. Coordinates
 * remain physical; KEEL's own projection supplies the ground-plane basis. */
export function fitArenaAim(points: readonly ArenaAimPoint[], scale: number, width: number, height: number, pitch: number, yaw: number, elevation: number) {
  if (!points.length) throw new RangeError("Arena aiming fit needs a point.");
  const cx = (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) * scale * .5;
  const cy = (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) * scale * .5;
  const center = [cx, elevation * scale, cy] as const;
  const probe = projectionOf({ kind: "ortho", center, yaw, pitch, k: 1 }, width, height, 400);
  const projected = points.map(p => probe.project([p.x * scale, p.elevation * scale, p.y * scale]));
  const x0 = Math.min(...projected.map(p => p[0])), x1 = Math.max(...projected.map(p => p[0]));
  const y0 = Math.min(...projected.map(p => p[1])), y1 = Math.max(...projected.map(p => p[1]));
  const k = Math.min(width * .82 / Math.max(12, x1 - x0 + 3), height * .63 / Math.max(12, y1 - y0 + 3));
  const origin = probe.project(center), xAxis = probe.project([cx + 1, center[1], cy]), yAxis = probe.project([cx, center[1], cy + 1]);
  const a = xAxis[0] - origin[0], b = yAxis[0] - origin[0], c = xAxis[1] - origin[1], d = yAxis[1] - origin[1], det = a * d - b * c;
  if (Math.abs(det) < 1e-6) return { x: cx / scale, y: cy / scale, k };
  // The usable aiming region is 11.5..74.5% vertically. Solve a camera ground
  // translation so its projected bounds center at43%, including raised mouths.
  const dx = (x0 + x1) * .5 - width * .5, dy = (y0 + y1) * .5 - height * .5 + height * .07 / k;
  return { x: (cx + (dx * d - b * dy) / det) / scale, y: (cy + (a * dy - dx * c) / det) / scale, k };
}
