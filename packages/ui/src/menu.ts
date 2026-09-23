// A menu as data: a list (or a grid) of entries, one focused, moved by a
// d-pad, the arrow keys or a stick; an entry is an action (press it), a toggle
// (on/off), a choice (left/right through its options) or a range (left/right
// by a step). Disabled entries are skipped. Pure -- the game draws it and
// feeds it moves -- so the same menu runs on a keyboard, a pad, touch and in a
// test. With a repeater, a held direction repeats the way console menus do.

export type MenuKind = "action" | "toggle" | "choice" | "range";

export interface MenuEntry {
  readonly id: string;
  label: string;
  kind?: MenuKind;
  disabled?: boolean;
  /** A choice's options; a toggle reads 0 off / 1 on. */
  choices?: readonly string[];
  /** A toggle's or choice's index, a range's number. */
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  /** A line of help the screen can show for the focused entry. */
  hint?: string;
  /** Anything the game wants to hang on it (a price, a car). */
  data?: unknown;
}

export interface MenuModel {
  readonly items: readonly MenuEntry[];
  /** The focused entry's index (-1: nothing can take focus). */
  readonly index: number;
  readonly focused: MenuEntry | undefined;
  /** Columns: a grid moves across as well as down (1: a list). */
  readonly columns: number;
  /** Move the focus (dy rows, dx columns), skipping what's disabled. Returns whether it moved. */
  move(dy: number, dx?: number): boolean;
  /** Left/right on the focused entry: a toggle flips, a choice steps round, a range steps. Returns the new value or null. */
  adjust(d: number): number | null;
  /** Press the focused entry: an action is returned; a toggle flips (and is returned too). */
  activate(): MenuEntry | null;
  focus(id: string): boolean;
  /** Focus by index (a pointer over it). */
  focusAt(i: number): boolean;
  /** Swap the entries, keeping the focus on the same id when it's still there. */
  setItems(items: readonly MenuEntry[]): void;
  value(id: string): number | undefined;
}

export interface MenuModelOptions {
  /** Wrap from the last entry to the first (default true). */
  readonly wrap?: boolean;
  readonly columns?: number;
  /** The id to start on. */
  readonly focus?: string;
}

const usable = (m: MenuEntry | undefined): boolean => !!m && !m.disabled;

export function createMenu(initial: readonly MenuEntry[], o: MenuModelOptions = {}): MenuModel {
  const wrap = o.wrap ?? true, columns = Math.max(1, Math.floor(o.columns ?? 1));
  let items: MenuEntry[] = initial.map((m) => ({ ...m }));
  let index = -1;
  const first = (): number => items.findIndex(usable);
  const menu: MenuModel = {
    get items() { return items; },
    get index() { return index; },
    get focused() { return items[index]; },
    columns,
    move(dy, dx = 0) {
      const n = items.length;
      if (!n) return false;
      if (index < 0) { index = first(); return index >= 0; }
      if (dx && columns === 1) dx = 0;
      if (!dy && !dx) return false;
      // (Across stays on its row, down stays in its column; the last row may be short: a column past it lands on its end.)
      const rows = Math.ceil(n / columns);
      let r = Math.floor(index / columns), c = index % columns;
      for (let tries = 0; tries < n; tries += 1) {
        if (dx) {
          c += Math.sign(dx);
          const inRow = Math.min(columns, n - r * columns);
          if (c < 0 || c >= inRow) { if (!wrap) return false; c = c < 0 ? inRow - 1 : 0; }
        }
        if (dy) {
          r += Math.sign(dy);
          if (r < 0 || r >= rows) { if (!wrap) return false; r = r < 0 ? rows - 1 : 0; }
        }
        const i = Math.min(n - 1, r * columns + c);
        if (usable(items[i])) { const moved = i !== index; index = i; return moved; }
      }
      return false;
    },
    adjust(d) {
      const m = items[index];
      if (!usable(m) || !m || !d) return null;
      const kind = m.kind ?? "action";
      if (kind === "toggle") { m.value = (m.value ?? 0) > 0 ? 0 : 1; return m.value; }
      if (kind === "choice") {
        const n = m.choices?.length ?? 0;
        if (!n) return null;
        m.value = (((m.value ?? 0) + Math.sign(d)) % n + n) % n;
        return m.value;
      }
      if (kind === "range") {
        const lo = m.min ?? 0, hi = m.max ?? 1, step = m.step ?? (hi - lo) / 10;
        const v = Math.max(lo, Math.min(hi, Math.round(((m.value ?? lo) + Math.sign(d) * step) / step) * step));
        m.value = Number(v.toFixed(6));
        return m.value;
      }
      return null;
    },
    activate() {
      const m = items[index];
      if (!usable(m) || !m) return null;
      if ((m.kind ?? "action") === "toggle") m.value = (m.value ?? 0) > 0 ? 0 : 1;
      else if (m.kind === "choice") menu.adjust(1);
      return m;
    },
    focus(id) { const i = items.findIndex((m) => m.id === id && usable(m)); if (i < 0) return false; index = i; return true; },
    focusAt(i) { if (!usable(items[i])) return false; index = i; return true; },
    setItems(next) {
      const keep = items[index]?.id;
      items = next.map((m) => ({ ...m }));
      index = keep !== undefined ? items.findIndex((m) => m.id === keep && usable(m)) : -1;
      if (index < 0) index = first();
    },
    value: (id) => items.find((m) => m.id === id)?.value,
  };
  index = o.focus !== undefined && menu.focus(o.focus) ? index : first();
  return menu;
}

export interface Repeater {
  /** This frame: is it held? Returns true on the press and on each repeat after the delay. */
  step(held: boolean, dt: number): boolean;
}

/** A held direction repeating: fires on the press, again after `delay` s, then every `rate` s (default 0.32 / 0.07). */
export function createRepeater({ delay = 0.32, rate = 0.07 }: { delay?: number; rate?: number } = {}): Repeater {
  let held = -1;
  return {
    step(on, dt) {
      if (!on) { held = -1; return false; }
      if (held < 0) { held = 0; return true; }
      const before = held;
      held += dt;
      if (held < delay) return false;
      const k0 = before < delay ? -1 : Math.floor((before - delay) / rate), k1 = Math.floor((held - delay) / rate);
      return k1 > k0;
    },
  };
}
