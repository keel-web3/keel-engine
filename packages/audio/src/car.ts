// The car sound generator. Recipes, seeds and variants are the source; PCM is disposable.
// Uses the same synthesis kit as battle.ts. No browser, network, or random global state.
import { streamOf } from "./score.ts";
import { add, bp, buf, burst, env, finish, finishLoop, hp, lp, noiseOf, osc, thump, wearOf, TAU } from "./synth.ts";

export const CAR_MATERIALS = ["metal", "concrete", "glass", "wood", "plastic", "rubber", "foliage", "brick", "water", "snow"] as const;
export type CarMaterial = typeof CAR_MATERIALS[number];
export const CAR_UI = ["move", "confirm", "back", "deny", "cash", "tab", "search", "found", "click", "digitize", "win"] as const;
export const CAR_LOOPS = ["engine.4", "engine.6", "engine.8", "engine.12", "engine.rotary", "engine.electric", "tyre.squeal", "tyre.drift", "tyre.brake", "brake.pads", "brake.gravel", "road.asphalt", "road.gravel", "road.grass", "road.wet", "road.snow", "fire.roar", "wind", "turbo", "nos", "fire", "rain", "machine"] as const;
export const CAR_SHOTS = [
  ...CAR_UI.map(n => `ui.${n}` as const), ...CAR_MATERIALS.map(n => `hit.${n}` as const),
  "glass.crack", "glass.shatter", "metal.scrape", "tyre.pop", "panel.drop", "pole.ring", "fire.start",
  "engine.start", "engine.stop", "engine.backfire", "engine.redline", "shift.up", "shift.down", "turbo.release", "nos.start", "nos.end",
  "land", "splash", "debris.brick", "debris.wood", "debris", "rustle", "horn", "reverse", "countdown", "go", "checkpoint", "finish", "crush", "hydraulic", "door", "repair",
] as const;
export type CarLoopName = typeof CAR_LOOPS[number];
export type CarShotName = typeof CAR_SHOTS[number];
export type CarSoundName = CarLoopName | CarShotName;
export const CAR_SOUNDS: readonly CarSoundName[] = [...CAR_SHOTS, ...CAR_LOOPS];
export const isCarLoop = (name: string): name is CarLoopName => (CAR_LOOPS as readonly string[]).includes(name);
export const isCarSound = (name: string): name is CarSoundName => (CAR_SOUNDS as readonly string[]).includes(name);
export const CAR_AUDIO_VERSION = 1;
export interface CarSoundRecipe {
  readonly generator: "keel/car-audio";
  readonly version: 1;
  readonly name: CarSoundName;
  readonly seed: string;
  readonly variant: number;
}
export function carSoundRecipe(name: CarSoundName, seed = "redline", variant = 0): CarSoundRecipe {
  if (!isCarSound(name)) throw new TypeError(`Unknown car sound: ${name}`);
  return { generator: "keel/car-audio", version: CAR_AUDIO_VERSION, name, seed, variant: Math.abs(Math.trunc(Number.isFinite(variant) ? variant : 0)) % 4 };
}

/** Repeatable PCM at the requested sample rate. Runtime pitch, energy, load and distance are mixed at playback. */
export function carSoundSample(recipe: CarSoundRecipe, rate = 44100): Float32Array<ArrayBuffer> {
  if (recipe.version !== CAR_AUDIO_VERSION || recipe.generator !== "keel/car-audio" || !isCarSound(recipe.name)) throw new TypeError("Unsupported car sound recipe");
  if (!Number.isFinite(rate) || rate < 8000 || rate > 96000) throw new RangeError("Audio sample rate must be 8000..96000");
  const { name } = recipe, R = streamOf(`${recipe.seed}|car:${recipe.version}|${name}|${recipe.variant}`);
  const rnd = noiseOf(R.int(1, 0x7fffffff)), pitch = R.between(.95, 1.05), clean = wearOf("clean");
  const noise = (seconds: number, decay: number, hz: number, q = .7): Float32Array<ArrayBuffer> =>
    bp(burst(buf(rate, seconds), rate, rnd, 0, env(.0015, decay), 1), hz, q, rate);
  const tone = (x: Float32Array<ArrayBuffer>, at: number, dur: number, hz: number, level: number, end = hz) =>
    osc(x, rate, at, dur, t => (hz * ((end / hz) ** (t / dur))) * pitch, t => level * env(.0025, dur / 5)(t));
  if (isCarLoop(name)) {
    const seconds = 1.2, x = buf(rate, seconds);
    if (name.startsWith("engine.")) {
      const kind = name.slice(7), cylinders = Number(kind) || (kind === "rotary" ? 6 : 4);
      // 1800 rpm reference. Uneven exhaust harmonics and intake texture; no sawtooth aliasing at high RPM.
      const fundamental = kind === "electric" ? 240 : 1800 / 120 * cylinders;
      for (let h = 1; h <= (kind === "electric" ? 4 : 16); h++) {
        const amplitude = kind === "electric" ? .14 / h : .24 / (h ** .82) * (h % 2 ? 1 : .65);
        const phase = R.between(0, 1);
        osc(x, rate, 0, seconds, () => fundamental * h, t => amplitude * (1 + .08 * Math.sin(TAU * 15 * t)), "sine", phase);
      }
      if (kind !== "electric") {
        const grit = lp(burst(buf(rate, seconds), rate, rnd, 0, () => .08, 1), 1700, rate);
        for (let i = 0; i < x.length; i++) x[i]! += grit[i]! * (.45 + .55 * Math.sin(TAU * fundamental * i / rate) ** 2);
      }
      return finishLoop(x, rate, clean, .52, .1);
    }
    const spec: Record<string, readonly [number, number, number]> = {
      "tyre.squeal": [2100, 4, .13], "tyre.drift": [1450, 2.5, .2], "tyre.brake": [2600, 5, .15],
      "brake.pads": [3100, 5, .1], "brake.gravel": [1600, .6, 0],
      "road.asphalt": [420, .7, 0], "road.gravel": [1800, .65, 0], "road.grass": [700, .5, 0], "road.wet": [3300, .55, 0], "road.snow": [1500, .55, 0], "fire.roar": [280, .6, 0],
      wind: [350, .5, 0], turbo: [3800, 3, .07], nos: [2700, .8, 0], fire: [550, .65, 0], rain: [3600, .55, 0], machine: [260, 1, .2],
    };
    const [hz, q, tonal] = spec[name]!;
    burst(x, rate, rnd, 0, () => 1, .38); bp(x, hz, q, rate);
    for (let i = 0; i < x.length; i++) {
      const t = i / rate;
      x[i]! *= .72 + .18 * Math.sin(t * TAU * 13) + .1 * Math.sin(t * TAU * 31);
      if (tonal) x[i]! += tonal * Math.sin(TAU * (hz * .52 * t + .65 * Math.sin(TAU * 7 * t)));
    }
    if (name === "road.gravel" || name === "fire") for (let i = 0; i < 25; i++) add(x, noise(.025, .006, R.between(600, 4400)), .25, R.between(0, 1.15) * rate);
    return finishLoop(x, rate, clean, .43, .12);
  }
  let x = buf(rate, 1);
  if (name.startsWith("ui.") || ["countdown", "go", "checkpoint", "finish"].includes(name)) {
    const n = name.startsWith("ui.") ? name.slice(3) : name;
    x = buf(rate, n === "win" || n === "finish" ? .95 : n === "search" || n === "digitize" ? .55 : .7);
    if (["win", "cash", "found", "finish", "checkpoint"].includes(n)) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone(x, i * .085, .42, f, .25); tone(x, i * .085, .2, f * 2, .035); });
    } else if (n === "digitize") {
      for (let k = 0; k < 8; k++) tone(x, k * .037, .032, 240 * 2 ** (k / 3), .12, 340 * 2 ** (k / 3));
      add(x, noise(.2, .045, 3400), .12); tone(x, .3, .2, 1046.5, .2, 1568);
    } else if (n === "search") [0, .11, .26].forEach((t, i) => tone(x, t, .1, 420 + i * 140, .17, 560 + i * 140));
    else if (n === "confirm" || n === "go") { tone(x, 0, .12, 523.25, .25); tone(x, .07, .2, 783.99, .25); }
    else if (n === "deny") tone(x, 0, .2, 145, .3, 110);
    else if (n === "back") tone(x, 0, .12, 440, .22, 220);
    else if (n === "tab") tone(x, 0, .08, 660, .2, 880);
    else if (n === "countdown") tone(x, 0, .18, 660, .25);
    else { tone(x, 0, .028, 1700, .12, 850); tone(x, 0, .05, 260, .3, 160); }
    return finish(x, rate, clean, .24);
  }
  if (name.startsWith("hit.")) {
    const material = name.slice(4) as CarMaterial;
    const profiles: Record<CarMaterial, readonly [number, number, number, number]> = {
      metal: [85, 1250, .16, 1], concrete: [55, 420, .085, .9], glass: [1900, 5100, .055, .3],
      wood: [180, 850, .045, .7], plastic: [320, 2100, .05, .5], rubber: [65, 180, .15, .75], foliage: [1300, 3600, .22, .12], brick: [110, 1800, .07, .85], water: [180, 2200, .2, .35], snow: [600, 4700, .025, .08],
    };
    const [f, colour, decay, body] = profiles[material];
    x = buf(rate, material === "glass" ? 1.05 : .85);
    thump(x, rate, 0, f * 1.7, f * .65, decay, body);
    add(x, noise(.65, decay, colour), material === "rubber" ? .14 : .9);
    if (material === "metal") for (let k = 0; k < 7; k++) { add(x, noise(.13, .025, R.between(700, 3500), 2), .36, (k * .045 + R.between(0, .025)) * rate); tone(x, .008, .55, 350 * [1, 2.71, 5.13][k % 3]!, .1 / (1 + k)); }
    if (material === "glass") for (let k = 0; k < 16; k++) tone(x, R.between(.025, .68), R.between(.08, .27), R.between(2600, 7200), .12);
    if (material === "wood" || material === "plastic") for (let k = 0; k < 4; k++) { const t = .02 + k * .07; thump(x, rate, t, f * (2 + k), f * 1.3, .022, .35); }
    if (material === "foliage") for (let k = 0; k < 9; k++) add(x, noise(.18, .04, R.between(1800, 4800)), .35, R.between(.03, .5) * rate);
  } else switch (name) {
    case "glass.shatter": return carSoundSample(carSoundRecipe("hit.glass", recipe.seed, recipe.variant), rate);
    case "glass.crack": x = noise(.16, .012, 4300); tone(x, 0, .04, 3200, .16); break;
    case "metal.scrape": x = noise(.42, .11, 2600, 4); tone(x, 0, .28, 1550, .08, 850); break;
    case "pole.ring": x = buf(rate, 1.4); [1, 2.71, 5.13].forEach((h, i) => tone(x, 0, 1.2 / (1 + i * .4), 410 * h, .4 / (i + 1))); break;
    case "panel.drop": case "door": x = noise(.45, .035, 900); thump(x, rate, 0, 180, 65, .07, .8); tone(x, .02, .3, 280, .17); break;
    case "tyre.pop": x = noise(.8, .24, 3200); thump(x, rate, 0, 190, 40, .06, 2); add(x, noise(.09, .008, 1400), 2); break;
    case "fire.start": case "engine.backfire": x = noise(name === "fire.start" ? .9 : .3, .07, 650); thump(x, rate, 0, 140, 38, .09, 1); break;
    case "engine.start": x = buf(rate, 1.1); for (let k = 0; k < 9; k++) { thump(x, rate, k * .052, 150 + k * 12, 48, .024, .65); } tone(x, .42, .65, 55, .6, 125); add(x, noise(.6, .13, 750), .3); break;
    case "engine.stop": x = buf(rate, .7); tone(x, 0, .65, 110, .7, 28); add(x, noise(.4, .09, 600), .28); break;
    case "engine.redline": x = buf(rate, .22); for (let k = 0; k < 5; k++) { thump(x, rate, k * .039, 220, 100, .012, .6); add(x, noise(.025, .006, 850), .35, k * .039 * rate); } break;
    case "shift.up": case "shift.down": x = noise(.22, .016, 1200); tone(x, .01, .14, name === "shift.up" ? 280 : 120, .6, name === "shift.up" ? 120 : 320); break;
    case "turbo.release": x = noise(.65, .18, 3600, 1.3); for (let i = 0; i < x.length; i++) x[i]! *= .55 + .45 * Math.sin(TAU * (16 * i / rate + 8 * (i / rate) ** 2)); break;
    case "nos.start": x = noise(.5, .15, 4200); thump(x, rate, 0, 80, 45, .12, .4); break;
    case "nos.end": x = noise(.32, .055, 1700); break;
    case "land": x = noise(.55, .095, 550); thump(x, rate, 0, 110, 38, .1, 1.2); thump(x, rate, .07, 150, 55, .05, .5); break;
    case "splash": x = noise(.95, .22, 2600, .5); thump(x, rate, 0, 160, 48, .08, .4); break;
    case "debris.brick": case "debris.wood": case "debris": x = buf(rate, .8); for (let k = 0; k < 12; k++) { const t = R.between(0, .55); add(x, noise(.065, .014, R.between(700, 3500)), .6, t * rate); thump(x, rate, t, R.between(240, 540), 120, .012, .12); } break;
    case "rustle": x = buf(rate, .8); for (let k = 0; k < 7; k++) add(x, noise(.24, .075, 2800, .5), .5, k * .07 * rate); break;
    case "horn": x = buf(rate, .65); [335, 405, 670, 810].forEach((f, i) => osc(x, rate, 0, .6, () => f, t => .2 / (1 + i) * Math.min(1, t / .012, (.6 - t) / .06))); break;
    case "reverse": x = buf(rate, .35); tone(x, 0, .3, 920, .35); break;
    case "crush": x = buf(rate, 1.8); for (let k = 0; k < 14; k++) { add(x, noise(.28, .045, R.between(400, 2200), 1.2), .55, k * .09 * rate); thump(x, rate, k * .1, 80, 35, .05, .55); } break;
    case "hydraulic": x = noise(1, .35, 750, 2); tone(x, 0, .85, 150, .18, 320); break;
    case "repair": x = buf(rate, .75); for (let k = 0; k < 9; k++) { add(x, noise(.04, .008, 1800), .4, k * .06 * rate); tone(x, k * .06, .065, 460, .3); } break;
    default: throw new TypeError(`No recipe for ${name}`);
  }
  return finish(x, rate, clean, name.startsWith("hit.") || name === "crush" ? .72 : .55);
}
