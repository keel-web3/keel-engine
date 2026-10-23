// How a shown thing moves: no frame-rate-dependent lerps anywhere. Every value is integrated in seconds, so 60 Hz,
// 120 Hz and a dropped frame give the same motion. (Presentation: Math is fine here.)
//
//   spin: drag to turn (yaw free, pitch limited with a rubber band), the release keeps its speed and coasts down
//         (inertia), then -- left alone -- springs softly back to its hero angle (the yaw and pitch it rests at).
//   float: an idle bob and sway, a few millimetres and a degree, on incommensurate periods so it never visibly loops.
//   key:  a button's travel. Down fast, held, then a spring back up with a small overshoot.
//   tween: a smooth 0..1 over a duration (the zoom into the screen and back).
// Reduced motion: no coasting, no settle animation, no hover tilt; a drag still turns the device 1:1.

const TAU = Math.PI * 2;

/** A damped spring step (semi-implicit Euler, sub-stepped so a long frame stays stable). */
export function springStep(x: number, v: number, target: number, omega: number, zeta: number, dt: number): [number, number] {
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (x - target) - 2 * zeta * omega * v;
    v += a * h;
    x += v * h;
  }
  return [x, v];
}

export interface SpinOptions {
  /** Radians per CSS pixel of drag. */
  perPixel?: number;
  /** Coast decay, 1/s (velocity halves every ln2/friction s). */
  friction?: number;
  pitchLimit?: number;
  /** Idle seconds before the device turns back to face the viewer. */
  settleAfter?: number;
  /** The pose it rests at (radians): turned a little to show its edge, tipped a little toward the light. */
  heroYaw?: number;
  heroPitch?: number;
  /** The settle spring's stiffness (rad/s) and damping ratio: soft and just under-damped by default. */
  settleOmega?: number;
  settleZeta?: number;
}

export interface SpinState { yaw: number; pitch: number; vyaw: number; vpitch: number; dragging: boolean }

export function createSpin({ perPixel = .0105, friction = 2.6, pitchLimit = .95, settleAfter = 3.2, heroYaw = 0, heroPitch = 0, settleOmega = 5.2, settleZeta = .82 }: SpinOptions = {}) {
  const s: SpinState = { yaw: heroYaw, pitch: heroPitch, vyaw: 0, vpitch: 0, dragging: false };
  const homeYaw = () => heroYaw + Math.round((s.yaw - heroYaw) / TAU) * TAU;
  let last: { x: number; y: number; t: number } | null = null;
  // The drag's recent velocity, smoothed over ~60 ms so the release speed is what the hand did, not one jittery sample.
  let fyaw = 0, fpitch = 0, idle = 0, settling = false;
  const rubber = (p: number) => {
    const over = Math.abs(p) - pitchLimit;
    return over <= 0 ? p : Math.sign(p) * (pitchLimit + over * .35);
  };
  return {
    state: s,
    grab(x: number, y: number, t: number) { s.dragging = true; last = { x, y, t }; fyaw = fpitch = 0; s.vyaw = s.vpitch = 0; idle = 0; settling = false; },
    drag(x: number, y: number, t: number) {
      if (!s.dragging || !last) return;
      const dt = Math.max(1e-3, (t - last.t) / 1000);
      const dy = (x - last.x) * perPixel, dp = (y - last.y) * perPixel;
      s.yaw += dy;
      s.pitch = rubber(s.pitch + dp);
      const k = 1 - Math.exp(-dt / .06);
      fyaw += (dy / dt - fyaw) * k; fpitch += (dp / dt - fpitch) * k;
      last = { x, y, t };
    },
    release(t: number, reduced = false) {
      if (!s.dragging) return;
      s.dragging = false;
      // A hand that stopped before letting go doesn't fling.
      const still = last ? t - last.t > 90 : true;
      const cap = 14;
      s.vyaw = reduced || still ? 0 : Math.max(-cap, Math.min(cap, fyaw));
      s.vpitch = reduced || still ? 0 : Math.max(-cap, Math.min(cap, fpitch)) * .6;
      last = null; idle = 0;
    },
    /** Turn to face the viewer now (a reset, the zoom). */
    home(reduced = false) { settling = true; idle = 0; if (reduced) { s.yaw = homeYaw(); s.pitch = heroPitch; s.vyaw = s.vpitch = 0; } },
    /** Change the hero pose (a card's three-quarter view, the solo page's straight-on view); it springs there. */
    setHero(yaw: number, pitch: number, now = false) { heroYaw = yaw; heroPitch = pitch; if (now) { s.yaw = yaw; s.pitch = pitch; s.vyaw = s.vpitch = 0; settling = false; idle = 0; } else { settling = true; idle = 0; } },
    get hero() { return { yaw: heroYaw, pitch: heroPitch }; },
    /** Advance `dt` seconds. Returns whether anything is still moving. */
    step(dt: number, reduced = false) {
      if (s.dragging) return true;
      dt = Math.min(dt, .1);
      if (reduced) { s.vyaw = s.vpitch = 0; if (Math.abs(s.pitch) > pitchLimit) s.pitch = Math.sign(s.pitch) * pitchLimit; if (settling) { s.yaw = homeYaw(); s.pitch = heroPitch; settling = false; } return false; }
      const decay = Math.exp(-friction * dt);
      s.yaw += s.vyaw * dt * (1 + decay) / 2; s.vyaw *= decay;
      s.pitch += s.vpitch * dt * (1 + decay) / 2; s.vpitch *= decay;
      // Past the pitch limit the rubber band pulls back.
      if (Math.abs(s.pitch) > pitchLimit) [s.pitch, s.vpitch] = springStep(s.pitch, s.vpitch, Math.sign(s.pitch) * pitchLimit, 14, 1, dt);
      const slow = Math.abs(s.vyaw) < .08 && Math.abs(s.vpitch) < .08;
      if (slow) idle += dt; else idle = 0;
      if (!settling && idle > settleAfter) settling = true;
      if (settling) {
        const home = homeYaw();
        [s.yaw, s.vyaw] = springStep(s.yaw, s.vyaw, home, settleOmega, settleZeta, dt);
        [s.pitch, s.vpitch] = springStep(s.pitch, s.vpitch, heroPitch, settleOmega, settleZeta, dt);
        if (Math.abs(s.yaw - home) < 2e-4 && Math.abs(s.pitch - heroPitch) < 2e-4 && Math.abs(s.vyaw) < 1e-3 && Math.abs(s.vpitch) < 1e-3) {
          s.yaw = home; s.pitch = heroPitch; s.vyaw = s.vpitch = 0; settling = false; idle = 0;
          return false;
        }
        return true;
      }
      if (slow && Math.abs(s.vyaw) < 1e-4 && Math.abs(s.vpitch) < 1e-4) { s.vyaw = s.vpitch = 0; }
      // Still while coasting, or waiting to settle (not drawn: the pose doesn't change until the settle starts).
      return s.vyaw !== 0 || s.vpitch !== 0 || (idle > 0 && !atHome());
    },
    /** At rest at the hero pose. */
    atHome,
    /** Seconds of idle left before the settle starts (null if none is due). */
    settleDue: () => (!s.dragging && !settling && !atHome() && s.vyaw === 0 && s.vpitch === 0 ? Math.max(0, settleAfter - idle) : null),
  };
  function atHome() { return !s.dragging && s.pitch === heroPitch && Math.abs(s.yaw - homeYaw()) < 1e-9 && s.vyaw === 0 && s.vpitch === 0; }
}
export type Spin = ReturnType<typeof createSpin>;

/** A button's travel: 0 up, 1 fully down. Pressed: down in ~35 ms; released: springs back with a little overshoot.
 *  `squash` is the cap's momentary flattening: it rises with the travel's speed (a hard press squashes more). */
export function createKey() {
  let x = 0, v = 0, held = false, pressedAt = -1;
  const MIN_HELD = .07; // s: a tap still shows the full travel
  let heldFor = 0;
  return {
    press() { held = true; heldFor = 0; pressedAt = 0; },
    release() { held = false; },
    get held() { return held; },
    get travel() { return x; },
    get squash() { return Math.max(0, Math.min(1, Math.abs(v) / 40)) * (held ? 1 : 0.6); },
    step(dt: number, reduced = false) {
      dt = Math.min(dt, .1);
      if (pressedAt >= 0) heldFor += dt;
      const down = held || (pressedAt >= 0 && heldFor < MIN_HELD);
      if (!down) pressedAt = -1;
      if (reduced) { x = down ? 1 : 0; v = 0; return false; }
      if (down) [x, v] = springStep(x, v, 1, 90, 1, dt);
      else [x, v] = springStep(x, v, 0, 46, .42, dt);
      // (the cap can rise a little past its rest on the way back up, never far)
      if (x < -.18) { x = -.18; v = Math.max(0, v); }
      if (!down && Math.abs(x) < 1e-3 && Math.abs(v) < 1e-2) { x = 0; v = 0; return false; }
      if (down && Math.abs(1 - x) < 1e-3 && Math.abs(v) < 1e-2) { x = 1; v = 0; return heldFor < MIN_HELD; }
      return true;
    },
  };
}
export type Key = ReturnType<typeof createKey>;

/** Smooth 0..1 (quintic: zero speed and acceleration at both ends). */
export const smoother = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * x * (x * (x * 6 - 15) + 10); };

/** A value that eases to wherever it is sent, in `seconds`, from where it is (a retarget mid-way stays smooth). */
export function createTween(seconds: number) {
  let from = 0, to = 0, t = 1, value = 0;
  return {
    get value() { return value; },
    get target() { return to; },
    get busy() { return t < 1; },
    set(target: number, now = false) {
      if (now) { from = to = value = target; t = 1; return; }
      if (target === to && t >= 1) return;
      from = value; to = target; t = 0;
    },
    step(dt: number, reduced = false) {
      if (t >= 1) return false;
      t = reduced ? 1 : Math.min(1, t + dt / seconds);
      value = from + (to - from) * smoother(t);
      return t < 1;
    },
  };
}

/** An idle float: a slow bob, a drift and a sway on incommensurate periods (so it never visibly repeats), faded in
 *  and out with `on`. Offsets in the units you scale them by; angles in radians. */
export function createFloat({ bob = 1, sway = 1, period = 5.3 }: { bob?: number; sway?: number; period?: number } = {}) {
  let t = 0, amount = 0, on = true;
  return {
    get on() { return on; },
    set on(v: boolean) { on = v; },
    get amount() { return amount; },
    /** Advance; returns whether it moves. Under reduced motion it holds still at rest. */
    step(dt: number, reduced = false) {
      dt = Math.min(dt, .1);
      const target = on && !reduced ? 1 : 0;
      amount += (target - amount) * (1 - Math.exp(-dt * 2.2));
      if (Math.abs(amount - target) < 1e-3) amount = target;
      if (amount > 0) t += dt;
      return amount > 0;
    },
    /** The pose now: y offset (bob), x drift, yaw, pitch and roll. */
    pose() {
      const w = TAU / period, a = amount;
      return {
        y: a * bob * (Math.sin(t * w) * .7 + Math.sin(t * w * 2.31 + 1.3) * .3),
        x: a * bob * .25 * Math.sin(t * w * .63 + .4),
        yaw: a * sway * .035 * Math.sin(t * w * .77 + 2.1),
        pitch: a * sway * .02 * Math.sin(t * w * 1.13 + .7),
        roll: a * sway * .012 * Math.sin(t * w * .91 + 4.2),
      };
    },
  };
}
export type Float = ReturnType<typeof createFloat>;

/** A plain spring you can send anywhere (a camera's distance, a light's fade). */
export function createSpring(value = 0, omega = 8, zeta = 1) {
  let x = value, v = 0, to = value;
  return {
    get value() { return x; },
    get target() { return to; },
    set(target: number, now = false) { to = target; if (now) { x = target; v = 0; } },
    step(dt: number, reduced = false) {
      if (reduced) { x = to; v = 0; return false; }
      [x, v] = springStep(x, v, to, omega, zeta, Math.min(dt, .1));
      if (Math.abs(x - to) < 1e-5 && Math.abs(v) < 1e-4) { x = to; v = 0; return false; }
      return true;
    },
  };
}
export type Spring = ReturnType<typeof createSpring>;
