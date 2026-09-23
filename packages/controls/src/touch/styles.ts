// The touch controls' default look -- plain CSS a game restyles without
// touching code: override the custom properties for colours and size, target
// the classes and data attributes for anything more (a pressed button carries
// data-pressed, a stick's knob follows --dx/--dy, a slider fills to --v), and
// the animations are keyframes you can replace by name. The overlay only shows
// on a touch-first device (markDevice's data-keel-touch="first") unless it's
// forced with data-keel-force on the overlay.
//
//   :root { --keel-ctl-accent: #ff2d6f; --keel-ctl-scale: 1.15; }
//   .keel-ctl-btn[data-id="boost"][data-pressed] { animation-name: my-flame; }

export const CONTROLS_CSS = `
.keel-ctl {
  --keel-ctl-scale: 1;
  --keel-ctl-accent: #38e8ff;
  --keel-ctl-ink: #eaf6ff;
  --keel-ctl-fill: rgba(10, 16, 38, 0.42);
  --keel-ctl-rim: rgba(160, 220, 255, 0.55);
  --keel-ctl-glow: 0 0 calc(14px * var(--keel-ctl-scale)) rgba(56, 232, 255, 0.55);
  --keel-ctl-font: 700 calc(15px * var(--keel-ctl-scale)) / 1 system-ui, sans-serif;
  position: absolute; inset: 0; z-index: 20; display: none;
  pointer-events: none; user-select: none; -webkit-user-select: none; touch-action: none;
  -webkit-tap-highlight-color: transparent;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
html[data-keel-touch="first"] .keel-ctl, .keel-ctl[data-keel-force] { display: block; }
html[data-keel-input="gamepad"] .keel-ctl:not([data-keel-force]) { display: none; }
.keel-ctl > * { position: absolute; pointer-events: auto; touch-action: none; box-sizing: border-box; }

.keel-ctl-btn {
  width: calc(var(--size) * 1px * var(--keel-ctl-scale)); height: calc(var(--size) * 1px * var(--keel-ctl-scale));
  display: grid; place-items: center; overflow: hidden;
  color: var(--keel-ctl-ink); font: var(--keel-ctl-font); letter-spacing: 0.04em;
  background: var(--keel-ctl-fill); border: 2px solid var(--keel-ctl-rim); border-radius: 50%;
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  transition: transform 90ms ease-out, background-color 90ms, box-shadow 120ms;
}
.keel-ctl-btn[data-shape="pill"] { border-radius: calc(18px * var(--keel-ctl-scale)); height: calc(var(--size) * 1.25px * var(--keel-ctl-scale)); }
.keel-ctl-btn[data-shape="square"] { border-radius: calc(10px * var(--keel-ctl-scale)); }
.keel-ctl-btn[data-pressed] {
  transform: scale(0.9); background: color-mix(in srgb, var(--keel-ctl-accent) 45%, transparent);
  border-color: var(--keel-ctl-accent); box-shadow: var(--keel-ctl-glow);
  animation: keel-ctl-pop 160ms ease-out;
}
.keel-ctl-btn[data-on] { border-color: var(--keel-ctl-accent); box-shadow: var(--keel-ctl-glow); }
.keel-ctl-ripple {
  position: absolute; left: var(--rx); top: var(--ry); width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%;
  background: var(--keel-ctl-accent); pointer-events: none; animation: keel-ctl-ripple 420ms ease-out forwards;
}

.keel-ctl-stick {
  width: calc(var(--r) * 2px * var(--keel-ctl-scale)); height: calc(var(--r) * 2px * var(--keel-ctl-scale));
  border-radius: 50%; border: 2px solid var(--keel-ctl-rim); background: var(--keel-ctl-fill);
  transition: opacity 150ms; opacity: 0.8;
}
.keel-ctl-stick[data-floating]:not([data-pressed]) { opacity: 0.35; }
.keel-ctl-knob {
  position: absolute; left: 50%; top: 50%; width: 44%; height: 44%; margin: -22% 0 0 -22%; border-radius: 50%;
  background: var(--keel-ctl-rim); box-shadow: var(--keel-ctl-glow);
  transform: translate(calc(var(--dx, 0) * 1px * var(--keel-ctl-scale)), calc(var(--dy, 0) * 1px * var(--keel-ctl-scale)));
}
.keel-ctl-stick:not([data-pressed]) .keel-ctl-knob { transition: transform 120ms ease-out; }
.keel-ctl-region { background: transparent; }

.keel-ctl-zone {
  display: grid; place-items: center; color: var(--keel-ctl-ink); font: var(--keel-ctl-font); opacity: 0.25;
  font-size: calc(40px * var(--keel-ctl-scale)); transition: opacity 120ms, background-color 120ms;
}
.keel-ctl-zone[data-pressed] { opacity: 0.6; background: color-mix(in srgb, var(--keel-ctl-accent) 12%, transparent); }

.keel-ctl-slider {
  width: calc(var(--w) * 1px * var(--keel-ctl-scale)); height: calc(var(--h) * 1px * var(--keel-ctl-scale));
  border-radius: calc(14px * var(--keel-ctl-scale)); border: 2px solid var(--keel-ctl-rim); background: var(--keel-ctl-fill); overflow: hidden;
  color: var(--keel-ctl-ink); font: var(--keel-ctl-font); display: grid; place-items: end center; padding-bottom: 8px;
}
.keel-ctl-slider::before {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--v, 0) * 100%);
  background: linear-gradient(to top, var(--keel-ctl-accent), color-mix(in srgb, var(--keel-ctl-accent) 30%, transparent));
}
.keel-ctl-slider[data-pressed] { box-shadow: var(--keel-ctl-glow); }

@keyframes keel-ctl-pop { 0% { transform: scale(1); } 45% { transform: scale(0.84); } 100% { transform: scale(0.9); } }
@keyframes keel-ctl-ripple { from { transform: scale(1); opacity: 0.55; } to { transform: scale(22); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .keel-ctl * { animation: none !important; transition: none !important; } }
`;

/** Put the default stylesheet on a page once (a game's own rules, loaded after, win). */
export function injectControlsCss(doc: Document = document): void {
  if (doc.getElementById("keel-controls-css")) return;
  const style = doc.createElement("style");
  style.id = "keel-controls-css";
  style.textContent = CONTROLS_CSS;
  doc.head.prepend(style);
}
