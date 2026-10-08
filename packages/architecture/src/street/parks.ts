// Parks and plazas: lots given over to open space (archetypes like any other,
// so the district weights decide how many). A park is grass crossed by two
// paths, trees clear of them, benches along them, lanterns at their ends and a
// piece in the middle (a fountain, a pond, a statue, a sculpture); a plaza is
// paving, planted trees at its corners, bollards along its front, benches, LED
// poles and its piece. A district's landmark is a plaza with a landmark-scale
// piece. And murals: a painted side wall where a building turns a corner.

import { addBox, addPlant, count, pick, subPlacer, toWorld } from "../frame.ts";
import type { Build } from "../frame.ts";
import type { ArtKind, LampStyle, MassOp, PropSpot } from "../types.ts";
import { groundCover } from "./ground-cover.ts";
import { parkActivity } from "./park-activity.ts";
import { art } from "./art.ts";
import { bench, furniture, lamp, tree } from "./furniture.ts";

const LANTERN: LampStyle = { kind: "lantern", height: 3.6, arm: 0, heads: 1, head: "lampWarm", reach: 10 };
const LED_POLE: LampStyle = { kind: "arm", height: 6, arm: 0.6, heads: 1, head: "lampCool", reach: 12 };

/** A prop at a point of the build's frame, as a collision candidate. */
function prop(b: Build, kind: PropSpot["kind"], x: number, z: number, r: number, breaks: boolean): void {
  if (r <= 0) return;
  const [wx, , wz] = toWorld(b, x, 0, z);
  b.props.push({ kind, x: wx, z: wz, r, breaks });
}

function lampAt(b: Build, x: number, z: number, style: LampStyle, turn = 0): void {
  const l = lamp(subPlacer(b, x, z, turn), style);
  b.lights.push(...l.lights);
  prop(b, "lamp", x, z, l.r, true);
}

/** The centre piece, by the op's weights. */
function piece(b: Build, weights: Readonly<Partial<Record<ArtKind, number>>>): number {
  const kind = pick(b.D, "art", weights) ?? "none";
  const r = art(subPlacer(b, b.site.x, b.site.z), kind);
  prop(b, "art", b.site.x, b.site.z, r, false);
  return kind === "none" ? 0 : Math.max(r, 3);
}

export function park(b: Build, op: Extract<MassOp, { op: "park" }>): void {
  const s = b.site, pw = 1.2;
  addBox(b, 2, s.x, 0.04, s.z, s.hw, 0.04, s.hd, "grass");
  addBox(b, 2, s.x, 0.09, s.z, s.hw, 0.02, pw, "gravel");
  addBox(b, 2, s.x, 0.09, s.z, pw, 0.02, s.hd, "gravel");
  const clear = piece(b, op.art) + 1.5;
  for (const side of [-1, 1]) {
    const points: [number, number][] = [[s.x - s.hw + 1, s.z], [s.x - clear, s.z], [s.x - clear, s.z + side * clear], [s.x + clear, s.z + side * clear], [s.x + clear, s.z], [s.x + s.hw - 1, s.z]];
    if (clear < s.hw - 1 && clear < s.hd - 1) {
      for (let i = 2; i <= 4; i++) {
        const a = points[i - 1]!, c = points[i]!;
        addBox(b, 2, (a[0] + c[0]) / 2, .09, (a[1] + c[1]) / 2, Math.max(pw, Math.abs(c[0] - a[0]) / 2), .02, Math.max(pw, Math.abs(c[1] - a[1]) / 2), "gravel");
      }
      b.walks.push({ key: `${b.key}:park:${side}`, width: pw * 2, clearance: 2.4, path: points.map(([x, z]) => { const p = toWorld(b, x, .11, z); return [p[0], p[2]]; }) });
    }
  }

  groundCover(b, s, (x, z, r) => Math.abs(x - s.x) > pw + r && Math.abs(z - s.z) > pw + r && Math.hypot(x - s.x, z - s.z) > clear + pw + r);
  for (let k = 0; k < 12; k++) {
    const side = k % 2 ? 1 : -1, along = b.D.flat("verge", k), length = .4 + b.D.u("vergeL", k) * 1.2;
    const horizontal = k < 6, x = horizontal ? s.x + along * (s.hw - length) : s.x + side * (pw + .06), z = horizontal ? s.z + side * (pw + .06) : s.z + along * (s.hd - length);
    addBox(b, 1, x, .095, z, horizontal ? length : .12, .003, horizontal ? .12 : length, "gravel");
  }
  // Trees: a few seeded spots, clear of the paths, the piece and each other, their crowns inside the park's edge.
  const n = Math.min(8, Math.max(3, Math.round((s.hw * s.hd) / 60))), trees: [number, number][] = [];
  for (let k = 0; k < n * 3 && trees.length < n; k += 1) {
    const size = 0.8 + 0.4 * b.D.u("treeS", k), r = b.D.u("treeKind", k), kind = r < 0.55 ? "tree" : r < 0.85 ? "conifer" : "bush";
    const crown = (kind === "tree" ? 3.5 : kind === "conifer" ? 2.6 : 1.4) * size;
    if (s.hw < crown + 1 || s.hd < crown + 1) continue;
    const x = s.x + b.D.flat("treeX", k) * (s.hw - crown - 0.5), z = s.z + b.D.flat("treeZ", k) * (s.hd - crown - 0.5);
    if (Math.abs(x - s.x) < pw + 1.6 || Math.abs(z - s.z) < pw + 1.6 || (x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) < (clear + pw + crown) * (clear + pw + crown)) continue;
    if (trees.some(([tx, tz]) => (tx - x) * (tx - x) + (tz - z) * (tz - z) < 36)) continue;
    trees.push([x, z]);
    prop(b, "tree", x, z, tree(b, x, z, size, kind), false);
  }
  // Undergrowth: a few bushes and flower beds by the paths, the odd tuft of grass.
  const area = s.hw * s.hd;
  for (let k = 0; k < Math.min(14, Math.round(area / 40)); k += 1) {
    const x = s.x + b.D.flat("grassX", k) * (s.hw - 1.5), z = s.z + b.D.flat("grassZ", k) * (s.hd - 1.5);
    if (Math.abs(x - s.x) < pw + 0.6 || Math.abs(z - s.z) < pw + 0.6) continue;
    const r = b.D.u("under", k);
    addPlant(b, r < 0.2 ? "bush" : r < 0.3 ? "hedge" : r < 0.55 ? "flowers" : "grass", x, 0.08, z, 0.8 + 0.4 * b.D.u("underS", k), Math.floor(b.D.u("underSeed", k) * 1e6));
  }
  // Clear lawn quadrants host a few genuine park activities, never the centre art or its paths.
  let activity = 0;
  for (let attempt = 0; attempt < 12 && activity < 2; attempt++) {
    const x = s.x+b.D.flat("parkActiveX",attempt)*(s.hw-3), z = s.z+b.D.flat("parkActiveZ",attempt)*(s.hd-3);
    if (Math.abs(x-s.x)<pw+2 || Math.abs(z-s.z)<pw+2 || Math.hypot(x-s.x,z-s.z)<clear+3) continue;
    if (parkActivity(b,x,z,activity)) activity++;
  }
  // A bench facing a path, a lantern at the far end of the other.
  bench(subPlacer(b, s.x + pw + 1, s.z + s.hd * 0.5, -Math.PI / 2));
  prop(b, "bench", s.x + pw + 1, s.z + s.hd * 0.5, 1, true);
  lampAt(b, s.x - pw - 0.6, s.z - s.hd + 1.5, LANTERN);
}

export function plaza(b: Build, op: Extract<MassOp, { op: "plaza" }>): void {
  const s = b.site;
  addBox(b, 2, s.x, 0.05, s.z, s.hw, 0.05, s.hd, "paving");
  piece(b, op.art);
  // Planted trees at its two back corners, bollards along the front, benches facing in, LED poles at the front.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x = s.x + sx * (s.hw - 2.2), z = s.z + sz * (s.hd - 2.2);
    if (sz < 0) {
      furniture(subPlacer(b, x, z), "planter");
      addPlant(b, "tree", x, 0.7, z, 0.6, Math.floor(b.D.u("plazaTree", sx * 2 + sz) * 1e6));
      prop(b, "planter", x, z, 0.9, false);
    } else lampAt(b, s.x + sx * (s.hw - 4.5), s.z + sz * (s.hd - 1), LED_POLE, Math.PI);
  }
  furniture(subPlacer(b, s.x, s.z + s.hd - 0.4), "bollards");
  prop(b, "bollards", s.x, s.z + s.hd - 0.4, 0.2, false);
  for (let k = 0; k < 1; k += 1) {
    const sx = k % 2 ? 1 : -1, z = s.z - 0.2 * s.hd;
    const x = s.x + sx * Math.min(s.hw - 1.5, 6.5);
    bench(subPlacer(b, x, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2));
    prop(b, "bench", x, z, 1, true);
  }
}

/** A mural on the building's side wall where it turns onto a road (x side 1 or -1 of its main mass). */
export function mural(b: Build, side: 1 | -1): void {
  const m = b.masses[0];
  if (!m || m.y1 < 8) return;
  const top = Math.min(m.y1 - 1.2, 16), w = m.hd * (0.55 + 0.3 * b.D.u("muralW"));
  addBox(b, 1, m.x + side * (m.hw + 0.06), (1.2 + top) / 2, m.z, 0.04, (top - 1.2) / 2, w, b.D.u("mural") < 0.5 ? "muralA" : "muralB");
}
