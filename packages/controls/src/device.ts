// What the player is holding, from what the device can DO -- not how big its
// screen is (a phone in landscape is wider than a small laptop; an iPad says
// it's a Mac). The signals: how many touch points it has, whether its main
// pointer is coarse (a finger) or fine (a mouse), whether anything can hover,
// the browser's own "this is a mobile" hint where it gives one, and the user
// agent as the last word on the OS. classifyDevice is pure (tests hand it
// signals); detectDevice reads the page; markDevice writes the answer onto
// <html> as data attributes, so a stylesheet can target a phone, a tablet, a
// touch screen or a gamepad player without a line of script:
//
//   html[data-keel-device="phone"] .hud { font-size: 1.2em }
//   html[data-keel-input="gamepad"] .keel-ctl { display: none }

/** What a page can tell about its device. */
export interface DeviceSignals {
  /** navigator.maxTouchPoints. */
  readonly touchPoints: number;
  /** (pointer: coarse) -- the main pointer is a finger. */
  readonly coarse: boolean;
  /** (any-pointer: fine) -- a mouse or trackpad is attached, even alongside touch. */
  readonly anyFine: boolean;
  /** (hover: hover) -- the main pointer can hover. */
  readonly hover: boolean;
  /** navigator.userAgentData.mobile, where the browser says (Chromium); undefined elsewhere. */
  readonly uaMobile?: boolean | undefined;
  readonly userAgent: string;
  /** Running installed (display-mode: standalone, or iOS's navigator.standalone). */
  readonly standalone: boolean;
  /** The page can read the device's tilt (DeviceOrientationEvent exists). */
  readonly orientation: boolean;
}

export type DeviceKind = "phone" | "tablet" | "desktop";
export type DeviceOs = "ios" | "android" | "windows" | "mac" | "linux" | "chromeos" | "other";

export interface Device {
  readonly kind: DeviceKind;
  readonly os: DeviceOs;
  /** It has a touch screen (a touch laptop too). */
  readonly touch: boolean;
  /** Touch is how it's mainly used: a phone or tablet, not a laptop that happens to have a touch screen. */
  readonly touchFirst: boolean;
  readonly standalone: boolean;
  /** Tilt steering is possible (a touch-first device that reports its orientation). */
  readonly tilt: boolean;
}

const osOf = (ua: string, touchPoints: number): DeviceOs => {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  // (iPadOS 13+ asks for the desktop site: a Mac user agent -- but no Mac has a touch screen.)
  if (/Macintosh/.test(ua) && touchPoints > 1) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/CrOS/.test(ua)) return "chromeos";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  if (/Linux|X11/.test(ua)) return "linux";
  return "other";
};

/** The device, from its signals. */
export function classifyDevice(s: DeviceSignals): Device {
  const ua = s.userAgent, os = osOf(ua, s.touchPoints);
  const touch = s.touchPoints > 0;
  // A phone: the browser says so, or its user agent does (Android phones carry "Mobile"; tablets don't).
  const phoneUa = /iPhone|iPod|Windows Phone|Mobile.*Firefox|Android.*Mobile|Opera Mini|IEMobile/.test(ua);
  const tabletUa = /iPad|Tablet|Silk|Kindle|PlayBook/.test(ua) || (os === "android" && !/Mobile/.test(ua)) || (os === "ios" && !/iPhone|iPod/.test(ua));
  // Touch-first: a finger is the main pointer and nothing hovers -- a laptop with a touch screen still has a fine,
  // hovering pointer.
  const fingers = touch && s.coarse && !s.hover;
  const kind: DeviceKind = s.uaMobile === true || phoneUa ? "phone" : tabletUa && touch ? "tablet" : fingers && !s.anyFine ? "tablet" : "desktop";
  const touchFirst = kind !== "desktop";
  return { kind, os, touch, touchFirst, standalone: s.standalone, tilt: touchFirst && s.orientation };
}

interface EnvLike {
  readonly navigator?: { readonly maxTouchPoints?: number; readonly userAgent?: string; readonly userAgentData?: { readonly mobile?: boolean }; readonly standalone?: boolean };
  matchMedia?(query: string): { readonly matches: boolean };
  readonly DeviceOrientationEvent?: unknown;
}

/** The signals from a page (globalThis by default); anything missing reads as a desktop's. */
export function readSignals(env: EnvLike = globalThis as EnvLike): DeviceSignals {
  const nav = env.navigator, mq = (q: string): boolean => Boolean(env.matchMedia?.(q).matches);
  return {
    touchPoints: nav?.maxTouchPoints ?? 0,
    coarse: mq("(pointer: coarse)"),
    anyFine: mq("(any-pointer: fine)"),
    hover: mq("(hover: hover)"),
    uaMobile: nav?.userAgentData?.mobile,
    userAgent: nav?.userAgent ?? "",
    standalone: mq("(display-mode: standalone)") || nav?.standalone === true,
    orientation: env.DeviceOrientationEvent !== undefined,
  };
}

/** The device this page is on. */
export const detectDevice = (env?: EnvLike): Device => classifyDevice(readSignals(env));

/** What the player last touched: the keyboard (and mouse), a gamepad, or the touch screen. */
export type InputKind = "keyboard" | "gamepad" | "touch";

interface RootLike { readonly dataset: Record<string, string | undefined> }

/**
 * Write the device (and, as it changes, the input in use) onto an element -- <html> by default -- as
 * data-keel-device, data-keel-os, data-keel-touch, data-keel-standalone and data-keel-input, for stylesheets.
 */
export function markDevice(device: Device, input: InputKind | null = null, root: RootLike | undefined = (globalThis as { document?: { documentElement: RootLike } }).document?.documentElement): void {
  if (!root) return;
  root.dataset.keelDevice = device.kind;
  root.dataset.keelOs = device.os;
  root.dataset.keelTouch = device.touchFirst ? "first" : device.touch ? "yes" : "no";
  root.dataset.keelStandalone = device.standalone ? "yes" : "no";
  if (input) root.dataset.keelInput = input;
}
