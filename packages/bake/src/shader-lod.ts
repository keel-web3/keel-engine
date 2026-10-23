import type { Projection } from './project.ts';
import { projectedMeshError } from './mesh-lod.ts';
import { dhypot } from '@keel-engine/core/dmath';

const columnDot = (model: ArrayLike<number>, a: number, b: number): number => model[a]! * model[b]! + model[a + 1]! * model[b + 1]! + model[a + 2]! * model[b + 2]!;

/** Cheap necessary footprint check for discovering runs before precision validation. */
export function shaderLodFootprintEligible(view: Projection, lo: ArrayLike<number>, hi: ArrayLike<number>, model: ArrayLike<number>, maxPixels = 24): boolean {
  const diameter = dhypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  return projectedMeshError(view, lo, hi, model, diameter) <= maxPixels;
}

/** Analytic capsules preserve similarity transforms. Shear, non-uniform scale, near crossings and big images fall back. */
export function shaderLodEligible(view: Projection, lo: ArrayLike<number>, hi: ArrayLike<number>, model: ArrayLike<number>, error: number, maxPixels = 24): boolean {
  if (!(error >= 0) || !Number.isFinite(error)) return false;
  if (!(maxPixels > 0) || !Number.isFinite(maxPixels) || model.length !== 16) return false;
  if (model[3] !== 0 || model[7] !== 0 || model[11] !== 0 || model[15] !== 1) return false;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(model[i])) return false;
  const scale2 = columnDot(model, 0, 0), tolerance = scale2 * 1e-5;
  if ((!(scale2 > 1e-12) || scale2 > 1e36) || Math.abs(columnDot(model, 4, 4) - scale2) > tolerance || Math.abs(columnDot(model, 8, 8) - scale2) > tolerance
      || Math.abs(columnDot(model, 0, 4)) > tolerance || Math.abs(columnDot(model, 0, 8)) > tolerance || Math.abs(columnDot(model, 4, 8)) > tolerance) return false;
  // Proxies have outward winding: reject reflected transforms too.
  const det = model[0]! * (model[5]! * model[10]! - model[6]! * model[9]!)
    - model[4]! * (model[1]! * model[10]! - model[2]! * model[9]!) + model[8]! * (model[1]! * model[6]! - model[2]! * model[5]!);
  if (!(det > 0)) return false;
  // Endpoints and reference vertices take different Float32 world-transform paths.
  // Reserve input conversion plus seven rounded multiply/add operations on each axis.
  // This also fails closed for tiny objects translated far from the world origin.
  const epsilon = 2 ** -24, gamma = 7 * epsilon / (1 - 7 * epsilon);
  let round2 = 0;
  for (let row = 0; row < 3; row++) {
    const translation = model[12 + row]!, tf = Math.fround(translation);
    let magnitude = Math.abs(tf), rounding = Math.abs(tf - translation);
    for (let axis = 0; axis < 3; axis++) {
      const extent = Math.max(Math.abs(lo[axis]!), Math.abs(hi[axis]!));
      const value = model[axis * 4 + row]!, vf = Math.fround(value);
      magnitude += extent * Math.abs(vf); rounding += extent * Math.abs(vf - value);
    }
    const e = rounding + gamma * magnitude; round2 += e * e;
  }
  const transformError = 2 * Math.sqrt(round2 / scale2);
  // Bounding-sphere diameter gives a conservative fill-work cap, independent of the view angle.
  const diameter = dhypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  // Tolerance admits nearly uniform/orthogonal matrices. Reserve their Gram-matrix
  // residual too: a tiny intentional shear/scale difference must not spend the last pixel-error margin.
  const residual = (Math.abs(columnDot(model, 4, 4) - scale2) + Math.abs(columnDot(model, 8, 8) - scale2)
    + 2 * (Math.abs(columnDot(model, 0, 4)) + Math.abs(columnDot(model, 0, 8)) + Math.abs(columnDot(model, 4, 8)))) / scale2;
  const guardedError = error + transformError + diameter * residual;
  // The solver has fixed world-space tolerances and a sixth-degree discriminant.
  // Retain polygons outside its safe Float32 size range instead of overflowing/underflowing.
  const worldDiameter = diameter * Math.sqrt(scale2);
  if (!(worldDiameter >= 1e-4 && worldDiameter <= 1e5)) return false;
  // Project the box once. For perspective, displacement/error increases with error,
  // so scaling the diameter displacement bounds the smaller surface displacement conservatively.
  if (guardedError > diameter) return false;
  const footprint = projectedMeshError(view, lo, hi, model, diameter);
  return footprint <= maxPixels && footprint * guardedError / diameter < .25;
}
