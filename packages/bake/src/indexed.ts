// Indexed sprites: the baker stops baking colours. Each texel of an indexed
// sprite is WHAT is there, not what colour it is:
//
//   r  slot + 1 (1..32; 0 = nothing there), + 64 if it's behind its
//      design's split point (an attribute's socket: see below), + 128 on an
//      outline edge
//   g  shade 0..255 (the renderer's lightness: where on its ramp it lands)
//   b  u  } where on its part the texel is, 0..255 each way (a surface
//   a  v  } coordinate: round a capsule and along it, across a box's face)
//
// A SLOT is a part's place in the thing (a body's head, chest, forearm...; an
// attribute's roles). At draw time a LOOK says what each slot wears -- a ramp,
// a pattern, a finish -- and the sprite shader turns (slot, shade, u, v) into a
// palette entry with the dither screen and the outline: palette-true pixel art,
// in any colours, from one bake. Zero bake cost per look.
//
// The renderer draws it: renderIndexed() (keel/render's bake mode) writes each
// pixel's material, edge, shade and surface coordinate; the baker gives every
// slot its own material (SLOT_MAT + slot), so the slot comes back exactly.
//
// A design may name a SPLIT point (an attribute: its socket's origin): each
// texel then says whether what it shows is behind that point, seen from the
// camera. The layer renderer draws those texels a hair behind the body the
// attribute sits on and the rest a hair in front -- so a scarf's back half
// goes behind the neck, a hood's shell behind the head, glasses' far lens
// behind the face, from every side, with one sprite per direction.
//
// Patterns ride the part (the surface coordinate is the part's own), so stripes
// stay on a sleeve through a walk cycle instead of sliding across the sprite;
// they restart at each part's edge (every capsule and box has its own 0..1).

import { atlasOf } from "./bake.ts";
import type { BakedSprite, BakeRenderer, BakeSpriteOptions, BakeStats, BakeWorld, BakeAtlas } from "./bake.ts";
import { bakeCamera, bakeSize, thinned } from "./bake.ts";
import type { PackOptions } from "./atlas.ts";
import type { SpriteJob } from "./plan.ts";

/** Slots an indexed sprite can tell apart. */
export const SLOTS = 32;
/**
 * Slot s is drawn with material SLOT_MAT + s. (Materials 4 and 5 light the renderer's water and sky -- only rays
 * that miss every solid read them, and the index pass drops those -- so the slots can have 0..31 to themselves.)
 */
export const SLOT_MAT = 0;
/** An empty texel. */
export const EMPTY_TEXEL = 0;

/** One indexed texel. */
export interface Texel {
  readonly slot: number;
  readonly edge: boolean;
  /** Behind its design's split point (false when it has none). */
  readonly behind?: boolean;
  readonly shade: number;
  readonly u: number;
  readonly v: number;
}

/** A texel as its four bytes (see the top of this file). */
export function encodeTexel({ slot, edge, behind = false, shade, u, v }: Texel): [number, number, number, number] {
  if (!(slot >= 0 && slot < SLOTS)) throw new RangeError(`Slot ${slot}: 0..${SLOTS - 1}.`);
  const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return [(slot + 1) | (behind ? 64 : 0) | (edge ? 128 : 0), byte(shade), byte(u), byte(v)];
}
/** Four bytes back to a texel (null: nothing there). */
export function decodeTexel(r: number, g: number, b: number, a: number): Texel | null {
  const s = r & 63;
  if (!s) return null;
  return { slot: s - 1, edge: (r & 128) !== 0, behind: (r & 64) !== 0, shade: g, u: b, v: a };
}

/** What the indexed bake asks of a design: its solids at a clip's frame, each carrying its slot in `mat` (0..31). */
export interface IndexedSource {
  pose(clip: string, frame: number): BakeWorld;
  /** A point to split its texels at (behind it, or not, from the camera): an attribute's socket origin. */
  readonly split?: readonly [number, number, number];
}
export type IndexedSources = ReadonlyMap<string, IndexedSource> | ((design: string) => IndexedSource | undefined);

/** The renderer the indexed bake draws through (`createPixelRenderer` from @keel-engine/render has it). */
export interface IndexedBakeRenderer extends BakeRenderer {
  renderIndexed(options: { eye: readonly [number, number, number]; target: readonly [number, number, number]; fov?: number; time?: number; sun?: readonly [number, number, number]; waterY?: number; fogNear?: number; fogFar?: number; gap?: number; split?: readonly [number, number, number] | undefined }): WebGLFramebuffer | null;
}

// Every slot's material is the same grey ramp at full light: the shade is the renderer's own lightness.
const BAKE_PALETTE = { colours: [[40, 40, 40], [200, 200, 200]], ramps: { slot: [0, 2] as [number, number] } };
const BAKE_MATERIALS = Array.from({ length: Math.max(6, SLOT_MAT + SLOTS) }, () => ({ ramp: "slot" }));

/** A world's solids moved onto the slot materials (mat = slot -> SLOT_MAT + slot). */
export function slotWorld(world: BakeWorld): BakeWorld {
  const m = (mat: number | undefined) => SLOT_MAT + Math.max(0, Math.min(SLOTS - 1, mat ?? 0));
  return {
    capsules: (world.capsules ?? []).map((c) => ({ ...c, mat: m(c.mat) })),
    boxes: (world.boxes ?? []).map((b) => ({ ...b, mat: m(b.mat) })),
    wedges: (world.wedges ?? []).map((b) => ({ ...b, mat: m(b.mat) })),
  };
}

/**
 * Trim one index picture (INDEX_FS's bytes) to its design's texels, re-encoded as indexed texels. `src` holds it
 * at (sx, sy) in a `srcWidth`-wide RGBA buffer, rows bottom first (as GL reads them) unless `topDown`; (ox, oy) is
 * the origin's pixel in the picture (top-down).
 */
export function trimIndexed(key: string, src: Uint8Array, srcWidth: number, sx: number, sy: number, w: number, h: number, ox: number, oy: number, topDown = false): BakedSprite {
  const rowAt = (i: number) => (topDown ? sy + i : sy + h - 1 - i);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < h; i += 1) {
    let o = (rowAt(i) * srcWidth + sx) * 4;
    for (let x = 0; x < w; x += 1, o += 4) {
      if (!(src[o]! & 128)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (i < y0) y0 = i;
      y1 = i;
    }
  }
  if (x1 < 0) return { key, w: 1, h: 1, ax: ox, ay: oy, rgba: new Uint8Array(4) };
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const rgba = new Uint8Array(tw * th * 4);
  for (let i = 0; i < th; i += 1) {
    let o = (rowAt(y0 + i) * srcWidth + sx + x0) * 4;
    let d = i * tw * 4;
    for (let x = 0; x < tw; x += 1, o += 4, d += 4) {
      const r = src[o]!;
      if (!(r & 128)) continue;
      const slot = Math.max(0, Math.min(SLOTS - 1, (r & 31) - SLOT_MAT));
      rgba[d] = (slot + 1) | (r & 32 ? 64 : 0) | (r & 64 ? 128 : 0); rgba[d + 1] = src[o + 1]!; rgba[d + 2] = src[o + 2]!; rgba[d + 3] = src[o + 3]!;
    }
  }
  return { key, w: tw, h: th, ax: ox - x0, ay: oy - y0, rgba };
}

const now = (): number => (globalThis.performance ? performance.now() : Date.now());

/**
 * Draw every job's design as indexed texels and trim it (no packing): the sprites, and what it cost. As
 * renderSprites, but no palette, no style, no key colour: slots, shades and surface coordinates. The renderer is
 * the baker's for the duration (give it one of its own).
 */
export function renderIndexedSprites(renderer: IndexedBakeRenderer, jobs: readonly SpriteJob[], sources: IndexedSources, options: Omit<BakeSpriteOptions, "style" | "fx"> & { readonly gap?: number } = {}): { baked: BakedSprite[]; stats: BakeStats } {
  const t0 = now();
  const { margin = 3, compensate = true, time = 0, onProgress, gap = 0.56 } = options;
  const gl = renderer.gl;
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const S = Math.min(options.staging ?? 2048, maxTex);
  const sourceOf = (key: string): IndexedSource => {
    const s = typeof sources === "function" ? sources(key) : sources.get(key);
    if (!s) throw new RangeError(`No design "${key}" to bake.`);
    return s;
  };
  // Jobs by picture size, every design together: nothing is set per design (no palette, no materials), and a new
  // size costs the renderer its targets -- so sizes are rounded up to 16 px and a slice of small sprites (a
  // hundred hats) is drawn at one or two sizes. (The extra room is margin; trimming takes it off.)
  const groups = new Map<string, SpriteJob[]>();
  const up = (v: number) => Math.ceil(v / 16) * 16;
  for (const j of jobs) {
    const size = bakeSize(j, margin);
    const w = up(size.width) - 2 * margin, h = up(size.height) - 2 * margin;
    const g = `${w}x${h}`;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(w === j.w && h === j.h ? j : { ...j, w, h });
  }

  const prevUnit = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0 + 7);
  const staging = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, staging);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, S, S);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(prevUnit);
  let readBuf = new Uint8Array(0);

  interface Slot { job: SpriteJob; x: number; y: number; w: number; h: number; ox: number; oy: number }
  let pending: Slot[] = [];
  let cx = 0, cy = 0, rowH = 0;
  const baked: BakedSprite[] = [];
  let readMs = 0, trimMs = 0, rendered = 0, kept = 0, dropped = 0;
  const flush = () => {
    if (!pending.length) return;
    const r0 = now();
    const used = Math.min(S, cy + rowH);
    if (readBuf.length < S * used * 4) readBuf = new Uint8Array(S * used * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readPixels(0, 0, S, used, gl.RGBA, gl.UNSIGNED_BYTE, readBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const r1 = now();
    readMs += r1 - r0;
    for (const s of pending) {
      const sprite = trimIndexed(s.job.key, readBuf, S, s.x, s.y, s.w, s.h, s.ox, s.oy);
      kept += sprite.w * sprite.h;
      baked.push(sprite);
    }
    trimMs += now() - r1;
    pending = [];
    cx = 0; cy = 0; rowH = 0;
    onProgress?.(baked.length, jobs.length);
  };

  renderer.setFx?.([]);
  renderer.setPalette(BAKE_PALETTE.colours, BAKE_PALETTE.ramps);
  renderer.setMaterials(BAKE_MATERIALS);
  const designs = new Set(jobs.map((j) => j.design)).size;
  for (const list of groups.values()) {
    const first = list[0]!;
    const size = bakeSize(first, margin);
    if (size.width > S || size.height > S) throw new RangeError(`A ${size.width}x${size.height} sprite doesn't fit the ${S} staging texture.`);
    renderer.setTarget(size.width, size.height);
    for (const job of list) {
      const src = sourceOf(job.design);
      const cam = bakeCamera(job, options);
      const world = slotWorld(src.pose(job.clip, job.frame));
      dropped += renderer.setWorld(compensate ? thinned(world, cam.eps) : world).dropped;
      const from = renderer.renderIndexed({ eye: cam.eye, target: cam.target, fov: cam.fov, time, sun: cam.sun, waterY: -1e4, fogNear: 1e5, fogFar: 2e5, gap, split: src.split });
      if (cx + cam.width > S) { cx = 0; cy += rowH; rowH = 0; }
      if (cy + cam.height > S) flush();
      gl.activeTexture(gl.TEXTURE0 + 7);
      gl.bindTexture(gl.TEXTURE_2D, staging);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, cx, cy, 0, 0, cam.width, cam.height);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      pending.push({ job, x: cx, y: cy, w: cam.width, h: cam.height, ox: cam.ox, oy: cam.oy });
      rendered += cam.width * cam.height;
      cx += cam.width;
      rowH = Math.max(rowH, cam.height);
    }
  }
  flush();
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(staging);
  const ms = now() - t0;
  return { baked, stats: { sprites: baked.length, designs, ms, drawMs: ms - readMs - trimMs, readMs, trimMs, rendered, kept, dropped } };
}

/** Bake every job indexed: draw, trim, anchor and pack. */
export function bakeIndexed(renderer: IndexedBakeRenderer, jobs: readonly SpriteJob[], sources: IndexedSources, options: Parameters<typeof renderIndexedSprites>[3] & { readonly pack?: PackOptions } = {}): BakeAtlas & { baked: BakedSprite[]; stats: BakeStats } {
  const { baked, stats } = renderIndexedSprites(renderer, jobs, sources, options);
  return { ...atlasOf(baked, options.pack), baked, stats };
}
