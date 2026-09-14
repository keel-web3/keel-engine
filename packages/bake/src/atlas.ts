// Packing baked sprites into atlas pages: a skyline packer (bottom-left fit
// over the running top edge of what's placed), tallest first -- tight, fast,
// and deterministic, so the same sprites always make the same atlas and a
// bake can be cached by its content. A page that fills opens the next.
//
//   const atlas = packAtlas(rects, { size: 2048, pad: 1 });
//   atlas.places[i] -> { page, x, y } for rects[i];  atlas.pages -> [{ w, h }]

export interface Rect { readonly w: number; readonly h: number }
export interface Place { readonly page: number; readonly x: number; readonly y: number }
export interface Atlas {
  readonly places: readonly Place[];
  /** Each page's used size (rounded up to a power of two when `pow2`). */
  readonly pages: ReadonlyArray<{ readonly w: number; readonly h: number }>;
  /** Used area over page area, 0..1. */
  readonly fill: number;
}

export interface PackOptions {
  /** A page's width and height limit. */
  readonly size?: number;
  /** Gap between sprites (bleed-free sampling with nearest filtering needs 1). */
  readonly pad?: number;
  /** Round page sizes up to powers of two. */
  readonly pow2?: boolean;
}

interface Segment { x: number; y: number; w: number }

export function packAtlas(rects: readonly Rect[], { size = 2048, pad = 1, pow2 = false }: PackOptions = {}): Atlas {
  for (const r of rects) if (r.w + pad > size || r.h + pad > size) throw new RangeError(`A ${r.w}x${r.h} sprite doesn't fit a ${size} page.`);
  // Tallest first, then widest, then original order: deterministic.
  const order = rects.map((_, i) => i).sort((a, b) => rects[b]!.h - rects[a]!.h || rects[b]!.w - rects[a]!.w || a - b);
  const places: Place[] = new Array(rects.length);
  const pages: Array<{ w: number; h: number }> = [];
  let skyline: Segment[] = [];
  let page = -1;
  let area = 0;
  const open = () => { page += 1; pages.push({ w: 0, h: 0 }); skyline = [{ x: 0, y: 0, w: size }]; };
  open();

  // Where would a w-wide box sit starting at segment i: the highest skyline under it (or -1 if it runs off the page).
  const fitAt = (i: number, w: number): number => {
    const x = skyline[i]!.x;
    if (x + w > size) return -1;
    let y = 0;
    let left = w;
    for (let j = i; left > 0; j += 1) {
      const s = skyline[j];
      if (!s) return -1;
      y = Math.max(y, s.y);
      left -= s.w;
    }
    return y;
  };

  for (const i of order) {
    const w = rects[i]!.w + pad;
    const h = rects[i]!.h + pad;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let best = -1;
      let bestY = Infinity;
      let bestW = Infinity;
      for (let s = 0; s < skyline.length; s += 1) {
        const y = fitAt(s, w);
        if (y < 0 || y + h > size) continue;
        if (y < bestY || (y === bestY && skyline[s]!.w < bestW)) { best = s; bestY = y; bestW = skyline[s]!.w; }
      }
      if (best < 0) { if (attempt === 0) { open(); continue; } throw new Error("unreachable: an empty page always fits"); }
      const x = skyline[best]!.x;
      places[i] = { page, x, y: bestY };
      area += rects[i]!.w * rects[i]!.h;
      const pg = pages[page]!;
      pg.w = Math.max(pg.w, x + w);
      pg.h = Math.max(pg.h, bestY + h);
      // Raise the skyline under the box, then merge equal neighbours.
      const next: Segment[] = [];
      for (const s of skyline) {
        const s1 = s.x + s.w;
        if (s1 <= x || s.x >= x + w) { next.push(s); continue; }
        if (s.x < x) next.push({ x: s.x, y: s.y, w: x - s.x });
        if (s1 > x + w) next.push({ x: x + w, y: s.y, w: s1 - (x + w) });
      }
      next.push({ x, y: bestY + h, w });
      next.sort((a, b) => a.x - b.x);
      skyline = [];
      for (const s of next) {
        const last = skyline[skyline.length - 1];
        if (last && last.y === s.y && last.x + last.w === s.x) last.w += s.w;
        else skyline.push({ ...s });
      }
      break;
    }
  }
  const up = (n: number) => (pow2 ? 2 ** Math.ceil(Math.log2(Math.max(1, n))) : n);
  const sized = pages.map((p) => ({ w: Math.min(size, up(p.w)), h: Math.min(size, up(p.h)) }));
  const total = sized.reduce((s, p) => s + p.w * p.h, 0);
  return { places, pages: sized, fill: total ? area / total : 0 };
}
