// Driving a SpriteStream on this thread: the loop every game wrote by hand.
//
// The stream decides WHAT to bake and in what order (stream.ts); bakeSlice bakes a slice of it (worker.ts); the frame
// budget says HOW LONG it may take (budget.ts). Tying the three together is a dozen lines of ceremony -- take the most
// wanted jobs, bake them, put each one back, drop the ones the view no longer wants -- and getting it wrong is quiet:
// bake too much and the frame stutters, too little and the zoom never sharpens, forget `wanted()` and you pay for
// sprites nobody is looking at any more.
//
//   const pump = createStreamPump(stream, { renderer: px, sources: { indexed: sources } });
//   // each frame, after the draw has marked stream.seen:
//   stream.update(now);
//   pump.slice();                         // bakes within the budget, uploads through the stream's onWrite
//
// A game that bakes in a worker uses createBakeWorkers instead; this is the same contract without one.

import type { BakedSprite } from "./bake.ts";
import type { SpriteStream, StreamJob } from "./stream.ts";
import type { FrameBudget } from "./budget.ts";
import { createFrameBudget } from "./budget.ts";
import { bakeSlice } from "./worker.ts";
import type { SliceSources } from "./worker.ts";
import type { IndexedBakeRenderer } from "./indexed.ts";

export interface StreamPumpOptions {
  /** The renderer bakes are drawn through (a pixel renderer in bake mode). */
  readonly renderer: IndexedBakeRenderer;
  /** Where a design's world comes from -- the same shape bakeSlice takes. */
  readonly sources: SliceSources;
  /** The budget the slice is cut to (one is made if none is given). */
  readonly budget?: FrameBudget;
  /** Bake height planes too (depth sprites). */
  readonly heights?: boolean;
  /** Most jobs in one slice, whatever the budget allows (default 64: a slice is re-ranked every frame anyway). */
  readonly most?: number;
  /** Jobs ranked above this are left alone (stream.ts RANK). */
  readonly maxRank?: number;
}

export interface StreamPump {
  /**
   * Bake the stream's most wanted jobs within this frame's budget, and put them back.
   * Returns how many sprites landed. `ms` overrides the budget (a loading screen: give it 40).
   */
  slice(ms?: number): number;
  /** How long the last slice took, and how many jobs it took on. */
  readonly stats: { readonly ms: number; readonly jobs: number; readonly landed: number; readonly dropped: number };
  /** The budget it cuts to (report the game's own frame work to it: `budget.work(ms)`). */
  readonly budget: FrameBudget;
}

/** Roughly how many jobs fit in `ms`, from what the last slices cost -- a first guess of 8, then measured. */
const fit = (ms: number, perJob: number, most: number): number => Math.max(1, Math.min(most, Math.floor(ms / Math.max(0.05, perJob))));

export function createStreamPump(stream: SpriteStream, options: StreamPumpOptions): StreamPump {
  const { renderer, sources, heights = false, most = 64, maxRank } = options;
  const budget = options.budget ?? createFrameBudget();
  let perJob = 0.125; // ms a sprite, smoothed
  const stats = { ms: 0, jobs: 0, landed: 0, dropped: 0 };
  return {
    budget,
    get stats() { return stats; },
    slice(ms) {
      const allow = ms ?? budget.slice();
      if (!(allow > 0)) { stats.ms = 0; stats.jobs = 0; return 0; }
      const jobs: StreamJob[] = stream.take(fit(allow, perJob, most), maxRank);
      if (!jobs.length) { stats.ms = 0; stats.jobs = 0; return 0; }
      // (What the view moved past while this slice waited is cancelled, not baked.)
      const live: StreamJob[] = [];
      for (const j of jobs) { if (stream.wanted(j)) live.push(j); else stream.cancel(j); }
      let landed = 0, dropped = jobs.length - live.length;
      let took = 0;
      if (live.length) {
        const { baked, ms: cost } = bakeSlice(renderer, live, sources, { heights });
        took = cost;
        const by = new Map<string, BakedSprite>(baked.map((b) => [b.key, b]));
        for (const j of live) {
          const sprite = by.get(j.key);
          if (sprite && stream.put(j, sprite)) landed += 1;
          else { stream.cancel(j); dropped += 1; }
        }
        perJob = perJob * 0.8 + (cost / live.length) * 0.2;
        budget.spent(cost);
      }
      stats.ms = took; stats.jobs = jobs.length; stats.landed = landed; stats.dropped = dropped;
      return landed;
    },
  };
}
