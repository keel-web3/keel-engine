// Foliage geometry, one unit tall with the root at the origin. Every vertex
// carries aCard (u, v, sway): its place on the sprite and how freely it moves
// (0 at the root, 1 at the tip), so cards and blades share one material.
//
//   crossCards   1..4 upright sprite planes through the root, turned evenly
//                round it (2: an X, 3: a star), each leaning out a little so
//                the clump reads round from every side; 1 plane faces the
//                camera (a billboard)
//   bladeClump   real 3D blades: tapering, bending, turned round the root,
//                for the near ground where cards would show their edges

import { Attribute, Geometry } from "@keel-engine/lit";

export interface CardOptions {
  /** Width over height (a sprite cell's aspect). */
  readonly aspect?: number;
  /** How far each plane leans out from upright, in radians. */
  readonly tilt?: number;
  /** Rows of quads up each plane (more bend smoothly in the wind). */
  readonly rows?: number;
}

export function crossCards(planes: 1 | 2 | 3 | 4 = 2, { aspect = 2 / 3, tilt = 0.12, rows = 3 }: CardOptions = {}): Geometry {
  const position: number[] = [], normal: number[] = [], card: number[] = [], index: number[] = [];
  const half = aspect / 2;
  for (let p = 0; p < planes; p += 1) {
    const yaw = (p / planes) * Math.PI;
    const cx = Math.cos(yaw), cz = -Math.sin(yaw);
    // The plane's normal, leaning up with the plane's tilt.
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    const base = position.length / 3;
    for (let r = 0; r <= rows; r += 1) {
      const v = r / rows;
      const lean = planes === 1 ? 0 : Math.sin(tilt) * v;
      for (let s = 0; s <= 1; s += 1) {
        const u = s, x = (u - 0.5) * 2 * half;
        position.push(cx * x + nx * lean, v * Math.cos(tilt * (planes === 1 ? 0 : 1)), cz * x + nz * lean);
        normal.push(nx, 0.25, nz);
        card.push(u, v, v * v);
      }
    }
    for (let r = 0; r < rows; r += 1) {
      const a = base + r * 2, b = a + 1, c = a + 2, d = a + 3;
      index.push(a, b, c, b, d, c);
    }
  }
  return build(position, normal, card, index);
}

export interface BladeOptions {
  readonly blades?: number;
  /** A blade's width at the root, as a share of the clump's height. */
  readonly width?: number;
  /** How far blades spread from the root, as a share of the height. */
  readonly spread?: number;
  /** How far tips bend over, as a share of the height. */
  readonly bend?: number;
  readonly segments?: number;
  readonly seed?: number;
}

export function bladeClump({ blades = 7, width = 0.07, spread = 0.18, bend = 0.3, segments = 3, seed = 1 }: BladeOptions = {}): Geometry {
  let s = seed >>> 0 || 1;
  const rand = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const position: number[] = [], normal: number[] = [], card: number[] = [], index: number[] = [];
  for (let b = 0; b < blades; b += 1) {
    const yaw = (b / blades) * Math.PI * 2 + rand() * 0.8;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const reach = spread * (0.3 + 0.7 * rand());
    const height = 0.55 + 0.45 * rand();
    const over = bend * (0.5 + rand());
    const ox = dx * reach * 0.25, oz = dz * reach * 0.25;
    const base = position.length / 3;
    for (let k = 0; k <= segments; k += 1) {
      const t = k / segments;
      const w = width * (1 - t * 0.9) * 0.5;
      // Out from the root, then over: a quadratic arc.
      const along = reach * t + over * t * t;
      const y = height * (t - 0.35 * over * t * t);
      for (const side of [-1, 1]) {
        position.push(ox + dx * along - dz * w * side, y, oz + dz * along + dx * w * side);
        normal.push(dx * 0.4, 1, dz * 0.4);
        card.push(side < 0 ? 0 : 1, t, t * t);
      }
    }
    for (let k = 0; k < segments; k += 1) {
      const a = base + k * 2, bb = a + 1, c = a + 2, d = a + 3;
      index.push(a, bb, c, bb, d, c);
    }
  }
  return build(position, normal, card, index);
}

function build(position: number[], normal: number[], card: number[], index: number[]): Geometry {
  const g = new Geometry();
  g.setAttribute("position", new Attribute(new Float32Array(position), 3));
  g.setAttribute("normal", new Attribute(new Float32Array(normal), 3));
  g.setAttribute("aCard", new Attribute(new Float32Array(card), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
