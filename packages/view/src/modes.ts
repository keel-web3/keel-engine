// View modes: the overview (an orthographic pixel view over the map, the
// sprite path), a CHASE view behind and above one unit and a FIRST-PERSON view
// from its eyes (both perspective, the 3D path) -- and the moves between them,
// eased so the picture never jumps:
//
//   overview --possess--> glide   the overview slides onto the unit and zooms in (sprites, orthographic)
//                         swap    the same shot drawn both ways -- sprites, and a perspective camera so far
//                                 off and so narrow it matches the orthographic one -- dissolved into each other
//                         dolly   the perspective camera comes in to the chase position: its distance falls,
//                                 its fov widens so what it frames shrinks smoothly (a dolly zoom), its heading
//                                 and pitch turn round behind the unit
//                         chase   keel/camera's orbit rig: the player turns it, the arm keeps out of the ground
//   chase <--toggle--> fps        keel/camera's blend from the orbit rig to the first-person rig and back
//   chase / fps --release-->      the same moves backwards, to the overview as it was (centred on the unit)
//
// The controller is pure: it keeps the cameras and the clock, and each step
// says what to draw -- one shot, or two with the second's dissolve share.
// It knows nothing of pixels or GL.
//
//   const modes = createViewModes({ zoom, center, picture: [480, 270], world: { distance: terrainDistance(t) } });
//   modes.possess(unit, subject);  modes.toggleFirstPerson();  modes.release();
//   const f = modes.step(dt, subject, { look: [dx, dy] });   // f.shot, f.blend?.shot, f.blend?.t

import { createCamera } from "@keel-engine/camera";
import type { Camera, CameraWorld, Subject } from "@keel-engine/camera";
import type { Zoom } from "./zoom.ts";
import { nearestRung } from "./zoom.ts";

export type Vec3 = [number, number, number];
export type ViewMode = "overview" | "chase" | "fps";
export type ViewPhase = "overview" | "glide" | "swap" | "dolly" | "chase" | "fps" | "toFps" | "toChase" | "undolly" | "unswap" | "unglide";

/** An orthographic pixel view (keel/bake's pixelView). */
export interface OrthoShot { readonly kind: "ortho"; readonly center: Vec3; readonly yaw: number; readonly pitch: number; readonly k: number }
/** A perspective camera (keel/render's): eye, target, vertical fov. */
export interface PerspShot { readonly kind: "persp"; readonly eye: Vec3; readonly target: Vec3; readonly fov: number }
export type Shot = OrthoShot | PerspShot;

/** What to draw this frame: a shot, and during a swap a second one dissolved in (`t` of it, 0..1). */
export interface ViewFrame {
  readonly mode: ViewMode;
  readonly phase: ViewPhase;
  /** How far through the current phase (0..1; 1 in a settled mode). */
  readonly progress: number;
  readonly shot: Shot;
  readonly blend: { readonly shot: Shot; readonly t: number } | null;
  /** Hide the possessed unit's body (first person). */
  readonly hideSubject: boolean;
}

export interface ViewTiming {
  /** Seconds: the overview's slide and zoom onto the unit; the dissolve between the paths; the dolly in; chase <-> first person. */
  readonly glide: number;
  readonly swap: number;
  readonly dolly: number;
  readonly toggle: number;
}
export const VIEW_TIMING: ViewTiming = { glide: 0.45, swap: 0.14, dolly: 0.65, toggle: 0.35 };

export interface ViewModesOptions {
  /** The overview's continuous zoom (createZoom): its scale and pitch bucket. */
  readonly zoom: Zoom;
  /** The overview's centre and heading. */
  readonly center: Vec3;
  readonly yaw?: number;
  /** The picture's size (the perspective fov that matches an orthographic scale depends on it). */
  readonly picture: readonly [number, number];
  /** What the chase arm must stay out of (terrain: terrainDistance). */
  readonly world?: CameraWorld;
  /** The scale the glide zooms to before the swap (px/m, default 40): big enough that the matching perspective is near. */
  readonly enterK?: number;
  /** How far off the matching perspective camera sits (m, default 60; keel/render draws to 140). */
  readonly dollyDistance?: number;
  /** keel/camera's orbit options for the chase, first-person options for fps. */
  readonly chase?: { readonly distance?: number; readonly pitch?: number; readonly above?: number; readonly minPitch?: number; readonly maxPitch?: number; readonly recenter?: number };
  readonly fps?: { readonly eyeHeight?: number; readonly bob?: number };
  /** A fixed perspective fov (default: keel/camera's fovForTarget for the picture). */
  readonly fov?: number;
  readonly timing?: Partial<ViewTiming>;
}

export interface ViewModes {
  readonly mode: ViewMode;
  readonly phase: ViewPhase;
  /** The possessed unit (null in the overview). */
  readonly subject: number | null;
  readonly zoom: Zoom;
  /** keel/camera's camera (the chase and first-person rigs). */
  readonly camera: Camera;
  /** The overview's centre and heading. */
  center: Vec3;
  yaw: number;
  /** Is a move between modes under way? */
  readonly moving: boolean;
  setPicture(width: number, height: number): void;
  /** Take a unit: the overview glides onto it and the camera comes down behind it. */
  possess(unit: number, subject: Subject): void;
  /** Give it back: the camera goes back up to the overview. */
  release(): void;
  /** Chase <-> first person (only while possessed). */
  toggleFirstPerson(): void;
  /** Chase zoom: the arm's length, clamped (m). */
  setChaseDistance(d: number): void;
  /** One frame: the subject as it is now (null in the overview) and the look input (radians this frame). */
  step(dt: number, subject: Subject | null, input?: { readonly look?: readonly [number, number] }): ViewFrame;
  /** The orthographic shot that matches a perspective one looking the same way from `distance` (and the converse). */
  matchPersp(o: OrthoShot, distance?: number): PerspShot;
}

const smooth = (t: number): number => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: readonly number[], b: readonly number[], t: number): Vec3 => [lerp(a[0]!, b[0]!, t), lerp(a[1]!, b[1]!, t), lerp(a[2]!, b[2]!, t)];
const angleLerp = (a: number, b: number, t: number): number => { let d = b - a; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2; return a + d * t; };
const dirOf = (yaw: number, pitch: number): Vec3 => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];

/** The perspective camera matching an orthographic shot: looking the same way from `distance` off, its fov framing the same height. */
export function matchingPersp(o: OrthoShot, pictureHeight: number, distance = 60): PerspShot {
  const f = dirOf(o.yaw, -o.pitch);
  const target: Vec3 = [o.center[0], o.center[1], o.center[2]];
  const eye: Vec3 = [target[0] - f[0] * distance, target[1] - f[1] * distance, target[2] - f[2] * distance];
  return { kind: "persp", eye, target, fov: 2 * Math.atan(pictureHeight / o.k / 2 / distance) };
}

/**
 * The dolly between two perspective shots: the focus slides, the heading and pitch turn, the distance falls in log
 * steps and the fov follows so the framed height changes smoothly too (no shrinking before it grows).
 */
export function dollyShot(a: PerspShot, b: PerspShot, t: number): PerspShot {
  const s = smooth(t);
  const look = (p: PerspShot) => { const d: Vec3 = [p.target[0] - p.eye[0], p.target[1] - p.eye[1], p.target[2] - p.eye[2]]; const D = Math.hypot(...d); return { D, yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1] / D))), h: 2 * D * Math.tan(p.fov / 2) }; };
  const A = look(a), B = look(b);
  const D = Math.exp(lerp(Math.log(A.D), Math.log(B.D), s));
  const h = Math.exp(lerp(Math.log(A.h), Math.log(B.h), s));
  const yaw = angleLerp(A.yaw, B.yaw, s), pitch = lerp(A.pitch, B.pitch, s);
  const target = lerp3(a.target, b.target, s);
  const f = dirOf(yaw, pitch);
  return { kind: "persp", target, eye: [target[0] - f[0] * D, target[1] - f[1] * D, target[2] - f[2] * D], fov: 2 * Math.atan(h / 2 / D) };
}

export function createViewModes(o: ViewModesOptions): ViewModes {
  const T: ViewTiming = { ...VIEW_TIMING, ...o.timing };
  const enterK = o.enterK ?? 40;
  const D0 = o.dollyDistance ?? 60;
  let [W, H] = o.picture;
  const zoom = o.zoom;
  const camera = createCamera({
    mode: "orbit", width: W, height: H, ...(o.fov !== undefined ? { fov: o.fov } : {}), blend: T.toggle,
    orbit: { distance: o.chase?.distance ?? 5.5, pitch: o.chase?.pitch ?? -0.42, above: o.chase?.above ?? 0.6, minPitch: o.chase?.minPitch ?? -1.25, maxPitch: o.chase?.maxPitch ?? 0.35, recenter: o.chase?.recenter ?? 0 },
    first: { eyeHeight: o.fps?.eyeHeight ?? 0.93 },
  });
  const bob = o.fps?.bob ?? 0.035;
  const world: CameraWorld = o.world ?? {};

  let phase: ViewPhase = "overview";
  let t = 0;
  let subject: number | null = null;
  // (The overview as it was when the unit was taken: the way back goes there.)
  let saved: { k: number; center: Vec3 } | null = null;
  let glideFrom: OrthoShot | null = null, glideTo: OrthoShot | null = null;
  let dollyFrom: PerspShot | null = null;
  let lastPersp: PerspShot | null = null;
  let walked = 0;
  let pendingFps = false;

  const nearestRungOf = (k: number): number => nearestRung(zoom.ladder, k);
  const orthoNow = (): OrthoShot => ({ kind: "ortho", center: [...m.center] as Vec3, yaw: m.yaw, pitch: zoom.pitch, k: zoom.k });
  const persp = (): PerspShot => ({ kind: "persp", eye: [...camera.eye] as Vec3, target: [...camera.target] as Vec3, fov: camera.fov });
  const at = (s: Subject): Vec3 => [s.pos[0], s.pos[1], s.pos[2]];
  const orthoAt = (center: Vec3, k: number): OrthoShot => ({ kind: "ortho", center, yaw: m.yaw, pitch: zoom.pitchOf(zoom.bucketFor(k, zoom.bucket)), k });

  // (The subject hides in first person -- and whenever the chase arm has folded into its face against a wall.)
  const frame = (shot: Shot, blend: ViewFrame["blend"] = null, progress = 1): ViewFrame => ({ mode: m.mode, phase, progress, shot, blend, hideSubject: camera.hidesSubject && (phase === "fps" || phase === "toFps" || phase === "chase" || phase === "toChase") });

  const m: ViewModes = {
    get mode(): ViewMode { return phase === "overview" || phase === "glide" || phase === "unglide" ? "overview" : phase === "fps" || phase === "toFps" ? "fps" : "chase"; },
    get phase() { return phase; },
    get subject() { return subject; },
    zoom, camera,
    center: [...o.center] as Vec3,
    yaw: o.yaw ?? 0,
    get moving() { return phase !== "overview" && phase !== "chase" && phase !== "fps"; },
    setPicture(w, h) { W = w; H = h; camera.setTarget(w, h); },
    possess(unit, s) {
      if (subject !== null && subject !== unit) m.release();
      if (phase !== "overview") return;
      subject = unit;
      saved = { k: zoom.target, center: [...m.center] as Vec3 };
      glideFrom = orthoNow();
      glideTo = { ...orthoAt(at(s), Math.max(zoom.k, enterK)) };
      phase = "glide"; t = 0; pendingFps = false;
    },
    release() {
      if (subject === null) return;
      pendingFps = false;
      if (phase === "glide") { phase = "unglide"; t = Math.max(0, T.glide - t); glideTo = orthoNow(); return; }
      if (phase === "overview" || phase === "unglide" || phase === "unswap" || phase === "undolly") return;
      // (Back the way it came: the dolly out from wherever the camera is now.)
      dollyFrom = lastPersp ?? persp();
      phase = "undolly"; t = 0;
    },
    toggleFirstPerson() {
      if (subject === null) return;
      if (phase === "chase" || phase === "toChase") { camera.setMode("first", { blend: T.toggle }); phase = "toFps"; t = 0; }
      else if (phase === "fps" || phase === "toFps") { camera.setMode("orbit", { blend: T.toggle }); phase = "toChase"; t = 0; }
      else if (phase === "glide" || phase === "swap" || phase === "dolly") pendingFps = !pendingFps;
    },
    setChaseDistance(d) { camera.rigs.orbit.opt.distance = Math.max(1.6, Math.min(24, d)); },
    matchPersp: (s, distance = D0) => matchingPersp(s, H, distance),
    step(dt, s, input = {}) {
      t += dt;
      const look = input.look ?? [0, 0];
      // The perspective cameras run whenever there's a subject (so the dolly has somewhere to go).
      if (s && subject !== null) {
        const moving = phase === "chase" || phase === "fps" || phase === "toFps" || phase === "toChase";
        camera.step(dt, s, world, { look: moving ? look : [0, 0] });
        const v = Math.hypot(s.vel?.[0] ?? 0, s.vel?.[2] ?? 0);
        walked += v * dt;
      }
      switch (phase) {
        case "overview": {
          zoom.step(dt);
          return frame(orthoNow());
        }
        case "glide": case "unglide": {
          const from = phase === "glide" ? glideFrom! : glideTo!;
          const toC: Vec3 = phase === "glide" ? (s ? at(s) : glideTo!.center) : saved!.center;
          const toK = phase === "glide" ? glideTo!.k : saved!.k;
          const p = Math.min(1, t / T.glide), q = smooth(p);
          const k = Math.exp(lerp(Math.log(from.k), Math.log(toK), q));
          m.center = lerp3(from.center, toC, q);
          // (A glide keeps the pitch it started with -- its bake and its ground's -- and lands the zoom once, at its end:
          // a pitch bucket passed through on the way would be a bake nobody sees.)
          const shot: OrthoShot = { kind: "ortho", center: m.center, yaw: m.yaw, pitch: from.pitch, k };
          const out = frame(shot, null, p);
          if (p >= 1) {
            if (phase === "glide") { phase = "swap"; t = 0; glideTo = shot; if (s) camera.setMode(pendingFps ? "first" : "orbit", { blend: 0 }); }
            else { phase = "overview"; t = 0; subject = null; zoom.set(saved!.k, true); saved = null; }
          } else if (p === 0 || zoom.target !== nearestRungOf(toK)) zoom.set(toK);
          return out;
        }
        case "swap": case "unswap": {
          // Both paths draw the same shot; the second dissolves in.
          const ortho: OrthoShot = phase === "swap" && s ? { ...glideTo!, center: at(s) } : glideTo!;
          const match = matchingPersp(ortho, H, D0);
          const p = Math.min(1, t / T.swap);
          const out = phase === "swap" ? frame(ortho, { shot: match, t: smooth(p) }, p) : frame(match, { shot: ortho, t: smooth(p) }, p);
          if (p >= 1) {
            if (phase === "swap") { phase = "dolly"; t = 0; dollyFrom = match; }
            else { phase = "unglide"; t = 0; }
          }
          return out;
        }
        case "dolly": {
          const p = Math.min(1, t / T.dolly);
          // (Where it's going moves with the unit and the rig: the chase camera as it is this frame.)
          // (...and where it starts moves with the unit too: the matching camera over it now.)
          const from = s ? matchingPersp({ ...glideTo!, center: at(s) }, H, D0) : dollyFrom!;
          const shot = dollyShot(from, persp(), p);
          lastPersp = shot;
          const out = frame(shot, null, p);
          if (p >= 1) { phase = pendingFps ? "fps" : "chase"; t = 0; pendingFps = false; }
          return out;
        }
        case "undolly": {
          const p = Math.min(1, t / T.dolly);
          // (Back to a shot at the scale and pitch the glide left the overview at.)
          const back = glideTo ?? orthoNow();
          const ortho: OrthoShot = { kind: "ortho", center: s ? at(s) : dollyFrom!.target, yaw: m.yaw, pitch: back.pitch, k: back.k };
          const shot = dollyShot(dollyFrom!, matchingPersp(ortho, H, D0), p);
          lastPersp = shot;
          const out = frame(shot, null, p);
          if (p >= 1) { phase = "unswap"; t = 0; glideTo = ortho; m.center = ortho.center; }
          return out;
        }
        case "chase": case "fps": case "toFps": case "toChase": {
          let shot = persp();
          if (phase === "toFps" || phase === "toChase") { if (t >= T.toggle) { phase = phase === "toFps" ? "fps" : "chase"; t = 0; } }
          // (First person: the head bobs with the stride, twice a cycle up and down, once side to side.)
          if ((phase === "fps" || phase === "toFps") && s) {
            const v = Math.hypot(s.vel?.[0] ?? 0, s.vel?.[2] ?? 0);
            const amp = bob * Math.min(1, v / 2);
            const ph = walked * 1.9;
            const r: Vec3 = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)];
            const dy = Math.abs(Math.sin(ph)) * amp * 1.4 - amp * 0.7, dx = Math.sin(ph) * amp * 0.5;
            shot = { ...shot, eye: [shot.eye[0] + r[0] * dx, shot.eye[1] + dy, shot.eye[2] + r[2] * dx], target: [shot.target[0] + r[0] * dx, shot.target[1] + dy, shot.target[2] + r[2] * dx] };
          }
          lastPersp = shot;
          return frame(shot, null, phase === "toFps" || phase === "toChase" ? Math.min(1, t / T.toggle) : 1);
        }
      }
    },
  };
  return m;
}
