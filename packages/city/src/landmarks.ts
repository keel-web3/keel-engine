// Landmarks: the places a city is built AROUND, rather than on top of.
//
// A game's big set pieces -- a speedway, a plaza, a port, a stadium -- are not buildings on a lot. They take a whole
// block, they have their own ground, and nothing of the ordinary city belongs inside them. The difference between a
// landmark and a scene dropped at a coordinate is entirely a matter of ORDER: land claimed before the lots are laid
// is land the city grows around, and land claimed afterwards has somebody's lamp post through the middle of it.
//
// So a city is asked what it wants before it cuts its lots. A want says how much ground it needs, what sort of
// district it belongs in, and what road it has to front; this picks the block that suits it best, and `cutBlocks`
// then lays no lots there at all. What comes back is the ground itself -- where it is, how big, which way it faces,
// and where the road meets it -- which is everything a game needs to stand its own place on it.
//
// The choice is a pure function of the city's seed, so every machine claims the same block for the same landmark.

import { datan2, dcos, dhypot, dsin } from "@keel-engine/core";
import type { RoadClass, RoadGraph } from "@keel-engine/road";
import type { Block, CitySite, District, Landmark, LandmarkWant } from "./types.ts";

/**
 * How much of what it asked for a block has to offer, tried in order: the full size first, and then smaller, so a
 * city that can hold a full one gets a full one and a tight city gets a tight one rather than nothing at all. It
 * never goes below half -- half a speedway is not a speedway.
 */
const FITS = [1, 0.8, 0.65, 0.5] as const;
/** Road classes, biggest first: what "at least this class" means. */
const CLASS_RANK: readonly RoadClass[] = ["highway", "arterial", "street", "alley"];
const rankOf = (cls: RoadClass): number => {
  const i = CLASS_RANK.indexOf(cls);
  return i < 0 ? CLASS_RANK.length : i;
};

const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * A block's box, measured along its OWN longest side: where its middle is, how far it reaches along that side and
 * how far back across it.
 *
 * Along the block and not across it, because that is how anything big stands on one -- a venue lies down the length
 * of its block. Measuring it on the city's grid instead swaps length for depth on half the blocks in the city and
 * rejects ground that would have fitted perfectly.
 */
function boxOf(corners: readonly (readonly [number, number])[]): { x: number; z: number; hw: number; hd: number; yaw: number } {
  const xs = corners.map((c) => c[0]), zs = corners.map((c) => c[1]);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2, z = (Math.min(...zs) + Math.max(...zs)) / 2;
  let longest = 0, yaw = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!, b = corners[(i + 1) % corners.length]!;
    const d = dhypot(b[0] - a[0], b[1] - a[1]);
    if (d > longest) { longest = d; yaw = datan2(b[0] - a[0], b[1] - a[1]); }
  }
  let hw = 0, hd = 0;
  const fx = dsin(yaw), fz = dcos(yaw), rx = dcos(yaw), rz = -dsin(yaw);
  for (const [cx, cz] of corners) {
    const dx = cx - x, dz = cz - z;
    hw = Math.max(hw, Math.abs(dx * fx + dz * fz));
    hd = Math.max(hd, Math.abs(dx * rx + dz * rz));
  }
  return { x, z, hw, hd, yaw };
}

/** The nearest point on an edge to (x, z), and how far away it is. */
function nearestOn(g: RoadGraph, edge: number, x: number, z: number): { x: number; z: number; yaw: number; d: number } | null {
  const e = g.edges[edge];
  if (!e) return null;
  const a = g.nodes[e.a], b = g.nodes[e.b];
  if (!a || !b) return null;
  const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
  const px = a.x + dx * t, pz = a.z + dz * t;
  return { x: px, z: pz, yaw: datan2(dx, dz), d: dhypot(x - px, z - pz) };
}

/**
 * Claim a block for each want, best first, before any lots are laid.
 *
 * A block suits a want when it is big enough for the ground it needs, it is in a district the want likes, and a road
 * of the right class runs past it. Between blocks that all suit, the one with the most room wins, then the one
 * furthest out of the middle of the city (a speedway does not belong downtown), and a little of the seed breaks ties
 * so two cities with the same shape do not put everything in the same place.
 *
 * A want that nothing suits is simply not claimed: a small city has no room for a speedway, and saying so is better
 * than wedging one in. Two wants never take the same block.
 */
export function claimLandmarks(
  site: CitySite,
  graph: RoadGraph,
  blocks: readonly Block[],
  districts: readonly District[],
  blockDistrict: ArrayLike<number>,
  wants: readonly LandmarkWant[],
): Landmark[] {
  if (!wants.length) return [];
  const taken = new Set<number>();
  const out: Landmark[] = [];
  for (const want of wants) {
    /** The nearest road of the class this want needs, to a point. */
    const gateFor = (x: number, z: number): { edge: number; x: number; z: number; yaw: number; d: number } | null => {
      const need = rankOf(want.road ?? "alley");
      let best: { edge: number; x: number; z: number; yaw: number; d: number } | null = null;
      for (const e of graph.edges) {
        if (rankOf(e.cls) > need) continue;
        const near = nearestOn(graph, e.id, x, z);
        if (!near) continue;
        if (!best || near.d < best.d) best = { edge: e.id, ...near };
      }
      return best;
    };
    let claim: Landmark | null = null;
    // The full size first, then smaller: a city that can hold a full one gets a full one.
    for (const fit of FITS) {
      let best: { score: number; mark: Landmark } | null = null;
      for (const block of blocks) {
        if (taken.has(block.id)) continue;
        const kind = districts[blockDistrict[block.id] ?? 0]?.kind;
        if (want.districts?.length && (!kind || !want.districts.includes(kind))) continue;
        const box = boxOf(block.corners);
        if (box.hw < want.halfL * fit || box.hd < want.halfD * fit) continue;
        const gate = gateFor(box.x, box.z);
        if (!gate) continue;
        if (gate.d > box.hw + box.hd) continue;
        // Room to spare, out of the middle, and a nudge off the seed so identical cities differ.
        const room = Math.min(3, (box.hw * box.hd) / Math.max(1, want.halfL * want.halfD));
        const out2 = dhypot(box.x, box.z) / Math.max(1, site.core);
        const score = room * 240 + Math.min(1, out2) * 300 - gate.d * 0.6 + (hashOf(`${site.seed}:${want.kind}:${block.id}`) % 40);
        if (best && score <= best.score) continue;
        best = {
          score,
          mark: {
            kind: want.kind,
            name: want.name,
            // The ground it gets: what it asked for, or the block, whichever is smaller.
            obb: { x: box.x, z: box.z, hw: Math.min(want.halfL, box.hw), hd: Math.min(want.halfD, box.hd), yaw: gate.yaw },
            block: block.id,
            gate: { edge: gate.edge, x: gate.x, z: gate.z, yaw: gate.yaw },
          },
        };
      }
      if (best) { claim = best.mark; break; }
    }
    if (!claim) continue;
    taken.add(claim.block);
    out.push(claim);
  }
  return out;
}
