// The licence plate: the token's number (0001, 0002 ... 9999, then 10000 and on,
// as long as it gets) or its owner's vanity text, on a plate over the rear
// bumper's recess. It is NOT part of the car -- a seed makes the same car
// whatever its plate says -- so it is a layer of its own (plateDesign), drawn
// with the body's look, the text its decal (bodyPaint's `plate` option).
//
// How a plate makes room for long text, in order:
//   1. the letters shrink, down to LETTER_MIN, on the car's own plate;
//   2. the plate grows wider -- clear of the exhaust tips, the tail lamps and the
//      back panel's edge (it may cover the reflectors: it sits proud of them);
//   3. when the tips are in the way it RISES over them (or drops under a centre
//      exit), to where it can be widest;
//   4. then a second row, and a third, the plate growing taller;
//   5. and past all of that, the letters shrink until the text fits.
// So any number fits; a short one looks like a real plate.
//
// A plate's texture is a picture of up to four inks (a KDCL image doc, decoded by
// the game): the background, and its LAST ink the lettering's. No texture: a
// white plate, a navy rim and navy letters.

import { dhypot } from "@keel-engine/core";
import type { BakeWorld, Decal } from "@keel-engine/bake";
import type { Car, Colour } from "./car.ts";
import { GLYPHS, canvas, fillRect, put } from "./decals.ts";
import type { Canvas } from "./decals.ts";
import { backPanelOf, exhaustTips, tailEndOf } from "./shapes.ts";
import type { VehicleDesign } from "./shapes.ts";
import { box, cap, component, solids } from "./solids.ts";
import { BODY_SLOT as P } from "./slots.ts";

/** The car's own plate (the bumper's recess): half its width and its height, in metres. */
export const PLATE_HALF = 0.24;
export const PLATE_HEIGHT = 0.12;
/** Letter heights: a real plate's, the least a plate shrinks them to before it grows, and the last resort's floor. */
const LETTER = 0.07, LETTER_MIN = 0.046, LETTER_FLOOR = 0.012;
/** Clearance kept from the tips, the lamps and the panel's edge. */
const GAP = 0.014;

/**
 * The longest vanity text a collection allows: two more than the digits of the cars ever minted (1 minted: 3; 100:
 * 5; 1000: 6) -- a vanity plate is never much longer than the numbers around it. HashersPlates checks the same.
 */
export const vanityMax = (minted: number | bigint): number => BigInt(minted < 1 ? 1 : minted).toString().length + 2;
/** Vanity text: A-Z and 0-9, a single space or dash only between two others, 1 to `max` long. */
export const isVanity = (s: string, max: number): boolean => s.length >= 1 && s.length <= max && /^[A-Z0-9](?:[A-Z0-9]|[ -](?=[A-Z0-9]))*$/.test(s);

/** A token's plate: its id, four digits at the least (1 is 0001), every digit past that shown as it is. */
export function plateText(token: number | bigint | string): string {
  const s = typeof token === "string" ? token.trim() : BigInt(token).toString();
  if (!/^\d+$/.test(s)) throw new Error(`plateText: not a token id: ${s}`);
  return s.replace(/^0+(?=\d)/, "").padStart(4, "0");
}

/** Where a plate goes on a car and how its text is set. All in the car's frame (metres); the plate faces -z. */
export interface PlateFit {
  readonly text: string;
  readonly rows: readonly string[];
  /** Half its width, its bottom and top, and its back face (z0) and the face against the car (z1). */
  readonly half: number;
  readonly y0: number;
  readonly y1: number;
  readonly z0: number;
  readonly z1: number;
  /** The letters' height. */
  readonly letter: number;
  /** Wider or taller than the car's own plate, and moved off the recess (over or under the tips). */
  readonly grown: boolean;
  readonly moved: boolean;
  /** Stood out on a bracket past whatever crowds the tail (nowhere on it was clear): see plateFit's last resort. */
  readonly proud?: boolean;
  /**
   * A plate moved off the car's recess leaves the recess bare -- which reads as a blank plate. This is the panel that
   * fills it (in the tail's own slot, flush over it), drawn with the plate's layer: its bottom and top, its face z.
   */
  readonly cover?: { readonly y0: number; readonly y1: number; readonly z: number; readonly slot: number };
}

interface Blocker { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number; readonly tip: boolean }

/** What a plate must stay clear of on the car's back: the exhaust tips (a quad's four) and the tail lamps. */
function blockersOf(car: Car): Blocker[] {
  const out: Blocker[] = [];
  const p = car.parts;
  // (Every exhaust but side pipes and stacks ends in tips at the tail -- "none" too: shapes.ts draws its pipe there.)
  if (p.exhaust !== "side" && p.exhaust !== "stacks") {
    const tips = exhaustTips(car);
    const pipes = p.exhaust === "quad" ? tips.flatMap((t) => [-1, 1].map((k) => ({ x: t.x + k * t.r * 1.2, y: t.y, r: t.r * 0.85 }))) : tips;
    for (const t of pipes) { const r = t.r * 1.25; out.push({ x0: t.x - r, x1: t.x + r, y0: t.y - r, y1: t.y + r, tip: true }); }
  }
  const b = backPanelOf(car), bh = b.half, y = b.lampY;
  const pair = (x0: number, x1: number, y0: number, y1: number): void => { out.push({ x0, x1, y0, y1, tip: false }, { x0: -x1, x1: -x0, y0, y1, tip: false }); };
  switch (p.tail) {
    case "bar": out.push({ x0: -bh * 0.95, x1: bh * 0.95, y0: y - 0.04, y1: y + 0.02, tip: false }); break;
    case "slim": out.push({ x0: -bh * 0.9, x1: bh * 0.9, y0: y - 0.015, y1: y + 0.01, tip: false }); break;
    case "blocks": pair(bh * 0.58, bh * 0.95, y - 0.1, y + 0.02); break;
    case "round": pair(bh * 0.7 - 0.075, bh * 0.7 + 0.075, y - 0.115, y + 0.035); break;
    case "quad": pair(bh * 0.55 - 0.06, bh * 0.82 + 0.06, y - 0.1, y + 0.02); break;
    case "split": pair(bh * 0.2, bh * 0.95, y - 0.03, y + 0.01); break;
  }
  // The diffuser (shapes.ts): its tray and fins stand proud of the tail up to ride + 0.16 -- a plate over them has a fin
  // through the middle of its letters, so it's kept clear like a tip (it rises over them).
  if (p.diffuser) { const hw = car.body.width / 2; out.push({ x0: -hw, x1: hw, y0: car.body.ride - 0.03, y1: car.body.ride + 0.16, tip: true }); }
  // A chrome rear bumper's bar (bumpers.ts) runs across the tail proud of the recess: on a shallow bumper its top would
  // cross the plate's letters, so the plate sits clear above it.
  if (p.bumper === "chrome" && !p.bed) {
    const g = car.body, hw = g.width / 2, y = g.ride + Math.min(0.2, (g.belt - g.ride) * 0.42) * 0.72;
    out.push({ x0: -hw, x1: hw, y0: y - 0.045, y1: y + 0.045, tip: true });
  }
  return out;
}

/**
 * The glyphs a plate can show: the decals' font, a dash (a space is a gap), and the three a person's own plate needs
 * -- an `@` for a handle, a `.` for a name like `vitalik.eth`, and an ellipsis for a shortened address. A registered
 * VANITY plate is only ever A-Z, 0-9, space and dash (`isVanity`, and the contract agrees); these three are for the
 * plate a game letters itself, for a car whose driver is a person rather than a token.
 */
const PLATE_GLYPHS: Readonly<Record<string, readonly number[]>> = {
  ...GLYPHS,
  "-": [0, 0, 0, 31, 0, 0, 0],
  "@": [14, 17, 23, 21, 23, 16, 14],
  ".": [0, 0, 0, 0, 0, 12, 12],
  "…": [0, 0, 0, 0, 0, 0, 21],
};

/** Whether a plate can letter this text as it stands (an unknown character would come out as a hole). */
export const platePrints = (s: string): boolean => s.length > 0 && [...s].every((ch) => ch === " " || ch in PLATE_GLYPHS);
/** Text as rows: one, or split at the space or dash nearest each break (digits wherever they even out). */
function splitRows(text: string, rows: number): string[] {
  if (rows <= 1) return [text];
  const out: string[] = [];
  let rest = text;
  for (let r = rows; r > 1; r -= 1) {
    const want = Math.ceil(rest.length / r);
    let cut = want, best = Infinity;
    for (let i = 1; i < rest.length; i += 1) if ((rest[i] === " " || rest[i] === "-") && Math.abs(i - want) < best && Math.abs(i - want) <= 2) { best = Math.abs(i - want); cut = i; }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).replace(/^[ -]/, "");
  }
  out.push(rest);
  return out.filter((s) => s.length > 0);
}

/**
 * Where a car's plate goes for this text, and how big it and its letters are (see the top of this file). Null for a
 * car with no plate recess (a semi tractor's plate is its trailer's business).
 */
export function plateFit(car: Car, text: string): PlateFit | null {
  if (car.parts.semi) return null;
  const g = car.body, hull = g.belt - g.ride, L2 = g.length / 2;
  const rounded = !car.parts.bed && tailEndOf(car).depth > 0.02;
  const back = backPanelOf(car);
  const bumperH = Math.min(0.2, hull * 0.42);
  // (The recess, exactly as bumpers.ts cuts it: the metal plate there is what this one covers.)
  // (A buggy's engine box stands out past its frame, over the recess: its plate hangs on the box's face instead.)
  const zR = car.archetype === "buggy" ? -L2 - 0.12 : rounded ? -L2 : -L2 - 0.04;
  const py = Math.min(back.top - 0.2, Math.max(back.bottom + 0.02, g.ride + bumperH * 0.9)) + 0.015;
  const hw = car.archetype === "buggy" ? (g.width / 2) * 0.62 : g.width / 2;
  const side = Math.min(rounded ? back.half : hw * 0.97, hw) - GAP;
  const top = Math.max(py + PLATE_HEIGHT, back.top - 0.015), floor = g.ride + 0.01;
  const blockers = blockersOf(car);
  /** The widest a plate of height h may be with its bottom at y (0: something straddles the middle). */
  const halfAt = (y: number, h: number): number => {
    if (y < floor - 1e-6 || y + h > top + 1e-6) return 0;
    let lim = side;
    for (const b of blockers) {
      // (A tip pokes out through a plate, so it's kept well clear; a lamp is only kept off, the plate's edge to its lens.)
      const gap = b.tip ? GAP : 0.004;
      if (b.y1 + gap <= y + 1e-9 || b.y0 - gap >= y + h - 1e-9) continue;
      if (b.x0 < 0 && b.x1 > 0) return 0;
      lim = Math.min(lim, (b.x0 >= 0 ? b.x0 : -b.x1) - gap);
    }
    return lim;
  };
  // The car's own recess takes the car's own plate unless a pipe comes out through it -- or the diffuser's fins stand
  // in front of it, a tip-like blocker (a lamp there was always there: it only ever overlaps the plate's rim).
  const recessFree = !blockers.some((b) => b.tip && b.y1 + GAP > py && b.y0 - GAP < py + PLATE_HEIGHT && b.x1 > -PLATE_HALF - GAP && b.x0 < PLATE_HALF + GAP);
  // Where a plate may sit: the recess, then over or under each thing in the way, nearest the recess first.
  const spots = (h: number): number[] => {
    const ys = [py];
    for (const b of blockers) if (b.tip) ys.push(b.y1 + GAP, b.y0 - GAP - h);
    return ys.filter((y) => y >= floor - 1e-6 && y + h <= top + 1e-6).sort((a, b) => Math.abs(a - py) - Math.abs(b - py));
  };
  const fits = (y: number, h: number, half: number): boolean => (y === py && recessFree && half <= PLATE_HALF + 1e-9 && h <= PLATE_HEIGHT + 1e-9) || halfAt(y, h) >= half - 1e-9;
  // (The recess as bumpers.ts cuts it -- its dark border's bottom and top, and its face -- for the cover a moved plate leaves.)
  const recessY = py - 0.015, recessZ = rounded ? -L2 : -L2 - 0.04;
  const cover = car.archetype === "buggy" ? undefined : { y0: recessY - 0.004, y1: recessY + 0.154, z: recessZ, slot: rounded ? P.paint : P.bumperR };
  const at = (rows: string[], letter: number, half: number, y: number, h = plateHeight(rows.length, letter)): PlateFit => {
    const moved = Math.abs(y - py) > 1e-6;
    return { text, rows, half, y0: y, y1: y + h, z0: zR - 0.016, z1: zR + 0.01, letter, grown: half > PLATE_HALF + 1e-6 || h > PLATE_HEIGHT + 1e-6, moved, ...(moved && cover ? { cover } : {}) };
  };
  const clean = text.trim().toUpperCase();
  const widest = (rows: readonly string[]) => Math.max(...rows.map((r) => r.length));
  const needHalf = (rows: readonly string[], letter: number) => Math.max(PLATE_HALF, textHalf(widest(rows), letter));
  // 1. The car's own plate, the letters shrinking into it.
  for (let letter = LETTER; letter >= LETTER_MIN - 1e-9; letter -= 0.002) {
    if (textHalf(clean.length, letter) > PLATE_HALF) continue;
    for (const y of spots(PLATE_HEIGHT)) if (fits(y, PLATE_HEIGHT, PLATE_HALF)) return at([clean], letter, PLATE_HALF, y);
    break;
  }
  // 2-4. The plate grows at the least letter: wider on one row, then taller with two and three.
  for (let n = 1; n <= 3; n += 1) {
    const rows = splitRows(clean, n);
    if (rows.length < n) break;
    const half = needHalf(rows, LETTER_MIN), h = plateHeight(n, LETTER_MIN);
    for (const y of spots(h)) if (fits(y, h, half)) return at(rows, LETTER_MIN, half, y);
  }
  // 5. The last resort: one row, on whichever spot and plate height lets its letters be biggest -- a squat plate over
  // a centre exit if that's all there's room for, never one a pipe comes through.
  let best: { y: number; h: number; half: number; letter: number } | null = null;
  for (let h = PLATE_HEIGHT; h >= 0.04 - 1e-9; h -= 0.005) {
    for (const y of spots(h)) {
      const room = y === py && recessFree ? Math.max(PLATE_HALF, halfAt(y, h)) : halfAt(y, h);
      if (room <= 0.05) continue;
      const letter = Math.min(LETTER, (h * 7) / 10, (2 * room * 7) / (6 * clean.length - 1 + 4));
      if (!best || letter > best.letter + 1e-9) best = { y, h, half: room, letter };
    }
  }
  // (Nowhere clear at all -- a centre exit in the recess with the diffuser under it and the lamps over it: the plate
  // stands PROUD on its bracket at the recess, out past the pipe's lip and the fins, so it's still read, never pierced.)
  const proud = !best;
  if (!best) best = { y: py, h: PLATE_HEIGHT, half: PLATE_HALF, letter: Math.min(LETTER, (2 * PLATE_HALF * 7) / (6 * clean.length - 1 + 4)) };
  const letter = Math.max(LETTER_FLOOR, best.letter);
  // (A plate never wider than its text needs once it's past the car's own.)
  const half = Math.max(Math.min(best.half, Math.max(PLATE_HALF, textHalf(clean.length, letter))), textHalf(clean.length, letter));
  const fit = at([clean], letter, half, best.y, best.h);
  if (!proud) return fit;
  const zP = Math.min(zR, -L2 - 0.17);
  return { ...fit, z0: zP - 0.016, z1: zP + 0.01, proud: true };
}
/** Half the width a row of n letters takes at a letter height, with two font pixels either side. */
const textHalf = (n: number, letter: number): number => (((6 * n - 1 + 4) * letter) / 7) / 2;
/** A plate's height for rows of letters: the car's own for one row, a font pixel and a half above, below and between for more. */
const plateHeight = (rows: number, letter: number): number => (rows <= 1 ? PLATE_HEIGHT : ((rows * 7 + (rows - 1) * 2 + 4) * letter) / 7);

/**
 * A plate off a car: the standard plate, lettered with this text, for a showcase or a shop window. The rules are the
 * plate's own -- the letters shrink first, then a second row and a third, then the letters shrink again -- but there
 * is no car to make room on, so the plate itself never grows: its size is the size a real one is.
 *
 * (A car's plate is `plateFit`, which is where the growing, rising and clearing of exhaust tips lives. This is the
 * same plate with nothing in its way.)
 */
export function plateCard(text: string, half = PLATE_HALF, height = PLATE_HEIGHT): PlateFit {
  const clean = text.trim().toUpperCase();
  const widest = (rows: readonly string[]): number => Math.max(...rows.map((r) => r.length));
  /** The biggest letters that put `rows` inside a plate this size. */
  const letterFor = (rows: readonly string[]): number => {
    const byWidth = (2 * half * 7) / (6 * widest(rows) - 1 + 4);
    // (One row keeps the plate's own height; more share it, a font pixel and a half above, below and between.)
    const byHeight = rows.length <= 1 ? (height * 7) / 10 : (height * 7) / (rows.length * 7 + (rows.length - 1) * 2 + 4);
    return Math.min(LETTER, byWidth, byHeight);
  };
  let best: { rows: string[]; letter: number } | null = null;
  for (let n = 1; n <= 3; n += 1) {
    const rows = splitRows(clean, n);
    if (rows.length < n) break;
    const letter = letterFor(rows);
    // (More rows only if they letter it bigger: "AB" over two rows is two big letters and reads as nonsense.)
    if (!best || letter > best.letter + 1e-9) best = { rows, letter };
    if (letter >= LETTER - 1e-9) break;
  }
  const rows = best?.rows ?? [clean], letter = Math.max(LETTER_FLOOR, best?.letter ?? LETTER_FLOOR);
  return { text: clean, rows, half, y0: 0, y1: height, z0: -0.016, z1: 0.01, letter, grown: false, moved: false };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** The plate as a bake shape: the plate, and a dark rim behind it. Keyed by its size and place alone (never its text). */
export function plateDesign(fit: PlateFit): VehicleDesign {
  const S = solids();
  const { half, y0, y1, z0, z1 } = fit;
  component(S, "plate", () => {
    box(S, P.dark, -half - 0.01, y0 - 0.01, z0 + 0.004, half + 0.01, y1 + 0.01, z1);
    box(S, P.plate, -half, y0, z0, half, y1, z1 - 0.004);
    for (const side of [-1, 1]) {
      const x = side * Math.max(0.02, half - 0.026), y = y1 - 0.015;
      cap(S, P.metal, [x, y, z0 - 0.002], [x, y, z0 - 0.009], 0.008);
      box(S, P.dark, x - 0.005, y - 0.0015, z0 - 0.017, x + 0.005, y + 0.0015, z0 - 0.015);
    }
  });
  // (Moved off the recess: the recess is filled flush, so it doesn't stand there as a blank plate.)
  const c = fit.cover;
  if (c) box(S, c.slot, -0.275, c.y0, c.z - 0.013, 0.275, c.y1, c.z + 0.005);
  const world: BakeWorld = { boxes: S.boxes, wedges: S.wedges, capsules: S.capsules };
  return {
    components: [...S.boxes, ...S.wedges, ...S.capsules].map(s => S.components?.get(s) ?? null),
    key: `packs/vehicles:plate:bolted:${r3(half)}.${r3(y0)}.${r3(y1)}.${r3(z0)}${c ? `:c${r3(c.y0)}.${r3(c.z)}.${c.slot}` : ""}`, clips: [{ name: "still", frames: 1 }],
    height: r3(y1 + 0.06), radius: r3(dhypot(half + 0.02, Math.abs(z0)) + 0.05), pose: () => world,
  };
}

/** A plate's texture: its picture (ink 1..4 per texel, as bake decals are) and its inks; the LAST ink letters it. */
export interface PlateTexture { readonly decal: Decal; readonly inks: readonly Colour[] }
/** What bodyPaint puts on the plate: its picture with the text on it, and the inks. */
export interface PlatePaint { readonly decal: Decal; readonly inks: readonly Colour[] }

const PLAIN_INKS: readonly Colour[] = [{ light: 0.93, chroma: 0.015, hue: 95 }, { light: 0.3, chroma: 0.09, hue: 262 }];

/** The plate's picture: its texture stretched over it (or plain white with a rim), its rows of text in the lettering ink. */
export function plateDecal(fit: PlateFit, texture: PlateTexture | null = null): PlatePaint {
  // (One texel a font pixel: the letters are the font, however big the plate.)
  const px = fit.letter / 7;
  const W = Math.max(8, Math.min(1024, Math.round((2 * fit.half) / px))), H = Math.max(6, Math.min(256, Math.round((fit.y1 - fit.y0) / px)));
  const c = canvas(W, H);
  const inks = texture && texture.inks.length >= 2 ? texture.inks.slice(0, 4) : PLAIN_INKS;
  const ink = inks.length;
  if (texture && texture.inks.length >= 2) {
    const t = texture.decal;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const o = (Math.floor((y * t.height) / H) * t.width + Math.floor((x * t.width) / W)) * 4;
      const k = t.texels[o] ?? 0;
      put(c, x, y, k >= 1 && k <= ink ? k : 1, (t.texels[o + 1] ?? 128) - 128, t.texels[o + 2] ?? 230);
    }
  } else {
    fillRect(c, 0, 0, W, H, 1);
    rim(c, ink);
  }
  const rows = fit.rows, gap = 2, block = rows.length * 7 + (rows.length - 1) * gap;
  const top = Math.round((H - block) / 2);
  rows.forEach((row, i) => {
    const w = 6 * row.length - 1;
    plateText_(c, row, Math.round((W - w) / 2), top + i * (7 + gap), ink);
  });
  return { decal: { width: W, height: H, texels: c.t }, inks };
}
const rim = (c: Canvas, ink: number): void => { for (let x = 0; x < c.w; x += 1) { put(c, x, 0, ink); put(c, x, c.h - 1, ink); } for (let y = 0; y < c.h; y += 1) { put(c, 0, y, ink); put(c, c.w - 1, y, ink); } };
function plateText_(c: Canvas, s: string, x: number, y: number, ink: number): void {
  let cx = x;
  for (const ch of s) {
    const g = PLATE_GLYPHS[ch];
    if (g) g.forEach((row, ry) => { for (let rx = 0; rx < 5; rx += 1) if (row & (16 >> rx)) put(c, cx + rx, y + ry, ink, 0, 240); });
    cx += 6;
  }
}

/** Everything a game needs for a plate: where it goes, its shape and its paint. Null for a car that has none. */
export function carPlate(car: Car, text: string, texture: PlateTexture | null = null): { fit: PlateFit; design: VehicleDesign; paint: PlatePaint } | null {
  const fit = plateFit(car, text);
  if (!fit) return null;
  return { fit, design: plateDesign(fit), paint: plateDecal(fit, texture) };
}
