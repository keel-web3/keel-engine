// The generation work queue a loader and a streamer share: jobs in stages
// (coarse first -- the city, its fields, its plans, the skyline, the start
// ring), nearest first inside a stage, run a budget of WORK UNITS at a time.
// The scheduler decides how many units fit a frame (from its clock); the queue
// never reads one, so the same jobs make the same bytes however they're sliced.
//
//   const q = createWorkQueue({ blocking: 4, labels: ["Surveying the grid", ...] });
//   q.add({ key, stage: 3, cost: boxes, priority: -distance, run });
//   each frame: q.run(unitsThisFrame); bar.value = q.progress; status.text = q.label;

export interface WorkJob {
  readonly key: string;
  /** Lower stages run first. */
  readonly stage: number;
  /** Its weight in work units (boxes meshed, rows of a field): what progress counts. */
  readonly cost: number;
  /** Higher runs first inside a stage (for example minus the distance to the route). Ties keep the order added. */
  readonly priority?: number;
  run(): void;
}

export interface WorkQueue {
  /** Queue a job (a key already queued or done is ignored: work is keyed by recipe). */
  add(job: WorkJob): void;
  /** Run jobs in order until `units` of cost are spent -- always at least one if any wait. Returns the units run. */
  run(units: number): number;
  /** Done / total cost over the blocking stages (0..1; 1 when they are all done). Never goes back unless jobs are added. */
  readonly progress: number;
  /** The lowest stage still waiting, or -1. */
  readonly stage: number;
  /** The label of that stage (labels[stage]), or "". */
  readonly label: string;
  /** Whether every blocking stage is done (the first frame can draw). */
  readonly ready: boolean;
  readonly pending: number;
}

export function createWorkQueue({ blocking = Infinity, labels = [] }: { readonly blocking?: number; readonly labels?: readonly string[] } = {}): WorkQueue {
  const jobs: { job: WorkJob; n: number }[] = [];
  const seen = new Set<string>();
  let added = 0, total = 0, done = 0, sorted = true;
  const order = (): void => {
    if (sorted) return;
    jobs.sort((a, b) => a.job.stage - b.job.stage || (b.job.priority ?? 0) - (a.job.priority ?? 0) || a.n - b.n);
    sorted = true;
  };
  const q: WorkQueue = {
    add(job) {
      if (seen.has(job.key)) return;
      seen.add(job.key);
      jobs.push({ job, n: added++ });
      sorted = false;
      if (job.stage <= blocking) total += Math.max(0, job.cost);
    },
    run(units) {
      order();
      let spent = 0;
      while (jobs.length && (spent === 0 || spent + Math.max(0, jobs[0]!.job.cost) <= units)) {
        const { job } = jobs.shift()!;
        job.run();
        spent += Math.max(0, job.cost);
        if (job.stage <= blocking) done += Math.max(0, job.cost);
      }
      return spent;
    },
    get progress() { return total > 0 ? Math.min(1, done / total) : 1; },
    get stage() { order(); return jobs.length ? jobs[0]!.job.stage : -1; },
    get label() { const s = q.stage; return s >= 0 ? labels[s] ?? "" : ""; },
    get ready() { order(); return !jobs.length || jobs[0]!.job.stage > blocking; },
    get pending() { return jobs.length; },
  };
  return q;
}
