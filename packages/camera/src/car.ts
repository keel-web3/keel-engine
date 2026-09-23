// Car cameras: the views a racer is played from. A CHASE camera behind and
// above the car, lagging it through a corner and pulling back and widening as
// it goes faster; a HOOD camera on the bonnet, so you see the road come at you
// over your own paint; a BUMPER camera lower down, all speed. Each returns a
// perspective shot -- eye, target, vertical fov -- that keel/bake's
// projectionOf() turns into the picture.
//
//   const cam = createCarCamera();
//   const shot = cam.step({ x, z, yaw, speed, halfLength, height }, dt);   // cam.cycle() to change view
//
// Presentation only: it smooths with the clock and never feeds the simulation.

export type Vec3 = [number, number, number];
/**
 * chase: behind, lagging through corners. cockpit: the driver's seat (the game draws the interior and its mirrors).
 * dash: just off the windscreen, the bonnet framed to a share of the screen. first: the driver's eyes with no car at all.
 * hood: on the bonnet. bumper: down at the nose.
 */
export type CarCameraMode = "chase" | "cockpit" | "dash" | "first" | "hood" | "bumper";

/** Where the car is and how it is shaped, as much as a camera needs. */
export interface CarPose {
  readonly x: number;
  readonly z: number;
  /** Frame convention: 0 faces +z. */
  readonly yaw: number;
  /** Metres a second along the heading. */
  readonly speed: number;
  /** The ground's height under the car (m; default 0): every height below is measured up from it -- hills. */
  readonly y?: number;
  /** Half the body's length, and the height of its roof, metres. */
  readonly halfLength: number;
  readonly height: number;
  /**
   * Where the hood camera sits, from the car's OWN shape: metres forward of the centre and up from the road -- on the
   * bonnet just ahead of the windscreen. A fraction of the length would land inside the cockpit on a car whose cabin
   * sits far forward (a prototype), and you'd be looking at the interior walls.
   */
  readonly hood?: {
    readonly along: number;
    readonly up: number;
    /** The nose's tip, forward of the centre and up from the road: the hood cam tips down until it's in the frame. */
    readonly noseAlong?: number;
    readonly noseUp?: number;
    /**
     * The body's top surface ahead of the windscreen, from the mesh that's drawn (bonnetCrest), in the car's frame. With it the dash and hood views frame the part of the body that really stands
     * highest in the picture -- a scoop, a bulge, the wings, a stack through the bonnet -- rather than the nose's tip,
     * and lift the eye over anything that would otherwise stand at or above it. Flat [along, up, sideFrom, sideTo]
     * fours: a patch's top, and how far across (+ the car's right) that top runs.
     */
    readonly crest?: readonly number[];
  };
  /**
   * The driver's eyes, from the car's own shape: metres forward of the centre, up from the road, and to the side (+ is
   * the car's right) -- behind the windscreen, so the cockpit view looks out over the bonnet and whatever's on it.
   * Left out, a guess from the length and roof.
   */
  readonly cockpit?: { readonly along: number; readonly up: number; readonly side?: number };
  /** The dash view's eye (left out, the hood's): just ahead of the windscreen's foot, over the bonnet. */
  readonly dash?: { readonly along: number; readonly up: number; readonly side?: number };
  /** How much of the screen the bonnet takes in the dash view (default a quarter; at most 0.29, under BONNET_MOST). */
  readonly bonnet?: number;
  /** The body's lean on its springs (radians), so the hood cam leans with the car. */
  readonly pitch?: number;
  readonly roll?: number;
  /** How the shot is really drawn (default: as it comes): the bonnet is framed through THAT lens, not the shot's own. */
  readonly lens?: CarLens;
}

/**
 * What a game does to the shot's fov before it draws it: `(fov + widen) * kick`, into a picture `aspect` wide. The
 * camera doesn't apply it -- the shot's fov is still its own -- it frames the bonnet for it, so a portrait screen's wider
 * lens or a nitrous kick never pushes the bonnet up the picture.
 */
export interface CarLens {
  /** Radians added to the fov (a portrait screen's wider lens). */
  readonly widen?: number;
  /** What the widened fov is multiplied by (the motion blur's speed and nitrous kick). */
  readonly kick?: number;
  /** The picture's width over its height (default 16/9): how much of the body beside the eye is in the frame. */
  readonly aspect?: number;
}

/** The share of the picture's height the bonnet may reach up from the bottom in the dash and hood views, and the least it keeps. */
export const BONNET_MOST = 1 / 3, BONNET_LEAST = 0.14;
/** How high the horizon may sit (share of the height up from the bottom) before the bonnet is let down toward BONNET_LEAST. */
const HORIZON_MOST = 0.88;
/** The least angle (rad) anything on the bonnet sits below the eye: the eye is lifted over what would stand higher. */
const CLEAR = 0.15;

/** A mesh as bonnetCrest reads it: flat xyz positions and the triangles' corner indices (keel/bake's LookMesh is one). */
export interface CrestMesh { readonly positions: ArrayLike<number>; readonly indices: ArrayLike<number> }

/**
 * The body's top surface ahead of `from` (metres forward of the centre -- the windscreen's foot), for CarPose.hood.crest:
 * the highest point of each small patch of the car's own meshes (car frame: +x right, y up, +z the nose -- the body's
 * and its glass's). Read along every triangle's edges, not just its corners: a panel's top edge that runs right across
 * the picture has its corners out beside it. Worked out once per car.
 */
export function bonnetCrest(meshes: readonly CrestMesh[], from: number, cell = 0.025, across = 0.02): number[] {
  const c = createCrest(from, cell, across);
  for (const m of meshes) c.add(m);
  return c.points();
}

/** bonnetCrest a piece at a time -- mesh by mesh, or a run of a mesh's triangles at a time -- so it can be spread over frames. */
export interface CrestBuilder {
  /** Read triangles [first, end) of a mesh (default all of it). */
  add(mesh: CrestMesh, first?: number, end?: number): void;
  /** The crest so far (CarPose.hood.crest). */
  points(): number[];
}

export function createCrest(from: number, cell = 0.025, across = 0.02): CrestBuilder {
  // (Each patch: its top point, and the span across of what's within a few millimetres of it -- so what's in the picture
  // beside the eye is judged by the patch's nearest edge, not wherever its single highest sample fell.)
  const top = new Map<number, [number, number, number, number]>();
  const put = (x: number, y: number, z: number): void => {
    if (z < from) return;
    const key = Math.round((z - from) / cell) * 4096 + Math.round(x / across) + 2048;
    const was = top.get(key);
    if (!was || y > was[1] + 0.005) top.set(key, [z, y, x, x]);
    else if (y >= was[1] - 0.005) {
      if (y > was[1]) { was[0] = z; was[1] = y; }
      was[2] = Math.min(was[2], x); was[3] = Math.max(was[3], x);
    }
  };
  return {
    add({ positions: p, indices: ix }, first = 0, end = Infinity) {
      const last = Math.min(ix.length / 3, end);
      for (let t = first * 3; t < last * 3; t += 3) for (let e = 0; e < 3; e += 1) {
        const a = ix[t + e]! * 3, b = ix[t + ((e + 1) % 3)]! * 3;
        if (p[a + 2]! < from && p[b + 2]! < from) continue;
        const n = Math.max(1, Math.ceil(Math.hypot(p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!) / 0.01));
        for (let k = 0; k <= n; k += 1) { const s = k / n; put(p[a]! + (p[b]! - p[a]!) * s, p[a + 1]! + (p[b + 1]! - p[a + 1]!) * s, p[a + 2]! + (p[b + 2]! - p[a + 2]!) * s); }
      }
    },
    points() {
      const out: number[] = [];
      for (const q of top.values()) out.push(q[0], q[1], q[2], q[3]);
      return out;
    },
  };
}

/** A perspective shot (keel/bake's PerspShot, structurally). */
export interface CarShot { readonly kind: "persp"; readonly eye: Vec3; readonly target: Vec3; readonly fov: number }

export interface CarCameraOptions {
  readonly mode?: CarCameraMode;
  /** Base vertical fov (radians) and how much it widens at speed. */
  readonly fov?: number;
  readonly speedFov?: number;
  /** How quickly the chase camera catches the car's heading (per second): lower lags more through a corner. */
  readonly follow?: number;
  /** The views C steps through, in order (default chase, cockpit, dash, first). */
  readonly cycle?: readonly CarCameraMode[];
}

export interface CarCamera {
  mode: CarCameraMode;
  /** The next view along the cycle (see CarCameraOptions.cycle). */
  cycle(): CarCameraMode;
  /** Where to look from this frame. */
  step(pose: CarPose, dt: number): CarShot;
  /** Snap to the car (a new race, a respawn): no lag carried over. */
  reset(): void;
}

const CYCLE: readonly CarCameraMode[] = ["chase", "cockpit", "dash", "first"];

/** A camera that follows a car. */
export function createCarCamera(opts: CarCameraOptions = {}): CarCamera {
  const order = opts.cycle ?? CYCLE;
  const baseFov = opts.fov ?? 1.05, speedFov = opts.speedFov ?? 0.3, follow = opts.follow ?? 4.5;
  let yawLag: number | null = null, dist = 5.5, fovNow = baseFov, lensFov: number | null = null;
  const cam: CarCamera = {
    mode: opts.mode ?? "chase",
    cycle() { cam.mode = order[(order.indexOf(cam.mode) + 1) % order.length]!; cam.reset(); return cam.mode; },
    reset() { yawLag = null; lensFov = null; },
    step(pose, dt) {
      // (Everything is worked out on flat ground, then lifted onto the ground the car is on.)
      const shot = frame(pose, dt), y = pose.y ?? 0;
      return y === 0 ? shot : { ...shot, eye: [shot.eye[0], shot.eye[1] + y, shot.eye[2]], target: [shot.target[0], shot.target[1] + y, shot.target[2]] };
    },
  };
  function frame(pose: CarPose, dt: number): CarShot {
    const t = Math.min(0.1, Math.max(0, dt));
    // (Speed as a share of fast: 0 standing, 1 at ~260 km/h -- it widens the lens and pulls the chase back.)
    const pace = Math.min(1, Math.abs(pose.speed) / 72);
    fovNow += (baseFov + speedFov * pace - fovNow) * Math.min(1, t * 3);
    const fx = Math.sin(pose.yaw), fz = Math.cos(pose.yaw);
    if (cam.mode === "chase") {
      // The camera's heading trails the car's: through a corner you see the car turn in front of you.
      if (yawLag === null) yawLag = pose.yaw;
      let d = pose.yaw - yawLag;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      yawLag += d * Math.min(1, t * follow);
      const lx = Math.sin(yawLag), lz = Math.cos(yawLag);
      dist += (pose.halfLength * 2.4 + 2.2 + pace * 2.5 - dist) * Math.min(1, t * 2);
      const eye: Vec3 = [pose.x - lx * dist, pose.height + 1.3 + pace * 0.4, pose.z - lz * dist];
      const target: Vec3 = [pose.x + fx * 3, pose.height * 0.55, pose.z + fz * 3];
      return { kind: "persp", eye, target, fov: fovNow };
    }
    // The rest are fixed to the car, looking down the road, leaning with the body on its springs.
    const pitch = pose.pitch ?? 0, roll = pose.roll ?? 0, mode = cam.mode;
    // Where the eye is: the driver's head (cockpit, first), just off the windscreen (dash), on the bonnet (hood), or
    // down at the bumper.
    const seat = mode === "cockpit" || mode === "first";
    const at = seat ? pose.cockpit : mode === "dash" ? pose.dash ?? pose.hood : mode === "hood" ? pose.hood : undefined;
    const along = at?.along ?? (seat ? -pose.halfLength * 0.1 : mode === "bumper" ? pose.halfLength + 0.05 : pose.halfLength * 0.45);
    let up = at?.up ?? (seat ? pose.height - 0.15 : mode === "bumper" ? 0.45 : pose.height * 0.8);
    const side = (at && "side" in at ? at.side : 0) ?? 0;
    const fov = fovNow + (mode === "bumper" ? 0.08 : 0);
    // How far the view tips down (in the car's own frame; the body's pitch goes on after). Where the bonnet shows, it's
    // framed to a share of the screen: the part of the body that stands highest in the picture -- the crest, or failing
    // it the nose's tip -- lands that far up from the bottom (a quarter, from the dash), so a car whose nose drops away
    // steeply tips further and a long flat bonnet barely at all -- the road always owns the rest. Framed through the lens
    // the picture is really drawn with (eased, so a nitrous kick re-tips smoothly), by the exact tangent, never past a third.
    let tip = seat ? 0.05 : mode === "bumper" ? 0.008 : 0.03;
    // (Asked for more than 0.29, the dash still keeps headroom under BONNET_MOST: a lamp just coming into view at the
    // picture's edge can stand a little above what's framed.)
    const share = mode === "dash" ? Math.min(0.29, pose.bonnet ?? 0.25) : mode === "hood" ? 0.27 : 0;
    const crest = share > 0 ? pose.hood?.crest : undefined;
    // (Anything on the bonnet that would stand at or above the eye -- a stack, a scoop -- lifts it clear, just.)
    /** How far across a crest patch is from the eye (0: it runs right in front of it). */
    const off = (i: number): number => Math.max(0, crest![i + 2]! - side, side - crest![i + 3]!);
    if (crest) for (let i = 0; i + 3 < crest.length; i += 4) {
      const ahead = crest[i]! - along;
      if (ahead > 0.05 && off(i) < ahead * 2 + 0.1) up = Math.max(up, crest[i + 1]! + ahead * Math.tan(CLEAR));
    }
    const lens = pose.lens, drawn = (fov + (lens?.widen ?? 0)) * (lens?.kick ?? 1);
    lensFov = lensFov === null ? drawn : lensFov + (drawn - lensFov) * Math.min(1, t * 30);
    if (share > 0) {
      const tanHalf = Math.tan(lensFov / 2), tanSide = tanHalf * (lens?.aspect ?? 16 / 9);
      // (A share s up from the bottom is tan(dep - tip) = (1 - 2s) tan(fov/2). A bonnet so short and steep that a
      // quarter would stand the horizon off the top of the picture is let down toward BONNET_LEAST, never out of it.)
      const tipOf = (dep: number): number => {
        const tipFor = (s: number): number => dep - Math.atan((1 - 2 * s) * tanHalf);
        return Math.max(tipFor(BONNET_LEAST), Math.min(tipFor(share), Math.atan((2 * HORIZON_MOST - 1) * tanHalf)));
      };
      // (What's in the picture beside the eye depends on how far the view tips -- a point low down in a view tipped down
      // is further along the lens, where the picture is wider. So the tip is found by halving: the most it can tip with
      // the highest thing it then shows still at its share or below. A lamp at the picture's very edge sits on the edge.)
      const highest = (tipped: number): number => {
        // (the least slope down to it, below / ahead, is the least angle)
        let slope = Infinity;
        const c = Math.cos(tipped), s = Math.sin(tipped);
        for (let i = 0; i + 3 < crest!.length; i += 4) {
          const ahead = crest![i]! - along, below = up - crest![i + 1]!;
          if (ahead < 0.05 || below > slope * ahead || off(i) > (ahead * c + below * s) * tanSide + 0.01) continue;
          slope = below / ahead;
        }
        return slope === Infinity ? Infinity : Math.atan(slope);
      };
      if (crest && highest(1.2) !== Infinity) {
        let lo = -1.2, hi = 1.2;
        for (let k = 0; k < 16; k += 1) {
          const mid = (lo + hi) / 2, dep = highest(mid);
          if (dep === Infinity || tipOf(dep) >= mid) lo = mid; else hi = mid;
        }
        // (Where nothing new comes into the picture about there, the exact tip; at an edge, the halving's.)
        const settled = highest(lo);
        tip = settled !== Infinity && tipOf(settled) <= hi ? Math.max(lo, tipOf(settled)) : lo;
      } else if (pose.hood?.noseAlong !== undefined && pose.hood.noseUp !== undefined) tip = tipOf(Math.atan2(up - pose.hood.noseUp, Math.max(0.3, pose.hood.noseAlong - along)));
    }
    const rx = Math.cos(pose.yaw), rz = -Math.sin(pose.yaw);
    // (From the seat the body's lean is felt, not just seen: the head sways a little further than the bonnet does.)
    const sway = (seat ? 0.35 : 0.2) * roll;
    // (The eye turns with the body about the car's foot, as the body is drawn: nose down, it drops and slides back.)
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fore = along * cp + up * sp, lift = up * cp - along * sp;
    const eye: Vec3 = [pose.x + fx * fore + rx * (side + sway), lift, pose.z + fz * fore + rz * (side + sway)];
    const ahead = 30;
    const target: Vec3 = [eye[0] + fx * ahead - rx * roll * 3, lift - Math.tan(tip + pitch) * ahead, eye[2] + fz * ahead - rz * roll * 3];
    return { kind: "persp", eye, target, fov };
  }
  return cam;
}

/**
 * The mirror's view: from `eye`, looking back along the car's heading (yaw), a little down -- what a rear-view mirror
 * shows (flip it left-right when drawing). `fov` narrower than the road's: a mirror is a small window.
 */
export function mirrorShot(eye: Vec3, yaw: number, fov = 0.55, look = 30, drop = 0.4): CarShot {
  const bx = -Math.sin(yaw), bz = -Math.cos(yaw);
  return { kind: "persp", eye, target: [eye[0] + bx * look, eye[1] - drop, eye[2] + bz * look], fov };
}
