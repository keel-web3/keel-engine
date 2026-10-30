// Vines that climb. crawl() walks a path over anything that can say how far a
// point is from its surface (a boulder, a wall, a trunk), and a vine field
// turns paths into one mesh of stem and leaves, with free tendrils that swing
// and a reach that lets it grow along its length over time.

import { Color, Group, Mesh, Vector2 } from "@keel-engine/lit";
import type { Attribute } from "@keel-engine/lit";
import { plantMaterial } from "./plant-field.ts";
import type { FloraMotion } from "./motion.ts";
import type { ColorRepresentation } from "@keel-engine/lit";
import { LEAF_ROUND, PlantBuilder, ROLE_BLOOM, ROLE_OWN, seeded, v3 } from "./shapes.ts";
import type { V3 } from "./shapes.ts";

const { add, cross, mul, unit } = v3;

/** Signed distance to a surface: positive outside. */
export type Surface = (x: number, y: number, z: number) => number;

export interface CrawlOptions {
  readonly start: V3;
  /** Which way it tries to go (default up). */
  readonly toward?: V3;
  readonly steps?: number;
  readonly step?: number;
  /** How much it wanders, 0..1. */
  readonly wander?: number;
  /** How far off the surface it keeps. */
  readonly gap?: number;
  readonly seed?: number;
}

/** A path along a surface, always hugging it: each step goes on, then is pulled back on by the distance's gradient. */
export function crawl(surface: Surface, { start, toward = [0, 1, 0], steps = 40, step = 0.08, wander = 0.45, gap = 0.015, seed = 1 }: CrawlOptions): V3[] {
  const r = seeded(seed), e = 1e-3;
  const grad = (p: V3): V3 => unit([
    surface(p[0] + e, p[1], p[2]) - surface(p[0] - e, p[1], p[2]),
    surface(p[0], p[1] + e, p[2]) - surface(p[0], p[1] - e, p[2]),
    surface(p[0], p[1], p[2] + e) - surface(p[0], p[1], p[2] - e),
  ]);
  const snap = (p: V3): V3 => {
    let at = p;
    for (let i = 0; i < 4; i += 1) at = add(at, mul(grad(at), gap - surface(at[0], at[1], at[2])));
    return at;
  };
  const path: V3[] = [snap(start)];
  let dir = unit(toward);
  for (let i = 0; i < steps; i += 1) {
    const at = path[path.length - 1]!, n = grad(at);
    const turn = cross(n, dir);
    dir = unit(add(add(dir, mul(turn, (r() - 0.5) * wander * 2)), mul(unit(toward), 0.12)));
    const tangent = unit(add(dir, mul(n, -(dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]))));
    dir = tangent;
    path.push(snap(add(at, mul(tangent, step))));
  }
  return path;
}

export interface VineSpec {
  /** Distance past which the vines are gone (they fade over the last third). */
  readonly far?: number;
  readonly motion: FloraMotion;
  readonly paths: readonly (readonly V3[])[];
  readonly tint: ColorRepresentation;
  readonly bloom?: ColorRepresentation;
  readonly stem?: ColorRepresentation;
  /** Leaves per path point. */
  readonly leaves?: number;
  readonly leaf?: readonly [number, number];
  /** Blooms per path point. */
  readonly blooms?: number;
  /** Chance per point of a loose tendril. */
  readonly tendrils?: number;
  readonly seed?: number;
}

export interface VineField {
  readonly root: Group;
  /** How far along its length it has grown, 0..1. */
  setReach(amount: number): void;
  dispose(): void;
}

export function createVineField(spec: VineSpec): VineField {
  const b = new PlantBuilder(spec.seed ?? 1);
  const r = b.random;
  const [len, wid] = spec.leaf ?? [0.07, 0.06];
  spec.paths.forEach((path) => {
    const n = path.length;
    for (let k = 0; k < n - 1; k += 8) {
      const piece = path.slice(k, k + 9);
      b.tube(piece, 0.007 * (1 - (k / n) * 0.6), 0.007 * (1 - ((k + 8) / n) * 0.6), 3, { role: ROLE_OWN, tone: spec.stem ?? "#5c5a34", along: k / n, phase: r() });
    }
    for (let i = 1; i < n - 1; i += 1) {
      const along = i / n, ahead = unit(add(path[i + 1]!, mul(path[i - 1]!, -1)));
      const count = (spec.leaves ?? 1.4) + r() - 0.5;
      for (let l = 0; l < count; l += 1) {
        const side = unit(cross(ahead, [r() - 0.5, r() - 0.5, r() - 0.5]));
        b.leaf(path[i]!, unit(add(side, mul(ahead, 0.4))), unit(add(cross(ahead, side), side)), len * (0.7 + 0.6 * r()), wid * (0.7 + 0.6 * r()), { along, phase: r(), flutter: 1, outline: LEAF_ROUND, fold: 0.1, shade: 0.8 + 0.3 * r() });
      }
      if (r() < (spec.blooms ?? 0)) b.lump(add(path[i]!, [0, 0.02, 0]), [0.024, 0.018, 0.024], 0, 0, { role: ROLE_BLOOM, along });
      if (r() < (spec.tendrils ?? 0.06)) {
        const drop = 0.1 + r() * 0.2, phase = r();
        const hang: V3[] = [0, 1, 2, 3].map((q) => add(path[i]!, [Math.sin(q + phase * 6) * 0.012, (-q / 3) * drop, Math.cos(q + phase * 6) * 0.012]));
        b.tube(hang, 0.003, 0.0015, 3, { role: ROLE_OWN, tone: spec.stem ?? "#5c5a34", along, phase, flutter: 1 });
      }
    }
  });
  const geometry = b.finish({ keepScale: true, give: 1 });
  // A climbing stem is held to its wall: only its leaves flutter, and only the free ends move far.
  const bend = geometry.getAttribute("aPart") as Attribute;
  for (let i = 0; i < bend.count; i += 1) bend.setY(i, 0.05 + bend.getW(i) * 0.05);
  bend.needsUpdate = true;
  const grow = { value: new Vector2(1, 2) };
  const material = plantMaterial(spec.motion, grow, true, {
    uPlantTint: { value: new Color(spec.tint) },
    uPlantBloom: { value: new Color(spec.bloom ?? spec.tint) },
    uPlantFar: { value: spec.far ?? 22 },
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const root = new Group();
  root.name = "keel-vines";
  root.add(mesh);
  return {
    root,
    setReach(amount) { grow.value.y = amount >= 1 ? 2 : Math.max(0, amount); },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
