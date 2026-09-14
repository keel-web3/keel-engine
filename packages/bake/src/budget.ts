// The bake's frame budget: how many milliseconds of a frame a streaming bake
// (and its atlas uploads) may take without the game missing its frame. It
// watches what the game's own work costs -- a smoothed frame cost that rises
// at once and falls slowly, so one light frame doesn't invite a heavy slice
// -- and gives the bake what's left of the frame, between a floor (always a
// little progress) and a ceiling (never a hitch). Nothing while the page is
// hidden; everything it can have while the game is loading (no frame to keep).
//
//   const budget = createFrameBudget();              // 120 fps: 8.3 ms a frame
//   budget.work(simAndDrawMs);                      // each frame, what the game cost
//   const ms = budget.slice({ hidden: document.hidden });
//   ... bake and upload for `ms` ...; budget.spent(bakeMs);

export interface FrameBudgetOptions {
  /** The frame to keep (ms; default 1000 / 120). */
  readonly frame?: number;
  /** Room kept free at the end of a frame (ms; default 1.2: the browser's own work, the compositor). */
  readonly margin?: number;
  /** The least a slice gets while playing (ms; default 0.75). */
  readonly floor?: number;
  /** The most a slice gets while playing (ms; default 6). */
  readonly ceiling?: number;
  /** A loading slice (ms; default 40): the loading screen still animates, everything else goes to the bake. */
  readonly loading?: number;
}

export interface FrameBudget {
  /** Record the game's own work this frame (ms): simulation, culling, drawing. */
  work(ms: number): void;
  /** Record what the bake took this frame (ms): its own cost is watched too, for the report. */
  spent(ms: number): void;
  /** This frame's slice (ms). */
  slice(state?: { readonly hidden?: boolean; readonly loading?: boolean }): number;
  /** The smoothed cost of the game's work (ms). */
  readonly cost: number;
  /** The smoothed bake time a frame (ms), and the share of the slices it used. */
  readonly baking: number;
  readonly used: number;
  readonly frame: number;
}

export function createFrameBudget({ frame = 1000 / 120, margin = 1.2, floor = 0.75, ceiling = 6, loading = 40 }: FrameBudgetOptions = {}): FrameBudget {
  let cost = 0, primed = false, baking = 0, given = 0, used = 0;
  return {
    work(ms) {
      if (!(ms >= 0)) return;
      // (Up at once, down slowly: a spike is believed, a lull isn't.)
      if (!primed) { cost = ms; primed = true; } else cost = ms > cost ? cost + (ms - cost) * 0.75 : cost + (ms - cost) * 0.04;
    },
    spent(ms) {
      if (!(ms >= 0)) return;
      baking = baking * 0.9 + ms * 0.1;
      used = given > 0 ? used * 0.9 + Math.min(1, ms / given) * 0.1 : used;
    },
    slice({ hidden = false, loading: isLoading = false } = {}) {
      if (hidden) { given = 0; return 0; }
      if (isLoading) { given = loading; return loading; }
      given = Math.max(floor, Math.min(ceiling, frame - margin - cost));
      return given;
    },
    get cost() { return cost; },
    get baking() { return baking; },
    get used() { return used; },
    frame,
  };
}
