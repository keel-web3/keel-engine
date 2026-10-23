// The NOCTURNES house band, as plain code on Float32Arrays: the instruments of
// the Halloween soundtrack (a music box and a celesta, the driven synth bass
// over a sub, the saw pad, the drone, the choir, the theremin, the glass
// bells, the pulse chip, the kit) plus the house twang: a plucked string
// (Karplus-Strong) with a pick on it, a little bend at the strike and a
// slap-back like a spring.
//
// renderNightSong(song, { rate }) plays an arrangement (nightsong.ts's, the
// trailer-score form) into one loop of stereo that repeats with no seam: every
// note's tail and the room's reverb wrap round into the top. It runs the same
// in Node and on a page; nothing is fetched and no Web Audio is needed.

import { BASS, DRUMS as ENGINE_DRUMS, KEYS as ENGINE_KEYS, noiseOf, partials, pluck } from "./samples.ts";
import type { Samples } from "./samples.ts";
import type { Design } from "./score.ts";
import type { NightLofi, NightSong, NightTrack } from "./nightsong.ts";

const TAU = Math.PI * 2;
const hz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

const buf = (rate: number, sec: number): Samples => new Float32Array(Math.max(1, Math.round(rate * sec)));
const nyq = (f: number, rate: number): number => Math.max(10, Math.min(f, rate * 0.45));

function onePole<T extends Float32Array>(x: T, f: number, rate: number, high = false, ring = false): T {
  const k = Math.exp((-TAU * nyq(f, rate)) / rate);
  let y = 0;
  // (Round a ring, the filter is warmed on the loop's own end first, so the top follows on from it.)
  if (ring) for (let i = Math.max(0, x.length - Math.round(rate * 0.25)); i < x.length; i += 1) y = (1 - k) * x[i]! + k * y;
  for (let i = 0; i < x.length; i += 1) { y = (1 - k) * x[i]! + k * y; x[i] = high ? x[i]! - y : y; }
  return x;
}
function bandpass<T extends Float32Array>(x: T, f0: number, q: number, rate: number): T {
  const w = (TAU * nyq(f0, rate)) / rate, alpha = Math.sin(w) / (2 * q);
  const b0 = alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) { const y = (b0 * x[i]! - b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]!; y2 = y1; y1 = y; x[i] = y; }
  return x;
}
const drive = (x: Float32Array, k: number): Float32Array => { const n = Math.tanh(k); for (let i = 0; i < x.length; i += 1) x[i] = Math.tanh(x[i]! * k) / n; return x; };
const normalize = <T extends Float32Array>(x: T, peak = 0.9): T => { let m = 1e-9; for (let i = 0; i < x.length; i += 1) m = Math.max(m, Math.abs(x[i]!)); const g = peak / m; for (let i = 0; i < x.length; i += 1) x[i]! *= g; return x; };
function sweep(x: Float32Array, hzAt: (t: number) => number, q: number, rate: number, type = "band"): Float32Array {
  let low = 0, band = 0;
  const damp = 1 / q;
  for (let i = 0; i < x.length; i += 1) {
    const f = 2 * Math.sin((Math.PI * Math.min(rate / 6.5, Math.max(20, hzAt(i / rate)))) / rate);
    low += f * band;
    const high = x[i]! - low - damp * band;
    band += f * high;
    x[i] = type === "low" ? low : type === "high" ? high : band;
  }
  return x;
}
const blep = (t: number, dt: number): number => { if (t < dt) { const u = t / dt; return u + u - u * u - 1; } if (t > 1 - dt) { const u = (t - 1) / dt; return u * u + u + u + 1; } return 0; };
function osc(x: Float32Array, rate: number, dur: number, hzAt: (t: number) => number, ampAt: (t: number) => number, shape = "sine", phase = 0, duty = 0.3): Float32Array {
  const i1 = Math.min(x.length, Math.round(dur * rate));
  let ph = phase - Math.floor(phase);
  for (let i = 0; i < i1; i += 1) {
    const t = i / rate, dt = nyq(hzAt(t), rate) / rate;
    let v: number;
    if (shape === "sine") v = Math.sin(TAU * ph);
    else if (shape === "tri") v = 1 - 4 * Math.abs(ph - 0.5);
    else if (shape === "saw") v = 2 * ph - 1 - blep(ph, dt);
    else { const d = shape === "square" ? 0.5 : duty; v = (ph < d ? 1 : -1) + blep(ph, dt) - blep((ph - d + 1) % 1, dt); }
    x[i]! += v * ampAt(t);
    ph += dt;
    if (ph >= 1) ph -= 1;
  }
  return x;
}
function formants(x: Float32Array, rate: number, fs: readonly number[], q: number, gains: readonly number[]): Samples {
  const out = new Float32Array(x.length), damp = 1 / q, low = [0, 0, 0], band = [0, 0, 0];
  const f = fs.map((v) => 2 * Math.sin((Math.PI * Math.min(rate / 6.5, v)) / rate));
  for (let i = 0; i < x.length; i += 1) {
    let y = 0;
    for (let k = 0; k < 3; k += 1) { low[k]! += f[k]! * band[k]!; const high = x[i]! - low[k]! - damp * band[k]!; band[k]! += f[k]! * high; y += band[k]! * gains[k]!; }
    out[i] = y;
  }
  return out;
}
/** x read faster at first and settling: a string's pitch falling into tune as it's struck. */
function bend(x: Float32Array, cents: number, settle: number, rate: number): Samples {
  const out = new Float32Array(x.length);
  let pos = 0;
  for (let i = 0; i < out.length; i += 1) {
    const j = Math.floor(pos), fr = pos - j;
    if (j + 1 >= x.length) break;
    out[i] = x[j]! * (1 - fr) + x[j + 1]! * fr;
    pos += 2 ** ((cents * Math.exp(-i / rate / settle)) / 1200);
  }
  return out;
}

// The design every song's instruments are made to (the soundtrack's: bright 0.55).
// (Lo-fi: a softer, rounder kick, a darker snare.)
const D = { bright: 0.75, bell: 7, kickHz: 48, kickDecay: 0.32, punch: 0.3, snareBody: 190, snareTone: 1900, snareDecay: 0.13, hatTone: 0.95 };
const made = (seed: number): Design => ({ ...D, seed }) as unknown as Design; // (the voices read only these)

type Key = (f: number, v: number, s: number, rate: number) => Float32Array;
// Struck and plucked keys: one note at f, velocity v (their own decay; the renderer cuts them at the note's end).
const KEYS: Record<string, Key> = {
  ...Object.fromEntries(["musicbox", "celesta", "kalimba", "vibes"].map((k): [string, Key] => [k, (f, v, s, rate) => ENGINE_KEYS[k]!(f, v, made(s), rate)])),
  // The twang: a steel string picked hard -- bright, a click of pick, sharp for an instant and falling into tune.
  twang: (f, v, s, rate) => {
    const x = pluck(f, v, 2.4, 0.9, 0.9975, rate, s);
    const r = noiseOf(s ^ 77);
    for (let i = 0; i < Math.round(0.004 * rate); i += 1) x[i]! += r() * 0.5 * v * (1 - i / (0.004 * rate));
    return onePole(bend(x, 28, 0.035, rate), 140, rate, true);
  },
  // The twang palm-muted: the same string, duller and dying quickly, a softer pick.
  mutetwang: (f, v, s, rate) => {
    const x = pluck(f, v, 1.1, 0.45, 0.992, rate, s);
    const r = noiseOf(s ^ 78);
    for (let i = 0; i < Math.round(0.003 * rate); i += 1) x[i]! += r() * 0.2 * v * (1 - i / (0.003 * rate));
    return onePole(onePole(bend(x, 18, 0.03, rate), 140, rate, true), 3600, rate);
  },
  // A warm electric piano: the engine's tine twice, a few cents apart, its bell softened.
  epiano: (f, v, s, rate) => {
    const a = ENGINE_KEYS.rhodes!(f * 2 ** (6 / 1200), v, made(s), rate), b = ENGINE_KEYS.rhodes!(f * 2 ** (-6 / 1200), v, made(s ^ 1), rate);
    for (let i = 0; i < a.length; i += 1) a[i] = (a[i]! + b[i]!) * 0.5;
    return onePole(a, 7000, rate);
  },
  // The same string damped low on the bridge: a plucked harpsichord-ish note, quick and dry.
  harp: (f, v, s, rate) => {
    const x = pluck(f, v, 1.2, 1, 0.994, rate, s ^ 5);
    const y = pluck(f * 2, v * 0.4, 1.2, 1, 0.992, rate, s ^ 9);
    for (let i = 0; i < x.length; i += 1) x[i]! += y[i]!;
    return onePole(x, 180, rate, true);
  },
};
const BASSES: Record<string, Key> = Object.fromEntries(["sub", "synth", "upright"].map((k): [string, Key] => [k, (f, v, s, rate) => BASS[k]!(f, v, made(s), rate)]));
// (The engine's drums are banded up to 9.5 kHz: below 32 kHz they're made at 44.1 and read down to the rate asked.)
const resample = (x: Float32Array, from: number, to: number): Samples => { const n = Math.max(1, Math.round((x.length * to) / from)), out = new Float32Array(n); for (let i = 0; i < n; i += 1) { const p = (i * from) / to, j = Math.floor(p), f = p - j; out[i] = (x[j] ?? 0) * (1 - f) + (x[j + 1] ?? 0) * f; } return out; };
type Drum = (s: number, rate: number, open?: boolean) => Float32Array;
type EngineDrum = (d: Design, rate: number, open?: boolean) => Samples;
const DRUMS: Record<string, Drum> = Object.fromEntries(Object.keys(ENGINE_DRUMS).map((k): [string, Drum] => {
  const make = (ENGINE_DRUMS as unknown as Record<string, EngineDrum>)[k]!;
  return [k, (s, rate, open) => rate >= 32000 ? make(made(s), rate, open) : resample(make(made(s), 44100, open), 44100, rate)];
}));
DRUMS.open = (s, rate) => DRUMS.hat!(s, rate, true);

// ---------------------------------------------------------------- the lo-fi room's instruments
// Warm, sampled-sounding voices for the normal rooms (lo-fi hip-hop): an FM Rhodes, a Wurli, a muted jazz
// guitar, a round bass and an upright, and a dusty kit -- each made once a note and kept, as a sampler would.

/** Bits and a held rate: a sampler's grit. */
function grit<T extends Float32Array>(x: T, bits: number, hold: number): T {
  const q = 2 ** (bits - 1);
  let v = 0;
  for (let i = 0; i < x.length; i += 1) { if (i % hold === 0) v = Math.round(x[i]! * q) / q; x[i] = v; }
  return x;
}
/**
 * A Rhodes: a hammer's thump, the tine's body (a sine pair, its bark -- the modulation -- harder the harder it's
 * struck, dying back to a round tone), the tine's ping (a fourteenth-ratio modulator, gone in a few hundredths),
 * and the pickup's lopsided swing, which gives the bark its even harmonics. Lower notes ring longer.
 */
function rhodes(f: number, v: number, s: number, rate: number): Samples {
  const tau = Math.max(0.7, Math.min(3.2, 1.7 * (261 / f) ** 0.45)), x = buf(rate, tau * 2.6 + 0.05), r = noiseOf(s ^ 0x5eed);
  const off = 0.1 + 0.1 * v, k = 1.6, c0 = Math.tanh(k * off);
  let thump = 0;
  for (let i = 0; i < x.length; i += 1) {
    const t = i / rate, w = TAU * f * t;
    const bark = (0.25 + 1.0 * v * v) * Math.exp(-t / 0.3) + 0.15;
    const body = Math.sin(w + bark * Math.sin(w));
    const ping = 0.22 * v * Math.exp(-t / 0.03) * Math.sin(14 * w + 1.5 * Math.sin(w));
    const oct = 0.07 * Math.exp(-t / 0.5) * Math.sin(2 * w);
    const env = (1 - Math.exp(-t / 0.0025)) * Math.exp(-t / tau);
    const y = (body + ping + oct) * env;
    thump = 0.9 * thump + 0.1 * r() * Math.exp(-t / 0.006);
    x[i] = (Math.tanh(k * (y * 0.7 + off)) - c0) + thump * 0.6 * v;
  }
  onePole(x, 30, rate, true);
  return onePole(x, 5000 + 4000 * v, rate);
}
/** A Wurli: reedier -- a sine pair driven harder and held longer at its bite, then clipped soft; quicker to die. */
function wurli(f: number, v: number, s: number, rate: number): Samples {
  const tau = Math.max(0.5, Math.min(2.2, 1.2 * (261 / f) ** 0.4)), x = buf(rate, tau * 2.6 + 0.05);
  for (let i = 0; i < x.length; i += 1) {
    const t = i / rate, w = TAU * f * t;
    const idx = (0.3 + 0.8 * v) * Math.exp(-t / 0.18) + 0.35;
    const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / tau);
    x[i] = Math.tanh(1.2 * env * (Math.sin(w + idx * Math.sin(w)) + 0.15 * Math.sin(3 * w)));
  }
  void s;
  return onePole(onePole(x, 40, rate, true), 5200, rate);
}
/** A muted jazz guitar: a dull string damped at the bridge, the thumb's thud, its body's middle. */
function mutedGuitar(f: number, v: number, s: number, rate: number): Samples {
  // (A palm-muted string as its partials: each higher one quieter and gone sooner, the pick's tick at the front.)
  const x = buf(rate, 0.9), r = noiseOf(s ^ 0x6a78);
  for (let k = 1; k <= 9; k += 1) {
    const fk = f * k * (1 + 0.0004 * k * k), a = (0.6 + 0.4 * v) / k ** 1.15, tau = 0.32 / k ** 0.8;
    if (fk > rate * 0.45) break;
    for (let i = 0; i < x.length; i += 1) { const t = i / rate; x[i]! += a * Math.sin(TAU * fk * t) * Math.exp(-t / tau); }
  }
  for (let i = 0; i < x.length; i += 1) { const t = i / rate; x[i] = x[i]! * (1 - Math.exp(-t / 0.002)) + r() * 0.12 * v * Math.exp(-t / 0.003) + 0.45 * v * Math.sin(TAU * 2500 * t) * Math.exp(-t / 0.003); }
  return onePole(onePole(x, 90, rate, true), 3200, rate);
}
/** A round bass: a sine and a little of its octave, soft at the front, a touch of drive; most of it below 300 Hz. */
function roundBass(f: number, v: number, _s: number, rate: number): Samples {
  const x = buf(rate, 2.2);
  for (let i = 0; i < x.length; i += 1) {
    const t = i / rate, w = TAU * f * t;
    const env = (1 - Math.exp(-t / 0.006)) * (0.55 + 0.45 * Math.exp(-t / 0.25)) * Math.exp(-t / 2.5);
    x[i] = Math.tanh(2.6 * env * (Math.sin(w) + (0.6 + 0.2 * Math.exp(-t / 0.15)) * Math.sin(2 * w) + 0.3 * Math.sin(3 * w) + 0.12 * Math.sin(4 * w)));
  }
  return onePole(x, 1100, rate);
}
/** An upright: the plucked string, round and short, its thump. */
function upright(f: number, v: number, s: number, rate: number): Samples {
  const x = pluck(f, v, 1.6, 0.18, 0.9975, rate, s ^ 0x7b1d);
  const y = buf(rate, 1.6);
  for (let i = 0; i < y.length; i += 1) { const t = i / rate; y[i] = Math.sin(TAU * f * t) * Math.exp(-t / 0.5) * 0.5 * v; }
  for (let i = 0; i < x.length; i += 1) x[i]! += y[i]!;
  return onePole(x, 900, rate);
}
/** A dusty kick: a skin dropping from a knock to its thump, a sub under it, a click on top -- driven, then dulled. */
function dustyKick(s: number, rate: number): Samples {
  const x = buf(rate, 0.55), r = noiseOf(s ^ 0x4b1c);
  let ph = 0, c = 0;
  for (let i = 0; i < x.length; i += 1) {
    const t = i / rate, fr = 56 + 120 * Math.exp(-t / 0.04);
    ph += (TAU * fr) / rate;
    const body = Math.sin(ph) * Math.exp(-t / 0.15);
    const sub = Math.sin(TAU * 47 * t) * Math.exp(-t / 0.16) * (1 - Math.exp(-t / 0.01));
    c = 0.6 * c + 0.4 * r();
    x[i] = Math.tanh(4 * (body + 0.06 * sub) + 0.6) - Math.tanh(0.6) + 0.63 * Math.sin(TAU * 3000 * t) * Math.exp(-t / 0.004) + c * 0.3 * Math.exp(-t / 0.004) + 0.7 * Math.sin(TAU * 180 * t) * Math.exp(-t / 0.04);
  }
  return grit(onePole(onePole(x, 30, rate, true), 3800, rate), 12, 1);
}
/** A dusty snare: its shell's two notes, the wires' hiss (banded, then a softer tail), driven, a sampler's grit. */
function dustySnare(s: number, rate: number): Samples {
  const x = buf(rate, 0.4), r = noiseOf(s ^ 0x5a4e), n1 = buf(rate, 0.4), n2 = buf(rate, 0.4);
  for (let i = 0; i < n1.length; i += 1) { const t = i / rate; const w = r(); n1[i] = w * Math.exp(-t / 0.075) * (1 - Math.exp(-t / 0.001)); n2[i] = w * Math.exp(-t / 0.04); }
  bandpass(n1, 3200, 0.7, rate); onePole(n2, 5200, rate);
  for (let i = 0; i < x.length; i += 1) {
    const t = i / rate;
    const shell = (Math.sin(TAU * 188 * t) * Math.exp(-t / 0.07) + 0.5 * Math.sin(TAU * 336 * t) * Math.exp(-t / 0.04)) * (1 - Math.exp(-t / 0.0015));
    x[i] = Math.tanh(1.8 * (0.7 * shell + 2.6 * n1[i]! + 1.2 * n2[i]!));
  }
  return grit(onePole(x, 7000, rate), 11, 2);
}
/** A rim: a wooden click. */
function dustyRim(s: number, rate: number): Samples {
  const x = buf(rate, 0.12), r = noiseOf(s ^ 0x7213);
  for (let i = 0; i < x.length; i += 1) { const t = i / rate; x[i] = (Math.sin(TAU * 820 * t) * 0.8 + Math.sin(TAU * 1730 * t) * 0.5) * Math.exp(-t / 0.018) + r() * 0.3 * Math.exp(-t / 0.002); }
  return grit(onePole(x, 6000, rate), 11, 2);
}
/** Hats, crunchy: metal and noise high-passed, short (or open), a few bits and a lower rate. */
function dustyHat(s: number, rate: number, open = false): Samples {
  const x = buf(rate, open ? 0.45 : 0.12), r = noiseOf(s ^ (open ? 0x4a70 : 0x4a71));
  const fs = [317, 433, 541, 619, 811, 1011];
  for (let i = 0; i < x.length; i += 1) {
    const t = i / rate;
    let m = 0; for (const fq of fs) m += Math.sign(Math.sin(TAU * fq * 2.1 * t));
    x[i] = (m / 6 * 0.4 + r()) * Math.exp(-t / (open ? 0.16 : 0.03)) * (1 - Math.exp(-t / 0.0008));
  }
  onePole(x, 6500, rate, true); onePole(x, 6500, rate, true);
  return onePole(grit(x, 8, Math.max(1, Math.round(rate / 16000))), 10000, rate);
}
Object.assign(KEYS, { rhodes, wurli, mutedgtr: mutedGuitar, vibes2: (f: number, v: number, s: number, rate: number): Samples => onePole(ENGINE_KEYS.vibes!(f, v, made(s), rate), 7500, rate) });
Object.assign(BASSES, { round: roundBass, upright2: upright });
Object.assign(DRUMS, { dkick: dustyKick, dsnare: dustySnare, drim: dustyRim, dhat: (s: number, rate: number) => dustyHat(s, rate), dopen: (s: number, rate: number) => dustyHat(s, rate, true) });

/** One note of a voice: a Float32Array from its attack, the note's length plus its release. */
function makeNote(voice: string, pitch: number, vel: number, dur: number, o: NightTrack, rate: number, seed: number, R: () => number): Float32Array {
  const f = hz(pitch);
  const env = (at: number, rel: number) => (t: number): number => Math.min(1, t / at) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel));
  if (KEYS[voice]) return normalize(KEYS[voice](f, vel, seed, rate), 0.8);
  if (BASSES[voice]) return normalize(BASSES[voice](f, vel, seed, rate), 0.9);
  if (DRUMS[voice]) return normalize(DRUMS[voice](seed, rate), 0.9);
  // An organ: drawbars, held as long as the note (its release the track's).
  if (voice === "organ") {
    const rel = o.release ?? 0.4, x = partials(buf(rate, dur + rel), rate, [[f, 0.8, 30, 0, 0.02], [f * 2, 0.45, 30, 0, 0.02], [f * 3, 0.25 * (0.5 + D.bright), 30, 0, 0.02], [f * 4, 0.12, 30, 0, 0.02], [f / 2, 0.3, 30, 0, 0.02]], vel);
    const n0 = Math.round(dur * rate);
    for (let i = n0; i < x.length; i += 1) x[i]! *= 1 - (i - n0) / (x.length - n0);
    return normalize(x, 0.8);
  }
  if (voice === "pulse") { const rel = 0.08, x = buf(rate, dur + rel); osc(x, rate, dur + rel, () => f, (t) => Math.min(1, t / 0.004) * (t < dur ? 1 - 0.25 * Math.min(1, t / 0.4) : Math.max(0, 1 - (t - dur) / rel) * 0.75) * 0.5, "pulse", 0, o.duty ?? 0.25); return x; }
  if (voice === "saw-pad") {
    const at = o.attack ?? 0.6, rel = o.release ?? 1.4, x = buf(rate, dur + rel), e = env(at, rel);
    for (const d of [-0.11, 0, 0.13]) osc(x, rate, dur + rel, (t) => f * 2 ** (d / 12) * (1 + 0.002 * Math.sin(TAU * 5.1 * t)), (t) => e(t) * 0.3, "saw", R() * 0.5 + 0.5);
    return sweep(x, () => Math.min(9000, f * (o.cutoff ?? 5)), 0.8, rate, "low");
  }
  if (voice === "choir") {
    const at = o.attack ?? 0.5, rel = o.release ?? 1.6, x = buf(rate, dur + rel), e = env(at, rel);
    for (const d of [-0.08, 0, 0.07, 12.02]) osc(x, rate, dur + rel, (t) => f * 2 ** (d / 12) * (1 + 0.004 * Math.sin(TAU * (5.2 + d) * t)), (t) => e(t) * (d > 11 ? 0.12 : 0.28), "saw", R() * 0.5 + 0.5);
    return normalize(formants(x, rate, [330, 760, 2450], 9, [1, 0.55, 0.12]), 0.6);
  }
  // A flute: a breathy sine, its chiff at the front, a vibrato that comes in late.
  if (voice === "flute") {
    const rel = 0.12, x = buf(rate, dur + rel), e = (t: number): number => Math.min(1, t / 0.035) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel));
    osc(x, rate, dur + rel, (t) => f * (1 + 0.0087 * Math.sin(TAU * 5 * t) * Math.min(1, Math.max(0, (t - 0.25) / 0.3))), (t) => e(t) * 0.5, "sine");
    osc(x, rate, dur + rel, () => f * 2, (t) => e(t) * 0.06, "sine");
    osc(x, rate, dur + rel, () => f * 3, (t) => e(t) * 0.065, "sine");
    const n = buf(rate, dur + rel);
    for (let i = 0; i < n.length; i += 1) { const t = i / rate; n[i] = R() * (e(t) * 0.09 + 0.6 * Math.exp(-t / 0.04)); }
    bandpass(n, 3500, 0.8, rate); // (the breath, 2-6 kHz, under it all through; the chiff at the front)
    for (let i = 0; i < x.length; i += 1) x[i]! += n[i]!;
    return onePole(x, 7000, rate);
  }
  if (voice === "theremin") {
    const rel = 0.5, x = buf(rate, dur + rel), e = (t: number): number => Math.min(1, t / 0.12) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / rel));
    osc(x, rate, dur + rel, (t) => f * (1 + 0.012 * Math.sin(TAU * 5.6 * t) * Math.min(1, t / 0.35)), (t) => e(t) * 0.55, "sine");
    osc(x, rate, dur + rel, () => f * 2, (t) => e(t) * 0.08, "sine");
    return x;
  }
  if (voice === "drone") {
    const at = o.attack ?? 1.5, rel = o.release ?? 2.5, x = buf(rate, dur + rel), e = env(at, rel);
    osc(x, rate, dur + rel, () => f, (t) => e(t) * 0.6, "sine");
    osc(x, rate, dur + rel, () => f * 1.003, (t) => e(t) * 0.25, "tri");
    const n = buf(rate, dur + rel);
    for (let i = 0; i < n.length; i += 1) n[i] = R() * e(i / rate) * 0.25;
    sweep(n, (t) => f * 4 + f * 2 * Math.sin(TAU * 0.13 * t), 6, rate, "band");
    for (let i = 0; i < x.length; i += 1) x[i]! += n[i]!;
    return x;
  }
  if (voice === "glass") return normalize(partials(buf(rate, 3), rate, [[f, 1, 1.6], [f * 2.0, 0.3, 0.9], [f * 3.01, 0.18, 0.5], [f * 4.95, 0.1, 0.25, 0, 0.001]], vel), 0.6);
  if (voice === "bell") return normalize(partials(buf(rate, 6), rate, [[f, 1, 3.2], [f * 2.76, 0.45, 1.6], [f * 5.4, 0.28, 0.7], [f * 8.93, 0.12, 0.3, 0, 0.001], [f * 0.5, 0.3, 4]], vel), 0.8);
  // The air outside: a bed of noise the length of the note, its colour by kind (pitch unused).
  if (voice === "rain" || voice === "sea" || voice === "wind") {
    const at = o.attack ?? 2, rel = o.release ?? 2, x = buf(rate, dur + rel), e = env(at, rel);
    let b = 0;
    for (let i = 0; i < x.length; i += 1) { b = 0.97 * b + R() * 0.12; x[i] = (voice === "rain" ? R() : b) * e(i / rate); }
    if (voice === "rain") { bandpass(x, 2600, 0.5, rate); for (let i = 0; i < x.length; i += 1) if (R() > 0.9996) x[i]! += R() * 0.6; }
    else if (voice === "sea") sweep(x, (t) => 500 + 380 * Math.sin((TAU * t) / Math.max(4, dur / 2)), 0.7, rate, "low");
    else sweep(x, (t) => 520 + 260 * Math.sin(TAU * 0.11 * t), 4, rate, "band");
    return normalize(x, 0.5);
  }
  throw new TypeError(`no voice ${voice}`);
}
const STRUCK = (v: string): boolean => Boolean(KEYS[v] || BASSES[v]);

// Freeverb: eight combs and four allpasses a channel, the right a little apart.
function reverb(x: Float32Array, rate: number, { size = 0.86, damp = 0.3 }: { readonly size?: number; readonly damp?: number } = {}, spread = 0): Samples {
  const k = rate / 44100, out = new Float32Array(x.length);
  for (const c of [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]) {
    const n = Math.round((c + spread) * k), b = new Float32Array(n);
    let i = 0, store = 0;
    for (let j = 0; j < x.length; j += 1) { const y = b[i]!; store = y * (1 - damp) + store * damp; b[i] = x[j]! * 0.015 + store * size; out[j]! += y; if (++i >= n) i = 0; }
  }
  for (const a of [556, 441, 341, 225]) {
    const n = Math.round((a + spread) * k), b = new Float32Array(n);
    let i = 0;
    for (let j = 0; j < x.length; j += 1) { const v = b[i]!, y = -out[j]! + v; b[i] = out[j]! + v * 0.5; out[j] = y; if (++i >= n) i = 0; }
  }
  return out;
}

/**
 * The record, on the whole mix, round the ring: soft saturation, a few bits and a lower rate (held), the tape's wow
 * and flutter (whole cycles a loop, so the join is clean), the top rolled off, the image narrowed, hiss and crackle.
 */
function record(L: Float32Array, Rt: Float32Array, o: NightLofi, rate: number, seed: number, loopSec: number): void {
  const N = L.length;
  let e = 0;
  for (let i = 0; i < N; i += 1) e += L[i]! * L[i]! + Rt[i]! * Rt[i]!;
  const rms = Math.sqrt(e / (2 * N)) || 1e-9, pre = 0.25 / rms, k = o.drive, tk = Math.tanh(k);
  const hold = Math.max(1, Math.round(rate / o.hold)), q = 2 ** (o.bits - 1);
  for (const ch of [L, Rt]) {
    if (hold > 1) { onePole(ch, (0.42 * rate) / hold, rate, false, true); onePole(ch, (0.42 * rate) / hold, rate, false, true); } // (no images off the lower rate)
    let held = 0;
    for (let i = 0; i < N; i += 1) {
      if (i % hold === 0) { const u = Math.tanh(ch[i]! * pre * k) / tk; held = Math.round(u * q) / q; }
      ch[i] = held / pre;
    }
    if (hold > 1) { onePole(ch, (0.42 * rate) / hold, rate, false, true); onePole(ch, (0.42 * rate) / hold, rate, false, true); } // (and none after it)
    // (A little air back in the presence, as a record's mastering would: the top above 2.5 kHz up a few dB, before the tape takes it.)
    const air = Float32Array.from(ch); onePole(air, 2500, rate, true, true); for (let i = 0; i < N; i += 1) ch[i]! += air[i]! * 0.6;
  }
  // (Wow and flutter: the tape read through a delay that swings, a whole number of cycles round the loop.)
  const cyc = (hz: number): number => Math.max(1, Math.round(hz * loopSec));
  const kw = cyc(o.wow), kf = cyc(o.flutter), aw = (o.wowDepth / 1000) * rate, af = (o.flutterDepth / 1000) * rate, base = aw + af + 2;
  const P = noiseOf((seed ^ 0x7a9e) >>> 0), pw = P() * TAU, pf = P() * TAU;
  for (const ch of [L, Rt]) {
    const x = Float32Array.from(ch);
    for (let i = 0; i < N; i += 1) {
      const d = base + aw * Math.sin((TAU * kw * i) / N + pw) + af * Math.sin((TAU * kf * i) / N + pf);
      const pos = i - d, j = Math.floor(pos), fr = pos - j;
      ch[i] = x[mod(j, N)]! * (1 - fr) + x[mod(j + 1, N)]! * fr;
    }
    onePole(ch, o.cutoff, rate, false, true);
    onePole(ch, o.cutoff * 1.4, rate, false, true);
  }
  // (Mono-ish: the sides taken down.)
  for (let i = 0; i < N; i += 1) { const m = (L[i]! + Rt[i]!) / 2, sd = ((L[i]! - Rt[i]!) / 2) * o.width; L[i] = m + sd; Rt[i] = m - sd; }
  // (Hiss under it, crackle on it: quiet, the seed's.)
  const H = noiseOf((seed ^ 0x51ce) >>> 0), C = noiseOf((seed ^ 0xc4ac) >>> 0);
  const hiss = new Float32Array(N), hiss2 = new Float32Array(N);
  for (let i = 0; i < N; i += 1) { hiss[i] = H(); hiss2[i] = H(); }
  for (const h of [hiss, hiss2]) { onePole(h, 450, rate, true, true); onePole(h, 4500, rate, false, true); } // (the groove's bed: a vinyl's, in the middle)
  let he = 0; for (let i = 0; i < N; i += 1) he += hiss[i]! * hiss[i]!;
  const hg = (rms * 10 ** (-40 / 20) * o.hiss) / (Math.sqrt(he / N) || 1e-9);
  for (let i = 0; i < N; i += 1) { L[i]! += hiss[i]! * hg; Rt[i]! += (hiss[i]! * 0.6 + hiss2[i]! * 0.4) * hg; }
  const pops = Math.round(o.crackle * loopSec), len = Math.max(2, Math.round(0.0015 * rate));
  for (let p = 0; p < pops; p += 1) {
    const at = Math.floor(C() * 0.5 * N + 0.5 * N) % N, a = rms * 10 ** (-22 / 20) * (0.3 + 1.4 * Math.abs(C())) * (C() < 0 ? -1 : 1), side = 0.7 + 0.3 * C();
    for (let i = 0; i < len; i += 1) { const v = a * Math.exp(-i / (len / 3)) * (i % 2 ? -0.6 : 1); L[(at + i) % N]! += v; Rt[(at + i) % N]! += v * side; }
  }
}
const mod = (a: number, n: number): number => ((a % n) + n) % n;
/** The section filter: a low-pass whose corner follows [beat, Hz] points (log-linear between, round the ring), two poles. */
function sweepLow(x: Float32Array, pts: readonly (readonly [number, number])[], spb: number): void {
  const N = x.length, P = [...pts].sort((a, b) => a[0] - b[0]);
  const hzAt = new Float32Array(N);
  for (let j = 0; j < P.length; j += 1) {
    const [b0, h0] = P[j]!, [b1raw, h1] = P[(j + 1) % P.length]!, b1 = j + 1 < P.length ? b1raw : b1raw + N / spb;
    const i0 = Math.round(b0 * spb), i1 = Math.round(b1 * spb);
    for (let i = i0; i < i1; i += 1) hzAt[mod(i, N)] = Math.exp(Math.log(h0) + (Math.log(h1) - Math.log(h0)) * ((i - i0) / Math.max(1, i1 - i0)));
  }
  const rate = spb; void rate;
  let y1 = 0, y2 = 0;
  for (let pass = 0; pass < 2; pass += 1) for (let i = 0; i < N; i += 1) {
    const k = Math.exp((-TAU * Math.min(hzAt[i]!, 20000)) / (spb * 0 + RATE_OF.get(x)!));
    y1 = (1 - k) * x[i]! + k * y1; y2 = (1 - k) * y1 + k * y2;
    if (pass) x[i] = y2;
  }
}
const RATE_OF = new WeakMap<Float32Array, number>();

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** One loop of a nocturne's song, stereo. */
export interface NightRender { readonly left: Samples; readonly right: Samples; readonly rate: number; readonly seconds: number }

/**
 * One loop of a song, stereo, at `rate`: { left, right, rate, seconds }. The
 * notes are laid round a ring the loop's length (a tail past the end rings on
 * at the top), the room is played in with the loop's own end before it, and
 * the mix is levelled and held under -1 dBFS. `yieldEvery` (ms) lets a page
 * breathe between tracks.
 */
export async function renderNightSong(song: NightSong, { rate = 48000, yieldEvery = 0 }: { readonly rate?: number; readonly yieldEvery?: number } = {}): Promise<NightRender> {
  const beat = 60 / song.bpm, N = Math.round(song.totalBeats * beat * rate);
  const seed = song.seed ?? 31, R = noiseOf(seed ^ 0x9e37);
  const L = new Float32Array(N), Rt = new Float32Array(N), wet = new Float32Array(N);
  const focus: { st: Float32Array; gl: number; gr: number; send: number }[] = [];
  const cache = new Map<string, Float32Array>();
  let t0 = Date.now();
  // (The pump: each pumped track ducked under every kick, recovering over a fifth of a second, round the ring.)
  const kicks = song.tracks.find((x) => x.id === "kick")?.notes ?? [];
  let duck: Float32Array | null = null;
  const duckOf = (): Float32Array => {
    if (duck) return duck;
    const since = new Float32Array(N).fill(1e9);
    for (const n of kicks) { const i0 = Math.round(n.beat * beat * rate) % N; const span = Math.round(0.8 * rate); for (let i = 0; i < span; i += 1) { const j = (i0 + i) % N; since[j] = Math.min(since[j]!, i / rate); } }
    duck = new Float32Array(N);
    for (let i = 0; i < N; i += 1) { const t = since[i]!; duck[i] = t > 0.79 ? 0 : t < 0.01 ? t / 0.01 : Math.exp(-(t - 0.01) / 0.16); }
    return duck;
  };
  for (const t of song.tracks) {
    const st = new Float32Array(N);
    for (const n of t.notes) {
      const dur = n.beats * beat, v = n.vel ?? 0.8;
      const key = `${t.voice}|${n.pitch}|${Math.round(v * 8)}|${STRUCK(t.voice) || DRUMS[t.voice] ? "" : Math.round(dur * 100)}|${t.attack ?? ""}|${t.release ?? ""}|${t.duty ?? ""}`;
      let x = cache.get(key);
      if (!x) { x = makeNote(t.voice, n.pitch ?? 60, v, dur, t, rate, (seed * 31 + (n.pitch ?? 60)) >>> 0, R); cache.set(key, x); }
      // (Struck keys and basses ring their own way: cut at the note's end, a short release, so lines stay tight.)
      if (STRUCK(t.voice) && t.cut !== false) {
        const end = Math.round((dur + (t.release ?? 0.12)) * rate), fade = Math.round((t.release ?? 0.12) * rate);
        if (end < x.length) { x = x.slice(0, end); for (let i = 0; i < fade; i += 1) x[end - 1 - i]! *= i / fade; }
      }
      const g = v * (t.gain ?? 1), i0 = Math.round(n.beat * beat * rate);
      for (let i = 0; i < x.length; i += 1) st[(i0 + i) % N]! += x[i]! * g;
      // (A slap-back off the twang's spring: two echoes, quieter and darker.)
      if (t.slap) for (const [d, a] of [[t.slap, 0.32], [2 * t.slap, 0.12]] as const) { const j0 = i0 + Math.round(d * rate); for (let i = 0; i < x.length; i += 1) st[(j0 + i) % N]! += x[i]! * g * a; }
    }
    if (t.highpass) onePole(st, t.highpass, rate, true, true);
    if (t.lowpass) onePole(st, t.lowpass, rate, false, true);
    if (t.drive) drive(st, t.drive);
    if (t.presence) { const pr = Float32Array.from(st); bandpass(pr, 3200, 0.7, rate); for (let i = 0; i < N; i += 1) st[i]! += pr[i]! * t.presence; } // (the 2-5 kHz shimmer lifted)
    if (t.crush) grit(st, t.crush, Math.max(1, Math.round(rate / 22050)));
    if (t.pump && kicks.length) { const dk = duckOf(); for (let i = 0; i < N; i += 1) st[i]! *= 1 - t.pump * dk[i]!; }
    // (A tape echo: dotted eighths, darker each time round, wrapping round the loop like everything else.)
    if (t.echo) { const d = Math.round(0.75 * beat * rate), e = Float32Array.from(st); for (let k = 1; k <= 4; k += 1) { onePole(e, 3000, rate, false, true); const a = t.echo * 0.45 ** (k - 1); for (let i = 0; i < N; i += 1) st[(i + d * k) % N]! += e[i]! * a; } }
    const p = t.pan ?? 0, gl = Math.cos(((p + 1) * Math.PI) / 4), gr = Math.sin(((p + 1) * Math.PI) / 4), send = t.reverb ?? 0;
    if (t.tremolo) {
      // (The Rhodes's tremolo: an auto-pan, whole cycles a loop.)
      const k = Math.max(1, Math.round(t.tremolo.hz * (N / rate))), dp = t.tremolo.depth;
      for (let i = 0; i < N; i += 1) { const v = st[i]!, m = Math.sin((TAU * k * i) / N) * dp; L[i]! += v * gl * (1 - m); Rt[i]! += v * gr * (1 + m); if (send) wet[i]! += v * send; }
    } else for (let i = 0; i < N; i += 1) { const v = st[i]!; L[i]! += v * gl; Rt[i]! += v * gr; if (send) wet[i]! += v * send; }
    if (song.focus?.ids?.includes(t.id)) focus.push({ st, gl, gr, send });
    if (yieldEvery && Date.now() - t0 > yieldEvery) { await tick(); t0 = Date.now(); }
  }
  // (The tune kept in front and not on top: the focus tracks brought to their share of the mix.)
  if (focus.length) {
    let ef = 0, et = 0;
    for (let i = 0; i < N; i += 1) { let f = 0; for (const x of focus) f += x.st[i]!; ef += f * f; et += (L[i]! * L[i]! + Rt[i]! * Rt[i]!) / 2; }
    const share = song.focus?.share ?? 0.12, most = song.focus?.most ?? 1, ratio = ef / (et || 1e-12);
    if (ratio < share || ratio > most) {
      // (Up to share, or down to most: the tune's part of the whole, 6 dB either way at most.)
      const k = Math.max(0.5, Math.min(2, Math.sqrt((ratio < share ? share : most) / Math.max(ratio, 1e-9)))) - 1;
      for (const x of focus) for (let i = 0; i < N; i += 1) { const v = x.st[i]! * k; L[i]! += v * x.gl; Rt[i]! += v * x.gr; if (x.send) wet[i]! += v * x.send; }
    }
  }
  // The room, played in with the loop's own last seconds before it, so its tail at the top is the loop's.
  const pre = Math.min(N, Math.round(4 * rate)), ring = new Float32Array(pre + N);
  ring.set(wet.subarray(N - pre), 0);
  ring.set(wet, pre);
  const verb = song.reverb ?? { size: 0.86, damp: 0.3 };
  const wl = reverb(ring, rate, verb, 0);
  if (yieldEvery) await tick();
  const wr = reverb(ring, rate, verb, 23);
  for (let i = 0; i < N; i += 1) { L[i]! += wl[pre + i]!; Rt[i]! += wr[pre + i]!; }
  // (A shelf off the top, if the song asks: the air above it taken down, round the ring like every filter here.)
  if (song.shelf && !song.lofi) for (const ch of [L, Rt]) { const h = Float32Array.from(ch); onePole(h, song.shelf.hz ?? 6000, rate, true, true); for (let i = 0; i < N; i += 1) ch[i]! -= h[i]! * (song.shelf.cut ?? 0.5); }
  if (song.sweep?.length) for (const ch of [L, Rt]) { RATE_OF.set(ch, rate); sweepLow(ch, song.sweep, beat * rate); }
  if (song.mud) for (const ch of [L, Rt]) { const b = Float32Array.from(ch); bandpass(b, 210, 0.8, rate); for (let i = 0; i < N; i += 1) ch[i]! -= b[i]! * song.mud; } // (the 150-300 Hz mud cut)
  if (song.lofi) record(L, Rt, song.lofi, rate, seed, beat * song.totalBeats);
  // Levelled to the soundtrack's bed, then a look-ahead limiter (5 ms ahead) to -1 dBFS, going round.
  let e = 0;
  for (let i = 0; i < N; i += 1) e += L[i]! * L[i]! + Rt[i]! * Rt[i]!;
  // (A musicRms of 0 leaves the level as played: for measuring one part against another.)
  const g0 = song.musicRms === 0 ? 1 : (song.musicRms ?? 0.11) / (Math.sqrt(e / (2 * N)) || 1e-9);
  const ceil = 0.89, ahead = Math.round(0.005 * rate), rel = Math.exp(-1 / (0.15 * rate));
  const need = new Float32Array(N);
  for (let i = 0; i < N; i += 1) { const v = Math.max(Math.abs(L[i]!), Math.abs(Rt[i]!)) * g0; need[i] = v > ceil ? ceil / v : 1; }
  const gain = new Float32Array(N);
  // (A sliding minimum over the next `ahead` samples, round the ring: a deque of indices.)
  const q = new Int32Array(N + ahead + 1);
  let qh = 0, qt = 0;
  for (let j = N + ahead - 1; j >= 0; j -= 1) {
    const v = need[j % N]!;
    while (qt > qh && need[q[qt - 1]! % N]! >= v) qt -= 1;
    q[qt++] = j;
    while (q[qh]! > j + ahead) qh += 1;
    if (j < N) gain[j] = need[q[qh]! % N]!;
  }
  // (The release runs round twice, so the gain at the top is the one the end leaves.)
  let cur = 1;
  for (let pass = 0; pass < 2; pass += 1) for (let i = 0; i < N; i += 1) { cur = gain[i]! < cur ? gain[i]! : Math.min(gain[i]!, 1 - (1 - cur) * rel); if (pass) { L[i]! *= g0 * cur; Rt[i]! *= g0 * cur; } }
  return { left: L, right: Rt, rate, seconds: N / rate };
}

/** Every voice a nocturne's song may name. */
export const NIGHT_VOICES: readonly string[] = [...Object.keys(KEYS), ...Object.keys(BASSES), ...Object.keys(DRUMS), "organ", "pulse", "saw-pad", "choir", "theremin", "drone", "glass", "bell", "rain", "sea", "wind"];
