// Tone, as far as the engine uses it. Tone is a global the page provides (a
// KEEL piece `extends` it; locally vendor/tone-15.1.22-native.js), never
// bundled: these are the few shapes the player, the sound and the sfx touch,
// not Tone's own types.

/** A Tone signal or param: a value that can be set and ramped on the context's clock. */
export interface ToneParam {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setValueCurveAtTime(values: ArrayLike<number>, time: number, duration: number): unknown;
  rampTo(value: number, ramp: number | string, time?: number): unknown;
  exponentialRampTo(value: number, ramp: number | string, time?: number): unknown;
}
/** Anything that can be connected to or from. */
export type ToneInput = ToneNode | ToneParam | AudioNode | AudioParam;
export interface ToneNode {
  connect(to: ToneInput): this;
  chain(...nodes: ToneInput[]): this;
  fan(...nodes: ToneInput[]): this;
  dispose(): this;
}
export interface ToneSource extends ToneNode {
  start(time?: number | string): this;
}
export interface ToneGain extends ToneNode { readonly gain: ToneParam }
export interface ToneFilter extends ToneNode { readonly frequency: ToneParam }
export interface ToneVolume extends ToneNode { readonly volume: ToneParam }
export interface ToneDelay extends ToneNode { readonly delayTime: ToneParam }
export interface ToneOscillator extends ToneSource { readonly frequency: ToneParam }
export interface ToneReverb extends ToneNode { readonly ready: Promise<void> }
/** Samplers and synths: notes as Hz (or chords), durations in seconds or Tone's notation. */
export interface ToneInstrument extends ToneNode {
  readonly volume: ToneParam;
  triggerAttackRelease(note: number | readonly number[], duration: number | string, time?: number, velocity?: number): this;
  triggerAttack(note: number | readonly number[], time?: number, velocity?: number): this;
}
/** A NoiseSynth has no note. */
export interface ToneNoiseSynth extends ToneNode {
  triggerAttackRelease(duration: number | string, time?: number, velocity?: number): this;
}
export interface ToneTransport {
  readonly bpm: ToneParam;
  swing: number;
  swingSubdivision: string;
  position: number | string;
  readonly ticks: number;
  readonly PPQ: number;
  readonly seconds: number;
  start(time?: number | string): this;
  stop(time?: number | string): this;
}
export interface ToneContextLike {
  readonly sampleRate: number;
  readonly rawContext: BaseAudioContext;
}
/** What Tone.Offline resolves to: a ToneAudioBuffer (get() -> AudioBuffer), or an AudioBuffer. */
export type ToneRendered = AudioBuffer | { get(): AudioBuffer | undefined };

type Opts = Record<string, unknown>;
/** A Tone class: `new Tone.Gain(0.5)`, `new Tone.Filter({ ... })`. */
export type ToneClass<T, A extends unknown[] = [Opts?]> = (new (...args: A) => T) & { readonly prototype: { dispose(): unknown } };

/** The Tone global, as the engine uses it. */
export interface ToneLike {
  start(): Promise<void>;
  now(): number;
  getContext(): ToneContextLike;
  getDestination(): ToneVolume;
  getTransport(): ToneTransport;
  Time(value: number | string): { toSeconds(): number };
  Offline(fn: () => Promise<void> | void, duration: number, channels?: number, sampleRate?: number): Promise<ToneRendered>;
  /** Connect a raw Web Audio node into a Tone node (Tone.connect). */
  connect(from: AudioNode, to: ToneInput): void;

  Gain: ToneClass<ToneGain, [number?] | [Opts?]>;
  Volume: ToneClass<ToneVolume, [number?]>;
  Filter: ToneClass<ToneFilter>;
  Delay: ToneClass<ToneDelay>;
  FeedbackDelay: ToneClass<ToneNode>;
  Tremolo: ToneClass<ToneNode & { start(time?: number): ToneNode }>;
  Vibrato: ToneClass<ToneNode>;
  Compressor: ToneClass<ToneNode>;
  Distortion: ToneClass<ToneNode>;
  Reverb: ToneClass<ToneReverb>;
  Limiter: ToneClass<ToneNode, [number?]>;
  WaveShaper: ToneClass<ToneNode, [(x: number) => number, number?]>;
  LFO: ToneClass<ToneSource>;
  Noise: ToneClass<ToneSource, [string?]>;
  Oscillator: ToneClass<ToneOscillator, [number?, string?]>;
  Sampler: ToneClass<ToneInstrument, [{ urls: Record<number | string, AudioBuffer>; release?: number }]>;
  Synth: ToneClass<ToneInstrument>;
  MonoSynth: ToneClass<ToneInstrument>;
  FMSynth: ToneClass<ToneInstrument>;
  NoiseSynth: ToneClass<ToneNoiseSynth>;
  PolySynth: ToneClass<ToneInstrument, [unknown, Opts?]>;
  Loop: ToneClass<{ start(time?: number): unknown; dispose(): unknown }, [(time: number) => void, string | number]>;
}

/** KEEL's audio module (globalThis.KEEL_AUDIO, keel-audio 1.0.0): the context, the gesture, the button, the listener's volume. */
export interface KeelAudioLike {
  configure(opts: { id: string }): unknown;
  onStart(fn: () => void): unknown;
  onStop(fn: () => void): unknown;
  mountButton(host: HTMLElement | null, opts: { corner: string }): unknown;
  start(): unknown;
  stop(): unknown;
  volume: number;
}

/** The page's Tone, if it has one. */
export const pageTone = (): ToneLike | null => (globalThis as { Tone?: ToneLike }).Tone ?? null;
/** The page's KEEL audio module, if it has one. */
export const pageKeelAudio = (): KeelAudioLike | null => (globalThis as { KEEL_AUDIO?: KeelAudioLike }).KEEL_AUDIO ?? null;
