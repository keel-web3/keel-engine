// The J2 bars, measured: glyph confusions, the empty share of the classic
// console's selection panel, the console silhouette per culture, the command
// icons' family overlap, and what a modal scrim does to the text under it.
// Shared by test/j2.test.ts and tools/j2.ts (the evidence sheets).
import { CULTURES, createUi, generateHud, generateTheme, glyphOf, iconBitmap, iconMask } from "../src/index.ts";
import type { Culture, PixelFont, Theme, Ui } from "../src/index.ts";

export { CULTURES };

/** A glyph as drawn: the set of ink pixels at (pen + x, baseline + y). */
export function inkOf(font: PixelFont, ch: string): Set<string> {
  const g = glyphOf(font, ch.codePointAt(0)!)!;
  const s = new Set<string>();
  for (let y = 0; y < g.h; y += 1) for (let x = 0; x < g.w; x += 1) if (g.bits[y * g.w + x]) s.add(`${g.ox + x},${g.oy + y}`);
  return s;
}
const shifted = (s: Set<string>, dx: number, dy: number): Set<string> => new Set([...s].map((k) => { const [x, y] = k.split(",").map(Number); return `${x! + dx},${y! + dy}`; }));
const xor = (a: Set<string>, b: Set<string>): number => { let n = 0; for (const k of a) if (!b.has(k)) n += 1; for (const k of b) if (!a.has(k)) n += 1; return n; };

/**
 * The Hamming distance between two glyphs' bitmaps. `aligned`: as they're drawn (same pen, same baseline).
 * `best`: the smallest over every shift of one against the other (-3..3 each way) -- a stricter reading.
 */
export function glyphDistance(font: PixelFont, a: string, b: string): { aligned: number; best: number } {
  const A = inkOf(font, a), B = inkOf(font, b);
  let best = Infinity;
  for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) best = Math.min(best, xor(A, shifted(B, dx, dy)));
  return { aligned: xor(A, B), best };
}

export const GLYPH_PAIRS = [
  ["t", "l"], ["G", "B"], ["G", "C"], ["G", "6"], ["t", "f"], ["t", "+"], ["I", "l"],
  ["8", "B"], ["0", "O"], ["0", "D"], ["5", "S"], ["1", "l"], ["1", "I"], ["8", "0"], ["6", "9"],
  ["3", "E"], ["3", "B"], ["3", "S"], ["3", "8"],
] as const;
export const GLYPH_SIZES = [5, 6, 7, 8, 12] as const;
export const SEEDS = [1, 2, 3, 5, 8, 13, 21, 42] as const;

/** The worst glyph pair over every culture's family, several seeds and the sizes. */
export function worstGlyphs(fontOf: (params: Theme["type"]["font"], size: number) => PixelFont): Array<{ pair: string; aligned: number; best: number; at: string }> {
  return GLYPH_PAIRS.map(([a, b]) => {
    let aligned = Infinity, best = Infinity, at = "";
    for (const culture of CULTURES) for (const seed of SEEDS) {
      const p = generateTheme({ seed, culture }).type.font;
      for (const size of GLYPH_SIZES) {
        const d = glyphDistance(fontOf(p, size), a, b);
        if (d.aligned < aligned) { aligned = d.aligned; }
        if (d.best < best) { best = d.best; at = `${culture}/${seed}@${size}`; }
      }
    }
    return { pair: `${a}/${b}`, aligned, best, at };
  });
}

/** The largest axis-aligned rectangle of `true` cells in a w x h grid (histogram method): its area. */
export function largestRect(empty: (x: number, y: number) => boolean, w: number, h: number): { area: number; x: number; y: number; w: number; h: number } {
  const heights = new Int32Array(w);
  let bestA = 0, bx = 0, by = 0, bw = 0, bh = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) heights[x] = empty(x, y) ? heights[x]! + 1 : 0;
    const stack: number[] = [];
    for (let x = 0; x <= w; x += 1) {
      const hx = x < w ? heights[x]! : 0;
      while (stack.length && heights[stack[stack.length - 1]!]! >= hx) {
        const top = stack.pop()!;
        const ht = heights[top]!;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const a = ht * (x - left);
        if (a > bestA) { bestA = a; bx = left; by = y - ht + 1; bw = x - left; bh = ht; }
      }
      stack.push(x);
    }
  }
  return { area: bestA, x: bx, y: by, w: bw, h: bh };
}

/** A two-type group summary, the way MYRIAD writes it. */
export const SUMMARY_TWO = "{bright}8 x Hauler{/}\n{dim}Worker • health 90%{/}\n{bright}4 x Strider{/}\n{dim}Soldier • health 100%{/}\n{dim}Tab: next type{/}";
export const SUMMARY_ONE = "{bright}12 x Warden{/}\n{dim}Soldier • health 100%{/}";

/** The classic console at a screen size (the default whole UI scale), showing a 12-unit group. */
export function classicWithGroup(culture: Culture | string, seed: number, screenW: number, screenH: number, summary: string): Ui {
  const probe = createUi({ theme: generateTheme({ seed, culture }), width: screenW, height: screenH });
  const hud = generateHud({ seed, culture, width: probe.width, height: probe.height, layout: { preset: "classic" }, slots: { selection: { group: 12 } } });
  const ui = createUi({ theme: hud.theme, width: screenW, height: screenH });
  ui.load(hud.screen);
  ui.set("unit", { hidden: true });
  ui.set("group", { hidden: false });
  ui.set("group.summary", { text: summary });
  for (let k = 0; k < 12; k += 1) ui.set(`group.${k}`, { hidden: false, icon: k < 8 ? "worker" : "attack", tone: k % 5 === 0 ? "warn" : "good" });
  ui.render();
  return ui;
}

/**
 * The empty share of the selection panel: the largest axis-aligned rectangle of pixels the group left as bare console
 * (the same pixel as with nothing in the selection), over the panel's area.
 */
export function emptyShare(ui: Ui): { share: number; rect: { x: number; y: number; w: number; h: number }; panel: { x: number; y: number; w: number; h: number } } {
  const sel = ui.node("selection")!.rect;
  const full = ui.layer.px.slice();
  ui.set("group", { hidden: true });
  ui.render();
  const bare = ui.layer.px.slice();
  ui.set("group", { hidden: false });
  ui.render();
  const W = ui.width;
  const r = largestRect((x, y) => full[(sel.y + y) * W + sel.x + x] === bare[(sel.y + y) * W + sel.x + x], sel.w, sel.h);
  return { share: r.area / (sel.w * sel.h), rect: { x: sel.x + r.x, y: sel.y + r.y, w: r.w, h: r.h }, panel: sel };
}

/**
 * The console's silhouette: its alpha (drawn or not) over the band where the trim lives -- from the highest trim of
 * any culture down through the top 20% of the console -- and the frames' outer outline (the alpha of a 2-pixel ring
 * round every framed node in the console).
 */
export function consoleMask(ui: Ui, top: number): { mask: Uint8Array; n: number } {
  const bottom = ui.node("bottom")!.rect;
  const W = ui.width;
  const y0 = top, y1 = bottom.y + Math.round(bottom.h * 0.2);
  const cells: number[] = [];
  for (let y = y0; y < y1; y += 1) for (let x = 0; x < W; x += 1) cells.push(y * W + x);
  // (The outer outline of the frames inside the console: a ring just inside and outside each one's rectangle.)
  const seen = new Set(cells);
  for (const id of ["minimap", "portrait", "cmd", "selection"]) {
    const r = ui.node(id)?.rect;
    if (!r) continue;
    for (let y = r.y - 2; y < r.y + r.h + 2; y += 1) for (let x = r.x - 2; x < r.x + r.w + 2; x += 1) {
      const ring = x < r.x + 2 || y < r.y + 2 || x >= r.x + r.w - 2 || y >= r.y + r.h - 2;
      if (ring && x >= 0 && y >= 0 && x < W && y < ui.height && !seen.has(y * W + x)) { seen.add(y * W + x); cells.push(y * W + x); }
    }
  }
  const mask = new Uint8Array(cells.length);
  cells.forEach((i, k) => { mask[k] = ui.layer.px[i] !== 0 ? 1 : 0; });
  return { mask, n: cells.length };
}

/** The classic console alone (no group shown), for the silhouette. */
export function classicPlain(culture: Culture | string, seed: number, screenW: number, screenH: number): Ui {
  const probe = createUi({ theme: generateTheme({ seed, culture }), width: screenW, height: screenH });
  const hud = generateHud({ seed, culture, width: probe.width, height: probe.height, layout: { preset: "classic" } });
  const ui = createUi({ theme: hud.theme, width: screenW, height: screenH });
  ui.load(hud.screen);
  ui.render();
  return ui;
}

/** The share of pixels two masks (over the same cells) differ in. */
export function maskDiff(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
  return d / a.length;
}

/** The command icons the J2 bar measures. */
export const COMMAND_ICONS = ["attack", "move", "stop", "hold", "patrol", "build", "gather", "cancel", "rally", "train", "upgrade", "repair", "research", "ability", "cloak"] as const;

/** An icon's solid mask: the family's shape (iconMask), or every pixel the drawn icon paints (outline included). */
export function solidOf(name: string, size: number, theme: Theme, what: "shape" | "painted" = "shape", seed: string | number = 7): Uint8Array {
  if (what === "shape") return iconMask(name, size - 2, seed, 0, 1, theme.culture);
  const b = iconBitmap(name, size, theme, { seed, variant: 0 });
  return Uint8Array.from(b.px, (c) => (c !== 0 ? 1 : 0));
}

export function iou(a: Uint8Array, b: Uint8Array): number {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k += 1) { if (a[k] && b[k]) i += 1; if (a[k] || b[k]) u += 1; }
  return u ? i / u : 1;
}

/**
 * The mean IoU of the command icons' solid masks, culture against culture -- the same name, size, seed and variant, so
 * only the family differs. The worst pair, and every pair.
 */
export function iconOverlap(sizes: readonly number[] = [16, 24], what: "shape" | "painted" = "shape"): { worst: number; pair: string; table: Record<string, number> } {
  const themes = Object.fromEntries(CULTURES.map((c) => [c, generateTheme({ seed: 3, culture: c })])) as Record<Culture, Theme>;
  const table: Record<string, number> = {};
  let worst = 0, pair = "";
  for (let i = 0; i < CULTURES.length; i += 1) for (let j = i + 1; j < CULTURES.length; j += 1) {
    const a = CULTURES[i]!, b = CULTURES[j]!;
    let sum = 0, n = 0;
    for (const size of sizes) for (const name of COMMAND_ICONS) { sum += iou(solidOf(name, size, themes[a], what), solidOf(name, size, themes[b], what)); n += 1; }
    const m = sum / n;
    table[`${a}/${b}`] = Math.round(m * 1000) / 1000;
    if (m > worst) { worst = m; pair = `${a}/${b}`; }
  }
  return { worst, pair, table };
}

export { iconMask };
