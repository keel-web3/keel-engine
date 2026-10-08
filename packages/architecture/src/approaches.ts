import type { City, CityHeight, Lot } from "@keel-engine/city";
import { datan2, dcos, dsin } from "@keel-engine/core";
import { locate, pointAt } from "@keel-engine/road";
import { frameOf, mainFront } from "./frame.ts";
import { SLOT } from "./slots.ts";
import type { BuildingPlan, BuildingApproach, GarageSurface, Solid } from "./types.ts";

/** Join every garage/lot entrance to its own frontage, retaining a smooth supported apron across the sidewalk. */
export function withApproaches(plan: BuildingPlan, city: City, lot: Lot, height?: CityHeight): BuildingPlan {
  const frame = frameOf(lot),
    fx = dsin(frame.yaw),
    fz = dcos(frame.yaw);
  const fallback = ["car_dealership", "big_box", "gas_station"].includes(plan.archetype)
    ? [
        {
          key: `${plan.key}:frontcourt`,
          route: [[frame.x + fx * frame.hd * 0.7, frame.z + fz * frame.hd * 0.7] as const],
        },
      ]
    : [];
  const entrances = plan.parking?.length ? plan.parking : fallback;
  if (!entrances.length) return plan;
  const edge = city.graph.edges[mainFront(lot)?.edge ?? lot.frontage];
  if (!edge || edge.bridge) return plan;
  const approaches: BuildingApproach[] = [],
    surfaces: GarageSurface[] = [...(plan.surfaces ?? [])],
    solids: Solid[] = [...plan.solids];
  const joins = new Map<string, readonly [number, number, number]>();
  for (const bay of entrances) {
    const entrance = bay.route[0];
    if (!entrance) continue;
    const first = bay.key.includes(":bay:") ? (bay.route[1] ?? entrance) : entrance;
    const key = `${entrance[0]},${entrance[1]}`;
    if (joins.has(key)) continue;
    const q = locate(edge.path, first[0], first[1]),
      road = pointAt(edge.path, q.s, Math.sign(q.d || 1) * (edge.half - 0.1));
    const dx = first[0] - road.x,
      dz = first[1] - road.z,
      length = Math.hypot(dx, dz);
    if (length < 0.1 || length > 120 || q.s < edge.half + 7 || q.s > edge.path.length - edge.half - 8) continue;
    const back = height?.roadAt(edge.id, q.s) ?? 0,
      front = first[2] ?? height?.heightAt(first[0], first[1]) ?? 0;
    // An upper-floor route must return to the ground entrance itself. Never build an impossible steep access ramp.
    if (Math.abs(front - back) / length > 0.15) continue;
    const halfWidth = bay.key.endsWith(":home-garage") ? 1.8 : 3.2,
      yaw = datan2(dx, dz);
    approaches.push({ x: road.x, z: road.z, fx: dx / length, fz: dz / length, length, halfWidth });
    // Short slabs follow the supported grade. No solid wall or raised kerb across the entrance.
    const n = Math.ceil(length / 0.75);
    const level = (t: number) =>
      Math.max(back + (front - back) * t, height?.heightAt(road.x + dx * t, road.z + dz * t) ?? 0) + 0.025;
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n,
        y0 = level(j / n),
        y1 = level((j + 1) / n),
        x = road.x + dx * t,
        z = road.z + dz * t;
      surfaces.push({ x, z, yaw, hw: halfWidth, hd: length / (2 * n), back: y0, front: y1 });
      solids.push({
        lod: 1,
        box: {
          c: [x, Math.max(y0, y1) - 0.012, z],
          h: [halfWidth, 0.015, length / (2 * n) + 0.01],
          yaw,
          mat: SLOT.concreteLight,
        },
      });
    }
    joins.set(key, [road.x, road.z, back + 0.02]);
  }
  if (!approaches.length) return plan;
  return {
    ...plan,
    approaches,
    solids,
    surfaces,
    parking: (plan.parking ?? []).map((bay) => {
      const first = bay.route[0],
        join = first ? joins.get(`${first[0]},${first[1]}`) : undefined;
      return join ? { ...bay, route: [join, ...bay.route] } : bay;
    }),
  };
}
