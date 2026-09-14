// The small synthesis kit the battle audio is made with (src/battle.ts,
// src/voice.ts): buffers, noise bursts, swept filters, struck skins, bubbles,
// oscillators that follow a pitch contour, formant filters, and the finish
// every sound gets (worn to the style, faded, normalised so it never clips).
// Plain code on Float32Arrays: it runs in Node. (sfx.ts keeps its own copies
// of a few of these, untouched: its sounds are pinned bit for bit.)

import { bandpass, noiseOf, normalize, onePole, partials, wear } from "./samples.ts";
import type { PartialSpec, Samples } from "./samples.ts";

export const TAU = Math.PI * 2;
export type Rnd = () => number;
export type Env = (t: number) => number;

export { noiseOf, normalize, onePole, partials };
export type { PartialSpec, Samples };

/** A silent buffer `sec` long. */
export const buf = (rate: number, sec: number): Samples => new Float32Array(Math.max(1, Math.round(rate * sec)));
export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);
/** Attack `a` then an exponential decay `d` (seconds). */
export const env = (a: number, d: number): Env => (t) => (t < a ? t / a : Math.exp(-(t - a) / d));
const nyq = (hz: number, rate: number): number => Math.max(10, Math.min(hz, rate * 0.45));

/** A band-pass (the samples' biquad) that never asks for more than the rate can hold. */
export const bp = <T extends Float32Array>(x: T, f: number, q: number, rate: number): T => bandpass(x, nyq(f, rate), q, rate);
export const lp = <T extends Float32Array>(x: T, f: number, rate: number): T => onePole(x, nyq(f, rate), rate);
export const hp = <T extends Float32Array>(x: T, f: number, rate: number): T => onePole(x, nyq(f, rate), rate, true);

/** A state-variable filter whose cutoff follows `hzAt(t)`. */
export function sweep(x: Samples, hzAt: Env, q: number, rate: number, type: "band" | "low" | "high" = "band"): Samples {
  let low = 0;
  let band = 0;
  const damp = 1 / q;
  for (let i = 0; i < x.length; i += 1) {
    const f = 2 * Math.sin(Math.PI * Math.min(rate / 6.5, Math.max(20, hzAt(i / rate))) / rate);
    low += f * band;
    const high = x[i]! - low - damp * band;
    band += f * high;
    x[i] = type === "low" ? low : type === "high" ? high : band;
  }
  return x;
}

/** Noise shaped by an envelope, added into x from t0 (stops once the envelope has died). */
export function burst(x: Samples, rate: number, rnd: Rnd, t0: number, e: Env, amp = 1, until = Infinity): Samples {
  const i0 = Math.max(0, Math.round(t0 * rate));
  const i1 = Math.min(x.length, until === Infinity ? x.length : i0 + Math.round(until * rate));
  for (let i = i0; i < i1; i += 1) {
    const v = e((i - i0) / rate);
    if (v < 1e-4 && i > i0 + rate * 0.01) break;
    x[i]! += rnd() * v * amp;
  }
  return x;
}

/** A bubble: a sine that rises as it rings. */
export function bubble(x: Samples, rate: number, t0: number, f0: number, dur: number, amp: number): Samples {
  const i0 = Math.max(0, Math.round(t0 * rate));
  let ph = 0;
  for (let i = i0; i < Math.min(x.length, i0 + Math.round(dur * 4 * rate)); i += 1) {
    const t = (i - i0) / rate;
    ph += (TAU * nyq(f0 * (1 + (2.2 * t) / dur), rate)) / rate;
    x[i]! += Math.sin(ph) * amp * Math.exp(-t / dur) * Math.min(1, t / 0.002);
  }
  return x;
}

/** A thump: a skin whose note drops from `hi` to `lo` as it's struck. */
export function thump(x: Samples, rate: number, t0: number, hi: number, lo: number, decay: number, amp: number, drop = 0.03): Samples {
  const i0 = Math.max(0, Math.round(t0 * rate));
  let ph = 0;
  for (let i = i0; i < x.length; i += 1) {
    const t = (i - i0) / rate;
    const e = Math.exp(-t / decay);
    if (e < 1e-4) break;
    ph += (TAU * (lo + (hi - lo) * Math.exp(-t / drop))) / rate;
    x[i]! += Math.sin(ph) * e * amp * Math.min(1, t / 0.001);
  }
  return x;
}

export type Shape = "sine" | "saw" | "square" | "pulse" | "tri";
// (PolyBLEP: the saw's and square's steps rounded off, so high notes don't fold back as much.)
const blep = (t: number, dt: number): number => {
  if (t < dt) { const u = t / dt; return u + u - u * u - 1; }
  if (t > 1 - dt) { const u = (t - 1) / dt; return u * u + u + u + 1; }
  return 0;
};
/** An oscillator following a pitch contour `hzAt(t)` and a level `ampAt(t)`, added into x from t0 for `dur`. */
export function osc(x: Samples, rate: number, t0: number, dur: number, hzAt: Env, ampAt: Env, shape: Shape = "sine", phase = 0, duty = 0.3): Samples {
  const i0 = Math.max(0, Math.round(t0 * rate));
  const i1 = Math.min(x.length, i0 + Math.round(dur * rate));
  let ph = phase - Math.floor(phase);
  for (let i = i0; i < i1; i += 1) {
    const t = (i - i0) / rate;
    const dt = nyq(hzAt(t), rate) / rate;
    let v: number;
    if (shape === "sine") v = Math.sin(TAU * ph);
    else if (shape === "tri") v = 1 - 4 * Math.abs(ph - 0.5);
    else if (shape === "saw") v = 2 * ph - 1 - blep(ph, dt);
    else {
      const d = shape === "square" ? 0.5 : duty;
      v = (ph < d ? 1 : -1) + blep(ph, dt) - blep((ph - d + 1) % 1, dt);
    }
    x[i]! += v * ampAt(t);
    ph += dt;
    if (ph >= 1) ph -= 1;
  }
  return x;
}

/** y into x (from sample `at`), scaled. */
export const add = (x: Samples, y: Float32Array, g = 1, at = 0): Samples => {
  const o = Math.max(0, Math.round(at));
  for (let i = 0; i < y.length && i + o < x.length; i += 1) x[i + o]! += y[i]! * g;
  return x;
};
/** Soft saturation (tanh), level kept. */
export const saturate = (x: Samples, k: number): Samples => { const n = Math.tanh(k); for (let i = 0; i < x.length; i += 1) x[i] = Math.tanh(x[i]! * k) / n; return x; };
/** Fewer bits and held samples (the digital grain). */
export const crush = (x: Samples, bits: number, hold: number): Samples => {
  const q = 2 ** (bits - 1);
  let held = 0;
  for (let i = 0; i < x.length; i += 1) { if (i % hold === 0) held = Math.round(x[i]! * q) / q; x[i] = held; }
  return x;
};
/** The last `sec` faded to silence. */
export const fadeOut = (x: Samples, rate: number, sec: number): Samples => {
  const n = Math.min(x.length, Math.round(sec * rate));
  for (let i = 0; i < n; i += 1) x[x.length - 1 - i]! *= i / n;
  return x;
};

/**
 * Formants: the excitation through three band-passes (state-variable) whose
 * centres follow `fAt(t)` -> [F1, F2, F3], summed with `gains`, `q` sharp.
 */
export function formants(x: Samples, rate: number, fAt: (t: number) => readonly number[], q: number, gains: readonly number[] = [1, 0.7, 0.35]): Samples {
  const out = new Float32Array(x.length);
  const damp = 1 / q;
  const low = [0, 0, 0];
  const band = [0, 0, 0];
  for (let i = 0; i < x.length; i += 1) {
    const fs = fAt(i / rate);
    let y = 0;
    for (let k = 0; k < 3; k += 1) {
      const f = 2 * Math.sin(Math.PI * Math.min(rate / 6.5, Math.max(40, fs[k]!)) / rate);
      low[k]! += f * band[k]!;
      const high = x[i]! - low[k]! - damp * band[k]!;
      band[k]! += f * high;
      y += band[k]! * gains[k]!;
    }
    out[i] = y;
  }
  return out;
}

/** Made to repeat: the tail crossfaded over the head (equal power), so the end runs into the start. */
export function loopify(x: Samples, rate: number, fade: number): Samples {
  const F = Math.min(Math.round(fade * rate), x.length >> 1);
  const L = x.length - F;
  const out = x.slice(0, L);
  for (let i = 0; i < F; i += 1) { const a = (i / F) * (Math.PI / 2); out[i] = x[i]! * Math.sin(a) + x[L + i]! * Math.cos(a); }
  return out;
}

/** How a style wears the battle sounds. */
export interface BattleWear { readonly bits: number; readonly hold: number; readonly top: number }
export type BattleStyleName = "clean" | "lofi" | "chip" | "soft";
export const BATTLE_STYLES: Readonly<Record<BattleStyleName, BattleWear>> = {
  clean: { bits: 16, hold: 1, top: 16000 },
  lofi: { bits: 12, hold: 1, top: 9000 },
  chip: { bits: 7, hold: 2, top: 8000 },
  soft: { bits: 14, hold: 1, top: 5000 },
};
/** A style's wear: a preset's name ("clean" when unknown) or the fields themselves. */
export const wearOf = (style: BattleStyleName | string | Partial<BattleWear> | undefined): BattleWear =>
  typeof style === "object" && style ? { ...BATTLE_STYLES.clean, ...style } : ((BATTLE_STYLES as Record<string, BattleWear>)[style ?? "clean"] ?? BATTLE_STYLES.clean);

const quiet = (): number => 0;
const clean = (x: Samples): Samples => { for (let i = 0; i < x.length; i += 1) if (!Number.isFinite(x[i]!)) x[i] = 0; return x; };
/**
 * A one-shot's finish: DC off, worn to the style, the last `tail` seconds
 * faded out, any stray non-number zeroed, normalised to `peak` (< 1: it never
 * clips).
 */
export function finish(x: Samples, rate: number, w: BattleWear, peak: number, tail = 0.015): Samples {
  clean(x);
  hp(x, 25, rate);
  wear(x, rate, { bits: w.bits, hold: w.hold, top: Math.min(rate / 2.3, w.top), dust: 0 }, quiet);
  fadeOut(x, rate, tail);
  return normalize(clean(x), peak);
}
/** A loop's finish: DC off, worn, then made to repeat (the wear's filter start crossfaded away), normalised. */
export function finishLoop(x: Samples, rate: number, w: BattleWear, peak: number, fade: number): Samples {
  clean(x);
  hp(x, 25, rate);
  wear(x, rate, { bits: w.bits, hold: w.hold, top: Math.min(rate / 2.3, w.top), dust: 0 }, quiet);
  return normalize(clean(loopify(x, rate, fade)), peak);
}
/** A frequency rounded to a whole number of cycles in `len` seconds (a loop's partials come round with it). */
export const whole = (f: number, len: number): number => Math.max(1, Math.round(f * len)) / len;
