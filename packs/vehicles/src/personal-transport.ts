// Small personal transports are canonical vehicle props on a pedestrian's accepted route.
// Their complete ground footprint fits the shared walker's 0.4 m collision margin.
import type { BakeBox, BakeCapsule, BakeWorld } from "@keel-engine/bake";

export type PersonalTransportKind = "scooter" | "skateboard";
export const PERSONAL_TRANSPORT = {
  scooter: { radius: .4, deck: .105, minSpeed: 1.6, maxSpeed: 2.15, handleY: 1.02, handleZ: .23 },
  skateboard: { radius: .4, deck: .105, minSpeed: 1.45, maxSpeed: 1.95, handleY: 0, handleZ: 0 },
} as const;

/** Slots match the canonical pedestrian's clothes/trim/shoes so each rider's existing seed dresses the prop. */
export function personalTransportWorld(kind: PersonalTransportKind, level: 0 | 1 | 2 = 0): BakeWorld {
  const boxes: BakeBox[] = [{ c: [0, .08, 0], h: [kind === "scooter" ? .075 : .115, .025, .32], mat: 3 }];
  const capsules: BakeCapsule[] = [];
  const tube = (a: [number, number, number], b: [number, number, number], r: number, mat: number): void => { capsules.push({ a, b, r, mat }); };
  if (kind === "scooter") {
    for (const z of [-.25, .25]) tube([-.025, .055, z], [.025, .055, z], .055, 6);
    tube([0, .1, .25], [0, 1.02, .23], .022, 4);
    tube([-.23, 1.02, .23], [.23, 1.02, .23], .023, 4);
    if (level < 2) for (const side of [-1, 1]) tube([side * .16, 1.02, .23], [side * .23, 1.02, .23], .031, 6);
  } else {
    for (const z of [-.21, .21]) {
      tube([-.11, .05, z], [.11, .05, z], .02, 4);
      for (const side of [-1, 1]) tube([side * .095, .044, z], [side * .115, .044, z], .04, 6);
    }
    if (level < 2) boxes.push({ c: [0, .107, 0], h: [.105, .003, .27], mat: 6 });
  }
  return { boxes, capsules };
}
