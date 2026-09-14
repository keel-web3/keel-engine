// What the audio tests share: the proof of concept's audio (the JS reference,
// imported straight from ../keel-pixel-engine, or POC=path) and NOCTURNES
// (../keel-nocturnes, or NOCTURNES=path), both read and never written; a
// plain AudioBuffer for Node; and a recording stand-in for Tone and Web Audio,
// so the player, the sfx and the sound can be compared call for call.

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const POC = resolve(process.env.POC ?? resolve(here, "../../../../keel-pixel-engine"));
export const NOCTURNES = resolve(process.env.NOCTURNES ?? resolve(here, "../../../../keel-nocturnes"));

/** A module of the proof of concept, typed as its port (they share an API). */
export const poc = async <T>(path: string): Promise<T> => (await import(pathToFileURL(`${POC}/${path}`).href)) as T;
/** A module of NOCTURNES (untyped: its own shapes). */
export const nocturnes = async (path: string): Promise<any> => import(pathToFileURL(`${NOCTURNES}/src/${path}`).href);

/** Float32Arrays identical to the bit. */
export const sameBits = (x: Float32Array, y: Float32Array): boolean =>
  x.length === y.length && Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength));

/** Node has no AudioBuffer: a plain one stands in (NOCTURNES and makeSamples make them). */
export function polyfillAudioBuffer(): void {
  const g = globalThis as { AudioBuffer?: unknown };
  g.AudioBuffer ??= class {
    length: number;
    sampleRate: number;
    numberOfChannels: number;
    data: Float32Array[];
    constructor({ length, sampleRate, numberOfChannels = 1 }: { length: number; sampleRate: number; numberOfChannels?: number }) {
      this.length = length; this.sampleRate = sampleRate; this.numberOfChannels = numberOfChannels;
      this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    }
    get duration() { return this.length / this.sampleRate; }
    copyToChannel(x: Float32Array, c = 0) { this.data[c]!.set(x); }
    getChannelData(c = 0) { return this.data[c]!; }
  };
}

// ---------------------------------------------------------------- a recording Tone / Web Audio

/** FNV over a sample array's bytes (logs carry buffers as their hash). */
const fnv = (x: Float32Array): string => {
  const b = new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  let h = 2166136261;
  for (let i = 0; i < b.length; i += 1) h = Math.imul(h ^ b[i]!, 16777619);
  return `f32:${x.length}:${(h >>> 0).toString(16)}`;
};

type Entry = unknown[];
/**
 * A stand-in for Tone (or an AudioContext) that makes nothing and writes down
 * everything asked of it: each object made (by class, in order), each method
 * called and each value set, with its arguments -- numbers exact, buffers by
 * hash, objects made here by their number.
 */
export function recorder({ sampleRate = 8000, bpm = 80 } = {}) {
  const log: Entry[] = [];
  const ids = new WeakMap<object, string>();
  let made = 0;
  const loops: ((time: number) => void)[] = [];
  const show = (v: unknown, depth = 0): unknown => {
    if (v === null || typeof v !== "object") return typeof v === "function" ? (ids.get(v) ?? "fn") : typeof v === "number" && !Number.isFinite(v) ? String(v) : v;
    if (ids.has(v)) return ids.get(v);
    if (v instanceof Float32Array) return v.length > 64 ? fnv(v) : [...v];
    const ab = v as { getChannelData?: (c: number) => Float32Array };
    if (typeof ab.getChannelData === "function") return `buffer:${fnv(ab.getChannelData(0))}`;
    if (depth > 4) return "…";
    if (Array.isArray(v)) return v.map((x) => show(x, depth + 1));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, show(x, depth + 1)]));
  };
  // A param: its value and its automation.
  const param = (owner: string, name: string, initial = 0) => {
    let value = initial;
    const p: Record<string, unknown> = {};
    for (const m of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setValueCurveAtTime", "rampTo", "exponentialRampTo", "setTargetAtTime", "cancelScheduledValues"]) {
      p[m] = (...args: unknown[]) => { log.push([owner, `${name}.${m}`, ...args.map((a) => show(a))]); return p; };
    }
    Object.defineProperty(p, "value", { get: () => value, set: (v: number) => { value = v; log.push([owner, `${name}=`, show(v)]); } });
    ids.set(p, `${owner}.${name}`);
    return p;
  };
  const PARAMS = new Set(["gain", "frequency", "volume", "delayTime", "playbackRate", "pan", "bpm", "detune", "Q"]);
  // An object: params by name, `ready` resolved, everything else a method that returns the object (chains work).
  const node = (cls: string, args: unknown[]) => {
    const id = `${cls}#${(made += 1)}`;
    log.push(["new", cls, id, ...args.map((a) => show(a))]);
    const params: Record<string, unknown> = {};
    const fields: Record<string, unknown> = {};
    const target = {} as Record<string | symbol, unknown>;
    const self: object = new Proxy(target, {
      get(_, k) {
        if (typeof k === "symbol" || k === "then") return undefined;
        if (k === "ready") return Promise.resolve();
        if (k in fields) return fields[k];
        if (PARAMS.has(k)) return (params[k] ??= param(id, k, k === "bpm" ? bpm : 0));
        return (...a: unknown[]) => { log.push([id, k, ...a.map((x) => show(x))]); return self; };
      },
      set(_, k, v) { fields[k as string] = v; log.push([id, `${String(k)}=`, show(v)]); return true; },
    });
    ids.set(self, id);
    if (cls === "Loop") loops.push(args[0] as (time: number) => void);
    return self;
  };
  // A class: `new Tone.X(...)` makes a recorded object; it has a prototype with dispose (the player's proxy looks).
  const classes = new Map<string, unknown>();
  const cls = (name: string) => {
    if (!classes.has(name)) {
      const C = function (this: unknown, ...args: unknown[]) { return node(name, args); } as unknown as { prototype: { dispose(): void } };
      C.prototype = { dispose() {} };
      ids.set(C as object, `class:${name}`);
      classes.set(name, C);
    }
    return classes.get(name);
  };
  const transport = node("Transport", []);
  const destination = node("Destination", []);
  const raw = {
    sampleRate, currentTime: 0, destination: node("ctx.destination", []),
    createBuffer: (channels: number, length: number, rate: number) => {
      const B = (globalThis as unknown as { AudioBuffer: new (o: object) => object }).AudioBuffer;
      return new B({ length, sampleRate: rate, numberOfChannels: channels });
    },
    createGain: () => node("ctx.Gain", []), createDelay: (m: number) => node("ctx.Delay", [m]), createBiquadFilter: () => node("ctx.Biquad", []),
    createBufferSource: () => node("ctx.BufferSource", []), createStereoPanner: () => node("ctx.Panner", []),
  };
  const context = { sampleRate, rawContext: raw };
  const tone: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get(_, k) {
      if (typeof k === "symbol") return undefined;
      if (k === "getTransport") return () => transport;
      if (k === "getDestination") return () => destination;
      if (k === "getContext") return () => context;
      if (k === "now") return () => 0;
      if (k === "start") return async () => { log.push(["Tone", "start"]); };
      if (k === "connect") return (a: unknown, b: unknown) => { log.push(["Tone", "connect", show(a), show(b)]); };
      // (Seconds from Tone's notation at the transport's tempo now.)
      if (k === "Time") return (v: string | number) => ({ toSeconds: () => (typeof v === "number" ? v : ({ "16n": 0.25, "8n": 0.5, "8n.": 0.75, "4n": 1, "4n.": 1.5, "2n": 2, "1m": 4 } as Record<string, number>)[v]! * (60 / (transport as { bpm: { value: number } }).bpm.value)) });
      if (/^[A-Z]/.test(k)) return cls(k);
      return undefined;
    },
  });
  return { tone, ctx: raw, log, loops };
}
