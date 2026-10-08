// KEEL's native wall-surface drawing recipe. No downloaded art or image data:
// concrete, stress fractures and climbing ivy are drawn into a bounded atlas
// once, with the core's seeded streams, pixel shapes and ordered dither.
import { createRoll, dcos, dsin, SCREENS } from "@keel-engine/core";

export const WALL_ART_WIDTH = 256, WALL_ART_HEIGHT = 128, WALL_ART_LAYERS = 4;
type Point = readonly [number, number];

// Authored ivy silhouette: pointed lobes, a lit fold, dark underside and veins.
// Digits are positions on the leaf's shade ramp; dots leave the wall visible.
const IVY = [
  ".....3.....", "....343....", "...23432...", "3..23432..3",
  "23223432232", ".233444332.", "..2334332..", ".223343322.",
  "...23332...", "....232....", ".....1.....",
] as const;

/** RG8 surface map: luminance and vegetation coverage, lit through the caller's palette. */
export function wallArtPixels(): Uint8Array {
  const W = WALL_ART_WIDTH, H = WALL_ART_HEIGHT;
  const data = new Uint8Array(W * H * WALL_ART_LAYERS * 2);
  const roll = createRoll("6b65656c2d77616c6c2d6172742d763100");
  const screen = SCREENS.bayer4.at;
  for (let tile = 0; tile < WALL_ART_LAYERS; tile++) {
    const R = roll.sub(700 + tile), base = tile * W * H * 2;
    const random = () => R.next() / 65536;
    const put = (x: number, y: number, tone: number, plant = false): void => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      // Dither is drawn in the material's own pixels, so it cannot crawl when
      // the camera moves. The live palette pass supplies the scene lighting.
      const q = Math.floor(Math.max(0, Math.min(1, tone)) * 24 + screen(x, y));
      const i = base + (y * W + x) * 2;
      data[i] = Math.round(Math.min(24, q) * 255 / 24); data[i + 1] = plant ? 255 : 0;
    };
    const line = (a: Point, b: Point, tone: number, plant = false, highlight = false): void => {
      const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      for (let i = 0; i <= n; i++) {
        const x = a[0] + dx * i / n, y = a[1] + dy * i / n;
        if (highlight) put(x + 1, y, .69);
        put(x, y, tone, plant);
      }
    };
    // Broad pours and drainage first, small aggregate second. Neighbouring
    // pixels share fields; there is no independent salt-and-pepper fill.
    const field = Array.from({ length: 17 * 9 }, random), grains = Array.from({ length: 257 }, random);
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const gx = x >> 4, gy = y >> 4, fx = (x & 15) / 16, fy = (y & 15) / 16;
      const cloud = mix(mix(field[gy * 17 + gx]!, field[gy * 17 + gx + 1]!, fx), mix(field[(gy + 1) * 17 + gx]!, field[(gy + 1) * 17 + gx + 1]!, fx), fy) - .5;
      const grain = grains[(x * 67 + y * 139) % grains.length]!;
      const foot = Math.max(0, (y - H * .7) / (H * .3));
      const drain = grains[Math.floor(x / 3) % grains.length]!;
      const wear = tile === 0 ? .25 : .75;
      put(x, y, .61 + cloud * .16 + (grain - .5) * .065 - foot * wear * .13 - Math.max(0, drain - .7) * wear * (y / H) * .3);
    }
    // A real pour joint and recessed tie holes; only the weathered variant
    // gets spreading stress cracks, with narrow secondary fractures.
    for (let y = 0; y < H; y++) { put(127, y, .43); put(128, y, .67); }
    for (const x of [25, 101, 153, 229]) for (const y of [22, 91]) { put(x, y, .34); put(x + 1, y + 1, .69); }
    if (tile === 1 || tile === 3) {
      const fracture = (points: readonly Point[], secondary = false): void => {
        for (let i = 1; i < points.length; i++) line(points[i - 1]!, points[i]!, secondary ? .39 : .26, false, !secondary);
      };
      fracture([[184, 128], [185, 114], [179, 106], [181, 97], [171, 88], [167, 78], [150, 72], [148, 59], [137, 51], [141, 38], [129, 30], [126, 15], [113, 4], [114, 0]]);
      fracture([[167, 78], [181, 74], [185, 63], [196, 55], [195, 46], [207, 38], [213, 26], [230, 20], [236, 9]], true);
      fracture([[150, 72], [138, 76], [124, 72], [113, 80], [105, 78], [98, 87], [87, 88], [82, 98]], true);
      fracture([[181, 97], [201, 100], [207, 112], [220, 117], [224, 128]], true);
      fracture([[141, 38], [152, 30], [158, 28], [167, 18]], true);
    }
    if (tile < 2) continue;

    const leaf = (cx: number, cy: number, angle: number, size: number, shade: number): void => {
      const co = dcos(angle), si = dsin(angle), extent = Math.ceil(size * 8);
      for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
        const u = Math.round((x * co + y * si) / size + 5), v = Math.round((-x * si + y * co) / size + 5);
        const mark = IVY[v]?.[u]; if (!mark || mark === ".") continue;
        const value = Number(mark);
        // A deep edge, a folded midtone, and tiny broken highlights. Leaves
        // overlap as whole drawn shapes; they are never dots on a UV grid.
        put(cx + x, cy + y, .13 + value * .069 + shade + (screen(x, y) - .5) * .028, true);
      }
    };
    // The branch graph grows from explicit roots. Every leaf is attached to a
    // branch by a petiole, and the sparsest tips keep their connected stems.
    const roots = tile === 2 ? [23, 141, 235] : [8, 42, 79, 169, 215, 250];
    const leafJobs: { x: number; y: number; angle: number; size: number; shade: number }[] = [];
    for (let root = 0; root < roots.length; root++) {
      const reach = tile === 2 ? [60, 44, 76][root]! : [126, 96, 50, 57, 94, 124][root]!;
      let p: Point = [roots[root]!, H + 2];
      const trunk: Point[] = [p];
      while (p[1] > H - reach) { p = [p[0] + (random() - .5) * 10, p[1] - 7 - random() * 5]; trunk.push(p); }
      for (let i = 1; i < trunk.length; i++) {
        const at = trunk[i]!; line(trunk[i - 1]!, at, .17, true);
        if (i < 3) line([trunk[i - 1]![0] + 1, trunk[i - 1]![1]], [at[0] + 1, at[1]], .27, true);
        for (const side of [-1, 1]) {
          if (tile === 2 && random() < .2) continue;
          let branch: Point = at;
          const length = 2 + Math.floor(random() * (tile === 2 ? 2 : 4));
          for (let j = 0; j < length; j++) {
            const next: Point = [branch[0] + side * (3 + random() * 4), branch[1] - 2 - random() * 4];
            line(branch, next, .19, true); branch = next;
            for (const face of [-1, 1]) {
              const x = branch[0] + face * (2 + random() * 2), y = branch[1] - 2 + random() * 3;
              line(branch, [x, y], .22, true);
              leafJobs.push({ x, y, angle: face * (.45 + random() * 1.3), size: .5 + random() * .3, shade: (random() - .5) * .09 });
            }
          }
        }
      }
    }
    // Back-to-front leaf layering gives each clump real dark recesses and a
    // readable lit edge rather than evenly distributed individual specks.
    leafJobs.sort((a, b) => a.shade - b.shade);
    for (const l of leafJobs) leaf(l.x, l.y, l.angle, l.size, l.shade);
  }
  return data;
}
