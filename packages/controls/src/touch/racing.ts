// One two-thumb racing template. Geometry, styling and action IDs are shared;
// games only map the IDs and pass saved reach/handedness preferences.
import type { TouchLayout, TouchControl, ButtonControl, Anchor } from "./layout.ts";
export interface RacingTouchOptions {
  readonly swap?: boolean;
  /** Lift the thumb controls by this many CSS pixels, before UI scaling. */
  readonly lift?: number;
  readonly manual?: boolean;
  /** Optional vehicle horn beside pause; existing thumb positions remain unchanged. */
  readonly horn?: boolean;
}
export function racingTouchLayout({swap = false, lift = 0, manual = false, horn = false}: RacingTouchOptions = {}): TouchLayout {
  lift = Number.isFinite(lift) ? Math.max(0, Math.min(64, lift)) : 0;
  const steer: Anchor = swap ? "br" : "bl", pedal: Anchor = swap ? "bl" : "br";
  const button = (id: string, label: string, anchor: Anchor, x: number, y: number, size: number, extras: Partial<ButtonControl> = {}): ButtonControl =>
    ({type: "button", id, label, anchor, x, y: y + lift, size, shape: "square", ripple: false, ...extras});
  const controls: TouchControl[] = [
    // Fixed horizontal axis: touching either half already turns. Vertical movement is ignored.
    {type: "stick", x: "steer", anchor: steer, at: [86, 96 + lift], radius: 64, deadzone: 0.08},
    button("gas", "GAS", pedal, 16, 20, 72, {shape: "pill", slide: "pedals", pulse: false}),
    button("brake", "BRAKE", pedal, 98, 20, 60, {shape: "pill", slide: "pedals", pulse: false}),
    button("handbrake", "DRIFT", pedal, 98, 105, 60, {slide: "pedals", pulse: false, with: {gas: 1}}),
    button("boost", "BOOST", pedal, 16, 120, 72, {slide: "pedals", pulse: false, with: {gas: 1}}),
    button("pause", "Ⅱ", steer, 22, 178, 44),
    button("camera", "VIEW", pedal, 16, 210, 44),
    button("rearview", "REAR", pedal, 66, 210, 44),
    button("phone", "PHONE", pedal, 116, 210, 44),
  ];
  if (horn) controls.push(button("horn", "HORN", steer, 72, 178, 44));
  if (manual) controls.push(button("shiftDown", "−", steer, 22, 234, 52), button("shiftUp", "+", steer, 84, 234, 52));
  return {name: "racing-thumbs", controls};
}
export const RACING_THUMBS_CSS = `
.keel-ctl{--keel-ctl-scale:1;position:absolute;inset:0;z-index:20;display:none;pointer-events:none;user-select:none;-webkit-user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
html[data-keel-touch="first"] .keel-ctl,.keel-ctl[data-keel-force]{display:block}
html[data-keel-input="gamepad"] .keel-ctl:not([data-keel-force]){display:none}
.keel-ctl>*{position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box}
.keel-ctl-btn{width:calc(var(--size)*1px*var(--keel-ctl-scale));height:calc(var(--size)*1px*var(--keel-ctl-scale));display:grid;place-items:center;color:var(--keel-ctl-ink);font:var(--keel-ctl-font);letter-spacing:.04em;background:var(--keel-ctl-fill);border:1px solid var(--keel-ctl-rim)}
.keel-ctl-btn[data-shape="pill"]{height:calc(var(--size)*1.25px*var(--keel-ctl-scale))}
.keel-ctl-stick{width:calc(var(--r)*2px*var(--keel-ctl-scale));height:calc(var(--r)*2px*var(--keel-ctl-scale));border:1px solid var(--keel-ctl-rim)}
.keel-ctl-knob{position:absolute;left:50%;top:50%;transform:translate(calc(var(--dx,0)*1px*var(--keel-ctl-scale)),calc(var(--dy,0)*1px*var(--keel-ctl-scale)))}
.keel-ctl-stick:not([data-pressed]) .keel-ctl-knob{transition:transform 100ms ease-out}
@media(prefers-reduced-motion:reduce){.keel-ctl *{transition:none!important}}

.keel-ctl[data-layout="racing-thumbs"]{--keel-ctl-accent:#ffb03a;--keel-ctl-ink:#fff2d8;--keel-ctl-fill:rgba(13,12,16,.65);--keel-ctl-rim:rgba(255,214,128,.65);--keel-ctl-glow:none;--keel-ctl-font:800 12px/1 system-ui,sans-serif}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn{min-width:44px;min-height:44px;border-radius:9px;border-width:1px;backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:inset 0 -3px rgba(0,0,0,.4);transition:background-color 60ms,border-color 60ms;}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn[data-pressed]{transform:none;animation:none;background:rgba(255,176,58,.45);border-color:#ffce7b}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn[data-id="gas"]{border-color:#ffb03a;background:rgba(103,63,17,.6)}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn[data-id="brake"]{border-color:rgba(255,114,133,.8)}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn[data-id="gas"]::after,.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn[data-id="brake"]::after{content:"";position:absolute;inset:12px;background:repeating-linear-gradient(0deg,transparent 0 9px,rgba(255,255,255,.1) 9px 11px);pointer-events:none}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-stick{border-radius:32px;opacity:1;background:linear-gradient(90deg,rgba(255,176,58,.1),rgba(13,12,16,.65) 45%,rgba(255,176,58,.1));}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-stick::before,.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-stick::after{position:absolute;top:50%;transform:translateY(-50%);color:rgba(255,214,128,.7);font:700 22px/1 system-ui;pointer-events:none}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-stick::before{content:"◀";left:7px}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-stick::after{content:"▶";right:7px}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-knob{width:36%;height:52%;margin:-26% 0 0 -18%;border-radius:12px;background:rgba(255,176,58,.7);border:1px solid #ffce7b;box-shadow:none}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-stick[data-pressed]{border-color:#ffce7b}
.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn[data-id="camera"],.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn[data-id="rearview"],.keel-ctl[data-layout="racing-thumbs"] .keel-ctl-btn[data-id="phone"]{font-size:10px;background:rgba(13,12,16,.5)}
`;
