// Loops as files, and what a loop measures: a 16-bit WAV from channels, and
// the numbers that say a loop sounds and goes round without a seam (its level,
// its peak, and the step across the wrap against the steps inside it).

type Channel = ArrayLike<number>;

/** A 16-bit PCM WAV (bytes) from Float32Array channels. */
export function encodeWav(channels: readonly Channel[], rate = 44100): Uint8Array<ArrayBuffer> {
  const ch = channels.length;
  const n = channels[0]!.length;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i += 1) dv.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); dv.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, n * ch * 2, true);
  for (let i = 0; i < n; i += 1) for (let c = 0; c < ch; c += 1) dv.setInt16(44 + (i * ch + c) * 2, Math.max(-32768, Math.min(32767, Math.round(channels[c]![i]! * 32767))), true);
  return new Uint8Array(dv.buffer);
}

const db = (x: number): number => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10;
const rmsOf = (x: Channel, a: number, b: number): number => { let s = 0; for (let i = a; i < b; i += 1) s += x[i]! * x[i]!; return Math.sqrt(s / Math.max(1, b - a)); };

/** What a loop measures. */
export interface LoopMeasure {
  readonly seconds: number;
  /** RMS level, dB. */
  readonly rmsDb: number;
  readonly peak: number;
  /** Samples that aren't finite. */
  readonly nan: number;
  readonly headDb: number;
  readonly tailDb: number;
  readonly edgeDiffDb: number;
  /** The step across the wrap (last -> first). */
  readonly wrapStep: number;
  /** The 99th-percentile step inside the loop. */
  readonly stepP99: number;
  /** The wrap is a step like the music's own. */
  readonly seamless: boolean;
}

/**
 * What a loop measures: level (RMS dB) and peak; the first and last `edge`
 * seconds' levels (a loop that goes round has them alike); and the seam --
 * the sample step across the wrap (last -> first) against the 99th-percentile
 * step inside the loop (a click is a step far bigger than any the music makes).
 */
export function measureLoop(channels: readonly Channel[], rate = 44100, { edge = 0.05 }: { readonly edge?: number } = {}): LoopMeasure {
  const n = channels[0]!.length;
  const e = Math.min(n >> 1, Math.round(edge * rate));
  let peak = 0;
  let sum = 0;
  let nan = 0;
  const steps: number[] = [];
  let wrap = 0;
  for (const x of channels) {
    for (let i = 0; i < n; i += 1) { const v = x[i]!; if (!Number.isFinite(v)) nan += 1; else { peak = Math.max(peak, Math.abs(v)); sum += v * v; } }
    for (let i = 1; i < n; i += 7) steps.push(Math.abs(x[i]! - x[i - 1]!));
    wrap = Math.max(wrap, Math.abs(x[0]! - x[n - 1]!));
  }
  steps.sort((a, b) => a - b);
  const p99 = steps[Math.floor(steps.length * 0.99)] ?? 0;
  const head = Math.max(...channels.map((x) => rmsOf(x, 0, e)));
  const tail = Math.max(...channels.map((x) => rmsOf(x, n - e, n)));
  return {
    seconds: Math.round((n / rate) * 1000) / 1000, rmsDb: db(Math.sqrt(sum / (n * channels.length))), peak: Math.round(peak * 1000) / 1000, nan,
    headDb: db(head), tailDb: db(tail), edgeDiffDb: Math.round(Math.abs(db(head) - db(tail)) * 10) / 10,
    wrapStep: Math.round(wrap * 10000) / 10000, stepP99: Math.round(p99 * 10000) / 10000,
    seamless: wrap <= Math.max(p99 * 1.5, 0.02), // (the wrap is a step like the music's own)
  };
}
