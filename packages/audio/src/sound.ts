// Music and sound effects on a page: a small speaker in a corner, off until
// the listener turns it on (a browser only lets a page sound after a click in
// it), then the project's own record, following it as it changes, and its
// sound effects. If they had it on last time, their first click on the page
// brings it back. (NOCTURNES' roomSound, for any project.)
//
// On a KEEL page the KEEL audio module (globalThis.KEEL_AUDIO) owns the
// button, the context and the rules -- configure, onStart, onStop,
// mountButton, start, stop, volume; anywhere else Tone (globalThis.Tone) runs
// on its own and this makes the button.
//
//   const sound = createSound(host, { id: "wallrun", sfx: { seed, style: "lofi" } });
//   sound.setPlan(scoreOf(moodFor({ energy: 0.6, weather: ["waves", "wind"] }), seed));
//   sound.setIntensity(running ? 0.9 : 0.2);
//   sound.sfx.play("jump");               // (silent until the listener turns sound on)

import { play, render } from "./player.ts";
import type { Band, RenderOptions } from "./player.ts";
import { createSfx } from "./sfx.ts";
import type { Sfx, SfxLoop, SfxOptions, SfxParams, SfxStyle } from "./sfx.ts";
import { hash } from "./score.ts";
import type { Plan, SectionName } from "./score.ts";
import { pageKeelAudio, pageTone } from "./tone.ts";

const SPEAKER = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/><path data-wave fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/><path data-mute fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></svg>';

/** The sound effects while there's no sound: nothing. */
export interface QuietSfx {
  play(name: string, p?: SfxParams): null;
  loop(name: string, p?: SfxParams): SfxLoop;
  stopAll(fade?: number): void;
  readonly style: SfxStyle | null;
}
const QUIET: QuietSfx = { play: () => null, loop: () => ({ set() {}, stop() {}, playing: false }), stopAll() {}, style: null };

export type Corner = "top-right" | "top-left" | "bottom-right" | "bottom-left";
export interface SoundOptions {
  /** The piece's id (KEEL remembers the listener's choice by it). */
  readonly id?: string;
  /** Where the choice is remembered off KEEL (localStorage). */
  readonly key?: string;
  readonly corner?: Corner;
  /** Draw the speaker button (default true). */
  readonly button?: boolean;
  /** Sound effects to make once sound is on. */
  readonly sfx?: SfxOptions | null;
  /** Where intensity starts (none: the plan's energy). */
  readonly intensity?: number | null;
}
/** Where the band is in the loop. */
export interface SoundPosition { readonly bar: number; readonly of: number; readonly sec: SectionName | undefined; readonly seconds: number }
/** A page's sound. */
export interface Sound {
  /** The music now: a new plan gets its own record; the same keeps playing. */
  setPlan(p: Plan | null | undefined): void;
  /** 0 idle .. 0.5 as composed .. 1 driving (layers in and out; the loop runs on). */
  setIntensity(x: number, ramp?: number): void;
  readonly intensity: number | null;
  /** Something happened: "dim" (a little quieter), "bright" (back). */
  react(what: string): void;
  /** The sound effects (quiet while sound is off). */
  readonly sfx: Sfx | QuietSfx;
  readonly on: boolean;
  readonly plan: Plan | null;
  start(): unknown;
  stop(): unknown;
  toggle(): unknown;
  /** The listener's level, 0-1. */
  volume: number;
  position(): SoundPosition | null;
  /** One seamless loop of the current music, rendered offline. */
  renderLoop(opts?: RenderOptions): Promise<AudioBuffer | null>;
  onChange(fn: (sound: Sound) => void): () => void;
}

export function createSound(host: HTMLElement | null, { id = "keel", key = `${id}:sound`, corner = "top-right", button: withButton = true, sfx: sfxOpts = null, intensity = null }: SoundOptions = {}): Sound {
  const K = pageKeelAudio();
  const Tone = pageTone;
  let plan: Plan | null = null;
  let playing: number | null = null; // (what the band is playing: its plan's hash)
  let band: Band | null = null;
  let on = false;
  let wanted = false;
  let level = intensity;
  let fx: Sfx | null = null;
  const watchers: ((s: Sound) => void)[] = [];
  try { wanted = localStorage.getItem(key) === "on"; } catch { /* (no storage: a sandboxed page) */ }
  const planKey = (p: Plan | null) => (p ? hash(JSON.stringify(p)) : null);
  const notify = () => { for (const w of watchers) { try { w(api); } catch { /* (a watcher's own trouble) */ } } };

  async function begin() {
    const T = Tone();
    if (!T) return;
    if (!K) await T.start(); // (inside the listener's click: that's what lets it sound)
    if (sfxOpts && !fx) fx = createSfx(T, sfxOpts);
    if (plan) {
      band?.stop(0.25, { transport: false }); // (the next one takes the transport on)
      band = play(T, plan, null, level === null ? {} : { intensity: level }); // (into Tone's destination: keel-audio sets its level and mute)
      playing = planKey(plan);
    }
    notify();
  }
  function end() { band?.stop(); band = null; playing = null; fx?.stopAll(); notify(); }
  function remember(v: boolean) { try { localStorage.setItem(key, v ? "on" : "off"); } catch { /* (no storage) */ } }

  let button: HTMLButtonElement | null = null;
  function label() {
    if (!button) return;
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", on ? "Turn the sound off" : "Turn the sound on");
    button.title = on ? "sound off" : "sound on";
    button.querySelector<SVGElement>("[data-wave]")!.style.display = on ? "" : "none";
    button.querySelector<SVGElement>("[data-mute]")!.style.display = on ? "none" : "";
  }
  async function set(v: boolean) {
    on = v;
    remember(on);
    label();
    if (on) await begin(); else end();
  }
  if (K) {
    // (KEEL's module draws the button, remembers the choice per piece and
    // answers the gesture; it tells us when the listener starts and stops.)
    K.configure({ id: String(id).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 96) || "keel" });
    K.onStart(() => { on = true; void begin(); });
    K.onStop(() => { on = false; end(); });
    if (withButton) K.mountButton(host, { corner });
  } else {
    if (withButton && host) {
      const b = document.createElement("button");
      button = b;
      b.type = "button";
      b.innerHTML = SPEAKER;
      const [v, h] = corner.split("-");
      b.style.cssText = `position:absolute;${v}:10px;${h}:10px;z-index:3;width:30px;height:30px;padding:0;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(8,8,14,.55);color:#cfd3e6;cursor:pointer;opacity:.7`;
      b.onclick = (e) => { e.stopPropagation(); void set(!on); }; // (it isn't a click on the game)
      b.onmouseenter = () => { b.style.opacity = "1"; };
      b.onmouseleave = () => { b.style.opacity = ".7"; };
      label();
      host.append(b);
    }
    // On last time: the first click anywhere on the page brings it back.
    if (wanted) {
      const again = () => { removeEventListener("pointerdown", again, true); if (!on) void set(true); };
      addEventListener("pointerdown", again, true);
    }
    // Hidden, it rests; back, it plays on.
    document.addEventListener("visibilitychange", () => {
      const ctx = Tone()?.getContext?.().rawContext as AudioContext | undefined;
      if (!ctx || !on) return;
      if (document.hidden) void ctx.suspend?.(); else void ctx.resume?.();
    });
  }

  const api: Sound = {
    setPlan(p) {
      plan = p ?? null;
      if (on && plan && planKey(plan) !== playing) void begin();
      else if (on && !plan) { band?.stop(); band = null; playing = null; notify(); }
      else notify();
    },
    setIntensity(x, ramp) { level = x; band?.setIntensity(x, ramp); },
    get intensity() { return band?.intensity ?? level; },
    react(what) { band?.react(what); },
    get sfx() { return on && fx ? fx : QUIET; },
    get on() { return on; },
    get plan() { return plan; },
    start: () => (K ? K.start() : set(true)),
    stop: () => (K ? K.stop() : set(false)),
    toggle: () => (on ? api.stop() : api.start()),
    get volume() { return K ? K.volume : 10 ** ((Tone()?.getDestination().volume.value ?? 0) / 20); },
    set volume(v) { const T = Tone(); if (K) K.volume = v; else if (T) T.getDestination().volume.value = 20 * Math.log10(Math.max(1e-4, v)); },
    position() {
      const T0 = Tone();
      if (!band || !plan || !T0) return null;
      const T = T0.getTransport();
      const bar = Math.floor(T.ticks / (T.PPQ * 4)) % plan.loopBars;
      return { bar, of: plan.loopBars, sec: plan.bars[bar]?.sec, seconds: T.seconds % plan.loopSec };
    },
    renderLoop: (opts) => { const T = Tone(); return plan && T ? render(T, plan, opts) : Promise.resolve(null); },
    onChange(fn) { watchers.push(fn); return () => watchers.splice(watchers.indexOf(fn), 1); },
  };
  return api;
}
