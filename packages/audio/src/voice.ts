// A race's voice, for battle audio: alert "announcers" and unit barks that are
// voice-like but never speech -- syllable-shaped formant blips, chirps,
// grunts, clicks, chitters, hums -- and the stings (a completion motif, a
// "unit ready") played on the voice's own instrument, in its key.
//
//   const v = voiceFor({ seed: race.seed, timbre: "machine", size: 1.2, hue: race.palette.hue });
//   alertSample("underAttack", v, rate); barkSample("select", v, 0, rate); stingSample("complete", v, rate);
//
// Six timbres, each its own way of making a sound (not a filter over one):
//   machine   a stepped pulse through formants, crushed to a few bits (robotic chirps)
//   organic   a growling, breathy glottal buzz through soft formants (grunts, chitters)
//   crystal   high inharmonic partials that ring past the syllable (glassy pings)
//   resonant  a buzz and its fifth through very sharp formants (a sung, humming vowel)
//   thermal   noise through formants over a low rumble, with crackle (a roaring, whispered breath)
//   gravitic  a deep FM tone that swells in and wobbles, a sub under it (warped, heavy)
// A race's seed moves the pitch, the vocal size, the pace, the roughness and
// which vowels it favours; `size` is the unit's (a bigger unit is lower and
// slower). Plain code on Float32Arrays: Node runs it.

import { hash, streamOf } from "./score.ts";
import type { Stream } from "./score.ts";
import { TAU, add, bp, buf, burst, crush, env, formants, hp, lp, midiHz, noiseOf, osc, sweep } from "./synth.ts";
import type { Rnd, Samples } from "./synth.ts";

export const TIMBRES = ["machine", "organic", "crystal", "resonant", "thermal", "gravitic"] as const;
export type Timbre = (typeof TIMBRES)[number];
export const ALERT_KINDS = ["underAttack", "noResources", "supplyBlocked", "buildingComplete", "researchComplete", "unitReady", "idleWorker", "fieldDepleted"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const BARK_KINDS = ["select", "move", "attack", "death", "annoyed"] as const;
export type BarkKind = (typeof BARK_KINDS)[number];
export const STING_KINDS = ["complete", "ready"] as const;
export type StingKind = (typeof STING_KINDS)[number];

/** A timbre from a timbre's name or a MYRIAD flavour (biotic -> organic, crystalline -> crystal); undefined for neither. */
export function timbreOf(name: string | undefined): Timbre | undefined {
  if (name === "biotic") return "organic";
  if (name === "crystalline") return "crystal";
  return (TIMBRES as readonly string[]).includes(name as string) ? (name as Timbre) : undefined;
}

/** What a voice is asked for with. */
export interface VoiceSpec {
  /** The race's seed (its genome): the same seed, the same voice. */
  readonly seed?: string | number | undefined;
  /** A timbre, or a MYRIAD flavour; none: the seed picks one. */
  readonly timbre?: Timbre | string | undefined;
  /** The unit's size (1 a line unit; 0.6 a worker, 1.3 a heavy, up to 4): bigger is lower and slower. */
  readonly size?: number | undefined;
  /** The key for the stings, a pitch class 0-11 (C = 0). */
  readonly root?: number | undefined;
  /** Or a hue (0-360), read round the circle of fifths as moodFor reads it: the stings share the music's key. */
  readonly hue?: number | undefined;
}
/** A voice, worked out: plain numbers (its id is what the player caches its samples by). */
export interface BattleVoice {
  readonly id: string;
  readonly seed: string;
  readonly timbre: Timbre;
  readonly size: number;
  /** The stings' key, a pitch class. */
  readonly root: number;
  /** The voice's pitch, Hz. */
  readonly f0: number;
  /** How its formants sit (1 an adult's; higher is a smaller throat). */
  readonly formant: number;
  /** A syllable's beat, seconds. */
  readonly beat: number;
  /** 0 smooth .. 1 gravelly. */
  readonly rough: number;
  /** The vowels it favours (a permutation of 0-4: a e i o u). */
  readonly vowels: readonly number[];
}

const BASE_HZ: Readonly<Record<Timbre, number>> = { machine: 150, organic: 118, crystal: 430, resonant: 165, thermal: 92, gravitic: 85 };
const FORMANT: Readonly<Record<Timbre, number>> = { machine: 1.1, organic: 0.95, crystal: 1.45, resonant: 0.9, thermal: 1, gravitic: 0.72 };
const PACE: Readonly<Record<Timbre, number>> = { machine: 0.9, organic: 1, crystal: 0.85, resonant: 1.15, thermal: 1, gravitic: 1.25 };
const ROUGH: Readonly<Record<Timbre, number>> = { machine: 0.2, organic: 0.55, crystal: 0.05, resonant: 0.15, thermal: 0.6, gravitic: 0.3 };
const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5] as const;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** A race's voice: its seed, a timbre (or MYRIAD flavour), a unit's size, and the stings' key (root, or a hue). */
export function voiceFor({ seed = "1", timbre, size = 1, root, hue }: VoiceSpec = {}): BattleVoice {
  const s = String(seed);
  const t = timbreOf(timbre) ?? streamOf(`${s}|voice|timbre`).pick(TIMBRES);
  const z = Math.max(0.3, Math.min(4, Number.isFinite(size) ? size : 1));
  const S = streamOf(`${s}|voice`);
  const pitch = S.between(0.85, 1.18);
  const fmt = S.between(0.9, 1.1);
  const pace = S.between(0.85, 1.2);
  const rough = Math.max(0, Math.min(1, ROUGH[t] + S.between(-0.12, 0.2)));
  const order = [0, 1, 2, 3, 4];
  for (let i = order.length - 1; i > 0; i -= 1) { const j = S.int(0, i); [order[i], order[j]] = [order[j]!, order[i]!]; }
  const key = root !== undefined && Number.isFinite(root) ? ((Math.round(root) % 12) + 12) % 12
    : hue !== undefined && Number.isFinite(hue) ? FIFTHS[Math.round((((hue % 360) + 360) % 360) / 30) % 12]! : S.int(0, 11);
  return {
    id: `${s}|${t}|${r3(z)}|${key}`, seed: s, timbre: t, size: r3(z), root: key,
    f0: r3(BASE_HZ[t] * pitch * z ** -0.6), formant: r3(FORMANT[t] * fmt * z ** -0.3), beat: r3(0.075 * PACE[t] * pace * z ** 0.2), rough: r3(rough), vowels: order,
  };
}

// ---------------------------------------------------------------- syllables

/** One syllable: start and length (s), pitch from/to (semitones over the voice), vowel from/to (0-4), level. */
interface Syl { readonly t: number; readonly d: number; readonly p0: number; readonly p1: number; readonly v0: number; readonly v1: number; readonly a: number }
// (Vowel formants, an adult's: a e i o u.)
const VOWELS: readonly (readonly number[])[] = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
const TAIL: Readonly<Record<Timbre, number>> = { machine: 0.02, organic: 0.03, crystal: 0.14, resonant: 0.05, thermal: 0.03, gravitic: 0.05 };
const smooth = (u: number): number => { const c = Math.max(0, Math.min(1, u)); return c * c * (3 - 2 * c); };

/** A syllable in the voice's own timbre. */
function syllable(v: BattleVoice, s: Syl, rate: number, rnd: Rnd, extra: number): Samples {
  const { d } = s;
  const len = d + TAIL[v.timbre];
  const y = buf(rate, len);
  const u = (t: number) => Math.max(0, Math.min(1, t / d));
  const pitchAt = (t: number, shape = smooth) => v.f0 * 2 ** ((s.p0 + (s.p1 - s.p0) * shape(u(t))) / 12);
  const va = VOWELS[v.vowels[s.v0 % 5]!]!;
  const vb = VOWELS[v.vowels[s.v1 % 5]!]!;
  const fAt = (t: number) => { const k = smooth(u(t)); return [0, 1, 2].map((i) => (va[i]! + (vb[i]! - va[i]!) * k) * v.formant); };
  const gate = (a: number, r: number) => (t: number) => (t < a ? Math.sin((Math.PI / 2) * (t / a)) : t < d - r ? 1 : t < d ? Math.cos((Math.PI / 2) * ((t - (d - r)) / r)) : 0);
  const rough = Math.min(1, v.rough + extra);
  switch (v.timbre) {
    case "machine": {
      // A pulse whose pitch moves in steps (three a syllable), a beep an octave up, formants, then crushed.
      const g = gate(0.003, 0.008);
      const step = (w: number) => Math.min(1, Math.floor(w * 3) / 2);
      const e = buf(rate, len);
      osc(e, rate, 0, d, (t) => pitchAt(t, step), g, "pulse", 0, 0.22);
      const f = formants(e, rate, fAt, 6, [1, 0.8, 0.45]);
      osc(f, rate, 0, d, (t) => pitchAt(t, step) * 2, (t) => g(t) * 0.18, "square");
      burst(f, rate, rnd, 0, env(0.0002, 0.0015), 0.8, 0.01); // (a relay's click)
      add(y, crush(f, 5, 4));
      break;
    }
    case "organic": {
      // A tongue's click, then a glottal buzz that wavers, growls at half its pitch and breathes, through soft
      // formants; a chitter when agitated.
      const g = gate(0.012, 0.03);
      const vib = 5 + rough * 3;
      const e = buf(rate, len);
      osc(e, rate, 0, d, (t) => pitchAt(t) * (1 + 0.025 * Math.sin(TAU * vib * t)), g, "saw");
      const sub = v.f0 / 2;
      for (let i = 0; i < e.length; i += 1) {
        const t = i / rate;
        e[i] = e[i]! * (1 - rough * 0.7 * (0.5 + 0.5 * Math.sin(TAU * sub * t))) + rnd() * 0.4 * g(t);
      }
      const f = formants(e, rate, fAt, 4, [1, 0.5, 0.2]);
      const chit = 26 + 14 * rough;
      if (extra > 0) for (let i = 0; i < f.length; i += 1) f[i]! *= 0.35 + 0.65 * (Math.sin(TAU * chit * (i / rate)) > 0 ? 1 : 0);
      const k = burst(buf(rate, 0.02), rate, rnd, 0, env(0.0003, 0.002), 1);
      add(y, f);
      add(y, bp(k, 2600, 1.5, rate), 3);
      break;
    }
    case "crystal": {
      // Inharmonic partials following the contour, struck and ringing on past the syllable; a light formant colour.
      const ring = env(0.002, d * 0.75);
      const e = buf(rate, len);
      [1, 2.32, 4.25, 6.8].forEach((r, i) => osc(e, rate, 0, len, (t) => pitchAt(Math.min(t, d)) * r, (t) => ring(t) * [1, 0.55, 0.3, 0.15][i]!, "sine", i * 0.21));
      const f = formants(e, rate, fAt, 8, [0.6, 0.6, 0.6]);
      add(y, e, 0.6);
      add(y, f, 0.9);
      burst(y, rate, rnd, 0, env(0.0002, 0.001), 0.35, 0.005);
      break;
    }
    case "resonant": {
      // A hum: a soft tone, its chorus and its fifth, gliding, through very sharp formants over the pure note.
      const g = gate(0.04, 0.05);
      const e = buf(rate, len);
      osc(e, rate, 0, d, (t) => pitchAt(t), g, "tri");
      osc(e, rate, 0, d, (t) => pitchAt(t) * 1.006, (t) => g(t) * 0.7, "tri", 0.4);
      osc(e, rate, 0, d, (t) => pitchAt(t) * 1.4983, (t) => g(t) * 0.3, "tri", 0.2);
      add(y, formants(e, rate, fAt, 18, [1, 0.9, 0.5]));
      osc(y, rate, 0, d, (t) => pitchAt(t), (t) => g(t) * 0.12, "sine");
      break;
    }
    case "thermal": {
      // Breath and flame: noise through formants over a low rumble, flickering, with crackle.
      const g = gate(0.01, 0.03);
      const flick = 11 + 7 * rnd();
      const e = buf(rate, len);
      for (let i = 0; i < e.length; i += 1) { const t = i / rate; e[i] = rnd() * g(t) * (0.75 + 0.25 * Math.sin(TAU * flick * t)); }
      const f = formants(e, rate, fAt, 4, [1, 0.8, 0.5]);
      osc(f, rate, 0, d, (t) => pitchAt(t), (t) => g(t) * 0.2, "saw");
      const c = buf(rate, len);
      for (let i = 0; i < Math.round(d * rate); i += 1) if (rnd() > 0.992 - rough * 0.006) c[i] = rnd() * 0.9;
      add(y, f);
      add(y, hp(c, 2500, rate), 0.7);
      break;
    }
    case "gravitic": {
      // A deep FM tone that swells in, dips and wobbles, a sub under it, loosely shaped by formants.
      const sw = (t: number) => (t < d * 0.55 ? Math.sin((Math.PI / 2) * (t / (d * 0.55))) ** 2 : t < d - 0.04 ? 1 : t < d ? (d - t) / 0.04 : 0);
      const e = buf(rate, len);
      let pc = 0;
      let pm = 0;
      for (let i = 0; i < Math.round(d * rate) && i < e.length; i += 1) {
        const t = i / rate;
        const f = pitchAt(t) * (1 + 0.05 * Math.sin(TAU * 5.5 * t)) * 2 ** ((-3 * Math.exp(-t / 0.05)) / 12);
        pm += (TAU * f * 0.5) / rate;
        pc += (TAU * f) / rate;
        const index = 2.6 * (1 - 0.5 * u(t));
        e[i] = (Math.sin(pc + index * Math.sin(pm)) + 0.55 * Math.sin(pc / 2)) * sw(t);
      }
      const f = formants(e, rate, fAt, 3, [1, 0.45, 0.2]);
      add(y, e, 0.45);
      add(y, f, 0.8);
      break;
    }
  }
  for (let i = 0; i < y.length; i += 1) y[i]! *= s.a;
  return y;
}

/** Syllables into one sound (times compressed so the whole fits `max` seconds). */
function speak(v: BattleVoice, syls: readonly Syl[], rate: number, rnd: Rnd, extra = 0, max = Infinity): Samples {
  const end = Math.max(...syls.map((s) => s.t + s.d));
  const k = Math.min(1, (max - TAIL[v.timbre]) / end);
  const list = k < 1 ? syls.map((s) => ({ ...s, t: s.t * k, d: s.d * k })) : syls;
  const x = buf(rate, end * Math.min(1, k) + TAIL[v.timbre] + 0.01);
  for (const s of list) add(x, syllable(v, s, rate, rnd, extra), 1, s.t * rate);
  return x;
}

// ---------------------------------------------------------------- alerts

// Each alert's pattern, in beats: [start, length, pitch from, pitch to, vowel from, vowel to, level]. They differ in
// rhythm (how many, how fast, how even) and contour (up, down, level, a siren, a question).
type Pat = readonly (readonly [number, number, number, number, number, number, number])[];
const ALERTS: Readonly<Record<AlertKind, Pat>> = {
  // Four fast alternating blips and a falling last one: a siren.
  underAttack: [[0, 0.7, 7, 7, 0, 0, 1], [0.9, 0.7, 3, 3, 0, 0, 1], [1.8, 0.7, 7, 7, 0, 0, 1], [2.7, 0.7, 3, 3, 0, 0, 1], [3.6, 1.4, 8, 1, 0, 3, 1]],
  // Three slow, falling, closing: a sigh.
  noResources: [[0, 1.4, 2, 1, 3, 3, 1], [1.7, 1.4, 0, -1, 4, 4, 0.9], [3.4, 2.6, -2, -7, 4, 3, 0.85]],
  // Three quick level taps and a long low buzz: blocked.
  supplyBlocked: [[0, 0.5, 0, 0, 1, 1, 1], [0.7, 0.5, 0, 0, 1, 1, 1], [1.4, 0.5, 0, 0, 1, 1, 1], [2.2, 2.6, -5, -5, 0, 0, 1]],
  // A major arpeggio going up: built.
  buildingComplete: [[0, 1, 0, 0, 0, 0, 1], [1.2, 1, 4, 4, 1, 1, 1], [2.4, 2.4, 7, 7, 2, 0, 1]],
  // A long glide up an octave and a quick sparkle of three at the top: discovered.
  researchComplete: [[0, 2.8, 0, 12, 0, 2, 1], [3.1, 0.45, 12, 12, 2, 2, 0.9], [3.65, 0.45, 14, 14, 1, 1, 0.85], [4.2, 0.45, 16, 16, 2, 2, 0.8]],
  // A call and an answer a fifth up.
  unitReady: [[0, 1.3, 0, 0, 3, 3, 1], [1.6, 2, 7, 9, 0, 0, 1]],
  // A long rising question and a short higher one.
  idleWorker: [[0, 2.6, 0, 5, 4, 2, 1], [3, 0.8, 5, 8, 2, 2, 0.9]],
  // A long fall and two low taps: running out.
  fieldDepleted: [[0, 3, 5, -7, 0, 3, 1], [3.4, 0.7, -9, -9, 4, 4, 0.85], [4.3, 0.7, -10, -10, 4, 4, 0.8]],
};
const syls = (p: Pat, beat: number): Syl[] => p.map(([t, d, p0, p1, v0, v1, a]) => ({ t: t * beat, d: d * beat, p0, p1, v0, v1, a }));

/** An alert in the voice: a pattern of syllable-like blips (not speech), the same every time for a voice. */
export function alertSample(kind: AlertKind, v: BattleVoice, rate = 44100): Samples {
  const p = ALERTS[kind];
  if (!p) throw new RangeError(`No alert "${kind}" (alerts: ${ALERT_KINDS.join(", ")})`);
  return speak(v, syls(p, v.beat * 1.25), rate, noiseOf(hash(`${v.id}|alert|${kind}`)), 0, 1.2);
}

// ---------------------------------------------------------------- barks

const range = (R: Stream, a: number, b: number) => R.between(a, b);
/** A bark's syllables (the race's seed and the variant draw them; the unit's size only moves the voice). */
function barkSyls(kind: BarkKind, v: BattleVoice, variant: number): { syls: Syl[]; extra: number } {
  const R = streamOf(`${v.seed}|bark|${kind}|${variant}`);
  const b = v.beat;
  const out: Syl[] = [];
  let t = 0;
  const vw = () => R.int(0, 4);
  if (kind === "select") {
    for (let k = 0, n = R.int(1, 2); k < n; k += 1) {
      const d = b * range(R, 1.3, 2);
      const p0 = range(R, 0, 3);
      out.push({ t, d, p0, p1: p0 + range(R, 1, 4), v0: vw(), v1: vw(), a: 0.9 });
      t += d + b * 0.3;
    }
    return { syls: out, extra: 0 };
  }
  if (kind === "move") {
    const d1 = b * range(R, 1.1, 1.5);
    const p = range(R, 1, 3);
    out.push({ t: 0, d: d1, p0: p, p1: p, v0: vw(), v1: vw(), a: 0.9 });
    const p0 = range(R, 0, 2);
    out.push({ t: d1 + b * 0.25, d: b * range(R, 1.4, 2), p0, p1: p0 - range(R, 2, 5), v0: vw(), v1: vw(), a: 0.85 });
    return { syls: out, extra: 0 };
  }
  if (kind === "attack") {
    for (let k = 0, n = R.int(2, 3); k < n; k += 1) {
      const d = b * range(R, 0.8, 1.1);
      const p0 = range(R, -1, 2);
      out.push({ t, d, p0, p1: p0 - range(R, 0, 3), v0: 0, v1: R.pick([0, 3]), a: 1 });
      t += d + b * 0.15;
    }
    return { syls: out, extra: 0.3 };
  }
  if (kind === "death") {
    const p0 = range(R, 2, 5);
    out.push({ t: 0, d: range(R, 0.28, 0.4), p0, p1: p0 - range(R, 10, 16), v0: 0, v1: 4, a: 1 });
    return { syls: out, extra: 0.2 };
  }
  // annoyed: many, fast, high, jumping about.
  let up = R.chance(0.5);
  for (let k = 0, n = R.int(5, 6); k < n; k += 1) {
    const d = b * range(R, 0.65, 0.9);
    const p0 = 5 + range(R, 0, 4) + (up ? 3 : -1);
    out.push({ t, d, p0, p1: p0 + (up ? -1 : 1) * range(R, 2, 5), v0: vw(), v1: vw(), a: 1 });
    t += d + b * range(R, 0.1, 0.25);
    up = !up;
  }
  return { syls: out, extra: 0.45 };
}

/** A unit's bark in the voice (select, move, attack, death, annoyed), one of its variants: 0.06-0.7 s. */
export function barkSample(kind: BarkKind, v: BattleVoice, variant = 0, rate = 44100): Samples {
  if (!(BARK_KINDS as readonly string[]).includes(kind)) throw new RangeError(`No bark "${kind}" (barks: ${BARK_KINDS.join(", ")})`);
  const { syls: list, extra } = barkSyls(kind, v, variant);
  const x = speak(v, list, rate, noiseOf(hash(`${v.id}|bark|${kind}|${variant}`)), extra, kind === "annoyed" ? 0.68 : 0.62);
  return x.length > rate * 0.7 ? x.slice(0, Math.round(rate * 0.7)) : x;
}

// ---------------------------------------------------------------- stings

// The motifs a race's seed picks from (semitones over its root), ending home.
const MOTIFS: readonly (readonly number[])[] = [[0, 4, 7, 12], [0, 7, 12], [0, 5, 7, 12], [0, 3, 7, 12], [0, 7, 4, 12], [0, 2, 7, 12]];
const READY: readonly (readonly number[])[] = [[0, 7], [0, 12], [7, 12], [5, 12]];
const OCTAVE: Readonly<Record<Timbre, number>> = { machine: 60, organic: 60, crystal: 72, resonant: 60, thermal: 55, gravitic: 48 };

/** One note on the voice's instrument. */
function note(v: BattleVoice, f: number, len: number, rate: number, rnd: Rnd): Samples {
  const y = buf(rate, len);
  switch (v.timbre) {
    case "machine": {
      osc(y, rate, 0, len, () => f, env(0.002, 0.12), "square");
      return crush(lp(y, 5000, rate), 6, 2);
    }
    case "organic": {
      const e = env(0.02, 0.22);
      osc(y, rate, 0, len, (t) => f * (1 + 0.012 * Math.sin(TAU * 5 * t)), e, "sine");
      osc(y, rate, 0, len, (t) => 2 * f * (1 + 0.012 * Math.sin(TAU * 5 * t)), (t) => e(t) * 0.3, "sine");
      const n = burst(buf(rate, len), rate, rnd, 0, env(0.01, 0.06), 0.15);
      return add(y, sweep(n, () => f * 3, 3, rate));
    }
    case "crystal":
      [1, 2.76, 5.4, 8.93].forEach((r, i) => { const e = env(0.001, 0.6 / (1 + i)); const a = [1, 0.5, 0.25, 0.12][i]!; osc(y, rate, 0, len, () => f * r, (t) => e(t) * a, "sine", i * 0.3); });
      return y;
    case "resonant": {
      let pc = 0;
      let pm = 0;
      const e = env(0.005, 0.3);
      for (let i = 0; i < y.length; i += 1) {
        const t = i / rate;
        pc += (TAU * f) / rate; pm += (TAU * f * 2) / rate;
        y[i] = Math.sin(pc + 3 * Math.exp(-t / 0.08) * Math.sin(pm)) * e(t);
      }
      return y;
    }
    case "thermal": {
      osc(y, rate, 0, len, () => f, env(0.02, 0.25), "saw");
      return sweep(y, (t) => 400 + 3000 * Math.min(1, t / 0.05) * Math.exp(-t / 0.2), 1.2, rate, "low");
    }
    case "gravitic": {
      const e = (t: number) => Math.min(1, t / 0.03) * Math.exp(-t / 0.35) * (1 + 0.15 * Math.sin(TAU * 6 * t));
      osc(y, rate, 0, len, (t) => f * 2 ** ((-2 * Math.exp(-t / 0.03)) / 12), e, "sine");
      return osc(y, rate, 0, len, () => f / 2, (t) => e(t) * 0.5, "sine");
    }
  }
}

/** A sting in the voice's key on its instrument: "complete" (a short motif) or "ready" (two notes up). */
export function stingSample(kind: StingKind, v: BattleVoice, rate = 44100): Samples {
  if (!(STING_KINDS as readonly string[]).includes(kind)) throw new RangeError(`No sting "${kind}" (stings: ${STING_KINDS.join(", ")})`);
  const S = streamOf(`${v.seed}|sting|${kind}`);
  const notes = kind === "complete" ? S.pick(MOTIFS) : S.pick(READY);
  const gap = kind === "complete" ? 0.11 : 0.1;
  const last = kind === "complete" ? 0.5 : 0.32;
  const x = buf(rate, gap * (notes.length - 1) + last);
  const rnd = noiseOf(hash(`${v.id}|sting|${kind}`));
  const base = OCTAVE[v.timbre] + v.root;
  notes.forEach((m, i) => { const len = i === notes.length - 1 ? last : gap * 1.6; add(x, note(v, midiHz(base + m), len, rate, rnd), i === notes.length - 1 ? 1 : 0.8, i * gap * rate); });
  return x;
}
