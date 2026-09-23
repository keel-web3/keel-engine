// Public art, centred on a point of a placer's frame: a fountain with its
// lit jet, a pond, a bronze on its plinth, an abstract piece (a ring of
// segments), and the landmark scale -- an obelisk, a giant neon ring, a
// colossal statue. Each returns its collision radius (0: nothing to hit).

import { addBox, addCapsule } from "../frame.ts";
import type { Placer } from "../frame.ts";
import type { ArtKind } from "../types.ts";
import type { StreetSlotName } from "../slots.ts";

/** A ring of capsule segments standing in the x-y plane (a hoop), centre (x, y, z), radius r. */
function hoop(p: Placer, x: number, y: number, z: number, r: number, thick: number, slot: StreetSlotName, n = 10): void {
  const pts: [number, number][] = [];
  // (A polygon's corners by rotating a unit step: no trig, the same everywhere.)
  let cx = 1, cy = 0;
  const [c, s] = n === 10 ? [0.8090169943749475, 0.5877852522924731] : [0.7071067811865476, 0.7071067811865476];
  for (let k = 0; k < n; k += 1) { pts.push([cx, cy]); [cx, cy] = [cx * c - cy * s, cx * s + cy * c]; }
  for (let k = 0; k < n; k += 1) {
    const a = pts[k]!, b = pts[(k + 1) % n]!;
    addCapsule(p, 1, [x + a[0] * r, y + a[1] * r, z], [x + b[0] * r, y + b[1] * r, z], thick, slot);
  }
}

/** A figure on a plinth (scale 1: life size and a half). */
function figure(p: Placer, x: number, z: number, k: number, base: number): void {
  addBox(p, 1, x, base / 2, z, 0.9 * k, base / 2, 0.9 * k, "plinth");
  const y = base;
  addCapsule(p, 1, [x - 0.2 * k, y + 0.2 * k, z], [x - 0.15 * k, y + 1.2 * k, z], 0.2 * k, "bronze");
  addCapsule(p, 1, [x + 0.2 * k, y + 0.2 * k, z], [x + 0.15 * k, y + 1.2 * k, z], 0.2 * k, "bronze");
  addCapsule(p, 1, [x, y + 1.35 * k, z], [x, y + 2.2 * k, z], 0.36 * k, "bronze");
  addCapsule(p, 1, [x, y + 2.55 * k, z], [x, y + 2.6 * k, z], 0.26 * k, "bronze");
  // (One arm raised: a founder pointing the way.)
  addCapsule(p, 1, [x + 0.35 * k, y + 2.1 * k, z], [x + 0.8 * k, y + 2.9 * k, z + 0.3 * k], 0.12 * k, "bronze");
}

export function art(p: Placer, kind: ArtKind, x = 0, z = 0): number {
  switch (kind) {
    case "fountain": {
      for (const s of [-1, 1]) { addBox(p, 1, x + s * 3, 0.35, z, 0.25, 0.35, 3.25, "plinth"); addBox(p, 1, x, 0.35, z + s * 3, 3.25, 0.35, 0.25, "plinth"); }
      addBox(p, 1, x, 0.3, z, 2.75, 0.2, 2.75, "water");
      addBox(p, 1, x, 0.9, z, 0.6, 0.6, 0.6, "plinth");
      addCapsule(p, 1, [x, 1.5, z], [x, 3.6, z], 0.22, "jet");
      return 3.3;
    }
    case "pond": {
      const w = 4 + 3 * p.D.u("pond"), d = 3 + 2 * p.D.u("pondD");
      addBox(p, 1, x, 0.12, z, w + 0.4, 0.12, d + 0.4, "plinth");
      addBox(p, 1, x, 0.16, z, w, 0.1, d, "water");
      return 0;
    }
    case "statue": figure(p, x, z, 1, 1.6); return 1;
    case "sculpture": {
      addBox(p, 1, x, 0.4, z, 1.4, 0.4, 1.4, "plinth");
      hoop(p, x, 3.2, z, 2.4, 0.3, p.D.u("hoop") < 0.5 ? "sculpture" : "artNeon");
      return 1.5;
    }
    case "obelisk": {
      addBox(p, 1, x, 0.6, z, 3, 0.6, 3, "plinth");
      let w = 1.6, y = 1.2;
      for (let t = 0; t < 3; t += 1) { const h = 7 - t; addBox(p, 1, x, y + h / 2, z, w, h / 2, w, "plinth"); y += h; w *= 0.8; }
      addBox(p, 1, x, y + 1, z, w, 1, w, "artNeon");
      for (const s of [-1, 1]) addBox(p, 1, x + s * 3.05, 0.6, z, 0.04, 0.3, 2.6, "artNeon");
      return 3;
    }
    case "neonRing": {
      addBox(p, 1, x, 0.5, z, 3.5, 0.5, 1.5, "plinth");
      hoop(p, x, 7.5, z, 6.5, 0.45, "artNeon", 8);
      hoop(p, x, 7.5, z, 5.2, 0.25, "sculpture", 8);
      return 3.5;
    }
    case "giantStatue": figure(p, x, z, 3.2, 3.5); return 3;
    default: return 0;
  }
}
