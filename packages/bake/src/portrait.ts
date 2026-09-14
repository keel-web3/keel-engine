// Portraits: a unit's or a building's own design, close up, as an animated
// pixel-art avatar -- the "comm screen" a classic strategy console shows for
// what's selected. Generated, never drawn by hand: the subject's design is
// baked (indexed, like its sprites) at a portrait's scale and angle, painted
// through the SAME look it wears in the world (team colours and all, the
// layer shader's rules on the CPU), framed, and animated from what the pixels
// are:
//
//   units      head and shoulders (framed on the head's slots), three views
//              (a glance each way), two breaths. It blinks (its EYE slot's
//              pixels closed with the lid's colour), looks around, TALKS while
//              told to (a mouth under its eyes or on its snout's lower edge
//              opening in syllables; a visor's glow flickering if its head is
//              covered), fills with signal noise as it's hurt (speckle, torn
//              rows, a rolling bar), and flashes when hit. A hero gets an
//              elite frame and a richer screen.
//   buildings  the whole design close up: its GLOW-finished pixels are its
//              lights (pulsing; chasing while it works), its metal gets a
//              sweeping glint (faster while working), smoke from its highest
//              points, sparks while it works; cracks, smoke and fire as it's
//              damaged; its construction stages while it goes up.
//
// Bake once, animate for nothing: a subject's sprites are baked once per design
// (the look is painted, not baked), its SHEET -- every view and breath painted,
// the closed-eye frames, the masks -- once per (design, look), and a frame is a
// 60x56 composite of those (well under 0.1 ms).
//
//   const P = createPortraits(table);
//   for (const job of P.need(subject)) bakeIt(job);        // bakeSlice() / a bake worker: they're SpriteJobs
//   P.offer(job, sprite);                                   // each sprite as it arrives
//   const sheet = P.sheet(subject, look);                   // null until its sprites are in
//   if (sheet) P.draw(sheet, { t, talk, hp01, flash, team }, pixels);   // 0xAABBGGRR words, w x h

import type { DesignSpec, SpriteJob } from "./plan.ts";
import { spriteBox, spriteKey } from "./plan.ts";
import type { LookTable } from "./looks.ts";
import { LOOKS_PER_ROW, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW } from "./looks.ts";
import { BODY_SLOTS, WORN_SLOT } from "./shapes.ts";

export const PORTRAIT_W = 60;
/** A unit's head, as a share of the portrait's height. */
export const HEAD_SHARE = 0.36;
export const PORTRAIT_H = 56;

const slot = (name: (typeof BODY_SLOTS)[number]): number => BODY_SLOTS.indexOf(name);
const S_HEAD = slot("head"), S_SNOUT = slot("snout"), S_EYE = slot("eye"), S_NOSE = slot("nose");
/** A body's slots that make its head (what a unit's portrait is framed on). */
export const HEAD_SLOTS: readonly number[] = ["head", "snout", "nose", "eye", "ear", "innerEar", "hair", "brow", "antler", "hood"].map((n) => slot(n as (typeof BODY_SLOTS)[number]));
const HEAD_SET = new Set(HEAD_SLOTS);
const WORN_TRIM = slot("worn.trim");

/** What a portrait shows. */
export interface PortraitSubject {
  readonly spec: DesignSpec;
  /** A unit (head and shoulders), a building (all of it, with lights and smoke), or a prop (all of it, plain). */
  readonly kind: "unit" | "building" | "prop";
  /** A unit's head at its idle pose (metres, at the origin facing +z): its centre and radius -- `headOf(body)`. */
  readonly head?: { readonly c: readonly [number, number, number]; readonly r: number } | null;
  /** The bake's style string (default "indexed"; a plain prop passes its own). */
  readonly style?: string;
  /** A hero or elite: an elite frame and a richer screen. */
  readonly hero?: boolean;
  /** The pose clip (units: "idle"; others: the design's first clip). */
  readonly clip?: string;
  /** A construction clip to bake too (buildings: withStages' "stage"). */
  readonly stage?: string;
  /** Four legs: framed from a little more to the side. */
  readonly quadruped?: boolean;
}

/** Something that poses capsules with slots (a BodyShape). */
export interface PosedBody { capsules(clip: string, frame: number): ReadonlyArray<{ readonly a: ArrayLike<number>; readonly b: ArrayLike<number>; readonly r: number; readonly mat?: number | undefined }> }

/** The head's core (what a portrait is scaled by): not its ears, hair, antlers or hood, which may reach far. */
const CORE_SET = new Set(["head", "snout", "nose", "eye", "brow"].map((n) => slot(n as (typeof BODY_SLOTS)[number])));

/** A body's head at its idle pose (the capsules of its head's core): centre and radius, metres. Null if it has none. */
export function headOf(body: PosedBody, clip = "idle"): { c: [number, number, number]; r: number } | null {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (const c of body.capsules(clip, 0)) {
    if (c.mat === undefined || !CORE_SET.has(c.mat)) continue;
    for (const p of [c.a, c.b]) for (let i = 0; i < 3; i += 1) { lo[i] = Math.min(lo[i]!, (p[i] ?? 0) - c.r); hi[i] = Math.max(hi[i]!, (p[i] ?? 0) + c.r); }
    n += 1;
  }
  if (!n) return null;
  // (Its radius as a portrait sees it: across and up -- a long snout reaching toward the viewer doesn't shrink the head.)
  return { c: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2], r: Math.max(0.05, Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!) / 2) };
}

/** How a subject is baked for its portrait: the scale, the angle, the directions and the views (glances). */
export interface PortraitPlan {
  readonly k: number;
  readonly pitch: number;
  readonly dirs: number;
  /** Direction indices: [centre, glance one way, glance the other] (a building: one). */
  readonly views: readonly number[];
  readonly clip: string;
  /** The pose clip's frames baked (breaths). */
  readonly frames: readonly number[];
  readonly jobs: readonly SpriteJob[];
}

/** The plan for a subject at a portrait size. */
export function portraitPlan(subject: PortraitSubject, w = PORTRAIT_W, h = PORTRAIT_H): PortraitPlan {
  const d = subject.spec;
  const style = subject.style ?? "indexed";
  const clipName = subject.clip ?? (subject.kind === "unit" ? (d.clips.some((c) => c.name === "idle") ? "idle" : d.clips[0]!.name) : d.clips[0]!.name);
  const clip = d.clips.find((c) => c.name === clipName) ?? d.clips[0]!;
  let k: number, pitch: number, dirs: number, views: number[], frames: number[];
  if (subject.kind === "unit") {
    pitch = 0.2;
    dirs = d.symmetric ? 1 : 16;
    // (A quadruped from nearly in front -- its face, not its flank running out of the frame.)
    views = dirs === 1 ? [0] : subject.quadruped ? [1, 0, 2] : [1, 15, 2];
    const head = subject.head;
    // (The head about 36% of the frame's height -- head, shoulders and what it holds and wears: a type reads by its gear;
    // without a head, the whole thing a bit bigger than the frame.)
    k = head ? (HEAD_SHARE * h) / (2 * head.r) : (1.25 * h) / Math.max(0.2, d.height * Math.cos(pitch) + 2 * d.radius * Math.sin(pitch));
    frames = clip.frames > 2 ? [0, Math.floor(clip.frames / 2)] : [0];
  } else {
    pitch = 0.55;
    dirs = d.symmetric ? 1 : 8;
    views = [dirs === 1 ? 0 : 1];
    // (A close-up: its bounding radius is generous, so it's framed a third bigger and the frame may crop its edges.)
    k = 1.35 * Math.min((w - 6) / Math.max(0.2, 2 * d.radius), (h - 6) / Math.max(0.2, d.height * Math.cos(pitch) + 2 * d.radius * Math.sin(pitch)));
    frames = [0];
  }
  k = Math.round(Math.max(4, Math.min(240, k)) * 100) / 100;
  const box = spriteBox(d, k, pitch);
  const jobs: SpriteJob[] = [];
  const job = (c: string, frame: number, dir: number) => jobs.push({ key: `portrait|${spriteKey(d.key, c, frame, dir, dirs, k, pitch, style)}`, design: d.key, clip: c, frame, direction: dir, angle: (dir / dirs) * Math.PI * 2, w: box.w, h: box.h, pixelsPerMetre: k, pitch, style });
  for (const v of views) for (const f of frames) job(clip.name, f, v);
  if (subject.stage) { const st = d.clips.find((c) => c.name === subject.stage); if (st) for (let f = 0; f < st.frames; f += 1) job(st.name, f, views[0]!); }
  return { k, pitch, dirs, views, clip: clip.name, frames, jobs };
}

/** A baked sprite as it arrives (bakeSlice's, a worker's): texels trimmed, w x h, RGBA bytes. */
export interface PortraitSprite { readonly w: number; readonly h: number; readonly rgba: Uint8Array }

/** One view's painted pictures and what animates on them. */
export interface PortraitView {
  /** Per breath: the painted picture (w x h words, 0 = nothing there). */
  readonly frames: readonly Uint32Array[];
  /** The same with its eyes closed (a unit; else the frames). */
  readonly closed: readonly Uint32Array[];
  /** Pixel indices: its eyes, its mouth line, its lights (glow finish), its metal, its visor (a covered head's glow). */
  readonly eyes: Int32Array;
  readonly mouth: Int32Array;
  readonly lights: Int32Array;
  readonly metal: Int32Array;
  readonly visor: Int32Array;
  /** Where smoke comes from (a building's highest points), pixel indices. */
  readonly vents: Int32Array;
  /** Every painted pixel (for cracks, fire, sparks). */
  readonly body: Int32Array;
}
/** A subject's portrait in one look: made once, drawn every frame. */
export interface PortraitSheet {
  readonly key: string;
  readonly kind: PortraitSubject["kind"];
  readonly hero: boolean;
  readonly w: number;
  readonly h: number;
  readonly views: readonly PortraitView[];
  /** A building's construction stages (painted), if baked. */
  readonly stages: readonly Uint32Array[];
  /** Colours it animates with (0xAABBGGRR): dark (a mouth, cracks), light (lights lit), its average body colour. */
  readonly dark: number;
  readonly light: number;
  readonly mean: number;
  /** A number from its key (so two subjects don't blink together). */
  readonly seed: number;
  /** ms to paint it. */
  readonly ms: number;
}

/** What a frame shows. */
export interface PortraitState {
  /** Seconds (any clock). */
  readonly t: number;
  /** Per individual: two of one type don't blink or glance together. */
  readonly seed?: number;
  /** Seconds since a talk began (negative or absent: not talking); a talk lasts `talkFor` seconds (default 0.7). */
  readonly talk?: number;
  readonly talkFor?: number;
  /** Health 0..1 (1: whole). */
  readonly hp01?: number;
  /** A hit's flash 0..1. */
  readonly flash?: number;
  /** The team's colour (the screen's tint), RGB 0..255. */
  readonly team?: readonly [number, number, number];
  /** A building producing or researching. */
  readonly working?: boolean;
  /** A building going up: the stage frame to show (-1 or absent: complete). */
  readonly stage?: number;
}

export interface Portraits {
  /** The jobs a subject still needs baked (none once it has them; asked-for jobs aren't asked for again until `forget`). */
  need(subject: PortraitSubject): SpriteJob[];
  /** A baked sprite: true if it was one of a portrait's. */
  offer(job: SpriteJob | { readonly key: string }, sprite: PortraitSprite): boolean;
  /** Has it every sprite it needs? */
  ready(subject: PortraitSubject): boolean;
  /** Its sheet in a look (a look table index; -1 for a plain prop): painted once per (design, look). Null until ready. */
  sheet(subject: PortraitSubject, look: number): PortraitSheet | null;
  /** One frame of a portrait into `out` (sheet.w x sheet.h words). */
  draw(sheet: PortraitSheet, state: PortraitState, out: Uint32Array): void;
  /** Drop a subject's jobs that were asked for but never came (so need() asks again). */
  forget(subject: PortraitSubject): void;
  readonly stats: { readonly sprites: number; readonly sheets: number; readonly paintMs: number; readonly draws: number; readonly drawMs: number };
}

// ---------------------------------------------------------------- the layer shader, on the CPU

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer4 = (x: number, y: number): number => (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;
const fract = (x: number): number => x - Math.floor(x);
const hash12 = (x: number, y: number): number => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const vnoise = (x: number, y: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
};
const finishOf = (f: number, s: number): number => (f === 1 ? 0.08 + 0.9 * s : f === 2 ? Math.pow(Math.max(s, 0), 0.9) : f === 3 ? Math.max(0, Math.min(1, (s - 0.42) * 1.9 + 0.5)) : f === 4 ? 0.45 + 0.6 * s : s);
const marksOf = (kind: number, u: number, v: number, freq: number, ang: number, w: number): number => {
  if (kind === 1) { const a = ang * 0.3926991; return fract((u * Math.cos(a) + v * Math.sin(a) * 0.5) * freq * 2) < w ? 1 : 0; }
  if (kind === 2) return fract(v * freq) < w ? 1 : 0;
  if (kind === 3) { const gx = u * freq * 4, gy = v * freq * 2; const cx = Math.floor(gx), cy = Math.floor(gy); const fx = fract(gx) - 0.5, fy = fract(gy) - 0.5; return hash12(cx, cy) > 0.4 && Math.hypot(fx, fy) < w * 0.7 ? 1 : 0; }
  if (kind === 4) return (Math.floor(u * freq * 4) + Math.floor(v * freq * 2)) % 2 === 0 ? 0 : 1;
  if (kind === 5) return vnoise(u * (freq * 4 + 3), v * (freq * 2 + 2)) >= 1 - w * 0.9 ? 1 : 0;
  if (kind === 7) return v < w * 0.08 || v > 1 - w * 0.08 ? 1 : 0;
  return 0;
};
const word = (r: number, g: number, b: number): number => ((255 << 24) | (Math.max(0, Math.min(255, Math.round(b))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(r)))) >>> 0;
const R = (c: number): number => c & 255, G = (c: number): number => (c >>> 8) & 255, B = (c: number): number => (c >>> 16) & 255;
const mix = (c: number, d: number, t: number): number => word(R(c) + (R(d) - R(c)) * t, G(c) + (G(d) - G(c)) * t, B(c) + (B(d) - B(c)) * t);
const lum = (c: number): number => 0.3 * R(c) + 0.59 * G(c) + 0.11 * B(c);

/** The look table's textures, read once per version. */
interface Tex { version: number; looks: Uint32Array; lookW: number; paints: Uint32Array; palette: Uint8Array }

/**
 * Paint an indexed sprite through a look, the layer shader's rules on the CPU (finish, pattern, a 4x4 screen anchored
 * at `ox, oy`, the outline `outline` entries darker): RGBA words, 0 where nothing is. `finishes` (optional) gets each
 * pixel's finish (0 matte .. 4 glow; 255 nothing).
 */
export function paintIndexed(sprite: PortraitSprite, look: number, table: LookTable, { outline = 1, dither = 0.9, ox = 0, oy = 0, finishes }: { outline?: number; dither?: number; ox?: number; oy?: number; finishes?: Uint8Array } = {}): Uint32Array {
  return paintWith(sprite, look, texOf(table, null), { outline, dither, ox, oy, ...(finishes ? { finishes } : {}) });
}
function texOf(table: LookTable, had: Tex | null): Tex {
  if (had && had.version === table.version) return had;
  const t = table.texture();
  return { version: table.version, looks: t.data, lookW: t.width, paints: table.paintTexture().data, palette: table.palette().rgba };
}
function paintWith(sprite: PortraitSprite, look: number, T: Tex, { outline, dither, ox, oy, finishes }: { outline: number; dither: number; ox: number; oy: number; finishes?: Uint8Array }): Uint32Array {
  const { w, h, rgba } = sprite;
  const out = new Uint32Array(w * h);
  if (finishes) finishes.fill(255);
  const plain = look < 0;
  const row = Math.floor(look / LOOKS_PER_ROW), col = look % LOOKS_PER_ROW;
  const lookAt = (row * T.lookW + col * LOOK_TEXELS) * 4;
  const pal = (i: number): number => { const o = i * 4; return word(T.palette[o]!, T.palette[o + 1]!, T.palette[o + 2]!); };
  void PALETTE_ROW; void PAINTS_PER_ROW;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4;
    const r = rgba[i]!;
    if (plain) { if (rgba[i + 3]! >= 128) out[y * w + x] = word(r, rgba[i + 1]!, rgba[i + 2]!); continue; }
    const s = r & 63;
    if (!s) continue;
    const p = T.looks[lookAt + (s - 1)] ?? 0;
    if (!p) continue;
    const o = (p - 1) * 8;
    let base = T.paints[o]!;
    let len = Math.max(1, T.paints[o + 1]! & 255);
    const fin = (T.paints[o + 1]! >>> 8) & 255;
    const t = finishOf(fin, rgba[i + 1]! / 255);
    const pz = T.paints[o + 2]!;
    const kind = pz & 15;
    let xv = t * (len - 1);
    const u = rgba[i + 2]! / 255, v = rgba[i + 3]! / 255;
    if (kind === 6) xv += (0.5 - v) * 2 * (T.paints[o + 3]! - 8);
    else if (kind > 0 && marksOf(kind, u, v, (pz >>> 4) & 15, (pz >>> 8) & 15, ((pz >>> 12) & 15) / 8) > 0.5) {
      if (T.paints[o + 5]! > 0) { base = T.paints[o + 4]!; len = Math.max(1, T.paints[o + 5]!); xv = t * (len - 1); }
      else xv += T.paints[o + 3]! - 8;
    }
    xv += (bayer4(x + ox, y + oy) - 0.5) * dither;
    let idx = Math.max(0, Math.min(len - 1, Math.floor(xv + 0.5)));
    if (r & 128) idx = Math.max(0, idx - outline);
    out[y * w + x] = pal(base + idx);
    if (finishes) finishes[y * w + x] = fin;
  }
  return out;
}

// ---------------------------------------------------------------- a small seeded hash (frame-rate independent noise)

const mix32 = (a: number): number => { let x = a | 0; x = Math.imul(x ^ (x >>> 16), 0x7feb352d); x = Math.imul(x ^ (x >>> 15), 0x846ca68b); return (x ^ (x >>> 16)) >>> 0; };
const rnd = (a: number, b: number, c = 0): number => mix32(mix32(mix32(a) ^ (b | 0)) ^ (c | 0)) / 4294967296;
const strHash = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };

// ---------------------------------------------------------------- the portraits

export function createPortraits(table: LookTable, { w = PORTRAIT_W, h = PORTRAIT_H }: { w?: number; h?: number } = {}): Portraits {
  const sprites = new Map<string, PortraitSprite>();
  const asked = new Set<string>();
  const plans = new Map<string, PortraitPlan>();
  const sheets = new Map<string, PortraitSheet>();
  let tex: Tex | null = null;
  const stats = { sprites: 0, sheets: 0, paintMs: 0, draws: 0, drawMs: 0 };
  const planOf = (s: PortraitSubject): PortraitPlan => {
    const id = `${s.kind}|${s.spec.key}|${s.stage ?? ""}|${s.quadruped ? 1 : 0}`;
    let p = plans.get(id);
    if (!p) { p = portraitPlan(s, w, h); plans.set(id, p); }
    return p;
  };

  /** The crop of a view: where the portrait's window sits on its (centre-breath) sprite. */
  function cropOf(s: PortraitSubject, sp: PortraitSprite): { x0: number; y0: number } {
    const { w: sw, h: sh, rgba } = sp;
    if (s.kind !== "unit") {
      // All of it, centred (it was baked to fit).
      let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
      for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) { const i = (y * sw + x) * 4; if ((rgba[i]! & 63) || rgba[i + 3]! >= 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0) return { x0: 0, y0: 0 };
      return { x0: Math.round((x0 + x1 + 1) / 2 - w / 2), y0: Math.round((y0 + y1 + 1) / 2 - h / 2) + 1 };
    }
    let hx0 = sw, hy0 = sh, hx1 = -1, hy1 = -1, n = 0, sx = 0;
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) {
      const t = rgba[(y * sw + x) * 4]! & 63;
      if (!t || !CORE_SET.has(t - 1)) continue;
      n += 1; sx += x;
      if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (y < hy0) hy0 = y; if (y > hy1) hy1 = y;
    }
    if (!n) {
      // No head: frame the top of it.
      let top = sh, cx = 0, m = 0;
      for (let y = 0; y < sh && top === sh; y += 1) for (let x = 0; x < sw; x += 1) if (rgba[(y * sw + x) * 4]! & 63) { top = y; break; }
      for (let y = top; y < Math.min(sh, top + h * 0.6); y += 1) for (let x = 0; x < sw; x += 1) if (rgba[(y * sw + x) * 4]! & 63) { cx += x; m += 1; }
      return { x0: Math.round((m ? cx / m : sw / 2) - w / 2), y0: top - 3 };
    }
    // What's worn above the head (a helmet's crest, a hat) stays in the frame, within half a head.
    let top = hy0;
    const reach = Math.max(2, Math.round((hy1 - hy0) * 0.5));
    for (let y = Math.max(0, hy0 - reach); y < hy0; y += 1) { let any = false; for (let x = hx0; x <= hx1; x += 1) if (rgba[(y * sw + x) * 4]! & 63) { any = true; break; } if (any) { top = y; break; } }
    return { x0: Math.round(sx / n - w / 2), y0: top - Math.max(3, Math.round(h * 0.09)) };
  }
  /** A sprite into the window (a w x h picture of texel bytes: 0 outside). */
  function windowOf(sp: PortraitSprite, c: { x0: number; y0: number }): PortraitSprite {
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      const sy = y + c.y0;
      if (sy < 0 || sy >= sp.h) continue;
      for (let x = 0; x < w; x += 1) {
        const sx = x + c.x0;
        if (sx < 0 || sx >= sp.w) continue;
        const i = (sy * sp.w + sx) * 4, o = (y * w + x) * 4;
        rgba[o] = sp.rgba[i]!; rgba[o + 1] = sp.rgba[i + 1]!; rgba[o + 2] = sp.rgba[i + 2]!; rgba[o + 3] = sp.rgba[i + 3]!;
      }
    }
    return { w, h, rgba };
  }

  function makeSheet(s: PortraitSubject, look: number, P: PortraitPlan): PortraitSheet {
    const t0 = performance.now();
    tex = texOf(table, tex);
    const T = tex;
    const plain = s.kind === "prop" || look < 0;
    const views: PortraitView[] = [];
    let dark = 0xff0a0608 >>> 0, light = 0xffe8f4ff >>> 0, sumR = 0, sumG = 0, sumB = 0, count = 0;
    let darkL = Infinity, lightL = -Infinity;
    const fins = new Uint8Array(w * h);
    for (const dir of P.views) {
      const first = sprites.get(P.jobs.find((j) => j.direction === dir && j.clip === P.clip && j.frame === P.frames[0])!.key)!;
      const crop = cropOf(s, first);
      const frames: Uint32Array[] = [], closed: Uint32Array[] = [];
      let eyes: number[] = [], mouth: number[] = [], lights: number[] = [], metal: number[] = [], visor: number[] = [], body: number[] = [], vents: number[] = [];
      P.frames.forEach((f, fi) => {
        const job = P.jobs.find((j) => j.direction === dir && j.clip === P.clip && j.frame === f)!;
        const win = windowOf(sprites.get(job.key)!, crop);
        const pic = paintWith(win, plain ? -1 : look, T, { outline: 1, dither: 0.9, ox: 0, oy: 0, finishes: fins });
        let eyeSet = s.kind === "unit" && !plain ? eyesOf(pic, win) : [];
        if (s.kind === "unit" && !plain && !eyeSet.length) eyeSet = drawnEyes(pic, win);
        frames.push(pic);
        if (fi > 0) { closed.push(closeEyes(pic, eyeSet)); return; }
        eyes = eyeSet.slice();
        // Masks from the first breath.
        for (let i = 0; i < w * h; i += 1) {
          const c = pic[i]!;
          if (!c) continue;
          body.push(i);
          const L = lum(c);
          sumR += R(c); sumG += G(c); sumB += B(c); count += 1;
          if (L < darkL) { darkL = L; dark = c; }
          if (L > lightL) { lightL = L; light = c; }
          if (plain) continue;
          if (fins[i] === 4) lights.push(i);
          else if (fins[i] === 3) metal.push(i);
        }
        if (s.kind === "unit") {
          const m = mouthOf(win);
          mouth = m.mouth; visor = m.visor;
          if (!eyes.length) eyes = m.eyesFallback;
        } else {
          // Vents: the highest painted pixel of three columns spread over its top.
          const cols: Array<[number, number]> = [];
          for (let x = 0; x < w; x += 1) for (let y = 0; y < h; y += 1) if (pic[y * w + x]) { cols.push([x, y]); break; }
          cols.sort((a, b) => a[1] - b[1]);
          const picked: Array<[number, number]> = [];
          for (const c of cols) { if (picked.every((p) => Math.abs(p[0] - c[0]) > w / 6)) picked.push(c); if (picked.length >= 3) break; }
          vents = picked.map(([x, y]) => y * w + x);
          // No glow-finished pixels: its brightest few become the running lights.
          if (!lights.length && body.length) {
            const bright = body.filter((i) => lum(pic[i]!) > lightL * 0.82);
            lights = bright.filter((_, k) => k % 3 === 0).slice(0, 40);
          }
        }
        closed.push(closeEyes(pic, eyes));
      });
      views.push({ frames, closed, eyes: Int32Array.from(eyes), mouth: Int32Array.from(mouth), lights: Int32Array.from(lights), metal: Int32Array.from(metal), visor: Int32Array.from(visor), vents: Int32Array.from(vents), body: Int32Array.from(body) });
    }
    // Construction stages (painted in the same frame as the centre view).
    const stages: Uint32Array[] = [];
    if (s.stage) {
      const first = sprites.get(P.jobs.find((j) => j.direction === P.views[0] && j.clip === P.clip)!.key)!;
      const crop = cropOf(s, first);
      for (const j of P.jobs) if (j.clip === s.stage) { const sp = sprites.get(j.key); if (sp) stages.push(paintWith(windowOf(sp, crop), plain ? -1 : look, T, { outline: 1, dither: 0.9, ox: 0, oy: 0 })); }
    }
    const ms = performance.now() - t0;
    stats.paintMs += ms;
    stats.sheets += 1;
    return { key: `${s.spec.key}|${look}`, kind: s.kind, hero: !!s.hero, w, h, views, stages, dark, light, mean: count ? word(sumR / count, sumG / count, sumB / count) : 0xff404040 >>> 0, seed: strHash(s.spec.key), ms };

    /**
     * Its eyes, readable: each eye (a cluster of EYE-slot pixels) at least 2 x 2 -- a dark pupil with a one-pixel glint
     * -- drawn onto the picture in place (a close-up's eyes are a pixel or two). Returns the eye pixels.
     */
    function eyesOf(pic: Uint32Array, win: PortraitSprite): number[] {
      const isEye = (i: number) => (win.rgba[i * 4]! & 63) - 1 === S_EYE;
      const seen = new Uint8Array(w * h);
      const out: number[] = [];
      for (let i = 0; i < w * h; i += 1) {
        if (seen[i] || !isEye(i) || !pic[i]) continue;
        // One eye: its connected pixels.
        const cluster: number[] = [];
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
          const j = stack.pop()!;
          cluster.push(j);
          const x = j % w, y = (j / w) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const X = x + dx, Y = y + dy, q = Y * w + X;
            if (X >= 0 && Y >= 0 && X < w && Y < h && !seen[q] && isEye(q) && pic[q]) { seen[q] = 1; stack.push(q); }
          }
        }
        let dark = pic[cluster[0]!]!;
        for (const j of cluster) if (lum(pic[j]!) < lum(dark)) dark = pic[j]!;
        if (cluster.length < 4) {
          // (Palette-true: the pupil its own darkest entry, the glint the picture's lightest.)
          let glint = dark;
          for (let q = 0; q < w * h; q += 1) if (pic[q] && lum(pic[q]!) > lum(glint)) glint = pic[q]!;
          let cx = 0, cy = 0;
          for (const j of cluster) { cx += j % w; cy += (j / w) | 0; }
          cx = Math.round(cx / cluster.length - 0.25); cy = Math.round(cy / cluster.length - 0.25);
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            const X = cx + dx, Y = cy + dy, q = Y * w + X;
            if (X < 0 || Y < 0 || X >= w || Y >= h || !pic[q]) continue;
            pic[q] = dx === 0 && dy === 0 ? glint : dark;
            if (!cluster.includes(q)) cluster.push(q);
          }
        }
        out.push(...cluster);
      }
      return out;
    }
    /**
     * No eye pixels baked (eyes smaller than a pixel at this scale, or a face the bake hides): two drawn on its head's
     * front -- 2 x 2, its darkest colour with a glint -- where a face's eyes sit (45% down the head, a fifth either side).
     */
    function drawnEyes(pic: Uint32Array, win: PortraitSprite): number[] {
      let x0 = w, x1 = -1, y0 = h, y1 = -1;
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { const t = (win.rgba[(y * w + x) * 4]! & 63) - 1; if (t === S_HEAD) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0 || x1 - x0 < 6) return [];
      let dark = 0, lightC = 0;
      for (let i = 0; i < w * h; i += 1) { const c = pic[i]; if (!c) continue; if (!dark || lum(c) < lum(dark)) dark = c; if (!lightC || lum(c) > lum(lightC)) lightC = c; }
      const cx = (x0 + x1) / 2, ey = Math.round(y0 + (y1 - y0) * 0.45), dx = Math.max(2, Math.round((x1 - x0) * 0.2));
      const out: number[] = [];
      for (const ex of [Math.round(cx - dx - 1), Math.round(cx + dx - 1)]) for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const X = ex + ox, Y = ey + oy, i = Y * w + X;
        if (X < 0 || Y < 0 || X >= w || Y >= h || (win.rgba[i * 4]! & 63) - 1 !== S_HEAD) continue;
        pic[i] = ox === 0 && oy === 0 ? lightC : dark; out.push(i);
      }
      return out;
    }
    /** The eyes closed: each eye pixel takes the colour just above it that isn't an eye (the lid), its lowest a lash. */
    function closeEyes(pic: Uint32Array, eyeList: readonly number[]): Uint32Array {
      const out = pic.slice();
      if (plain || !eyeList.length) return out;
      const eye = new Set(eyeList);
      const lowest = new Map<number, number>();
      let darkest = pic[eyeList[0]!]!;
      for (const i of eyeList) if (lum(pic[i]!) < lum(darkest)) darkest = pic[i]!;
      for (const i of eyeList) {
        const x = i % w, y = (i / w) | 0;
        let lid = 0;
        for (let yy = y - 1; yy >= Math.max(0, y - 5); yy -= 1) { const j = yy * w + x; if (pic[j] && !eye.has(j)) { lid = pic[j]!; break; } }
        out[i] = lid || darkest;
        if ((lowest.get(x) ?? -1) < y) lowest.set(x, y);
      }
      // (The lash: the eye's own darkest entry along its lowest row -- palette-true.)
      for (const [x, y] of lowest) out[y * w + x] = darkest;
      return out;
    }
    /** Where a unit's mouth is: on its snout's lower edge, else under its eyes on its head; a covered head's glow is its visor. */
    function mouthOf(win: PortraitSprite): { mouth: number[]; visor: number[]; eyesFallback: number[] } {
      const at = (i: number) => (win.rgba[i * 4]! & 63) - 1;
      let hx0 = w, hx1 = -1, hy0 = h, hy1 = -1, ex = 0, ey = 0, en = 0, sx0 = w, sx1 = -1, sn = 0, headN = 0, wornN = 0;
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const t = at(y * w + x);
        if (t < 0) continue;
        if (HEAD_SET.has(t)) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; if (y < hy0) hy0 = y; if (y > hy1) hy1 = y; }
        if (t === S_HEAD) headN += 1;
        if (t >= WORN_SLOT && y <= hy1 + 1) wornN += 1;
        if (t === S_EYE) { ex += x; ey += y; en += 1; }
        if (t === S_SNOUT || t === S_NOSE) { if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; sn += 1; }
      }
      const mouth: number[] = [], visor: number[] = [], eyesFallback: number[] = [];
      if (hx1 < 0) return { mouth, visor, eyesFallback };
      // A covered head (a helmet over most of it): its glow lines are the visor that flickers when it talks.
      if (wornN > headN * 1.5) for (let y = hy0; y <= hy1; y += 1) for (let x = hx0; x <= hx1; x += 1) { const i = y * w + x; if (at(i) === WORN_TRIM || fins[i] === 4) visor.push(i); }
      // A muzzle (a snout at least 5 px across) talks on its lower edge; a face -- a nose is no muzzle -- under its nose.
      let noseLow = -1;
      if (sn >= 4) for (let y = 0; y < h; y += 1) for (let x = sx0; x <= sx1; x += 1) { const t = at(y * w + x); if (t === S_SNOUT || t === S_NOSE) noseLow = Math.max(noseLow, y); }
      if (sn >= 4 && sx1 - sx0 + 1 >= 5) {
        const span = sx1 - sx0 + 1, trim = Math.min(Math.floor(span * 0.15), Math.max(0, Math.floor((span - 9) / 2))), a = sx0 + trim, b = sx1 - trim;
        for (let x = a; x <= b; x += 1) { let low = -1; for (let y = 0; y < h; y += 1) { const t = at(y * w + x); if (t === S_SNOUT || t === S_NOSE) low = y; } if (low >= 0) mouth.push(low * w + x); }
      } else {
        const cx = en ? Math.round(ex / en) : Math.round((hx0 + hx1) / 2);
        const eyeY = en ? ey / en : hy0 + (hy1 - hy0) * 0.45;
        const my = Math.max(Math.round(eyeY + (hy1 - eyeY) * 0.55), noseLow >= 0 ? noseLow + 2 : -1);
        // (A mouth a good third of the face wide: at the console's size a talk must read -- J6.6's 20 px and more.)
        const half = Math.max(3, Math.round((hx1 - hx0 + 1) * 0.27));
        // (Across the face at that row: its head pixels, and whatever else is painted inside the head's own box there -- a
        // chin strap, a collar's edge -- so a narrow chin still gets a mouth to open.)
        for (let x = cx - half; x <= cx + half; x += 1) { const i = my * w + x; if (x >= 0 && x < w && my >= 0 && my < h && (HEAD_SET.has(at(i)) || (x >= hx0 && x <= hx1 && at(i) >= 0))) mouth.push(i); }
        if (!en) { const y = Math.round(eyeY); for (const dx of [-half - 1, half + 1]) { const i = y * w + cx + dx; if (HEAD_SET.has(at(i))) eyesFallback.push(i); } }
      }
      return { mouth, visor, eyesFallback };
    }
  }

  const P: Portraits = {
    need(s) {
      const plan = planOf(s);
      const out: SpriteJob[] = [];
      for (const j of plan.jobs) if (!sprites.has(j.key) && !asked.has(j.key)) { asked.add(j.key); out.push(j); }
      return out;
    },
    offer(job, sprite) {
      if (!job.key.startsWith("portrait|")) return false;
      if (!sprites.has(job.key)) { sprites.set(job.key, { w: sprite.w, h: sprite.h, rgba: sprite.rgba.slice() }); stats.sprites += 1; }
      return true;
    },
    ready(s) { return planOf(s).jobs.every((j) => sprites.has(j.key)); },
    sheet(s, look) {
      const plan = planOf(s);
      if (!plan.jobs.every((j) => sprites.has(j.key))) return null;
      const id = `${s.kind}|${s.spec.key}|${s.stage ?? ""}|${look}|${s.hero ? 1 : 0}`;
      let sh = sheets.get(id);
      if (!sh) { sh = makeSheet(s, look, plan); sheets.set(id, sh); }
      return sh;
    },
    forget(s) { for (const j of planOf(s).jobs) if (!sprites.has(j.key)) asked.delete(j.key); },
    draw(sheet, state, out) { const t0 = performance.now(); drawPortrait(sheet, state, out); stats.draws += 1; stats.drawMs += performance.now() - t0; },
    get stats() { return { ...stats }; },
  };
  return P;
}

// ---------------------------------------------------------------- a frame

/** Compose one frame of a portrait (0xAABBGGRR words, sheet.w x sheet.h). Deterministic in (sheet, state). */
export function drawPortrait(sheet: PortraitSheet, state: PortraitState, out: Uint32Array): void {
  const { w, h } = sheet;
  const t = state.t;
  const seed = (sheet.seed ^ mix32(state.seed ?? 0)) >>> 0;
  const team = state.team ?? [120, 160, 200];
  const hp = Math.max(0, Math.min(1, state.hp01 ?? 1));
  const tick = Math.floor(t * 12); // (the screen's own clock: effects step 12 times a second -- pixel art, not a smear)

  // The screen behind: the team's colour, dim, lit toward the middle, a hero's brighter with a diagonal sheen.
  const hero = sheet.hero;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const e = Math.min(x, y, w - 1 - x, h - 1 - y);
    const v = 0.1 + 0.08 * (1 - y / h) + Math.min(0.06, e * 0.008);
    const sheen = hero && ((x + y + (tick >> 1)) % 11 === 0) ? 0.07 : 0;
    const k = v + sheen + (hero ? 0.04 : 0);
    out[y * w + x] = word(team[0] * k + 6, team[1] * k + 6, team[2] * k + 9);
  }
  // A building's ground line.
  if (sheet.kind !== "unit") { const gy = Math.round(h * 0.86); for (let x = 0; x < w; x += 1) out[gy * w + x] = mix(out[gy * w + x]!, 0xff000000, 0.35); }

  // Which view and breath.
  const views = sheet.views;
  let vi = 0;
  if (sheet.kind === "unit" && views.length > 1) {
    // A glance every 4-7 s, 0.7 s long, one way or the other.
    const period = 4 + rnd(seed, 1) * 3;
    const n = Math.floor(t / period), ph = t - n * period;
    if (ph < 0.7) vi = 1 + Math.floor(rnd(seed, n, 2) * (views.length - 1));
  }
  const V = views[vi]!;
  const breath = V.frames.length > 1 ? Math.floor(t / 0.9 + rnd(seed, 3)) % V.frames.length : 0;
  const talking = state.talk !== undefined && state.talk >= 0 && state.talk < (state.talkFor ?? 0.7);
  // Blink every 2.5-5 s for 0.13 s (not mid-syllable).
  const bp = 2.5 + rnd(seed, 4) * 2.5;
  const bn = Math.floor(t / bp);
  const blink = sheet.kind === "unit" && t - bn * bp < 0.13 + (rnd(seed, bn, 5) < 0.2 ? 0.2 : 0);
  let pic = blink ? V.closed[breath]! : V.frames[breath]!;
  if (sheet.kind === "building" && state.stage !== undefined && state.stage >= 0 && sheet.stages.length) pic = sheet.stages[Math.min(sheet.stages.length - 1, state.stage)]!;
  for (let i = 0; i < w * h; i += 1) { const c = pic[i]!; if (c) out[i] = c; }
  // A dark rim round the figure: it stands off the screen.
  const rim = mix(sheet.dark, 0xff000000, 0.5);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x;
    if (pic[i]) continue;
    if ((x > 0 && pic[i - 1]) || (x < w - 1 && pic[i + 1]) || (y > 0 && pic[i - w]) || (y < h - 1 && pic[i + w])) out[i] = rim;
  }
  const complete = !(state.stage !== undefined && state.stage >= 0);

  if (sheet.kind === "unit") {
    // Talking: syllables open and close the mouth (or flicker the visor), 10-14 a second, with pauses.
    if (talking) {
      const syl = Math.floor(state.talk! * 11);
      const open = rnd(seed, syl, 7) < 0.62;
      if (V.visor.length) { if (open) for (const i of V.visor) out[i] = mix(out[i]!, sheet.light, 0.6); for (const i of V.eyes) out[i] = open ? mix(out[i]!, sheet.light, 0.7) : out[i]!; }
      else if (V.mouth.length) {
        for (const i of V.mouth) out[i] = mix(out[i]!, sheet.dark, open ? 0.9 : 0.35);
        if (open) {
          // Open: the jaw drops -- what's under the mouth, across its width and down to the chin, moves 2 px down (the
          // face below the mouth line is redrawn from 2 rows up) -- and the gap is dark: two rows, three on a wide one.
          const rows = rnd(seed, syl, 8) < 0.5 ? 3 : 2, drop = rows === 3 ? 3 : 2;
          let x0 = w, x1 = -1, my = 0;
          for (const i of V.mouth) { const x = i % w; if (x < x0) x0 = x; if (x > x1) x1 = x; my = Math.floor(i / w); }
          const src = out.slice();
          for (let x = x0; x <= x1; x += 1) {
            let chin = my; for (let y = my + 1; y < Math.min(h, my + 12); y += 1) { if (pic[y * w + x]) chin = y; else break; }
            for (let y = Math.min(h - 1, chin + drop); y > my; y -= 1) { const from = y - drop; if (from > my && pic[from * w + x]) out[y * w + x] = src[from * w + x]!; }
            for (let r = 1; r <= rows; r += 1) { const j = (my + r) * w + x; if (my + r < h && (pic[j] || pic[j - w])) out[j] = sheet.dark; }
          }
        }
      } else if (open) for (const i of V.eyes) out[i] = mix(out[i]!, sheet.light, 0.6);
    }
  } else {
    const working = !!state.working && complete;
    // Lights: a slow pulse; working, a chase along them.
    for (let k = 0; k < V.lights.length; k += 1) {
      const i = V.lights[k]!;
      const ph = working ? ((tick + k) % 6 < 3 ? 1 : 0.1) : 0.5 + 0.5 * Math.sin(t * 2.2 + (k % 5));
      out[i] = mix(out[i]!, sheet.light, 0.55 * ph);
    }
    // Machinery: a glint sweeping across the metal (faster while working).
    if (V.metal.length) {
      const period = working ? 1.1 : 3.4;
      const band = ((t % period) / period) * (w + 16) - 8;
      for (const i of V.metal) { const x = i % w, y = (i / w) | 0; const d = Math.abs(x + y * 0.3 - band); if (d < 2.2) out[i] = mix(out[i]!, sheet.light, d < 1 ? 0.55 : 0.3); }
    }
    // Smoke from its vents (thin idle, more working, heavy and dark when badly hurt).
    const puffs = hp < 0.33 ? 5 : working || hp < 0.66 ? 3 : 1;
    const smokeDark = hp < 0.33 ? 0.72 : 0.3;
    for (let v = 0; v < V.vents.length && complete; v += 1) {
      const vi2 = V.vents[v]!;
      const vx = vi2 % w, vy = (vi2 / w) | 0;
      for (let p = 0; p < puffs; p += 1) {
        const life = 1.6, age = ((t + p * (life / puffs) + v * 0.37) % life) / life;
        const px = Math.round(vx + Math.sin((t + p) * 1.7 + v) * 1.5 + age * 3 * (rnd(seed, v, 9) - 0.3));
        const py = Math.round(vy - 1 - age * 14);
        const r = 1 + Math.floor(age * 2.4);
        const col = mix(mix(0xff9aa0a8 >>> 0, 0xff202226 >>> 0, smokeDark), out[Math.max(0, Math.min(h - 1, py)) * w + Math.max(0, Math.min(w - 1, px))]!, age * 0.6);
        for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
          if (dx * dx + dy * dy > r * r + 0.5) continue;
          const X = px + dx, Y = py + dy;
          if (X < 0 || Y < 1 || X >= w || Y >= h - 1) continue;
          if (((X + Y + tick) & 1) === 0 && age > 0.55) continue; // (thinning as it rises: dithered, never blended)
          out[Y * w + X] = col;
        }
      }
    }
    // Working sparks near its base; construction sparks along the top of what's up.
    if (working || !complete) {
      for (let k = 0; k < 4; k += 1) {
        const pick = V.body[Math.floor(rnd(seed, tick, 20 + k) * V.body.length)];
        if (pick === undefined) continue;
        const y = (pick / w) | 0;
        if (!complete ? rnd(seed, tick, 30 + k) < 0.5 : y > h * 0.45) out[pick] = rnd(seed, tick, 40 + k) < 0.5 ? (0xff60f0ff >>> 0) : (0xffffffff >>> 0);
      }
    }
    // Damage: cracks below two thirds, fire below a third.
    if (hp < 0.66 && V.body.length) {
      const cracks = hp < 0.33 ? 6 : 3;
      for (let c = 0; c < cracks; c += 1) {
        let i = V.body[Math.floor(rnd(seed, c, 50) * V.body.length)]!;
        let x = i % w, y = (i / w) | 0;
        for (let s = 0; s < 7; s += 1) {
          i = y * w + x;
          if (x < 0 || y < 0 || x >= w || y >= h || !pic[i]) break;
          out[i] = sheet.dark;
          x += rnd(seed, c, 60 + s) < 0.5 ? -1 : 1;
          y += rnd(seed, c, 70 + s) < 0.7 ? 1 : 0;
        }
      }
    }
    if (hp < 0.33 && V.body.length) {
      for (let k = 0; k < 14; k += 1) {
        const pick = V.body[Math.floor(rnd(seed, tick >> 1, 80 + k) * V.body.length)]!;
        const y = (pick / w) | 0;
        const up = pick - w, up2 = pick - 2 * w;
        const hot = rnd(seed, tick, 90 + k);
        const col = hot < 0.4 ? (0xff2a7cff >>> 0) : hot < 0.75 ? (0xff30c0ff >>> 0) : (0xff90f0ff >>> 0);
        if (y > 1) { out[pick] = col; if (up >= 0 && !pic[up]) out[up] = col; if (hot < 0.3 && up2 >= 0) out[up2] = 0xff1a50e0 >>> 0; }
      }
    }
  }

  // Signal: noise as it's hurt (a unit's comm link; a building's camera) -- speckle, torn rows, a rolling bar.
  // (Not snow: the colours slip apart -- red one way, blue the other -- and short runs of rows drop dark; the figure
  // stays readable through it.)
  const hurt = 1 - hp;
  if (hurt > 0.34) {
    const bleedRows = (hurt - 0.34) * 0.9;
    const s = 1 + Math.floor(hurt * 2.5);
    for (let y = 0; y < h; y += 1) {
      if (rnd(seed, tick, 200 + y) >= bleedRows) continue;
      const row = out.slice(y * w, y * w + w);
      for (let x = 0; x < w; x += 1) { const a = row[Math.max(0, x - s)]!, c = row[x]!, b = row[Math.min(w - 1, x + s)]!; out[y * w + x] = word(R(a), G(c), B(b)); }
    }
    const drops = Math.floor((hurt - 0.34) * 14);
    for (let k = 0; k < drops; k += 1) {
      const y = Math.floor(rnd(seed, tick, 300 + k) * h), x0 = Math.floor(rnd(seed, tick, 400 + k) * w), len = 3 + Math.floor(rnd(seed, tick, 500 + k) * (w / 3));
      for (let x = x0; x < Math.min(w, x0 + len); x += 1) out[y * w + x] = mix(out[y * w + x]!, 0xff000000, 0.55);
    }
  }
  if (hurt > 0.55 && rnd(seed, tick, 101) < hurt * 0.6) {
    const y0 = Math.floor(rnd(seed, tick, 102) * h), rows = 2 + Math.floor(rnd(seed, tick, 103) * 6), shift = (rnd(seed, tick, 104) < 0.5 ? -1 : 1) * (1 + Math.floor(hurt * 4));
    for (let y = y0; y < Math.min(h, y0 + rows); y += 1) { const row = out.slice(y * w, y * w + w); for (let x = 0; x < w; x += 1) out[y * w + x] = row[(((x - shift) % w) + w) % w]!; }
  }
  if (hurt > 0.45) {
    const by = Math.floor(((t * 18) % (h + 10)) - 5);
    for (let y = by; y < by + 3; y += 1) if (y >= 0 && y < h) for (let x = 0; x < w; x += 1) out[y * w + x] = mix(out[y * w + x]!, 0xffffffff >>> 0, 0.18);
  }
  // A hit: the whole screen flashes toward white.
  const fl = Math.max(0, Math.min(1, state.flash ?? 0));
  if (fl > 0) { const k = fl > 0.7 ? 0.75 : fl * 0.6; for (let i = 0; i < w * h; i += 1) out[i] = mix(out[i]!, 0xffe8f0ff >>> 0, k); }
  // The glass: every other row a shade darker -- a comm screen, not a sticker.
  for (let y = 1; y < h; y += 2) for (let x = 0; x < w; x += 1) { const c = out[y * w + x]!; out[y * w + x] = ((c & 0xff000000) | (((c & 0xfefefe) >>> 1) + ((c & 0xfcfcfc) >>> 2))) >>> 0; }
  // A hero's frame: gold corners and a double rule.
  if (hero) {
    const gold = 0xff3cc8f0 >>> 0, deep = 0xff1a6a9a >>> 0;
    for (let x = 0; x < w; x += 1) { out[x] = gold; out[(h - 1) * w + x] = gold; if (x % 2 === 0) { out[w + x] = deep; out[(h - 2) * w + x] = deep; } }
    for (let y = 0; y < h; y += 1) { out[y * w] = gold; out[y * w + w - 1] = gold; }
    for (const [cx, cy] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]] as const) for (let d = 0; d < 5; d += 1) { const sx = cx === 1 ? 1 : -1, sy = cy === 1 ? 1 : -1; out[cy * w + cx + d * sx] = gold; out[(cy + d * sy) * w + cx] = gold; }
    // A star over the right shoulder.
    const sx = w - 7, sy = 3;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]] as const) out[(sy + 1 + dy) * w + sx + dx] = gold;
  }
}

// ---------------------------------------------------------------- measuring

/**
 * How different two portrait pictures are (0 same .. 1): the mean per-channel difference over the pixels either
 * shows (its figure), with the figures' shape difference (1 - IoU of the non-background masks) averaged in.
 * `bg` tells a pixel of the screen from the figure (default: pixels equal to the corner's colour are screen).
 */
export function portraitDistance(a: Uint32Array, b: Uint32Array, masks?: { readonly a: Uint8Array; readonly b: Uint8Array }, { shift = 0, w = PORTRAIT_W }: { shift?: number; w?: number } = {}): number {
  // (Shift-tolerant: the least distance with b moved up to `shift` pixels each way -- a breath or a glance's one-pixel
  // bob isn't a difference in what the portrait shows.)
  if (shift > 0) {
    const h = Math.floor(a.length / w);
    let best = Infinity;
    const sb = new Uint32Array(b.length), sm = masks ? new Uint8Array(b.length) : null;
    for (let dy = -shift; dy <= shift; dy += 1) for (let dx = -shift; dx <= shift; dx += 1) {
      sb.fill(0); sm?.fill(0);
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const X = x - dx, Y = y - dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        sb[y * w + x] = b[Y * w + X]!;
        if (sm) sm[y * w + x] = masks!.b[Y * w + X]!;
      }
      best = Math.min(best, portraitDistance(a, sb, masks ? { a: masks.a, b: sm! } : undefined));
    }
    return best;
  }
  const n = Math.min(a.length, b.length);
  let diff = 0, m = 0, inter = 0, uni = 0;
  for (let i = 0; i < n; i += 1) {
    const ma = masks ? masks.a[i]! > 0 : true, mb = masks ? masks.b[i]! > 0 : true;
    if (ma && mb) inter += 1;
    if (ma || mb) {
      uni += 1;
      const x = a[i]!, y = b[i]!;
      diff += (Math.abs(R(x) - R(y)) + Math.abs(G(x) - G(y)) + Math.abs(B(x) - B(y))) / 765;
      m += 1;
    }
  }
  const colour = m ? diff / m : 0;
  const shape = uni ? 1 - inter / uni : 0;
  return masks ? (colour + shape) / 2 : colour;
}
/** A sheet's figure mask for its first view (1 where its picture has a pixel). */
export function portraitMask(sheet: PortraitSheet, view = 0): Uint8Array {
  const pic = sheet.views[view]!.frames[0]!;
  const out = new Uint8Array(pic.length);
  for (let i = 0; i < pic.length; i += 1) out[i] = pic[i] ? 1 : 0;
  return out;
}
