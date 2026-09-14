// Frames: panels, buttons, wells, tooltips and badges, drawn procedurally as
// pixel art. A frame is a 9-slice whose slices are generated, not painted: a
// small ROLE template (outline, border, bevel light and shade, inner line,
// fill, glow, shadow, rivets) for the corner shape the theme chose -- flat,
// bevel, inset, notched, rivets, glow or round -- cached by its shape. Drawing
// maps the template onto any rectangle (corners as they are, the middle row
// and column stretched) and paints roles with the state's colours (normal,
// hover, pressed, disabled, active, primary), so one template serves every
// state. The fill is a dither texture in LAYER coordinates (panels side by
// side share one pattern), a dithered gradient, scanlines, or solid; a
// "mesh" panel leaves every other fill pixel to the game underneath.

import { SCREENS } from "@keel-engine/core";
import type { ScreenId } from "@keel-engine/core";
import type { Bitmap, Clip } from "./bitmap.ts";
import type { Rgba } from "./color.ts";
import type { Corner, Fill, Theme } from "./theme.ts";

export const ROLE = { none: 0, outline: 1, border: 2, borderLight: 3, borderDark: 4, bevelLight: 5, bevelDark: 6, inner: 7, fill: 8, glow: 9, shadow: 10, rivetLight: 11, rivetMid: 12, rivetDark: 13 } as const;

export interface FrameShape {
  readonly corner: Corner;
  readonly radius: number;
  readonly border: number;
  readonly bevel: number;
  readonly inner: boolean;
  readonly glow: number;
  readonly shadow: number;
  readonly rivets: number;
  /** Sunken: shade top-left, light bottom-right. */
  readonly sunk: boolean;
}

export interface FrameTemplate {
  readonly shape: FrameShape;
  /** Pixels outside the rectangle it frames (glow, shadow). */
  readonly margin: number;
  /** Corner slice size, margin included. */
  readonly k: number;
  /** 2k+1. */
  readonly size: number;
  readonly roles: Uint8Array;
  /** How far in the fill starts (the band: outline, border, bevel, inner line). */
  readonly band: number;
}

export const FRAME_KINDS = ["panel", "button", "inset", "tooltip", "badge", "tab", "header"] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];
export const FRAME_STATES = ["normal", "hover", "press", "disabled", "active", "primary"] as const;
export type FrameState = (typeof FRAME_STATES)[number];

/** The shape a frame kind takes in a theme. */
export function frameShape(theme: Theme, kind: FrameKind, state: FrameState = "normal"): FrameShape {
  const f = theme.frame;
  const square = f.corner === "flat" || f.corner === "bevel" || f.corner === "inset" || f.corner === "rivets";
  const base: FrameShape = { corner: f.corner, radius: f.radius, border: f.border, bevel: f.bevel, inner: f.inner, glow: f.glow, shadow: f.shadow, rivets: f.rivets, sunk: f.corner === "inset" };
  switch (kind) {
    case "panel": return base;
    case "header": return { ...base, shadow: 0, glow: 0, rivets: 0, inner: false, border: Math.max(1, f.border - 1) };
    case "button":
    case "tab": {
      const press = state === "press";
      return {
        ...base, border: Math.max(1, Math.min(2, f.border)), bevel: 1, inner: false, rivets: 0,
        glow: state === "hover" || state === "active" ? Math.min(1, f.glow) : 0, shadow: press ? 0 : Math.min(1, f.shadow), radius: Math.min(f.radius, 3),
        sunk: press !== (f.corner === "inset"),
      };
    }
    case "inset": return { ...base, corner: square ? "flat" : f.corner, border: 1, bevel: 1, inner: false, glow: 0, shadow: 0, rivets: 0, radius: Math.min(f.radius, 2), sunk: true };
    case "tooltip": return { ...base, border: Math.min(2, f.border), bevel: Math.min(1, f.bevel), rivets: 0, glow: Math.min(1, f.glow), shadow: 1, inner: false };
    case "badge": return { corner: square ? "flat" : f.corner === "notched" ? "notched" : "round", radius: 1, border: 1, bevel: 0, inner: false, glow: 0, shadow: 0, rivets: 0, sunk: false };
  }
}

const templates = new Map<string, FrameTemplate>();

/** The role template for a shape (cached). */
export function frameTemplate(shape: FrameShape): FrameTemplate {
  const key = `${shape.corner}/${shape.radius}/${shape.border}/${shape.bevel}/${+shape.inner}/${shape.glow}/${shape.shadow}/${shape.rivets}/${+shape.sunk}`;
  const hit = templates.get(key);
  if (hit) return hit;
  const margin = Math.max(shape.glow, shape.shadow);
  const band = shape.border + shape.bevel + (shape.inner ? 1 : 0);
  const cornerR = shape.corner === "round" || shape.corner === "glow" || shape.corner === "notched" ? shape.radius : 1;
  const k = margin + Math.max(band + 1, cornerR + 1, shape.rivets ? shape.border + 3 : 0);
  const size = 2 * k + 1;
  const R = size - 2 * margin;
  const inside = (rx: number, ry: number): boolean => {
    if (rx < 0 || ry < 0 || rx >= R || ry >= R) return false;
    const dl = rx, dt = ry, dr = R - 1 - rx, db = R - 1 - ry;
    const cx = Math.min(dl, dr), cy = Math.min(dt, db);
    switch (shape.corner) {
      case "notched": return cx + cy >= shape.radius;
      case "round":
      case "glow": {
        const r = shape.radius;
        if (cx >= r || cy >= r) return true;
        const ex = r - cx - 0.5, ey = r - cy - 0.5;
        return ex * ex + ey * ey <= r * r + 0.35;
      }
      case "bevel":
      case "rivets": return !(cx === 0 && cy === 0);
      default: return true;
    }
  };
  const N = size * size;
  const inMask = new Uint8Array(N);
  for (let ty = 0; ty < size; ty += 1) for (let tx = 0; tx < size; tx += 1) inMask[ty * size + tx] = inside(tx - margin, ty - margin) ? 1 : 0;
  // Depth: steps (4-neighbour) to the nearest outside pixel, inside; and outward, outside.
  const depth = new Int16Array(N).fill(-1);
  const out = new Int16Array(N).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const x = i % size, y = (i / size) | 0;
    if (!inMask[i]) continue;
    const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1 || !inMask[i - 1] || !inMask[i + 1] || !inMask[i - size] || !inMask[i + size];
    if (edge) { depth[i] = 0; frontier.push(i); }
  }
  for (let d = 1; frontier.length; d += 1) {
    const next: number[] = [];
    for (const i of frontier) for (const j of [i - 1, i + 1, i - size, i + size]) {
      if (j < 0 || j >= N || !inMask[j] || depth[j]! >= 0) continue;
      if (Math.abs((j % size) - (i % size)) > 1) continue;
      depth[j] = d; next.push(j);
    }
    frontier = next;
  }
  frontier = [];
  for (let i = 0; i < N; i += 1) if (inMask[i]) frontier.push(i);
  for (let d = 1; d <= margin && frontier.length; d += 1) {
    const next: number[] = [];
    for (const i of frontier) for (const j of [i - 1, i + 1, i - size, i + size]) {
      if (j < 0 || j >= N || inMask[j] || out[j]! >= 0) continue;
      if (Math.abs((j % size) - (i % size)) > 1) continue;
      out[j] = d; next.push(j);
    }
    frontier = next;
  }
  const roles = new Uint8Array(N);
  for (let ty = 0; ty < size; ty += 1) for (let tx = 0; tx < size; tx += 1) {
    const i = ty * size + tx;
    const rx = tx - margin, ry = ty - margin;
    if (!inMask[i]) {
      // Shadow first (below-right of the shape), then glow (all round, dithered past its first pixel).
      let role: number = ROLE.none;
      for (let s = 1; s <= shape.shadow; s += 1) {
        const sx = tx - s, sy = ty - s;
        if (sx >= 0 && sy >= 0 && inMask[sy * size + sx] && (s === 1 || ((tx + ty) & 1) === 0)) { role = ROLE.shadow; break; }
      }
      const o = out[i]!;
      if (role === ROLE.none && shape.glow && o >= 1 && o <= shape.glow && (o === 1 || ((tx + ty) & 1) === 0)) role = ROLE.glow;
      roles[i] = role;
      continue;
    }
    const d = depth[i]!;
    const dl = rx, dt = ry, dr = R - 1 - rx, db = R - 1 - ry;
    const lightSide = Math.min(dt, dl) < Math.min(db, dr) || (Math.min(dt, dl) === Math.min(db, dr) && (dt < db ? dt <= dr : dl < db));
    const lit = shape.sunk ? !lightSide : lightSide;
    let role: number;
    if (d === 0) role = ROLE.outline;
    else if (d < shape.border) role = shape.corner === "bevel" ? (lit ? ROLE.borderLight : ROLE.borderDark) : ROLE.border;
    else if (d < shape.border + shape.bevel) role = lit ? ROLE.bevelLight : ROLE.bevelDark;
    else if (shape.inner && d === shape.border + shape.bevel) role = ROLE.inner;
    else role = ROLE.fill;
    roles[i] = role;
  }
  // Rivets in the corners, just inside the border.
  if (shape.rivets) {
    const at = margin + shape.border + 1;
    for (const [cx, cy] of [[at, at], [size - 1 - at - 1, at], [at, size - 1 - at - 1], [size - 1 - at - 1, size - 1 - at - 1]] as const) {
      roles[cy * size + cx] = ROLE.rivetLight; roles[cy * size + cx + 1] = ROLE.rivetMid; roles[(cy + 1) * size + cx] = ROLE.rivetMid; roles[(cy + 1) * size + cx + 1] = ROLE.rivetDark;
    }
  }
  const t: FrameTemplate = { shape, margin, k, size, roles, band };
  templates.set(key, t);
  return t;
}

/** Colours a frame's roles are painted in. */
export interface FrameColours {
  readonly outline: Rgba; readonly border: Rgba; readonly borderLight: Rgba; readonly borderDark: Rgba;
  readonly bevelLight: Rgba; readonly bevelDark: Rgba; readonly inner: Rgba;
  readonly fill: Rgba; readonly fillAlt: Rgba; readonly glow: Rgba; readonly shadow: Rgba;
  readonly rivet: readonly [Rgba, Rgba, Rgba];
  /** How the fill is textured. */
  readonly fillKind: Fill;
  readonly screen: ScreenId;
  /** Share of fill pixels in the alternate colour (dither), 0..1. */
  readonly level: number;
}

export function frameColours(theme: Theme, kind: FrameKind, state: FrameState = "normal"): FrameColours {
  const p = theme.palette;
  const s = p.surface, a = p.accent;
  const f = theme.frame;
  const base: FrameColours = {
    outline: p.outline, border: s[1]!, borderLight: s[4]!, borderDark: s[1]!, bevelLight: s[3]!, bevelDark: s[1]!, inner: s[0]!,
    fill: s[2]!, fillAlt: s[1]!, glow: a[2]!, shadow: s[0]!, rivet: [s[5]!, s[3]!, s[0]!], fillKind: f.fill, screen: f.screen, level: 0.22,
  };
  if (p.tone === "light") Object.assign(base, { border: s[3]!, borderDark: s[1]!, bevelLight: s[5]!, bevelDark: s[3]!, inner: s[1]!, fillAlt: s[3]!, shadow: s[0]! });
  switch (kind) {
    case "panel": return base;
    case "header": return { ...base, fill: s[3]!, fillAlt: s[2]!, fillKind: f.fill === "scan" ? "scan" : "solid" };
    case "inset": return { ...base, fill: p.tone === "light" ? s[4]! : s[0]!, fillAlt: p.tone === "light" ? s[3]! : s[1]!, bevelLight: s[3]!, bevelDark: s[0]!, fillKind: "solid", level: 0 };
    case "tooltip": return { ...base, fill: s[1]!, fillAlt: s[0]!, border: a[1]!, fillKind: "solid" };
    case "badge": return { ...base, outline: s[0]!, border: s[0]!, fill: s[0]!, fillKind: "solid" };
    case "button":
    case "tab": {
      const b: FrameColours = { ...base, fill: s[3]!, fillAlt: s[2]!, bevelLight: s[4]!, bevelDark: s[1]!, border: s[1]!, fillKind: f.fill === "scan" ? "scan" : f.fill === "gradient" ? "gradient" : "solid", level: 0.3 };
      switch (state) {
        case "hover": return { ...b, border: a[1]!, borderLight: a[3]!, borderDark: a[1]!, bevelLight: s[5]!, glow: a[3]! };
        case "press": return { ...b, fill: s[2]!, fillAlt: s[1]!, bevelLight: s[3]!, bevelDark: s[0]! };
        case "disabled": return { ...b, fill: s[2]!, fillAlt: s[1]!, bevelLight: s[2]!, bevelDark: s[1]!, border: s[1]!, fillKind: "dither", level: 0.5, screen: "checker" };
        case "active": return { ...b, border: a[2]!, borderLight: a[3]!, borderDark: a[1]!, outline: a[0]!, glow: a[2]! };
        case "primary": return { ...b, fill: a[1]!, fillAlt: a[0]!, bevelLight: a[3]!, bevelDark: a[0]!, border: a[0]!, borderLight: a[3]!, borderDark: a[0]! };
        default: return b;
      }
    }
  }
}

// Screen threshold tiles, 64x64 (the stipple repeats at 64; the others divide it), made once per screen.
const TILES = new Map<ScreenId, Float32Array>();
export function screenTile(id: ScreenId): Float32Array {
  let t = TILES.get(id);
  if (!t) {
    t = new Float32Array(64 * 64);
    const at = SCREENS[id].at;
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) t[y * 64 + x] = at(x, y);
    TILES.set(id, t);
  }
  return t;
}

export interface FrameDraw {
  /** Leave every other fill pixel (a see-through panel over the game). */
  readonly mesh?: boolean;
  /** Draw only the band (outline, border, bevel), not the fill. */
  readonly hollow?: boolean;
}

/** A frame's role colours as a lookup (index = role). */
function roleTable(c: FrameColours): Uint32Array {
  const t = new Uint32Array(16);
  t[ROLE.outline] = c.outline; t[ROLE.border] = c.border; t[ROLE.borderLight] = c.borderLight; t[ROLE.borderDark] = c.borderDark;
  t[ROLE.bevelLight] = c.bevelLight; t[ROLE.bevelDark] = c.bevelDark; t[ROLE.inner] = c.inner; t[ROLE.glow] = c.glow; t[ROLE.shadow] = c.shadow;
  t[ROLE.rivetLight] = c.rivet[0]; t[ROLE.rivetMid] = c.rivet[1]; t[ROLE.rivetDark] = c.rivet[2];
  return t;
}

/** Draw a frame over (x, y, w, h) -- its glow and shadow reach `template.margin` beyond. */
export function drawFrame(dst: Bitmap, x: number, y: number, w: number, h: number, t: FrameTemplate, c: FrameColours, clip: Clip, opts: FrameDraw = {}): void {
  if (w <= 0 || h <= 0) return;
  const m = t.margin, k = t.k, size = t.size, roles = t.roles;
  const X0 = x - m, Y0 = y - m, W = w + 2 * m, H = h + 2 * m;
  const x0 = Math.max(X0, clip.x0, 0), y0 = Math.max(Y0, clip.y0, 0);
  const x1 = Math.min(X0 + W, clip.x1, dst.w), y1 = Math.min(Y0 + H, clip.y1, dst.h);
  if (x1 <= x0 || y1 <= y0) return;
  const table = roleTable(c);
  const tile = c.fillKind === "dither" || c.fillKind === "gradient" ? screenTile(c.screen) : null;
  const px = dst.px, dw = dst.w;
  const fill = c.fill, alt = c.fillAlt, level = c.level, kind = c.fillKind, mesh = !!opts.mesh, hollow = !!opts.hollow;
  // (A frame smaller than its two corners shrinks the corners' reach: the template still maps, just folded.)
  const kx = Math.min(k, W >> 1), ky = Math.min(k, H >> 1);
  for (let py = y0; py < y1; py += 1) {
    const ry = py - Y0;
    const ty = ry < ky ? ry : ry >= H - ky ? size - (H - ry) : k;
    const trow = ty * size;
    const gy = kind === "gradient" ? (py - y) / Math.max(1, h - 1) : 0;
    let o = py * dw + x0;
    for (let pxx = x0; pxx < x1; pxx += 1, o += 1) {
      const rx = pxx - X0;
      const tx = rx < kx ? rx : rx >= W - kx ? size - (W - rx) : k;
      const role = roles[trow + tx]!;
      if (role === 0) continue;
      if (role !== ROLE.fill) { px[o] = table[role]!; continue; }
      if (hollow || (mesh && ((pxx + py) & 1))) continue;
      if (kind === "solid") px[o] = fill;
      else if (kind === "scan") px[o] = (py & 1) ? alt : fill;
      else {
        const thr = tile![(py & 63) * 64 + (pxx & 63)]!;
        px[o] = thr < (kind === "gradient" ? gy * 0.85 : level) ? alt : fill;
      }
    }
  }
  // Rivets along the long edges, between the corners.
  if (t.shape.rivets && !hollow) {
    const at = t.shape.border + 1;
    const step = t.shape.rivets;
    const put = (rx: number, ry: number) => {
      const cells: Array<[number, number, Rgba]> = [[0, 0, c.rivet[0]], [1, 0, c.rivet[1]], [0, 1, c.rivet[1]], [1, 1, c.rivet[2]]];
      for (const [dx, dy, col] of cells) {
        const qx = x + rx + dx, qy = y + ry + dy;
        if (qx >= clip.x0 && qy >= clip.y0 && qx < clip.x1 && qy < clip.y1 && qx >= 0 && qy >= 0 && qx < dst.w && qy < dst.h) px[qy * dw + qx] = col;
      }
    };
    const inner = k - m;
    for (let rx = inner + step; rx < w - inner - step / 2; rx += step) { put(rx, at); put(rx, h - at - 2); }
    for (let ry = inner + step; ry < h - inner - step / 2; ry += step) { put(at, ry); put(w - at - 2, ry); }
  }
}
