// Bounded playback of the car generator through the engine's Tone context or raw Web Audio.
import { carSoundRecipe, carSoundSample, isCarLoop } from "./car.ts";
import type { CarSoundName, CarLoopName } from "./car.ts";
import type { ToneLike } from "./tone.ts";

export interface CarPlayParams { readonly profile?: string; readonly gain?: number; readonly rate?: number; readonly pan?: number; readonly cutoff?: number; readonly variant?: number; readonly priority?: number; /** Initial loop position, 0..1. Ignored for one-shots and voice updates. */ readonly phase?: number }
export interface CarVoice { readonly playing: boolean; set(p: CarPlayParams): void; stop(fade?: number): void }
export interface CarAudioOptions { readonly seed?: string; readonly out?: AudioNode; readonly maxVoices?: number; readonly maxCache?: number }
export interface CarAudio {
  play(name: CarSoundName, p?: CarPlayParams): CarVoice | null;
  loop(name: CarLoopName, p?: CarPlayParams): CarVoice | null;
  /** External generation is optional. The caller retains the FAL prompt/model/seed beside the adopted PCM. */
  adopt(name: CarSoundName, samples: Float32Array, sampleRate: number, variant?: number, profile?: string): void;
  readonly stats: { active: number; played: number; dropped: number; limited: number; rendered: number; cached: number; sources: string[] };
  volume: number;
  stop(): void;
  dispose(): void;
}
const bounded = (x: number | undefined, initial: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x !== undefined && Number.isFinite(x) ? x : initial));

export function createCarAudio(target: ToneLike | BaseAudioContext, options: CarAudioOptions = {}): CarAudio {
  const tone = typeof (target as ToneLike).getContext === "function" ? target as ToneLike : null;
  const ctx = tone ? tone.getContext().rawContext : target as BaseAudioContext;
  const output = ctx.createGain(); output.gain.value = 1;
  // Leave headroom; the shared runtime applies the master limiter after all buses.
  if (options.out) output.connect(options.out);
  else if (tone) tone.connect(output, tone.getDestination());
  else output.connect(ctx.destination);
  const max = bounded(options.maxVoices, 32, 4, 64), cacheMax = bounded(options.maxCache, 96, 8, 256);
  const cache = new Map<string, AudioBuffer>(), active = new Set<{ voice: CarVoice; priority: number; sourceName: string; end: () => void }>();
  const gaps = new Map<string, number>(), turns = new Map<string, number>();
  const stats = { active: 0, played: 0, dropped: 0, limited: 0, rendered: 0, cached: 0, sources: [] as string[] };
  let disposed = false;
  const remember = (key: string, buffer: AudioBuffer): AudioBuffer => {
    cache.delete(key); cache.set(key, buffer);
    while (cache.size > cacheMax) cache.delete(cache.keys().next().value!);
    stats.cached = cache.size;
    return buffer;
  };
  const sample = (name: CarSoundName, variant: number, profile = ""): AudioBuffer | null => {
    const key = `${profile}:${name}:${profile === "effects" || profile === "audition" ? 0 : variant}`, old = cache.get(key);
    if (old) return remember(key, old);
    if (profile) return null; // A missing adopted bank must never become the old oscillator engine.
    const pcm = carSoundSample(carSoundRecipe(name, options.seed ?? "redline", variant), ctx.sampleRate);
    const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate); buffer.getChannelData(0).set(pcm);
    stats.rendered++;
    return remember(key, buffer);
  };
  const start = (name: CarSoundName, p: CarPlayParams, loop: boolean): CarVoice | null => {
    if (disposed || bounded(p.gain, 1, 0, 1) <= 0) return null;
    const now = ctx.currentTime, priority = p.priority ?? (name.startsWith("ui.") ? 4 : loop ? 2 : 3);
    if (!loop && now - (gaps.get(name) ?? -Infinity) < (name.startsWith("ui.") ? .04 : .065)) { stats.limited++; return null; }
    if (active.size >= max) {
      const victim = [...active].find(v => v.priority < priority);
      if (victim) { victim.voice.stop(.008); } else { stats.dropped++; return null; }
      // Fading voices still count. Never exceed the cap to fit the replacement.
      stats.dropped++; return null;
    }
    const turn = turns.get(name) ?? 0, variant = bounded(p.variant, loop || name.startsWith("ui.") ? 0 : turn % 4, 0, 3) | 0;
    const buffer = sample(name, variant, p.profile);
    if (!buffer) { stats.dropped++; return null; }
    const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner(), filter = ctx.createBiquadFilter();
    source.buffer = buffer; source.loop = loop;
    filter.type = "lowpass"; filter.Q.value = .55;
    source.connect(filter).connect(gain).connect(pan).connect(output);
    const level = bounded(p.gain, 1, 0, 1);
    source.playbackRate.value = bounded(p.rate, 1, .2, 6) * (!loop && p.profile === "effects" ? [.98, 1.015, .995, 1.03][turn % 4]! : 1);
    filter.frequency.value = bounded(p.cutoff, 16000, 60, ctx.sampleRate * .45);
    pan.pan.value = bounded(p.pan, 0, -1, 1);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(level, now + .012);
    let playing = true, ending = false;
    const voice: CarVoice = {
      get playing() { return playing && !ending; },
      set(next) {
        if (!playing || ending) return;
        const t = ctx.currentTime;
        if (next.gain !== undefined) gain.gain.setTargetAtTime(bounded(next.gain, 0, 0, 1), t, .035);
        if (next.rate !== undefined) source.playbackRate.setTargetAtTime(bounded(next.rate, 1, .2, 6), t, .025);
        if (next.pan !== undefined) pan.pan.setTargetAtTime(bounded(next.pan, 0, -1, 1), t, .035);
        if (next.cutoff !== undefined) filter.frequency.setTargetAtTime(bounded(next.cutoff, 16000, 60, ctx.sampleRate * .45), t, .025);
      },
      stop(fade = .04) {
        if (!playing || ending) return;
        ending = true;
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setTargetAtTime(0, ctx.currentTime, Math.max(.001, fade / 4));
        source.stop(ctx.currentTime + Math.max(.005, fade));
      },
    };
    const record = { voice, priority, sourceName: `${p.profile ?? "procedural"}:${name}:${variant}`, end: () => {
      playing = false; source.disconnect(); filter.disconnect(); gain.disconnect(); pan.disconnect(); active.delete(record); stats.active = active.size; stats.sources = [...active].map(v => v.sourceName);
    } };
    source.onended = record.end;
    source.start(now, loop ? bounded(p.phase, 0, 0, .999999) * buffer.duration : 0);
    active.add(record); stats.active = active.size; stats.sources = [...active].map(v => v.sourceName); stats.played++;
    gaps.set(name, now); turns.set(name, turn + 1);
    return voice;
  };
  return {
    play: (name, p = {}) => start(name, p, false),
    loop: (name, p = {}) => { if (!isCarLoop(name)) throw new TypeError(`Not a loop: ${name}`); return start(name, p, true); },
    adopt(name, pcm, rate, variant = 0, profile = "") {
      if (disposed) return;
      if (!Number.isFinite(rate) || rate < 8000 || rate > 96000 || pcm.length < 8 || pcm.length > rate * 15 || pcm.some(v => !Number.isFinite(v) || Math.abs(v) > 1)) throw new TypeError("Invalid generated audio");
      const b = ctx.createBuffer(1, pcm.length, rate); b.getChannelData(0).set(pcm);
      remember(`${profile}:${name}:${bounded(variant, 0, 0, 3) | 0}`, b);
    },
    stats,
    get volume() { return output.gain.value; },
    set volume(v) { output.gain.setTargetAtTime(bounded(v, 0, 0, 1), ctx.currentTime, .025); },
    stop() { for (const v of active) v.voice.stop(); },
    dispose() { if (disposed) return; disposed = true; for (const v of [...active]) { v.voice.stop(.005); v.end(); } output.disconnect(); cache.clear(); stats.cached = 0; },
  };
}
