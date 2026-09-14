// The bake queue: sprites waiting to be baked, taken a slice at a time, the
// most wanted first. A game enqueues a plan's jobs (only the missing ones:
// cache.missing), raises the priority of what's on screen every frame, and
// bakes a few milliseconds' worth a frame -- renderSprites or
// renderIndexedSprites on each slice -- so the picture never waits for the
// whole bake.
//
//   const q = createBakeQueue();
//   q.enqueue(cache.missing(plan.sprites), 0);
//   q.prioritise(design.key, visibleCount);        // each frame, per design
//   const slice = q.take(n);                        // highest priority first, a design's jobs together
//
// Priorities are per job (enqueue) and per design (prioritise raises every
// queued job of a design); ties keep the order jobs were queued in, so a
// design's frames come out together and its sprites finish as a set.

import type { SpriteJob } from "./plan.ts";

export interface BakeQueue<J extends SpriteJob = SpriteJob> {
  /** Queue jobs at a priority (higher first). A job already queued keeps the higher of its two priorities. */
  enqueue(jobs: readonly J[], priority?: number): void;
  /** Set the priority of every queued job of a design. */
  prioritise(design: string, priority: number): void;
  /** Up to `n` jobs, highest priority first (and taken off the queue). */
  take(n: number): J[];
  /** Is this job waiting? */
  has(key: string): boolean;
  /** Jobs waiting (all, or one design's). */
  size(design?: string): number;
  /** Drop jobs (all, or those that pass): how many went. */
  clear(which?: (job: J) => boolean): number;
}

export function createBakeQueue<J extends SpriteJob = SpriteJob>(): BakeQueue<J> {
  // By design: its jobs in queue order, and the design's priority (a job's own priority lifts its design's).
  interface Bucket { priority: number; order: number; jobs: J[] }
  const buckets = new Map<string, Bucket>();
  const keys = new Set<string>();
  let order = 0;
  const bucket = (design: string): Bucket => { let b = buckets.get(design); if (!b) { b = { priority: -Infinity, order: order++, jobs: [] }; buckets.set(design, b); } return b; };
  return {
    enqueue(jobs, priority = 0) {
      for (const j of jobs) {
        const b = bucket(j.design);
        if (priority > b.priority) b.priority = priority;
        if (keys.has(j.key)) continue;
        keys.add(j.key);
        b.jobs.push(j);
      }
    },
    prioritise(design, priority) { const b = buckets.get(design); if (b) b.priority = priority; },
    take(n) {
      const out: J[] = [];
      while (out.length < n && buckets.size) {
        let best: [string, Bucket] | null = null;
        for (const e of buckets) if (!best || e[1].priority > best[1].priority || (e[1].priority === best[1].priority && e[1].order < best[1].order)) best = e;
        const [design, b] = best!;
        const got = b.jobs.splice(0, n - out.length);
        for (const j of got) keys.delete(j.key);
        out.push(...got);
        if (!b.jobs.length) buckets.delete(design);
      }
      return out;
    },
    has: (key) => keys.has(key),
    size: (design) => (design === undefined ? keys.size : buckets.get(design)?.jobs.length ?? 0),
    clear(which) {
      let n = 0;
      for (const [design, b] of buckets) {
        const keep = which ? b.jobs.filter((j) => !which(j)) : [];
        for (const j of b.jobs) if (!keep.includes(j)) { keys.delete(j.key); n += 1; }
        b.jobs = keep;
        if (!keep.length) buckets.delete(design);
      }
      return n;
    },
  };
}
