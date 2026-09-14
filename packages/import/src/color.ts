// Colour spaces for clustering: linear sRGB -> OKLab -> OKLCH (the engine's
// palettes are OKLCH: core's oklch() goes the other way).

export type Lab = [number, number, number];

/** Linear sRGB (0..1) -> OKLab. */
export function linearToOklab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab -> OKLCH [L, C, hue degrees 0..360). */
export function oklabToOklch([L, a, b]: Lab): [number, number, number] {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

/** OKLCH -> OKLab. */
export function oklchToOklab(L: number, C: number, h: number): Lab {
  const r = (h * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
}

/** Distance in OKLab (about 0.02 is just noticeable; 0.1 plainly another colour). */
export const labDistance = (p: Lab, q: Lab): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
