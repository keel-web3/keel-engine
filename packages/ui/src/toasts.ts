// Toasts: short call-outs that come in, hold, and go -- "+1 P3", "BEST LAP",
// "NITRO READY", "WRONG WAY", a message arrived. A queue with a cap (the
// oldest leaves early when a new one needs its place), keys that coalesce (a
// second "wrong way" refreshes the first instead of stacking), priorities
// (a warning outranks a flourish), and per-toast phases a game draws as it
// likes: how far in (0..1), how opaque (0..1). Pure data and a clock.

export interface ToastInput {
  readonly text: string;
  /** A smaller second line. */
  readonly sub?: string;
  /** The game's own class for it ("gain", "loss", "warn", "info", "reward"): picks its colour. */
  readonly kind?: string;
  /** Same key: refresh the one showing instead of adding another. */
  readonly key?: string;
  /** Seconds it holds (default: the queue's). */
  readonly life?: number;
  /** Higher stays when the queue is full (default 0). */
  readonly priority?: number;
}

export interface Toast extends ToastInput {
  readonly id: number;
  /** Seconds since it came in (or was refreshed). */
  age: number;
  life: number;
  priority: number;
  /** Leaving early (pushed out, or dismissed). */
  leaving: number;
}

export interface ToastView {
  readonly toast: Toast;
  /** 0..1 in (the slide), 0..1 opacity, and its slot (0 the newest). */
  readonly slide: number;
  readonly alpha: number;
  readonly slot: number;
}

export interface Toasts {
  push(t: ToastInput): Toast;
  /** Send one out now (it fades), by id or key. */
  dismiss(idOrKey: number | string): void;
  update(dt: number): void;
  /** What shows, newest first. */
  views(): ToastView[];
  clear(): void;
  readonly size: number;
}

export interface ToastOptions {
  readonly max?: number;
  readonly life?: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
}

export function createToasts(o: ToastOptions = {}): Toasts {
  const max = Math.max(1, o.max ?? 4), life = o.life ?? 2.4, fadeIn = Math.max(1e-3, o.fadeIn ?? 0.16), fadeOut = Math.max(1e-3, o.fadeOut ?? 0.3);
  let list: Toast[] = [], serial = 0;
  const out = (t: Toast): void => { if (!t.leaving) t.leaving = 1e-6; };
  return {
    get size() { return list.length; },
    push(input) {
      const priority = input.priority ?? 0;
      const same = input.key !== undefined ? list.find((t) => t.key === input.key && !t.leaving) : undefined;
      if (same) {
        Object.assign(same, { ...input, life: input.life ?? life, priority });
        same.age = Math.min(same.age, fadeIn);
        return same;
      }
      const t: Toast = { ...input, id: (serial += 1), age: 0, life: input.life ?? life, priority, leaving: 0 };
      list.push(t);
      // (Full: the lowest priority, then the oldest, is sent out -- it still fades, it just doesn't hold.)
      const staying = list.filter((x) => !x.leaving);
      if (staying.length > max) {
        const victim = staying.filter((x) => x !== t).sort((a, b) => a.priority - b.priority || b.age - a.age)[0];
        if (victim && victim.priority <= priority) out(victim); else out(t);
      }
      return t;
    },
    dismiss(k) { for (const t of list) if (t.id === k || t.key === k) out(t); },
    update(dt) {
      for (const t of list) {
        t.age += dt;
        if (t.leaving) t.leaving += dt;
        else if (t.age >= t.life) out(t);
      }
      list = list.filter((t) => !t.leaving || t.leaving < fadeOut);
    },
    views() {
      const shown = [...list].reverse();
      return shown.map((toast, slot) => ({
        toast, slot,
        slide: Math.min(1, toast.age / fadeIn),
        alpha: toast.leaving ? Math.max(0, 1 - toast.leaving / fadeOut) : Math.min(1, toast.age / fadeIn),
      }));
    },
    clear() { list = []; },
  };
}
