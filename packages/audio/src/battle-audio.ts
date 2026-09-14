// Battle audio on a page: the RTS's sounds (src/battle.ts, src/voice.ts)
// played through a pooled set of voices -- at most `maxVoices` at once; when
// full a new sound steals the lowest-priority (then oldest) one below it or is
// dropped and counted; the same name at most every `minGap` seconds; every
// (name, variant, voice) rendered once and kept. Into Tone's destination (or
// the context's, or `out`), as createSfx plays, so KEEL's volume and mute
// cover it.
//
//   const battle = createBattleAudio(Tone | audioContext, { seed, voice: voiceFor({ seed: race.seed, timbre: "machine" }) });
//   battle.play("fire.kinetic", { pan: panFor(sx, width), gain: distanceGain(d) });
//   battle.play("alert.underAttack");                               // (priority 5: it gets through)
//   battle.play("bark.select", { voice: voiceFor({ seed: race.seed, timbre: "machine", size: 1.3 }) });
//   const site = battle.loop("build.machine", { pan: -0.2 }); site.set({ gain: 0.5 }); site.stop();
//   battle.stats; // { played, dropped, limited, stolen, active }

import { BATTLE_LOOPS, BATTLE_SOUNDS, asVoice, battleSample, isBattleLoop, isBattleName, isVoiced, variantsOf } from "./battle.ts";
import type { BattleName } from "./battle.ts";
import { streamOf } from "./score.ts";
import type { BattleStyleName, BattleWear, Samples } from "./synth.ts";
import type { ToneLike } from "./tone.ts";
import type { BattleVoice, VoiceSpec } from "./voice.ts";

const clamp = (x: unknown, lo: number, hi: number, dflt = lo): number => {
  const v = typeof x === "number" ? x : Number(x);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
};

/** Where a thing on screen sits in the stereo field: -1 (left edge) .. 1 (right), `spread` of the way out (default 0.85). */
export const panFor = (screenX: number, screenWidth: number, spread = 0.85): number =>
  clamp(((clamp(screenX, -1e9, 1e9, 0) / Math.max(1, clamp(screenWidth, 1, 1e9, 1))) * 2 - 1) * clamp(spread, 0, 1, 0.85), -1, 1, 0);

/**
 * How loud a thing `distance` away is (0..1): full within `near`, then falling
 * as near / (near + rolloff (d - near)) and faded to 0 at `far`. Distances are
 * the game's own units (world cells, or pixels from the view's centre).
 */
export function distanceGain(distance: number, { near = 8, far = 48, rolloff = 1 }: { readonly near?: number; readonly far?: number; readonly rolloff?: number } = {}): number {
  const d = clamp(distance, 0, 1e9, 0);
  if (d <= near) return 1;
  if (d >= far) return 0;
  const inv = Math.max(near, 1e-3) / (Math.max(near, 1e-3) + Math.max(0, rolloff) * (d - near));
  const edge = 1 - ((d - near) / Math.max(1e-6, far - near)) ** 2;
  return clamp(inv * edge, 0, 1, 0);
}

/** How important a sound is by default (a louder claim on a voice): alerts, stings and barks over the din. */
export function priorityOf(name: string): number {
  if (name.startsWith("alert.")) return 5;
  if (name.startsWith("sting.")) return 4;
  if (name.startsWith("bark.") || name === "explode.big") return 3;
  if (name.startsWith("death.") || name.startsWith("explode.") || name.startsWith("build.")) return 2;
  return 1; // (fire.*, hit.*)
}

export interface BattlePlayParams {
  /** -1 (left) .. 1 (right): panFor(screenX, screenWidth). */
  readonly pan?: number | undefined;
  /** 0-2 (distanceGain(d) is 0-1). */
  readonly gain?: number | undefined;
  /** Playback rate (pitch and speed), 0.25-4. */
  readonly rate?: number | undefined;
  /** Which seeded variant (none: in turn). */
  readonly variant?: number | undefined;
  /** A claim on a voice when the pool is full (default priorityOf(name)); a sound steals only from lower ones. */
  readonly priority?: number | undefined;
  /** The context's time to start (default now). */
  readonly when?: number | undefined;
  /** The voice for sting.*, alert.*, bark.* (default the player's). */
  readonly voice?: BattleVoice | VoiceSpec | undefined;
}
export interface BattleLoopParams extends BattlePlayParams {}
/** A one-shot playing. */
export interface BattleSound {
  readonly name: string;
  readonly variant: number;
  readonly priority: number;
  readonly start: number;
  readonly end: number;
  stop(fade?: number): void;
}
/** A held loop. */
export interface BattleLoop {
  readonly playing: boolean;
  set(p?: Pick<BattlePlayParams, "gain" | "pan" | "rate" | "when">, ramp?: number): void;
  stop(fade?: number, at?: number): void;
}
export interface BattleStats {
  /** Sounds started (loops included). */
  readonly played: number;
  /** Refused: the pool full and nothing lower to steal. */
  readonly dropped: number;
  /** Refused: the same name again inside minGap. */
  readonly limited: number;
  /** Cut short to make room for something more important. */
  readonly stolen: number;
  /** Voices in use now. */
  readonly active: number;
  /** Samples rendered (and kept). */
  readonly rendered: number;
}
export interface BattleAudioOptions {
  readonly seed?: string | number | undefined;
  /** "clean" (default), "lofi", "chip", "soft", or the wear itself. */
  readonly style?: BattleStyleName | string | Partial<BattleWear> | undefined;
  /** The most sounds at once (default 12). */
  readonly maxVoices?: number | undefined;
  /** The same name at most this often, seconds (default 0.04). */
  readonly minGap?: number | undefined;
  /** The voice for stings, alerts and barks when a play gives none (default voiceFor({ seed })). */
  readonly voice?: BattleVoice | VoiceSpec | undefined;
  /** A node to play into (none: Tone's destination, or the context's). */
  readonly out?: AudioNode | null | undefined;
  readonly volume?: number | undefined;
  /** +/- spread of fire.* and hit.* rates from play to play (default 0.03). */
  readonly jitter?: number | undefined;
}
export interface BattleAudio {
  readonly context: BaseAudioContext;
  readonly voice: BattleVoice;
  volume: number;
  readonly stats: BattleStats;
  /** A one-shot, or null (unknown name, rate-limited, or dropped). */
  play(name: BattleName | string, p?: BattlePlayParams): BattleSound | null;
  /** A construction loop (build.*), faded in; a quiet handle when refused. */
  loop(name: BattleName | string, p?: BattleLoopParams): BattleLoop;
  /** Render ahead (during loading): every variant of these names (default all but the voiced) in these voices. Returns how many are cached. */
  prerender(names?: readonly string[], voices?: readonly (BattleVoice | VoiceSpec)[]): number;
  /**
   * Render ahead a little at a time (a game's spare frame time): samples one by one -- these names (default all but
   * the voiced) in these voices -- until `ms` is spent. Returns how many are still to go (0: all cached). A sample is
   * the floor: one never renders in part.
   */
  prerenderStep(ms: number, names?: readonly string[], voices?: readonly (BattleVoice | VoiceSpec)[]): number;
  /**
   * Take a sample made elsewhere -- battleSample() during a loading screen, before there's a context -- as this
   * player's (name, variant, voice): it's never rendered here. `rate` is the rate it was made at (default the
   * context's). Returns false for an unknown name.
   */
  adopt(name: string, variant: number, samples: Float32Array, voice?: BattleVoice | VoiceSpec, rate?: number): boolean;
  /** Everything playing, faded out. */
  stop(fade?: number): void;
  dispose(): void;
}

const isTone = (t: ToneLike | BaseAudioContext): t is ToneLike =>
  typeof (t as Partial<ToneLike>).getContext === "function" && typeof (t as Partial<ToneLike>).getDestination === "function";

interface Slot {
  readonly name: string;
  readonly variant: number;
  readonly priority: number;
  readonly start: number;
  end: number;
  readonly src: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly pan: StereoPannerNode | null;
  gone: boolean;
  onStolen?: () => void;
}

/**
 * Battle audio on `target`: Tone (its context and destination -- where
 * KEEL's volume and mute apply) or an AudioContext / OfflineAudioContext, as
 * createSfx takes. { seed, style, maxVoices = 12, minGap = 0.04, voice, out,
 * volume = 0.8, jitter = 0.03 }.
 */
const now = (): number => (globalThis.performance ? performance.now() : Date.now());

export function createBattleAudio(target: ToneLike | BaseAudioContext, options: BattleAudioOptions = {}): BattleAudio {
  const seed = options.seed ?? "1";
  const style = options.style ?? "clean";
  const maxVoices = Math.max(1, Math.round(clamp(options.maxVoices ?? 12, 1, 256, 12)));
  const minGap = clamp(options.minGap ?? 0.04, 0, 10, 0.04);
  const spread = clamp(options.jitter ?? 0.03, 0, 0.5, 0.03);
  const tone = isTone(target) ? target : null;
  const ctx: BaseAudioContext = tone ? tone.getContext().rawContext : (target as BaseAudioContext);
  const rate = ctx.sampleRate;
  const voice = asVoice(options.voice, seed);
  const master = ctx.createGain();
  master.gain.value = clamp(options.volume ?? 0.8, 0, 1.5, 0.8);
  // (Into `out`, Tone's destination -- where KEEL's volume and mute apply -- or the context's.)
  const bus: AudioNode = options.out ?? (tone ? ctx.createGain() : ctx.destination);
  if (!options.out && tone) tone.connect(bus, tone.getDestination());
  master.connect(bus);

  const cache = new Map<string, AudioBuffer>();
  const voices = new Map<string, BattleVoice>();
  const voiceOf = (v: BattleVoice | VoiceSpec | undefined): BattleVoice => {
    if (!v) return voice;
    if ("id" in v && "f0" in v) return v as BattleVoice;
    const key = JSON.stringify([v.seed, v.timbre, v.size, v.root, v.hue]);
    let got = voices.get(key);
    if (!got) { got = asVoice(v, seed); voices.set(key, got); }
    return got;
  };
  const bufferOf = (name: string, variant: number, v: BattleVoice): AudioBuffer => {
    const key = `${name}|${variant}|${isVoiced(name) ? v.id : ""}`;
    let b = cache.get(key);
    if (!b) {
      const x: Samples = battleSample(name, { seed, style, variant, voice: v, rate });
      b = ctx.createBuffer(1, x.length, rate);
      b.copyToChannel(x, 0);
      cache.set(key, b);
    }
    return b;
  };

  const J = streamOf(`${seed}|battle|play`);
  const turn = new Map<string, number>();
  const last = new Map<string, number>();
  const active: Slot[] = [];
  const counts = { played: 0, dropped: 0, limited: 0, stolen: 0 };
  const prune = (now: number) => { for (let i = active.length - 1; i >= 0; i -= 1) if (active[i]!.gone || active[i]!.end <= now) active.splice(i, 1); };
  const release = (s: Slot, fade: number, at: number) => {
    if (s.gone) return;
    s.gone = true;
    const i = active.indexOf(s);
    if (i >= 0) active.splice(i, 1);
    s.gain.gain.cancelScheduledValues(at);
    s.gain.gain.setValueAtTime(s.gain.gain.value, at);
    s.gain.gain.linearRampToValueAtTime(0, at + fade);
    s.src.stop(at + fade + 0.01);
  };
  /** Room for one more at `priority`: true when there's a voice (stealing if it must), false when it's dropped. */
  const room = (priority: number, now: number): boolean => {
    prune(now);
    if (active.length < maxVoices) return true;
    let victim: Slot | null = null;
    for (const s of active) if (s.priority < priority && (!victim || s.priority < victim.priority || (s.priority === victim.priority && s.start < victim.start))) victim = s;
    if (!victim) { counts.dropped += 1; return false; }
    counts.stolen += 1;
    victim.onStolen?.();
    release(victim, 0.012, now);
    return true;
  };
  const start = (name: string, p: BattlePlayParams, loop: boolean): Slot | null => {
    if (!isBattleName(name) || isBattleLoop(name) !== loop) return null;
    const now = ctx.currentTime;
    const when = Math.max(now, clamp(p.when ?? now, 0, 1e12, now));
    const prev = last.get(name);
    if (!loop && prev !== undefined && Math.abs(when - prev) < minGap) { counts.limited += 1; return null; }
    const priority = clamp(p.priority ?? priorityOf(name), -1e6, 1e6, 1);
    if (!room(priority, now)) return null;
    last.set(name, when);
    const count = variantsOf(name);
    let variant: number;
    if (p.variant !== undefined && Number.isFinite(p.variant)) variant = ((Math.trunc(p.variant) % count) + count) % count;
    else { variant = ((turn.get(name) ?? -1) + 1 + (count > 2 && J.chance(0.3) ? 1 : 0)) % count; turn.set(name, variant); }
    const b = bufferOf(name, variant, voiceOf(p.voice));
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = loop;
    const gain = ctx.createGain();
    const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
    src.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(master); } else gain.connect(master);
    const jit = !loop && spread > 0 && (name.startsWith("fire.") || name.startsWith("hit.")) ? 1 + J.between(-spread, spread) : 1;
    const r = clamp(p.rate ?? 1, 0.25, 4, 1) * jit;
    src.playbackRate.value = r;
    if (pan) pan.pan.value = clamp(p.pan ?? 0, -1, 1, 0);
    const g = clamp(p.gain ?? 1, 0, 2, 1);
    if (loop) { gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(g, when + 0.05); src.start(when, J.between(0, b.duration)); }
    else { gain.gain.value = g; src.start(when); }
    const s: Slot = { name, variant, priority, start: when, end: loop ? Infinity : when + b.duration / r, src, gain, pan, gone: false };
    src.onended = () => { s.gone = true; const i = active.indexOf(s); if (i >= 0) active.splice(i, 1); };
    active.push(s);
    counts.played += 1;
    return s;
  };

  const quiet: BattleLoop = { playing: false, set() {}, stop() {} };
  const api: BattleAudio = {
    get context() { return ctx; },
    voice,
    get volume() { return master.gain.value; },
    set volume(v) { master.gain.value = clamp(v, 0, 1.5, 0.8); },
    get stats() { prune(ctx.currentTime); return { ...counts, active: active.length, rendered: cache.size }; },
    play(name, p = {}) {
      const s = start(name, p, false);
      if (!s) return null;
      return {
        name, variant: s.variant, priority: s.priority, start: s.start, end: s.end,
        stop: (fade = 0.03) => release(s, fade, ctx.currentTime),
      };
    },
    loop(name, p = {}) {
      const s = start(name, p, true);
      if (!s) return { ...quiet };
      const h: { playing: boolean } & BattleLoop = {
        playing: true,
        set(q = {}, ramp = 0.08) {
          if (!h.playing) return;
          const t = q.when ?? ctx.currentTime;
          if (q.gain !== undefined) s.gain.gain.setTargetAtTime(clamp(q.gain, 0, 2, 1), t, ramp / 3);
          if (q.rate !== undefined) s.src.playbackRate.setTargetAtTime(clamp(q.rate, 0.25, 4, 1), t, ramp / 3);
          if (q.pan !== undefined && s.pan) s.pan.pan.setTargetAtTime(clamp(q.pan, -1, 1, 0), t, ramp / 3);
        },
        stop(fade = 0.15, at = ctx.currentTime) { if (!h.playing) return; h.playing = false; release(s, fade, at); },
      };
      s.onStolen = () => { h.playing = false; };
      return h;
    },
    prerenderStep(ms, names, list) {
      const want = names ?? [...BATTLE_SOUNDS, ...BATTLE_LOOPS].filter((n) => !isVoiced(n));
      const vs = (list ?? [undefined]).map(voiceOf);
      const until = now() + Math.max(0, ms);
      let left = 0, done = 0;
      for (const name of want) {
        if (!isBattleName(name)) continue;
        for (let v = 0; v < variantsOf(name); v += 1) for (const vo of isVoiced(name) ? vs : [voice]) {
          if (cache.has(`${name}|${v}|${isVoiced(name) ? vo.id : ""}`)) continue;
          // (Some time given: at least one sample, then as many as fit.)
          if (ms > 0 && (done === 0 || now() < until)) { bufferOf(name, v, vo); done += 1; } else left += 1;
        }
      }
      return left;
    },
    adopt(name, variant, samples, v, at) {
      if (!isBattleName(name)) return false;
      const vo = voiceOf(v);
      const key = `${name}|${variant}|${isVoiced(name) ? vo.id : ""}`;
      if (cache.has(key)) return true;
      const b = ctx.createBuffer(1, Math.max(1, samples.length), at ?? rate);
      b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      cache.set(key, b);
      return true;
    },
    prerender(names, list) {
      const want = names ?? [...BATTLE_SOUNDS, ...BATTLE_LOOPS].filter((n) => !isVoiced(n));
      const vs = (list ?? [undefined]).map(voiceOf);
      for (const name of want) {
        if (!isBattleName(name)) continue;
        for (let v = 0; v < variantsOf(name); v += 1) for (const vo of isVoiced(name) ? vs : [voice]) bufferOf(name, v, vo);
      }
      return cache.size;
    },
    stop(fade = 0.1) { const now = ctx.currentTime; for (const s of [...active]) { s.onStolen?.(); release(s, fade, now); } },
    dispose() { api.stop(0.02); try { master.disconnect(); } catch { /* (already gone) */ } },
  };
  return api;
}
