// The on-screen controls, built from a TouchLayout onto a host element: each
// control is a DOM element (so CSS styles and animates it) that tracks its own
// pointers and writes its touch id into the action map's virtual controls.
// Multi-touch throughout -- steer with one thumb, hold the gas with the other.

import type { VirtualControls } from "../actions.ts";
import type { Anchor, ButtonControl, Rect, SliderControl, StickControl, TiltControl, TouchLayout, ZoneControl } from "./layout.ts";
import { rollOf, sliderValue, stickValue, tiltValue } from "./math.ts";
import { injectControlsCss } from "./styles.ts";

export interface TouchOverlay {
  readonly root: HTMLElement;
  readonly layout: TouchLayout;
  /** Swap schemes (the player's choice) without rebuilding the game's bindings. */
  setLayout(layout: TouchLayout): void;
  /** Show it even off a touch-first device (a desktop preview), or back to automatic. */
  force(on: boolean): void;
  /** Take the device's current tilt as level (tilt steering). */
  calibrate(): void;
  destroy(): void;
}

export interface OverlayOptions {
  /** Put the default stylesheet on the page (default true). */
  readonly css?: boolean;
  readonly className?: string;
}

const place = (el: HTMLElement, anchor: Anchor, x: number, y: number): void => {
  const s = el.style, px = (v: number): string => `calc(${v}px * var(--keel-ctl-scale))`;
  if (anchor.includes("l")) s.left = px(x); else if (anchor.includes("r")) s.right = px(x); else { s.left = `calc(50% + ${px(x)})`; s.transform = "translateX(-50%)"; }
  if (anchor.includes("t")) s.top = px(y); else if (anchor.includes("b")) s.bottom = px(y); else { s.top = `calc(50% + ${px(y)})`; s.translate = "0 -50%"; }
};
const rect = (el: HTMLElement, r: Rect): void => {
  Object.assign(el.style, { left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` });
};

export function createTouchOverlay(host: HTMLElement, virtual: VirtualControls, layout: TouchLayout, opts: OverlayOptions = {}): TouchOverlay {
  const doc = host.ownerDocument;
  if (opts.css !== false) injectControlsCss(doc);
  const root = doc.createElement("div");
  root.className = `keel-ctl${opts.className ? ` ${opts.className}` : ""}`;
  host.append(root);
  let disposed = false, generation = 0;
  let current = layout, teardown: (() => void)[] = [];
  // Controls sharing an id add up (two arrows, two zones): each holds its own share, and the id gets the sum.
  const shares = new Map<string, Map<object, { v: number; digital: boolean }>>();
  const write = (id: string, owner: object, v: number, digital: boolean): void => {
    let m = shares.get(id);
    if (!m) shares.set(id, (m = new Map()));
    if (v === 0) m.delete(owner); else m.set(owner, { v, digital });
    let sum = 0, dig = digital;
    for (const s of m.values()) { sum += s.v; dig = s.digital; }
    virtual.set(id, Math.max(-1, Math.min(1, sum)), dig);
  };
  interface SlideEntry { readonly el: HTMLElement; readonly id: string; readonly value: number; }
  interface SlidePointer { readonly group: string; readonly owner: object; current: SlideEntry | null; }
  const slideGroups = new Map<string, SlideEntry[]>();
  const slidePointers = new Map<number, SlidePointer>();
  const slideOwners = new Map<HTMLElement, Set<object>>();
  const markSlide = (el: HTMLElement, owner: object, on: boolean): void => {
    let owners = slideOwners.get(el);
    if (on) {
      if (!owners) slideOwners.set(el, (owners = new Set()));
      owners.add(owner);
      el.dataset.pressed = "";
    } else if (owners) {
      owners.delete(owner);
      if (!owners.size) { slideOwners.delete(el); delete el.dataset.pressed; }
    }
  };
  const hitSlide = (group: string, x: number, y: number): SlideEntry | null => {
    const entries = slideGroups.get(group) ?? [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]!, b = entry.el.getBoundingClientRect();
      if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return entry;
    }
    return null;
  };
  const moveSlide = (pointer: SlidePointer, next: SlideEntry | null): void => {
    if (pointer.current === next) return;
    if (pointer.current) { write(pointer.current.id, pointer.owner, 0, true); markSlide(pointer.current.el, pointer.owner, false); }
    pointer.current = next;
    if (next) { write(next.id, pointer.owner, next.value, true); markSlide(next.el, pointer.owner, true); virtual.press(next.id, next.value, true); }
  };
  const slide = (c: ButtonControl | ZoneControl, el: HTMLElement): void => {
    const group = c.slide!;
    const entry: SlideEntry = { el, id: c.id, value: c.value ?? 1 };
    const entries = slideGroups.get(group);
    if (entries) entries.push(entry); else slideGroups.set(group, [entry]);
    const finish = (pointerId: number): void => {
      const pointer = slidePointers.get(pointerId);
      if (!pointer) return;
      moveSlide(pointer, null);
      slidePointers.delete(pointerId);
    };
    el.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      try { el.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
      const pointer: SlidePointer = { group, owner: {}, current: null };
      slidePointers.set(e.pointerId, pointer);
      moveSlide(pointer, hitSlide(group, e.clientX, e.clientY) ?? entry);
    });
    const onMove = (e: PointerEvent): void => {
      const pointer = slidePointers.get(e.pointerId);
      if (pointer) { e.preventDefault(); moveSlide(pointer, hitSlide(pointer.group, e.clientX, e.clientY)); }
    };
    const onUp = (e: PointerEvent): void => finish(e.pointerId);
    doc.addEventListener("pointermove", onMove, true);
    doc.addEventListener("pointerup", onUp, true);
    doc.addEventListener("pointercancel", onUp, true);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    teardown.push(() => {
      doc.removeEventListener("pointermove", onMove, true);
      doc.removeEventListener("pointerup", onUp, true);
      doc.removeEventListener("pointercancel", onUp, true);
      for (const [pointerId, pointer] of slidePointers) if (pointer.group === group) finish(pointerId);
      const list = slideGroups.get(group);
      if (list) { const i = list.indexOf(entry); if (i >= 0) list.splice(i, 1); if (!list.length) slideGroups.delete(group); }
    });
  };
  // (A pointer's life on an element: captured on the way down, so a thumb sliding off still lets go where it should.)
  const track = (el: HTMLElement, down: (e: PointerEvent) => void, move: ((e: PointerEvent) => void) | null, up: (e: PointerEvent) => void): void => {
    const pointers = new Set<number>();
    const onDown = (e: PointerEvent): void => {
      e.preventDefault();
      // (Capture can refuse a pointer the browser no longer counts as active -- the press still counts.)
      try { el.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
      pointers.add(e.pointerId); el.dataset.pressed = ""; down(e); };
    const onMove = (e: PointerEvent): void => { if (pointers.has(e.pointerId) && move) move(e); };
    const onUp = (e: PointerEvent): void => { if (!pointers.delete(e.pointerId)) return; if (!pointers.size) delete el.dataset.pressed; up(e); };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  };

  const button = (c: ButtonControl): void => {
    const el = doc.createElement("div");
    el.className = `keel-ctl-btn${c.className ? ` ${c.className}` : ""}`;
    Object.assign(el.dataset, { id: c.id, shape: c.shape ?? "round" });
    el.style.setProperty("--size", String(c.size ?? 64));
    el.textContent = c.label ?? "";
    place(el, c.anchor, c.x, c.y);
    let on = false;
    const down = (e: PointerEvent): void => {
      const b = el.getBoundingClientRect(), ripple = doc.createElement("span");
      ripple.className = "keel-ctl-ripple";
      ripple.style.setProperty("--rx", `${e.clientX - b.left}px`);
      ripple.style.setProperty("--ry", `${e.clientY - b.top}px`);
      ripple.addEventListener("animationend", () => ripple.remove());
      el.append(ripple);
      virtual.press(c.id, c.value ?? 1, true);
      if (c.toggle) { on = !on; if (on) el.dataset.on = ""; else delete el.dataset.on; write(c.id, el, on ? c.value ?? 1 : 0, true); } else write(c.id, el, c.value ?? 1, true);
    };
    if (c.slide) slide(c, el); else track(el, down, null, () => { if (!c.toggle) write(c.id, el, 0, true); });
    root.append(el);
  };

  const stick = (c: StickControl): void => {
    const floating = c.region !== undefined, r = c.radius ?? 60;
    const base = doc.createElement("div"), knob = doc.createElement("div");
    base.className = "keel-ctl-stick"; knob.className = "keel-ctl-knob";
    base.style.setProperty("--r", String(r));
    if (floating) base.dataset.floating = "";
    base.append(knob);
    const home = (): void => place(base, c.anchor, c.at[0] - r, c.at[1] - r);
    home();
    // (A floating stick is caught by its region -- the thumb lands anywhere in it and the stick comes to the thumb.)
    const catcher = floating ? doc.createElement("div") : base;
    if (floating) { catcher.className = "keel-ctl-region"; rect(catcher, c.region!); root.append(catcher); }
    let cx = 0, cy = 0;
    const set = (e: PointerEvent): void => {
      const scale = Number(getComputedStyle(root).getPropertyValue("--keel-ctl-scale")) || 1;
      const v = stickValue(e.clientX - cx, e.clientY - cy, r * scale, c.deadzone);
      base.style.setProperty("--dx", String(v.knob.x / scale));
      base.style.setProperty("--dy", String(v.knob.y / scale));
      if (c.x) write(c.x, base, v.x, false);
      if (c.y) write(c.y, base, v.y, false);
    };
    track(catcher, (e) => {
      base.dataset.pressed = "";
      if (floating) {
        const h = root.getBoundingClientRect(), scale = Number(getComputedStyle(root).getPropertyValue("--keel-ctl-scale")) || 1;
        Object.assign(base.style, { left: `${e.clientX - h.left - r * scale}px`, top: `${e.clientY - h.top - r * scale}px`, right: "", bottom: "" });
      }
      const b = base.getBoundingClientRect();
      cx = b.left + b.width / 2; cy = b.top + b.height / 2;
      set(e);
    }, set, () => {
      delete base.dataset.pressed;
      base.style.setProperty("--dx", "0"); base.style.setProperty("--dy", "0");
      if (c.x) write(c.x, base, 0, false);
      if (c.y) write(c.y, base, 0, false);
      if (floating) home();
    });
    root.append(base);
  };

  const zone = (c: ZoneControl): void => {
    const el = doc.createElement("div");
    el.className = "keel-ctl-zone";
    el.dataset.id = c.id;
    el.textContent = c.label ?? "";
    rect(el, c.rect);
    if (c.slide) slide(c, el); else track(el, () => { virtual.press(c.id, c.value, true); write(c.id, el, c.value, true); }, null, () => write(c.id, el, 0, true));
    root.append(el);
  };

  const slider = (c: SliderControl): void => {
    const el = doc.createElement("div");
    el.className = "keel-ctl-slider";
    el.dataset.id = c.id;
    el.textContent = c.label ?? "";
    el.style.setProperty("--w", String(c.width ?? 56));
    el.style.setProperty("--h", String(c.height ?? 180));
    place(el, c.anchor, c.x, c.y);
    const set = (e: PointerEvent): void => {
      const b = el.getBoundingClientRect(), v = sliderValue(e.clientY, b.top, b.height);
      el.style.setProperty("--v", String(v));
      write(c.id, el, v, false);
    };
    track(el, set, set, () => { if (c.spring !== false) { el.style.setProperty("--v", "0"); write(c.id, el, 0, false); } });
    root.append(el);
  };

  // Tilt: the device's roll, from level (calibrated) -- iOS asks permission, which only a tap may request.
  let zero = 0, roll = 0;
  const tilt = (c: TiltControl): void => {
    const win = doc.defaultView as (Window & { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }) | null;
    if (!win) return;
    const layoutGeneration = generation;
    const onTilt = (e: DeviceOrientationEvent): void => {
      roll = rollOf(e.beta ?? 0, e.gamma ?? 0, win.screen?.orientation?.angle ?? 0);
      write(c.id, root, tiltValue(roll, zero, c.range, c.deadzone), false);
    };
    const ask = win.DeviceOrientationEvent?.requestPermission;
    const listen = (): void => win.addEventListener("deviceorientation", onTilt);
    if (ask) {
      const once = (): void => { root.removeEventListener("pointerdown", once, true); void ask().then((p) => { if (p === "granted" && !disposed && layoutGeneration === generation) listen(); }); };
      root.addEventListener("pointerdown", once, true);
      teardown.push(() => root.removeEventListener("pointerdown", once, true));
    } else listen();
    teardown.push(() => win.removeEventListener("deviceorientation", onTilt));
  };

  const build = (l: TouchLayout): void => {
    if (disposed) return;
    generation += 1;
    for (const t of teardown) t();
    teardown = [];
    for (const id of shares.keys()) virtual.clear(id);
    shares.clear();
    slideGroups.clear();
    slidePointers.clear();
    slideOwners.clear();
    root.replaceChildren();
    root.dataset.layout = l.name;
    for (const c of l.controls) {
      if (c.type === "button") button(c);
      else if (c.type === "stick") stick(c);
      else if (c.type === "zone") zone(c);
      else if (c.type === "slider") slider(c);
      else tilt(c);
    }
    current = l;
  };
  build(layout);

  return {
    root,
    get layout() { return current; },
    setLayout: build,
    force(on) { if (on) root.dataset.keelForce = ""; else delete root.dataset.keelForce; },
    calibrate() { zero = roll; },
    destroy() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      for (const t of teardown) t();
      teardown = [];
      for (const id of shares.keys()) virtual.clear(id);
      shares.clear(); slideGroups.clear(); slidePointers.clear(); slideOwners.clear();
      root.remove();
    },
  };
}
