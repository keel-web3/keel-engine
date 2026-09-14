// Depth sprites: the engine's one occlusion model, as maths (docs/ARCHITECTURE.md
// "Occlusion and layers"). The shaders that draw sprites (sprites.ts, and
// keel/worldgen's dungeon renderer) use SPRITE_DEPTH_GLSL; the CPU side --
// picking, the occlusion checks, the tests -- uses the functions here, the
// same formula.
//
// The view is orthographic and pitched (view.ts). A picture pixel is a ray
// along the view's forward; the ray meets each height y exactly once (it
// falls sin(pitch) per metre). So a sprite texel's PIXEL and its HEIGHT (baked
// per texel: indexed.ts) fix the 3D point it shows -- and so its depth --
// exactly, whatever the sprite's footprint:
//
//   depth = anchorDepth + (cos(pitch) * db - kappa * y) / sin(pitch)
//
//   anchorDepth  the depth of the sprite's ground anchor (its position)
//   db           metres up the picture from the anchor to the texel's pixel
//                (the pixel as drawn: the anchor's snap to a whole pixel drops out)
//   y            metres above the anchor (the texel's height, x scale / k)
//   kappa        which depth: 1 for the VIEW's (distance along forward -- the
//                dungeon's walls and floors), cos^2(pitch) for the GROUND's
//                (distance along the heading, height ignored -- keel/terrain's
//                heightfield convention, sprites placed by spritePosition)
//
// The ground under a thing never hides it: a texel's height is >= 0, so it is
// on or before the ground point its own pixel's ray meets. Walls, props and
// units hide each other exactly where their surfaces are in front, per pixel.

import { dcos, dsin } from "@keel-engine/core";
import type { BakeWorld } from "./bake.ts";
import { decodeHeight, heightAt } from "./indexed.ts";
import { worldBounds } from "./stages.ts";
import type { PixelView, Vec3 } from "./view.ts";

/** Which depth the scene writes: the view's forward distance (real geometry: the dungeon) or the ground plane's heading distance (keel/terrain). */
export type DepthAxis = "view" | "ground";

/** kappa (see the top of this file) for a depth axis at a pitch whose cosine is `cp`. */
export const depthKappa = (axis: DepthAxis, cp: number): number => (axis === "view" ? 1 : cp * cp);

/**
 * The GLSL both sprite shaders share. `anchorDepth` in metres (the depth axis's), `anchorB` the anchor's metres up
 * the picture from its centre (unsnapped), `fragB` the fragment's, `y` metres above the anchor.
 */
export const SPRITE_DEPTH_GLSL = `
// Depth sprites (keel/bake depth.ts): the depth of the point a texel shows, from its pixel and its height.
float spriteTexelDepth(float anchorDepth, float anchorB, float fragB, float y, float cp, float sp, float kappa) {
  return anchorDepth + (cp * (fragB - anchorB) - kappa * y) / max(sp, 0.05);
}`;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A world point's depth on an axis, metres from the view's centre (the sprite renderer's: nearer is smaller). */
export function pointDepth(view: PixelView, p: Vec3, axis: DepthAxis = "view"): number {
  const f = view.axes.forward, c = view.center;
  if (axis === "view") return dot([p[0] - c[0], p[1] - c[1], p[2] - c[2]], f);
  // (Ground: cos(pitch) x the heading distance, less the centre's forward -- what keel/terrain's ground writes.)
  const cp = view.axes.up[1];
  const hx = f[0] / Math.max(cp, 1e-6), hz = f[2] / Math.max(cp, 1e-6);
  return cp * (p[0] * hx + p[2] * hz) - dot(c, f);
}

/** The anchor's metres up the picture from the view's centre (unsnapped). */
export const anchorB = (view: PixelView, p: Vec3): number => dot([p[0] - view.center[0], p[1] - view.center[1], p[2] - view.center[2]], view.axes.up);

/** A picture row (pixels from the top, a pixel's centre at +0.5) as metres up the picture from the centre. */
export const rowB = (view: PixelView, row: number): number => (view.height / 2 - row) / view.pixelsPerMetre;

/** The depth of a texel drawn at picture row `row`, `y` metres above its anchor `p` (see the top of this file). */
export function texelDepth(view: PixelView, p: Vec3, row: number, y: number, axis: DepthAxis = "view", anchorDepth = pointDepth(view, p, axis)): number {
  const cp = view.axes.up[1], sp = -view.axes.forward[1];
  return anchorDepth + (cp * (rowB(view, row) - anchorB(view, p)) - depthKappa(axis, cp) * y) / Math.max(sp, 0.05);
}

/** The world point a texel shows: the ray through picture pixel (px, py) at height `y` (metres, absolute). */
export function pixelPoint(view: PixelView, px: number, py: number, y: number): [number, number, number] {
  const { right, up, forward } = view.axes, c = view.center, k = view.pixelsPerMetre;
  const a = (px - view.width / 2) / k, b = (view.height / 2 - py) / k;
  const o: Vec3 = [c[0] + right[0] * a + up[0] * b, c[1] + right[1] * a + up[1] * b, c[2] + right[2] * a + up[2] * b];
  const t = forward[1] === 0 ? 0 : (y - o[1]) / forward[1];
  return [o[0] + forward[0] * t, y, o[2] + forward[2] * t];
}

/** Where a sprite anchored at `p` lands: its anchor's whole pixel (the sprite renderer's snap; x right, y down). */
export function anchorPixel(view: PixelView, p: Vec3): [number, number] {
  const d: Vec3 = [p[0] - view.center[0], p[1] - view.center[1], p[2] - view.center[2]];
  return [Math.floor(view.width / 2 + dot(d, view.axes.right) * view.pixelsPerMetre + 0.5), Math.floor(view.height / 2 - dot(d, view.axes.up) * view.pixelsPerMetre + 0.5)];
}

/** A sprite as the CPU sees it: its atlas rect's texels (RGBA, indexed or plain) and heights, and where it's drawn. */
export interface PickSprite {
  /** Its ground anchor (the instance's position, before any spritePosition shift). */
  readonly at: Vec3;
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
  /** Texels, w x h x 4 (a texel is there when r & 63 for indexed, or a >= 128 for plain). */
  readonly rgba: Uint8Array;
  /** Heights, two bytes a texel (indexed.ts). */
  readonly heights?: Uint8Array | undefined;
  readonly indexed?: boolean;
  /** Texels per picture pixel (default 1). */
  readonly scale?: number;
}

/** The picture rectangle a sprite covers [x0, y0, x1, y1) (pixels). */
export function spriteRect(view: PixelView, s: Pick<PickSprite, "at" | "w" | "h" | "ax" | "ay" | "scale">): [number, number, number, number] {
  const [x, y] = anchorPixel(view, s.at);
  const sc = s.scale ?? 1;
  const x0 = x - Math.floor(s.ax * sc + 0.5), y0 = y - Math.floor(s.ay * sc + 0.5);
  return [x0, y0, x0 + Math.floor(s.w * sc + 0.5), y0 + Math.floor(s.h * sc + 0.5)];
}

/**
 * The texel a sprite shows at picture pixel (px, py) -- its height in metres above the anchor (NaN without heights)
 * and its depth -- or null where it shows nothing. The sprite renderer's mapping, texel for texel.
 */
export function spriteTexelAt(view: PixelView, s: PickSprite, px: number, py: number, axis: DepthAxis = "view"): { tx: number; ty: number; y: number; depth: number } | null {
  const [x0, y0, x1, y1] = spriteRect(view, s);
  if (px < x0 || py < y0 || px >= x1 || py >= y1) return null;
  const sc = s.scale ?? 1;
  // (The quad's texture coordinate runs across the drawn rect: a picture pixel's centre falls in texel floor(...).)
  const tx = Math.min(s.w - 1, Math.floor(((px + 0.5 - x0) / (x1 - x0)) * s.w)), ty = Math.min(s.h - 1, Math.floor(((py + 0.5 - y0) / (y1 - y0)) * s.h));
  const o = (ty * s.w + tx) * 4;
  const on = s.indexed === false ? s.rgba[o + 3]! >= 128 : (s.rgba[o]! & 63) !== 0;
  if (!on) return null;
  const hv = s.heights ? heightAt(s.heights, ty * s.w + tx) : 0;
  const y = hv ? (decodeHeight(hv) * sc) / view.pixelsPerMetre : NaN;
  const depth = Number.isNaN(y) ? pointDepth(view, s.at, axis) : texelDepth(view, s.at, py + 0.5, y, axis);
  return { tx, ty, y, depth };
}

/**
 * Picking by what's drawn: the nearest sprite whose texel covers picture pixel (px, py), by the same depth the
 * picture's depth test used -- so a click hits what you see (the front of two overlapping units; not a wall-hidden
 * one when `hiddenBy` says the scene is nearer there). Returns the sprite's index, or -1.
 */
export function pickSprite(view: PixelView, sprites: readonly PickSprite[], px: number, py: number, { axis = "view", hiddenBy }: { readonly axis?: DepthAxis; readonly hiddenBy?: (depth: number) => boolean } = {}): number {
  let best = -1, bd = Infinity;
  sprites.forEach((s, i) => {
    const t = spriteTexelAt(view, s, Math.floor(px), Math.floor(py), axis);
    if (t && t.depth < bd && !(hiddenBy?.(t.depth) ?? false)) { bd = t.depth; best = i; }
  });
  return best;
}

/** A design's footprint box from its solids: [x0, y0, z0, x1, y1, z1] in its own frame (the ground anchor at the origin). */
export const designBounds = (world: BakeWorld): [number, number, number, number, number, number] => worldBounds(world);

/**
 * A footprint box placed (turned by `yaw` about its anchor, moved to `at`) -- the world AABB selection, culling
 * and coarse picking share: [x0, y0, z0, x1, y1, z1].
 */
export function placedBounds(b: readonly [number, number, number, number, number, number], at: Vec3, yaw = 0): [number, number, number, number, number, number] {
  const c = dcos(yaw), s = dsin(yaw);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const lx of [b[0], b[3]]) for (const lz of [b[2], b[5]]) {
    // (The frame convention: yaw turns +z toward +x.)
    const x = lx * c + lz * s, z = -lx * s + lz * c;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return [at[0] + x0, at[1] + b[1], at[2] + z0, at[0] + x1, at[1] + b[4], at[2] + z1];
}

/** The picture rectangle a world box covers (its eight corners projected): [x0, y0, x1, y1] -- a selection box, a cull test. */
export function boundsRect(view: PixelView, b: readonly [number, number, number, number, number, number]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
    const [px, py] = view.project([x, y, z]);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------- the layers

/**
 * The engine's draw layers, in order, with their fixed depth rules (docs/ARCHITECTURE.md "Occlusion and layers").
 * Every renderer draws in this order and sets its state from here (applyLayer), so the rules are one table:
 *
 *   ground       floors, terrain, water: tested, written (the floor plane; keel/terrain's ground-plane depth)
 *   decals       contact shadows, selection rings, ground marks: tested, NEVER written -- nothing standing is ever
 *                hidden by one, and a wall in front hides it
 *   objects      walls, doors, caps, props, units: tested, written -- real geometry and depth sprites, per pixel
 *   translucent  particles, flames, glows: tested, not written, drawn back to front
 *   through      what shows through walls: the hero's silhouette, a selected unit's -- drawn only where it's HIDDEN
 *                (the depth test inverted), never written
 *   overlays     health bars, markers, labels: screen-space, no depth; drawn for a thing only while some of it is
 *                seen (or it's selected / the player's own) -- never a bar floating over a wall with nothing behind
 *   fog          fog of war, the light: colour only -- in each shader or over the picture, never depth (an unexplored
 *                room is masked, not hidden by depth)
 *   ui           the HUD: last, no depth
 */
export interface OcclusionLayer {
  readonly name: "ground" | "decals" | "objects" | "translucent" | "through" | "overlays" | "fog" | "ui";
  /** The depth test: "less-equal" (the usual), "greater" (only where hidden: through), or none. */
  readonly test: "less-equal" | "greater" | "none";
  readonly write: boolean;
  /** Draw order within the layer: none (depth sorts it) or back to front (blended things). */
  readonly sort: "none" | "back-to-front";
}
export const OCCLUSION_LAYERS: readonly OcclusionLayer[] = Object.freeze([
  { name: "ground", test: "less-equal", write: true, sort: "none" },
  { name: "decals", test: "less-equal", write: false, sort: "none" },
  { name: "objects", test: "less-equal", write: true, sort: "none" },
  { name: "translucent", test: "less-equal", write: false, sort: "back-to-front" },
  { name: "through", test: "greater", write: false, sort: "none" },
  { name: "overlays", test: "none", write: false, sort: "none" },
  { name: "fog", test: "none", write: false, sort: "none" },
  { name: "ui", test: "none", write: false, sort: "none" },
] as const);

/** A layer by name. */
export const layerOf = (name: OcclusionLayer["name"]): OcclusionLayer => OCCLUSION_LAYERS.find((l) => l.name === name)!;

/** Set GL's depth state for a layer (the test, the write). */
export function applyLayer(gl: WebGL2RenderingContext, name: OcclusionLayer["name"]): void {
  const L = layerOf(name);
  if (L.test === "none") gl.disable(gl.DEPTH_TEST);
  else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(L.test === "greater" ? gl.GREATER : gl.LEQUAL); }
  gl.depthMask(L.write);
}

/**
 * The overlay rule: whether a thing's bar or marker draws this frame -- while any of it is seen (`visiblePixels`, from
 * an ID picture or an occlusion query), or always when it's selected or the player's own.
 */
export const overlayShows = (visiblePixels: number, { selected = false, own = false }: { readonly selected?: boolean; readonly own?: boolean } = {}): boolean => visiblePixels > 0 || selected || own;
