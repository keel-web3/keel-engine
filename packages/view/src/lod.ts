// Levels of detail by what a thing shows at on screen -- never by a fixed
// distance, so the same rules hold at 480 x 270 and at 1920 x 1080, zoomed
// out over the map or looking along the ground.
//
//   sprite LODs (a unit's height in picture pixels):
//     dot    under DOT_PX: its body only, the far bake's directions -- a few
//            pixels don't show a hat
//     far    up to NEAR_PX: body and wearables, 8 directions
//     near   above: body and wearables, 16 directions and every clip
//            (the actions too): what a close zoom is for
//   solid vs sprite (perspective views): within `solid` metres a thing is a
//   real 3D solid, past `sprite` metres a billboard, between them both --
//   dissolved into each other through a 4x4 screen (the solid keeps a share of
//   the screen's thresholds, the sprite the rest), so a switch never pops.
//   Past `cull` nothing is drawn (the fog has it).

/** A unit's LOD tier: 0 dot, 1 far, 2 near. */
export type SpriteLod = 0 | 1 | 2;

/** Picture pixels tall below which a unit is a dot (body only), and above which it's near (16 directions, every clip). */
export const DOT_PX = 10;
export const NEAR_PX = 40;

/** The sprite LOD for a unit `px` picture pixels tall. */
export function spriteLod(px: number, dot = DOT_PX, near = NEAR_PX): SpriteLod {
  return px < dot ? 0 : px < near ? 1 : 2;
}

/** A unit's height in picture pixels in an orthographic view: its height, foreshortened by the pitch, at k px/m. */
export const orthoPixels = (height: number, k: number, pitch: number): number => height * Math.cos(pitch) * k;

/** Picture pixels per metre at view depth `z` (metres along the camera's forward) for a vertical fov and picture height. */
export function perspectiveScale(z: number, fov: number, height: number): number {
  return height / (2 * Math.max(1e-3, z) * Math.tan(fov / 2));
}

/**
 * The baked scale to draw a thing at when it shows at `k` px/m: the rung nearest in log terms, a larger one when it's
 * within `prefer` (a sprite drawn a little smaller loses a texel row here and there; one drawn bigger doubles some).
 * Returns the rung and the draw scale (texels per picture pixel: k / rung).
 */
export function bakedScale(ladder: readonly number[], k: number, prefer = 1.06): { rung: number; scale: number } {
  let best = ladder[0]!, bd = Infinity;
  for (const r of ladder) {
    const d = Math.abs(Math.log(r / k)) - (r >= k && r <= k * prefer ? 0.05 : 0);
    if (d < bd) { bd = d; best = r; }
  }
  return { rung: best, scale: k / best };
}

/** Where a perspective view switches a thing between its solid and its sprite (metres from the eye). */
export interface SolidBand {
  /** Fully solid within this. */
  readonly solid: number;
  /** Fully a sprite past this. */
  readonly sprite: number;
  /** Not drawn at all past this. */
  readonly cull: number;
}

/** A band scaled to the picture: a thing turns solid where its sprite would be `px` picture pixels tall (default 56). */
export function solidBandFor(height: number, fov: number, pictureHeight: number, { px = 56, width = 0.35, cull = 130 }: { px?: number; width?: number; cull?: number } = {}): SolidBand {
  // (perspectiveScale(z) * height = px  ->  z = pictureHeight * height / (2 px tan(fov/2)).)
  const z = (pictureHeight * height) / (2 * px * Math.tan(fov / 2));
  return { solid: z * (1 - width / 2), sprite: z * (1 + width / 2), cull };
}

/**
 * How much of a thing at distance `d` is drawn as its solid (1: all of it) and how much of its sprite is dissolved
 * (the same share): `{ solid, sprite }` -- solid 0 means no solid at all, sprite 1 means no sprite at all.
 */
export function solidShare(d: number, band: SolidBand): { solid: number; sprite: number } {
  if (d >= band.cull) return { solid: 0, sprite: 1 };
  if (d <= band.solid) return { solid: 1, sprite: 1 };
  if (d >= band.sprite) return { solid: 0, sprite: 0 };
  const t = (band.sprite - d) / (band.sprite - band.solid);
  // (Quantised to the 4x4 screen's sixteen steps: every frame of a slow approach changes a whole threshold at once.)
  const q = Math.round(t * 16) / 16;
  return { solid: q, sprite: q };
}
