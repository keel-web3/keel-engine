import type { BakeBox, BakeCapsule } from "./bake.ts";
export interface LodSolid { readonly lod: number; readonly layer?: number; readonly box?: BakeBox; readonly capsule?: BakeCapsule }
export interface SolidLodTerm { readonly error: number; readonly facing?: "roof"; readonly roofY?: number }
export interface SolidLodStep { readonly terms: SolidLodTerm[] }
export function solidSize(solid: BakeBox | BakeCapsule): number {
  if ("r" in solid) return 2 * solid.r;
  const e = [solid.h[0] ?? 0, solid.h[1] ?? 0, solid.h[2] ?? 0].sort((a, b) => a - b);
  return 2 * e[1]!;
}
/** Error of dropping levels 0 and 1, separating roof details from street details.
 * Both levels share one support-box scan per plan. Results match the original per-level calculation. */
export function solidLodSteps(plans: readonly { readonly solids: readonly LodSolid[] }[], layer = 0): [SolidLodStep, SolidLodStep] {
  const free = [0, 0], roof = [0, 0], roofY = [Infinity, Infinity];
  for (const p of plans) {
    const masses: { x: number; z: number; top: number; radius: number }[] = [];
    for (const s of p.solids) if (s.lod === 2 && s.box && (s.layer ?? 0) === layer) {
      const m = s.box;
      masses.push({ x: m.c[0] ?? 0, z: m.c[2] ?? 0, top: (m.c[1] ?? 0) + (m.h[1] ?? 0), radius: Math.hypot(m.h[0] ?? 0, m.h[2] ?? 0) + 0.5 });
    }
    for (const s of p.solids) {
      const l = s.lod;
      if ((l !== 0 && l !== 1) || (s.layer ?? 0) !== layer) continue;
      const y = s.box ? (s.box.c[1] ?? 0) - (s.box.h[1] ?? 0) : s.capsule ? Math.min(s.capsule.a[1] ?? 0, s.capsule.b[1] ?? 0) - s.capsule.r : 0;
      const at = s.box ? s.box.c : s.capsule!.a;
      // Street-level details cannot be roof terms; support measurements are shared by both levels.
      let under = false;
      if (y > 4) for (const m of masses) {
        if (Math.abs(m.top - y) < 1.2 && Math.hypot((at[0] ?? 0) - m.x, (at[2] ?? 0) - m.z) <= m.radius) { under = true; break; }
      }
      const size = s.box ? solidSize(s.box) : s.capsule ? solidSize(s.capsule) : 0;
      if (under && y > 4) { roof[l] = Math.max(roof[l]!, size); roofY[l] = Math.min(roofY[l]!, y); }
      else free[l] = Math.max(free[l]!, size);
    }
  }
  const step = (l: number): SolidLodStep => {
    const terms: SolidLodTerm[] = [{ error: free[l]! }];
    if (roof[l]! > 0) terms.push({ error: roof[l]!, facing: "roof", roofY: roofY[l]! });
    return { terms };
  };
  return [step(0), step(1)];
}
