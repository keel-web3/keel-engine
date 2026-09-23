import type { Projection } from "./project.ts";
/** Conservative pixel rectangle in GL's bottom-left coordinates, including off-screen and near-plane crossings. */
export function screenBounds(view: Projection, lo: ArrayLike<number>, hi: ArrayLike<number>, model: ArrayLike<number>, pad = 0): [number, number, number, number] {
  let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
  const clip = view.clip;
  for (let c = 0; c < 8; c++) {
    const x = (c & 1 ? hi : lo)[0]!, y = (c & 2 ? hi : lo)[1]!, z = (c & 4 ? hi : lo)[2]!;
    const wx = model[0]! * x + model[4]! * y + model[8]! * z + model[12]!;
    const wy = model[1]! * x + model[5]! * y + model[9]! * z + model[13]!;
    const wz = model[2]! * x + model[6]! * y + model[10]! * z + model[14]!;
    const w = clip[3]! * wx + clip[7]! * wy + clip[11]! * wz + clip[15]!;
    // A box crossing the eye plane has unbounded projected corners. Keep the whole screen in this rare case.
    if (!(w > 1e-6)) return [0, 0, view.width, view.height];
    const px = ((clip[0]! * wx + clip[4]! * wy + clip[8]! * wz + clip[12]!) / w * .5 + .5) * view.width;
    const py = ((clip[1]! * wx + clip[5]! * wy + clip[9]! * wz + clip[13]!) / w * .5 + .5) * view.height;
    left = Math.min(left, px); right = Math.max(right, px); bottom = Math.min(bottom, py); top = Math.max(top, py);
  }
  left = Math.max(0, Math.min(view.width, Math.floor(left - pad)));
  bottom = Math.max(0, Math.min(view.height, Math.floor(bottom - pad)));
  right = Math.max(left, Math.min(view.width, Math.ceil(right + pad)));
  top = Math.max(bottom, Math.min(view.height, Math.ceil(top + pad)));
  return [left, bottom, right - left, top - bottom];
}
