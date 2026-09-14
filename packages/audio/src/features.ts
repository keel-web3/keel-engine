// What a sound measures like, as a few numbers: how long, how bright
// (spectral centroid), how noisy (zero crossings, spectral flatness), its
// envelope's shape (attack, where its weight sits, how much of it sustains,
// how many onsets -- its rhythm) and whether it brightens or darkens as it
// goes. Distances between these tell sounds apart (test/battle.test.ts
// holds the battle audio's kinds, alerts and timbres apart with them).

/** A sound's features (raw, in their own units). */
export interface SoundFeatures {
  readonly seconds: number;
  /** Spectral centroid, Hz (energy-weighted over frames). */
  readonly centroid: number;
  /** Zero crossings a second. */
  readonly zcr: number;
  /** Spectral flatness 0 (a pure tone) .. 1 (white noise). */
  readonly flatness: number;
  /** When the envelope peaks, as a share of the length. */
  readonly attack: number;
  /** The envelope's centre of mass, as a share of the length. */
  readonly weight: number;
  /** The share of 10 ms frames within 12 dB of the peak. */
  readonly sustain: number;
  /** Onsets: rises of 6 dB or more out of a dip. */
  readonly onsets: number;
  /** log2 of the centroid's second half over its first (rising > 0). */
  readonly slope: number;
  /** The share of frames with a clear pitch (autocorrelation). */
  readonly voiced: number;
  /** log2 of the pitch's last third over its first (a rising contour > 0; 0 when unvoiced). */
  readonly pitchSlope: number;
  /** log2 of the pitch's 90th percentile over its 10th (how far it moves; 0 when unvoiced). */
  readonly pitchSpread: number;
  /** The median pitch, Hz (0 when unvoiced). */
  readonly pitch: number;
}

const N = 512;
/** An in-place radix-2 FFT (re, im of length N). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos(a * k);
        const wi = Math.sin(a * k);
        const xr = re[i + k + len / 2]! * wr - im[i + k + len / 2]! * wi;
        const xi = re[i + k + len / 2]! * wi + im[i + k + len / 2]! * wr;
        re[i + k + len / 2] = re[i + k]! - xr; im[i + k + len / 2] = im[i + k]! - xi;
        re[i + k] = re[i + k]! + xr; im[i + k] = im[i + k]! + xi;
      }
    }
  }
}

/** A pitch track: the autocorrelation's best lag per frame (on a 2x-decimated copy), 45-1200 Hz, where it's clear. */
function pitchTrack(x: ArrayLike<number>, rate: number): { readonly frames: number; readonly track: readonly (readonly [number, number])[] } {
  const r = rate / 2;
  const y = new Float32Array(x.length >> 1);
  for (let i = 0; i < y.length; i += 1) y[i] = 0.5 * (x[2 * i]! + x[2 * i + 1]!);
  const W = Math.round(r * 0.03);
  const lo = Math.max(2, Math.floor(r / 1200));
  const hi = Math.min(W - 1, Math.ceil(r / 45));
  const track: [number, number][] = [];
  let frames = 0;
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  for (let s = 0; s + W + hi < y.length; s += W >> 1) {
    let e0 = 0;
    for (let i = 0; i < W; i += 1) e0 += y[s + i]! * y[s + i]!;
    if (Math.sqrt(e0 / W) < peak * 0.05) continue;
    frames += 1;
    let best = 0;
    let at = 0;
    for (let lag = lo; lag <= hi; lag += 1) {
      let c = 0; let e1 = 0;
      for (let i = 0; i < W; i += 1) { c += y[s + i]! * y[s + i + lag]!; e1 += y[s + i + lag]! * y[s + i + lag]!; }
      const n = c / Math.sqrt(e0 * e1 + 1e-12);
      if (n > best) { best = n; at = lag; }
    }
    if (best > 0.6) track.push([s / r, r / at]);
  }
  return { frames, track };
}
const median = (l: readonly number[]): number => { const s = [...l].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };

/** A sound's features. */
export function soundFeatures(x: ArrayLike<number>, rate: number): SoundFeatures {
  const n = x.length;
  // Envelope: 10 ms RMS frames.
  const fl = Math.max(1, Math.round(rate * 0.01));
  const envl: number[] = [];
  for (let i = 0; i < n; i += fl) { let s = 0; const e = Math.min(n, i + fl); for (let j = i; j < e; j += 1) s += x[j]! * x[j]!; envl.push(Math.sqrt(s / (e - i))); }
  const peak = Math.max(1e-9, ...envl);
  const at = envl.indexOf(peak);
  let m = 0; let w = 0;
  envl.forEach((v, i) => { m += v * v * i; w += v * v; });
  const sustain = envl.filter((v) => v > peak / 4).length / envl.length;
  // (An onset counts once; the next needs a fresh dip of 6 dB below where the level got to.)
  let onsets = 0;
  let armed = true;
  let floor = Infinity;
  // (Over a 30 ms smoothing of the envelope: a wobble inside a syllable isn't a new one.)
  const sm = envl.map((_, i) => ((envl[i - 1] ?? envl[i]!) + envl[i]! + (envl[i + 1] ?? envl[i]!)) / 3);
  for (const v of sm) {
    const db = 20 * Math.log10(Math.max(v, peak * 1e-3));
    if (armed) { floor = Math.min(floor, db); if (db - floor >= 6 && v > peak / 8) { onsets += 1; armed = false; floor = db; } }
    else if (db < floor - 6) { armed = true; floor = db; }
    else floor = Math.max(floor, db);
  }
  // Zero crossings.
  let zc = 0;
  for (let i = 1; i < n; i += 1) if ((x[i - 1]! < 0) !== (x[i]! < 0)) zc += 1;
  // Spectrum: Hann frames, hop N/2, energy-weighted centroid and flatness.
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let cSum = 0; let cW = 0; let fSum = 0; let fW = 0;
  const halves = [[0, 0], [0, 0]];
  for (let s = 0; s + N <= Math.max(n, N); s += N / 2) {
    let e = 0;
    for (let i = 0; i < N; i += 1) { const v = (x[s + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); re[i] = v; im[i] = 0; e += v * v; }
    if (e < 1e-10) continue;
    fft(re, im);
    let num = 0; let den = 0; let lg = 0;
    for (let k = 1; k < N / 2; k += 1) { const p = re[k]! * re[k]! + im[k]! * im[k]! + 1e-12; num += p * ((k * rate) / N); den += p; lg += Math.log(p); }
    const c = num / den;
    const flat = Math.exp(lg / (N / 2 - 1)) / (den / (N / 2 - 1));
    cSum += c * e; cW += e; fSum += flat * e; fW += e;
    const h = halves[s + N / 2 < n / 2 ? 0 : 1]!;
    h[0]! += c * e; h[1]! += e;
  }
  const { frames, track } = pitchTrack(x, rate);
  const hz = track.map(([, f]) => f);
  const third = Math.max(1, Math.floor(hz.length / 3));
  const sorted = [...hz].sort((a, b) => a - b);
  const voiced = frames ? hz.length / frames : 0;
  const pitchSlope = hz.length >= 3 ? Math.log2(median(hz.slice(-third)) / median(hz.slice(0, third))) : 0;
  const pitchSpread = hz.length >= 3 ? Math.log2(sorted[Math.floor(sorted.length * 0.9)]! / sorted[Math.floor(sorted.length * 0.1)]!) : 0;
  const centroid = cW ? cSum / cW : 0;
  const c0 = halves[0]![1]! ? halves[0]![0]! / halves[0]![1]! : centroid;
  const c1 = halves[1]![1]! ? halves[1]![0]! / halves[1]![1]! : centroid;
  return {
    seconds: n / rate, centroid, zcr: (zc * rate) / n, flatness: fW ? fSum / fW : 0,
    attack: at / envl.length, weight: w ? m / w / envl.length : 0, sustain, onsets, slope: Math.log2(Math.max(1, c1) / Math.max(1, c0)),
    voiced, pitchSlope, pitchSpread, pitch: hz.length >= 3 ? median(hz) : 0,
  };
}

/** The features as one comparable vector (logs of the scales; shares doubled): what featureDistance measures. */
export function featureVector(f: SoundFeatures): number[] {
  return [
    Math.log2(Math.max(0.01, f.seconds) / 0.3), Math.log2(Math.max(50, f.centroid) / 1000), Math.log2(Math.max(50, f.zcr) / 1000), 3 * f.flatness,
    2 * f.attack, 2 * f.weight, 2 * f.sustain, Math.log2(1 + f.onsets), Math.max(-2, Math.min(2, f.slope)),
    f.voiced, 1.5 * Math.max(-1.5, Math.min(1.5, f.pitchSlope)), Math.min(2, f.pitchSpread), f.pitch ? Math.max(-2, Math.min(2, Math.log2(f.pitch / 200))) : 0,
  ];
}
/** How far apart two sounds' features are (Euclidean over featureVector). */
export function featureDistance(a: SoundFeatures, b: SoundFeatures): number {
  const x = featureVector(a);
  const y = featureVector(b);
  return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]!) ** 2, 0));
}
