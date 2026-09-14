// Deep zoom: a continuous scale (pixels per metre) that eases toward where the
// wheel sends it and, once it settles, lands exactly on a rung of the bake
// ladder -- so while it moves the picture shows the nearest baked scale drawn
// a little bigger or smaller, and when it stops every sprite is baked at the
// view's own scale, texel for pixel. The ladder is dense (about 2^(1/4) a
// rung: 2, 2.4, 2.8, 3.4, 4 ... 108, 128) so a step never looks like a jump.
//
// Pitch buckets: the camera tilts with the zoom -- steep over the whole map, a
// lower, tactical angle close in (faces and fronts read). Sprites are baked
// for one pitch, so the pitch moves in BUCKETS (each its own bake), with a
// hysteresis band so a zoom resting near a boundary doesn't flip between them.
//
//   const zoom = createZoom({ ladder: zoomLadder(2, 128), buckets: [{ upTo: 16, pitch: 0.7 }, { upTo: Infinity, pitch: 0.5 }] });
//   zoom.wheel(-1);  zoom.step(dt);  zoom.k (drawn) · zoom.rung (to bake) · zoom.settled · zoom.bucket

/** A ladder from `min` to `max` px/m, `perOctave` rungs per doubling, rounded to whole pixels from 4 up (to tenths below). */
export function zoomLadder(min = 2, max = 128, perOctave = 4): number[] {
  const out: number[] = [];
  const n = Math.round(Math.log2(max / min) * perOctave);
  for (let i = 0; i <= n; i += 1) {
    const k = min * 2 ** (i / perOctave);
    const r = k >= 4 ? Math.round(k) : Math.round(k * 10) / 10;
    if (!out.length || r > out[out.length - 1]!) out.push(r);
  }
  if (out[out.length - 1] !== max) out.push(max);
  return out;
}

/** The ladder rung nearest to `k` in log terms. */
export function nearestRung(ladder: readonly number[], k: number): number {
  let best = ladder[0]!, bd = Infinity;
  for (const r of ladder) { const d = Math.abs(Math.log(r / k)); if (d < bd) { bd = d; best = r; } }
  return best;
}

/** A pitch bucket: every scale up to `upTo` px/m is seen at `pitch` (radians below horizontal). */
export interface PitchBucket { readonly upTo: number; readonly pitch: number }

export interface ZoomOptions {
  readonly ladder: readonly number[];
  /** Starting scale (snapped to the ladder). */
  readonly k?: number;
  /** Pitch buckets, ascending by upTo (default: one, 0.6). */
  readonly buckets?: readonly PitchBucket[];
  /** How far past a bucket's edge (as a factor) the zoom must go before the bucket changes (default 1.12). */
  readonly hysteresis?: number;
  /** How fast the drawn scale closes on the target (per second, exponential; default 14). */
  readonly rate?: number;
  /** Rungs a wheel notch moves (default 1). */
  readonly notch?: number;
}

export interface Zoom {
  readonly ladder: readonly number[];
  /** The scale drawn this frame (continuous while it moves; a rung once settled). */
  readonly k: number;
  /** Where it's going: always a rung. */
  readonly target: number;
  /** The rung to bake for (the target). */
  readonly rung: number;
  /** Has it arrived (k === target)? */
  readonly settled: boolean;
  /** The pitch bucket in use, and its pitch. */
  readonly bucket: number;
  readonly pitch: number;
  /** Move the target by `steps` rungs (negative: out). */
  wheel(steps: number): void;
  /** Jump the target to a rung near `k` (instantly when `now`). */
  set(k: number, now?: boolean): void;
  /** Advance the easing by dt seconds: true when k changed. */
  step(dt: number): boolean;
  /** Which bucket a scale falls in, from bucket `from` (with the hysteresis). */
  bucketFor(k: number, from?: number): number;
  /** The buckets, and a bucket's pitch. */
  readonly buckets: readonly PitchBucket[];
  pitchOf(bucket: number): number;
}

export function createZoom({ ladder, k: k0, buckets = [{ upTo: Infinity, pitch: 0.6 }], hysteresis = 1.12, rate = 14, notch = 1 }: ZoomOptions): Zoom {
  if (!ladder.length) throw new RangeError("An empty zoom ladder.");
  for (let i = 1; i < ladder.length; i += 1) if (!(ladder[i]! > ladder[i - 1]!)) throw new RangeError("The zoom ladder must ascend.");
  if (!buckets.length) throw new RangeError("At least one pitch bucket.");
  let target = nearestRung(ladder, k0 ?? ladder[Math.floor(ladder.length / 2)]!);
  let k = target;
  const bucketFor = (x: number, from = -1): number => {
    let b = buckets.findIndex((q) => x <= q.upTo);
    if (b < 0) b = buckets.length - 1;
    if (from < 0 || b === from) return b;
    // (Leave the current bucket only once well past its edge.)
    if (b > from) return x > buckets[from]!.upTo * hysteresis ? b : from;
    const lower = buckets[b]!.upTo;
    return x < lower / hysteresis ? b : from;
  };
  let bucket = bucketFor(k);
  const z: Zoom = {
    ladder,
    get k() { return k; },
    get target() { return target; },
    get rung() { return target; },
    get settled() { return k === target; },
    get bucket() { return bucket; },
    get pitch() { return buckets[bucket]!.pitch; },
    wheel(steps) {
      const i = ladder.indexOf(target);
      target = ladder[Math.max(0, Math.min(ladder.length - 1, i + Math.round(steps * notch)))]!;
    },
    set(x, now = false) { target = nearestRung(ladder, x); if (now) { k = target; bucket = bucketFor(k, bucket); } },
    step(dt) {
      if (k === target) return false;
      // (In log space: a zoom from 4 to 8 takes as long as one from 64 to 128.)
      const a = Math.log(k), b = Math.log(target);
      const next = a + (b - a) * (1 - Math.exp(-rate * Math.max(0, dt)));
      k = Math.abs(next - b) < 0.004 ? target : Math.exp(next);
      bucket = bucketFor(k, bucket);
      return true;
    },
    bucketFor,
    buckets,
    pitchOf: (b) => buckets[Math.max(0, Math.min(buckets.length - 1, b))]!.pitch,
  };
  return z;
}
