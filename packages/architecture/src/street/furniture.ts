// Street furniture, each piece a few boxes in its own frame (+z faces the way
// it faces: the road, for things on the kerb): lamps in three styles, benches,
// bins, hydrants, bus shelters, newspaper boxes, planters, bollards, street
// trees, traffic signals and signposts. Each returns its collision radius.

import { addAd, addBox, addPlant, subPlacer, toWorld } from "../frame.ts";
import type { Placer } from "../frame.ts";
import type { FurnitureKind, LampStyle, LightSpot, PlantKind } from "../types.ts";

/** A lamp: its pole and head(s); returns where its light falls (world) -- over the road, under its head. */
export function lamp(p: Placer, s: LampStyle): { r: number; lights: LightSpot[] } {
  const h = s.height;
  if (s.kind === "lantern") {
    addBox(p, 1, 0, h / 2, 0, 0.1, h / 2, 0.1, "pole");
    addBox(p, 0, 0, 0.4, 0, 0.2, 0.4, 0.2, "pole");
    addBox(p, 1, 0, h + 0.3, 0, 0.22, 0.3, 0.22, s.head);
    addBox(p, 0, 0, h + 0.68, 0, 0.3, 0.08, 0.3, "pole");
    const [x, , z] = toWorld(p, 0, 0, 0);
    return { r: 0.3, lights: [{ x, z, r: s.reach }] };
  }
  if (s.kind === "mast") {
    addBox(p, 2, 0, h / 2, 0, 0.22, h / 2, 0.22, "pole");
    addBox(p, 1, 0, h, 0, s.arm, 0.1, 0.1, "pole");
    const lights: LightSpot[] = [];
    for (let k = 0; k < s.heads; k += 1) {
      const x = s.heads === 1 ? 0 : -s.arm + (2 * s.arm * k) / (s.heads - 1);
      addBox(p, 1, x, h - 0.25, 0.15, 0.4, 0.15, 0.3, s.head);
      const [wx, , wz] = toWorld(p, x, 0, 4);
      lights.push({ x: wx, z: wz, r: s.reach });
    }
    return { r: 0.4, lights };
  }
  if (s.kind === "globe") {
    // (A post-top: a slim pole on its base, a round lamp on top, a finial.)
    addBox(p, 1, 0, h / 2, 0, 0.08, h / 2, 0.08, "pole");
    addBox(p, 0, 0, 0.35, 0, 0.17, 0.35, 0.17, "pole");
    addBox(p, 1, 0, h + 0.3, 0, 0.27, 0.27, 0.27, s.head);
    addBox(p, 0, 0, h + 0.62, 0, 0.1, 0.05, 0.1, "pole");
    const [x, , z] = toWorld(p, 0, 0, 0);
    return { r: 0.25, lights: [{ x, z, r: s.reach }] };
  }
  // (An arm out over the road, the head at its end.)
  addBox(p, 1, 0, h / 2, 0, 0.09, h / 2, 0.09, "pole");
  addBox(p, 1, 0, h - 0.05, s.arm / 2, 0.05, 0.05, s.arm / 2, "pole");
  addBox(p, 1, 0, h - 0.18, s.arm, 0.22, 0.07, 0.45, s.head);
  const [x, , z] = toWorld(p, 0, 0, s.arm);
  return { r: 0.25, lights: [{ x, z, r: s.reach }] };
}

const bench = (p: Placer, x = 0, z = 0): number => {
  addBox(p, 0, x, 0.45, z, 0.9, 0.05, 0.25, "wood");
  addBox(p, 0, x, 0.8, z - 0.22, 0.9, 0.2, 0.04, "wood");
  for (const s of [-1, 1]) addBox(p, 0, x + s * 0.75, 0.22, z, 0.04, 0.22, 0.22, "frame");
  return 1;
};
export { bench };

/** A tree where it stands (a sprite the game draws: its kind -- a street tree in its grate by default -- and seed). */
export function tree(p: Placer, x = 0, z = 0, scale = 1, kind: PlantKind = "street"): number {
  addPlant(p, kind, x, 0, z, scale, Math.floor(p.D.u("tree", Math.round(x * 7 + z * 13)) * 1e6));
  return 0.35 * scale;
}

const FURNITURE: Readonly<Record<FurnitureKind, (p: Placer, plant?: PlantKind) => number>> = {
  bench: (p) => bench(p),
  bin: (p) => { addBox(p, 0, 0, 0.5, 0, 0.28, 0.5, 0.28, "binGreen"); addBox(p, 0, 0, 1.03, 0, 0.3, 0.04, 0.3, "frame"); return 0.3; },
  hydrant: (p) => { addBox(p, 0, 0, 0.36, 0, 0.14, 0.36, 0.14, "hydrant"); addBox(p, 0, 0, 0.45, 0, 0.24, 0.07, 0.07, "hydrant"); addBox(p, 0, 0, 0.76, 0, 0.17, 0.05, 0.17, "hydrant"); return 0.2; },
  busStop: (p) => {
    // (The shelter's glass back to the buildings, its roof, a lit ad at one end, a bench inside, the stop's sign.)
    addBox(p, 1, 0, 1.2, -0.7, 1.8, 1.1, 0.04, "shelterGlass");
    addBox(p, 1, 0, 2.38, -0.05, 2, 0.06, 0.8, "frame");
    for (const s of [-1, 1]) addBox(p, 1, s * 1.85, 1.18, -0.7, 0.06, 1.18, 0.06, "frame");
    addBox(p, 1, 1.95, 1.2, -0.2, 0.06, 1, 0.55, "adPanel");
    addAd(subPlacer(p, 2.02, -0.2, Math.PI / 2), `${p.frame.x.toFixed(1)},${p.frame.z.toFixed(1)}:shelter`, "shelter", 0, 1.2, 0, 1.1, 2);
    bench(p, -0.3, -0.35);
    addBox(p, 0, -2.6, 1.4, 0.3, 0.05, 1.4, 0.05, "pole");
    addBox(p, 0, -2.6, 2.7, 0.3, 0.3, 0.3, 0.03, "signBlue");
    return 2;
  },
  newsBoxes: (p) => {
    const n = 2 + Math.floor(p.D.u("news") * 2);
    for (let k = 0; k < n; k += 1) addBox(p, 0, (k - (n - 1) / 2) * 0.62, 0.55, 0, 0.26, 0.55, 0.24, k % 2 ? "newsBox" : "binGreen");
    return 0.4 * n;
  },
  planter: (p) => { addBox(p, 0, 0, 0.35, 0, 0.7, 0.35, 0.7, "planter"); addBox(p, 0, 0, 0.68, 0, 0.62, 0.03, 0.62, "gravel"); addPlant(p, "bush", 0, 0.7, 0, 0.8, Math.floor(p.D.u("planter") * 1e6)); return 0.8; },
  bollards: (p) => { for (let k = -2; k <= 2; k += 1) addBox(p, 0, k * 1.4, 0.45, 0, 0.1, 0.45, 0.1, "bollard"); return 0.15; },
  tree: (p, plant) => tree(p, 0, 0, 1, plant ?? "street"),
};

/** A piece of furniture by kind; its collision radius. */
export const furniture = (p: Placer, kind: FurnitureKind, plant?: PlantKind): number => FURNITURE[kind](p, plant);

/**
 * A traffic signal at a junction's corner, its frame's +z facing the traffic coming at it and +x toward the road: a
 * pole, an arm out over the lanes, the head with its three lamps (one lit).
 */
export function signal(p: Placer, arm: number, lit: "signalRed" | "signalGreen"): number {
  addBox(p, 1, 0, 2.8, 0, 0.1, 2.8, 0.1, "pole");
  addBox(p, 1, arm / 2, 5.5, 0, arm / 2, 0.06, 0.06, "pole");
  addBox(p, 1, arm, 4.95, 0, 0.2, 0.55, 0.16, "housing");
  addBox(p, 1, 0, 2.6, 0.12, 0.13, 0.35, 0.08, "housing");
  const lamps: ["signalRed" | "signalAmber" | "signalGreen", number][] = [["signalRed", 5.3], ["signalAmber", 4.95], ["signalGreen", 4.6]];
  for (const [slot, y] of lamps) addBox(p, 1, arm, y, 0.18, 0.11, 0.11, 0.03, slot === lit ? slot : "housing");
  addBox(p, 0, 0, 2.7, 0.2, 0.08, 0.08, 0.02, lit);
  return 0.2;
}

/** A signpost: a pole and the two roads' name blades, crossed. */
export function signpost(p: Placer): number {
  addBox(p, 0, 0, 1.5, 0, 0.05, 1.5, 0.05, "pole");
  addBox(p, 0, 0, 2.95, 0, 0.6, 0.11, 0.02, "signBlue");
  addBox(p, 0, 0, 2.7, 0, 0.02, 0.11, 0.6, "signBlue");
  return 0.1;
}
