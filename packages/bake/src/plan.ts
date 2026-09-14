// The bake plan: what to draw once at load so frames only blit. A design (an
// entity variant with its attributes, an object, a prop) is rendered from N
// directions for each clip's frames at the target pixel size; the plan lists
// every sprite to make, keyed by what determines its pixels, so a bake is
// cached by content (a second load of the same army at the same size bakes
// nothing) and shared (two units of one design share every sprite).
//
//   const plan = planBake(designs, { directions: 8, pixelsPerMetre: 24 });
//   plan.sprites -> [{ key, design, clip, frame, direction, angle }]

export interface ClipSpec {
  readonly name: string;
  /** Frames baked for one cycle (a looping clip) or the whole clip. */
  readonly frames: number;
  readonly loop?: boolean;
}

export interface DesignSpec {
  /** What determines its pixels: pack id + entity/object id + seed + pins + attributes -- a stable string. */
  readonly key: string;
  readonly clips: readonly ClipSpec[];
  /** Its size in metres (for the sprite's pixel size at a target scale): height and footprint radius. */
  readonly height: number;
  readonly radius: number;
  /** Things that look the same from every side (a barrel) bake one direction. */
  readonly symmetric?: boolean;
}

export interface SpriteJob {
  /** Cache key: design key + clip + frame + direction + scale + style. */
  readonly key: string;
  readonly design: string;
  readonly clip: string;
  readonly frame: number;
  readonly direction: number;
  /** The yaw the camera sees it from (0 = its front toward the camera, per the frame convention). */
  readonly angle: number;
  /** The sprite's expected pixel box before trimming. */
  readonly w: number;
  readonly h: number;
  /** What the plan was made for (the baker draws with these): pixels per metre, camera pitch, style. */
  readonly pixelsPerMetre: number;
  readonly pitch: number;
  readonly style: string;
}

export interface BakeOptions {
  /** Directions around (8 is the classic RTS count; 16 for smooth turning; 1 for billboards). */
  readonly directions?: number;
  /** The pixel scale: pixels per metre at the target size. */
  readonly pixelsPerMetre: number;
  /** The camera's pitch (radians down from horizontal): sprites are baked for the game's camera. */
  readonly pitch?: number;
  /** Anything else that changes pixels (palette id, dither screen, outline...), part of every key. */
  readonly style?: string;
}

export interface BakePlan {
  readonly sprites: readonly SpriteJob[];
  /** Sprites per design, and in total. */
  readonly perDesign: ReadonlyMap<string, number>;
}

/** A design's sprite box before trimming, at a scale and pitch (pixels). */
export function spriteBox(d: Pick<DesignSpec, "height" | "radius">, pixelsPerMetre: number, pitch: number): { w: number; h: number } {
  // (Seen from above at `pitch`, a thing's screen height is its height foreshortened plus its footprint's depth.)
  return { w: Math.ceil(2 * d.radius * pixelsPerMetre) + 2, h: Math.ceil((d.height * Math.cos(pitch) + 2 * d.radius * Math.sin(pitch)) * pixelsPerMetre) + 2 };
}

/** A sprite's cache key: everything that changes its pixels. */
export const spriteKey = (design: string, clip: string, frame: number, dir: number, dirs: number, pixelsPerMetre: number, pitch: number, style: string): string =>
  `${design}|${clip}|${frame}|${dir}/${dirs}|${pixelsPerMetre}|${pitch.toFixed(4)}|${style}`;

export function planBake(designs: readonly DesignSpec[], { directions = 8, pixelsPerMetre, pitch = 0.6, style = "" }: BakeOptions): BakePlan {
  if (!(pixelsPerMetre > 0)) throw new RangeError("pixelsPerMetre must be positive.");
  const sprites: SpriteJob[] = [];
  const perDesign = new Map<string, number>();
  const seen = new Set<string>();
  for (const d of designs) {
    if (seen.has(d.key)) continue; // (two units of one design share every sprite)
    seen.add(d.key);
    const dirs = d.symmetric ? 1 : directions;
    const { w, h } = spriteBox(d, pixelsPerMetre, pitch);
    let n = 0;
    for (const clip of d.clips) {
      for (let frame = 0; frame < clip.frames; frame += 1) {
        for (let dir = 0; dir < dirs; dir += 1) {
          const angle = (dir / dirs) * Math.PI * 2;
          sprites.push({ key: spriteKey(d.key, clip.name, frame, dir, dirs, pixelsPerMetre, pitch, style), design: d.key, clip: clip.name, frame, direction: dir, angle, w, h, pixelsPerMetre, pitch, style });
          n += 1;
        }
      }
    }
    perDesign.set(d.key, n);
  }
  return { sprites, perDesign };
}

/** Which baked direction shows a thing facing `yaw` to a camera looking along `cameraYaw` (0..directions-1). */
export function directionFor(yaw: number, cameraYaw: number, directions: number): number {
  // (Direction 0 is the thing's front toward the camera: its yaw opposite the camera's.)
  const rel = yaw - (cameraYaw + Math.PI);
  const t = ((rel / (Math.PI * 2)) % 1 + 1) % 1;
  return Math.round(t * directions) % directions;
}
