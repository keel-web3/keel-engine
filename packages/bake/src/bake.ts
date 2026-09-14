// The baker: every sprite a plan lists, drawn once through the pixel renderer
// (palette, dither screen, outline -- the same pipeline the hero shots use),
// trimmed to its pixels, anchored at the ground point under the design's
// origin, and packed into atlas pages for the sprite renderer.
//
//   const plan = planBake(designs, { directions: 8, pixelsPerMetre: 24, pitch: 0.6 });
//   const bake = bakeSprites(px, plan.sprites, designsByKey);   // px: createPixelRenderer(offscreen)
//   bake.pages -> AtlasPage[]   bake.sprites.get(job.key) -> { page, x, y, w, h, ax, ay }
//
// The camera: the pixel view is orthographic, the raymarcher perspective. Until
// the renderer has an orthographic mode, each sprite is drawn from far away
// through a narrow lens whose picture plane (at the design's origin) has
// exactly the target's pixels per metre -- so the ground point projects to the
// same pixel it would orthographically, and the rest is off by the design's
// depth over the distance (a few per cent at most). The raymarcher's hit
// tolerance grows with distance (0.0015 x t), which would fatten every
// silhouette by that much: the baker thins every solid by the same amount,
// so silhouettes land where they are.
//
// The background: the baker lights the sky (material 5) and the water
// (material 4, sunk out of sight) with a one-entry ramp of a key colour that
// is in no other ramp. Every pixel is a palette entry, so a pixel is the key
// exactly when it's background: the mask is exact, not a tolerance.
//
// Speed: nothing is read back per sprite. Each render is copied on the GPU
// into a staging texture, and the staging texture is read back once when it
// fills -- so the GPU works through the whole bake without a stall.

import { packAtlas } from "./atlas.ts";
import type { PackOptions } from "./atlas.ts";
import type { IndexedBakeRenderer } from "./indexed.ts";
import type { SpriteJob } from "./plan.ts";
import type { AtlasPage } from "./sprites.ts";

// ---------------------------------------------------------------- what it draws

type V3 = readonly [number, number, number];
/** A capsule in the world (what an entity's skin makes). */
export interface BakeCapsule { readonly a: ArrayLike<number>; readonly b: ArrayLike<number>; readonly r: number; readonly mat?: number | undefined }
/** A box turned about y (a wedge with `kind: "wedge"`). */
export interface BakeBox { readonly c: ArrayLike<number>; readonly h: ArrayLike<number>; readonly yaw?: number | undefined; readonly mat?: number | undefined; readonly kind?: string | undefined; readonly lo?: number | undefined }
/** A design posed at one frame: solids at the origin, facing +z (the frame convention). */
export interface BakeWorld { readonly capsules?: readonly BakeCapsule[] | undefined; readonly boxes?: readonly BakeBox[] | undefined; readonly wedges?: readonly BakeBox[] | undefined }
export interface BakeMaterial { readonly ramp: string; readonly light?: number | undefined; readonly pattern?: number | undefined; readonly glow?: number | undefined }
/** Colours ([r, g, b] 0-255) and ramps ({ name: [base, length] }), as the renderer's setPalette takes them. */
export interface BakePalette { readonly colours: ReadonlyArray<ArrayLike<number>>; readonly ramps: Readonly<Record<string, readonly [number, number]>> }

/** What the baker asks of a design: its palette and materials, and its solids at a clip's frame. */
export interface BakeSource {
  readonly palette: BakePalette;
  /** Materials by number (4 and 5 are the renderer's water and sky: the baker takes those over). */
  readonly materials: readonly BakeMaterial[];
  pose(clip: string, frame: number): BakeWorld;
}
/** Designs by key: a map, or a lookup. */
export type BakeSources = ReadonlyMap<string, BakeSource> | ((design: string) => BakeSource | undefined);

/** The renderer calls the baker makes (`createPixelRenderer` from @keel-engine/render has them all). */
export interface BakeRenderer {
  readonly gl: WebGL2RenderingContext;
  setTarget(width: number, height: number): void;
  setPalette(colours: ReadonlyArray<ArrayLike<number>>, ramps: Readonly<Record<string, readonly [number, number]>>): void;
  setMaterials(list: readonly BakeMaterial[]): void;
  setStyle(style?: { screen?: number | string | undefined; dither?: number | undefined; outline?: number | boolean | undefined }): void;
  setFx?(list?: readonly object[]): void;
  setWorld(world: BakeWorld): { dropped: number };
  render(options: { eye: V3; target: V3; fov?: number; time?: number; sun?: V3; waterY?: number; fogNear?: number; fogFar?: number }): void;
}

export interface BakeSpriteOptions {
  /** The renderer's style for every sprite (default: a 4x4 ordered screen, dither 0.9, the outline). */
  readonly style?: { readonly screen?: number | string; readonly dither?: number; readonly outline?: number | boolean };
  /** An fx list (default none). A halo that falls on the background becomes part of the sprite. */
  readonly fx?: readonly object[];
  /** The light, relative to the camera: [to the picture's right, up, toward the camera] (default upper left, in front). */
  readonly sun?: V3;
  /** Pixels of room round each planned box before trimming (default 3). */
  readonly margin?: number;
  /** The stand-in camera's distance in metres (default: where the hit tolerance is a pixel, 6..90 m). */
  readonly distance?: number;
  /** Thin every solid by the raymarcher's hit tolerance, so silhouettes land true (default true). */
  readonly compensate?: boolean;
  /** Side of the staging texture renders are gathered in (default 2048). */
  readonly staging?: number;
  /** The renderer's time (default 0). */
  readonly time?: number;
  /** Called as sprites are read back: how many are done of how many. */
  readonly onProgress?: (done: number, total: number) => void;
  /** Depth sprites (indexed.ts, depth.ts): a height plane with every sprite (needs keel/render's renderIndexedHeights). */
  readonly heights?: boolean;
}

/** A baked sprite: its trimmed pixels (RGBA, top row first; alpha 255 on the design, 0 off it) and its anchor. */
export interface BakedSprite {
  readonly key: string;
  readonly w: number;
  readonly h: number;
  /** The ground point under the design's origin, in pixels from the sprite's top-left. */
  readonly ax: number;
  readonly ay: number;
  readonly rgba: Uint8Array;
  /** Depth sprites (indexed.ts): a height per texel, two bytes each (w x h x 2), or none. */
  readonly heights?: Uint8Array | undefined;
}

export interface BakeStats {
  readonly sprites: number;
  readonly designs: number;
  /** Wall time of the whole bake, and its parts: posing + queueing draws, reading back, trimming. */
  readonly ms: number;
  readonly drawMs: number;
  readonly readMs: number;
  readonly trimMs: number;
  /** Pixels rendered (before trimming) and kept (after). */
  readonly rendered: number;
  readonly kept: number;
  /** Solids the renderer dropped past its limits (0 unless a design is too big for one scene). */
  readonly dropped: number;
}

// ---------------------------------------------------------------- the camera

/** Where the stand-in camera stands for a job: the renderer's eye/target/fov, the picture's size, the origin's pixel, and the hit tolerance it was set for. */
export interface BakeCamera {
  readonly width: number;
  readonly height: number;
  readonly eye: V3;
  readonly target: V3;
  readonly fov: number;
  readonly sun: V3;
  /** The design origin's pixel corner in the untrimmed picture (x right, y down from the top-left). */
  readonly ox: number;
  readonly oy: number;
  /** The raymarcher's hit tolerance at the design (metres). */
  readonly eps: number;
  readonly yaw: number;
}

const HIT = 0.0015; // (the raymarcher's hit test: distance < 0.0015 x t)
const FAR = 140; // (the renderer's far limit: the eye must stay inside it)

/** The distance where the raymarcher's hit tolerance is about a pixel at this scale. */
export const bakeDistance = (pixelsPerMetre: number): number => Math.min(90, Math.max(6, 1 / (HIT * pixelsPerMetre)));

/** The picture size for a job (its planned box plus room; even width, so the origin sits on a pixel corner). */
export function bakeSize(job: Pick<SpriteJob, "w" | "h">, margin = 3): { width: number; height: number } {
  const w = job.w + 2 * margin;
  return { width: w + (w & 1), height: job.h + 2 * margin };
}

export function bakeCamera(job: SpriteJob, { margin = 3, distance, sun = [-0.5, 0.75, 0.45] }: Pick<BakeSpriteOptions, "margin" | "distance" | "sun"> = {}): BakeCamera {
  const k = job.pixelsPerMetre;
  const { width: W, height: H } = bakeSize(job, margin);
  const D = Math.min(FAR * 0.8, distance ?? bakeDistance(k));
  // (Direction 0 shows the design's front: it faces +z, so the camera looks along -z; direction d turns the camera the other way round it.)
  const yaw = -Math.PI - job.angle;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(job.pitch), cp = Math.cos(job.pitch);
  const fwd: V3 = [sy * cp, -sp, cy * cp];
  const right: V3 = [cy, 0, -sy];
  const up: V3 = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  // The origin's pixel: the middle column; far enough up that the footprint's near edge (radius x sin pitch) fits below it.
  const rk = Math.max(0, (job.w - 2) / 2);
  const ox = W / 2;
  const oy = H - margin - 1 - Math.ceil(rk * sp);
  // The view's centre: on the screen-up axis through the origin, so the origin lands on (ox, oy).
  const u = (oy - H / 2) / k;
  const target: V3 = [up[0] * u, up[1] * u, up[2] * u];
  const eye: V3 = [target[0] - fwd[0] * D, target[1] - fwd[1] * D, target[2] - fwd[2] * D];
  const fov = 2 * Math.atan(H / k / 2 / D);
  const sw: V3 = [right[0] * sun[0] - sy * sun[2], sun[1], right[2] * sun[0] - cy * sun[2]];
  return { width: W, height: H, eye, target, fov, sun: sw, ox, oy, eps: HIT * D, yaw };
}

/** A world thinned by the hit tolerance (the raymarcher fattens every surface by it). */
export function thinned(world: BakeWorld, eps: number): BakeWorld {
  if (eps <= 0) return world;
  const box = (b: BakeBox): BakeBox => ({ ...b, h: [Math.max(1e-4, (b.h[0] ?? 0) - eps), Math.max(1e-4, (b.h[1] ?? 0) - eps), Math.max(1e-4, (b.h[2] ?? 0) - eps)] });
  return {
    capsules: (world.capsules ?? []).map((c) => ({ a: c.a, b: c.b, r: Math.max(1e-4, c.r - eps), mat: c.mat })),
    boxes: (world.boxes ?? []).map(box),
    wedges: (world.wedges ?? []).map(box),
  };
}

// ---------------------------------------------------------------- pixels

/** A colour that is in no ramp of the palette (the background's key), as 0xRRGGBB. */
export function keyColourFor(colours: ReadonlyArray<ArrayLike<number>>): number {
  const used = new Set(colours.map((c) => (((c[0] ?? 0) & 255) << 16) | (((c[1] ?? 0) & 255) << 8) | ((c[2] ?? 0) & 255)));
  // (Magenta first -- nobody paints with it -- then walk until one's free.)
  for (let i = 0; i < 1 << 24; i += 1) { const k = (0xff00ff + i * 0x010203) & 0xffffff; if (!used.has(k)) return k; }
  throw new Error("No free key colour: the palette uses every colour.");
}

/**
 * Trim one picture to its design's pixels. `src` holds it at (sx, sy) in a
 * `srcWidth`-wide RGBA buffer, rows bottom first (as GL reads them) unless
 * `topDown`; `key` (0xRRGGBB) is the background; (ox, oy) is the origin's
 * pixel in the picture (top-down). Returns the sprite, top row first.
 */
export function trimSprite(key: string, src: Uint8Array, srcWidth: number, sx: number, sy: number, w: number, h: number, keyColour: number, ox: number, oy: number, topDown = false, heights: Uint8Array | null = null): BakedSprite {
  const kr = (keyColour >> 16) & 255, kg = (keyColour >> 8) & 255, kb = keyColour & 255;
  // (Row i of the picture, top-down, in the source.)
  const rowAt = (i: number) => (topDown ? sy + i : sy + h - 1 - i);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < h; i += 1) {
    let o = (rowAt(i) * srcWidth + sx) * 4;
    for (let x = 0; x < w; x += 1, o += 4) {
      if (src[o] === kr && src[o + 1] === kg && src[o + 2] === kb) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (i < y0) y0 = i;
      y1 = i;
    }
  }
  if (x1 < 0) return { key, w: 1, h: 1, ax: ox, ay: oy, rgba: new Uint8Array(4) }; // (nothing there: one clear pixel, anchored)
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const rgba = new Uint8Array(tw * th * 4);
  // (Depth sprites: keel/render's HEIGHT_FS bytes at the same place -- 0 where a halo fell outside the design: no height.)
  const plane = heights ? new Uint8Array(tw * th * 2) : null;
  for (let i = 0; i < th; i += 1) {
    let o = (rowAt(y0 + i) * srcWidth + sx + x0) * 4;
    let d = i * tw * 4;
    for (let x = 0; x < tw; x += 1, o += 4, d += 4) {
      const r = src[o]!, g = src[o + 1]!, b = src[o + 2]!;
      if (r === kr && g === kg && b === kb) continue;
      rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = 255;
      if (plane) { plane[(i * tw + x) * 2] = heights![o]!; plane[(i * tw + x) * 2 + 1] = heights![o + 1]!; }
    }
  }
  return plane ? { key, w: tw, h: th, ax: ox - x0, ay: oy - y0, rgba, heights: plane } : { key, w: tw, h: th, ax: ox - x0, ay: oy - y0, rgba };
}

// ---------------------------------------------------------------- atlases

/** Where a baked sprite is: its atlas page and rectangle, and its anchor. */
export interface SpriteRect { readonly page: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly ax: number; readonly ay: number }
export interface BakeAtlas {
  readonly pages: AtlasPage[];
  readonly sprites: Map<string, SpriteRect>;
  /** Used area over page area. */
  readonly fill: number;
}

/** Pack baked sprites into pages. Sorted by key first: the same sprites make the same atlas, whatever order they were baked in. */
export function atlasOf(sprites: Iterable<BakedSprite>, { size = 2048, pad = 1, pow2 = false }: PackOptions = {}): BakeAtlas {
  const list = [...sprites].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const packed = packAtlas(list, { size, pad, pow2 });
  // (Depth sprites: when any sprite carries heights every page carries a height plane; a sprite without them leaves 0s -- drawn as before.)
  const withHeights = list.some((s) => s.heights);
  const pages: AtlasPage[] = packed.pages.map((p) => {
    const w = Math.max(1, p.w), h = Math.max(1, p.h);
    return withHeights ? { width: w, height: h, rgba: new Uint8Array(w * h * 4), heights: new Uint8Array(w * h * 2) } : { width: w, height: h, rgba: new Uint8Array(w * h * 4) };
  });
  const out = new Map<string, SpriteRect>();
  list.forEach((s, i) => {
    const pl = packed.places[i]!;
    const page = pages[pl.page]!;
    for (let y = 0; y < s.h; y += 1) page.rgba.set(s.rgba.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((pl.y + y) * page.width + pl.x) * 4);
    if (s.heights && page.heights) for (let y = 0; y < s.h; y += 1) page.heights.set(s.heights.subarray(y * s.w * 2, (y + 1) * s.w * 2), ((pl.y + y) * page.width + pl.x) * 2);
    out.set(s.key, { page: pl.page, x: pl.x, y: pl.y, w: s.w, h: s.h, ax: s.ax, ay: s.ay });
  });
  return { pages, sprites: out, fill: packed.fill };
}

// ---------------------------------------------------------------- the bake

export interface BakeResult extends BakeAtlas {
  /** The trimmed sprites themselves (what a cache keeps). */
  readonly baked: BakedSprite[];
  readonly stats: BakeStats;
}

const now = (): number => (globalThis.performance ? performance.now() : Date.now());

/**
 * Draw every job through the renderer and trim it (no packing): the sprites,
 * and what it cost. The renderer is the baker's for the duration -- its
 * target, palette, materials, style, fx and world are all set here -- so give
 * it one of its own (an offscreen canvas).
 */
export function renderSprites(renderer: BakeRenderer, jobs: readonly SpriteJob[], sources: BakeSources, options: BakeSpriteOptions = {}): { baked: BakedSprite[]; stats: BakeStats } {
  const t0 = now();
  const { margin = 3, compensate = true, time = 0, style = { screen: 4, dither: 0.9, outline: 1 }, fx = [], onProgress } = options;
  const gl = renderer.gl;
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const S = Math.min(options.staging ?? 2048, maxTex);
  const sourceOf = (key: string): BakeSource => {
    const s = typeof sources === "function" ? sources(key) : sources.get(key);
    if (!s) throw new RangeError(`No design "${key}" to bake.`);
    return s;
  };

  // Jobs by design (first-seen order), then by picture size: each group sets the renderer up once.
  const groups = new Map<string, SpriteJob[]>();
  for (const j of jobs) { const g = `${j.design}\u0000${j.w}x${j.h}`; (groups.get(g) ?? groups.set(g, []).get(g)!).push(j); }

  // The staging texture renders are copied into, and a framebuffer to read it back through.
  const prevUnit = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0 + 7);
  const staging = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, staging);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, S, S);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, staging, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // (Depth sprites: the heights pass into a second staging texture, when asked and the renderer can.)
  const hr = options.heights ? (renderer as Partial<IndexedBakeRenderer>) : null;
  if (hr && typeof hr.renderIndexedHeights !== "function") throw new Error("This renderer can't bake heights (renderIndexedHeights): keel/render's createPixelRenderer can.");
  let hStaging: WebGLTexture | null = null, hfb: WebGLFramebuffer | null = null;
  if (hr) {
    hStaging = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, hStaging);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, S, S);
    hfb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, hfb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hStaging, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  gl.activeTexture(prevUnit);
  let readBuf = new Uint8Array(0), hBuf = new Uint8Array(0);

  interface Slot { job: SpriteJob; x: number; y: number; w: number; h: number; ox: number; oy: number; key: number }
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
    if (hfb) {
      if (hBuf.length < S * used * 4) hBuf = new Uint8Array(S * used * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, hfb);
      gl.readPixels(0, 0, S, used, gl.RGBA, gl.UNSIGNED_BYTE, hBuf);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const r1 = now();
    readMs += r1 - r0;
    for (const s of pending) {
      const sprite = trimSprite(s.job.key, readBuf, S, s.x, s.y, s.w, s.h, s.key, s.ox, s.oy, false, hfb ? hBuf : null);
      kept += sprite.w * sprite.h;
      baked.push(sprite);
    }
    trimMs += now() - r1;
    pending = [];
    cx = 0; cy = 0; rowH = 0;
    onProgress?.(baked.length, jobs.length);
  };

  renderer.setFx?.(fx);
  renderer.setStyle(style);
  let designs = 0;
  let lastDesign = "";
  for (const list of groups.values()) {
    const first = list[0]!;
    const src = sourceOf(first.design);
    if (first.design !== lastDesign) { designs += 1; lastDesign = first.design; }
    // The design's palette, plus the key: a one-entry ramp the sky and the water wear.
    const key = keyColourFor(src.palette.colours);
    const colours = [...src.palette.colours, [(key >> 16) & 255, (key >> 8) & 255, key & 255]];
    renderer.setPalette(colours, { ...src.palette.ramps, "bake.key": [colours.length - 1, 1] });
    const mats = src.materials.slice();
    while (mats.length < 6) mats.push({ ramp: "bake.key" });
    mats[4] = { ramp: "bake.key" };
    mats[5] = { ramp: "bake.key" };
    renderer.setMaterials(mats);
    const size = bakeSize(first, margin);
    renderer.setTarget(size.width, size.height);
    if (size.width > S || size.height > S) throw new RangeError(`A ${size.width}x${size.height} sprite doesn't fit the ${S} staging texture.`);
    for (const job of list) {
      const cam = bakeCamera(job, options);
      const world = src.pose(job.clip, job.frame);
      dropped += renderer.setWorld(compensate ? thinned(world, cam.eps) : world).dropped;
      renderer.render({ eye: cam.eye, target: cam.target, fov: cam.fov, time, sun: cam.sun, waterY: -1e4, fogNear: 1e5, fogFar: 2e5 });
      // Room in the staging texture? (Shelves, left to right, bottom up.)
      if (cx + cam.width > S) { cx = 0; cy += rowH; rowH = 0; }
      if (cy + cam.height > S) flush();
      gl.activeTexture(gl.TEXTURE0 + 7);
      gl.bindTexture(gl.TEXTURE_2D, staging);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, cx, cy, 0, 0, cam.width, cam.height);
      if (hr && hStaging) {
        const hf = hr.renderIndexedHeights!({ eye: cam.eye, target: cam.target, fov: cam.fov, pixelsPerMetre: job.pixelsPerMetre, eps: compensate ? cam.eps : 0 });
        gl.activeTexture(gl.TEXTURE0 + 7);
        gl.bindTexture(gl.TEXTURE_2D, hStaging);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hf);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, cx, cy, 0, 0, cam.width, cam.height);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      }
      pending.push({ job, x: cx, y: cy, w: cam.width, h: cam.height, ox: cam.ox, oy: cam.oy, key });
      rendered += cam.width * cam.height;
      cx += cam.width;
      rowH = Math.max(rowH, cam.height);
    }
  }
  flush();
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(staging);
  if (hfb) gl.deleteFramebuffer(hfb);
  if (hStaging) gl.deleteTexture(hStaging);
  const ms = now() - t0;
  const stats: BakeStats = { sprites: baked.length, designs, ms, drawMs: ms - readMs - trimMs, readMs, trimMs, rendered, kept, dropped };
  return { baked, stats };
}

/**
 * Bake every job: draw, trim, anchor and pack. -> { pages, sprites: Map<job key, { page, x, y, w, h, ax, ay }>, baked, stats }.
 * `sources` gives each job's design (by `job.design`): its palette, materials and pose.
 */
export function bakeSprites(renderer: BakeRenderer, jobs: readonly SpriteJob[], sources: BakeSources, options: BakeSpriteOptions & { readonly pack?: PackOptions } = {}): BakeResult {
  const { baked, stats } = renderSprites(renderer, jobs, sources, options);
  return { ...atlasOf(baked, options.pack), baked, stats };
}

/** A string naming every bake option that changes pixels: put it in planBake's `style`, so keys change when they do. */
export function bakeStyleKey({ style = { screen: 4, dither: 0.9, outline: 1 }, fx = [], sun = [-0.5, 0.75, 0.45], compensate = true, distance, margin }: BakeSpriteOptions = {}): string {
  return JSON.stringify({ s: style, f: fx, l: sun, c: compensate, d: distance ?? null, m: margin ?? 3 });
}
