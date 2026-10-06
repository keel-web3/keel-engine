import { addBox, addPlant } from "../frame.ts";
import type { Build } from "../frame.ts";
/** Seeded, bounded ground cover shared by lot parks and block parks. Fine detail stays out of the far LOD. */
export function groundCover(b: Build, s: { x: number; z: number; hw: number; hd: number }, clear: (x: number, z: number, radius: number) => boolean): void {
  const count = Math.min(16, Math.max(6, Math.round(s.hw * s.hd / 60)));
  for (let k = 0; k < count; k++) {
    const hw = .35 + b.D.u("turfW", k) * 1.5, hd = .4 + b.D.u("turfD", k) * 2.1, r = Math.hypot(hw, hd);
    if (r >= s.hw || r >= s.hd) continue;
    const x = s.x + b.D.flat("turfX", k) * (s.hw - r), z = s.z + b.D.flat("turfZ", k) * (s.hd - r);
    if (!clear(x, z, r)) continue;
    addBox(b, 1, x, .085, z, hw, .004, hd, k % 5 === 0 ? "gravel" : "foliageAlt", { turn: b.D.flat("turfTurn", k) });
    if (k % 3 === 0) addPlant(b, "grass", x, .09, z, .6 + b.D.u("turfS", k) * .45, Math.floor(b.D.u("turfSeed", k) * 1e6));
  }
}
