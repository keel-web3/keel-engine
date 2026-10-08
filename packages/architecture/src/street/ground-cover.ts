import { dcos, dsin } from "@keel-engine/core";
import { addBox, addCapsule, addPlant } from "../frame.ts";
import type { Build } from "../frame.ts";
/** Seeded, bounded turf: broad tonal patches at distance, low mounds and blades up close.
 * Uses the existing district materials and plant atlas, never a texture per lot.
 * Every placement obeys the same path/water/furniture clearance as the grass. */
export function groundCover(b: Build, s: { x: number; z: number; hw: number; hd: number }, clear: (x: number, z: number, radius: number) => boolean): void {
  const count = Math.min(24, Math.max(8, Math.round(s.hw * s.hd / 45)));
  for (let k = 0; k < count; k++) {
    const hw = .5 + b.D.u("turfW", k) * 1.5, hd = .5 + b.D.u("turfD", k) * 2.1, r = Math.hypot(hw, hd);
    if (r >= s.hw || r >= s.hd) continue;
    const x = s.x + b.D.flat("turfX", k) * (s.hw - r), z = s.z + b.D.flat("turfZ", k) * (s.hd - r);
    if (!clear(x, z, r)) continue;
    const turn = b.D.flat("turfTurn", k), dry = k % 7 === 0, slot = dry ? "gravel" : k % 3 === 0 ? "grass" : "foliageAlt";
    // A shallow, irregular crown catches the light; its foot is on the lawn.
    const rise = .012 + .07 * b.D.u("turfRise", k);
    addBox(b, 2, x, .083, z, hw, .003, hd, slot, { turn });
    addBox(b, 1, x, .09 + rise / 2, z, hw * .65, rise / 2, hd * .7, slot, { turn, wedge: true, lo: .08 });
    if (dry) continue;
    // Small clumps of leaning blades, not a uniform lawn of vertical boxes.
    for (let j = 0; j < 4; j++) {
      const bx = x + b.D.flat("bladeX", k, j) * hw * .6, bz = z + b.D.flat("bladeZ", k, j) * hd * .6;
      const height = .1 + .25 * b.D.u("bladeH", k, j), lean = .04 + .13 * b.D.u("bladeLean", k, j), angle = b.D.u("bladeA", k, j) * 6.283185307179586;
      addCapsule(b, 0, [bx, .085, bz], [bx + dcos(angle) * lean, .085 + height, bz + dsin(angle) * lean], .018, j % 2 ? "foliage" : "foliageAlt");
    }
    if (k % 2 === 0) addPlant(b, k % 6 === 0 ? "flowers" : "grass", x, .09, z, .65 + b.D.u("turfS", k) * .7, Math.floor(b.D.u("turfSeed", k) * 1e6));
  }
}
