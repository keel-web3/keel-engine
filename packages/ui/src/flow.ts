// A game's front end as a stack of screens: the title, a menu, a sub-menu, a
// dialog on top -- push to go in, pop to come back, replace to move across,
// reset to start over. Each change starts a TRANSITION (from, to, how, 0..1
// over its duration) the screens draw however they like (a slide, a wipe, a
// dithered fade). Pure data: no drawing, no DOM, no clock of its own --
// update(dt) moves it on, so it's the same in a test as in a game.

export type FlowKind = "push" | "pop" | "replace" | "reset";

export interface FlowEntry<S extends string> {
  readonly screen: S;
  /** What the screen was opened with (an event id, a shop's category). */
  readonly params: Readonly<Record<string, unknown>>;
}

export interface FlowTransition<S extends string> {
  readonly from: S | null;
  readonly to: S | null;
  readonly kind: FlowKind;
  /** 0 just started .. 1 done. */
  readonly t: number;
}

export interface Flow<S extends string> {
  /** The screen in front (null: the stack's empty -- the game itself, no menus). */
  readonly top: FlowEntry<S> | null;
  readonly stack: readonly FlowEntry<S>[];
  /** The change under way, or null once it's done. */
  readonly transition: FlowTransition<S> | null;
  /** Seconds the top screen has been in front. */
  readonly time: number;
  push(screen: S, params?: Record<string, unknown>): void;
  /** Back one screen (returns the one left, or null when there was nothing to leave). */
  pop(): FlowEntry<S> | null;
  /** Pop back to a screen already on the stack (false: it isn't). */
  popTo(screen: S): boolean;
  replace(screen: S, params?: Record<string, unknown>): void;
  /** Clear the stack, then show `screen` (none: an empty stack). */
  reset(screen?: S, params?: Record<string, unknown>): void;
  has(screen: S): boolean;
  update(dt: number): void;
  /** Told after every change (the new top, and how it got there). */
  onChange(fn: (top: FlowEntry<S> | null, kind: FlowKind) => void): () => void;
}

export interface FlowOptions<S extends string> {
  readonly initial?: S;
  /** How long a transition takes (s; default 0.22). */
  readonly duration?: number;
}

export function createFlow<S extends string>(o: FlowOptions<S> = {}): Flow<S> {
  const duration = Math.max(0, o.duration ?? 0.22);
  const stack: FlowEntry<S>[] = o.initial ? [{ screen: o.initial, params: {} }] : [];
  let transition: FlowTransition<S> | null = null, time = 0;
  const listeners = new Set<(top: FlowEntry<S> | null, kind: FlowKind) => void>();
  const top = (): FlowEntry<S> | null => stack[stack.length - 1] ?? null;
  const change = (from: S | null, kind: FlowKind): void => {
    const to = top()?.screen ?? null;
    time = 0;
    transition = duration > 0 ? { from, to, kind, t: 0 } : null;
    for (const l of listeners) l(top(), kind);
  };
  const flow: Flow<S> = {
    get top() { return top(); },
    get stack() { return stack; },
    get transition() { return transition; },
    get time() { return time; },
    push(screen, params = {}) { const from = top()?.screen ?? null; stack.push({ screen, params }); change(from, "push"); },
    pop() {
      const gone = stack.pop() ?? null;
      if (gone) change(gone.screen, "pop");
      return gone;
    },
    popTo(screen) {
      const i = stack.map((e) => e.screen).lastIndexOf(screen);
      if (i < 0) return false;
      const from = top()?.screen ?? null;
      if (i === stack.length - 1) return true;
      stack.length = i + 1;
      change(from, "pop");
      return true;
    },
    replace(screen, params = {}) { const from = top()?.screen ?? null; stack.pop(); stack.push({ screen, params }); change(from, "replace"); },
    reset(screen, params = {}) { const from = top()?.screen ?? null; stack.length = 0; if (screen !== undefined) stack.push({ screen, params }); change(from, "reset"); },
    has: (screen) => stack.some((e) => e.screen === screen),
    update(dt) {
      time += dt;
      if (!transition) return;
      const t = duration > 0 ? transition.t + dt / duration : 1;
      transition = t >= 1 ? null : { ...transition, t };
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return flow;
}
