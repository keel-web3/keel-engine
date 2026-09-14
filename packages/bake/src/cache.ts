// The bake cache: baked sprites by job key, so a design is drawn once per
// scale and style however many units wear it, a second load of the same army
// bakes nothing, and a game can bake progressively (what's on screen first)
// and repack as it goes. In memory always; `save()` makes a plain form (atlas
// pages as RGBA bytes + a table) a host with storage can keep -- the desktop
// app can persist it, KEEL's sandbox has no storage, so there it lives for
// the page's life -- and `encodeBake`/`decodeBake` make that one byte array.
//
//   const cache = createSpriteCache();
//   const todo = cache.missing(plan.sprites);          // only what isn't baked yet
//   cache.add(renderSprites(px, todo, designs).baked);
//   const atlas = cache.atlas(plan.sprites.map((j) => j.key));
//   const saved = cache.save();  ...  cache.load(saved);

import { atlasOf } from "./bake.ts";
import type { BakeAtlas, BakedSprite, SpriteRect } from "./bake.ts";
import type { PackOptions } from "./atlas.ts";
import type { SpriteJob } from "./plan.ts";
import type { AtlasPage } from "./sprites.ts";

export const BAKE_FORMAT = "keel-bake@1";

/** A bake as plain data: atlas pages and where every sprite is on them. */
export interface SavedBake {
  readonly format: typeof BAKE_FORMAT;
  readonly pages: readonly AtlasPage[];
  /** [key, page, x, y, w, h, ax, ay] per sprite. */
  readonly table: ReadonlyArray<readonly [string, number, number, number, number, number, number, number]>;
}

export interface SpriteCache {
  has(key: string): boolean;
  get(key: string): BakedSprite | undefined;
  add(sprites: Iterable<BakedSprite>): void;
  /** The jobs not baked yet (the plan's order). */
  missing(jobs: readonly SpriteJob[]): SpriteJob[];
  /** Forget sprites (all, or those whose key passes): how many went. */
  drop(which?: (key: string) => boolean): number;
  readonly size: number;
  /** Bytes of sprite pixels held. */
  readonly bytes: number;
  /** Pack sprites (these keys, or all) into atlas pages -- deterministic, whatever order they were baked in. */
  atlas(keys?: Iterable<string>, pack?: PackOptions): BakeAtlas;
  /** The plain form: pages + table (these keys, or all). */
  save(keys?: Iterable<string>, pack?: PackOptions): SavedBake;
  /** Take a saved bake's sprites in: how many. */
  load(saved: SavedBake): number;
}

export function createSpriteCache(): SpriteCache {
  const map = new Map<string, BakedSprite>();
  let bytes = 0;
  const pick = (keys?: Iterable<string>): BakedSprite[] => {
    if (!keys) return [...map.values()];
    const out: BakedSprite[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const s = map.get(k);
      if (!s) throw new RangeError(`Sprite "${k}" isn't baked.`);
      out.push(s);
    }
    return out;
  };
  const api: SpriteCache = {
    has: (key) => map.has(key),
    get: (key) => map.get(key),
    add(sprites) {
      for (const s of sprites) {
        const had = map.get(s.key);
        if (had) bytes -= had.rgba.byteLength + (had.heights?.byteLength ?? 0);
        map.set(s.key, s);
        bytes += s.rgba.byteLength + (s.heights?.byteLength ?? 0);
      }
    },
    missing: (jobs) => { const seen = new Set<string>(); return jobs.filter((j) => !map.has(j.key) && !seen.has(j.key) && (seen.add(j.key), true)); },
    drop(which) {
      let n = 0;
      for (const [k, s] of map) if (!which || which(k)) { map.delete(k); bytes -= s.rgba.byteLength + (s.heights?.byteLength ?? 0); n += 1; }
      return n;
    },
    get size() { return map.size; },
    get bytes() { return bytes; },
    atlas: (keys, pack) => atlasOf(pick(keys), pack),
    save(keys, pack) {
      const a = atlasOf(pick(keys), pack);
      return { format: BAKE_FORMAT, pages: a.pages, table: [...a.sprites].map(([k, r]) => [k, r.page, r.x, r.y, r.w, r.h, r.ax, r.ay] as const) };
    },
    load(saved) {
      if (saved.format !== BAKE_FORMAT) throw new TypeError(`Not a bake: format "${String(saved.format)}" (want "${BAKE_FORMAT}").`);
      api.add(spritesOf(saved));
      return saved.table.length;
    },
  };
  return api;
}

/** A saved bake's sprites, cut back out of its pages. */
export function spritesOf(saved: SavedBake): BakedSprite[] {
  return saved.table.map(([key, page, x, y, w, h, ax, ay]) => {
    const p = saved.pages[page];
    if (!p || x + w > p.width || y + h > p.height) throw new RangeError(`Sprite "${key}" lies outside its page.`);
    const rgba = new Uint8Array(w * h * 4);
    for (let r = 0; r < h; r += 1) rgba.set(p.rgba.subarray(((y + r) * p.width + x) * 4, ((y + r) * p.width + x + w) * 4), r * w * 4);
    if (!p.heights) return { key, w, h, ax, ay, rgba };
    const heights = new Uint8Array(w * h * 2);
    for (let r = 0; r < h; r += 1) heights.set(p.heights.subarray(((y + r) * p.width + x) * 2, ((y + r) * p.width + x + w) * 2), r * w * 2);
    return { key, w, h, ax, ay, rgba, heights };
  });
}

/** A saved bake as a table the sprite renderer reads: key -> rect. */
export const rectsOf = (saved: SavedBake): Map<string, SpriteRect> => new Map(saved.table.map(([k, page, x, y, w, h, ax, ay]) => [k, { page, x, y, w, h, ax, ay }]));

// One byte array: "KBAK", a u32 header length, the header (JSON: format, page sizes, table; `heights: true` for depth
// sprites), then each page's bytes (and after them, with heights, each page's height plane).
const MAGIC = [0x4b, 0x42, 0x41, 0x4b];

export function encodeBake(saved: SavedBake): Uint8Array {
  const heights = saved.pages.length > 0 && saved.pages.every((p) => p.heights);
  const header = new TextEncoder().encode(JSON.stringify(heights ? { format: saved.format, pages: saved.pages.map((p) => [p.width, p.height]), table: saved.table, heights: true } : { format: saved.format, pages: saved.pages.map((p) => [p.width, p.height]), table: saved.table }));
  const total = 8 + header.byteLength + saved.pages.reduce((n, p) => n + p.rgba.byteLength + (heights ? p.width * p.height * 2 : 0), 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, header.byteLength, true);
  out.set(header, 8);
  let o = 8 + header.byteLength;
  for (const p of saved.pages) { out.set(p.rgba, o); o += p.rgba.byteLength; }
  if (heights) for (const p of saved.pages) { out.set(p.heights!, o); o += p.width * p.height * 2; }
  return out;
}

export function decodeBake(bytes: Uint8Array): SavedBake {
  if (bytes.byteLength < 8 || MAGIC.some((m, i) => bytes[i] !== m)) throw new TypeError("Not an encoded bake.");
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n))) as { format: typeof BAKE_FORMAT; pages: Array<[number, number]>; table: SavedBake["table"]; heights?: boolean };
  if (head.format !== BAKE_FORMAT) throw new TypeError(`Not a bake: format "${String(head.format)}".`);
  let o = 8 + n;
  const pages: AtlasPage[] = head.pages.map(([width, height]) => {
    const len = width * height * 4;
    if (o + len > bytes.byteLength) throw new RangeError("The encoded bake is cut short.");
    const rgba = bytes.slice(o, o + len);
    o += len;
    return { width, height, rgba };
  });
  if (head.heights) {
    for (let i = 0; i < pages.length; i += 1) {
      const p = pages[i]!, len = p.width * p.height * 2;
      if (o + len > bytes.byteLength) throw new RangeError("The encoded bake is cut short.");
      pages[i] = { ...p, heights: bytes.slice(o, o + len) };
      o += len;
    }
  }
  return { format: head.format, pages, table: head.table };
}
