// Ground shapes: one height function per kind of land, in metres, from a seed.
// All pure, so a biome's ground is the same on every visit and a server can
// ask for a height without drawing anything.

export type ReliefKind = "plain" | "hills" | "ridges" | "dunes" | "hummocks" | "terraces" | "crags";

export interface Relief {
  readonly kind: ReliefKind;
  /** Height of the land's features, in metres. */
  readonly amp: number;
  /** Size of the land's features, in metres. */
  readonly scale: number;
}

function lattice(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265261) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise2(x: number, z: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(z);
  let u = x - i, v = z - j;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const a = lattice(i, j, seed), b = lattice(i + 1, j, seed), c = lattice(i, j + 1, seed), d = lattice(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 0.5, total = 0, f = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise2(x * f, z * f, seed + i * 13) * amp;
    total += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / total;
}

/** The land's height at a point. */
export function reliefHeight(relief: Relief, x: number, z: number, seed: number): number {
  const u = x / relief.scale, v = z / relief.scale, { amp } = relief;
  switch (relief.kind) {
    case "plain": return (fbm(u, v, seed, 3) - 0.5) * amp;
    case "hills": return (fbm(u, v, seed, 4) - 0.35) * amp * 1.6;
    case "ridges": {
      let sum = 0, a = 0.5, f = 1, weight = 1;
      for (let i = 0; i < 5; i += 1) {
        const ridge = 1 - Math.abs(noise2(u * f, v * f, seed + i * 7) * 2 - 1);
        sum += ridge * ridge * a * weight;
        weight = Math.min(1, ridge * 1.7);
        a *= 0.5;
        f *= 2.1;
      }
      return (sum - 0.28) * amp * 1.5;
    }
    case "dunes": {
      const warp = fbm(u * 0.6, v * 0.6, seed, 2) * 3.5;
      const t = (u * 1.2 + warp + v * 0.3) % 1;
      const wave = t < 0 ? t + 1 : t;
      // Long windward rise, short slip face.
      const face = wave < 0.8 ? wave / 0.8 : (1 - wave) / 0.2;
      return (face * face * (3 - 2 * face) * 0.75 + fbm(u, v, seed + 3, 2) * 0.5 - 0.5) * amp;
    }
    case "hummocks": {
      const big = fbm(u, v, seed, 3) - 0.5, small = noise2(u * 5, v * 5, seed + 9) - 0.5;
      return big * amp * 1.4 + small * amp * 0.3;
    }
    case "terraces": {
      const h = fbm(u, v, seed, 4) * 6;
      const step = Math.floor(h), f = h - step, s = Math.min(1, Math.max(0, (f - 0.72) / 0.28));
      return (step + s * s * (3 - 2 * s) - 2.4) * amp * 0.4;
    }
    default: {
      const base = fbm(u, v, seed, 5), spike = 1 - Math.abs(noise2(u * 2.6, v * 2.6, seed + 5) * 2 - 1);
      return (base * 0.9 + spike ** 4 * 0.75 - 0.6) * amp;
    }
  }
}
