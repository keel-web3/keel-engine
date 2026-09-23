// Crossed cards: the cheap foliage primitive for the live mesh pass. Each spot
// is two or three upright quads crossed at its middle -- the "criss-cross"
// billboard -- and the G-buffer pass cuts each one to a leafy silhouette
// (mesh.ts CARD_GLSL: grass blades, a bush, a leafy clump, reeds) measured on
// the card itself, so it never swims, and roughened on the card's own leaf
// texels so it reads as pixel-art foliage. What isn't leaf is never drawn:
// whatever stands behind shows through, and the sun's pass casts the same cutout.
//
// Thousands of tufts are ONE mesh, drawn in one call and painted through the
// looks like any other thing (the spot's slot picks its paint): far cheaper
// than baked sprites once there are more than a handful.
//
//   const grass = cardsMesh(spots.map(([x, z]) => ({ x, y: groundY(x, z), z, height: 0.5, kind: "grass" })));
//   sr.setMesh("verge:grass", grass);
//   sr.drawMeshes(view, [{ mesh: "verge:grass", matrix: meshMatrix(), look }], style);

import { bodySpace, meshBounds } from "./mesh.ts";
import type { LookMesh } from "./mesh.ts";

/** A card's silhouette: tapering grass blades, a lumpy bush, a leafy clump with holes, tall reeds with seed heads. */
export const CARD_KINDS = ["grass", "bush", "leafy", "reed"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** One tuft: where its foot is, how tall and wide (m), which way it's turned, its slot (its paint), its silhouette. */
export interface CardSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  /** Across each card (default: its height -- a bush -- or 0.8 x it for grass and reeds). */
  readonly width?: number | undefined;
  /** Its turn about y (radians; default from its seed, so a field of them doesn't line up). */
  readonly yaw?: number | undefined;
  /** Its slot (default the options' slot). */
  readonly slot?: number | undefined;
  readonly kind?: CardKind | undefined;
  /** Which one of its kind (0..1023; default from its position): its blades, lumps and leaf holes. */
  readonly seed?: number | undefined;
}

export interface CardsOptions {
  /** Cards a spot: 2 (a cross) or 3 (a star, fuller from every side; default). */
  readonly cards?: 2 | 3 | undefined;
  readonly slot?: number | undefined;
  readonly kind?: CardKind | undefined;
  /** How far a card's normal leans out from its middle, 0 (flat cards) .. 1 (a round bush; default 0.7). */
  readonly round?: number | undefined;
  /** Body-space bounds (LookMeshOptions.bounds). */
  readonly bounds?: readonly [number, number, number, number, number, number] | undefined;
}

// (A position's own seed: the same spot is the same tuft on every machine.)
const seedOf = (x: number, z: number): number => {
  let h = Math.imul(Math.round(x * 100) | 0, 0x9e3779b1) ^ Math.imul(Math.round(z * 100) | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) % 1024;
};

/**
 * Spots of crossed cards as one LookMesh. Each card's surface coordinate is packed as mesh.ts CARD_GLSL reads it (u:
 * across + 2 x (seed x 4 + kind); v: -(1 + up)), each spot is its own part (so tufts outline against each other), and
 * a card's normals lean out from the spot's middle and up, so a tuft shades round instead of as flat boards.
 */
export function cardsMesh(spots: readonly CardSpot[], options: CardsOptions = {}): LookMesh {
  const cards = options.cards === 2 ? 2 : 3, round = Math.max(0, Math.min(1, options.round ?? 0.7));
  const nv = spots.length * cards * 4, ni = spots.length * cards * 6;
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), attrs = new Float32Array(nv * 4), indices = new Uint32Array(ni);
  let v = 0, i = 0;
  spots.forEach((s, part) => {
    const kind = Math.max(0, CARD_KINDS.indexOf(s.kind ?? options.kind ?? "grass"));
    const seed = Math.max(0, Math.min(1023, Math.floor(s.seed ?? seedOf(s.x, s.z))));
    const id = seed * 4 + kind, slot = s.slot ?? options.slot ?? 0;
    const hw = (s.width ?? (kind === 1 || kind === 2 ? s.height : s.height * 0.8)) / 2;
    const yaw0 = s.yaw ?? (seed / 1024) * Math.PI;
    for (let c = 0; c < cards; c += 1) {
      const a = yaw0 + (c * Math.PI) / cards, ca = Math.cos(a), sa = Math.sin(a);
      const n0 = [-sa, 0, ca]; // (the card's face)
      const base = v;
      for (const [side, up] of [[-1, 0], [1, 0], [1, 1], [-1, 1]] as const) {
        const o = v * 3;
        positions[o] = s.x + ca * hw * side; positions[o + 1] = s.y + s.height * up; positions[o + 2] = s.z + sa * hw * side;
        // (Out from the middle along the card, a little of its face, and up.)
        const nx = ca * side * round + n0[0]! * (1 - round) * 0.5, nz = sa * side * round + n0[2]! * (1 - round) * 0.5, ny = 0.8 + 0.4 * up;
        const l = Math.hypot(nx, ny, nz) || 1;
        normals[o] = nx / l; normals[o + 1] = ny / l; normals[o + 2] = nz / l;
        attrs.set([slot, (side + 1) / 2 + 2 * id, -(1 + up), part & 65535], v * 4);
        v += 1;
      }
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
      i += 6;
    }
  });
  return { positions, normals, attrs, bodies: bodySpace(positions, options.bounds ?? meshBounds(positions)), indices };
}
