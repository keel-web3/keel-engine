import { SIDEWALK, drawsFor } from "@keel-engine/city";
import type { City, CityHeight, Lot } from "@keel-engine/city";
import { datan2, dcos, dsin } from "@keel-engine/core";
import { locate, pointAt } from "@keel-engine/road";
import { frameOf, mainFront } from "./frame.ts";
import { SLOT, STREET_SLOT } from "./slots.ts";
import type { BuildingPlan, PlantSpot, PropSpot, Solid } from "./types.ts";

/** One site frame for entrances, frontage paving and planting; access corridors are reserved before landscaping. */
export function withSiteAccess(plan: BuildingPlan, city: City, lot: Lot, height?: CityHeight): BuildingPlan {
  if (plan.archetype === "none" || !plan.footprint.length) return plan;
  const f = frameOf(lot),
    c = dcos(f.yaw),
    s = dsin(f.yaw),
    edge = city.graph.edges[mainFront(lot)?.edge ?? lot.frontage];
  const solids: Solid[] = [...plan.solids],
    walks = [...(plan.walks ?? [])];
  if (edge && !edge.bridge && plan.door) {
    const door = plan.door,
      q = locate(edge.path, door.x, door.z),
      width = SIDEWALK[edge.cls],
      off = edge.half + width.kerb + width.slab - 0.45;
    const end = pointAt(edge.path, q.s, Math.sign(q.d || 1) * off),
      dx = end.x - door.x,
      dz = end.z - door.z,
      length = Math.hypot(dx, dz);
    if (length > 0.3 && length < 60) {
      // Do not lay a connector through another wing of a concave building.
      const clear = plan.footprint.every((b) => {
        const bc = dcos(b.yaw),
          bs = dsin(b.yaw);
        for (let t = 0.08; t < 1; t += 0.08) {
          const x = door.x + dx * t - b.x,
            z = door.z + dz * t - b.z;
          if (Math.abs(x * bc - z * bs) < b.hw - 0.05 && Math.abs(x * bs + z * bc) < b.hd - 0.05) return false;
        }
        return true;
      });
      if (clear) {
        walks.push({
          key: `${plan.key}:front-walk`,
          width: 1.8,
          clearance: 3,
          path: [
            [door.x, door.z],
            [end.x, end.z],
          ],
        });
        const n = Math.ceil(length / 1.5),
          yaw = datan2(dx, dz);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n,
            x = door.x + dx * t,
            z = door.z + dz * t;
          solids.push({
            lod: 1,
            box: {
              c: [x, (height?.heightAt(x, z) ?? 0) + 0.018, z],
              h: [0.9, 0.018, length / (2 * n) + 0.01],
              yaw,
              mat: SLOT.concreteLight,
            },
          });
        }
      }
    }
  }
  const plants: PlantSpot[] = [...(plan.plants ?? [])],
    props: PropSpot[] = [...(plan.props ?? [])],
    D = drawsFor(city.site.seed, `lot-planting|${lot.key}`);
  const blocked = (x: number, z: number, r: number): boolean => {
    for (const b of plan.footprint) {
      const dx = x - b.x,
        dz = z - b.z,
        bc = dcos(b.yaw),
        bs = dsin(b.yaw);
      if (Math.abs(dx * bc - dz * bs) < b.hw + r && Math.abs(dx * bs + dz * bc) < b.hd + r) return true;
    }
    for (const w of walks)
      for (let i = 1; i < w.path.length; i++) {
        const a = w.path[i - 1]!,
          b = w.path[i]!,
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        if ((x - a[0] - dx * t) ** 2 + (z - a[1] - dz * t) ** 2 < (w.width / 2 + r) ** 2) return true;
      }
    for (const a of plan.approaches ?? []) {
      const dx = x - a.x,
        dz = z - a.z,
        t = Math.max(0, Math.min(a.length, dx * a.fx + dz * a.fz));
      if ((dx - a.fx * t) ** 2 + (dz - a.fz * t) ** 2 < (a.halfWidth + r) ** 2) return true;
    }
    for (const bay of plan.parking ?? []) {
      const dx = x - bay.x,
        dz = z - bay.z,
        bc = dcos(bay.yaw),
        bs = dsin(bay.yaw);
      if (Math.abs(dx * bc - dz * bs) < bay.hw + r || Math.hypot(dx, dz) < 6 + r) {
        if (Math.abs(dx * bc - dz * bs) < bay.hw + r && Math.abs(dx * bs + dz * bc) < bay.hd + r) return true;
      }
      for (let i = 1; i < bay.route.length; i++) {
        const a = bay.route[i - 1]!,
          b = bay.route[i]!,
          vx = b[0] - a[0],
          vz = b[1] - a[1],
          t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz || 1)));
        if ((x - a[0] - vx * t) ** 2 + (z - a[1] - vz * t) ** 2 < (3.3 + r) ** 2) return true;
      }
    }
    for (const p of props) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + r + 0.5) ** 2) return true;
    for (const p of plants) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (2 + r) ** 2) return true;
    return false;
  };
  // The perimeter setback gets shrubs and an occasional tree; doors, ramps, aisles and covered walks stay open.
  let n = 0;
  for (const side of [-1, 1])
    for (let z = -f.hd + 3; z < f.hd - 2; z += 6, n++) {
      const u = side * (f.hw - 2),
        x = f.x + u * c + z * s,
        wz = f.z - u * s + z * c,
        tree = D.u("tree", n) < 0.28,
        r = tree ? 1.6 : 0.6;
      if (f.hw < 4 || blocked(x, wz, r)) continue;
      const scale = tree ? 0.72 : 0.8,
        bed = tree ? 1.1 : 0.7,
        y = height?.heightAt(x, wz) ?? 0;
      solids.push({
        lod: 1,
        layer: 1,
        box: { c: [x, y + 0.025, wz], h: [bed, 0.025, bed], yaw: f.yaw, mat: STREET_SLOT.grass },
      });
      for (const side of [-1, 1]) {
        solids.push({
          lod: 1,
          layer: 1,
          box: {
            c: [x + side * bed * c, y + 0.04, wz - side * bed * s],
            h: [0.045, 0.04, bed + 0.045],
            yaw: f.yaw,
            mat: STREET_SLOT.planter,
          },
        });
        solids.push({
          lod: 1,
          layer: 1,
          box: {
            c: [x + side * bed * s, y + 0.04, wz + side * bed * c],
            h: [bed, 0.04, 0.045],
            yaw: f.yaw,
            mat: STREET_SLOT.planter,
          },
        });
      }
      plants.push({
        kind: tree ? "street" : "bush",
        x,
        y: height?.heightAt(x, wz) ?? 0,
        z: wz,
        scale,
        seed: Math.floor(D.u("plant", n) * 0x7fffffff),
      });
      if (tree) props.push({ kind: "tree", x, z: wz, r: 0.3 * scale, breaks: false });
    }
  return { ...plan, walks, solids, plants, props };
}
