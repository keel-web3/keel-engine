// The keys: which one a point on the face is, and how each moves when pressed. Plan millimetres on the face.

import { type Mat4, compose, identity, rotationAbout, scaling, translation, rotationZ } from "@keel-engine/studio";
import { MM, fromPlan, toPlan } from "./spec.ts";
import type { KeyId } from "./parts.ts";

export const KEYS: readonly KeyId[] = ["up", "down", "left", "right", "a", "b", "select", "start"];

export type Hit = { readonly kind: "key"; readonly key: KeyId } | { readonly kind: "screen"; readonly u: number; readonly v: number } | { readonly kind: "body" } | { readonly kind: "none" };

/** What is under a plan point (mm) on the face. Keys get a little slop round them, as a thumb does. */
export function hitFace(X: number, Y: number): Hit {
  const [x, y] = fromPlan(X, Y);
  if (x < 0 || y < 0 || x > MM.w || y > MM.h) return { kind: "none" };
  const d = MM.dpad, dx = x - d.x, dy = y - d.y, half = d.span / 2 + 0.8, arm = d.arm / 2 + 0.8;
  if ((Math.abs(dx) <= half && Math.abs(dy) <= arm) || (Math.abs(dy) <= half && Math.abs(dx) <= arm)) {
    if (Math.hypot(dx, dy) < d.arm * 0.22) return { kind: "body" };
    return { kind: "key", key: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down" };
  }
  for (const k of ["a", "b"] as const) { const m = MM[k]; if (Math.hypot(x - m.x, y - m.y) <= m.r + 1.2) return { kind: "key", key: k }; }
  for (const k of ["select", "start"] as const) {
    const m = MM[k], a = (m.angle * Math.PI) / 180;
    const lx = (x - m.x) * Math.cos(a) - (y - m.y) * Math.sin(a), ly = (x - m.x) * Math.sin(a) + (y - m.y) * Math.cos(a);
    const half = m.len / 2 - m.w / 2;
    const cx = Math.max(-half, Math.min(half, lx));
    if (Math.hypot(lx - cx, ly) <= m.w / 2 + 1.4) return { kind: "key", key: k };
  }
  const s = MM.screen;
  if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) return { kind: "screen", u: (x - s.x0) / (s.x1 - s.x0), v: (y - s.y0) / (s.y1 - s.y0) };
  return { kind: "body" };
}

export interface KeyMotion { readonly travel: number; readonly squash: number }
export type KeyState = Partial<Record<KeyId, KeyMotion>>;

// (The rock keeps the pressed arm tip's travel, about 0.82 mm, now that the arms are shorter: 4.2 deg at a 22.4 mm span.)
const DPAD_TILT = Math.asin((11.2 * Math.sin((4.2 * Math.PI) / 180)) / (MM.dpad.span / 2));

/** The transform (plan mm) that moves a key part for the current presses. */
export function keyTransform(part: "dpad" | "a" | "b" | "select" | "start", keys: KeyState): Mat4 {
  if (part === "dpad") {
    const t = (k: KeyId) => keys[k]?.travel ?? 0;
    const tx = t("right") - t("left"), ty = t("up") - t("down"), mag = Math.min(1, Math.hypot(tx, ty));
    if (mag < 1e-4) return identity();
    const [cx, cy] = toPlan(MM.dpad.x, MM.dpad.y);
    // Rock about the pivot under the centre: the pressed arm goes down, the opposite one up.
    const axis: [number, number, number] = [-ty / Math.hypot(tx, ty), tx / Math.hypot(tx, ty), 0];
    return compose(translation(0, 0, -0.22 * mag), rotationAbout(axis, -DPAD_TILT * mag, [cx, cy, -1.2]));
  }
  const m = keys[part];
  if (!m || (m.travel < 1e-4 && m.squash < 1e-4)) return identity();
  if (part === "a" || part === "b") {
    const [cx, cy] = toPlan(MM[part].x, MM[part].y);
    const sq = m.squash;
    return compose(translation(cx, cy, -1.25 * m.travel), scaling(1 + 0.035 * sq, 1 + 0.035 * sq, 1 - 0.11 * sq), translation(-cx, -cy, 0));
  }
  const k = MM[part], [cx, cy] = toPlan(k.x, k.y), a = (k.angle * Math.PI) / 180;
  const sq = m.squash;
  return compose(translation(cx, cy, -0.75 * m.travel), rotationZ(a), scaling(1 + 0.03 * sq, 1 + 0.05 * sq, 1 - 0.1 * sq), rotationZ(-a), translation(-cx, -cy, 0));
}
