// The printed and moulded detail, drawn crisp at load: vector shapes and type into canvases at a chosen density,
// mipmapped by the renderer. Nothing is pixel art here except what a screen shows.
//
//   faceMasks:  the face's inks -- r accent (wordmark, bars, the big stripe, key labels), g the light stripe, b spare
//   faceHeight: the face's relief -- holes round each key with a chamfered lip (baked to normals + occlusion)
//   glassPrint: the cover glass's back print -- black, the window, the brand lettering
//   backHeight: the back's relief -- the battery door's parting line and latch
//   board:      the board's top -- traces (r), gold pads (g), silkscreen (b) over black solder mask
//   cartFace:   the cartridge's back -- embossed brand and its original label art
// All in photo-space millimetres (x right, y down) scaled to the canvas.

import { MM } from "./spec.ts";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface Surface { readonly canvas: HTMLCanvasElement | OffscreenCanvas; readonly ctx: Ctx2D; readonly width: number; readonly height: number }
export type SurfaceFactory = (w: number, h: number) => Surface;

/** A canvas: an OffscreenCanvas where there is one (workers, modern browsers), else a DOM canvas. */
export const defaultSurface: SurfaceFactory = (w, h) => {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("handheld: no 2D context");
    return { canvas, ctx, width: W, height: H };
  }
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("handheld: no 2D context");
  return { canvas, ctx, width: W, height: H };
};

export interface PrintOptions {
  /** Pixels per millimetre (the solo page draws ~13, the grid ~7). */
  readonly density: number;
  /** The CSS font stack for the wordmark and lettering (wide, heavy, geometric). */
  readonly font?: string;
  readonly surface?: SurfaceFactory;
}

const FONT = '"Stratus Title", "Archivo Black", "Arial Black", "Helvetica Neue", Arial, sans-serif';

function fitText(ctx: Ctx2D, text: string, font: string, cap: number, x0: number, x1: number | null, cx: number | null, cy: number): void {
  // Size by cap height (an M's ascent), then stretch to the width asked (the wordmark is extended). The glyphs are
  // set at their real pixel size (a 3 px font scaled up 13 times is hinted thin and blocky).
  ctx.save();
  const T = ctx.getTransform(), px = Math.hypot(T.a, T.b) || 1;
  const size = (cap / 0.72) * px;
  ctx.font = `800 ${size}px ${font}`;
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const asc = (m.actualBoundingBoxAscent || cap * px) / px;
  const k = cap / asc;
  const w = (m.width / px) * k;
  const sx = x1 !== null ? (x1 - x0) / w : 1;
  const left = cx !== null ? cx - (w * sx) / 2 : x0;
  ctx.translate(left, cy + cap / 2);
  ctx.scale((k * sx) / px, k / px);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Inks on the face: r accent, g light accent, b key labels. `stripes` only on the painted metal shells. */
export function faceMasks(o: PrintOptions & { stripes: boolean }): Surface {
  const s = (o.surface ?? defaultSurface)(MM.w * o.density, MM.h * o.density);
  const { ctx } = s, font = o.font ?? FONT;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, s.width, s.height);
  ctx.save(); ctx.scale(s.width / MM.w, s.height / MM.h);
  const R = "rgb(255,0,0)", G = "rgb(0,255,0)", B = "rgb(0,0,255)";
  ctx.globalCompositeOperation = "lighter";
  // The wordmark and its rising bar graph.
  ctx.fillStyle = R;
  const wm = MM.wordmark;
  fitText(ctx, "CHROMATIC", font, wm.cap, wm.x0, wm.x1, null, wm.y);
  { // ® after it, small and high
    ctx.save(); ctx.font = `700 ${wm.cap * 0.62}px ${font}`; ctx.textBaseline = "alphabetic";
    ctx.fillText("®", wm.x1 + 0.25, wm.y - wm.cap * 0.05); ctx.restore();
  }
  const b = MM.bars, base = wm.y + wm.cap / 2;
  for (let i = 0; i < b.n; i += 1) {
    const w = i === 0 ? b.first : b.w;
    const x = b.x0 + (i === 0 ? 0 : b.first + 1.35 + (i - 1) * b.pitch);
    const h = b.h + (b.rise[i] ?? 0);
    roundRect(ctx, x, base - h, w, h, 0.18); ctx.fill();
  }
  if (o.stripes) {
    const st = MM.stripes, m = st.margin, bottom = st.bottom;
    // The band: between y - x = c0 and c1, inside the margin.
    ctx.save();
    ctx.beginPath(); ctx.rect(m, 0, MM.w, bottom); ctx.clip();
    ctx.beginPath();
    ctx.moveTo(m, m + st.band[0]); ctx.lineTo(bottom - st.band[0], bottom); ctx.lineTo(bottom - st.band[1], bottom); ctx.lineTo(m, m + st.band[1]); ctx.closePath();
    ctx.fillStyle = R; ctx.fill();
    ctx.beginPath(); ctx.moveTo(m, m + st.triangle); ctx.lineTo(bottom - st.triangle, bottom); ctx.lineTo(m, bottom); ctx.closePath();
    ctx.fillStyle = G; ctx.fill();
    ctx.restore();
  }
  // Key labels.
  ctx.fillStyle = B;
  fitText(ctx, "A", font, 1.5, 0, null, MM.labelA.x, MM.labelA.y);
  fitText(ctx, "B", font, 1.5, 0, null, MM.labelB.x, MM.labelB.y);
  for (const [t, p, k] of [["SELECT", MM.labelSelect, MM.select], ["START", MM.labelStart, MM.start]] as const) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((-k.angle * Math.PI) / 180);
    fitText(ctx, t, font, p.cap, 0, null, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return s;
}

/** The face's relief as grey height (0.5 the face): every key sits in a hole with a chamfered lip. */
export function faceHeight(o: PrintOptions): Surface {
  const s = (o.surface ?? defaultSurface)(MM.w * o.density, MM.h * o.density);
  const { ctx } = s;
  ctx.fillStyle = "rgb(128,128,128)"; ctx.fillRect(0, 0, s.width, s.height);
  ctx.save(); ctx.scale(s.width / MM.w, s.height / MM.h);
  // Each hole: lip rings stepping down toward the gap, then the deep gap. (Drawn as nested shapes: a smooth chamfer.)
  const hole = (path: (grow: number) => void, lip: number, gap: number): void => {
    const steps = 10;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps, grow = gap + lip * (1 - t);
      const v = Math.round(128 - 46 * t * t);
      ctx.fillStyle = `rgb(${v},${v},${v})`; path(grow); ctx.fill();
    }
    ctx.fillStyle = "rgb(18,18,18)"; path(gap * 0.999); ctx.fill();
  };
  const d = MM.dpad;
  hole((g) => crossPath(ctx, d.x, d.y, d.span + 2 * g, d.arm + 2 * g, d.ro + g, Math.max(0.1, d.ri - g)), d.well, 0.32);
  for (const k of [MM.a, MM.b]) hole((g) => { ctx.beginPath(); ctx.arc(k.x, k.y, k.r + g, 0, Math.PI * 2); }, k.well, 0.32);
  for (const k of [MM.select, MM.start]) hole((g) => {
    ctx.save(); ctx.translate(k.x, k.y); ctx.rotate((-k.angle * Math.PI) / 180);
    roundRect(ctx, -k.len / 2 - g, -k.w / 2 - g, k.len + 2 * g, k.w + 2 * g, k.w / 2 + g); ctx.restore();
  }, k.well, 0.28);
  ctx.restore();
  return s;
}

/** The cover glass's back print: black everywhere but the window, and the brand above the screen. Alpha = ink. */
export function glassPrint(o: PrintOptions): Surface {
  const g = MM.glass, sc = MM.screen;
  const W = g.x1 - g.x0, H = g.y1 - g.y0;
  const s = (o.surface ?? defaultSurface)(W * o.density, H * o.density);
  const { ctx } = s, font = o.font ?? FONT;
  ctx.clearRect(0, 0, s.width, s.height);
  ctx.save(); ctx.scale(s.width / W, s.height / H); ctx.translate(-g.x0, -g.y0);
  ctx.fillStyle = "rgb(10,10,12)"; ctx.fillRect(g.x0, g.y0, W, H);
  // The window: a hair larger than the active area (the LCD's own black border shows in the gap).
  ctx.globalCompositeOperation = "destination-out";
  roundRect(ctx, sc.x0 - 0.55, sc.y0 - 0.55, sc.x1 - sc.x0 + 1.1, sc.y1 - sc.y0 + 1.1, 0.35); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgb(236,236,240)";
  fitText(ctx, "MODRETRO", font, MM.brand.cap, 0, null, MM.brand.x, MM.brand.y);
  ctx.restore();
  return s;
}

/** The back's relief: the battery door's parting line, its latch, and a fine line round the cart window. */
export function backHeight(o: PrintOptions): Surface {
  const s = (o.surface ?? defaultSurface)(MM.w * o.density, MM.h * o.density);
  const { ctx } = s;
  ctx.fillStyle = "rgb(128,128,128)"; ctx.fillRect(0, 0, s.width, s.height);
  ctx.save(); ctx.scale(s.width / MM.w, s.height / MM.h);
  // (The back is seen from behind: mirror x so the drawing lands where it is on the device.)
  ctx.translate(MM.w, 0); ctx.scale(-1, 1);
  const dr = MM.door;
  ctx.lineJoin = "round";
  for (const [w, v] of [[0.9, 104], [0.5, 60], [0.22, 30]] as const) {
    ctx.strokeStyle = `rgb(${v},${v},${v})`; ctx.lineWidth = w;
    roundRect(ctx, dr.x0, dr.y0, dr.x1 - dr.x0, dr.y1 - dr.y0, dr.r); ctx.stroke();
  }
  // The latch: a recessed tab at the door's foot with ribs.
  const lx = (dr.x0 + dr.x1) / 2;
  ctx.fillStyle = "rgb(84,84,84)"; roundRect(ctx, lx - 4.5, dr.y1 - 4.2, 9, 3.4, 0.8); ctx.fill();
  ctx.fillStyle = "rgb(150,150,150)";
  for (let i = 0; i < 4; i += 1) { ctx.fillRect(lx - 3.2 + i * 2.1, dr.y1 - 3.7, 0.5, 2.4); }
  ctx.restore();
  return s;
}

/** The board's top: traces (r), gold pads (g), silkscreen (b). Deterministic. */
export function boardMasks(o: PrintOptions): Surface {
  const s = (o.surface ?? defaultSurface)(MM.w * o.density, MM.h * o.density);
  const { ctx } = s, font = '"Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, s.width, s.height);
  ctx.save(); ctx.scale(s.width / MM.w, s.height / MM.h);
  ctx.globalCompositeOperation = "lighter";
  const rnd = mulberry(0xb0a2d);
  // Traces: 45-degree routed runs between pads, in bundles.
  ctx.strokeStyle = "rgb(255,0,0)"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let i = 0; i < 70; i += 1) {
    let x = 4 + rnd() * 68, y = 66 + rnd() * 30;
    ctx.lineWidth = rnd() < 0.2 ? 0.45 : 0.16;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 4; k += 1) {
      const len = 2 + rnd() * 9, dir = Math.floor(rnd() * 8), a = (dir * Math.PI) / 4;
      x = Math.min(73, Math.max(3, x + Math.cos(a) * len)); y = Math.min(97, Math.max(64, y + Math.sin(a) * len));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 0.32, 0, Math.PI * 2); ctx.fillStyle = "rgb(255,0,0)"; ctx.fill();
  }
  // Fixed lower-board routes: system -> power stage, audio enclosure and USB-C.
  for(const [x0,y0,x1,y1]of[[31,109,31,116],[34,119,38,126],[37,105,46,112],[46,114,55,118],[12,113,19,123],[8,120,26,122],[41,120,48,123],[51,104,57,110]]as const){
    for(let lane=0;lane<3;lane++){const o=lane*.4;ctx.lineWidth=.14;ctx.beginPath();ctx.moveTo(x0+o,y0);ctx.lineTo(x0+o,y0+2);ctx.lineTo(x1+o,y1-2);ctx.lineTo(x1+o,y1);ctx.stroke();}
  }
  // A ground pour hatch near the edges (traces' colour, faint).
  ctx.fillStyle = "rgba(255,0,0,0.18)"; ctx.fillRect(2.5, 64, 2.2, 33); ctx.fillRect(71.4, 64, 2.2, 33);
  // Gold: the key pads (interdigitated rings under the rubber domes), test points.
  ctx.strokeStyle = "rgb(0,255,0)";
  const pad = (x: number, y: number, r: number) => { ctx.lineWidth = 0.35; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.stroke(); };
  const d = MM.dpad, arm = d.span / 2 - d.arm / 2;
  pad(d.x, d.y - arm, 2.2); pad(d.x, d.y + arm, 2.2); pad(d.x - arm, d.y, 2.2); pad(d.x + arm, d.y, 2.2);
  pad(MM.a.x, MM.a.y, 3.4); pad(MM.b.x, MM.b.y, 3.4);
  pad(MM.select.x, MM.select.y, 1.8); pad(MM.start.x, MM.start.y, 1.8);
  ctx.fillStyle = "rgb(0,255,0)";
  for (let i = 0; i < 14; i += 1) { ctx.beginPath(); ctx.arc(6 + rnd() * 64, 66 + rnd() * 30, 0.45, 0, Math.PI * 2); ctx.fill(); }
  // Silkscreen: outlines and designators.
  ctx.strokeStyle = "rgb(0,0,255)"; ctx.fillStyle = "rgb(0,0,255)"; ctx.lineWidth = 0.13;
  ctx.font = `600 1.05px ${font}`;
  const labels = ["U21", "C3", "R12", "C18", "U4", "L2", "R7", "C22", "Q1", "D3", "TP4", "J2", "C9", "R31", "U7", "FB1"];
  for (let i = 0; i < labels.length; i += 1) ctx.fillText(labels[i]!, 6 + rnd() * 62, 67 + rnd() * 29);
  ctx.strokeRect(31.2, 74.2, 10.6, 10.6);
  // Assembly outlines and test pads belong to the lower components, not a stretched texture.
  for(const[x,y,w,h,label]of[[27,101,8,8,"U8"],[9,108,6,6,"U9"],[31,116,6,5,"U10"],[43,109,6,7,"U11"],[54,107,18,22,"SPK"],[33,124,10,5,"USB-C"]]as const){ctx.strokeRect(x,y,w,h);ctx.fillText(label,x,y-.7);}
  ctx.fillStyle="rgb(0,255,0)";for(const[x,y]of[[6,108],[20,115],[28,126],[43,126],[50,115]]as const){ctx.beginPath();ctx.arc(x,y,.5,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle="rgb(0,0,255)";
  ctx.font = `700 1.4px ${font}`; ctx.fillText("CHROMATIC MAIN  REV C", 8.5, 96.2);
  ctx.restore();
  return s;
}

/** The cart's plastic (the owner's rule, by the handheld it goes in): a see-through Chromatic's is smoke-clear, a
 *  metal one's solid black. */
export type CartKind = "smoke" | "black";
/** A cart's kind from its handheld's material (none yet, before the shells are dealt: smoke, as the showcase's). */
export const cartKindOf = (material: "clear" | "metal" | null | undefined): CartKind => (material === "metal" ? "black" : "smoke");

export interface CartArt {
  /** The label: the cart's sticker (pixel art, drawn nearest, whole pixels), covering the whole label. */
  readonly picture?: CanvasImageSource & { readonly width: number; readonly height: number };
  /** Without a picture, the label is set in type: these two lines. */
  readonly title: string;
  readonly subtitle: string;
  /** The plastic (default black). */
  readonly kind?: CartKind;
}

/** Where things sit on the cart's back, as fractions of its face (top, the grip end, at v 0). */
export const CART_LAYOUT = {
  band: 0.25,
  pill: { u0: 0.13, u1: 0.87, v0: 0.055, v1: 0.195 },
  label: { u0: 0.125, u1: 0.875, v0: 0.275, v1: 0.855 },
  ridges: { u1: 0, v0: 0, v1: 0 },
} as const;

/**
 * The cartridge's back, a ModRetro cart: a recessed band across the top with a raised pill, MODRETRO embossed on it;
 * plain sides; below the band, nearly full width, the label. Black: matte, a soft key light
 * from the upper left, a cool rim. Smoke: dark and see-through, darker toward its edges, its green board faint
 * through it round the label, a light rim.
 */
export function cartFace(o: PrintOptions & { art: CartArt }): Surface {
  const c = MM.cart, W = c.x1 - c.x0 - 1.4, H = c.y1 - c.y0 - 1.4, L = CART_LAYOUT;
  const smoke = o.art.kind === "smoke";
  const s = (o.surface ?? defaultSurface)(W * o.density, H * o.density);
  const { ctx } = s, font = o.font ?? FONT, px = 1 / o.density;
  const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${r},${g},${b},${a})`;
  ctx.save(); ctx.scale(s.width / W, s.height / H);
  const lb = { x: L.label.u0 * W, y: L.label.v0 * H, w: (L.label.u1 - L.label.u0) * W, h: (L.label.v1 - L.label.v0) * H };

  // The body.
  if (smoke) {
    ctx.fillStyle = rgb(30, 31, 38); ctx.fillRect(0, 0, W, H);
    // (The board through the plastic: a band under the top, down the right beside the label, a strip under it.)
    const board = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = rgb(36, 92, 62); ctx.fillRect(x, y, w, h);
      ctx.fillStyle = rgb(26, 70, 48);
      for (let ty = y + 0.8; ty < y + h; ty += 1.6) ctx.fillRect(x, ty, w, 0.25);
    };
    board(0.08 * W, L.band * H + 0.6, 0.86 * W, lb.y - L.band * H - 1.2);
    board(lb.x + lb.w + 0.4, lb.y, W * 0.985 - (lb.x + lb.w + 0.4), 0.92 * H - lb.y);
    board(0.08 * W, lb.y + lb.h + 0.5, 0.86 * W, H - (lb.y + lb.h) - 1.4);
    ctx.fillStyle = rgb(206, 164, 70, 0.55);
    for (let x = 0.12 * W; x < 0.9 * W; x += 2.6) ctx.fillRect(x, L.band * H + 1.4, 1.2, 0.7);
    // (Smoke over it, thicker toward the edges.)
    ctx.fillStyle = rgb(30, 31, 39, 0.6); ctx.fillRect(0, 0, W, H);
    const edge = (g: CanvasGradient) => { g.addColorStop(0, rgb(14, 15, 22, 0.75)); g.addColorStop(1, rgb(14, 15, 22, 0)); return g; };
    const e = Math.min(W, H) * 0.1;
    ctx.fillStyle = edge(ctx.createLinearGradient(0, 0, e, 0)); ctx.fillRect(0, 0, e, H);
    ctx.fillStyle = edge(ctx.createLinearGradient(W, 0, W - e, 0)); ctx.fillRect(W - e, 0, e, H);
    ctx.fillStyle = edge(ctx.createLinearGradient(0, H, 0, H - e)); ctx.fillRect(0, H - e, W, e);
  } else {
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H * 0.8);
    g.addColorStop(0, rgb(38, 39, 46)); g.addColorStop(1, rgb(24, 25, 31));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // The top band, recessed, its lower lip catching the light.
  ctx.fillStyle = smoke ? rgb(13, 13, 18, 0.92) : rgb(15, 15, 20); ctx.fillRect(0, 0, W, L.band * H);
  ctx.fillStyle = smoke ? rgb(70, 72, 84) : rgb(50, 51, 60); ctx.fillRect(0, L.band * H - 0.35, W, 0.35);
  // The pill, raised, its top edge lit, MODRETRO embossed.
  const pl = { x: L.pill.u0 * W, y: L.pill.v0 * H, w: (L.pill.u1 - L.pill.u0) * W, h: (L.pill.v1 - L.pill.v0) * H };
  ctx.fillStyle = rgb(36, 37, 45); roundRect(ctx, pl.x, pl.y, pl.w, pl.h, pl.h / 2); ctx.fill();
  ctx.save(); roundRect(ctx, pl.x, pl.y, pl.w, pl.h, pl.h / 2); ctx.clip();
  ctx.fillStyle = rgb(76, 78, 92); ctx.fillRect(pl.x, pl.y, pl.w, 0.3);
  ctx.restore();
  const cap = pl.h * 0.42, tx0 = pl.x + pl.h * 0.6, tx1 = pl.x + pl.w - pl.h * 0.6, ty = pl.y + pl.h / 2;
  ctx.fillStyle = rgb(16, 16, 21); fitText(ctx, "MODRETRO", font, cap, tx0, tx1, null, ty + 0.18);
  ctx.fillStyle = rgb(74, 76, 90); fitText(ctx, "MODRETRO", font, cap, tx0, tx1, null, ty);
  // Plain cartridge sides; preserve dithering only inside the original label art.


  // The label: the sticker, whole pixels; else type on cream.
  const pic = o.art.picture;
  if (pic && pic.width > 0 && pic.height > 0) {
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pic, lb.x, lb.y, lb.w, lb.h);
    ctx.restore();
  } else {
    ctx.fillStyle = rgb(236, 226, 204); roundRect(ctx, lb.x, lb.y, lb.w, lb.h, 0.8); ctx.fill();
    ctx.fillStyle = rgb(18, 16, 22); fitText(ctx, o.art.title, font, 2.4, 0, null, lb.x + lb.w / 2, lb.y + lb.h / 2);
    ctx.fillStyle = rgb(110, 100, 120); fitText(ctx, o.art.subtitle, font, 1.1, 0, null, lb.x + lb.w / 2, lb.y + lb.h / 2 + 2.6);
  }
  // (Its edge, a hair of shadow below and right.)
  ctx.fillStyle = rgb(0, 0, 0, 0.45); ctx.fillRect(lb.x + 0.2, lb.y + lb.h, lb.w, 0.25); ctx.fillRect(lb.x + lb.w, lb.y + 0.2, 0.25, lb.h);

  // The rim: lit along the top and left, dimmer round the rest (cool on black, pale on smoke).
  const rim = Math.max(px * 1.2, 0.3);
  ctx.fillStyle = smoke ? rgb(150, 156, 176, 0.95) : rgb(138, 160, 214); ctx.fillRect(0, 0, W, rim); ctx.fillRect(0, 0, rim, H);
  ctx.fillStyle = smoke ? rgb(110, 114, 132, 0.85) : rgb(62, 72, 104); ctx.fillRect(W - rim, 0, rim, H); ctx.fillRect(0, H - rim, W, rim);
  ctx.restore();
  return s;
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr); ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h); ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr); ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function crossPath(ctx: Ctx2D, cx: number, cy: number, span: number, arm: number, ro: number, ri: number): void {
  const s = span / 2, a = arm / 2;
  const pts: [number, number, number][] = [[-a, -s, ro], [a, -s, ro], [a, -a, ri], [s, -a, ro], [s, a, ro], [a, a, ri], [a, s, ro], [-a, s, ro], [-a, a, ri], [-s, a, ro], [-s, -a, ro], [-a, -a, ri]];
  ctx.beginPath();
  const n = pts.length;
  const mid = (i: number): [number, number] => { const p = pts[i % n]!, q = pts[(i + 1) % n]!; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
  const m0 = mid(n - 1);
  ctx.moveTo(cx + m0[0], cy + m0[1]);
  for (let i = 0; i < n; i += 1) { const p = pts[i]!, m = mid(i); ctx.arcTo(cx + p[0], cy + p[1], cx + m[0], cy + m[1], Math.max(0.01, p[2])); }
  ctx.closePath();
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
