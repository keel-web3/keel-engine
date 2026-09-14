// The UI's sprite atlas: glyph masks, themed icons and anything else the UI
// draws from, packed into ONE page -- the same approach as bake's sprite
// cache: sprites by a content key (a font's key + code point, an icon's name +
// size + theme key), made once on first use and never again, placed on
// shelves as they arrive (bake's shelf idea: a row per 8 px height class).
// What sits at a key never depends on the order things were cached in, so
// the atlas draws the same picture however it filled.
//
// A full page is cleared and refilled from what's asked for next (it only
// fills when a game churns through many fonts or themes); `generation` counts
// the clears, `dirty` is the region a texture upload needs since the last take.

import { createBitmap } from "./bitmap.ts";
import type { Bitmap } from "./bitmap.ts";

export interface AtlasSprite { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

export interface AtlasStats { hits: number; misses: number; sprites: number; clears: number; usedRows: number }

export interface UiAtlas {
  readonly page: Bitmap;
  readonly stats: AtlasStats;
  readonly generation: number;
  /** The sprite at `key`, made (and packed) by `make` the first time. */
  sprite(key: string, make: () => Bitmap): AtlasSprite;
  has(key: string): boolean;
  /** The page region written since the last call (null when nothing was), for a texture upload. */
  takeDirty(): { x: number; y: number; w: number; h: number } | null;
  clear(): void;
}

interface Shelf { y: number; h: number; x: number }

export function createAtlas(size = 1024): UiAtlas {
  const page = createBitmap(size, size);
  const map = new Map<string, AtlasSprite>();
  let shelves: Shelf[] = [];
  let top = 0;
  let generation = 0;
  let dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const stats: AtlasStats = { hits: 0, misses: 0, sprites: 0, clears: 0, usedRows: 0 };
  const PAD = 1;
  const alloc = (w: number, h: number): AtlasSprite | null => {
    const cls = Math.ceil((h + PAD) / 8) * 8;
    for (const s of shelves) if (s.h === cls && s.x + w + PAD <= size) { const at = { x: s.x, y: s.y, w, h }; s.x += w + PAD; return at; }
    if (top + cls > size || w + PAD > size) return null;
    const s = { y: top, h: cls, x: w + PAD };
    shelves.push(s);
    top += cls;
    stats.usedRows = top;
    return { x: 0, y: s.y, w, h };
  };
  const api: UiAtlas = {
    page, stats,
    get generation() { return generation; },
    has: (key) => map.has(key),
    sprite(key, make) {
      const hit = map.get(key);
      if (hit) { stats.hits += 1; return hit; }
      stats.misses += 1;
      const bmp = make();
      let at = alloc(bmp.w, bmp.h);
      if (!at) { api.clear(); at = alloc(bmp.w, bmp.h); }
      if (!at) throw new RangeError(`A ${bmp.w}x${bmp.h} sprite doesn't fit a ${size} atlas page.`);
      for (let y = 0; y < bmp.h; y += 1) page.px.set(bmp.px.subarray(y * bmp.w, (y + 1) * bmp.w), (at.y + y) * size + at.x);
      map.set(key, at);
      stats.sprites = map.size;
      dirty = dirty
        ? { x0: Math.min(dirty.x0, at.x), y0: Math.min(dirty.y0, at.y), x1: Math.max(dirty.x1, at.x + at.w), y1: Math.max(dirty.y1, at.y + at.h) }
        : { x0: at.x, y0: at.y, x1: at.x + at.w, y1: at.y + at.h };
      return at;
    },
    takeDirty() {
      if (!dirty) return null;
      const d = { x: dirty.x0, y: dirty.y0, w: dirty.x1 - dirty.x0, h: dirty.y1 - dirty.y0 };
      dirty = null;
      return d;
    },
    clear() {
      map.clear(); shelves = []; top = 0; page.px.fill(0);
      generation += 1; stats.clears += 1; stats.sprites = 0; stats.usedRows = 0;
      dirty = { x0: 0, y0: 0, x1: size, y1: size };
    },
  };
  return api;
}
