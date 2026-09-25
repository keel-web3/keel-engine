import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { createControls, createTouchOverlay } from "../src/index.ts";
import type { TouchLayout } from "../src/index.ts";

class FixtureTarget extends EventTarget {
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, callback, typeof options === "boolean" ? { capture: options } : options);
  }
}
class Element extends FixtureTarget {
  readonly children: Element[] = [];
  readonly dataset: Record<string, string> = {};
  parent: Element | null = null;
  readonly ownerDocument: Doc;
  constructor(ownerDocument: Doc) { super(); this.ownerDocument = ownerDocument; }
  append(...children: Element[]): void { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  replaceChildren(...children: Element[]): void { for (const child of this.children) child.parent = null; this.children.length = 0; this.append(...children); }
  remove(): void { if (!this.parent) return; const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; }
}
class Doc extends FixtureTarget {
  defaultView: Window;
  constructor(view: EventTarget) { super(); this.defaultView = view as Window; }
  createElement(_tag: string): Element { return new Element(this); }
}
const count = (target: EventTarget): number => getEventListeners(target, "deviceorientation").length;
const TILT_ONLY: TouchLayout = { name: "tilt-only", controls: [{ type: "tilt", id: "steer", range: 28, deadzone: 2.5 }] };
const EMPTY: TouchLayout = { name: "empty", controls: [] };

async function resolveAfter(teardown: (overlay: ReturnType<typeof createTouchOverlay>) => void): Promise<{ orientation: EventTarget; root: Element }> {
  let grant!: (value: string) => void;
  const permission = new Promise<string>((resolve) => { grant = resolve; });
  const orientation = Object.assign(new EventTarget(), { DeviceOrientationEvent: { requestPermission: () => permission }, screen: { orientation: { angle: 0 } } });
  const doc = new Doc(orientation), host = new Element(doc);
  const virtual = createControls({ steer: { kind: "axis", touch: "steer" } }).virtual;
  const overlay = createTouchOverlay(host as unknown as HTMLElement, virtual, TILT_ONLY, { css: false });
  const root = overlay.root as unknown as Element;
  root.dispatchEvent(new Event("pointerdown"));
  teardown(overlay);
  grant("granted"); await permission; await Promise.resolve(); await Promise.resolve();
  console.log(`overlay late grant: ${JSON.stringify({ orientation: count(orientation), layout: root.dataset.layout, mounted: !!root.parent })}`);
  assert.equal(count(orientation), 0, "permission completion after teardown cannot reattach tilt");
  return { orientation, root };
}

test("a pending iOS tilt request is invalidated by a scheme change or destroy", async () => {
  const changed = await resolveAfter((overlay) => overlay.setLayout(EMPTY));
  assert.equal(changed.root.dataset.layout, "empty");
  assert.notEqual(changed.root.parent, null, "a scheme change keeps the overlay root mounted");
  const destroyed = await resolveAfter((overlay) => { overlay.destroy(); overlay.destroy(); overlay.setLayout(TILT_ONLY); });
  assert.equal(destroyed.root.parent, null);
  assert.equal(count(changed.orientation) + count(destroyed.orientation), 0);
});
