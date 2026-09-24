// Blocks and lots: the land between the roads, cut into plots to build on. A
// block is a lattice cell (split in two where a street runs through it); its
// lots are a dumb box split -- inset from the kerbs by the road and a
// pavement, cut along its length into frontages, back to back where it's deep.
// How wide a frontage runs and how tall it may rise is its district's: narrow
// walk-up lots in the old town, big tower sites downtown, deep low lots out on
// the strip; now and then a garage or an empty yard.

import { dcos, dsin } from "@keel-engine/core";
import { roadField } from "@keel-engine/road";
import type { RoadGraph } from "@keel-engine/road";
import type { Network } from "./arterials.ts";
import { districtsOf } from "./districts.ts";
import { sidewalkReach } from "./sidewalks.ts";
import { drawsFor } from "./site.ts";
import { claimLandmarks } from "./landmarks.ts";
import type { Block, CitySite, District, DistrictKind, Landmark, LandmarkWant, Lot, LotFront, LotUse } from "./types.ts";

/** Clear ground between a sidewalk's back edge and a lot (m). */
const MARGIN = 0.6;

/**
 * How far past a road's edge the lots' own probes look (m), and the cells they're bucketed in: wider than any pavement
 * and MARGIN (SIDEWALK: 5 m at most), so for "is this on a road, or its pavement?" the answer is the road field's own.
 */
const KERB_LOOK = 8, KERB_CELL = 8;

/**
 * The road a point is on or beside, as keel/road's field would say it -- the nearest by distance from its edge, ties to
 * the lower edge then sample -- whenever that road's edge is within KERB_LOOK (else null, or a road further off than
 * that): a fine bucket grid of the segments, so a big city's thousands of lots each probe a few dozen, not thousands.
 */
function kerbIndex(g: RoadGraph): (x: number, z: number) => { edge: number; d: number; half: number } | null {
  // (Each road's line in runs of RUN segments, a run bucketed into every cell its box -- widened by the road's half and
  // KERB_LOOK -- touches. Keys are numbers: cells well inside +-2^15 of the middle, which any city is.)
  const RUN = 4, key = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);
  const cells = new Map<number, number[]>();
  for (const e of g.edges) {
    const p = e.path, L = p.length, segs = p.closed ? L : L - 1, r = e.half + KERB_LOOK;
    for (let i0 = 0; i0 < segs; i0 += RUN) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = i0; i <= Math.min(segs, i0 + RUN); i += 1) { const k = i % L; x0 = Math.min(x0, p.x[k]!); x1 = Math.max(x1, p.x[k]!); z0 = Math.min(z0, p.z[k]!); z1 = Math.max(z1, p.z[k]!); }
      for (let cz = Math.floor((z0 - r) / KERB_CELL); cz <= Math.floor((z1 + r) / KERB_CELL); cz += 1) {
        for (let cx = Math.floor((x0 - r) / KERB_CELL); cx <= Math.floor((x1 + r) / KERB_CELL); cx += 1) {
          const k = key(cx, cz), list = cells.get(k);
          if (list) list.push(e.id, i0); else cells.set(k, [e.id, i0]);
        }
      }
    }
  }
  return (x, z) => {
    const list = cells.get(key(Math.floor(x / KERB_CELL), Math.floor(z / KERB_CELL)));
    if (!list) return null;
    let bd = Infinity, be = -1, bi = 0, bc = 0;
    for (let n = 0; n < list.length; n += 2) {
      const e = g.edges[list[n]!]!, p = e.path, segs = p.closed ? p.length : p.length - 1, i0 = list[n + 1]!;
      for (let i = i0; i < Math.min(segs, i0 + RUN); i += 1) {
        const j = (i + 1) % p.length;
        const ax = p.x[i]!, az = p.z[i]!, ex = p.x[j]! - ax, ez = p.z[j]! - az, e2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / e2));
        const qx = x - (ax + ex * t), qz = z - (az + ez * t), c = Math.sqrt(qx * qx + qz * qz), dist = c - e.half;
        if (dist < bd || (dist === bd && (e.id < be || (e.id === be && i < bi)))) { bd = dist; be = e.id; bi = i; bc = c; }
      }
    }
    return be < 0 || bd > KERB_LOOK ? null : { edge: be, d: bc, half: g.edges[be]!.half };
  };
}

/** Per district kind: frontage widths (m, low and high) and the storeys a lot may rise to. */
const LOTS: Readonly<Record<DistrictKind, { readonly width: readonly [number, number]; readonly storeys: readonly [number, number]; readonly use: LotUse }>> = {
  core: { width: [30, 56], storeys: [14, 60], use: "tower" },
  midtown: { width: [18, 34], storeys: [6, 24], use: "block" },
  oldtown: { width: [10, 17], storeys: [3, 6], use: "block" },
  industrial: { width: [28, 54], storeys: [1, 4], use: "shop" },
  docks: { width: [36, 64], storeys: [1, 3], use: "shop" },
  strip: { width: [22, 40], storeys: [1, 2], use: "shop" },
  suburb: { width: [15, 24], storeys: [1, 3], use: "shop" },
};

/** The blocks: every lattice cell with four corners, split in two where its street runs. */
export function blocksOf(net: Network): Block[] {
  const g = net.graph, blocks: Block[] = [];
  const node = (id: number): readonly [number, number] => [g.nodes[id]!.x, g.nodes[id]!.z];
  for (const [ck, st] of net.streets) {
    const [i, j] = ck.split(",").map(Number) as [number, number];
    const A = net.lattice.get(`${i},${j}`)!, B = net.lattice.get(`${i + 1},${j}`)!, C = net.lattice.get(`${i + 1},${j + 1}`)!, Dn = net.lattice.get(`${i},${j + 1}`)!;
    const quads: (readonly [number, number])[][] = [];
    if (!st) quads.push([node(A), node(B), node(C), node(Dn)]);
    else if (st.along === "j") quads.push([node(A), node(st.from), node(st.to), node(Dn)], [node(st.from), node(B), node(C), node(st.to)]);
    else quads.push([node(A), node(B), node(st.to), node(st.from)], [node(st.from), node(st.to), node(C), node(Dn)]);
    for (const q of quads) blocks.push({ id: blocks.length, corners: q, cell: [i, j] });
  }
  return blocks;
}

export function cutBlocks(
  site: CitySite,
  net: Network,
  wants: readonly LandmarkWant[] = [],
): { blocks: Block[]; lots: Lot[]; districts: District[]; landmarks: Landmark[] } {
  const D = drawsFor(site.seed, "lots");
  const g = net.graph, field = roadField(g), kerb = kerbIndex(g);
  const blocks = blocksOf(net);
  const { districts, blockDistrict } = districtsOf(site, blocks);
  // The places the city is built AROUND, claimed before a single lot is laid: their blocks get none at all, which
  // is what makes a landmark a landmark rather than a scene standing on somebody's front garden.
  const landmarks = claimLandmarks(site, g, blocks, districts, blockDistrict, wants);
  const claimed = new Set(landmarks.map((l) => l.block));
  const lots: Lot[] = [];
  const cy = dcos(site.yaw), sy = dsin(site.yaw);
  // (World to the grid frame and back.)
  const toGrid = (x: number, z: number): [number, number] => [x * cy - z * sy, x * sy + z * cy];
  const toWorld = (gx: number, gz: number): [number, number] => [gx * cy + gz * sy, -gx * sy + gz * cy];
  /** How far back from a road's centre its sidewalk ends, at a point near it (an arterial's, if no road is found). */
  const reachAt = (x: number, z: number): number => {
    const at = field.at(x, z);
    return (at ? sidewalkReach(g.edges[at.edge]!.cls, Math.abs(at.half)) : sidewalkReach("arterial", 7.4)) + MARGIN;
  };
  /** Whether a lot's box reaches a road or its pavement anywhere round its edge. */
  const overhangs = (cx: number, cz: number, hw: number, hd: number): boolean => {
    for (let k = 0; k < 16; k += 1) {
      const t = k / 4, side = Math.floor(t), f = t - side;
      const u = side === 0 ? -hw + 2 * hw * f : side === 1 ? hw : side === 2 ? hw - 2 * hw * f : -hw;
      const v = side === 0 ? -hd : side === 1 ? -hd + 2 * hd * f : side === 2 ? hd : hd - 2 * hd * f;
      const at = kerb(cx + u * cy + v * sy, cz - u * sy + v * cy);
      if (at && at.d < sidewalkReach(g.edges[at.edge]!.cls, at.half) + MARGIN - 0.5) return true;
    }
    return false;
  };
  /** The roads a lot's faces look onto: past each face's middle, across the pavement. */
  const frontsOf = (cx: number, cz: number, hw: number, hd: number): LotFront[] => {
    const out: LotFront[] = [];
    ([[0, 1], [1, 0], [0, -1], [-1, 0]] as const).forEach(([nu, nv], face) => {
      for (let step = 4; step <= 44; step += 4) {
        const reach = (nu ? hw : hd) + step, u = nu * reach, v = nv * reach;
        const at = kerb(cx + u * cy + v * sy, cz - u * sy + v * cy);
        if (at && at.d < at.half) { out.push({ edge: at.edge, face: face as LotFront["face"], cls: g.edges[at.edge]!.cls }); return; }
      }
    });
    return out;
  };

  for (const block of blocks) {
    // (A landmark's block is its own ground. Nothing is built on it and nothing is planted on it.)
    if (claimed.has(block.id)) continue;
    const id = block.id, q = block.corners, district = blockDistrict[id]!, spec = LOTS[districts[district]!.kind];
    // The block's box in the grid frame: the rectangle inside its four corners, less the roads and pavements.
    const gq = q.map(([x, z]) => toGrid(x, z));
    // (Each side is inset by its own road's sidewalk: a street's narrower than an arterial's. Probed a quarter along
    // the side, clear of the junctions at its corners and a street's T at its middle.)
    const side = (a: number, b: number): number => reachAt(q[a]![0] * 0.75 + q[b]![0] * 0.25, q[a]![1] * 0.75 + q[b]![1] * 0.25);
    const x0 = Math.max(gq[0]![0], gq[3]![0]) + side(3, 0), x1 = Math.min(gq[1]![0], gq[2]![0]) - side(1, 2);
    const z0 = Math.max(gq[0]![1], gq[1]![1]) + side(0, 1), z1 = Math.min(gq[2]![1], gq[3]![1]) - side(2, 3);
    if (x1 - x0 < 16 || z1 - z0 < 16) continue;
    // Frontages along the longer side; two rows back to back when it's deep.
    const wide = x1 - x0 >= z1 - z0;
    const run = wide ? x1 - x0 : z1 - z0, depth = wide ? z1 - z0 : x1 - x0;
    const rows = depth > 70 ? 2 : 1;
    const [w0, w1] = spec.width;
    const made: Lot[][] = Array.from({ length: rows }, () => []);
    let at = 0, k = 0;
    while (run - at > w0 * 0.7) {
      const w = Math.min(run - at, w0 + (w1 - w0) * D.u("width", id, k));
      for (let r = 0; r < rows; r += 1) {
        const a0 = at + 1, a1 = at + w - 1, b0 = (depth / rows) * r + 1, b1 = (depth / rows) * (r + 1) - 1;
        const gx0 = wide ? x0 + a0 : x0 + b0, gx1 = wide ? x0 + a1 : x0 + b1, gz0 = wide ? z0 + b0 : z0 + a0, gz1 = wide ? z0 + b1 : z0 + a1;
        const [cx, cz] = toWorld((gx0 + gx1) / 2, (gz0 + gz1) / 2);
        const roll = D.u("use", id * 8 + r, k);
        const use: LotUse = roll < 0.04 ? "yard" : roll < 0.1 ? "garage" : spec.use;
        const height: readonly [number, number] = use === "yard" ? [0, 0] : use === "garage" ? [1, 3] : spec.storeys;
        const front = field.at(cx, cz);
        // (Roads bow: a lot is trimmed back from any kerb it would still overhang, or dropped.)
        let hw = (gx1 - gx0) / 2, hd = (gz1 - gz0) / 2;
        while (Math.min(hw, hd) > 3 && overhangs(cx, cz, hw, hd)) { hw -= 2; hd -= 2; }
        if (Math.min(hw, hd) > 3) {
          made[r]!.push({
            obb: { x: cx, z: cz, hw, hd, yaw: site.yaw }, height, use, frontage: front ? front.edge : -1, block: id,
            key: `${id}:${k}:${r}`, district, fronts: frontsOf(cx, cz, hw, hd), left: null, right: null,
          });
        }
      }
      at += w; k += 1;
    }
    // (Neighbours along each row: whoever's next either side.)
    for (const row of made) row.forEach((lot, n) => lots.push({ ...lot, left: row[n - 1]?.key ?? null, right: row[n + 1]?.key ?? null }));
  }
  return { blocks, lots, districts, landmarks };
}
