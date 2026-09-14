// Sound effects for games, all made in code and all seeded: a project's seed
// picks its SOUND PALETTE (the way it picks colours) -- the shoes (sneaker,
// boot, soft), how bright and how worn, the rails' metal, the water, the
// UI's key and wave -- so two projects' footsteps differ and one project's
// stay itself. Each sound is synthesised once into a Float32Array (partials,
// filtered noise, bubbles, a struck bar), worn like the music's samples, then
// played on Web Audio with a little seeded jitter so no two steps are alike.
//
//   const sfx = createSfx(Tone | audioContext, { seed, style: "lofi" });
//   sfx.play("step", { surface: "metal", speed: 8 });
//   sfx.play("land", { speed: 11 });
//   const grind = sfx.loop("grind", { speed: 9 }); grind.set({ speed: 12 }); grind.stop();
//   const feet = bodySfx(sfx, { surfaceOf: (body) => "stone" }); feet.update(body, dt);  // (physics body events)
//
// A project keeps all of that as one SFX_SETTINGS value (the codec's
// keel/audio/sfx): its seed, style and volume, what a body's materials and
// events sound like, and each sound's own gain, pitch, pan and jitter --
// createSfx(target, { settings }) and bodySfx(sfx, { settings }) take it, or
// its bytes.
//
// Nothing in here needs a page but createSfx: sfxStyle, sfxSamples, paramsFor
// and bodySfx are plain code (test/sfx.test.ts runs them in Node).

import { SFX_SETTINGS, decode, encode } from "@keel-engine/codec";
import type { SfxSettings } from "@keel-engine/codec";
import { bandpass, noiseOf, normalize, onePole, partials, wear } from "./samples.ts";
import type { PartialSpec, Samples } from "./samples.ts";
import { hash, streamOf } from "./score.ts";
import type { ToneLike } from "./tone.ts";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- the palette

export type Surface = "stone" | "metal" | "water";
export type SfxName = "step" | "jump" | "land" | "wallStart" | "wallJump" | "railStart" | "railEnd" | "splash" | "skimStart" | "respawn" | "blip" | "select" | "back" | "confirm" | "error" | "hover";
export type LoopName = "grind" | "wallrun" | "skim" | "wind";
export type StyleName = "lofi" | "clean" | "chip" | "soft";
export type Wave = "sine" | "triangle" | "square";

export const SURFACES: readonly Surface[] = ["stone", "metal", "water"];
/** One-shots (some with variants, played round-robin), loops, and the UI's blips. */
export const SFX_NAMES: readonly SfxName[] = ["step", "jump", "land", "wallStart", "wallJump", "railStart", "railEnd", "splash", "skimStart", "respawn", "blip", "select", "back", "confirm", "error", "hover"];
export const LOOP_NAMES: readonly LoopName[] = ["grind", "wallrun", "skim", "wind"];

interface StylePreset { readonly bright: number; readonly bits: number; readonly hold: number; readonly top: number; readonly wave: Wave; readonly room: number }
const STYLES: Record<StyleName, StylePreset> = {
  lofi: { bright: 0.45, bits: 11, hold: 2, top: 7000, wave: "triangle", room: 0.25 },
  clean: { bright: 0.6, bits: 16, hold: 1, top: 14000, wave: "sine", room: 0.12 },
  chip: { bright: 0.7, bits: 6, hold: 3, top: 9000, wave: "square", room: 0.05 },
  soft: { bright: 0.3, bits: 12, hold: 2, top: 4500, wave: "sine", room: 0.35 },
};
export const STYLE_NAMES = Object.keys(STYLES) as StyleName[];

/** A project's sound palette. */
export interface SfxStyle {
  readonly name: string;
  readonly pitch: number;
  readonly bright: number;
  readonly weight: number;
  readonly bits: number;
  readonly hold: number;
  readonly top: number;
  readonly shoe: "sneaker" | "boot" | "soft";
  /** A bar's inharmonic partials (ratios). */
  readonly metal: readonly number[];
  readonly metalHz: number;
  readonly water: number;
  readonly wind: number;
  readonly tonic: number;
  readonly wave: Wave;
  readonly room: number;
  readonly seed: number;
}
/** A preset's name, or any palette fields over one (`name` picks the preset; "lofi" when unknown). */
export type SfxStyleInput = string | ({ readonly name?: string } & Partial<Omit<SfxStyle, "name">>);

/** A project's sound palette from its seed and a style (a preset's name, or an object over "lofi"; any field pinned). */
export function sfxStyle(seed: string | number = "1", style: SfxStyleInput = "lofi"): SfxStyle {
  const given: { readonly name?: string } & Partial<Omit<SfxStyle, "name">> = typeof style === "string" ? { name: style } : { ...style };
  const preset = (STYLES as Record<string, StylePreset>)[given.name as string] ?? STYLES.lofi;
  const S = streamOf(`${seed}|sfx`);
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  // (The metal: a bar's inharmonic partials, each project's its own.)
  const metal = [1, S.between(2.6, 2.9), S.between(5.1, 5.6), S.between(8.4, 9.3)];
  return {
    name: given.name ?? "lofi",
    pitch: S.between(0.88, 1.14), bright: clamp(preset.bright + S.between(-0.15, 0.15)), weight: S.between(0.3, 0.8),
    bits: Math.max(4, Math.min(16, preset.bits + S.int(-1, 1))), hold: preset.hold, top: Math.round(preset.top * S.between(0.85, 1.1)),
    shoe: S.pick(["sneaker", "boot", "soft"] as const), metal, metalHz: S.between(520, 860), water: S.between(0.75, 1.3), wind: S.between(0.8, 1.2),
    tonic: S.int(0, 11), wave: preset.wave, room: preset.room, seed: hash(`${seed}|sfx|make`),
    ...Object.fromEntries(Object.entries(given).filter(([k]) => k !== "name")),
  };
}

// ---------------------------------------------------------------- making the sounds

const buf = (rate: number, sec: number): Samples => new Float32Array(Math.max(1, Math.round(rate * sec)));
const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);
type Rnd = () => number;
type Env = (t: number) => number;

/** A state-variable filter whose cutoff follows `hzAt(t)` (sweeps: whooshes, splashes, gusts). */
function sweep(x: Samples, hzAt: Env, q: number, rate: number, type: "band" | "low" | "high" = "band"): Samples {
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
/** Noise shaped by an envelope, added into x from t0. */
function burst(x: Samples, rate: number, rnd: Rnd, t0: number, env: Env, amp = 1): Samples {
  const i0 = Math.round(t0 * rate);
  for (let i = i0; i < x.length; i += 1) { const e = env((i - i0) / rate); if (e < 1e-4 && i > i0 + rate * 0.01) break; x[i]! += rnd() * e * amp; }
  return x;
}
/** A bubble: a sine that rises as it rings (the sound water makes). */
function bubble(x: Samples, rate: number, t0: number, f0: number, dur: number, amp: number): Samples {
  const i0 = Math.round(t0 * rate);
  let ph = 0;
  for (let i = i0; i < Math.min(x.length, i0 + Math.round(dur * 4 * rate)); i += 1) {
    const t = (i - i0) / rate;
    ph += (TAU * f0 * (1 + (2.2 * t) / dur)) / rate;
    x[i]! += Math.sin(ph) * amp * Math.exp(-t / dur) * Math.min(1, t / 0.002);
  }
  return x;
}
/** A thump: a skin whose note drops as it's struck. */
function thump(x: Samples, rate: number, t0: number, hi: number, lo: number, decay: number, amp: number): Samples {
  const i0 = Math.round(t0 * rate);
  let ph = 0;
  for (let i = i0; i < x.length; i += 1) {
    const t = (i - i0) / rate;
    const e = Math.exp(-t / decay);
    if (e < 1e-4) break;
    ph += (TAU * (lo + (hi - lo) * Math.exp(-t / 0.03))) / rate;
    x[i]! += Math.sin(ph) * e * amp * Math.min(1, t / 0.001);
  }
  return x;
}
const add = (x: Samples, y: Float32Array, g = 1): Samples => { for (let i = 0; i < Math.min(x.length, y.length); i += 1) x[i]! += y[i]! * g; return x; };
const env = (a: number, d: number): Env => (t) => (t < a ? t / a : Math.exp(-(t - a) / d));
/** A tone in the style's wave (sine, triangle or square, from their partials), decaying. */
function tone(rate: number, f: number, sec: number, wave: Wave, decay: number): Samples {
  const list: PartialSpec[] = [];
  const top = wave === "sine" ? 1 : 15;
  for (let n = 1; n <= top; n += wave === "sine" ? 1 : 2) list.push([f * n, wave === "square" ? 1 / n : 1 / (n * n), decay, wave === "triangle" && (n >> 1) % 2 ? Math.PI : 0, 0.002]);
  return partials(buf(rate, sec), rate, list);
}
/** Made to repeat: the tail crossfaded over the head (equal power), so the end runs into the start. */
function loopify(x: Samples, rate: number, fade: number): Samples {
  const F = Math.min(Math.round(fade * rate), x.length >> 1);
  const L = x.length - F;
  const out = x.slice(0, L);
  for (let i = 0; i < F; i += 1) { const a = (i / F) * (Math.PI / 2); out[i] = x[i]! * Math.sin(a) + x[L + i]! * Math.cos(a); }
  return out;
}

/** A footfall on a surface: heel then toe (stone), a ring (metal), a splash (water). */
function step(st: SfxStyle, surface: Surface, v: number, rate: number): Samples {
  const rnd = noiseOf(st.seed ^ (surface.length * 977 + v * 31 + 7));
  const R = streamOf(`${st.seed}|step|${surface}|${v}`);
  const shoe = st.shoe;
  const x = buf(rate, surface === "water" ? 0.3 : surface === "metal" ? 0.3 : 0.16);
  const toe = R.between(0.02, 0.04);
  if (surface === "water") {
    burst(x, rate, rnd, 0, env(0.004, 0.05), 0.8);
    sweep(x, (t) => 2600 * st.water * Math.exp(-t / 0.08) + 400, 1.4, rate, "low");
    for (let k = 0; k < 3 + R.int(0, 2); k += 1) bubble(x, rate, R.between(0.01, 0.12), R.between(420, 1100) * st.water, R.between(0.012, 0.03), 0.35);
    thump(x, rate, 0, 160, 80, 0.035, 0.3);
  } else {
    const bp = (shoe === "boot" ? 1100 : shoe === "soft" ? 900 : 1800) * (0.8 + 0.5 * st.bright) * R.between(0.9, 1.1);
    const n = buf(rate, x.length / rate);
    burst(n, rate, rnd, 0, env(0.001, 0.011), 1);
    burst(n, rate, rnd, toe, env(0.001, 0.008), 0.6);
    bandpass(n, bp, 0.9, rate);
    add(x, n, 2.2);
    thump(x, rate, 0, shoe === "boot" ? 150 : 120, shoe === "boot" ? 55 : 70, 0.02 + st.weight * 0.03, 0.5 + st.weight * 0.4);
    if (surface === "metal") {
      const f = st.metalHz * R.between(0.9, 1.12);
      add(x, partials(buf(rate, x.length / rate), rate, st.metal.map((r, i): PartialSpec => [f * r, [0.5, 0.35, 0.22, 0.12][i]!, 0.12 / (1 + i * 0.6), 0, 0.0008])), 0.8);
      add(x, partials(buf(rate, x.length / rate), rate, st.metal.map((r, i): PartialSpec => [f * r * 1.07, [0.3, 0.2, 0.12, 0.06][i]!, 0.08, 0, 0.0008])).map((v2, i) => (i / rate >= toe ? v2 : 0)), 0.6);
    }
    if (shoe === "sneaker" && surface === "stone" && R.chance(0.3)) { // (a squeak now and then)
      const s = partials(buf(rate, 0.05), rate, [[R.between(2400, 3400), 0.08, 0.02, 0, 0.004]]);
      add(x, s, 1);
    }
    if (shoe === "soft") onePole(x, 2400, rate);
  }
  return x;
}

/** Every sound of a palette: one-shots as variants (played in turn), loops as one array that repeats. */
export interface SfxSamples {
  readonly step_stone: Samples[];
  readonly step_metal: Samples[];
  readonly step_water: Samples[];
  readonly jump: Samples[];
  readonly land: Samples[];
  readonly land_hard: Samples[];
  readonly wallStart: Samples[];
  readonly wallJump: Samples[];
  readonly railStart: Samples[];
  readonly railEnd: Samples[];
  readonly splash: Samples[];
  readonly skimStart: Samples[];
  readonly respawn: Samples[];
  readonly blip: Samples[];
  readonly hover: Samples[];
  readonly select: Samples[];
  readonly back: Samples[];
  readonly confirm: Samples[];
  readonly error: Samples[];
  readonly grind: Samples;
  readonly wallrun: Samples;
  readonly skim: Samples;
  readonly wind: Samples;
}
export type SfxSampleKey = keyof SfxSamples;

/** Every sound of a palette, synthesised: one-shots (arrays of variants) and loops (Float32Arrays that repeat). */
export function sfxSamples(st: SfxStyle, rate = 44100): SfxSamples {
  const rnd = noiseOf(st.seed);
  const worn = (x: Samples, peak = 0.9) => normalize(wear(x, rate, { bits: st.bits, hold: st.hold, top: Math.min(rate / 2.3, st.top), dust: 0 }, rnd), peak);
  const R = streamOf(`${st.seed}|sfx|make`);
  const n = (k: number) => noiseOf(st.seed ^ (k * 2654435761));
  const steps = (s: Surface) => [0, 1, 2, 3].map((v) => worn(step(st, s, v, rate), s === "metal" ? 0.7 : 0.8));
  // A jump: the push (a scuff) and the air (a whoosh going up).
  const jump = () => {
    const x = burst(buf(rate, 0.32), rate, n(1), 0, (t) => Math.sin(Math.PI * Math.min(1, t / 0.3)) ** 2, 0.9);
    sweep(x, (t) => 500 + 2600 * (t / 0.3) * (0.7 + st.bright * 0.6), 2.5, rate);
    const s = burst(buf(rate, 0.32), rate, n(2), 0, env(0.001, 0.012), 1);
    bandpass(s, 1500, 0.9, rate);
    return add(x, s, 1.4);
  };
  // A landing: the body's weight (a falling thump), the crunch underfoot, the knees.
  const land = (hard: boolean) => {
    const x = thump(buf(rate, 0.55), rate, 0, hard ? 130 : 110, hard ? 38 : 48, 0.12 + st.weight * (hard ? 0.18 : 0.1), 1);
    const c = burst(buf(rate, 0.55), rate, n(hard ? 3 : 4), 0, env(0.001, hard ? 0.07 : 0.04), 1);
    onePole(c, hard ? 1300 : 1900, rate);
    add(x, c, hard ? 1.3 : 0.9);
    if (hard) burst(x, rate, n(5), 0.05, env(0.01, 0.08), 0.12); // (the scatter of grit)
    return x;
  };
  // Onto a wall: a grab (a scuff); off it: a kick and the air.
  const scuff = (k: number, lo: number, hi: number, dur: number) => sweep(burst(buf(rate, dur + 0.05), rate, n(k), 0, env(0.005, dur / 3), 1), (t) => lo + (hi - lo) * Math.min(1, t / dur), 2, rate);
  // A rail: struck (a clang), and let go (a smaller ring).
  const ring = (k: number, f: number, len: number, tau: number, strike: number) => {
    const x = partials(buf(rate, len), rate, st.metal.map((r, i): PartialSpec => [f * r, [1, 0.6, 0.4, 0.25][i]!, tau / (1 + i * 0.7), i * 0.7, 0.0006]));
    add(x, partials(buf(rate, len), rate, st.metal.map((r, i): PartialSpec => [f * r * 1.013, [0.5, 0.3, 0.2, 0.1][i]!, tau * 0.8 / (1 + i), 0.3, 0.0006])));
    const s = burst(buf(rate, len), rate, n(k), 0, env(0.0005, 0.006), strike);
    bandpass(s, 3000, 0.7, rate);
    return add(x, s);
  };
  // Water: in you go (a splash, a plop, bubbles), and a skim's touch-down (smaller).
  const splash = (k: number, len: number, big: boolean) => {
    const x = burst(buf(rate, len), rate, n(k), 0, env(0.004, big ? 0.22 : 0.1), 1);
    sweep(x, (t) => 6000 * st.water * Math.exp(-t / (big ? 0.2 : 0.1)) + 500, 1.2, rate, "low");
    thump(x, rate, 0, 200, 90, big ? 0.07 : 0.04, big ? 0.9 : 0.5);
    for (let i = 0; i < (big ? 14 : 5); i += 1) bubble(x, rate, R.between(0.03, len * 0.7), R.between(380, 1400) * st.water, R.between(0.01, 0.035), R.between(0.15, 0.4));
    return x;
  };
  // Back at the checkpoint: a rise in the palette's own key.
  const key = 72 + st.tonic;
  const arp = (notes: readonly number[], gap: number, decay: number, len: number) => {
    const x = buf(rate, len);
    notes.forEach((m, i) => { const t = tone(rate, midiHz(m), len - i * gap, st.wave, decay); for (let j = 0; j < t.length; j += 1) x[j + Math.round(i * gap * rate)]! += t[j]! * 0.5; });
    return x;
  };

  // ---- loops (each one repeats with no seam)
  // A rail under you: the metal singing and the rattle of the fixings.
  const grind = () => {
    const len = 1.2;
    const x = burst(buf(rate, len + 0.2), rate, n(12), 0, () => 1, 1);
    const sing = new Float32Array(x.length);
    st.metal.forEach((r, i) => { const f = st.metalHz * 1.6 * r; if (f >= rate / 2.3) return; const b = x.slice(); bandpass(b, f, 28, rate); add(sing, b, [1.6, 1.1, 0.7, 0.4][i]); }); // (none past what the rate can hold)
    const rattle = x.slice();
    bandpass(rattle, 2400, 0.8, rate);
    const flutter = streamOf(`${st.seed}|grind`);
    const bumps = Array.from({ length: 24 }, () => flutter.between(0.25, 1));
    for (let i = 0; i < x.length; i += 1) { const t = i / rate; x[i] = sing[i]! * 2 + rattle[i]! * 0.25 * bumps[Math.floor((t / (len + 0.2)) * 24) % 24]! + Math.sin(TAU * 70 * t) * 0.05; }
    return x;
  };
  // A wall under the feet: two scuffs a loop and the rub between (the scuffs off the ends, so the wrap is rub).
  const wallrun = () => {
    const len = 0.5;
    const x = buf(rate, len + 0.06);
    burst(x, rate, n(13), 0, () => 0.15, 1);
    onePole(x, 700, rate);
    for (const t0 of [0.12, 0.37]) { const s = scuff(14 + t0 * 10, 900, 1900, 0.09); const o = Math.round(t0 * rate); for (let i = 0; i < s.length && i + o < x.length; i += 1) x[i + o]! += s[i]!; }
    return x;
  };
  // Water under a fast runner: a hiss and a slap each stride.
  const skim = () => {
    const len = 0.8;
    const x = burst(buf(rate, len + 0.1), rate, n(15), 0, () => 0.35, 1);
    sweep(x, () => 3800 * st.water, 0.9, rate);
    for (const t0 of [0.02, 0.42]) { const s = splash(16 + t0 * 10, 0.3, false); for (let i = 0; i < s.length && i + t0 * rate < x.length; i += 1) x[i + Math.round(t0 * rate)]! += s[i]! * 0.4; }
    return x;
  };
  // Wind by the ears: noise through a band that gusts (whole gusts round the loop).
  const wind = () => {
    const len = 4;
    const x = burst(buf(rate, len + 0.3), rate, n(17), 0, () => 1, 1);
    onePole(x, 1200, rate);
    const g = streamOf(`${st.seed}|wind`);
    const [k1, k2] = [g.int(1, 2), g.int(3, 5)];
    const ph = g.between(0, TAU);
    sweep(x, (t) => (380 + 320 * Math.sin((TAU * k1 * t) / len + ph) + 140 * Math.sin((TAU * k2 * t) / len)) * st.wind, 1.6, rate);
    return x;
  };
  // (Worn first, then made to repeat: the wear's filter starts from silence, and that start is crossfaded away.)
  const wornLoop = (x: Samples, fade: number, peak: number) => normalize(loopify(wear(x, rate, { bits: st.bits, hold: st.hold, top: Math.min(rate / 2.3, st.top), dust: 0 }, rnd), rate, fade), peak);
  // (Made in the proof of concept's order: the wear's noise and R are shared streams.)
  return {
    step_stone: steps("stone"),
    step_metal: steps("metal"),
    step_water: steps("water"),
    jump: [worn(jump(), 0.7)],
    land: [worn(land(false))],
    land_hard: [worn(land(true))],
    wallStart: [worn(scuff(6, 800, 2200, 0.14), 0.7)],
    wallJump: [worn(add(thump(buf(rate, 0.4), rate, 0, 140, 60, 0.05, 0.8), jump(), 0.8), 0.75)],
    railStart: [worn(add(ring(7, st.metalHz * 0.85, 0.9, 0.5, 1.4), thump(buf(rate, 0.9), rate, 0, 120, 60, 0.05, 0.5)), 0.8)],
    railEnd: [worn(ring(8, st.metalHz * 1.3, 0.45, 0.18, 0.6), 0.6)],
    splash: [worn(splash(9, 0.95, true))],
    skimStart: [worn(splash(10, 0.4, false), 0.7)],
    respawn: [worn(add(arp([key - 12, key - 5, key, key + 7], 0.07, 0.25, 0.7), sweep(burst(buf(rate, 0.7), rate, n(11), 0, (t) => Math.sin(Math.PI * Math.min(1, t / 0.6)), 0.15), (t) => 1500 + 6000 * t, 3, rate)), 0.7)],
    // The UI: small, in key, in the palette's wave.
    blip: [worn(arp([key + 12], 0, 0.03, 0.08), 0.6)],
    hover: [worn(arp([key + 19], 0, 0.012, 0.04), 0.35)],
    select: [worn(arp([key + 7, key + 12], 0.05, 0.05, 0.16), 0.6)],
    back: [worn(arp([key + 7, key], 0.05, 0.05, 0.16), 0.6)],
    confirm: [worn(arp([key, key + 4 + (st.tonic % 2 ? 0 : -1), key + 7, key + 12], 0.055, 0.08, 0.36), 0.65)],
    error: [worn(add(tone(rate, 150, 0.1, "square", 0.05), tone(rate, 140, 0.24, "square", 0.05).map((v, i) => (i > rate * 0.12 ? v : 0))), 0.55)],
    grind: wornLoop(grind(), 0.2, 0.7),
    wallrun: wornLoop(wallrun(), 0.05, 0.6),
    skim: wornLoop(skim(), 0.1, 0.6),
    wind: wornLoop(wind(), 0.3, 0.6),
  };
}

// ---------------------------------------------------------------- how hard each is played

const clamp = (x: unknown, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Number.isFinite(+(x as number)) ? +(x as number) : lo));

/** What a sound is played with. `when` is the context's time. */
export interface SfxParams {
  readonly surface?: string;
  readonly speed?: number;
  readonly gain?: number;
  readonly pan?: number;
  readonly rate?: number;
  readonly when?: number;
}
/** How a sound is played: which sample, how fast (pitch), how loud, where (pan), how open (cutoff). */
export interface SfxPlay { readonly key: string; readonly rate: number; readonly gain: number; readonly pan: number; readonly cutoff: number }
/** A sound's own tuning (SFX_SETTINGS' `sounds`): gain and rate multiply, pan when the call gives none, jitter the +/- rate spread. */
export interface SfxTuning {
  readonly gain?: number | undefined;
  readonly rate?: number | undefined;
  readonly pan?: number | undefined;
  readonly jitter?: number | undefined;
}

// (The sounds whose rate varies a little from play to play, untuned.)
const JITTERED: ReadonlySet<string> = new Set(["step", "land", "jump"]);
/** The +/- spread a play's rate varies by: a tuned sound's `jitter`, else 0.035 for step, land and jump and none for the rest. */
export const jitterOf = (name: string, tune?: SfxTuning): number => clamp(tune?.jitter ?? (JITTERED.has(name) ? 0.035 : 0), 0, 1);

/**
 * How a sound is played for its params: which sample, how fast (pitch),
 * how loud, where (pan), how open (cutoff, loops). Plain numbers: tests read them.
 *   step {surface, speed}   land {speed}   grind/skim/wallrun/wind {speed}   any {gain, pan, rate}
 */
export function paramsFor(name: string, p: SfxParams = {}, st: { readonly pitch?: number } = { pitch: 1 }, tune?: SfxTuning): SfxPlay {
  const speed = clamp(p.speed ?? 0, 0, 40);
  const base = { key: name, rate: st.pitch ?? 1, gain: 1, pan: clamp(p.pan ?? tune?.pan ?? 0, -1, 1), cutoff: 20000 };
  if (name === "step") {
    const surface = (SURFACES as readonly unknown[]).includes(p.surface) ? p.surface : "stone";
    Object.assign(base, { key: `step_${surface}`, gain: clamp(0.35 + speed * 0.05, 0.3, 0.85), rate: base.rate * clamp(0.94 + speed * 0.01, 0.94, 1.06) });
  } else if (name === "land") {
    Object.assign(base, { key: speed > 9 ? "land_hard" : "land", gain: clamp(0.3 + speed / 12, 0.3, 1.2), rate: base.rate * clamp(1.12 - speed / 50, 0.78, 1.12) });
  } else if (name === "grind") {
    const s = clamp((speed - 4) / 10, 0, 1);
    Object.assign(base, { rate: base.rate * (0.8 + 0.5 * s), gain: 0.35 + 0.4 * s, cutoff: 3000 + 9000 * s });
  } else if (name === "wallrun") {
    Object.assign(base, { rate: clamp(speed / 7, 0.7, 1.5), gain: 0.45 });
  } else if (name === "skim") {
    const s = clamp((speed - 6.5) / 6, 0, 1);
    Object.assign(base, { rate: 0.9 + 0.3 * s, gain: 0.3 + 0.3 * s, cutoff: 5000 + 7000 * s });
  } else if (name === "wind") {
    const s = clamp((speed - 2) / 16, 0, 1);
    Object.assign(base, { rate: clamp(0.85 + speed * 0.02, 0.85, 1.25), gain: 0.7 * s ** 1.5, cutoff: 500 + 5500 * s });
  } else if (["blip", "hover", "select", "back", "confirm", "error"].includes(name)) {
    base.rate = 1; // (the UI stays in key)
  }
  base.gain = clamp(base.gain * clamp(p.gain ?? 1, 0, 2), 0, 2);
  if (p.rate !== undefined) base.rate = clamp(base.rate * p.rate, 0.25, 4);
  base.rate = clamp(base.rate, 0.25, 4);
  // (A sound's own tuning, over whatever the call asked for.)
  if (tune?.gain !== undefined) base.gain = clamp(base.gain * tune.gain, 0, 2);
  if (tune?.rate !== undefined) base.rate = clamp(base.rate * tune.rate, 0.25, 4);
  return base;
}

// ---------------------------------------------------------------- playing them

/** A held loop: set its params (ramped), stop it (faded). */
export interface SfxLoop {
  readonly playing: boolean;
  readonly params?: SfxPlay;
  set(p?: SfxParams, ramp?: number): void;
  stop(fade?: number, at?: number): void;
}
/** What plays sound effects: createSfx's, a silent stand-in, or a test's recorder. */
export interface SfxPlayer {
  play(name: string, p?: SfxParams): unknown;
  loop(name: string, p?: SfxParams): Pick<SfxLoop, "set" | "stop">;
}
/** The sound effects on a page. */
export interface Sfx extends SfxPlayer {
  readonly style: SfxStyle;
  readonly context: BaseAudioContext;
  volume: number;
  /** A one-shot now (or at `when`): its source, or null for a name it doesn't know. */
  play(name: string, p?: SfxParams): AudioBufferSourceNode | null;
  /** A loop, faded in. */
  loop(name: string, p?: SfxParams): SfxLoop;
  stopAll(fade?: number): void;
  dispose(): void;
}
export interface SfxOptions {
  readonly seed?: string | number;
  readonly style?: SfxStyleInput;
  /** A node to play into (none: Tone's destination, or the context's). */
  readonly out?: AudioNode | null;
  readonly volume?: number;
  /** A project's SFX_SETTINGS (or its bytes): seed, style and volume (the options above win), and each sound's tuning. */
  readonly settings?: SfxSettings | Uint8Array | undefined;
}

// ---------------------------------------------------------------- settings

export type { SfxSettings };
/** SFX_SETTINGS as codec bytes (keel/audio/sfx). */
export const sfxSettingsBytes = (settings: SfxSettings): Uint8Array => encode(SFX_SETTINGS, settings);
/** SFX_SETTINGS from its bytes (a value is handed back as it is); other bytes are a TypeError saying why. */
export function sfxSettingsOf(x: SfxSettings | Uint8Array): SfxSettings {
  if (!(x instanceof Uint8Array)) return x;
  try {
    return decode(SFX_SETTINGS, x);
  } catch (e) {
    throw new TypeError(`These bytes aren't sfx settings (keel/audio/sfx): ${(e as Error).message}`, { cause: e });
  }
}
/** The settings' style as sfxStyle takes it (a preset's name, or its fields with the absent ones left out). */
const styleOf = (s: SfxSettings): SfxStyleInput =>
  typeof s.style === "string" ? s.style : (Object.fromEntries(Object.entries(s.style).filter(([, v]) => v !== undefined)) as SfxStyleInput);
/** A settings' tuning for one sound (none for a name it doesn't tune). */
export const tuningOf = (settings: SfxSettings | undefined, name: string): SfxTuning | undefined => {
  const sounds = settings?.sounds as Readonly<Record<string, SfxTuning>> | undefined;
  return sounds && Object.hasOwn(sounds, name) ? sounds[name] : undefined;
};

const isTone = (t: ToneLike | BaseAudioContext): t is ToneLike =>
  typeof (t as Partial<ToneLike>).getContext === "function" && typeof (t as Partial<ToneLike>).getDestination === "function";

/**
 * The sound effects on a page: `target` is Tone (its context and destination,
 * where KEEL's volume and mute apply) or an AudioContext / OfflineAudioContext.
 * { seed, style, out (a node to play into), volume, settings (SFX_SETTINGS or
 * its bytes: the seed, style and volume when not given, and each sound's tuning
 * -- gain and rate multiply, pan when a call gives none, jitter the rate's spread) }.
 */
export function createSfx(target: ToneLike | BaseAudioContext, options: SfxOptions = {}): Sfx {
  const settings = options.settings === undefined ? undefined : sfxSettingsOf(options.settings);
  const seed = options.seed ?? settings?.seed ?? "1";
  const style = options.style ?? (settings ? styleOf(settings) : "lofi");
  const volume = options.volume ?? settings?.volume ?? 0.8;
  const out = options.out ?? null;
  const tone = isTone(target) ? target : null;
  const ctx: BaseAudioContext = tone ? tone.getContext().rawContext : (target as BaseAudioContext);
  const st = sfxStyle(seed, style);
  const data = sfxSamples(st, ctx.sampleRate);
  const toBuf = (x: Samples) => { const b = ctx.createBuffer(1, x.length, ctx.sampleRate); b.copyToChannel(x, 0); return b; };
  const bufs: Record<string, AudioBuffer | AudioBuffer[]> = Object.fromEntries(Object.entries(data).map(([k, v]: [string, Samples | Samples[]]) => [k, Array.isArray(v) ? v.map(toBuf) : toBuf(v)]));
  const master = ctx.createGain();
  master.gain.value = volume;
  // (Into `out`, Tone's destination -- where KEEL's volume and mute apply -- or the context's.)
  const bus: AudioNode = out ?? (tone ? ctx.createGain() : ctx.destination);
  if (!out && tone) tone.connect(bus, tone.getDestination());
  master.connect(bus);
  // (A short slap off the walls round it, as much as the style has room.)
  if (st.room > 0) {
    const slap = ctx.createDelay(0.5);
    slap.delayTime.value = 0.07;
    const fb = ctx.createGain();
    fb.gain.value = st.room * 0.8;
    const wet = ctx.createGain();
    wet.gain.value = st.room;
    const dark = ctx.createBiquadFilter();
    dark.frequency.value = 2500;
    master.connect(slap); slap.connect(dark); dark.connect(fb); fb.connect(slap); dark.connect(wet); wet.connect(bus);
  }
  const J = streamOf(`${seed}|sfx|play`);
  const turn: Record<string, number> = {};
  const voiceOf = (key: string, loop: boolean) => {
    const b = bufs[key];
    if (!b) return null;
    const src = ctx.createBufferSource();
    if (Array.isArray(b)) { turn[key] = ((turn[key] ?? -1) + 1 + (b.length > 2 && J.chance(0.3) ? 1 : 0)) % b.length; src.buffer = b[turn[key]]!; }
    else src.buffer = b;
    src.loop = loop;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const gain = ctx.createGain();
    const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
    src.connect(filter); filter.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(master); } else gain.connect(master);
    return { src, filter, gain, pan };
  };
  const loops = new Set<SfxLoop>();
  const quiet: SfxLoop = { set() {}, stop() {}, playing: false };
  const api: Sfx = {
    style: st,
    get context() { return ctx; },
    get volume() { return master.gain.value; },
    set volume(v) { master.gain.value = clamp(v, 0, 1.5); },
    play(name, p = {}) {
      const tune = tuningOf(settings, name);
      const q = paramsFor(name, p, st, tune);
      const v = voiceOf(q.key, false);
      if (!v) return null;
      const when = p.when ?? ctx.currentTime;
      // (Untuned, exactly the draws it always made: a tuned spread of 0 still draws for step, land and jump.)
      const spread = jitterOf(name, tune);
      const jitter = JITTERED.has(name) || spread > 0 ? 1 + J.between(-spread, spread) : 1;
      v.src.playbackRate.value = q.rate * jitter;
      v.gain.gain.value = q.gain * (name === "step" ? J.between(0.88, 1.05) : 1);
      v.filter.frequency.value = q.cutoff;
      if (v.pan) v.pan.pan.value = q.pan;
      v.src.start(when);
      return v.src;
    },
    loop(name, p = {}) {
      const v = voiceOf(name, true);
      if (!v) return { ...quiet };
      const when = p.when ?? ctx.currentTime;
      const tune = tuningOf(settings, name);
      let q = paramsFor(name, p, st, tune);
      v.src.playbackRate.value = q.rate;
      v.filter.frequency.value = q.cutoff;
      if (v.pan) v.pan.pan.value = q.pan;
      v.gain.gain.setValueAtTime(0, when);
      v.gain.gain.linearRampToValueAtTime(q.gain, when + 0.04);
      v.src.start(when, J.between(0, v.src.buffer!.duration)); // (from anywhere in it: two grinds never start alike)
      // (A tuned jitter: this loop's own pitch, drawn once as it starts.)
      const spread = jitterOf(name, tune);
      const jitter = spread > 0 ? 1 + J.between(-spread, spread) : 1;
      if (jitter !== 1) v.src.playbackRate.value = q.rate * jitter;
      const h: { playing: boolean } & SfxLoop = {
        playing: true,
        get params() { return q; },
        set(p2 = {}, ramp = 0.08) {
          if (!h.playing) return;
          q = paramsFor(name, { ...p, ...p2 }, st, tune);
          const t = p2.when ?? ctx.currentTime;
          v.src.playbackRate.setTargetAtTime(q.rate * jitter, t, ramp / 3);
          v.gain.gain.setTargetAtTime(q.gain, t, ramp / 3);
          v.filter.frequency.setTargetAtTime(q.cutoff, t, ramp / 3);
          if (v.pan) v.pan.pan.setTargetAtTime(q.pan, t, ramp / 3);
        },
        stop(fade = 0.12, at = ctx.currentTime) {
          if (!h.playing) return;
          h.playing = false;
          loops.delete(h);
          v.gain.gain.cancelScheduledValues(at);
          v.gain.gain.setValueAtTime(v.gain.gain.value, at);
          v.gain.gain.linearRampToValueAtTime(0, at + fade);
          v.src.stop(at + fade + 0.02);
        },
      };
      loops.add(h);
      return h;
    },
    stopAll(fade = 0.1) { for (const h of [...loops]) h.stop(fade); },
    dispose() { api.stopAll(0.02); try { master.disconnect(); } catch { /* (already gone) */ } },
  };
  return api;
}

// ---------------------------------------------------------------- a body's sounds

/** What bodySfx reads off a physics body (the character's step result). */
export interface SfxBody {
  readonly vel: readonly number[];
  readonly mode: string;
  readonly events?: readonly { readonly type: string; readonly speed?: number }[] | undefined;
}
export interface BodySfxOptions {
  readonly surfaceOf?: (body: SfxBody) => string;
  /** The material underfoot (a name settings' body.surfaces maps to a surface; one it doesn't map falls back to surfaceOf). */
  readonly materialOf?: (body: SfxBody) => string;
  readonly wind?: boolean;
  readonly gain?: number;
  /** A project's SFX_SETTINGS (or its bytes): body.wind and body.gain (the options above win), body.surfaces, body.events. */
  readonly settings?: SfxSettings | Uint8Array | undefined;
}
export interface BodySfx {
  update(body: SfxBody, dt: number): void;
  stop(): void;
  /** The loops held now. */
  readonly held: string[];
}

const ONE: Readonly<Record<string, SfxName>> = { jumped: "jump", wallStart: "wallStart", wallJump: "wallJump", railStart: "railStart", railEnd: "railEnd", skimStart: "skimStart", splashIn: "splash", respawn: "respawn" };

/**
 * The physics body's sounds (the character controller): call update(body, dt)
 * after each body.step. One-shots from its events -- landed {speed}, jumped,
 * wallStart, wallJump, railStart, railEnd, skimStart, splashIn, respawn --
 * footsteps from its run (a stride that lengthens with speed, on the surface
 * `surfaceOf(body)` names), and loops held while it grinds, wall-runs, skims,
 * with the wind by its speed. With `settings` (SFX_SETTINGS or its bytes):
 * body.wind and body.gain, the surface of each material `materialOf(body)`
 * names (body.surfaces), and body.events over the built-in event table.
 */
export function bodySfx(sfx: SfxPlayer, options: BodySfxOptions = {}): BodySfx {
  const body0 = options.settings === undefined ? undefined : sfxSettingsOf(options.settings).body;
  const fallback = options.surfaceOf ?? (() => "stone");
  const wind = options.wind ?? body0?.wind ?? true;
  const gain = options.gain ?? body0?.gain ?? 1;
  const { materialOf } = options;
  const surfaces = (body0?.surfaces ?? {}) as Readonly<Record<string, string>>;
  // (A material the settings map sounds like its surface; any other falls back to surfaceOf.)
  const surfaceOf = (b: SfxBody): string => {
    const m = materialOf?.(b);
    return m !== undefined && Object.hasOwn(surfaces, m) ? surfaces[m]! : fallback(b);
  };
  // (The settings' events over the built-in table: more of them, or other sounds for the same.)
  const events = body0?.events as Readonly<Record<string, string>> | undefined;
  const one: Readonly<Record<string, string>> = events ? { ...ONE, ...events } : ONE;
  const held: Record<string, Pick<SfxLoop, "set" | "stop"> | null> = {};
  let stride = 0;
  const hold = (name: string, on: boolean, p?: SfxParams) => {
    const h = held[name];
    if (on && !h) held[name] = sfx.loop(name, { ...p, gain });
    else if (on && h) h.set({ ...p, gain });
    else if (h) { h.stop(); held[name] = null; }
  };
  return {
    update(body, dt) {
      const hs = Math.hypot(body.vel[0]!, body.vel[2]!);
      const speed = Math.hypot(body.vel[0]!, body.vel[1]!, body.vel[2]!);
      for (const e of body.events ?? []) {
        if (e.type === "landed") { sfx.play(events && Object.hasOwn(events, "landed") ? events["landed"]! : "land", { speed: e.speed!, gain }); stride = 0; continue; }
        const name = one[e.type];
        if (name) sfx.play(name, { gain, speed: hs });
      }
      // Footsteps: a stride of 0.7 m standing to ~3 m at a full run.
      if (body.mode === "ground" && hs > 0.6) {
        stride += hs * dt;
        if (stride >= 0.7 + 0.24 * hs) { stride = 0; sfx.play("step", { surface: surfaceOf(body), speed: hs, gain }); }
      } else if (body.mode !== "ground") stride = 0.5; // (the first step lands soon after touching down)
      hold("grind", body.mode === "grind", { speed });
      hold("wallrun", body.mode === "wall", { speed: hs });
      hold("skim", body.mode === "skim", { speed: hs });
      if (wind) hold("wind", true, { speed });
    },
    stop() { for (const k of Object.keys(held)) hold(k, false); },
    get held() { return Object.keys(held).filter((k) => held[k]); },
  };
}
