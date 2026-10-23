// A nocturne's song: NOCTURNES' procedural scenes' music, in the house sound of
// its Halloween soundtrack (music box and celesta, the drone, the driven synth
// bass over a sub, the saw pad, the twang) and a little generative. NOCTURNES
// plays it from here (src/nightsong.js re-exports it); nightkit.ts renders it.
//
// It is built from a few fixed things that are known to work together, and
// the seed only chooses among them:
//
//   a FEEL     one of seven curated tempos and meters (drift, lullaby, waltz,
//              amble, creep, prowl, gallop), each with two BPMs and its own
//              loop length (40-52 s, a whole number of four-chord passes);
//   a MODE     from the palette's harmony (always a minor mode: aeolian,
//              dorian, harmonic minor, phrygian), the key from its hue; each
//              mode has written A and B progressions, and grows its own;
//   LAYERS     one of each family on the same chords: a LEAD (a motif with
//              its answer, or long theremin lines; the busy riff and arp are
//              pins) on a voice (music box, celesta, kalimba, the twang, the
//              chip, the theremin); a BASS (pedal, pulse, walk, 3+3+2
//              ostinato, gallop); a PAD (saw, organ, choir) over the drone; a
//              KIT (tiptoe, heartbeat, brushed; house and march are pins); and
//              one or two OVERLAYS (the twang's tremolo, a plucked harp line, a
//              surf twang on the chord changes, glass bells, the chip, the
//              choir, the music box's answer, a theremin line).
//
// Every layer reads the same chord a span and the same scale (a chord tone
// that isn't in the mode moves the scale to it), keeps to its own register,
// and fits its feel's grid, so any mix of them is in key and in time. The
// scene sets the odds: what's out the window, how dark the night is, the
// palette, the theme of the things on the sill, the eclipse.
//
// The form is the soundtrack's: the lead (or nearly) first, each layer coming
// in on its own pass, the last span turning back to the top. nightSongOf() is
// plain data (the trailer-score arrangement form), the same for everyone with
// that seed.

import { moodOfNocturnes } from "./nocturnes.ts";
import type { NocturnesGenome } from "./nocturnes.ts";

// ---------------------------------------------------------------- the seed's stream

interface NightStream {
  readonly f: () => number;
  readonly chance: (p: number) => boolean;
  readonly int: (a: number, b: number) => number;
  readonly pick: <T>(xs: readonly T[]) => T;
  /** A weighted draw from { name: weight } (zero weights never win). */
  readonly weigh: (w: Readonly<Record<string, number>>) => string;
}

function fnv(text: string): number { let h = 2166136261; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
function stream(key: string): NightStream {
  let a = fnv(String(key)) || 1;
  const f = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    f, chance: (p) => f() < p, int: (a0, b0) => a0 + Math.floor(f() * (b0 - a0 + 1)), pick: <T>(xs: readonly T[]): T => xs[Math.floor(f() * xs.length)]!,
    weigh: (w) => { const e = Object.entries(w).filter(([, v]) => v > 0); let x = f() * e.reduce((s, [, v]) => s + v, 0); for (const [k, v] of e) { x -= v; if (x < 0) return k; } return e.at(-1)![0]; },
  };
}

// ---------------------------------------------------------------- the fixed things

export interface NightFeel { readonly meter: string; readonly bpms: readonly number[]; readonly hr: number; readonly passes: number; readonly energy: number }
/** The feels: meter, two BPMs, chord span (bars a chord), passes of four chords. */
export const NIGHT_FEELS: Readonly<Record<string, NightFeel>> = {
  drift: { meter: "4t", bpms: [60, 64], hr: 1, passes: 3, energy: 0.15 },
  lullaby: { meter: "2t", bpms: [64, 70], hr: 2, passes: 3, energy: 0.3 },
  waltz: { meter: "3", bpms: [84, 92], hr: 2, passes: 3, energy: 0.4 },
  amble: { meter: "4", bpms: [74, 80], hr: 1, passes: 4, energy: 0.45 },
  creep: { meter: "4", bpms: [88, 94], hr: 1, passes: 4, energy: 0.6 },
  prowl: { meter: "5", bpms: [92, 100], hr: 1, passes: 4, energy: 0.7 },
  gallop: { meter: "4t", bpms: [100, 108], hr: 1, passes: 5, energy: 0.8 },
  lofi: { meter: "4", bpms: [74, 76, 78, 80, 82, 84, 86, 88, 90], hr: 1, passes: 4, energy: 0.5 },
};
type Pt = readonly [number, number];
interface Meter {
  readonly beats: number; readonly sub: number; readonly bass: readonly Pt[]; readonly fastBass: readonly number[]; readonly kick: readonly number[]; readonly fastKick: readonly number[];
  readonly open: readonly number[]; readonly snare: readonly number[]; readonly fastSnare: readonly number[]; readonly clap: number; readonly bells: readonly Pt[]; readonly back: readonly number[];
}
// A meter: beats a bar, its grid (the step the tune and the hats move on), and the kit's patterns.
const METER: Readonly<Record<string, Meter>> = {
  "5": { beats: 5, sub: 0.5, bass: [[0, 1.4], [3, 0.9]], fastBass: [1.5, 2, 4, 4.5], kick: [0, 0.5, 3], fastKick: [0, 0.5, 1, 2, 3, 4], open: [1.5, 3], snare: [3], fastSnare: [1, 3, 4.5], clap: 3, bells: [[0, 0], [1.5, 2], [3, 0], [4, 1]], back: [3] },
  "4": { beats: 4, sub: 0.5, bass: [[0, 1.4], [1.5, 0.4], [2.5, 1.2]], fastBass: [1, 2, 3, 3.5], kick: [0, 0.5, 2.5], fastKick: [0, 0.5, 1, 2, 2.5, 3], open: [1.5, 3.5], snare: [2], fastSnare: [1, 2, 3.5], clap: 2, bells: [[0, 0], [1.5, 2], [2.5, 0], [3, 1]], back: [1, 3] },
  "3": { beats: 3, sub: 0.5, bass: [[0, 1.4], [2, 0.9]], fastBass: [1, 1.5, 2.5], kick: [0, 1.5], fastKick: [0, 0.5, 1, 1.5, 2], open: [1.5], snare: [2], fastSnare: [1, 2, 2.5], clap: 2, bells: [[0, 0], [1, 2], [2, 1]], back: [1, 2] },
  "4t": { beats: 4, sub: 1 / 3, bass: [[0, 1.3], [5 / 3, 0.3], [2, 1.3], [11 / 3, 0.3]], fastBass: [1, 5 / 3, 3, 10 / 3], kick: [0, 2 / 3, 8 / 3], fastKick: [0, 2 / 3, 1, 2, 8 / 3, 3], open: [5 / 3, 11 / 3], snare: [2], fastSnare: [1, 2, 10 / 3], clap: 2, bells: [[0, 0], [4 / 3, 2], [2, 0], [3, 1]], back: [1, 3] },
  "2t": { beats: 2, sub: 1 / 3, bass: [[0, 1.3], [1, 0.9]], fastBass: [2 / 3, 5 / 3], kick: [0, 5 / 3], fastKick: [0, 1 / 3, 1, 5 / 3], open: [2 / 3], snare: [1], fastSnare: [1, 5 / 3], clap: 1, bells: [[0, 0], [2 / 3, 2], [1, 1]], back: [1] },
};
/** The modes a nocturne may be in (the scale over its tonic). */
export const NIGHT_MODES: Readonly<Record<string, readonly number[]>> = {
  aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const Q: Readonly<Record<string, readonly number[]>> = { m: [0, 3, 7], M: [0, 4, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], M7: [0, 4, 7, 11], mM7: [0, 3, 7, 11], m6: [0, 3, 7, 9], dim: [0, 3, 6], hdim: [0, 3, 6, 10], dim7: [0, 3, 6, 9], sus: [0, 5, 7] };
/** A chord of a progression: [root over the tonic, quality]. */
export type NightChord = [number, string];
type Prog = readonly (readonly [number, string])[];
// Each mode's progressions, four chords a pass. A starts at home; B leaves it and turns back.
const PROGS: Readonly<Record<string, { readonly A: readonly Prog[]; readonly B: readonly Prog[] }>> = {
  aeolian: {
    A: [[[0, "m"], [8, "M"], [3, "M"], [10, "M"]], [[0, "m"], [5, "m"], [8, "M"], [7, "7"]], [[0, "m"], [10, "M"], [8, "M"], [7, "7"]], [[0, "m"], [8, "M"], [5, "m"], [7, "7"]]],
    B: [[[5, "m"], [0, "m"], [8, "M"], [7, "7"]], [[8, "M"], [10, "M"], [3, "M"], [7, "7"]], [[5, "m7"], [10, "M"], [3, "M7"], [7, "7"]], [[8, "M7"], [5, "m"], [2, "hdim"], [7, "7"]]],
  },
  dorian: {
    A: [[[0, "m"], [0, "m7"], [5, "M"], [0, "m"]], [[0, "m"], [10, "M"], [0, "m"], [5, "M"]], [[0, "m7"], [2, "m"], [0, "m7"], [5, "M"]], [[0, "m"], [3, "M"], [10, "M"], [0, "m"]]],
    B: [[[3, "M"], [10, "M"], [0, "m"], [7, "m"]], [[2, "m"], [0, "m"], [10, "M"], [5, "M"]], [[10, "M"], [0, "m"], [3, "M"], [7, "m"]]],
  },
  harmonic: {
    A: [[[0, "m"], [5, "m"], [7, "7"], [0, "m"]], [[0, "m"], [8, "M"], [2, "dim"], [7, "7"]], [[0, "m"], [1, "M"], [7, "7"], [0, "m"]], [[0, "m"], [0, "mM7"], [0, "m7"], [0, "m6"]], [[0, "mM7"], [8, "M"], [5, "m"], [7, "7"]]],
    B: [[[5, "m"], [8, "M"], [11, "dim7"], [7, "7"]], [[8, "M7"], [1, "M"], [7, "7"], [7, "7"]], [[5, "m6"], [0, "m"], [11, "dim7"], [7, "7"]]],
  },
  phrygian: {
    A: [[[0, "m"], [1, "M"], [0, "m"], [10, "m"]], [[0, "m"], [1, "M"], [3, "M"], [1, "M"]], [[0, "m"], [10, "m"], [8, "M"], [1, "M"]]],
    B: [[[8, "M"], [10, "m"], [1, "M"], [0, "m"]], [[5, "m"], [3, "M"], [1, "M"], [1, "M"]]],
  },
  lydian: {
    A: [[[0, "M7"], [2, "M"], [0, "M7"], [2, "M"]], [[0, "M"], [2, "M"], [11, "m"], [7, "M"]], [[0, "M7"], [7, "M"], [2, "M"], [0, "M7"]]],
    B: [[[9, "m"], [2, "M"], [4, "m"], [7, "M"]], [[4, "m"], [9, "m"], [2, "M"], [2, "M"]]],
  },
  ionian: {
    A: [[[0, "M"], [9, "m"], [5, "M"], [7, "M"]], [[0, "M7"], [4, "m"], [9, "m7"], [5, "M"]], [[0, "M"], [5, "M"], [5, "m"], [0, "M"]]],
    B: [[[9, "m"], [5, "M"], [0, "M"], [7, "M"]], [[5, "M7"], [5, "m6"], [0, "M"], [7, "7"]], [[2, "m"], [7, "M"], [4, "m"], [9, "m"]]],
  },
  mixolydian: {
    A: [[[0, "M"], [10, "M"], [5, "M"], [0, "M"]], [[0, "7"], [10, "M"], [5, "M"], [5, "m"]], [[0, "M"], [5, "M"], [10, "M"], [5, "M"]]],
    B: [[[5, "M"], [10, "M"], [0, "M"], [7, "m"]], [[10, "M"], [5, "m"], [0, "M"], [0, "M"]]],
  },
};
type Cell = readonly Pt[];
// Lead rhythm cells over one span: [onset, length] in beats. A span is 4 beats straight, 4 in triplets, 6 (a waltz's two bars) or 5.
const CELLS: Readonly<Record<string, readonly Cell[]>> = {
  "4": [[[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]], [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]], [[0.5, 0.5], [1, 0.5], [1.5, 1.5], [3, 1]], [[0, 0.75], [0.75, 0.25], [1, 1], [2, 0.5], [2.5, 1.5]], [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2]], [[0, 2], [2, 0.5], [2.5, 0.5], [3, 1]], [[1, 1], [2, 1], [3, 1]], [[0, 0.5], [0.5, 1.5], [2, 1.5], [3.5, 0.5]]],
  "4t": [[[0, 2 / 3], [2 / 3, 1 / 3], [1, 1], [2, 2]], [[0, 1], [1, 1 / 3], [4 / 3, 1 / 3], [5 / 3, 1 / 3], [2, 2]], [[0, 4 / 3], [4 / 3, 2 / 3], [2, 2]], [[0, 1 / 3], [1 / 3, 1 / 3], [2 / 3, 1 / 3], [1, 1], [2, 1], [3, 1]], [[0, 2 / 3], [2 / 3, 1 / 3], [1, 2 / 3], [5 / 3, 1 / 3], [2, 2]], [[0, 2], [2, 2 / 3], [8 / 3, 1 / 3], [3, 1]], [[1 / 3, 2 / 3], [1, 1], [2, 4 / 3], [10 / 3, 2 / 3]]],
  "6": [[[0, 2], [2, 1], [3, 1], [4, 1], [5, 1]], [[0, 1], [1, 1], [2, 1], [3, 3]], [[0, 1.5], [1.5, 0.5], [2, 1], [3, 2], [5, 1]], [[1, 1], [2, 1], [3, 1.5], [4.5, 0.5], [5, 1]], [[0, 3], [3, 1], [4, 2]], [[0, 0.5], [0.5, 0.5], [1, 2], [3, 1], [4, 1]]],
  "5": [[[0, 1], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 2]], [[0, 1.5], [1.5, 1.5], [3, 1], [4, 1]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1], [3, 1.5], [4.5, 0.5]], [[0, 3], [3, 1], [4, 1]], [[0.5, 1], [1.5, 1.5], [3, 0.5], [3.5, 1.5]], [[0, 2], [2, 1], [3, 0.5], [3.5, 0.5], [4, 1]], [[1, 1], [2, 1.5], [3.5, 1.5]]],
};
// Cadences (the phrase's close, the seed's pick): where the held note lands and how long it rings.
const CADENCE: Readonly<Record<string, readonly Cell[]>> = {
  "4": [[[0, 1], [1, 3]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]], [[0, 1.5], [1.5, 0.5], [2, 2]]],
  "4t": [[[0, 2 / 3], [2 / 3, 1 / 3], [1, 3]], [[0, 1], [1, 1], [2, 2]], [[0, 4 / 3], [4 / 3, 2 / 3], [2, 2]]],
  "6": [[[0, 2], [2, 1], [3, 3]], [[0, 1], [1, 1], [2, 4]], [[0, 3], [3, 3]]],
  "5": [[[0, 1.5], [1.5, 1.5], [3, 2]], [[0, 1], [1, 1], [2, 3]], [[0, 2], [2, 0.5], [2.5, 2.5]]],
};
// Contours: steps along the scale from the cell's first note (snapped to a chord tone on the strong beats).
const CONTOURS: readonly (readonly number[])[] = [[0, 1, 2, -1, -2, 0], [0, -1, -2, 1, 2, 1], [0, 2, 1, -1, 0, -2], [0, 1, -1, -2, -1, 0], [0, -2, -1, 1, 0, 2], [0, 3, 2, 1, 0, -1],
  [0, 2, 4, 3, 1, -1], [0, -3, -1, 1, 2, 0], [0, 4, 3, 1, 2, -1], [0, 2, -1, 3, 1, 0], [0, -2, 2, 1, -1, 3], [0, 3, 1, 4, 2, 0]];
// Riff groupings of a span's steps (the theme's 3+3+2 kin).
const GROUPS: Readonly<Record<number, readonly (readonly number[])[]>> = { 8: [[3, 3, 2], [3, 3, 2]], 12: [[3, 3, 3, 3], [3, 3, 2, 2, 2]], 10: [[3, 3, 2, 2], [3, 2, 3, 2]] };
const ARPS: readonly (readonly number[])[] = [[0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 1, 2], [0, 1, 2, 1, 3, 2], [3, 2, 1, 0, 1, 2], [0, 2, 3, 1]];

/** The families' choices (the studio's pins). */
export const NIGHT_LEADS: readonly string[] = ["musicbox", "celesta", "kalimba", "twang", "pulse", "theremin", "epiano", "vibes2", "mutedgtr", "rhodes", "flute"];
export const NIGHT_LEAD_STYLES: readonly string[] = ["riff", "arp", "motif", "long"];
export const NIGHT_BASSES: readonly string[] = ["pedal", "pulse", "walk", "ostinato", "gallop"];
export const NIGHT_PADS: readonly string[] = ["saw", "organ", "choir", "rhodes", "wurli"];
export const NIGHT_KITS: readonly string[] = ["none", "tiptoe", "heart", "brushed", "house", "march", "boombap"];
export const NIGHT_OVERLAYS: readonly string[] = ["tremolo", "harp", "surf", "bells", "chip", "choir", "answer", "line"];
export const NIGHT_AIRS: Readonly<Record<string, string>> = { Rain: "rain", Sea: "sea", Cruise: "sea", Fog: "wind", Skyscraper: "wind", Void: "wind", Snow: "wind", Hills: "wind", CountryRoad: "wind" };
const TWANGS = new Set(["tremolo", "harp", "surf"]);

// The registers (MIDI): each family keeps to its own.
const LEAD_RANGE: Readonly<Record<string, readonly [number, number]>> = { musicbox: [64, 81], celesta: [64, 81], kalimba: [64, 81], twang: [66, 83], pulse: [64, 82], theremin: [67, 84], epiano: [62, 79] };

// ---------------------------------------------------------------- the scene's odds

type Weights = Record<string, number>;
const VIEW_FEEL: Readonly<Record<string, Weights>> = {
  Rain: { drift: 3, lullaby: 2, amble: 2 }, Fog: { drift: 4, lullaby: 1, creep: 1 }, Void: { drift: 3, prowl: 1 },
  Sea: { lullaby: 4, waltz: 1, drift: 1 }, Cruise: { lullaby: 3, waltz: 2 }, Snow: { waltz: 4, lullaby: 1, drift: 1 },
  City: { amble: 3, creep: 3, prowl: 1 }, Skyscraper: { creep: 2, prowl: 2, amble: 1 }, Town: { amble: 3, waltz: 2 },
  Suburb: { amble: 2, gallop: 2, waltz: 1 }, CountryRoad: { gallop: 3, amble: 1 }, Hills: { gallop: 2, waltz: 2 },
  Space: { drift: 2, prowl: 2 }, Aurora: { drift: 2, prowl: 1, lullaby: 1 }, Moon: { lullaby: 3, waltz: 2 },
  Stars: { lullaby: 2, waltz: 2, drift: 1 }, Dusk: { amble: 2, waltz: 2, creep: 1 }, Vaporwave: { creep: 3, amble: 1 },
};
interface Lean { readonly lead?: Weights; readonly over?: Weights; readonly kit?: Weights; readonly pad?: Weights; readonly bass?: Weights }
const THEME_LEAN: Readonly<Record<string, Lean>> = {
  "Retro Den": { over: { chip: 4 } }, "Game Night": { over: { chip: 4 }, kit: { house: 2 } },
  Mixtape: { lead: { twang: 4 }, over: { surf: 2, tremolo: 2 }, kit: { house: 1 } }, Collector: { lead: { musicbox: 2 }, over: { bells: 2 } },
  Candlelight: { pad: { organ: 3, choir: 2 }, over: { bells: 2 } }, "The Reading": { pad: { organ: 2, choir: 3 }, over: { line: 2, bells: 1 } },
  "Green Sill": { over: { harp: 3 } }, Nightcap: { bass: { walk: 3 }, kit: { brushed: 3 }, over: { tremolo: 1 } },
  "Night Desk": { bass: { walk: 2 }, kit: { brushed: 2 } }, Bedside: { lead: { musicbox: 3 }, kit: { tiptoe: 2 } },
  "Late Shift": { bass: { pulse: 2, ostinato: 2 }, kit: { heart: 2 } }, "A Room": { over: { harp: 1, tremolo: 1 } },
};
// The palette's harmony as a mode, and the modes it may lean to.
const SCHEME_MODES: Readonly<Record<string, Weights>> = {
  // (Dorian's major IV reads bright: it is the brightest palettes' only, and even there the plain minor leads.)
  aeolian: { aeolian: 4, harmonic: 3, dorian: 0.3 }, dorian: { aeolian: 3, dorian: 1.5, harmonic: 1, phrygian: 0.5 }, mixolydian: { aeolian: 3, dorian: 1, harmonic: 1.5 },
  lydian: { aeolian: 2, harmonic: 2, dorian: 1 }, ionian: { aeolian: 3, harmonic: 2, dorian: 0.5 }, phrygian: { phrygian: 2, harmonic: 2, aeolian: 1 }, harmonic: { harmonic: 4, aeolian: 1 },
};
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const mul = (base: Weights, lean: Weights | undefined): Weights => { const o = { ...base }; for (const [k, v] of Object.entries(lean ?? {})) o[k] = (o[k] ?? 0) + v; return o; };

// ---------------------------------------------------------------- harmony helpers

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const place = (pc: number, lo: number): number => lo + mod(pc - lo, 12);
/** The pitch with a class in `pcs` nearest p (ties go up). */
const nearestIn = (pcs: readonly number[], p: number): number => { for (let d = 0; d < 12; d += 1) { if (pcs.includes(mod(p + d, 12))) return p + d; if (pcs.includes(mod(p - d, 12))) return p - d; } return p; };
/** k steps along the scale from p (p first snapped into it). */
function stepScale(pcs: readonly number[], p: number, k: number): number { let q = nearestIn(pcs, p); const dir = Math.sign(k); for (let i = 0; i < Math.abs(k); i += 1) { do q += dir; while (!pcs.includes(mod(q, 12))); } return q; }
/** A chord's scale: the mode, with any of the chord's tones the mode lacks taking the place of the notes a semitone off. */
function scaleFor(modePcs: readonly number[], chordPcs: readonly number[]): number[] {
  let s = [...modePcs];
  for (const c of chordPcs) if (!s.includes(c)) { s = s.filter((x) => mod(x - c, 12) !== 1 && mod(c - x, 12) !== 1); s.push(c); }
  return s;
}
const fold = (p: number, lo: number, hi: number): number => { while (p < lo) p += 12; while (p > hi) p -= 12; return p; };
/** A note that may be held over a chord: a chord tone, or a tension no chord tone rubs a semitone against; else the nearest chord tone. */
const safe = (pcs: readonly number[], q: number): number => (pcs.includes(mod(q, 12)) || !pcs.some((x) => mod(x - q, 12) === 1 || mod(q - x, 12) === 1) ? q : nearestIn(pcs, q));

// ---------------------------------------------------------------- the song

const r4 = (x: number): number => Math.round(x * 10000) / 10000;

/** What a nocturne is made from: a scene's mood (moodOfNocturnes, or one of its own). */
export interface NightMood {
  readonly seed?: string | number | undefined;
  readonly view?: string | undefined;
  readonly dark?: number | undefined;
  readonly name?: string | undefined;
  readonly mode?: string | undefined;
  readonly eclipse?: boolean | undefined;
  readonly hue?: number | undefined;
}
/** The studio's pins: theme (the feel), kit, keys (the pad), lead, bass, mode, key, tempo. */
export interface NightPins {
  readonly theme?: string | undefined; readonly kit?: string | undefined; readonly keys?: string | undefined; readonly lead?: string | undefined; readonly bass?: string | undefined;
  readonly mode?: string | undefined; readonly key?: string | number | undefined; readonly tempo?: string | number | undefined;
}
export interface NightGroove {
  readonly ghosts: boolean; readonly fill: number; readonly accent: string; readonly hats: string; readonly shake: string; readonly vary: number; readonly drop: number;
  readonly kick2: number; readonly bassFig: number; readonly kickEvery: number; readonly rimShift: number;
}
export interface NightMotif { readonly cells: readonly number[]; readonly contours: readonly number[]; readonly arp: number; readonly cad: number; readonly start: number; readonly hold: boolean }
/** Every choice, before a note is written. */
export interface NightPlan {
  readonly seed: string; readonly feel: string; readonly meter: string; readonly bpm: number; readonly hr: number; readonly passes: number; readonly mode: string; readonly tonic: number; readonly key: string;
  readonly lead: string; readonly style: string; readonly bass: string; readonly pad: string; readonly drone: boolean; readonly kit: string; readonly groove: NightGroove; readonly overlays: readonly string[];
  readonly air: string | null; readonly enter: Readonly<Record<string, number>>; readonly progA: Prog; readonly progB: Prog; readonly riffGroup: number; readonly pedalDeg: number; readonly riffLine: string;
  readonly motif: NightMotif; readonly view: string; readonly dark: number; readonly theme: string | undefined;
  /** How late the off-beat eighths fall (beats; 0 on the triplet feels, swung already). */
  readonly swing: number;
  readonly lofi: NightLofi;
}
/** The record's treatment (nightkit.ts plays it on the whole mix): tape wow and flutter (Hz, ms), the low-pass, bits and the rate held to, hiss and crackle (pops a second), saturation, stereo width, the pads' pump under the kick. */
export interface NightLofi {
  readonly wow: number; readonly wowDepth: number; readonly flutter: number; readonly flutterDepth: number; readonly cutoff: number; readonly bits: number; readonly hold: number;
  readonly hiss: number; readonly crackle: number; readonly drive: number; readonly width: number; readonly pump: number;
}

const has = <T>(xs: readonly T[], x: unknown): x is T => xs.includes(x as T);

/** The song's plan from a scene's mood (moodOfNocturnes) and pins: every choice, before a note is written. */
export function nightPlanOf(mood: NightMood, pins: NightPins = {}): NightPlan {
  const S = stream(`${mood.seed}|nightsong`);
  const view = mood.view ?? "Stars";
  const dark = mood.dark ?? 0.72;
  const lean: Lean = (mood.name !== undefined ? THEME_LEAN[mood.name] : undefined) ?? {};
  // The feel: the view's odds; a dark night leans slow, a light one quick.
  const feelW = mul({ drift: 0.6, lullaby: 0.8, waltz: 0.15, amble: 1.4, creep: 0.3, prowl: 0, gallop: 0.4 }, VIEW_FEEL[view]); // (laid back: four or twelve to the bar, 60-90 BPM, first)
  feelW.gallop = 0; feelW.prowl = 0; // (the gallop and the 5/4 prowl are pins only: not lo-fi enough for a night)
  feelW.waltz = Math.min(feelW.waltz!, 0.2);
  for (const k of Object.keys(feelW)) feelW[k] = feelW[k]! * (1 + (0.6 - dark) * (0.5 - NIGHT_FEELS[k]!.energy) * 2.5);
  const tempoPin = Number(pins.tempo);
  const feel = pins.theme !== undefined && NIGHT_FEELS[pins.theme] ? pins.theme : Object.keys(NIGHT_FEELS).find((k) => NIGHT_FEELS[k]!.bpms.includes(tempoPin)) ?? S.weigh(feelW);
  const F = NIGHT_FEELS[feel]!;
  const bpm = F.bpms.includes(tempoPin) ? tempoPin : dark < 0.5 ? F.bpms[0]! : S.pick(F.bpms);
  // The mode and the key: the palette's harmony and hue, always a minor mode (the soundtrack is minor, 13 of 13): a
  // bright palette takes dorian, the brightest of them; a dark night or an eclipse darkens it.
  const modeW: Weights = { ...((mood.mode !== undefined ? SCHEME_MODES[mood.mode] : undefined) ?? SCHEME_MODES.aeolian!) };
  const modePinned = pins.mode !== undefined && NIGHT_MODES[pins.mode] !== undefined;
  if (dark < 0.5) modeW.harmonic = (modeW.harmonic ?? 0) + 1;
  if (dark < 0.6 && !modePinned) modeW.dorian = 0; // (dorian's brightness only on the darkest nights)
  if (mood.eclipse) modeW.harmonic = (modeW.harmonic ?? 0) + 5;
  const mode = modePinned ? pins.mode! : S.weigh(modeW);
  const keyPin = typeof pins.key === "string" && NAMES.includes(pins.key) ? NAMES.indexOf(pins.key) : pins.key !== undefined && pins.key !== "" && Number.isFinite(Number(pins.key)) ? mod(Number(pins.key), 12) : null;
  // (The palette's key, or its fourth or fifth: the seed's, so two rooms of one colour aren't one song.)
  const keyShift = stream(`${mood.seed}|nightsong|key`).pick([0, 0, 5, 7]);
  const tonic = keyPin ?? (Number.isFinite(mood.hue) ? (Math.round(mood.hue! / 30) + keyShift) % 12 : S.int(0, 11));
  // The layers: each family's odds, then the rules that keep any mix of them honest.
  const meter = F.meter, triplet = meter.endsWith("t");
  // The lead is the house's: the music box (the celesta an octave over it) or the twang (the music box over it).
  const lead = has(NIGHT_LEADS, pins.lead) ? pins.lead : S.weigh(mul({ celesta: 2, musicbox: 1, twang: 4, epiano: 4 }, lean.lead));
  // (A tune that breathes: the busy riff and arp leads are pins only.)
  const styleW: Weights = lead === "theremin" ? { long: 4, motif: 1 } : { motif: 1, riff: 0, arp: 0, long: 0 };
  const style = S.weigh(styleW);
  const bassW = mul({ pedal: 2, pulse: 3, walk: F.energy < 0.6 && bpm <= 92 ? 3 : 0, ostinato: triplet || meter === "3" || F.energy < 0.4 || feel === "creep" ? 0 : 1, gallop: 0 }, lean.bass);
  if (F.energy >= 0.6 || bpm > 92) bassW.walk = 0; bassW.gallop = 0; if (feel === "creep" || triplet || meter === "3") bassW.ostinato = 0; // (a bass that holds under a quick feel)
  if (F.energy < 0.25) { bassW.pedal = bassW.pedal! + 4; bassW.walk = 0; bassW.ostinato = 0; bassW.gallop = 0; }
  const bass = has(NIGHT_BASSES, pins.bass) && bassW[pins.bass]! > 0 ? pins.bass : S.weigh(bassW);
  const pad = has(NIGHT_PADS, pins.keys) ? pins.keys : S.weigh(mul({ rhodes: 6, saw: 2, organ: 0.3, choir: 0.6 }, lean.pad));
  // (Always a bed under it: the house never goes dry. The draw is kept, so every seed's stream stays as it was.)
  const drone = S.chance(0.5) || true;
  // The kit: never none from the seed (a still loop is a dull one); light kits for the slow feels.
  const kitW = mul({ tiptoe: 2, heart: F.energy < 0.6 ? 2 : 0.5, brushed: 3, house: 0, march: 0 }, lean.kit); // (the house and march kits are the studio's pins only: too busy for a night)
  if (dark < 0.45) kitW.house = kitW.house! * 0.5;
  kitW.house = 0; kitW.march = 0;
  const kit = has(NIGHT_KITS, pins.kit) ? pins.kit : S.weigh(kitW);
  // How this seed plays its kit: ghosts or none, a fill to close each pass, the turnaround's accent.
  const groove: NightGroove = {
    ghosts: S.chance(0.5), fill: S.int(0, 3), accent: S.pick(["clap", "open", "rim", "rim"]), hats: S.pick(["sub", "sub", "beat"]), shake: F.energy < 0.35 ? "all" : S.pick(["all", "off", "off", "none"]),
    vary: S.int(0, 99), drop: S.pick([0, 0.12, 0.25]), kick2: S.int(0, 2), bassFig: S.int(0, 4), kickEvery: S.pick([1, 1, 2]), rimShift: S.pick([0, 0, 1]),
  };
  // Overlays: one, or two where the feel is slow enough; a twang always somewhere; never a second of a voice or a register.
  const overW = mul({ tremolo: 2, harp: 1, surf: 2, bells: 2, chip: 0, choir: pad === "choir" ? 0 : 1.5, answer: style === "motif" ? 2 : 0, line: 1.5 }, lean.over);
  if (lead === "twang") { overW.harp = overW.harp! * 0.4; overW.tremolo = overW.tremolo! * 0.5; }
  overW.chip = 0; // (the chip is a pin only: off the house palette)
  if (lead === "theremin" || lead === "musicbox" || pad === "organ") overW.line = 0; // (one theremin, organ or music box a song at most)
  if (style === "riff" || style === "arp") overW.harp = overW.harp! * 0.5; // (two busy lines in eighths crowd each other)
  const overlays: string[] = [];
  const nOver = Math.min(F.energy > 0.65 ? 1 : S.chance(0.6) ? 2 : 1, NIGHT_AIRS[view] ? 1 : 2); // (two layers over the band at most, the air outside counting)
  for (let k = 0; k < nOver; k += 1) {
    const w: Weights = { ...overW };
    for (const o of overlays) { w[o] = 0; if (TWANGS.has(o)) for (const t of TWANGS) w[t] = w[t]! * 0.25; }
    // (A music-box lead needs its twang from an overlay: the last one is a twang if none is yet.)
    if (k === nOver - 1 && lead !== "twang" && !overlays.some((o) => TWANGS.has(o))) for (const o of Object.keys(w)) if (!TWANGS.has(o)) w[o] = 0;
    if (overlays.some((o) => o === "tremolo" || o === "harp" || o === "bells")) { w.tremolo = 0; w.harp = 0; w.bells = 0; if (!Object.values(w).some((v) => v > 0)) break; }
    overlays.push(S.weigh(w));
  }
  const air = NIGHT_AIRS[view] ?? null;
  // When each layer comes in (a pass of the loop): the band from the top, the kit on the second pass, the overlays with the B or after it.
  const P = F.passes, firstB = P === 3 ? 1 : 2;
  const enter: Record<string, number> = { lead: 0, lead2: S.chance(0.5) ? 0 : 1, pad: 0, drone: 0, bass: 0, kit: 0, air: 0 }; // (the beat from the second span: lo-fi doesn't wait long)
  overlays.forEach((o, i) => { enter[o] = o === "tremolo" ? firstB : i === 0 ? 1 : Math.max(1, firstB); });
  // The progressions: mostly grown from the mode's own chords -- A home first and leaving it, B away from home -- else
  // one of the mode's written ones; each pass ending on the mode's dominant (or home, sometimes), three roots at least,
  // home at most once, one major chord at most, no root twice in a row.
  const Rp = stream(`${mood.seed}|nightsong|prog`);
  const scale = NIGHT_MODES[mode]!;
  const grow = (fromHome: boolean): NightChord[] | null => {
    const set = new Set(scale), chordsIn: NightChord[] = [];
    for (const r of scale) for (const q of ["m", "M", "m7", "M7", "hdim"]) if (r !== 0 && Q[q]!.every((x) => set.has((r + x) % 12)) && !(mode === "harmonic" && ![7, 11].includes(r) && Q[q]!.some((x) => (r + x) % 12 === 11))) chordsIn.push([r, q]); // (harmonic minor's raised seventh only in its V and vii)
    const dom: NightChord[] = mode === "aeolian" || mode === "harmonic" ? [[7, "7"], [7, "7"], [10, "M"]] : mode === "phrygian" ? [[1, "M"], [10, "m"]] : [[7, "m"], [10, "M"]];
    for (let tries = 0; tries < 20; tries += 1) {
      const pr: NightChord[] = fromHome ? [[0, Rp.pick(["m", "m", "m7"])]] : [Rp.pick(chordsIn)];
      while (pr.length < 3) pr.push(!fromHome && pr.length === 2 && !pr.some(([r]) => r === 0) ? [0, "m"] : Rp.pick(chordsIn)); // (B comes home once)
      pr.push(Rp.chance(0.8) ? Rp.pick(dom) : [0, "m"]);
      const roots = pr.map(([r]) => r);
      const majors = pr.filter(([, q]) => ["M", "M7"].includes(q)).length;
      const ok = new Set(roots).size >= 3 && majors <= 1 && (fromHome || roots.includes(0)) && roots.filter((r) => r === 0).length <= 1 && pr.filter(([r, q]) => mode === "dorian" && r === 5 && q === "M").length <= 1
        && pr.every((x, i) => i === 0 || x[0] !== pr[i - 1]![0]);
      if (ok) return pr;
    }
    return null;
  };
  const progA: Prog = (Rp.chance(0.75) && grow(true)) || S.pick(PROGS[mode]!.A), progB: Prog = (Rp.chance(0.75) && grow(false)) || S.pick(PROGS[mode]!.B);
  const riffGroup = S.pick([0, 1]), pedalDeg = S.pick([7, 0, 7]), riffLine = S.pick(["fall", "turn", "climb"]);
  const motif: NightMotif = { cells: [S.int(0, 99), S.int(0, 99)], contours: [S.int(0, 99), S.int(0, 99)], arp: S.int(0, 99), cad: S.int(0, 99), start: S.int(0, 99), hold: S.chance(0.5) };
  // The record: lazy swing on the straight feels, the tape's wow and flutter, the top rolled off, a few bits gone,
  // hiss and crackle, saturation, a narrow image -- a darker night more worn.
  const Rl = stream(`${mood.seed}|nightsong|lofi`);
  const worn = Math.min(1, Math.max(0, 1.1 - dark));
  const swing = triplet ? 0 : r4(0.14 + 0.06 * Rl.f());
  const lofi: NightLofi = {
    wow: r4(0.35 + 0.45 * Rl.f()), wowDepth: r4(0.6 + 0.8 * Rl.f() + 0.4 * worn), flutter: r4(6 + 4 * Rl.f()), flutterDepth: r4(0.03 + 0.03 * Rl.f()),
    cutoff: Math.round(8000 + 1500 * Rl.f() - 500 * worn), bits: Rl.pick([11, 12, 12]), hold: 48000, hiss: r4(0.25 + 0.2 * Rl.f()), crackle: r4(1.5 + 4 * Rl.f() + 3 * worn),
    drive: r4(1.6 + 0.5 * Rl.f()), width: r4(0.35 + 0.25 * Rl.f()), pump: r4(0.3 + 0.2 * Rl.f()),
  };
  return {
    seed: String(mood.seed), feel, meter, bpm, hr: F.hr, passes: P, mode, tonic, key: `${NAMES[tonic]} ${mode}`,
    lead, style, bass, pad, drone, kit, groove, overlays, air, enter, progA, progB, riffGroup, pedalDeg, riffLine, motif, view, dark, theme: mood.name, swing, lofi,
  };
}

/** A note in beats (the trailer-score form). */
export interface NightNote { beat: number; beats: number; pitch: number; vel: number }
/** A track: its voice, its notes, and how it's played (gain, pan, reverb, filters, envelope). */
export interface NightTrack {
  readonly id: string; readonly voice: string; notes: NightNote[];
  readonly gain?: number; readonly pan?: number; readonly reverb?: number; readonly release?: number; readonly attack?: number; readonly lowpass?: number | undefined; readonly highpass?: number;
  readonly slap?: number; readonly duty?: number; readonly cutoff?: number; readonly drive?: number; readonly cut?: boolean;
  /** Ducked under the kick, this deep (0..1). */
  readonly pump?: number;
  /** A sampler's bits on the track; a tape echo's level (dotted eighths); a tremolo (auto-pan). */
  readonly crush?: number; readonly presence?: number; readonly echo?: number; readonly tremolo?: { readonly hz: number; readonly depth: number };
}
type TrackOpts = Omit<NightTrack, "id" | "voice" | "notes">;
/** The arrangement (the trailer-score form), as nightkit.ts plays it. */
export interface NightSong {
  readonly version: 1; readonly bpm: number; readonly seed: number; readonly root: number; readonly totalBeats: number; readonly tailSeconds: number; readonly loop: boolean;
  readonly shelf?: { readonly hz?: number; readonly cut?: number };
  readonly focus?: { readonly ids?: readonly string[]; readonly share?: number; readonly most?: number };
  readonly reverb?: { readonly size?: number; readonly damp?: number };
  readonly design?: { readonly bright?: number };
  readonly musicRms?: number;
  readonly lofi?: NightLofi;
  /** The section filter on the band: [beat, Hz] points round the loop (the intro's and the breakdown's low-pass). */
  readonly sweep?: readonly (readonly [number, number])[];
  /** How much of the 150-300 Hz band the mix gives up (0..1): less mud under the band. */
  readonly mud?: number;
  readonly tracks: readonly NightTrack[];
  readonly hits?: readonly unknown[];
}
/** The form: beats a bar and a span, the spans, the sections a pass, the grid the tune moves on. */
export interface NightForm { readonly bar: number; readonly span: number; readonly spans: number; readonly sections: readonly string[]; readonly grid: number }
interface SpanChord { readonly s: number; readonly pass: number; readonly sec: string; readonly at: number; readonly root: number; readonly q: string; readonly iv: readonly number[]; readonly pcs: readonly number[]; readonly scale: readonly number[] }
interface LeadNote { s: number; beat: number; beats: number; pitch: number; vel: number }

/** The song: plain data, the trailer-score arrangement form (tracks of notes in beats) and what it was made from. */
function hauntSongOf(mood: NightMood, pins: NightPins = {}): { plan: NightPlan; song: NightSong; form: NightForm } {
  const p = nightPlanOf(mood, pins);
  const M = METER[p.meter]!, bar = M.beats, span = bar * p.hr, spans = p.passes * 4, total = span * spans;
  const triplet = p.meter.endsWith("t");
  const spanKind = p.meter === "3" ? "6" : p.meter === "5" ? "5" : p.meter === "2t" || p.meter === "4t" ? "4t" : "4";
  const sections = ({ 3: ["A", "B", "A2"], 4: ["A", "A2", "B", "A2"], 5: ["A", "A2", "B", "B2", "A2"] } as Record<number, string[]>)[p.passes]!;
  const modePcs = NIGHT_MODES[p.mode]!.map((x) => mod(x + p.tonic, 12));
  // Every span's chord, absolute: the bass's root, its tones' classes, its scale.
  // Each section its own colouring of the pass's progression: the seed swaps a middle chord for a neighbour in the
  // mode (one sharing two of its notes), so A2 is not A again and no two seeds' loops are the same four chords.
  const Rh = stream(`${p.seed}|nightsong|harmony`);
  const modeSet = new Set(modePcs.map((x) => mod(x - p.tonic, 12)));
  const pool: NightChord[] = [];
  for (const r of NIGHT_MODES[p.mode]!) for (const q of ["m", "M", "m7", "M7", "hdim", "m6"]) if (Q[q]!.every((x) => modeSet.has(mod(r + x, 12))) && !(p.mode === "harmonic" && ![7, 11].includes(r) && Q[q]!.some((x) => mod(r + x, 12) === 11))) pool.push([r, q]);
  const subIn = (prog: Prog, n: number): NightChord[] => {
    const out: NightChord[] = prog.map((x) => [x[0], x[1]]);
    const slots = Rh.chance(0.5) ? [1, 2] : [2, 1];
    for (const k of slots.slice(0, n)) {
      const [r0, q0] = out[k]!, tones = new Set(Q[q0]!.map((x) => mod(r0 + x, 12)));
      const before = out[k - 1]!, after = out[k + 1]!;
      const opts = pool.filter(([r, q]) => !(r === r0 && q === q0) && Q[q]!.filter((x) => tones.has(mod(r + x, 12))).length >= 2 && !(r === before[0] && q === before[1]) && !(r === after[0] && q === after[1]));
      if (opts.length) out[k] = Rh.pick(opts);
    }
    return out;
  };
  const progs: Record<string, NightChord[]> = { A: subIn(p.progA, Rh.chance(0.5) ? 1 : 0), B: subIn(p.progB, Rh.chance(0.5) ? 1 : 0) };
  progs.A2 = subIn(progs.A!, 1); progs.B2 = subIn(progs.B!, 1);
  for (const [a, b] of [["A", "A2"], ["B", "B2"]] as const) if (JSON.stringify(progs[a]) === JSON.stringify(progs[b])) progs[b] = subIn(progs[a]!, 2);
  // (Three roots a pass at least: a vamp gets a new chord in its middle.)
  for (const k of Object.keys(progs)) {
    const pr = progs[k]!;
    for (const slot of [2, 1]) {
      if (new Set(pr.map(([r]) => r)).size >= 3) break;
      const opts = pool.filter(([r]) => !pr.some(([r2]) => r2 === r));
      if (opts.length) pr[slot] = Rh.pick(opts);
    }
  }
  const chords: SpanChord[] = [];
  for (let s = 0; s < spans; s += 1) {
    const pass = Math.floor(s / 4), sec = sections[pass]!, prog = progs[sec]!;
    const [root, q] = prog[s % 4]!;
    const pcs = Q[q]!.map((x) => mod(p.tonic + root + x, 12));
    chords.push({ s, pass, sec, at: s * span, root: mod(p.tonic + root, 12), q, iv: Q[q]!, pcs, scale: scaleFor(modePcs, pcs) });
  }
  const chord = (s: number): SpanChord => chords[s]!;
  const T: Record<string, NightTrack> = {};
  const track = (id: string, voice: string, o: TrackOpts = {}): NightTrack => (T[id] ??= { id, voice, notes: [], ...o });
  const notesOf = (id: string): NightNote[] => T[id]!.notes;
  const add = (id: string, beat: number, beats: number, pitch: number, vel = 0.8): void => { if (beats <= 0) return; notesOf(id).push({ beat: r4(mod(beat, total)), beats: r4(beats), pitch, vel: r4(vel) }); };
  const on = (layer: string, c: SpanChord): boolean => c.pass >= (p.enter[layer] ?? 0);
  const last = (c: SpanChord): boolean => c.s === spans - 1;
  const leadVoice = p.lead;
  const LG = ({ musicbox: 0.6, celesta: 0.54, kalimba: 0.56, twang: 1, pulse: 0.2, theremin: 0.3, epiano: 0.62 } as Record<string, number>)[leadVoice]!;
  // (Lo-fi: the twang palm-muted, the music box and celesta softened, the electric piano warm.)
  const leadSound = leadVoice === "twang" ? "mutetwang" : leadVoice;
  track("lead", leadSound, { gain: LG, pan: -0.08, lowpass: leadVoice === "theremin" ? undefined : leadVoice === "twang" ? 4200 : 7000, reverb: leadVoice === "theremin" ? 0.7 : 0.35, release: 0.09, ...(leadVoice === "twang" ? { slap: 0.11, highpass: 120 } : {}), ...(leadVoice === "pulse" ? { duty: 0.25 } : {}) });
  const [lo, hi] = LEAD_RANGE[leadVoice]!;
  const home = place(mod(p.tonic + [0, NIGHT_MODES[p.mode]![2]!, 7][p.motif.start % 3]!, 12), lo + 3 + (p.motif.start % 5));
  const Rv = stream(`${p.seed}|nightsong|notes`); // (the hand's small variations, after every choice is made)

  // ---- the lead
  const leadNotes: LeadNote[] = [];
  const L = (s: number, beat: number, beats: number, pitch: number, vel: number): void => { leadNotes.push({ s, beat, beats, pitch: fold(pitch, lo, hi), vel }); };
  const step = M.sub, nSteps = Math.round(span / step);
  if (p.style === "riff") {
    const groups = (GROUPS[nSteps] ?? [[nSteps]])[p.riffGroup] ?? GROUPS[nSteps]![0]!;
    let lineIdx = 0;
    for (const c of chords) {
      // The pedal: the key's fifth (or its tonic) high; where it rubs a semitone against the chord, the nearest chord tone.
      let ped = place(mod(p.tonic + p.pedalDeg, 12), hi - 11);
      if (c.pcs.some((x) => mod(x - ped, 12) === 1 || mod(ped - x, 12) === 1)) ped = nearestIn(c.pcs, ped);
      if (c.sec.startsWith("B")) ped = fold(nearestIn(c.pcs, ped + 4), lo + 7, hi);
      // The line below it: chord tones in the octave under the pedal, walked as the seed walks them.
      const under: number[] = []; for (let q = ped - 12; q < ped; q += 1) if (c.pcs.includes(mod(q, 12))) under.push(q);
      const walk = p.riffLine === "fall" ? [...under].reverse() : p.riffLine === "climb" ? under : [under.at(-1)!, under.at(-2) ?? under.at(-1)!, under.at(-1)!, under.at(-3) ?? under[0]!];
      let k = 0;
      for (const g of groups) {
        for (let j = 0; j < g; j += 1) {
          const pitch = j === 0 ? ped : walk[(lineIdx + j - 1) % walk.length]!;
          L(c.s, c.at + k * step, step * 0.9, pitch, j === 0 ? 0.95 : 0.72);
          k += 1;
        }
        lineIdx += 1;
      }
    }
  } else if (p.style === "arp") {
    const shape = ARPS[p.motif.arp % ARPS.length]!;
    for (const c of chords) {
      const base = fold(place(c.root, lo), lo, hi - 12);
      const tones = [...c.iv.map((x) => base + x).slice(0, 3), base + 12].map((x) => fold(x, lo, hi));
      const up = c.sec.startsWith("B") ? 12 : 0;
      for (let k = 0; k < nSteps; k += 1) L(c.s, c.at + k * step, step * 0.9, fold(tones[shape[k % shape.length]!]! + up, lo, hi), k % (triplet ? 3 : 4) === 0 ? 0.92 : 0.7);
    }
  } else if (p.style === "motif") {
    // A question (cell a), its answer (cell b), the question again on the third chord, and a cadence; B turns the contour over.
    const cells = CELLS[spanKind]!;
    // (The seed's hand on its cells: as written, the longest note split in two, or the first two tied.)
    const vary = (cell: Cell, v: number): Cell => {
      if (v === 1 && p.bpm >= 96) return cell; // (a quick feel's cells are not split)
      if (v === 1) { const i = cell.reduce((m, x, j) => (x[1] > cell[m]![1] ? j : m), 0), [o, l] = cell[i]!; return l < 1 ? cell : [...cell.slice(0, i), [o, l / 2], [o + l / 2, l / 2], ...cell.slice(i + 1)]; }
      if (v === 2 && cell.length > 3) return [[cell[0]![0], cell[0]![1] + cell[1]![1]], ...cell.slice(2)];
      return cell;
    };
    const most = Math.max(3, Math.floor((p.bpm >= 100 ? 0.9 : 1.1) * span * 60 / p.bpm) + 1);
    const fits = cells.filter((x) => x.length <= most), use = fits.length >= 3 ? fits : [...cells].sort((a, b) => a.length - b.length).slice(0, 3);
    const ca = vary(use[p.motif.cells[0]! % use.length]!, p.groove.vary % 3), cb = vary(use[p.motif.cells[1]! % use.length]!, Math.floor(p.groove.vary / 3) % 3);
    const ca2 = vary(use[p.motif.cells[0]! % use.length]!, (p.groove.vary + 1) % 3);
    const cads = CADENCE[spanKind]!, cad = cads[p.motif.cad % cads.length]!;
    // (Each section sits in its own register: A at home, A2 a step up, B over it.)
    const LIFT: Record<string, number> = { A: 0, A2: 2, B: 1, B2: 3 };
    const tryWith = (ka: readonly number[], kb: readonly number[]): LeadNote[] => {
      const out: LeadNote[] = [];
      const put = (s: number, beat: number, beats: number, pitch: number, vel: number): void => { out.push({ s, beat, beats, pitch: fold(pitch, lo, hi), vel }); };
      let prev = home;
      for (const c of chords) {
        const k = c.s % 4, inv = c.sec.startsWith("B") ? -1 : 1;
        const cell = k === 3 ? cad : k === 1 ? cb : k === 2 ? ca2 : ca; // (the question asked again, a little differently)
        const cont = k === 1 ? kb : ka;
        // (The first note: the chord tone nearest where the tune is; a phrase starts near home.)
        const at = stepScale(c.scale, home, LIFT[c.sec] ?? 0);
        let q = nearestIn(c.pcs, k === 0 ? Math.round((prev + at) / 2) : prev);
        cell.forEach(([o, len], i) => {
          if (i > 0) q = stepScale(c.scale, q, (cont[i % cont.length]! - cont[(i - 1) % cont.length]!) * inv);
          if (o === 0 || Math.abs(o - Math.round(o)) < 1e-6 && Math.round(o) % 2 === 0) q = nearestIn(c.pcs, q); // (strong beats on the chord)
          else if (len >= 0.75 || Math.abs(o - Math.round(o)) < 1e-6) q = safe(c.pcs, q); // (held notes and the beats: no rub)
          q = fold(q, lo, hi);
          // (Never a third time on one pitch: the tune steps off it, onto a chord tone.)
          const tail = out.slice(-2);
          if (tail.length === 2 && tail.every((n) => n.pitch === q)) q = fold(nearestIn(c.pcs, stepScale(c.scale, q, inv * (i % 2 ? -1 : 1) * 2)), lo, hi);
          // The cadence lands home at the loop's end (the top is home again), a chord tone elsewhere.
          if (k === 3 && i === cell.length - 1) q = last(c) ? fold(nearestIn([mod(p.tonic, 12)], q), lo, hi) : fold(nearestIn(c.pcs, q), lo, hi);
          // (The answer's last note is held to the end of its span: a breath every two chords.)
          const held = k === 1 && i === cell.length - 1 && p.motif.hold ? span - o - 0.1 : len * 0.92;
          put(c.s, c.at + o, held, q, i === 0 ? 0.92 : 0.76);
        });
        prev = q;
      }
      return out;
    };
    // The tune judged a pass at a time: five pitches or more, a sixth of range, no long huddle inside a minor third.
    const fault = (ns: readonly LeadNote[]): number => {
      let bad = 0;
      for (let ps = 0; ps < p.passes; ps += 1) {
        const ps0 = ns.filter((n) => chord(n.s).pass === ps).map((n) => n.pitch);
        const range = Math.max(...ps0) - Math.min(...ps0);
        let run = 1, worst = 1;
        for (let i = 1; i < ps0.length; i += 1) { const w = ps0.slice(i - run, i + 1); run = Math.max(...w) - Math.min(...w) <= 3 ? run + 1 : 1; worst = Math.max(worst, run); }
        const top = Math.max(...[...new Set(ps0)].map((x) => ps0.filter((y) => y === x).length)) / ps0.length;
        bad += Math.max(0, Math.round((top - 0.25) * 20)) + Math.max(0, 5 - new Set(ps0).size) * 3 + Math.max(0, 8 - range) + Math.max(0, worst - 4) * 2;
      }
      return bad;
    };
    let best: LeadNote[] = [], bestBad = Infinity;
    for (let j = 0; j < 8 && bestBad > 0; j += 1) {
      const ns = tryWith(CONTOURS[(p.motif.contours[0]! + j) % CONTOURS.length]!, CONTOURS[(p.motif.contours[1]! + 3 * j) % CONTOURS.length]!);
      const b = fault(ns);
      if (b < bestBad) { best = ns; bestBad = b; }
    }
    leadNotes.push(...best);
  } else {
    // Long lines (the theremin's): a chord tone a span (two in a slow span), moving by the smallest step it can.
    let q = fold(place(mod(p.tonic + 7, 12), lo + 4), lo, hi);
    for (const c of chords) {
      const parts = span >= 5 ? 2 : 1;
      for (let j = 0; j < parts; j += 1) {
        const opts: number[] = []; for (let d = -4; d <= 4; d += 1) if (c.pcs.includes(mod(q + d, 12))) opts.push(q + d);
        q = fold(opts.sort((a, b) => Math.abs(a - q) - Math.abs(b - q) || a - b)[c.s % 3 === 2 && opts.length > 1 ? 1 : 0] ?? q, lo, hi);
        L(c.s, c.at + (j * span) / parts, (span / parts) - 0.25, q, 0.8);
      }
    }
  }
  // The loop's last beat walks into the top: the held note gives way to a pickup, by step, into the tune's first note.
  if (p.style === "motif" || p.style === "long") {
    const first = leadNotes.reduce((m, n) => (n.beat < m.beat ? n : m), leadNotes[0]!);
    const c = chord(spans - 1), end = total, sub2 = triplet ? 1 / 3 : 0.5, k = triplet ? 3 : 2;
    for (const n of leadNotes) if (n.s === spans - 1 && n.beat + n.beats > end - 1) n.beats = Math.max(0.25, end - 1 - n.beat - 0.05);
    const from = leadNotes.filter((n) => n.s === spans - 1).at(-1)?.pitch ?? first.pitch;
    const dir = from >= first.pitch ? 1 : -1;
    for (let j = 0; j < k; j += 1) L(spans - 1, end - 1 + j * sub2, j === k - 1 ? sub2 + 0.05 : sub2 * 0.9, stepScale(c.scale, first.pitch, dir * (k - j)), 0.72 + 0.08 * j);
  }
  for (const n of leadNotes) add("lead", n.beat, n.beats, n.pitch, n.vel * (chord(n.s).pass === 0 ? 0.9 : 1));
  // Its double an octave over it, as the soundtrack's is: the celesta over the music box, the music box over the twang.
  const double = ({ musicbox: "celesta", twang: "musicbox", celesta: "musicbox" } as Record<string, string>)[leadVoice];
  if (double) {
    track("lead2", double, { gain: double === "celesta" ? 0.12 : 0.18, pan: 0.14, reverb: 0.4, release: 0.1, lowpass: 6000 });
    for (const n of leadNotes) if (leadVoice === "twang" || on("lead2", chord(n.s))) add("lead2", n.beat, n.beats, fold(n.pitch + 12, 72, 88), n.vel * 0.8);
  }

  // ---- the pad and the drone
  if (p.pad) {
    const PV = ({
      saw: ["saw-pad", { gain: 0.18, reverb: 0.55, attack: 0.9, release: 1.6, cutoff: 3, lowpass: 3400, highpass: 220, pump: p.lofi.pump }],
      organ: ["organ", { gain: 0.08, lowpass: 2200, highpass: 200, reverb: 0.5, release: 0.4, pump: p.lofi.pump * 0.8 }],
      choir: ["choir", { gain: 0.26, reverb: 0.8, attack: 0.9, release: 2, pump: p.lofi.pump * 0.6 }],
      rhodes: ["epiano", { gain: 0.36, lowpass: 7500, highpass: 140, reverb: 0.35, release: 0.35, pump: p.lofi.pump }],
    } as Record<string, [string, TrackOpts]>)[p.pad]!;
    track("pad", PV[0], PV[1]);
    let prevV: number[] | null = null;
    for (const c of chords) {
      if (!on("pad", c) || (c.pass === 0 && c.s < 2)) continue; // (the chord bed a span or two in: the top builds)
      // (Voiced near the last chord, B2 to G4: each voice moving as little as it can.)
      const target: number = prevV ? prevV.reduce((a, b) => a + b, 0) / prevV.length : 57;
      // (Jazzy: the chord's seventh and ninth from its scale, the root left to the bass when there are four others.)
      const inScale = (x: number): boolean => c.scale.includes(mod(c.root + x, 12));
      const ext = [...c.iv];
      // (No colour that rubs a semitone against a note the tune holds over the chord.)
      const held = leadNotes.filter((n) => n.s === c.s && n.beats >= 0.75).map((n) => mod(n.pitch, 12));
      const clear = (x: number): boolean => !held.some((h) => [1, 11].includes(mod(h - (c.root + x), 12)));
      if (!ext.some((x) => x >= 9)) { const sev = [10, 11].find((x) => inScale(x) && clear(x)); if (sev !== undefined) ext.push(sev); }
      if (inScale(2) && !ext.some((x) => x === 1) && clear(2)) ext.push(14);
      const tones = ext.length >= 5 ? ext.filter((x) => x !== 0) : ext;
      let v = [...new Set(tones.map((x) => { let m = place(mod(c.root + x, 12), 47); while (m < target - 6) m += 12; while (m > target + 6) m -= 12; return fold(m, 52, 72); }))].sort((a, b) => a - b);
      // (No two voices a semitone apart -- a major seventh's seventh goes over its root, not under it -- and nothing that rubs below C4.)
      for (let k = 0; k + 1 < v.length; k += 1) if (v[k + 1]! - v[k]! === 1 || (v[k + 1]! - v[k]! === 2 && v[k]! < 60)) { v[k] = v[k]! + 12; v = [...new Set(v)].sort((a, b) => a - b); k = -1; }
      prevV = v;
      if (p.pad === "rhodes") {
        // (The electric piano comps: the chord on the one, and again, softer, pushed ahead of the middle.)
        for (const m of v) add("pad", c.at, span >= 4 ? span / 2 : span, m, 0.72);
        if (span >= 4) for (const m of v) add("pad", c.at + span / 2 - M.sub, span / 2 + M.sub, m, 0.5);
      } else for (const m of v) add("pad", c.at, span, m, 0.7);
    }
  }
  if (p.drone) {
    track("drone", "drone", { gain: 0.17, reverb: 0.25, attack: 3, release: 4 });
    for (let s = 0; s < spans; s += 2) add("drone", chord(s).at, span * 2, place(p.tonic, 47) - 12, 0.8); // (an octave up: a bed, not a rumble)
  }

  // ---- the bass: the synth driven over a sub, an octave apart
  track("bass", p.bass === "walk" ? "upright" : "synth", { gain: p.bass === "walk" ? 0.4 : 0.26, drive: 1.2, highpass: 45, lowpass: 900, release: 0.1 });
  track("sub", "sub", { gain: 0.17, release: 0.12 });
  const B = (beat: number, beats: number, pitch: number, vel = 0.9): void => { add("bass", beat, beats, pitch, vel); add("sub", beat, beats, pitch - 12, vel); };
  for (const c of chords) {
    if (!on("bass", c)) continue;
    // (The first pass is the intro: the bass only holds the root under it, softly, as the soundtrack's opens bare.)
    if (c.s < 2) { B(c.at, span * 0.95, place(c.root, 35), p.drone ? 0.4 : 0.7); continue; }
    const root = place(c.root, 35), fifth = root + (c.iv.includes(7) ? 7 : c.iv.includes(6) ? 6 : 7), third = root + c.iv[1]!;
    const next = chord((c.s + 1) % spans), toNext = place(next.root, 35);
    // (The last span plays the double time and holds its last note into the top.)
    if (last(c) && NIGHT_FEELS[p.feel]!.energy >= 0.6) {
      for (let b = 0; b < p.hr; b += 1) for (const o of M.fastBass) { const lastOne = o === M.fastBass.at(-1); B(c.at + b * bar + o, lastOne && b === p.hr - 1 ? bar - o + 0.05 : 0.4, root + (lastOne ? 12 : 0), 0.65); }
      B(c.at, 0.9, root);
      continue;
    }
    if (p.bass === "pedal") { B(c.at, span * 0.95, root); if (span >= 4) B(c.at + span / 2, span * 0.45, root, 0.6); }
    else if (p.bass === "pulse") for (let b = 0; b < p.hr; b += 1) {
      // (The soundtrack's figure, or the seed's: the root held with its fifth, or the root and its octave answering.)
      // (Or a lazy one: the root, its fifth pushed ahead of the middle, the octave late; or the root twice and a step up into the next.)
      const fig: readonly Pt[] = [M.bass, [[0, bar - 1.1], [bar - 1, 0.9]] as const, [[0, 1.4], [Math.floor(bar / 2), 1.4]] as const,
        [[0, 1.2], [Math.floor(bar / 2) - 0.5, 0.9], [bar - 0.5, 0.45]] as const, [[0, 0.9], [1, 0.9], [bar - 1, 0.9]] as const][bar < 4 && p.groove.bassFig === 4 ? 0 : p.groove.bassFig]!;
      const fig4 = bar >= 4 && p.groove.bassFig === 4;
      const note = (i: number): number => p.groove.bassFig === 1 && i === 1 ? fifth : p.groove.bassFig === 2 && i === 1 ? root + 12 : p.groove.bassFig === 3 ? [root, fifth, root + 12][i]! : fig4 && i === 2 ? (b === p.hr - 1 ? stepScale(c.scale, toNext, -1) : third) : root;
      fig.forEach(([o, d], i) => B(c.at + b * bar + o, d, note(i), i ? 0.75 : 0.9));
    }
    else if (p.bass === "walk") {
      // A beat a note: the root, chord tones, and a step into the next chord's root.
      const mids = [Rv.pick([third, fifth]), Rv.pick([fifth, root + 12]), third + 12 > root + 12 ? fifth : third, fifth];
      for (let k = 0; k < span; k += 1) {
        const m = k === 0 ? root : k === span - 1 ? stepScale(c.scale, toNext, Rv.pick([-1, 1])) : mids[(k - 1) % mids.length]!;
        B(c.at + k, k === span - 1 ? 0.4 : 0.9, m === root && k > 0 ? fifth : m, k === 0 ? 0.9 : 0.75);
      }
    } else if (p.bass === "ostinato") for (let b = 0; b < p.hr; b += 1) {
      const pat: readonly (readonly [number, number, number])[] = bar === 5 ? [[0, root, 1.4], [1.5, fifth, 1.4], [3, root + 12, 0.9], [4, fifth, 0.9]] : [[0, root, 1.4], [1.5, fifth, 1.4], [3, root + 12, 0.9]];
      for (const [o, m, d] of pat) B(c.at + b * bar + o, d, m, o === 0 ? 0.9 : 0.75);
    } else for (let b = 0; b < span; b += 1) { B(c.at + b, 0.6, b % 2 && b > 0 ? fifth : root, 0.85); B(c.at + b + 2 / 3, 0.3, root, 0.6); } // the gallop
  }

  // ---- the kit
  // (The seed's shaker: every one, every other, or none -- the brushed kit keeps its brushes.)
  const shake = (k: number): boolean => p.groove.shake === "all" || (p.groove.shake === "off" && Math.floor(k / 2) % 2 === 1);
  const kitOn = (c: SpanChord): boolean => p.kit !== "none" && c.pass >= p.enter.kit! && c.s >= 1; // (the kick from the second span)
  if (p.kit !== "none") {
    // (Dusty: soft kicks with their click rolled off, brushed snares, rims through a blanket.)
    track("kick", "kick", { gain: 0.74, lowpass: 1800 });
    track("hat", "hat", { gain: 0.26, pan: 0.2, highpass: 3000, lowpass: 9000 });
    track("open", "open", { gain: 0.13, pan: -0.2, highpass: 3000, lowpass: 7000 });
    track("snare", "snare", { gain: 0.46, reverb: 0.25, lowpass: 6000 });
    track("clap", "clap", { gain: 0.2, reverb: 0.3, lowpass: 4000 });
    track("rim", "rim", { gain: 0.33, pan: -0.12, reverb: 0.2, lowpass: 5500 });
    track("shaker", "shaker", { gain: 0.24, pan: 0.18, lowpass: 9000 });
  }
  // (Halftime from 85 BPM: one backbeat a bar, in its middle.)
  const back: readonly number[] = p.bpm >= 85 && M.back.length > 1 ? [M.beats === 3 ? 2 : M.beats / 2] : M.back;
  for (const c of chords) {
    if (!kitOn(c)) continue;
    for (let b = 0; b < p.hr; b += 1) {
      const b0 = c.at + b * bar, turn = last(c) && b === p.hr - 1, full = c.pass >= 1;
      if (turn) {
        // (The soundtrack's double time into the top; the slowest feels walk in on a soft fill, so the top isn't a drop.)
        const slow = true; // (lo-fi: the top walks in on a soft fill, never the double time)
        if (!slow) for (const o of M.fastKick) add("kick", b0 + o, 0.3, 36, o === 0 ? 0.8 : 0.65);
        else add("kick", b0, 0.3, 36, 0.75);
        for (const o of slow ? back : M.fastSnare) add(slow ? "rim" : "snare", b0 + o, 0.3, 60, 0.6);
        const acc = slow ? "rim" : p.groove.accent;
        if (acc === "clap") add("clap", b0 + M.clap, 0.3, 60, 0.62);
        else if (acc === "open") add("open", b0 + bar - M.sub * 2, 0.3, 60, 0.6);
        else if (acc === "rim") for (let k = 0; k < 3; k += 1) add("rim", b0 + bar - M.sub * (3 - k), 0.1, 60, 0.5 + 0.08 * k);
        else if (acc === "roll") for (let k = 0; k < 4; k += 1) add("snare", b0 + bar - (M.sub / 2) * (4 - k), 0.1, 60, 0.3 + 0.1 * k);
        add("rim", b0 + bar - M.sub, 0.1, 60, slow ? 0.45 : 0.6); // (a last tap, the pickup into the top)
        add("kick", b0 + bar - (triplet ? 1 / 3 : 0.5), 0.3, 36, 0.5);
        continue;
      }
      // A fill to close a pass (this seed's), on its last beat: one fill a loop, into the last pass.
      const passEnd = c.s % 4 === 3 && b === p.hr - 1;
      if (passEnd && p.groove.fill && c.pass === p.passes - 2) {
        const fb = b0 + bar - 1;
        const fills = ({ 1: [[0, "rim", 0.4], [0.5, "rim", 0.5], [0.75, "rim", 0.6]], 2: [[0, "rim", 0.5], [1 / 3, "rim", 0.6], [2 / 3, "rim", 0.7]], 3: [[0, "kick", 0.7], [0.5, "snare", 0.6], [M.sub === 0.5 ? 0.75 : 2 / 3, "snare", 0.7]] } as Record<number, [number, string, number][]>)[p.groove.fill]!;
        for (const [o, d, v] of fills) add(d, fb + (triplet && p.groove.fill === 1 ? o * 4 / 3 : o), 0.1, d === "kick" ? 36 : 60, v);
      }
      const subs = Math.round(bar / M.sub);
      // Ghosts between the backbeats, once the kit is settled in.
      if (p.groove.ghosts && full && c.pass >= 2) for (let k = 1; k < subs; k += 2) if ((k * 7 + c.s) % 5 === 0) add(p.kit === "house" || p.kit === "march" ? "snare" : "rim", b0 + k * M.sub, 0.1, 60, 0.18);
      if (p.kit === "house") {
        // (The soundtrack's kit, kept low: the kick's figure, a hat on the beat, a snare on the backbeat.)
        for (const o of M.kick) if (!(o > 0 && o < 1) || c.sec.startsWith("B")) add("kick", b0 + o, 0.3, 36, o > 0 && o < 1 ? 0.55 : 0.85);
        if (full) for (let k = 0; k < bar; k += 1) add("hat", b0 + k, 0.1, 60, k === 0 ? 0.6 : 0.4);
        if (full && c.sec.startsWith("B")) for (const o of M.open) add("open", b0 + o, 0.3, 60, 0.5); // (the open hats the B's only)
        for (const o of M.snare) add("snare", b0 + o, 0.3, 60, 0.7);
      }
      // (The dusty hat: soft on the beat and softer off it, swung with the band, once the kit has settled.)
      const hats = full && (p.kit === "tiptoe" || p.kit === "heart");
      if (hats) for (let k = 0; k < bar; k += 1) add("hat", b0 + k + (triplet ? 2 / 3 : 0.5), 0.1, 60, k % 2 ? 0.3 : 0.24);
      if (p.kit === "tiptoe") {
        if (b === 0 || p.groove.kick2 === 2) add("kick", b0, 0.3, 36, b === 0 ? 0.7 : 0.55);
        for (const o of back) add(full || c.s >= 2 ? "snare" : "rim", b0 + o, 0.1, 60, full || c.s >= 2 ? 0.5 : 0.8);
        if (!hats) for (let k = 1; k < subs; k += 2) if (shake(k)) add("shaker", b0 + k * M.sub, 0.1, 60, 0.5);
      } else if (p.kit === "heart") {
        add("kick", b0, 0.3, 36, 0.85); add("kick", b0 + [M.sub === 0.5 ? 0.5 : 2 / 3, M.sub === 0.5 ? 1.5 : 4 / 3, bar - 1][p.groove.kick2]!, 0.3, 36, 0.55);
        for (const o of back) add(full || c.s >= 2 ? "snare" : "rim", b0 + o, 0.1, 60, full || c.s >= 2 ? 0.5 : 0.6);
        if (full && !hats) for (let k = 0; k < bar; k += 1) if (shake(k * 2 + 1)) add("shaker", b0 + k + M.sub, 0.1, 60, 0.4);
      } else if (p.kit === "brushed") {
        const on3 = M.sub === 0.5 ? 2 : 3;
        for (let k = 0; k < subs; k += 1) if (k % on3 === 0 || p.groove.shake !== "none") add("shaker", b0 + k * M.sub, 0.1, 60, k % on3 === 0 ? 0.6 : 0.35);
        add("kick", b0, 0.3, 36, 0.75); if (bar >= 4 && p.groove.kick2 !== 1) add("kick", b0 + [M.kick.at(-1)!, 0, bar - 1][p.groove.kick2]!, 0.3, 36, 0.55);
        const brush = (full && c.pass % 2 === 1) || (c.pass === 0 && c.s >= 2); // (the snare's backbeat by the third span, then every other pass)
        for (const o of back) add(brush ? "snare" : "rim", b0 + o, 0.2, 60, brush ? 0.45 : 0.6);
      } else if (p.kit === "march") {
        for (let k = 0; k < bar; k += 1) add("kick", b0 + k, 0.3, 36, k === 0 ? 0.85 : 0.5);
        add("snare", b0 + bar - 1, 0.2, 60, 0.6); if (full) add("snare", b0 + bar - 1 - M.sub, 0.1, 60, 0.3);
        if (full) for (let k = 0; k < bar; k += 1) add("hat", b0 + k + M.sub * (triplet ? 2 : 1), 0.1, 60, 0.45);
      }
    }
  }

  // (At most a hundred and ten shakers and hats a loop, thinned evenly.)
  // (And the shaker under thirty a loop: brushes, not a rattle.)
  if (T.shaker && T.shaker.notes.length > 30) { const keep = T.shaker.notes.length / 30; const ns = T.shaker.notes; T.shaker.notes = Array.from({ length: 30 }, (_, i) => ns[Math.floor(i * keep)]!); }
  for (const id of ["shaker", "hat"]) {
    const t = T[id];
    if (!t) continue;
    let ns = t.notes;
    const cap = Math.min(110, Math.round(total * 1.7)), keep = Math.ceil(ns.length / cap);
    if (keep > 1) ns = ns.filter((_, i) => i % keep === 0);
    t.notes = ns;
  }
  {
    const body = (n: NightNote): boolean => n.beat < (spans - 1) * span;
    const thin = (id: string, cap: number): void => {
      const t = T[id];
      if (!t) return;
      const inBody = t.notes.filter(body);
      if (inBody.length <= cap) return;
      const ranked = [...inBody].sort((a, b) => (Math.abs(a.beat % bar) < 1e-6 ? 0 : 1) - (Math.abs(b.beat % bar) < 1e-6 ? 0 : 1) || a.beat - b.beat);
      const keep = new Set(ranked.filter((n) => Math.abs(n.beat % bar) < 1e-6).slice(0, cap));
      for (const n of ranked) if (keep.size < cap) keep.add(n);
      if (keep.size > cap) { const stp = keep.size / cap; const arr = [...keep].sort((a, b) => a.beat - b.beat); keep.clear(); for (let i = 0; i < cap; i += 1) keep.add(arr[Math.floor(i * stp)]!); }
      t.notes = t.notes.filter((n) => !body(n) || keep.has(n));
    };
    thin("kick", 20);
    thin("snare", p.meter === "3" ? 16 : 12);
  }
  // (One hit a step per drum; at most five hits a bar across the kit outside the last span, the small ones thinned first.)
  const KIT_IDS = ["kick", "snare", "rim", "shaker", "hat", "open", "clap"];
  for (const id of KIT_IDS) { const t = T[id]; if (t) { const seen = new Set<string>(); t.notes = t.notes.filter((n) => { const k = n.beat.toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; }); } }
  {
    const bars = total / bar, cap = Math.round(5 * bars), body = (n: NightNote): boolean => n.beat < (spans - 1) * span;
    for (const id of ["shaker", "hat", "rim"]) {
      const count = (): number => KIT_IDS.reduce((a, k) => a + (T[k]?.notes.filter(body).length ?? 0), 0);
      const t = T[id];
      if (!t || count() <= cap) continue;
      const over = count() - cap, mine = t.notes.filter(body).length, keepFrac = Math.max(0, 1 - over / Math.max(1, mine));
      let acc = 0;
      t.notes = t.notes.filter((n) => { if (!body(n)) return true; acc += keepFrac; if (acc >= 1) { acc -= 1; return true; } return false; });
    }
  }
  // The drummer's hand: off-beat shakers and hats thinned by the seed, every hit's weight nudged.
  const Rk = stream(`${p.seed}|nightsong|kit`);
  // (This seed's kit: a kick every bar or every other one outside the B, its rims a step late; the turn as written.)
  const lastAt = (spans - 1) * span;
  if (T.kick && p.groove.kickEvery === 2) T.kick.notes = T.kick.notes.filter((n) => n.beat >= lastAt || chord(Math.floor(n.beat / span)).sec.startsWith("B") || Math.floor(n.beat / bar) % 2 === 0);
  if (T.rim && p.groove.rimShift) T.rim.notes = T.rim.notes.map((n) => (n.beat >= lastAt ? n : { ...n, beat: r4(mod(n.beat + M.sub, total)) }));
  // (The last pass builds: the band a little harder into the turn, as the soundtrack's does.)
  for (const id of ["kick", "snare", "rim", "bass", "sub", "pad", "drone"]) { const t = T[id]; if (t) for (const n of t.notes) if (Math.floor(n.beat / span) >= (p.passes - 1) * 4) n.vel = r4(Math.min(1, n.vel * 1.05)); }
  for (const id of ["shaker", "hat", "rim", "kick", "snare"]) { const t = T[id]; if (t) t.notes = t.notes.filter((n) => !["shaker", "hat"].includes(id) || Math.abs(n.beat - Math.round(n.beat)) < 1e-6 || Rk.f() >= p.groove.drop).map((n) => ({ ...n, vel: r4(Math.max(0.1, Math.min(1, n.vel * (0.92 + 0.16 * Rk.f())))) })); }

  // ---- the overlays
  const leadAt = (c: SpanChord): LeadNote[] => leadNotes.filter((n) => n.s === c.s);
  for (const o of p.overlays) {
    if (o === "choir") {
      // The house choir: the chord's root an octave up and its fifth over it, held through the span.
      track("choir", "choir", { gain: 0.26, reverb: 0.8, attack: 0.9, release: 2 });
      for (const c of chords) if (on(o, c)) { const r = place(c.root, 47); add("choir", c.at, span, r + 12, 0.75); add("choir", c.at, span, r + 12 + (c.iv.includes(7) ? 7 : c.iv.at(-1)!), 0.75); }
    } else if (o === "chip") {
      track("chip", "pulse", { gain: 0.13, lowpass: 3200, pan: 0.3, reverb: 0.2, duty: 0.25 });
      for (const n of leadNotes) if (on(o, chord(n.s))) add("chip", n.beat, n.beats * 0.9, fold(n.pitch - 12, 55, 76), 0.8);
    } else if (o === "bells") {
      track("bells", "glass", { gain: 0.11, lowpass: 5000, reverb: 0.6, pan: -0.3 });
      for (const c of chords) if (on(o, c) && c.sec.startsWith("B")) for (let b = 0; b < p.hr; b += 1) for (const [at, deg] of M.bells) {
        const iv = deg === 0 ? 0 : deg === 2 ? (c.iv.includes(7) ? 7 : c.iv.at(-1)!) : c.iv[1]!;
        add("bells", c.at + b * bar + at, 1, place(c.root, 47) + 24 + iv, 0.7);
      }
    } else if (o === "answer") {
      track("answer", leadVoice === "musicbox" ? "celesta" : "musicbox", { gain: 0.2, lowpass: 4200, pan: 0.3, reverb: 0.5, release: 0.1 });
      // Over the cadence's held note, the question's first three notes again, an octave up, quieter.
      for (const c of chords) if (on(o, c) && c.s % 4 === 3) { const ns = leadAt(chord(c.s - 3)).slice(0, 3); ns.forEach((n, i) => { const at = c.at + span / 2 + i * M.sub * 2, h = chord(Math.floor(at / span) % spans); add("answer", at, M.sub * 1.8, fold(nearestIn(h.pcs, n.pitch + 12), 70, 86), 0.6); }); }
    } else if (o === "line") {
      track("line", "theremin", { gain: 0.22, reverb: 0.7 });
      let q = place(mod(p.tonic + 3, 12), 68);
      for (const c of chords) if (on(o, c)) { q = nearestIn(c.pcs, q); add("line", c.at, span - 0.5, fold(q, 66, 80), 0.8); }
    } else if (o === "tremolo") {
      // The twang picked fast on one chord tone, swelling through the span (a bouzouki's tremolo):
      // in eighths, low and soft, through the first B's second half -- a shimmer, not a wall.
      track("tremolo", "mutetwang", { gain: 0.1, pan: 0.32, reverb: 0.45, release: 0.05, highpass: 200, lowpass: 3000 });
      const st = triplet ? 1 / 3 : 0.5;
      let q = place(mod(p.tonic + 7, 12), 62);
      for (const c of chords) {
        if (!on(o, c) || c.sec !== "B" || c.s % 4 < 2) continue;
        q = fold(nearestIn(c.pcs, q), 58, 70);
        const n = Math.round(span / st);
        for (let k = 0; k < n; k += 1) add("tremolo", c.at + k * st, st * 0.95, q, 0.35 + 0.4 * Math.sin((Math.PI * k) / n));
      }
    } else if (o === "harp") {
      // A plucked line under the tune: the chord broken low in the feel's own grid.
      track("harp", "harp", { gain: 0.15, lowpass: 3500, pan: -0.28, reverb: 0.3, release: 0.08 });
      const shape = [0, 2, 1, 2, 3, 2, 1, 2];
      for (const c of chords) {
        if (!on(o, c) || !c.sec.startsWith("B")) continue;
        const r = place(c.root, 48), tones = [...c.iv.slice(0, 3), 12];
        const st = triplet ? 2 / 3 : 0.5;
        for (let k = 0; k < Math.round(span / st); k += 1) add("harp", c.at + k * st, st * 0.85, r + tones[shape[k % 8]! % tones.length]!, k % 2 ? 0.55 : 0.75);
      }
    } else if (o === "surf") {
      // On each chord change a low string struck and let ring, sharp and falling into tune, its slap-back behind it.
      track("surf", "twang", { gain: 0.24, pan: 0.15, reverb: 0.5, release: 0.3, slap: 0.16, highpass: 80 });
      for (const c of chords) if (on(o, c)) { const r = place(c.root, 45); add("surf", c.at, span * 0.5, r, 0.85); add("surf", c.at + span * 0.75, span * 0.2, r + 12, 0.55); }
    }
  }
  // The air outside, under it all.
  if (p.air) { track("air", p.air, { gain: 0.03, pan: 0, reverb: 0.2, attack: 2, release: 2 }); for (let s = 0; s < spans; s += 4) add("air", chord(s).at, span * 4, 60, 0.8); }

  // ---- the hand: the straight feels' off-beat eighths late (their sixteenths half as late), the kit lazy and loose,
  // the keys and the tune a little loose; held beds stay on the grid.
  const Rh2 = stream(`${p.seed}|nightsong|hand`);
  const HELD = new Set(["pad", "drone", "air", "choir", "line"]);
  const LAZY: Record<string, number> = { snare: 0.025, rim: 0.015, clap: 0.02, hat: 0.006, shaker: 0.006, open: 0.006 };
  const KIT_SET = new Set(KIT_IDS);
  for (const t of Object.values(T)) {
    if (HELD.has(t.id) && !(t.id === "pad" && p.pad === "rhodes")) continue;
    if (t.id === "pad") {
      // (The electric piano's chords: swung with the band, each note a hair after the one under it.)
      const at = new Map<number, number>();
      for (const n of t.notes) { const fr = mod(n.beat, 1); const sw = p.swing && Math.abs(fr - 0.5) < 1e-3 ? p.swing : 0; const k = at.get(n.beat) ?? 0; at.set(n.beat, k + 1); n.beat = r4(mod(n.beat + sw + 0.008 * k, total)); }
      continue;
    }
    for (const n of t.notes) {
      const fr = mod(n.beat, 1);
      let b = n.beat;
      if (p.swing) { if (Math.abs(fr - 0.5) < 1e-3) b += p.swing; else if (Math.abs(fr - 0.25) < 1e-3 || Math.abs(fr - 0.75) < 1e-3) b += p.swing / 2; }
      b += KIT_SET.has(t.id) ? (LAZY[t.id] ?? 0) + (Rh2.f() - 0.5) * 0.02 : (Rh2.f() - 0.5) * 0.012;
      n.beat = r4(mod(b, total));
    }
  }
  const tracks = Object.values(T).filter((t) => t.notes.length).map((t) => ({ ...t, notes: t.notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch) }));
  return {
    plan: p,
    song: { version: 1, bpm: p.bpm, seed: fnv(`${p.seed}|kit`) & 0xffff, root: place(p.tonic, 47), totalBeats: total, tailSeconds: 0, loop: true, shelf: { hz: 6000, cut: 0.5 }, focus: { ids: ["lead", "lead2"], share: 0.24, most: 0.4 }, reverb: { size: 0.86, damp: 0.3 }, design: { bright: 0.55 }, lofi: p.lofi, musicRms: 0.15, tracks, hits: [] },
    form: { bar, span, spans, sections, grid: triplet ? 1 / 6 : M.sub === 0.5 ? 0.25 : M.sub },
  };
}

// ---------------------------------------------------------------- the lo-fi room (chillhop)
// The normal rooms play lo-fi hip-hop: 74-90 BPM, a boom-bap kit with an MPC's sixteenth swing, jazzy seventh and
// ninth chords on a Rhodes or a Wurli, a round bass under the kick, and a tune passed between two voices -- in a
// song form round one seamless loop: a filtered intro, A, A' (varied), a bridge (a new progression, the drums
// dropping or filtered, a new motif), A back and its filter closing into the top. Never spooky: no harmonic minor,
// no phrygian; major or a dorian minor, cozy or wistful by the palette and the weather.

/** Rootless voicings over a chord's root (semitones): the colours the genre lives on. */
const CHILL_Q: Readonly<Record<string, readonly number[]>> = {
  maj9: [4, 7, 11, 14], maj7: [4, 7, 11, 12], m9: [3, 7, 10, 14], m11: [3, 7, 10, 17], m7: [3, 7, 10, 12], "13": [4, 10, 14, 21], "9": [4, 7, 10, 14],
};
type ChillProg = readonly (readonly [number, string])[];
const CHILL_PROGS: Readonly<Record<"major" | "minor", { readonly A: readonly ChillProg[]; readonly B: readonly ChillProg[] }>> = {
  major: {
    A: [
      [[2, "m9"], [7, "13"], [0, "maj9"], [9, "m9"]], // ii-V-I-vi
      [[0, "maj9"], [9, "m9"], [2, "m9"], [7, "13"]], // I-vi-ii-V
      [[5, "maj9"], [4, "m7"], [9, "m9"], [0, "maj9"]], // IV-iii-vi-I
      [[0, "maj9"], [5, "maj9"], [0, "maj7"], [5, "maj9"]], // I-IV
      [[5, "maj9"], [5, "m9"], [0, "maj9"], [9, "m9"]], // IV-iv (borrowed)-I-vi
      [[0, "maj9"], [4, "m7"], [5, "maj9"], [5, "m9"]], // I-iii-IV-iv
    ],
    B: [
      [[5, "maj9"], [4, "m7"], [2, "m9"], [7, "13"]],
      [[9, "m9"], [2, "m9"], [5, "maj9"], [7, "13"]],
      [[5, "maj9"], [5, "m9"], [4, "m7"], [9, "13"]],
      [[2, "m11"], [4, "m7"], [5, "maj9"], [7, "13"]],
    ],
  },
  minor: {
    A: [
      [[0, "m9"], [5, "9"], [0, "m11"], [5, "9"]], // dorian i-IV
      [[0, "m9"], [8, "maj9"], [3, "maj9"], [10, "13"]], // i-bVI-bIII-bVII
      [[5, "m9"], [10, "13"], [3, "maj9"], [8, "maj9"]], // iv-bVII-bIII-bVI (ii-V-I-IV of the relative major)
      [[0, "m11"], [5, "m9"], [10, "13"], [3, "maj9"]],
      [[0, "m9"], [3, "maj9"], [5, "m9"], [7, "m7"]], // i-bIII-iv-v (a minor v: wistful, not a threat)
    ],
    B: [
      [[8, "maj9"], [10, "13"], [3, "maj9"], [0, "m9"]],
      [[5, "m9"], [7, "m7"], [8, "maj9"], [10, "13"]],
      [[3, "maj9"], [8, "maj9"], [5, "m9"], [10, "13"]],
    ],
  },
};
/** Kick patterns (sixteenths of a bar): boom-bap's, the one always there. */
const CHILL_KICKS: readonly (readonly number[])[] = [[0, 10], [0, 7, 10], [0, 3, 10], [0, 6, 10], [0, 10, 11], [0, 9, 14]];
/** The keys' comping (sixteenth, length in sixteenths, velocity): negative starts push the chord ahead of its bar. */
const CHILL_COMPS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0, 8, 1], [10, 6, 0.75]], [[-2, 10, 1], [10, 6, 0.7]], [[0, 6, 1], [6, 4, 0.7], [12, 4, 0.65]], [[0, 16, 0.95]], [[0, 3, 1], [3, 3, 0.6], [10, 6, 0.8]], [[-2, 8, 1], [8, 2, 0.6], [11, 5, 0.75]],
];
/** The tune's rhythm cells (sixteenth, length) for one bar: syncopated, room to breathe. */
const CHILL_CELLS: readonly (readonly (readonly [number, number])[])[] = [
  [[2, 2], [4, 2], [6, 6]], [[0, 3], [3, 3], [6, 4], [12, 4]], [[4, 2], [6, 2], [8, 8]], [[6, 2], [8, 2], [10, 6]], [[0, 6], [8, 2], [10, 2], [12, 4]],
  [[3, 1], [4, 4], [10, 2], [12, 4]], [[2, 2], [4, 4], [10, 6]], [[0, 2], [2, 2], [4, 8], [14, 2]], [[8, 3], [11, 1], [12, 4]], [[0, 4], [6, 2], [8, 6]],
];
/** The voices that carry a tune (and how often): struck ones synthesis plays convincingly first; the twang rare and gentle. */
const CHILL_LEADS: Readonly<Record<string, number>> = { vibes2: 4, mutedgtr: 3, kalimba: 1.5 };
/** The answer's voices: never the keys' own family; the celesta only here, and rarely. */
const CHILL_ANSWERS: Readonly<Record<string, number>> = { vibes2: 3, mutedgtr: 3, kalimba: 2, flute: 0.25, celesta: 0.3, twang: 0.2 };
const CHILL_LEAD_OPTS: Readonly<Record<string, TrackOpts>> = {
  vibes2: { gain: 0.85, reverb: 0.35, release: 0.4, echo: 0.15, presence: 0.6 },
  mutedgtr: { gain: 1, reverb: 0.25, release: 0.06, highpass: 150, echo: 0.12 },
  rhodes: { gain: 0.5, reverb: 0.3, release: 0.3, highpass: 200, echo: 0.12, tremolo: { hz: 4.5, depth: 0.3 } },
  flute: { gain: 0.75, reverb: 0.4, attack: 0.03, release: 0.15, echo: 0.18 },
  celesta: { gain: 0.45, reverb: 0.4, release: 0.3, lowpass: 6000, echo: 0.15 },
  kalimba: { gain: 0.6, reverb: 0.3, release: 0.3, echo: 0.15 },
  twang: { gain: 0.4, reverb: 0.3, release: 0.2, lowpass: 3500, slap: 0.11 },
};

function chillSongOf(mood: NightMood, pins: NightPins = {}): { plan: NightPlan; song: NightSong; form: NightForm } {
  const seed = String(mood.seed ?? 0), S = stream(`${seed}|chill`), Sm = stream(`${seed}|chill|tune`), Sd = stream(`${seed}|chill|kit`), Sh = stream(`${seed}|chill|hand`);
  const view = mood.view ?? "Stars", dark = mood.dark ?? 0.72;
  const wet = ["Rain", "Snow", "Fog", "Sea"].includes(view);
  // The key's colour: the palette's scheme (bright schemes major, dark ones a dorian minor), else the seed, leaning
  // minor -- wistful -- on a wet or dark night, major -- cozy -- on a clear one.
  const brightScheme = mood.mode === "ionian" || mood.mode === "lydian" || mood.mode === "mixolydian";
  const darkScheme = mood.mode === "aeolian" || mood.mode === "phrygian" || mood.mode === "harmonic" || mood.mode === "dorian";
  const pMinor = brightScheme ? 0.25 : darkScheme ? 0.7 : wet || dark > 0.8 ? 0.6 : 0.4;
  const pinMode = pins.mode === "ionian" || pins.mode === "lydian" || pins.mode === "mixolydian" ? "major" : pins.mode ? "minor" : null;
  const colour: "major" | "minor" = pinMode ?? (S.chance(pMinor) ? "minor" : "major");
  const mode = colour === "major" ? "ionian" : "dorian";
  const keyPin = pins.key === undefined ? null : typeof pins.key === "number" ? mod(pins.key, 12) : NAMES.indexOf(String(pins.key));
  const tonic = keyPin !== null && keyPin >= 0 ? keyPin : Number.isFinite(mood.hue) ? (Math.round(mood.hue! / 30) + S.pick([0, 0, 5, 7])) % 12 : S.int(0, 11);
  // The tempo: the genre's, mostly 76-86; slower in the rain and the snow.
  const F = NIGHT_FEELS.lofi!, tempoPin = Number(pins.tempo);
  const bpm = F.bpms.includes(tempoPin) ? tempoPin : S.weigh(Object.fromEntries(F.bpms.map((b) => [String(b), (b >= 76 && b <= 86 ? 3 : 1) * (wet ? (b <= 82 ? 1.6 : 0.6) : 1)]))) as unknown as number;
  const BPM = Number(bpm);
  const sw = r4(0.55 + 0.07 * S.f()), swing = r4((sw - 0.5) * 0.5); // (the MPC's swing on the sixteenths: 55-62 %)
  const progA = S.pick(CHILL_PROGS[colour].A), progB = S.pick(CHILL_PROGS[colour].B);
  const keysVoice = pins.keys === "wurli" || pins.keys === "rhodes" ? pins.keys : S.weigh({ rhodes: 5, wurli: 2 });
  const leadW: Weights = { ...CHILL_LEADS };
  const lead = pins.lead && CHILL_LEADS[pins.lead] ? pins.lead : S.weigh(leadW);
  const answerW: Weights = { ...CHILL_ANSWERS, [lead]: 0 };
  const answer = S.weigh(answerW);
  const bass = pins.bass === "walk" || pins.bass === "pedal" ? pins.bass : S.weigh({ pedal: 3, walk: 1 });
  const kickPat = Sd.pick(CHILL_KICKS), kickAlt = Sd.pick(CHILL_KICKS), hats16 = Sd.chance(0.35), useRim = Sd.chance(0.3);
  const ghosts = true, fillKind = Sd.int(0, 2), openAt = Sd.pick([14, 6, 14, 10]);
  const comp = S.pick(CHILL_COMPS), compB = S.pick(CHILL_COMPS), passing = S.chance(0.5);
  const bridge = S.pick(["drop", "filter", "both"]), warm = S.chance(0.5);
  // The form: sixteen bars, a chord a bar. Bars 14-15 and 0-1 are one phrase of A round the join (A's first half, then
  // the intro's second half), so the loop's last bar leads into its first.
  const BARS = 16, total = BARS * 4;
  const sec = (b: number): string => (b < 2 ? "intro" : b < 6 ? "A" : b < 10 ? "A2" : b < 14 ? "B" : "outro");
  const chordAt = (b: number): readonly [number, string] => (sec(b) === "B" ? progB[b - 10]! : progA[mod(b - 2, 4)]!);
  const T: Record<string, NightTrack> = {};
  const track = (id: string, voice: string, o: TrackOpts): void => { T[id] = { id, voice, notes: [], ...o }; };
  const add = (id: string, beat: number, beats: number, pitch: number, vel: number): void => { T[id]!.notes.push({ beat: r4(mod(beat, total)), beats: r4(beats), pitch, vel: r4(Math.min(1, vel)) }); };
  const st = (bar: number, s16: number): number => bar * 4 + s16 / 4 + (mod(s16, 2) === 1 ? swing : 0);
  const hum = (b: number, a = 0.006): number => b + (Sh.f() - 0.5) * 2 * a;
  const lofi: NightLofi = {
    wow: r4(0.35 + 0.3 * S.f()), wowDepth: r4(1 + 0.8 * S.f()), flutter: r4(5.5 + 2 * S.f()), flutterDepth: r4(0.08 + 0.06 * S.f()),
    cutoff: Math.round(9500 + 1000 * S.f() - (wet ? 800 : 0)), bits: 12, hold: 24000, hiss: r4(0.3 + 0.15 * S.f()), crackle: r4(1 + 1.5 * S.f()),
    drive: r4(1.5 + 0.3 * S.f()), width: r4(0.5 + 0.15 * S.f()), pump: r4(0.35 + 0.15 * S.f()),
  };

  // ---- the kit
  track("kick", "dkick", { gain: 0.9, reverb: 0.02 });
  track("snare", "dsnare", { gain: useRim ? 0.6 : 0.78, pan: 0.02, reverb: 0.16 });
  track("rim", "drim", { gain: 0.7, pan: 0.05, reverb: 0.2 });
  track("hat", "dhat", { gain: 0.66, pan: 0.18, reverb: 0.04, pump: 0.2 });
  track("open", "dopen", { gain: 0.45, pan: 0.18, reverb: 0.08 });
  const dropKit = (b: number): boolean => sec(b) === "B" && b < 12; // (the bridge's first half without kick or snare)
  for (let b = 0; b < BARS; b += 1) {
    const s = sec(b), intro = s === "intro", phraseEnd = b === 5 || b === 9 || b === 13, alt = s === "A2" && b % 2 === 1;
    if (!dropKit(b)) for (const k of intro ? [0] : alt ? kickAlt : kickPat) add("kick", st(b, k), 0.5, 36, k === 0 ? 0.95 : 0.78);
    if (b === 15) add("kick", st(b, 14), 0.25, 36, 0.6); // (the pickup into the top)
    for (const k of [4, 12]) {
      const at = hum(st(b, k) + 0.025);
      if (intro || dropKit(b) || (b === BARS - 1 && k === 12)) add("rim", at, 0.5, 38, 0.7); // (the outro's last backbeat a rim, as the intro's are)
      else { add("snare", at, 0.5, 38, 0.85); if (useRim) add("rim", at + 0.004, 0.5, 38, 0.5); }
    }
    if (ghosts && !intro && !dropKit(b)) { add("snare", st(b, Sd.pick([7, 7, 9])), 0.25, 38, 0.14 + 0.06 * Sd.f()); if (b % 2 === 0 && !phraseEnd) add("snare", st(b, Sd.pick([13, 15])), 0.25, 38, 0.14 + 0.04 * Sd.f()); }
    for (let k = 0; k < 16; k += hats16 ? 1 : 2) {
      if (phraseEnd && k >= 14) continue;
      if (k === openAt && (b % 4 === 3) && s !== "intro") { add("open", hum(st(b, k)), 0.5, 46, 0.42); continue; }
      const on8 = k % 4 === 0 ? 0.62 : k % 2 === 0 ? 0.36 : 0.22;
      if (hats16 && k % 2 === 1 && Sd.chance(0.35)) continue;
      add("hat", hum(st(b, k), 0.004), 0.25, 42, on8 + Sd.f() * 0.08);
    }
    if (phraseEnd) {
      // (A fill closing each phrase: snare sixteenths rising, or kick and snare trading, or an open hat breath.)
      if (fillKind === 0) for (const [k, v] of [[13, 0.3], [14, 0.45], [15, 0.6]] as const) add("snare", st(b, k), 0.25, 38, v);
      else if (fillKind === 1) { add("kick", st(b, 13), 0.25, 36, 0.6); add("snare", st(b, 14), 0.25, 38, 0.5); add("snare", st(b, 15), 0.25, 38, 0.4); }
      else { add("snare", st(b, 14), 0.25, 38, 0.35); add("snare", st(b, 15), 0.25, 38, 0.5); }
      add("open", st(b, 14), 0.5, 46, 0.4); // (and the open hat's breath into the next phrase)
    }
  }

  // ---- the keys: rootless voicings, each chord moving as little as it can from the last, comped
  const keysOpts: TrackOpts = keysVoice === "rhodes"
    ? { gain: 0.3, pan: -0.1, reverb: 0.3, release: 0.12, highpass: 250, lowpass: 8000, presence: 0.8, pump: lofi.pump, tremolo: { hz: 4.5, depth: 0.25 } }
    : { gain: 0.32, pan: -0.1, reverb: 0.28, release: 0.12, highpass: 230, lowpass: 7500, presence: 0.8, pump: lofi.pump, tremolo: { hz: 5.5, depth: 0.15 } };
  track("pad", keysVoice, keysOpts);
  const voicings: number[][] = [];
  let center = 57;
  for (let b = 0; b < BARS; b += 1) {
    const [r, q] = chordAt(b);
    const v = CHILL_Q[q]!.map((x) => { let m = tonic + r + x; while (m < center - 6) m += 12; while (m > center + 6) m -= 12; return m; });
    let vs = [...new Set(v)].sort((a, c) => a - c);
    for (let k = 0; k + 1 < vs.length; k += 1) if (vs[k + 1]! - vs[k]! === 1 && vs[k]! < 60) { vs[k] = vs[k]! + 12; vs = [...new Set(vs)].sort((a, c) => a - c); k = -1; }
    // (Every keys note at G4 or under, none under C3: the tune's room is kept above them.)
    vs = [...new Set(vs.map((x) => { while (x > 67) x -= 12; while (x < 48) x += 12; return x; }))].sort((a, c) => a - c);
    voicings.push(vs);
    center = Math.round(vs.reduce((a, c) => a + c, 0) / vs.length);
  }
  const compOf = (b: number): (typeof CHILL_COMPS)[number] => (sec(b) === "B" ? compB : comp);
  for (let b = 0; b < BARS; b += 1) {
    const pat = compOf(b), vs = voicings[b]!, nextPat = compOf((b + 1) % BARS);
    // (Each chord lets go before the next one comes in, early or on the one: no two chords smeared together.)
    const nextAt = (b + 1) * 4 + Math.min(0, ...nextPat.map(([k]) => k)) / 4 - 0.03;
    const pass = passing && b % 2 === 1 && !pat.some(([k]) => k < 0 || k >= 14) && !nextPat.some(([k]) => k < 0);
    const until = pass ? st(b, 14) - 0.03 : nextAt;
    for (const [k, len, vm] of pat) {
      const at = k < 0 ? st(b, 0) + k / 4 : st(b, k);
      const end = Math.min(at + (len / 4) * 0.95, k < 0 ? Infinity : until);
      vs.forEach((m, i) => add("pad", at + i * 0.012, Math.max(0.2, end - at - i * 0.012), m, (0.72 + Sh.f() * 0.06 - i * 0.02) * vm));
    }
    // (A neo-soul passing chord: the next chord a semitone above, on the last eighth.)
    if (pass) for (const m of voicings[(b + 1) % BARS]!) add("pad", st(b, 14), 0.42, m + 1, 0.5);
  }

  // ---- the bass: round under the kick (or an upright walking), an approach into each bar
  track("bass", bass === "walk" ? "upright2" : "round", bass === "walk" ? { gain: 0.5, release: 0.06, lowpass: 1200, pump: 0.15 } : { gain: 0.22, release: 0.08, lowpass: 1200, pump: 0.25 });
  for (let b = 0; b < BARS; b += 1) {
    const [r, q] = chordAt(b), root = place(mod(tonic + r, 12), 31), next = place(mod(tonic + chordAt((b + 1) % BARS)[0], 12), 31);
    const fifth = root + 7, third = root + (CHILL_Q[q]![0] ?? 4);
    if (bass === "walk") {
      const line = [root, Sm.pick([third, fifth]), Sm.pick([fifth, root + 12, third]), next + (next > root ? -1 : 1)];
      line.forEach((p, i) => add("bass", st(b, i * 4), 0.9, p, i === 0 ? 0.9 : 0.72));
      continue;
    }
    const pat = dropKit(b) ? [0] : sec(b) === "A2" && b % 2 === 1 ? kickAlt : kickPat;
    pat.forEach((k, i) => add("bass", st(b, k), i === 0 ? Math.min(1.6, (pat[1] ?? 16) / 4 - 0.1) : 0.9, i === 0 ? root : Sm.pick([root, root, fifth, root + 12]), i === 0 ? 0.9 : 0.75));
    if (sec(b) !== "intro" && Sm.chance(0.6) && !pat.some((k) => k >= 12)) add("bass", st(b, 14), 0.45, next + (next > root ? -1 : 1), 0.6); // (an approach, where the kick leaves room)
  }

  // ---- the tune: a call (bars 2-3 of each phrase) and its answer (bars 4-5) in another voice; A' varies the call's end;
  // the bridge has its own motif; the outro calls again and the intro, filtered, answers.
  const pent = colour === "major" ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  const scaleOf = (b: number): number[] => [...new Set([...pent.map((x) => mod(tonic + x, 12)), ...voicings[b]!.map((m) => mod(m, 12))])];
  const tones = (b: number): number[] => voicings[b]!.map((m) => mod(m, 12));
  const snap = (pcs: readonly number[], p: number): number => nearestIn(pcs, p);
  const rubs = (b: number, p: number): boolean => tones(b).some((c) => mod(p - c, 12) === 1 || mod(c - p, 12) === 1) && !tones(b).includes(mod(p, 12));
  type Phrase = { cells: (readonly (readonly [number, number])[])[]; moves: number[] };
  const phrase = (): Phrase => { const cells = [Sm.pick(CHILL_CELLS), Sm.pick(CHILL_CELLS)]; const moves: number[] = []; for (let i = 0; i < 12; i += 1) moves.push(Sm.pick([-2, -1, -1, 1, 1, 2, 0, -3, 3])); return { cells, moves }; };
  const play = (id: string, ph: Phrase, b0: number, lo: number, hi: number, start: number, vary = 0): void => {
    let p = start, n = 0;
    ph.cells.forEach((cell, j) => {
      const b = b0 + j, sc = scaleOf(b), last = j === ph.cells.length - 1;
      cell.forEach(([k, len], i) => {
        if (n > 0) p = stepScale(sc, p, (ph.moves[n % ph.moves.length]! + (vary && last && i >= cell.length - 2 ? vary : 0)) || 1);
        const floor = Math.max(lo, voicings[b]!.at(-1)! + 3);
        while (p > hi) p -= 12; while (p < floor) p += 12;
        // (On the bar's one, and on anything held, a chord tone: nothing rubs a semitone against the keys.)
        if (k === 0 || len >= 3 || (last && i === cell.length - 1)) p = snap(tones(b), p);
        if (rubs(b, p)) p = snap(tones(b), p);
        while (p < floor) p += 12; // (over the keys, always)
        while (p > 81) p -= 12;
        const at = hum(st(b, k), 0.005), beats = Math.max(0.25, (len / 4) * 0.92);
        if (len >= 3) {
          // (A held note against whatever the keys sound under it -- an early chord too: nothing a semitone off.)
          const under = [...new Set(T.pad!.notes.filter((m) => m.beat < at + beats && m.beat + m.beats > at).map((m) => mod(m.pitch, 12)))];
          const bad = (q: number): boolean => under.some((c) => mod(q - c, 12) === 1 || mod(c - q, 12) === 1) && !under.includes(mod(q, 12));
          if (bad(p)) { const ok = [...tones(b), ...under].filter((c) => !bad(c)); if (ok.length) { p = nearestIn(ok, p); while (p < floor) p += 12; while (p > 81) p -= 12; } }
        }
        add(id, at, beats, p, 0.62 + Sh.f() * 0.12 - (i % 2) * 0.05);
        n += 1;
      });
    });
  };
  track("lead", lead, { pan: 0.18, pump: 0.2, ...CHILL_LEAD_OPTS[lead]! });
  track("lead2", answer, { pan: -0.22, pump: 0.2, ...CHILL_LEAD_OPTS[answer]! });
  const call = phrase(), resp = phrase(), bridgeCall = phrase();
  const hiOf = (v: string): number => (v === "mutedgtr" ? 79 : 81), loOf = (v: string): number => (v === "mutedgtr" ? 62 : 67);
  const startA = snap(tones(2), 69), startR = snap(tones(4), 64);
  play("lead", call, 2, loOf(lead), hiOf(lead), startA);
  play("lead2", resp, 4, loOf(answer), hiOf(answer), startR);
  play("lead", call, 6, loOf(lead), hiOf(lead), startA, Sm.pick([1, -1, 2]));
  play("lead2", resp, 8, loOf(answer), hiOf(answer), startR, Sm.pick([1, -1]));
  play("lead", bridgeCall, 10, loOf(lead), hiOf(lead), snap(tones(10), 71));
  play("lead", { cells: [bridgeCall.cells[1]!, Sm.pick(CHILL_CELLS)], moves: bridgeCall.moves.slice(3) }, 12, loOf(lead), hiOf(lead), snap(tones(12), 67));
  play("lead", call, 14, loOf(lead), hiOf(lead), startA);
  play("lead2", resp, 0, loOf(answer), hiOf(answer), snap(tones(0), 64));

  // ---- warmth and weather: a soft pad under the bridge, the air outside under it all
  if (warm) { track("warm", "saw-pad", { gain: 0.1, reverb: 0.6, attack: 1.2, release: 1.6, cutoff: 2, lowpass: 1600, highpass: 200, pump: lofi.pump }); for (let b = 10; b < 14; b += 1) for (const m of voicings[b]!.slice(0, 3)) add("warm", b * 4, 4, m, 0.6); }
  const air = NIGHT_AIRS[view] ?? null;
  if (air) { track("air", air, { gain: 0.03, reverb: 0.2, attack: 2, release: 2 }); for (let b = 0; b < BARS; b += 4) add("air", b * 4, 16, 60, 0.8); }

  // The section filter: the intro opening, the bridge's (if it filters), the outro closing over its last bar into the top.
  const sweep: [number, number][] = [[0, 800], [6, 1500], [8, 18000]];
  if (bridge !== "drop") sweep.push([40, 18000], [41, 2600], [54, 3800], [56, 18000]);
  sweep.push([total - 5, 18000], [total - 1, 1000]); // (closed by the last beat: the join is the intro's own colour)
  const tracks = Object.values(T).filter((t) => t.notes.length).map((t) => ({ ...t, notes: t.notes.sort((a, c) => a.beat - c.beat || a.pitch - c.pitch) }));
  const plan: NightPlan = {
    seed, feel: "lofi", meter: "4", bpm: BPM, hr: 1, passes: 4, mode, tonic, key: `${NAMES[tonic]} ${colour}`,
    lead, style: "motif", bass, pad: keysVoice, drone: false, kit: "boombap",
    groove: { ghosts, fill: fillKind, accent: useRim ? "rim" : "snare", hats: hats16 ? "sub" : "beat", shake: "none", vary: 0, drop: 0, kick2: 0, bassFig: 0, kickEvery: 1, rimShift: 0 },
    overlays: ["answer"], air, enter: { lead: 0, lead2: 0, pad: 0, bass: 0, kit: 0, air: 0 }, progA: progA as Prog, progB: progB as Prog, riffGroup: 0, pedalDeg: 0, riffLine: bridge,
    motif: { cells: [0, 0], contours: [0, 0], arp: 0, cad: 0, start: 0, hold: false }, view, dark, theme: mood.name, swing, lofi,
  };
  return {
    plan,
    song: { version: 1, bpm: BPM, seed: fnv(`${seed}|kit`) & 0xffff, root: place(tonic, 47), totalBeats: total, tailSeconds: 0, loop: true, focus: { ids: ["lead", "lead2"], share: 0.12, most: 0.3 }, reverb: { size: 0.7, damp: 0.5 }, lofi, sweep, mud: 0.5, musicRms: 0.15, tracks, hits: [] },
    form: { bar: 4, span: 4, spans: BARS, sections: ["intro", "A", "B", "outro"], grid: 0.25 },
  };
}

/** A room's song from its mood and pins: lo-fi hip-hop, unless the studio pinned one of the older feels. */
export function nightSongOf(mood: NightMood, pins: NightPins = {}): { plan: NightPlan; song: NightSong; form: NightForm } {
  if (!pins.theme || pins.theme === "lofi" || !NIGHT_FEELS[pins.theme]) return chillSongOf(mood, pins);
  // (An older feel pinned: its own composer, with none of the lo-fi room's players pinned on it.)
  const chillOnly = new Set(["vibes2", "mutedgtr", "rhodes", "flute", "wurli", "boombap"]);
  return hauntSongOf(mood, Object.fromEntries(Object.entries(pins).filter(([, v]) => !chillOnly.has(String(v)))) as NightPins);
}

/** A NOCTURNES genome's song (its recipe.music as pins: theme = the feel, kit, keys = the pad, lead, bass, mode, key, tempo). */
export function nightsongOf(g: NocturnesGenome): { plan: NightPlan; song: NightSong; form: NightForm } {
  const mood = moodOfNocturnes(g);
  return nightSongOf(mood, (g.recipe?.music ?? {}) as NightPins);
}

/** A procedural NOCTURNES room's music as its plan (kind "nightsong"): the feel, key, players, the bars, the arrangement itself. */
export function nightScoreOf(g: NocturnesGenome) {
  const { plan, song, form } = nightsongOf(g);
  const barSec = (form.bar * 60) / plan.bpm;
  const bars: { sec: string }[] = [];
  for (let s = 0; s < form.spans; s += 1) for (let b = 0; b < plan.hr; b += 1) bars.push({ sec: form.sections[Math.floor(s / 4)]! });
  return {
    kind: "nightsong" as const, seed: plan.seed, theme: plan.feel, kit: plan.kit, keys: plan.pad, lead: plan.lead, bass: plan.bass, mode: plan.mode, tonic: plan.tonic,
    bpm: plan.bpm, barSec, loopBars: bars.length, loopSec: barSec * bars.length, picture: ((g.frames ?? 48) * (g.delay ?? 9)) / 100,
    weather: plan.air ? [plan.air] : [], room: [] as string[], bars, night: plan, form, song,
  };
}
