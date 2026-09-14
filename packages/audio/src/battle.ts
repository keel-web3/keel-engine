// Battle audio for an RTS, all made in code from a seed (nothing fetched, no
// speech, original sounds): weapon fire and impacts per damage class,
// explosions small and big, deaths per body material, construction loops per
// tech flavour, and -- from src/voice.ts -- stings, alert voices and unit
// barks in a race's voice. This file is the pure half: every sound as a
// Float32Array, the names, the variants. src/battle-audio.ts plays them.
//
//   battleSample("fire.kinetic", { seed, variant: 2, rate: 44100 })            // a Float32Array
//   battleSample("bark.select", { seed, voice: voiceFor({ seed: race, timbre: "machine", size: 1.2 }) })
//
// The seed picks the battle's palette (the guns' calibre, the booms' size,
// the metal's partials, how wet, how gritty) as sfxStyle picks a project's;
// each (name, variant) draws from its own stream, so sounds never shift when
// others are added.

import { hash, streamOf } from "./score.ts";
import type { Stream } from "./score.ts";
import {
  TAU, add, bp, bubble, buf, burst, env, finish, finishLoop, hp, lp, noiseOf, osc, partials, saturate, sweep, thump, wearOf, whole,
} from "./synth.ts";
import type { BattleStyleName, BattleWear, PartialSpec, Rnd, Samples } from "./synth.ts";
import { ALERT_KINDS, BARK_KINDS, STING_KINDS, alertSample, barkSample, stingSample, voiceFor } from "./voice.ts";
import type { AlertKind, BarkKind, BattleVoice, StingKind, VoiceSpec } from "./voice.ts";

// ---------------------------------------------------------------- the names

export const DAMAGE_CLASSES = ["kinetic", "piercing", "blast", "energy", "siege", "acid"] as const;
export type DamageClass = (typeof DAMAGE_CLASSES)[number];
export const DEATH_MATERIALS = ["metal", "organic", "crystal"] as const;
export type DeathMaterial = (typeof DEATH_MATERIALS)[number];
export const BUILD_FLAVOURS = ["machine", "organic", "energy"] as const;
export type BuildFlavour = (typeof BUILD_FLAVOURS)[number];
export const EXPLOSION_SIZES = ["small", "big"] as const;
export type ExplosionSize = (typeof EXPLOSION_SIZES)[number];

export type FireName = `fire.${DamageClass}`;
export type HitName = `hit.${DamageClass}`;
export type ExplodeName = `explode.${ExplosionSize}`;
export type DeathName = `death.${DeathMaterial}`;
export type StingName = `sting.${StingKind}`;
export type AlertName = `alert.${AlertKind}`;
export type BarkName = `bark.${BarkKind}`;
/** Every one-shot. */
export type BattleSoundName = FireName | HitName | ExplodeName | DeathName | StingName | AlertName | BarkName;
/** Every loop (construction, seamless). */
export type BattleLoopName = `build.${BuildFlavour}`;
export type BattleName = BattleSoundName | BattleLoopName;

/** Every one-shot's name, in a fixed order. */
export const BATTLE_SOUNDS: readonly BattleSoundName[] = [
  ...DAMAGE_CLASSES.map((d) => `fire.${d}` as const), ...DAMAGE_CLASSES.map((d) => `hit.${d}` as const),
  ...EXPLOSION_SIZES.map((s) => `explode.${s}` as const), ...DEATH_MATERIALS.map((m) => `death.${m}` as const),
  ...STING_KINDS.map((s) => `sting.${s}` as const), ...ALERT_KINDS.map((a) => `alert.${a}` as const), ...BARK_KINDS.map((b) => `bark.${b}` as const),
];
export const BATTLE_LOOPS: readonly BattleLoopName[] = BUILD_FLAVOURS.map((f) => `build.${f}` as const);
const KNOWN: ReadonlySet<string> = new Set([...BATTLE_SOUNDS, ...BATTLE_LOOPS]);
export const isBattleName = (name: string): name is BattleName => KNOWN.has(name);
export const isBattleLoop = (name: string): name is BattleLoopName => name.startsWith("build.") && KNOWN.has(name);
/** Sounds that speak in a voice (a voice is part of what they are: stings, alerts, barks). */
export const isVoiced = (name: string): boolean => /^(sting|alert|bark)\./.test(name);

/** How many seeded variants a sound has (played in turn unless a variant is asked for). */
export function variantsOf(name: string): number {
  const kind = name.split(".")[0];
  if (name === "bark.annoyed") return 3;
  if (name === "explode.big") return 2;
  return ({ fire: 4, hit: 3, explode: 3, death: 3, bark: 4 } as Record<string, number>)[kind!] ?? 1;
}

/** Each category's level (peak) -- all under full scale. */
const PEAK: Readonly<Record<string, number>> = { fire: 0.8, hit: 0.72, explode: 0.9, death: 0.8, build: 0.6, sting: 0.7, alert: 0.8, bark: 0.75 };

/** The race flavours MYRIAD draws (packs/myriad-races) -> the construction loop they sound like. */
export const buildOfFlavour = (flavour: string): BattleLoopName =>
  flavour === "biotic" || flavour === "organic" ? "build.organic" : flavour === "machine" || flavour === "thermal" ? "build.machine" : "build.energy";

// ---------------------------------------------------------------- the palette

/** A battle's palette: what the seed makes of its guns, booms and metal. */
interface Palette {
  readonly pitch: number;
  readonly calibre: number;
  readonly boom: number;
  readonly tail: number;
  readonly grit: number;
  readonly wet: number;
  readonly metal: readonly number[];
  readonly zap: number;
}
function paletteOf(seed: string | number): Palette {
  const S = streamOf(`${seed}|battle`);
  return {
    pitch: S.between(0.9, 1.12), calibre: S.between(0.8, 1.25), boom: S.between(0.85, 1.2), tail: S.between(0.85, 1.25),
    grit: S.between(0, 1), wet: S.between(0.8, 1.25), metal: [1, S.between(2.55, 2.95), S.between(5.0, 5.7), S.between(8.3, 9.4)], zap: S.between(0.8, 1.25),
  };
}

type Make = (R: Stream, n: (k: number) => Rnd, P: Palette, rate: number) => Samples;
const ring = (rate: number, len: number, f: number, ratios: readonly number[], amps: readonly number[], tau: number, attack = 0.0006): Samples =>
  partials(buf(rate, len), rate, ratios.map((r, i): PartialSpec => [f * r, amps[i] ?? 0.1, tau / (1 + i * 0.6), i * 0.9, attack]));
/** Scattered little clicks: debris, grit. */
function debris(x: Samples, rate: number, R: Stream, rnd: Rnd, count: number, from: number, to: number, amp: number, lo = 1500, hi = 4500): Samples {
  for (let k = 0; k < count; k += 1) {
    const t0 = R.between(from, to);
    const c = burst(buf(rate, 0.03), rate, rnd, 0, env(0.0004, R.between(0.003, 0.012)), 1);
    bp(c, R.between(lo, hi), 1.2, rate);
    add(x, c, amp * R.between(0.4, 1) * (1 - (0.6 * (t0 - from)) / Math.max(1e-3, to - from)), t0 * rate);
  }
  return x;
}

// ---------------------------------------------------------------- weapons (short, punchy: <= 0.6 s)

const FIRE: Record<DamageClass, Make> = {
  // Gunfire: one to three cracks in a rattle, each a sharp crack over a short body, the report behind.
  kinetic: (R, n, P, rate) => {
    const shots = R.int(1, 3);
    const gap = R.between(0.055, 0.08);
    const x = buf(rate, 0.16 + gap * (shots - 1) + 0.08);
    const c = buf(rate, x.length / rate);
    for (let k = 0; k < shots; k += 1) {
      const t0 = k * gap;
      const a = k ? R.between(0.7, 0.95) : 1;
      burst(c, rate, n(1 + k), t0, env(0.0004, 0.005 * P.calibre), 1.3 * a, 0.05);
      thump(x, rate, t0, 260 * P.calibre, 95 * P.calibre, 0.022, 0.7 * a, 0.008);
      burst(x, rate, n(4 + k), t0 + 0.011, env(0.0003, 0.002), 0.25 * a, 0.02); // (the action cycling)
    }
    hp(c, 1400, rate);
    add(x, c, 1);
    const tail = burst(buf(rate, x.length / rate), rate, n(9), 0, env(0.004, 0.05 * P.tail), 0.22);
    return add(x, lp(tail, 1300, rate), 1);
  },
  // A rail / needle: a zip that falls from very high, a ringing snap, a thin tail.
  piercing: (R, n, P, rate) => {
    const x = buf(rate, 0.3);
    const top = R.between(6500, 8500) * P.pitch;
    osc(x, rate, 0, 0.3, (t) => top * Math.exp(-t / 0.028) + 1300, env(0.0008, 0.05), "sine", 0);
    const z = burst(buf(rate, 0.3), rate, n(1), 0, env(0.0004, 0.028), 1);
    sweep(z, (t) => 9000 * Math.exp(-t / 0.035) + 1600, 4, rate);
    add(x, z, 0.9);
    add(x, ring(rate, 0.3, R.between(2800, 3600), P.metal, [0.35, 0.2, 0.12, 0.06], 0.07), 1);
    return thump(x, rate, 0, 450, 220, 0.012, 0.35, 0.005);
  },
  // A launcher: the thump of the tube, a pop, the round whooshing away.
  blast: (R, n, P, rate) => {
    const x = buf(rate, 0.5);
    thump(x, rate, 0, 150 * P.boom, 45 * P.boom, 0.09, 1.1, 0.018);
    const pop = burst(buf(rate, 0.5), rate, n(1), 0, env(0.001, 0.014), 0.9);
    add(x, lp(pop, 2200, rate), 1);
    const w = burst(buf(rate, 0.5), rate, n(2), 0.02, (t) => (t < 0.42 ? Math.sin((Math.PI * t) / 0.42) ** 2 : 0), 0.55);
    const up = R.between(2600, 3600);
    sweep(w, (t) => 450 + up * Math.min(1, t / 0.42), 2.2, rate);
    return add(x, w, 1);
  },
  // An energy weapon: a buzzing zap that falls, wobbling, over a ring-modulated fifth.
  energy: (R, n, P, rate) => {
    const x = buf(rate, 0.34);
    const f0 = R.between(1400, 2000) * P.zap;
    const wob = R.between(45, 70);
    const e = env(0.002, 0.085);
    osc(x, rate, 0, 0.34, (t) => f0 * Math.exp(-t / 0.055) + 240, (t) => e(t) * (0.6 + 0.4 * Math.sin(TAU * wob * t)), "saw");
    osc(x, rate, 0, 0.34, (t) => (f0 * Math.exp(-t / 0.055) + 240) * 1.5, (t) => e(t) * 0.3, "square");
    const s = burst(buf(rate, 0.34), rate, n(1), 0, env(0.0006, 0.018), 0.3);
    add(x, hp(s, 3500, rate), 1);
    return lp(x, 6500, rate);
  },
  // Siege: a heavy boom, the blast's roar closing down, a long rumbling tail.
  siege: (R, n, P, rate) => {
    const x = buf(rate, 0.6);
    thump(x, rate, 0, 115 * P.boom, 30 * P.boom, 0.2, 1.3, 0.045);
    const roar = burst(buf(rate, 0.6), rate, n(1), 0, env(0.002, 0.11), 1);
    sweep(roar, (t) => 1900 * Math.exp(-t / 0.08) + 180, 0.9, rate, "low");
    add(x, roar, 1);
    const rumble = burst(buf(rate, 0.6), rate, n(2), 0.02, env(0.05, 0.22 * P.tail), 0.6);
    add(x, lp(lp(rumble, 320, rate), 320, rate), 1.4);
    const crack = burst(buf(rate, 0.6), rate, n(3), 0, env(0.0004, 0.005), 0.6, 0.03);
    add(x, hp(crack, 1200, rate), 1);
    return saturate(x, 1.4 + R.between(0, 0.4));
  },
  // Acid (organic attackers): a wet spit -- a squirt through a resonant, falling band, bubbles, a gulp.
  acid: (R, n, P, rate) => {
    const x = buf(rate, 0.36);
    const s = burst(buf(rate, 0.36), rate, n(1), 0, env(0.004, 0.045), 1);
    const hi = R.between(2200, 3000) * P.wet;
    sweep(s, (t) => hi * Math.exp(-t / 0.05) + 600, 3.2, rate);
    add(x, s, 1.2);
    for (let k = 0, m = R.int(5, 8); k < m; k += 1) bubble(x, rate, R.between(0.01, 0.2), R.between(500, 1500) * P.wet, R.between(0.008, 0.025), R.between(0.2, 0.4));
    return thump(x, rate, 0, 320, 150, 0.03, 0.4, 0.01);
  },
};

// ---------------------------------------------------------------- impacts (<= 0.8 s)

const HIT: Record<DamageClass, Make> = {
  // A bullet landing: a tick off armour, and (most of the time) a ricochet whining away.
  kinetic: (R, n, P, rate) => {
    const rico = R.chance(0.7);
    const x = buf(rate, rico ? 0.3 : 0.12);
    const t = burst(buf(rate, x.length / rate), rate, n(1), 0, env(0.0003, 0.003), 1.5, 0.02);
    add(x, bp(t, R.between(3000, 4200), 0.8, rate), 1.4);
    thump(x, rate, 0, 520, 260, 0.01, 0.4, 0.004);
    if (rico) {
      const f = R.between(2600, 3800) * P.pitch;
      const d = R.between(0.18, 0.26);
      osc(x, rate, 0.012, d, (tt) => f * (1 - (0.4 * tt) / d), env(0.006, d / 3.2), "sine");
    }
    return x;
  },
  // A dart / spike going in: a hard thunk.
  piercing: (R, n, P, rate) => {
    const x = buf(rate, 0.22);
    thump(x, rate, 0, 400 * P.calibre, 130 * P.calibre, 0.034, 1, 0.012);
    const k = burst(buf(rate, 0.22), rate, n(1), 0, env(0.0008, 0.014), 1);
    add(x, bp(k, R.between(800, 1100), 1.5, rate), 1.6);
    return add(x, ring(rate, 0.22, R.between(1600, 2000), P.metal, [0.14, 0.08, 0.04, 0.02], 0.03), 1);
  },
  // A round landing: a small explosion.
  blast: (R, n, P, rate) => {
    const x = buf(rate, 0.6);
    const b = burst(buf(rate, 0.6), rate, n(1), 0, env(0.001, 0.13), 1);
    sweep(b, (t) => 4200 * Math.exp(-t / 0.06) + 260, 0.9, rate, "low");
    add(x, b, 1);
    thump(x, rate, 0, 125 * P.boom, 42 * P.boom, 0.11, 1, 0.02);
    return debris(x, rate, R, n(2), 6, 0.05, 0.35, 0.18);
  },
  // Energy landing: a crackling sizzle and a dying hum.
  energy: (R, n, P, rate) => {
    const x = buf(rate, 0.5);
    const s = buf(rate, 0.5);
    const rnd = n(1);
    const spark = n(2);
    const e = env(0.002, 0.16);
    for (let i = 0; i < s.length; i += 1) s[i] = rnd() * e(i / rate) * (spark() > 0.82 ? 1 : 0.18);
    add(x, hp(s, 3200, rate), 1);
    const f = R.between(950, 1300) * P.zap;
    const hum = R.between(80, 110);
    const he = env(0.001, 0.09);
    osc(x, rate, 0, 0.5, (t) => f - 400 * Math.min(1, t / 0.3), (t) => he(t) * 0.4 * (0.5 + 0.5 * Math.sin(TAU * hum * t)), "sine");
    return x;
  },
  // A siege round landing: a big crunch, rubble, a rumble.
  siege: (R, n, P, rate) => {
    const x = buf(rate, 0.8);
    thump(x, rate, 0, 95 * P.boom, 28 * P.boom, 0.19, 1.3, 0.04);
    const c = burst(buf(rate, 0.8), rate, n(1), 0, env(0.001, 0.09), 1);
    add(x, saturate(lp(c, 2600, rate), 3), 0.9);
    debris(x, rate, R, n(2), 10, 0.05, 0.5, 0.45, 1200, 4000);
    const r = burst(buf(rate, 0.8), rate, n(3), 0.02, env(0.03, 0.18 * P.tail), 0.7);
    return add(x, lp(lp(r, 220, rate), 220, rate), 1.5);
  },
  // Acid landing: a hiss that eats, and small pops.
  acid: (R, n, P, rate) => {
    const x = buf(rate, 0.6);
    const h = burst(buf(rate, 0.6), rate, n(1), 0, env(0.025, 0.18), 1);
    sweep(h, (t) => 6200 - 2200 * Math.min(1, t / 0.4), 1.3, rate);
    add(x, h, 1);
    for (let k = 0; k < 8; k += 1) bubble(x, rate, R.between(0.04, 0.45), R.between(1400, 3000) * P.wet, R.between(0.004, 0.012), R.between(0.12, 0.3));
    return x;
  },
};

// ---------------------------------------------------------------- explosions (small <= 1 s, big <= 2.5 s)

const EXPLODE: Record<ExplosionSize, Make> = {
  small: (R, n, P, rate) => {
    const x = buf(rate, 0.95);
    const crack = burst(buf(rate, 0.95), rate, n(1), 0, env(0.0004, 0.006), 0.8, 0.04);
    add(x, hp(crack, 1500, rate), 1);
    thump(x, rate, 0, 135 * P.boom, 38 * P.boom, 0.16, 1.2, 0.025);
    const b = burst(buf(rate, 0.95), rate, n(2), 0, env(0.001, 0.19), 1);
    sweep(b, (t) => 5000 * Math.exp(-t / 0.09) + 280, 0.8, rate, "low");
    add(x, b, 1);
    debris(x, rate, R, n(3), 8, 0.06, 0.6, 0.2);
    const tail = burst(buf(rate, 0.95), rate, n(4), 0.03, env(0.04, 0.22 * P.tail), 0.6);
    return add(x, lp(lp(tail, 260, rate), 260, rate), 1.3);
  },
  // A building going up: a deep boom, a roar closing slowly, secondary blasts, falling rubble, a long rumble.
  big: (R, n, P, rate) => {
    const len = 2.3;
    const x = buf(rate, len);
    thump(x, rate, 0, 95 * P.boom, 22 * P.boom, 0.42, 1.5, 0.06);
    const b = burst(buf(rate, len), rate, n(1), 0, env(0.002, 0.45), 1);
    sweep(b, (t) => 3600 * Math.exp(-t / 0.22) + 130, 0.8, rate, "low");
    add(x, b, 1.1);
    for (let k = 0, m = R.int(2, 3); k < m; k += 1) {
      const t0 = R.between(0.22, 0.95);
      const a = R.between(0.45, 0.7);
      thump(x, rate, t0, 120 * P.boom, 35 * P.boom, 0.12, a, 0.02);
      const s = burst(buf(rate, len), rate, n(2 + k), t0, env(0.001, 0.12), a);
      add(x, sweep(s, (t) => (t < t0 ? 200 : 3000 * Math.exp(-(t - t0) / 0.07) + 250), 0.8, rate, "low"), 1);
    }
    debris(x, rate, R, n(6), 22, 0.2, 1.6, 0.3, 900, 3500);
    const r = burst(buf(rate, len), rate, n(7), 0.05, env(0.12, 0.55 * P.tail), 0.8);
    add(x, lp(lp(r, 160, rate), 160, rate), 1.8);
    return saturate(x, 1.3);
  },
};

// ---------------------------------------------------------------- deaths by body material (<= 1.2 s)

const DEATH: Record<DeathMaterial, Make> = {
  // Metal: a crunch, a clang, the frame collapsing in clanks, a last thud.
  metal: (R, n, P, rate) => {
    const len = 1.1;
    const x = buf(rate, len);
    const c = burst(buf(rate, len), rate, n(1), 0, env(0.001, 0.06), 1);
    add(x, saturate(bp(c, R.between(1500, 2100), 0.7, rate), 2.5), 0.9);
    const f = R.between(280, 480);
    add(x, ring(rate, len, f, P.metal, [0.6, 0.4, 0.25, 0.12], 0.28), 1);
    for (let k = 0, m = R.int(3, 4); k < m; k += 1) {
      const t0 = R.between(0.16, 0.7);
      add(x, ring(rate, len - t0, f * R.between(0.8, 1.35), P.metal, [0.35, 0.22, 0.12, 0.06], 0.1), 1, t0 * rate);
      thump(x, rate, t0, 150, 60, 0.05, 0.35, 0.01);
    }
    return thump(x, rate, R.between(0.62, 0.8), 105, 40, 0.14, 0.9, 0.02);
  },
  // Organic: a wet burst through a resonant falling band, a fleshy thump, splatter, a last squelch.
  organic: (R, n, P, rate) => {
    const len = 0.75;
    const x = buf(rate, len);
    const b = burst(buf(rate, len), rate, n(1), 0, env(0.003, 0.08), 1);
    const hi = R.between(2000, 2800) * P.wet;
    sweep(b, (t) => hi * Math.exp(-t / 0.08) + 320, 5, rate);
    add(x, b, 1.5);
    thump(x, rate, 0, 190, 70, 0.06, 0.8, 0.015);
    for (let k = 0; k < 10; k += 1) bubble(x, rate, R.between(0.02, 0.4), R.between(250, 900) * P.wet, R.between(0.012, 0.035), R.between(0.2, 0.4));
    const t0 = R.between(0.3, 0.4);
    const s = burst(buf(rate, len), rate, n(2), t0, env(0.01, 0.04), 0.5);
    return add(x, sweep(s, (t) => (t < t0 ? 900 : 900 - 400 * Math.min(1, (t - t0) / 0.1)), 6, rate), 1);
  },
  // Crystal: a crack, then shards pinging apart (dense first, sparser), a tinkle, the body's low note.
  crystal: (R, n, P, rate) => {
    const len = 1.1;
    const x = buf(rate, len);
    const c = burst(buf(rate, len), rate, n(1), 0, env(0.0003, 0.004), 1.4, 0.03);
    add(x, hp(c, 3000, rate), 1);
    for (let k = 0, m = R.int(16, 24); k < m; k += 1) {
      const t0 = -Math.log(1 - R.f() * 0.97) * 0.14;
      const f = R.between(2200, 8500) * P.pitch;
      add(x, ring(rate, Math.max(0.05, len - t0), f, [1, 2.32, 4.25], [0.3, 0.15, 0.08], R.between(0.05, 0.2), 0.0003), R.between(0.4, 1) * Math.exp(-t0 * 1.5), t0 * rate);
    }
    const t = burst(buf(rate, len), rate, n(2), 0, env(0.001, 0.15), 0.18);
    add(x, hp(t, 6000, rate), 1);
    return add(x, ring(rate, len, R.between(800, 1000), [1, 2.4], [0.3, 0.12], 0.15), 1);
  },
};

// ---------------------------------------------------------------- construction loops (seamless)

const BUILD: Record<BuildFlavour, { readonly len: number; readonly fade: number; readonly make: (R: Stream, n: (k: number) => Rnd, P: Palette, rate: number, len: number, total: number) => Samples }> = {
  // Machine: a motor's hum, welding crackle in two runs, hammer clanks between.
  machine: {
    len: 1.6, fade: 0.12,
    make: (R, n, P, rate, len, total) => {
      const x = buf(rate, total);
      const hz = whole(R.between(50, 70), len);
      osc(x, rate, 0, total, () => hz, () => 0.1, "saw");
      lp(x, 700, rate);
      const w = buf(rate, total);
      const rnd = n(1);
      const gate = n(2);
      const runs = [[R.between(0.02, 0.1), R.between(0.45, 0.55)], [R.between(0.9, 1.0), R.between(1.3, 1.4)]] as const;
      let g = 0.5;
      for (let i = 0; i < w.length; i += 1) {
        if (i % Math.round(rate * 0.004) === 0) g = 0.15 + 0.85 * Math.abs(gate());
        const t = i / rate;
        const on = runs.some(([a, b]) => t > a && t < b) ? 1 : 0.04;
        w[i] = rnd() * g * on;
      }
      add(x, hp(hp(w, 2600, rate), 2600, rate), 0.6);
      const f = R.between(700, 1000) * P.pitch;
      for (const t0 of [R.between(0.58, 0.62), R.between(0.74, 0.8), R.between(1.44, 1.5)]) {
        add(x, ring(rate, 0.25, f * R.between(0.95, 1.05), P.metal, [0.5, 0.3, 0.18, 0.08], 0.09), 1, t0 * rate);
        thump(x, rate, t0, 210, 90, 0.02, 0.5, 0.008);
      }
      return x;
    },
  },
  // Organic: a squelchy, growing churn (a resonant band breathing round the loop), bubbles, a slow heartbeat.
  organic: {
    len: 2, fade: 0.2,
    make: (R, n, P, rate, len, total) => {
      const x = burst(buf(rate, total), rate, n(1), 0, () => 1, 0.7);
      lp(x, 1100, rate);
      const k1 = R.int(2, 3);
      const ph = R.between(0, TAU);
      sweep(x, (t) => (360 + 220 * Math.sin((TAU * k1 * t) / len + ph) + 90 * Math.sin((TAU * 5 * t) / len)) * P.wet, 7, rate);
      for (let k = 0; k < 16; k += 1) bubble(x, rate, R.between(0, len - 0.05), R.between(220, 800) * P.wet, R.between(0.01, 0.03), R.between(0.08, 0.2));
      for (const t0 of [0.3, 0.48, 1.3, 1.48]) thump(x, rate, t0, 90, 48, 0.08, t0 % 1 > 0.4 ? 0.3 : 0.45, 0.02);
      for (let k = 0; k < 3; k += 1) {
        const t0 = R.between(0.1, len - 0.2);
        const s = burst(buf(rate, total), rate, n(2 + k), t0, env(0.02, 0.05), 0.4);
        add(x, sweep(s, (t) => (t < t0 ? 1500 : 1500 - 1000 * Math.min(1, (t - t0) / 0.15)), 8, rate), 1);
      }
      return x;
    },
  },
  // Energy / crystal: a hum of beating partials, a shimmer of high ones swelling in turn, faint crackle.
  energy: {
    len: 2, fade: 0.25,
    make: (R, n, P, rate, len, total) => {
      const x = buf(rate, total);
      const f0 = R.between(95, 130) * P.pitch;
      [1, 2, 3, 4].forEach((h, i) => {
        const a = [0.4, 0.25, 0.14, 0.08][i]!;
        const f = whole(f0 * h, len);
        osc(x, rate, 0, total, () => f, () => a, "sine", R.f());
        osc(x, rate, 0, total, () => f + 1 / len, () => a * 0.7, "sine", R.f()); // (one slow beat a loop)
      });
      for (let k = 0; k < 6; k += 1) {
        const f = whole(R.between(1800, 5200) * P.pitch, len);
        const m = R.int(1, 4);
        const p = R.between(0, TAU);
        osc(x, rate, 0, total, () => f, (t) => 0.06 * (0.5 + 0.5 * Math.sin((TAU * m * t) / len + p)) ** 2, "sine", R.f());
      }
      const c = buf(rate, total);
      debris(c, rate, R, n(1), 10, 0, len - 0.03, 0.08, 4000, 7000);
      const air = burst(buf(rate, total), rate, n(2), 0, () => 1, 0.03);
      return add(add(x, c), bp(air, 3000, 0.8, rate), 1);
    },
  },
};

// ---------------------------------------------------------------- making one

export interface BattleSampleOptions {
  readonly seed?: string | number | undefined;
  /** A preset ("clean" default, "lofi", "chip", "soft") or the wear itself. */
  readonly style?: BattleStyleName | string | Partial<BattleWear> | undefined;
  readonly variant?: number | undefined;
  /** The voice for stings, alerts and barks (default: voiceFor({ seed })). */
  readonly voice?: BattleVoice | VoiceSpec | undefined;
  readonly rate?: number | undefined;
}

/** A voice from a spec (a BattleVoice passes through). */
export const asVoice = (v: BattleVoice | VoiceSpec | undefined, seed: string | number): BattleVoice =>
  v && "id" in v && "f0" in v ? (v as BattleVoice) : voiceFor({ seed, ...(v as VoiceSpec | undefined) });

/**
 * One battle sound, synthesised: a mono Float32Array at `rate` (default
 * 44100), under full scale. The same name, seed, style, variant and voice
 * make the same bits. Loops (build.*) come back as one seamless cycle.
 * An unknown name is a RangeError.
 */
export function battleSample(name: string, { seed = "1", style, variant = 0, voice, rate = 44100 }: BattleSampleOptions = {}): Samples {
  if (!isBattleName(name)) throw new RangeError(`No battle sound "${name}" (battle sounds: ${[...BATTLE_SOUNDS, ...BATTLE_LOOPS].join(", ")})`);
  const [kind, which] = name.split(".") as [string, string];
  const count = variantsOf(name);
  const v = ((Math.trunc(variant) % count) + count) % count;
  const w = wearOf(style);
  const peak = PEAK[kind]!;
  if (kind === "sting" || kind === "alert" || kind === "bark") {
    const vo = asVoice(voice, seed);
    const x = kind === "sting" ? stingSample(which as StingKind, vo, rate) : kind === "alert" ? alertSample(which as AlertKind, vo, rate) : barkSample(which as BarkKind, vo, v, rate);
    return finish(x, rate, w, peak, 0.02);
  }
  const P = paletteOf(seed);
  const R = streamOf(`${seed}|battle|${name}|${v}`);
  const base = hash(`${seed}|battle|${name}|${v}|noise`);
  const n = (k: number) => noiseOf((base ^ Math.imul(k + 1, 2654435761)) >>> 0);
  if (kind === "build") {
    const b = BUILD[which as BuildFlavour];
    return finishLoop(b.make(R, n, P, rate, b.len, b.len + b.fade), rate, w, peak, b.fade);
  }
  const table = { fire: FIRE, hit: HIT, explode: EXPLODE, death: DEATH }[kind as "fire"] as Record<string, Make>;
  return finish(table[which]!(R, n, P, rate), rate, w, peak, kind === "explode" ? 0.25 : kind === "death" ? 0.08 : 0.02);
}
