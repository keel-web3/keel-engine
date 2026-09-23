// Conservative projected error for a mesh replacement. Use camera depth, not radial distance:
// a wide FOV, screen edge, portrait crop or mirror can require a different level of the same object.
import type { Projection } from "./project.ts";

/** Largest screen-axis displacement (picture pixels) of a local-space error anywhere in this transformed box. */
export function projectedMeshError(view: Projection, lo: ArrayLike<number>, hi: ArrayLike<number>, model: ArrayLike<number>, error: number): number {
  if (!(error >= 0) || !Number.isFinite(error)) return Infinity;
  // A camera axis through the model. Its support gives the exact interval of the oriented box;
  // its length also scales the error correctly for non-uniform scale and shear.
  const range = (axis: readonly number[]) => {
    let center = 0, radius = 0, scale2 = 0;
    for (let i = 0; i < 3; i++) {
      const a = axis[0]! * model[i * 4]! + axis[1]! * model[i * 4 + 1]! + axis[2]! * model[i * 4 + 2]!;
      center += a * (lo[i]! + hi[i]!) * .5;
      radius += Math.abs(a) * (hi[i]! - lo[i]!) * .5; scale2 += a * a;
      center += axis[i]! * (model[12 + i]! - view.origin[i]!);
    }
    return { min: center - radius, max: Math.abs(center) + radius, error: error * Math.sqrt(scale2) };
  };
  const x = range(view.right), y = range(view.up);
  if (view.kind === "ortho") return view.k * Math.max(x.error, y.error);
  const z = range(view.forward);
  if (z.min - z.error <= (view.clipNear ?? .05)) return Infinity;
  const focal = view.height / (2 * view.tanHalfFov);
  return focal * Math.max(x.error + x.max * z.error / z.min, y.error + y.max * z.error / z.min) / (z.min - z.error);
}
