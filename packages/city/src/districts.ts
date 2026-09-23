// Districts: which part of town a block is -- downtown towers round the
// middle, a ring of midtown, an old brick quarter in one seeded sector, docks
// along the water, industry toward the rivers and hills, a commercial strip out
// along the avenues, suburbs past all of it. Each block scores every kind (by
// how far out it is and which way it faces), plus a little seeded noise; the
// odd one out adopts its neighbours' kind, so districts come out in runs; a
// district is then one connected run of a kind, with its own character drawn.

import { datan2 } from "@keel-engine/core";
import { drawsFor } from "./site.ts";
import type { Block, CitySite, District, DistrictKind, EdgeTrait } from "./types.ts";

export const DISTRICT_KINDS: readonly DistrictKind[] = ["core", "midtown", "oldtown", "industrial", "docks", "strip", "suburb"];

/** Per kind: how built up it is, and how run down it tends to be (a district draws around these). */
const CHARACTER: Readonly<Record<DistrictKind, { readonly density: number; readonly decay: number }>> = {
  core: { density: 1, decay: 0.02 }, midtown: { density: 0.75, decay: 0.06 }, oldtown: { density: 0.55, decay: 0.22 },
  industrial: { density: 0.3, decay: 0.28 }, docks: { density: 0.25, decay: 0.3 }, strip: { density: 0.2, decay: 0.16 },
  suburb: { density: 0.15, decay: 0.05 },
};
/** The synthwave set a district's neon is drawn from (hue, degrees). */
const NEON = [322, 290, 192, 45, 150, 12, 262, 175] as const;
const TAU = Math.PI * 2;

/** How far apart two bearings are (0..pi). */
const apart = (a: number, b: number): number => { const d = (((a - b) % TAU) + TAU) % TAU; return d > Math.PI ? TAU - d : d; };
const deg = (d: number): number => (d * Math.PI) / 180;

/** Where a block's middle is. */
export const blockCentre = (b: Block): [number, number] => {
  let x = 0, z = 0;
  for (const [cx, cz] of b.corners) { x += cx; z += cz; }
  return [x / b.corners.length, z / b.corners.length];
};

/** Blocks that touch: the same lattice cell (a street between them) or the next cell over. */
function neighbours(blocks: readonly Block[]): number[][] {
  const byCell = new Map<string, number[]>();
  for (const b of blocks) { const k = `${b.cell[0]},${b.cell[1]}`; const l = byCell.get(k) ?? []; l.push(b.id); byCell.set(k, l); }
  return blocks.map((b) => {
    const [i, j] = b.cell, out: number[] = [];
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) for (const o of byCell.get(`${i + di},${j + dj}`) ?? []) if (o !== b.id) out.push(o);
    return out;
  });
}

/**
 * The city's districts, and each block's (an index into them). Every city has a downtown (the block nearest the middle
 * always is one); the rest follow from the site: docks only where there's water, industry toward a river or the hills.
 */
export function districtsOf(site: CitySite, blocks: readonly Block[]): { districts: District[]; blockDistrict: Int32Array } {
  const D = drawsFor(site.seed, "districts");
  const edge = (...traits: EdgeTrait[]) => site.edges.find((e) => traits.includes(e.trait));
  const water = edge("ocean", "river");
  const ocean = edge("ocean");
  const rough = edge("river", "mountain");
  // (Industry faces a river or the hills; failing that, it turns its back on the sea; failing that, anywhere.)
  const industry = rough ? rough.bearing : ocean ? ocean.bearing + Math.PI : D.u("industry") * TAU;
  const avenue = D.u("strip") * TAU;
  // (How far out a block is, as a share of the farthest block's distance: a small city still has its outskirts.)
  let reach = 1;
  for (const b of blocks) { const [x, z] = blockCentre(b); reach = Math.max(reach, Math.sqrt(x * x + z * z)); }
  // The old town's sector: seeded, and widened until it holds a few blocks (every city has its old quarter).
  const old = D.u("oldtown") * TAU;
  let oldHalf = deg(30 + 20 * D.u("oldWidth"));
  const inOld = (b: Block): boolean => {
    const [x, z] = blockCentre(b), r = Math.sqrt(x * x + z * z) / reach;
    return r > 0.2 && r < 0.78 && apart(datan2(x, z), old) < oldHalf;
  };
  while (oldHalf < deg(100) && blocks.filter(inOld).length < 3) oldHalf += deg(12);
  const score = (b: Block): Record<DistrictKind, number> => {
    const [x, z] = blockCentre(b);
    const r = Math.sqrt(x * x + z * z) / reach, at = datan2(x, z);
    return {
      core: r < 0.34 ? 1.25 - r * 2 : 0,
      midtown: Math.max(0, 1 - Math.abs(r - 0.44) / 0.22),
      oldtown: inOld(b) ? 1.15 : 0,
      industrial: r > 0.5 && apart(at, industry) < deg(50) ? 1.1 : 0,
      docks: water && r > 0.62 && apart(at, water.bearing) < deg(40) ? 1.3 : 0,
      strip: r > 0.64 && Math.min(apart(at, avenue), apart(at, avenue + Math.PI)) < deg(24) ? 1.05 : 0,
      suburb: r > 0.66 ? 0.62 + (r - 0.66) * 2 : 0,
    };
  };
  const first: DistrictKind[] = blocks.map((b) => {
    const s = score(b);
    let best: DistrictKind = "suburb", top = -Infinity;
    for (const k of DISTRICT_KINDS) { const v = s[k] + D.flat("district", b.id) * 0.15 + (s[k] > 0 ? 0 : -9); if (v > top) { top = v; best = k; } }
    return best;
  });
  // (The block nearest the middle is always downtown.)
  let middle = 0, near = Infinity;
  for (const b of blocks) { const [x, z] = blockCentre(b); if (x * x + z * z < near) { near = x * x + z * z; middle = b.id; } }
  if (blocks.length) first[middle] = "core";
  // The odd one out takes its neighbours' majority, so districts are runs, not speckle -- unless it's the last of its
  // kind in town (a lone old-town block is still the old town).
  const nb = neighbours(blocks);
  const total = new Map<DistrictKind, number>();
  for (const k of first) total.set(k, (total.get(k) ?? 0) + 1);
  const kind = first.map((k, id) => {
    if (id === middle || total.get(k) === 1 || nb[id]!.some((o) => first[o] === k)) return k;
    const count = new Map<DistrictKind, number>();
    for (const o of nb[id]!) count.set(first[o]!, (count.get(first[o]!) ?? 0) + 1);
    let best = k, most = 1;
    for (const kk of DISTRICT_KINDS) { const c = count.get(kk) ?? 0; if (c > most) { most = c; best = kk; } }
    if (best !== k) { total.set(k, total.get(k)! - 1); total.set(best, (total.get(best) ?? 0) + 1); }
    return best;
  });
  // A district: one connected run of a kind.
  const blockDistrict = new Int32Array(blocks.length).fill(-1);
  const districts: District[] = [];
  for (const b of blocks) {
    if (blockDistrict[b.id]! >= 0) continue;
    const id = districts.length, k = kind[b.id]!, members: number[] = [], stack = [b.id];
    blockDistrict[b.id] = id;
    while (stack.length) {
      const n = stack.pop()!;
      members.push(n);
      for (const o of nb[n]!) if (blockDistrict[o]! < 0 && kind[o] === k) { blockDistrict[o] = id; stack.push(o); }
    }
    members.sort((p, q) => p - q);
    const Dd = drawsFor(site.seed, `district|${members[0]}`);
    const c = CHARACTER[k], wealth = Dd.u("wealth");
    const hueCount = 2 + Math.floor(Dd.u("hues") * 3), start = Math.floor(Dd.u("hue0") * NEON.length);
    const step = 1 + Math.floor(Dd.u("hueStep") * 3);
    const hues = Array.from({ length: hueCount }, (_, n) => NEON[(start + n * step) % NEON.length]!);
    districts.push({
      id, kind: k, blocks: members, hues,
      density: Math.min(1, c.density * (0.85 + 0.3 * Dd.u("density"))),
      wealth,
      decay: Math.min(0.6, c.decay * (1.6 - wealth) * (0.6 + 0.8 * Dd.u("decay"))),
    });
  }
  return { districts, blockDistrict };
}
