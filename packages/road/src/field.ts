// The road field: what the ground under a road network IS, texel by texel --
// how far from the nearest road's centre (signed: + to its right), how wide
// that road is, how far along it, and how hard it bends there. One structure
// feeds the ground shader (tarmac, lines, kerbs), the tyres (grip on and off
// the road), the AI (where the lane is) and the rules (off the route).
//
// It is SPARSE: 64 m chunks, each rasterised the first time it's asked for and
// kept -- a whole city at 2 texels a metre would be far too big, the few chunks
// round a camera are a few MB. A chunk depends only on the graph, never on which
// chunks came before it: any order, the same bytes.

import { dacos, dhypot } from "@keel-engine/core";
import type { RoadGraph } from "./graph.ts";

/** A chunk's side (m), and texels a metre. */
export const CHUNK = 64;
export const TPM = 2;
/** Texels a chunk side. */
export const CHUNK_TEXELS = CHUNK * TPM;
/** How far from a centre line the field is filled (m): beyond, "no road" (distance FAR). */
export const REACH = 34;
export const FAR = 999;

export interface FieldChunk {
  readonly cx: number;
  readonly cz: number;
  /**
   * Per texel (row-major, +x then +z), four floats: signed distance to the nearest road's centre (m, + right of its
   * way), that road's half width (negative inside a junction -- tarmac without lines), metres along it, its curvature.
   */
  readonly data: Float32Array;
  /** Per texel: the nearest road's edge id, or -1. */
  readonly edge: Int32Array;
}

/** What the field says at a point, exactly (not from a texel): the nearest road and where on it. */
export interface RoadAt {
  readonly edge: number;
  readonly d: number;
  readonly s: number;
  readonly half: number;
  readonly curve: number;
  /** Inside a junction (where roads cross: no lines, every way open). */
  readonly junction: boolean;
}

export interface RoadField {
  readonly graph: RoadGraph;
  /** A chunk by its grid coordinates (made once, then kept). */
  chunk(cx: number, cz: number): FieldChunk;
  /** The nearest road at a point, or null past REACH of any road. */
  at(x: number, z: number): RoadAt | null;
  /** Chunks made so far. */
  readonly made: number;
}

/** Segment index: per chunk key, [edge, sample] pairs of every segment within REACH of that chunk. */
function indexSegments(g: RoadGraph): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (const e of g.edges) {
    const p = e.path, L = p.length, segs = p.closed ? L : L - 1;
    for (let i = 0; i < segs; i += 1) {
      const j = (i + 1) % L;
      const r = REACH + e.half;
      const cx0 = Math.floor((Math.min(p.x[i]!, p.x[j]!) - r) / CHUNK), cx1 = Math.floor((Math.max(p.x[i]!, p.x[j]!) + r) / CHUNK);
      const cz0 = Math.floor((Math.min(p.z[i]!, p.z[j]!) - r) / CHUNK), cz1 = Math.floor((Math.max(p.z[i]!, p.z[j]!) + r) / CHUNK);
      for (let cz = cz0; cz <= cz1; cz += 1) for (let cx = cx0; cx <= cx1; cx += 1) {
        const k = `${cx},${cz}`;
        let list = idx.get(k);
        if (!list) { list = []; idx.set(k, list); }
        list.push(e.id, i);
      }
    }
  }
  return idx;
}

/** Junctions: where three or more roads meet (or two of different classes), and how far round them no lines are drawn. */
function junctionsOf(g: RoadGraph): { x: number; z: number; r2: number }[] {
  const out: { x: number; z: number; r2: number }[] = [];
  g.nodes.forEach((n, i) => {
    const es = g.at[i]!.map((id) => g.edges[id]!);
    const ends = es.reduce((a, e) => a + (e.a === e.b ? 0 : 1), 0);
    if (ends < 3 && !(ends === 2 && es[0]!.cls !== es[1]?.cls)) return;
    const r = Math.max(...es.map((e) => e.half)) + 1.5;
    out.push({ x: n.x, z: n.z, r2: r * r });
  });
  return out;
}

export function roadField(graph: RoadGraph): RoadField {
  const segs = indexSegments(graph);
  const junctions = junctionsOf(graph);
  const chunks = new Map<string, FieldChunk>();
  // (The junctions by chunk -- every chunk each one's round reaches into -- so a lookup only tries the few near it.)
  const near = new Map<string, { x: number; z: number; r2: number }[]>();
  for (const j of junctions) {
    const r = Math.sqrt(j.r2);
    for (let cz = Math.floor((j.z - r) / CHUNK); cz <= Math.floor((j.z + r) / CHUNK); cz += 1) for (let cx = Math.floor((j.x - r) / CHUNK); cx <= Math.floor((j.x + r) / CHUNK); cx += 1) {
      const k = `${cx},${cz}`, list = near.get(k);
      if (list) list.push(j); else near.set(k, [j]);
    }
  }
  const inJunction = (x: number, z: number): boolean => (near.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`) ?? []).some((j) => (x - j.x) ** 2 + (z - j.z) ** 2 < j.r2);

  /** The nearest segment to a point among a chunk's list: [dist2, edge, sample, t] (ties to the lower edge, then sample). */
  const nearest = (list: readonly number[], px: number, pz: number): [number, number, number, number] => {
    let bd = Infinity, be = -1, bi = 0, bt = 0;
    for (let n = 0; n < list.length; n += 2) {
      const e = graph.edges[list[n]!]!, i = list[n + 1]!, p = e.path, j = (i + 1) % p.length;
      const ax = p.x[i]!, az = p.z[i]!, ex = p.x[j]! - ax, ez = p.z[j]! - az, e2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / e2));
      const qx = px - (ax + ex * t), qz = pz - (az + ez * t);
      // (Measured from the road's EDGE, so a wide road wins its own verge over a narrow one's centre.)
      const dist = Math.sqrt(qx * qx + qz * qz) - e.half;
      if (dist < bd || (dist === bd && (e.id < be || (e.id === be && i < bi)))) { bd = dist; be = e.id; bi = i; bt = t; }
    }
    return [bd, be, bi, bt];
  };
  const describe = (px: number, pz: number, e: number, i: number, t: number): RoadAt => {
    const edge = graph.edges[e]!, p = edge.path, j = (i + 1) % p.length;
    const ax = p.x[i]!, az = p.z[i]!, ex = p.x[j]! - ax, ez = p.z[j]! - az, len = Math.sqrt(ex * ex + ez * ez) || 1;
    const qx = px - (ax + ex * t), qz = pz - (az + ez * t);
    // (Signed by the segment's own heading: + to the right of the road's way.)
    const side = (qx * ez - qz * ex) / len >= 0 ? 1 : -1;
    return { edge: e, d: Math.sqrt(qx * qx + qz * qz) * side, s: i + t, half: edge.half, curve: p.curve[i]!, junction: inJunction(px, pz) };
  };

  const make = (cx: number, cz: number): FieldChunk => {
    const n = CHUNK_TEXELS, data = new Float32Array(n * n * 4), edge = new Int32Array(n * n).fill(-1);
    const list = segs.get(`${cx},${cz}`) ?? [];
    for (let v = 0; v < n; v += 1) for (let u = 0; u < n; u += 1) {
      const k = v * n + u, px = cx * CHUNK + (u + 0.5) / TPM, pz = cz * CHUNK + (v + 0.5) / TPM;
      data[k * 4] = FAR;
      if (!list.length) continue;
      const [dist, e, i, t] = nearest(list, px, pz);
      if (e < 0 || dist > REACH) continue;
      const r = describe(px, pz, e, i, t);
      data[k * 4] = r.d; data[k * 4 + 1] = r.junction ? -r.half : r.half; data[k * 4 + 2] = r.s; data[k * 4 + 3] = r.curve;
      edge[k] = e;
    }
    return { cx, cz, data, edge };
  };

  return {
    graph,
    chunk(cx, cz) {
      const k = `${cx},${cz}`;
      let c = chunks.get(k);
      if (!c) { c = make(cx, cz); chunks.set(k, c); }
      return c;
    },
    at(x, z) {
      const list = segs.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`);
      if (!list) return null;
      const [dist, e, i, t] = nearest(list, x, z);
      return e < 0 || dist > REACH ? null : describe(x, z, e, i, t);
    },
    get made() { return chunks.size; },
  };
}

/** A dense field over a window, all at once (a ground's texture): the same four floats a texel as a chunk's, and its edges. */
export interface FieldWindow {
  readonly x0: number;
  readonly z0: number;
  readonly width: number;
  readonly height: number;
  readonly tpm: number;
  readonly data: Float32Array;
  readonly edge: Int32Array;
}

/**
 * Rasterise a graph's roads into a window [x0, z0, x0 + width / tpm, z0 + height / tpm] -- road by road, each segment
 * only touching the texels within `reach` of it, so a whole city is quick. Texels past every road's reach say FAR.
 * Nearest by distance from the road's edge (a wide road wins its own verge); ties to the lower edge, then sample.
 */
export function fieldWindow(graph: RoadGraph, x0: number, z0: number, width: number, height: number, tpm = 1, reach = REACH): FieldWindow {
  const steps = fieldWindowSteps(graph, x0, z0, width, height, tpm, reach);
  for (;;) { const r = steps.next(); if (r.done) return r.value; }
}

/**
 * fieldWindow a road at a time, for a caller that must keep a frame going while a whole city's is made: it yields how
 * far through the roads it is (0..1) after each one, and returns the window. Drained in one go it is fieldWindow.
 */
export function* fieldWindowSteps(graph: RoadGraph, x0: number, z0: number, width: number, height: number, tpm = 1, reach = REACH, yieldEvery = 1): Generator<number, FieldWindow, void> {
  const n = width * height, data = new Float32Array(n * 4), edge = new Int32Array(n).fill(-1), best = new Float64Array(n).fill(Infinity);
  for (let k = 0; k < n; k += 1) data[k * 4] = FAR;
  const junctions = junctionsOf(graph);
  // (Each segment sweeps only its own strip -- the texels whose nearest point on it lies along it, out to its reach --
  // widened at a bend by what the turn opens on its outside, and by the whole reach at an open road's ends. The same
  // texels win the same way as a box round every segment would give, at a fraction of the visits.)
  const seen = new Int32Array(n).fill(-1);
  let stamp = 0, roads = 0;
  for (const e of graph.edges) {
    const p = e.path, L = p.length, segs = p.closed ? L : L - 1, r = reach + e.half;
    const turnAt = (i: number): number => {
      if (!p.closed && (i <= 0 || i >= L - 1)) return Infinity;
      const a = (i - 1 + L) % L, b = i % L, c = (i + 1) % L;
      const ux = p.x[b]! - p.x[a]!, uz = p.z[b]! - p.z[a]!, vx = p.x[c]! - p.x[b]!, vz = p.z[c]! - p.z[b]!;
      const lu = dhypot(ux, uz) || 1, lv = dhypot(vx, vz) || 1;
      return dacos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv))));
    };
    for (let i = 0; i < segs; i += 1) {
      const j = (i + 1) % L;
      const ax = p.x[i]!, az = p.z[i]!, ex = p.x[j]! - ax, ez = p.z[j]! - az;
      // The sweep extends by at most r+2 along the segment and r+1.5/tpm
      // across it. Reject a segment only when even that expanded box cannot
      // touch this window; tile rasters then produce the same winning texels.
      const margin = 2 * r + 3 + 3 / tpm;
      if (Math.max(ax, ax + ex) + margin < x0 || Math.min(ax, ax + ex) - margin > x0 + width / tpm ||
          Math.max(az, az + ez) + margin < z0 || Math.min(az, az + ez) - margin > z0 + height / tpm) continue;
      const e2 = ex * ex + ez * ez || 1, len = Math.sqrt(e2);
      const dx = ex / len, dz = ez / len, nx = -dz, nz = dx;
      const back = Math.min(r + 2, r * Math.min(2, turnAt(i)) + 2), ahead = Math.min(r + 2, r * Math.min(2, turnAt(j)) + 2);
      stamp += 1;
      const step = 0.5 / tpm, span = r + 1.5 / tpm;
      for (let a = -back; a <= len + ahead; a += step) {
        for (let b = -span; b <= span; b += step) {
          const u = Math.floor((ax + dx * a + nx * b - x0) * tpm), v = Math.floor((az + dz * a + nz * b - z0) * tpm);
          if (u < 0 || v < 0 || u >= width || v >= height) continue;
          const k = v * width + u;
          if (seen[k] === stamp) continue;
          seen[k] = stamp;
          const px = x0 + (u + 0.5) / tpm, pz = z0 + (v + 0.5) / tpm;
          const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / e2));
          const qx = px - (ax + ex * t), qz = pz - (az + ez * t), dist = Math.sqrt(qx * qx + qz * qz), fromEdge = dist - e.half;
          if (fromEdge > reach) continue;
          const prev = edge[k]!;
          if (fromEdge > best[k]! || (fromEdge === best[k]! && prev >= 0 && prev < e.id)) continue;
          best[k] = fromEdge; edge[k] = e.id;
          const side = (qx * ez - qz * ex) / len >= 0 ? 1 : -1;
          data[k * 4] = dist * side; data[k * 4 + 1] = e.half; data[k * 4 + 2] = i + t; data[k * 4 + 3] = p.curve[i]!;
        }
      }
    }
    roads += 1;
    if (roads % yieldEvery === 0 || roads === graph.edges.length) yield roads / graph.edges.length;
  }
  // Junctions last, each only over the texels round it: the road's width goes negative there (tarmac, no lines).
  for (const q of junctions) {
    const r = Math.sqrt(q.r2);
    const u0 = Math.max(0, Math.floor((q.x - r - x0) * tpm)), u1 = Math.min(width - 1, Math.ceil((q.x + r - x0) * tpm));
    const v0 = Math.max(0, Math.floor((q.z - r - z0) * tpm)), v1 = Math.min(height - 1, Math.ceil((q.z + r - z0) * tpm));
    for (let v = v0; v <= v1; v += 1) for (let u = u0; u <= u1; u += 1) {
      const px = x0 + (u + 0.5) / tpm, pz = z0 + (v + 0.5) / tpm, k = v * width + u;
      if (edge[k]! >= 0 && (px - q.x) ** 2 + (pz - q.z) ** 2 < q.r2) data[k * 4 + 1] = -Math.abs(data[k * 4 + 1]!);
    }
  }
  return { x0, z0, width, height, tpm, data, edge };
}
