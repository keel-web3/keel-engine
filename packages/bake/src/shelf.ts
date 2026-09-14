// A live atlas: sprites placed one at a time as they're baked, and freed one
// at a time when they're evicted, into a fixed set of square pages -- what a
// streaming bake uploads into (a sprite goes up the moment it's baked; nothing
// is ever repacked). Shelves: each page is cut into rows ("shelves") whose
// height is a size class (8 px steps); a sprite takes the first free span
// wide enough on a shelf of its class, or opens a shelf, or a page. A freed
// span goes back to its shelf (merged with its neighbours) for the next sprite
// of that class; an emptied top shelf gives its height back to the page.
//
//   const atlas = createShelfAtlas({ size: 2048, pages: 16 });
//   const at = atlas.alloc(w, h);          // { page, x, y, w, h } or null (full)
//   atlas.free(at);
//
// Where a sprite lands depends on the order sprites came in; what is at its
// rect never does (its texels are its own), so a streaming bake draws the same
// picture whatever order it baked in.

export interface ShelfRect { readonly page: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export interface ShelfAtlasOptions {
  /** A page's side in texels (default 2048). */
  readonly size?: number;
  /** Pages at most (default 16): the memory a streaming bake may take is pages x size² x 4 bytes. */
  readonly pages?: number;
  /** Gap kept round each sprite (default 1: bleed-free with nearest sampling). */
  readonly pad?: number;
}

export interface ShelfAtlas {
  readonly size: number;
  readonly maxPages: number;
  /** Pages opened so far (the texture array needs this many layers). */
  readonly pages: number;
  /** Bytes of texture the opened pages take (RGBA8). */
  readonly bytes: number;
  /** Bytes of sprite texels placed now. */
  readonly used: number;
  /** A place for a w x h sprite, or null when every page is full. */
  alloc(w: number, h: number): ShelfRect | null;
  /** Give a sprite's place back. */
  free(rect: ShelfRect): void;
  /** Could a w x h sprite be placed without freeing anything? */
  fits(w: number, h: number): boolean;
  /** Forget everything (the pages stay open). */
  clear(): void;
}

interface Shelf { y: number; h: number; spans: number[] } // (free spans as [x0, x1, x0, x1, ...], sorted)
interface Page { shelves: Shelf[]; top: number }

const CLASS = 8;

export function createShelfAtlas({ size = 2048, pages: maxPages = 16, pad = 1 }: ShelfAtlasOptions = {}): ShelfAtlas {
  if (!(size >= 16 && maxPages >= 1)) throw new RangeError("A shelf atlas needs a size of 16 or more and at least one page.");
  const pages: Page[] = [];
  let used = 0;
  const classOf = (h: number) => Math.ceil((h + pad) / CLASS) * CLASS;
  // First fit on the shelves of this class; a span is taken from its left end.
  const takeSpan = (s: Shelf, w: number): number => {
    for (let i = 0; i < s.spans.length; i += 2) {
      const x0 = s.spans[i]!, x1 = s.spans[i + 1]!;
      if (x1 - x0 < w) continue;
      if (x1 - x0 === w) s.spans.splice(i, 2); else s.spans[i] = x0 + w;
      return x0;
    }
    return -1;
  };
  const find = (w: number, ch: number, commit: boolean): ShelfRect | null => {
    for (let p = 0; p < pages.length; p += 1) for (const s of pages[p]!.shelves) {
      if (s.h !== ch) continue;
      if (!commit) { for (let i = 0; i < s.spans.length; i += 2) if (s.spans[i + 1]! - s.spans[i]! >= w) return { page: p, x: 0, y: s.y, w: 0, h: 0 }; continue; }
      const x = takeSpan(s, w);
      if (x >= 0) return { page: p, x, y: s.y, w, h: ch };
    }
    // A new shelf on the first page with room, or a new page.
    for (let p = 0; p <= pages.length && p < maxPages; p += 1) {
      const pg = pages[p];
      if (pg && pg.top + ch > size) continue;
      if (!commit) return { page: p, x: 0, y: 0, w: 0, h: 0 };
      const page = pg ?? (pages.push({ shelves: [], top: 0 }), pages[p]!);
      const s: Shelf = { y: page.top, h: ch, spans: [w, size] };
      if (w === size) s.spans = [];
      page.shelves.push(s);
      page.top += ch;
      return { page: p, x: 0, y: s.y, w, h: ch };
    }
    return null;
  };
  return {
    size, maxPages,
    get pages() { return pages.length; },
    get bytes() { return pages.length * size * size * 4; },
    get used() { return used; },
    alloc(w, h) {
      const W = w + pad;
      if (W > size || h + pad > size) throw new RangeError(`A ${w}x${h} sprite doesn't fit a ${size} page.`);
      const got = find(W, classOf(h), true);
      if (!got) return null;
      used += w * h * 4;
      return { page: got.page, x: got.x, y: got.y, w, h };
    },
    fits(w, h) { return find(w + pad, classOf(h), false) !== null; },
    free(r) {
      const page = pages[r.page];
      const ch = classOf(r.h);
      const s = page?.shelves.find((q) => q.y === r.y && q.h === ch);
      if (!page || !s) throw new RangeError(`Nothing was placed at page ${r.page}, row ${r.y}.`);
      used -= r.w * r.h * 4;
      // Put [x, x + w + pad) back, merged with the spans either side.
      const x0 = r.x, x1 = r.x + r.w + pad;
      let i = 0;
      while (i < s.spans.length && s.spans[i]! < x0) i += 2;
      s.spans.splice(i, 0, x0, x1);
      if (i + 2 < s.spans.length && s.spans[i + 1] === s.spans[i + 2]) { s.spans[i + 1] = s.spans[i + 3]!; s.spans.splice(i + 2, 2); }
      if (i > 0 && s.spans[i - 1] === s.spans[i]) { s.spans[i - 1] = s.spans[i + 1]!; s.spans.splice(i, 2); }
      // (An empty shelf at the page's top gives its rows back: any class can use them.)
      while (page.shelves.length) {
        const last = page.shelves[page.shelves.length - 1]!;
        if (!(last.spans.length === 2 && last.spans[0] === 0 && last.spans[1] === size)) break;
        page.shelves.pop();
        page.top = last.y;
      }
    },
    clear() { for (const p of pages) { p.shelves = []; p.top = 0; } used = 0; },
  };
}
