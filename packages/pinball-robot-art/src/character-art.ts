import { seedTagHash } from '@keel-engine/core';
import type { PixelCanvas } from '@keel-engine/pinball-pixel-art';
import type { RobotShellOrientation } from './character-motion.ts';

export type RobotArchetype = 'relay' | 'warden' | 'specter';
export type RobotBallIdentity = Readonly<{
  revision: 'pinball-robot-art/1'; seed: string; archetype: RobotArchetype;
  finish: number; eye: number; insignia: number; plating: number;
}>;
export type RobotBallSprite = Readonly<{
  width: 24; height: 24; indices: Uint8Array; coverage: Uint8Array;
  palette: readonly (readonly [number, number, number])[];
  animationFrame: number; contactFlash: number;
}>;

const archetypes: readonly RobotArchetype[] = ['relay', 'warden', 'specter'];
// Authored silhouette and directional material clusters. These are original
// indexed cells, not an image, 3D render, antialiased circle or post-process.
const contour = [
  [0, -1], [9, 14], [6, 17], [4, 19], [3, 20], [2, 21],
  [2, 21], [1, 22], [1, 22], [1, 22], [1, 22], [1, 22],
  [1, 22], [1, 22], [1, 22], [1, 22], [2, 21], [2, 21],
  [3, 20], [4, 19], [5, 18], [7, 16], [9, 14], [0, -1],
] as const;
const finishes = [
  [[31, 47, 84], [58, 85, 124], [104, 155, 194], [178, 222, 229], [237, 254, 249]],
  [[52, 30, 90], [100, 57, 151], [162, 106, 218], [220, 177, 244], [255, 239, 254]],
  [[66, 36, 50], [133, 61, 75], [219, 107, 103], [255, 173, 131], [255, 237, 190]],
  [[32, 63, 51], [64, 113, 87], [128, 177, 104], [212, 232, 151], [255, 254, 221]],
  [[54, 53, 64], [111, 106, 127], [174, 175, 191], [219, 229, 239], [255, 255, 255]],
  [[78, 47, 26], [139, 89, 35], [214, 156, 53], [250, 212, 111], [255, 246, 198]],
  [[30, 66, 84], [50, 116, 151], [78, 185, 218], [156, 239, 241], [241, 255, 255]],
  [[76, 38, 84], [146, 64, 144], [227, 108, 191], [255, 180, 225], [255, 246, 250]],
] as const;
const eyes = [[119, 255, 236], [255, 228, 121], [255, 146, 204]] as const;

/** A shared indexed scene palette can render all seeded identities without
 * quantizing bright ball/eye colours into the room's dark material ramps. */
export function withRobotBallPalette(base: readonly (readonly number[])[]) {
  if (!Array.isArray(base) || base.length < 1 || base.length > 207 || Array.from({ length: base.length }, (_, i) => i).some(i => !Object.hasOwn(base, i) || !Array.isArray(base[i]) || base[i]!.length !== 3 || [0, 1, 2].some(j => !Object.hasOwn(base[i]!, j) || !Number.isInteger(base[i]![j]) || base[i]![j]! < 0 || base[i]![j]! > 255))) throw Error('Robot scene palette budget/RGB');
  const palette = base.map(c => [...c] as [number, number, number]);
  const maps: number[][][] = [];
  const index = (c: readonly number[]) => {
    let found = palette.findIndex(p => p[0] === c[0] && p[1] === c[1] && p[2] === c[2]);
    if (found === -1) { found = palette.length; palette.push([...c] as [number, number, number]); }
    return found;
  };
  for (let finish = 0; finish < finishes.length; finish++) {
    const byEye: number[][] = [];
    for (let eye = 0; eye < eyes.length; eye++) {
      byEye.push([[0, 0, 0], [16, 16, 35], ...finishes[finish]!, [15, 29, 44], eyes[eye]!, [248, 177, 94], [141, 77, 62]].map(index));
    }
    maps.push(byEye);
  }
  if (palette.length > 256) throw Error('Robot indexed palette overflow');
  const frozen = Object.freeze(palette.map(c => Object.freeze(c)));
  const inkMap = (identity: RobotBallIdentity): readonly number[] => {
    validateIdentity(identity); return Object.freeze([...maps[identity.finish]![identity.eye]!]);
  };
  return Object.freeze({ palette: frozen, inkMap });
}

export function generateRobotBallIdentity(seed: string, archetype: RobotArchetype = 'relay'): RobotBallIdentity {
  if (typeof seed !== 'string' || seed.length < 1 || seed.length > 128 || !archetypes.includes(archetype)) throw Error('Robot identity seed/archetype');
  const tag = 'pinball-robot-art/1/' + archetype;
  return Object.freeze({ revision: 'pinball-robot-art/1', seed, archetype,
    finish: seedTagHash(seed, tag + '/finish') % finishes.length,
    eye: seedTagHash(seed, tag + '/eye') % 3,
    insignia: seedTagHash(seed, tag + '/insignia') % 4,
    plating: seedTagHash(seed, tag + '/plating') % 3 });
}

function validateIdentity(identity: RobotBallIdentity) {
  if (!identity || Array.isArray(identity) || ['revision', 'seed', 'archetype', 'finish', 'eye', 'insignia', 'plating'].some(key => !Object.hasOwn(identity, key)) || identity.revision !== 'pinball-robot-art/1' || !archetypes.includes(identity.archetype)) throw Error('Robot identity revision/archetype');
  const canonical = generateRobotBallIdentity(identity.seed, identity.archetype);
  for (const key of ['finish', 'eye', 'insignia', 'plating'] as const) {
    if (identity[key] !== canonical[key]) throw Error('Robot identity trait mismatch');
  }
}

/** Palette roles: 0 transparent; 1 outline; 2 deep; 3 shadow; 4 base;
 * 5 lit; 6 specular; 7 visor; 8 eye; 9 accent; 10 accent shadow. */
export function robotBallSprite(identity: RobotBallIdentity, animationFrame = 0, contactFlash = 0, reducedMotion = false): RobotBallSprite {
  validateIdentity(identity);
  if (!Number.isInteger(animationFrame) || animationFrame < 0 || animationFrame > 7 || !Number.isInteger(contactFlash) || contactFlash < 0 || contactFlash > 3 || typeof reducedMotion !== 'boolean') throw Error('Robot animation frame');
  if (reducedMotion) { animationFrame = 0; contactFlash = 0; }
  const ramp = finishes[identity.finish]!;
  const accent = eyes[identity.eye]!;
  const palette = Object.freeze([
    [0, 0, 0], [16, 16, 35], ...ramp,
    [15, 29, 44], accent, [248, 177, 94], [141, 77, 62],
  ].map(c => Object.freeze([...c] as [number, number, number])));
  const indices = new Uint8Array(24 * 24), coverage = new Uint8Array(24 * 24);
  const cell = (x: number, y: number, ink: number) => {
    if (x < 0 || y < 0 || x >= 24 || y >= 24) return;
    const i = y * 24 + x;
    if (coverage[i]) indices[i] = ink;
  };
  const bar = (x: number, y: number, w: number, h: number, ink: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cell(i, j, ink);
  };
  for (let y = 0; y < 24; y++) {
    const [left, right] = contour[y]!;
    for (let x = left; x <= right; x++) {
      // Clip corner cells so the complete silhouette stays inside native R12.
      if ((x - 11.5) ** 2 + (y - 11.5) ** 2 > 11.75 ** 2) continue;
      const i = y * 24 + x; coverage[i] = 1;
      const rim = x <= left + 1 || x >= right - 1 || y <= 2 || y >= 21;
      indices[i] = rim ? 1 : y >= 18 || x >= 19 ? 2 : y >= 14 || x >= 16 ? 3 : y <= 7 && x <= 12 ? 5 : 4;
    }
  }
  // Fixed upper-left light. It never rotates with the shell; highlights remain
  // readable through all eight authored seam poses.
  bar(7, 3, 8, 1, 6); bar(5, 4, 7, 1, 6); bar(4, 5, 4, 2, 5);
  bar(3, 7, 1, 7, 5); bar(5, 4, 2, 2, 6); bar(19, 8, 2, 7, 2);
  bar(7, 19, 10, 1, 2); bar(9, 20, 7, 1, 1);
  if (identity.archetype === 'relay') {
    // Split pressure armour, belt collar and actual-face visor.
    for (let y = 4; y <= 20; y++) { cell(15 + ((y + animationFrame) % 8 < 2 ? 1 : 0), y, 2); }
    bar(4, 14, 16, 1, 2); bar(5, 15, 14, 1, 5);
    bar(5, 8, 13, 5, 1); bar(6, 9, 11, 3, 7);
    if (identity.eye === 0) { bar(7, 10, 3, 1, 8); bar(13, 10, 3, 1, 8); }
    else if (identity.eye === 1) { bar(8, 10, 7, 1, 8); cell(11, 9, 6); }
    else { bar(7, 10, 2, 2, 8); bar(14, 10, 2, 2, 8); }
    bar(6, 17, 3, 1, 10); bar(6, 18, 3, 1, 9); bar(16, 16, 2, 2, 10);
  } else if (identity.archetype === 'warden') {
    // Diagonal ceramic/stone facets and a central sensor; not the relay visor.
    for (let y = 6; y <= 17; y++) { cell(4 + Math.floor((y - 6) / 2), y, 2); cell(18 - Math.floor((y - 6) / 2), y, 5); }
    bar(8, 8, 8, 1, 1); bar(7, 9, 10, 5, 1); bar(8, 14, 8, 1, 1);
    bar(9, 9, 6, 5, 7); bar(10, 10, 4, 3, 8); cell(10, 10, 6); cell(13, 12, 4);
    bar(6, 16, 12, 1, 2); bar(9, 17, 6, 1, 9);
    for (let x = 7; x <= 17; x += 3) cell(x, 6 + ((animationFrame + x) % 3 === 0 ? 1 : 0), 3);
  } else {
    // Ribbed crown and a recessed wide mask, with a different shell silhouette.
    bar(5, 6, 13, 1, 2); bar(6, 7, 12, 1, 6);
    for (let x = 6; x <= 18; x += 3) { bar(x, 4, 1, 2, 2); cell(x, 5, 9); }
    bar(4, 9, 15, 5, 1); bar(5, 10, 13, 3, 7);
    bar(6, 10, 3, 1, 8); bar(14, 10, 3, 1, 8); cell(7, 11, 8); cell(15, 11, 8);
    bar(7, 15, 9, 1, 5); bar(10, 16, 4, 1, 2); cell(11, 17, 9);
    for (let y = 15; y < 20; y++) cell(18 - ((y + animationFrame) % 4), y, 2);
  }
  // Seeded insignia and seams are bounded surface marks, never hitboxes or horns.
  if (identity.insignia === 0) { cell(11, 5, 9); cell(10, 6, 9); cell(12, 6, 9); }
  if (identity.insignia === 1) { bar(10, 5, 4, 1, 9); bar(11, 6, 2, 1, 9); }
  if (identity.insignia === 2) { cell(10, 5, 9); cell(13, 5, 9); cell(11, 6, 10); cell(12, 6, 10); }
  if (identity.insignia === 3) { bar(10, 5, 1, 2, 9); bar(13, 5, 1, 2, 9); }
  const phase = [3, 5, 8, 11, 14, 17, 19, 21][animationFrame]!;
  for (let y = 15; y <= 18; y++) { cell(phase + (identity.plating === 1 ? y - 16 : 0), y, 2); cell(phase - 1, y, 5); }
  if (contactFlash) {
    // The adapter supplies an actual recent-contact phase. No particles, scale
    // growth or displaced silhouette is invented here.
    for (let i = 0; i < indices.length; i++) if (coverage[i] && indices[i] === 5 && (i % 24 < 13 || contactFlash === 3)) indices[i] = 6;
    if (contactFlash >= 2) { bar(9, 10, 6, 1, 6); }
  }
  return Object.freeze({ width: 24, height: 24, indices, coverage, palette, animationFrame, contactFlash });
}

const restOrientation: RobotShellOrientation = Object.freeze([0, 0, 0, 1]);
const referenceViewLength = Math.sqrt(1 + .8 * .8);

/** Indexed spherical shell with curved seeded surface marks. The orientation
 * comes from completed native samples, not a render clock. World-space shell
 * marks rotate; screen-space sphere normals, fixed upper-left light and glints
 * do not. elevationRatio describes the camera view, never a position offset.
 * Reduced motion selects the resting shell and suppresses contact flashes. */
export function rollingRobotBallSprite(identity: RobotBallIdentity, orientation: RobotShellOrientation = restOrientation, contactFlash = 0, reducedMotion = false, elevationRatio = .8): RobotBallSprite {
  validateIdentity(identity);
  if (!Array.isArray(orientation) || orientation.length !== 4 || [0, 1, 2, 3].some(i => !Object.hasOwn(orientation, i) || !Number.isFinite(orientation[i])) || Math.abs(orientation.reduce((sum, v) => sum + v * v, 0) - 1) > 1e-6) throw Error('Robot shell orientation');
  if (!Number.isInteger(contactFlash) || contactFlash < 0 || contactFlash > 3 || typeof reducedMotion !== 'boolean' || !Number.isFinite(elevationRatio) || elevationRatio < 0 || elevationRatio > 2) throw Error('Robot spherical view/flash');
  if (reducedMotion) { orientation = restOrientation; contactFlash = 0; }
  const palette = Object.freeze([[0, 0, 0], [16, 16, 35], ...finishes[identity.finish]!, [15, 29, 44], eyes[identity.eye]!, [248, 177, 94], [141, 77, 62]].map(c => Object.freeze([...c] as [number, number, number])));
  const indices = new Uint8Array(576), coverage = new Uint8Array(576);
  // Inverse unit quaternion matrix: recover the unrotated material normal.
  const [qx, qy, qz, qw] = orientation;
  const m00 = 1 - 2 * (qy * qy + qz * qz), m01 = 2 * (qx * qy + qz * qw), m02 = 2 * (qx * qz - qy * qw);
  const m10 = 2 * (qx * qy - qz * qw), m11 = 1 - 2 * (qx * qx + qz * qz), m12 = 2 * (qy * qz + qx * qw);
  const m20 = 2 * (qx * qz + qy * qw), m21 = 2 * (qy * qz - qx * qw), m22 = 1 - 2 * (qx * qx + qy * qy);
  const viewLength = Math.sqrt(1 + elevationRatio * elevationRatio);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const px = x - 11.5, py = y - 11.5, disk = px * px + py * py;
    if (disk > 11.75 * 11.75) continue;
    const i = y * 24 + x, nx = px / 11.75, ny = py / 11.75, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    coverage[i] = 1;
    const light = -.46 * nx - .62 * ny + .635 * nz;
    let role = nz < .17 ? 1 : light > .62 ? 5 : light > .17 ? 4 : light > -.28 ? 3 : 2;
    // Camera basis agrees with project(x,y,z) = [x,-y-z*elevationRatio].
    const wx = nx, wy = (-ny - nz * elevationRatio) / viewLength, wz = (-ny * elevationRatio + nz) / viewLength;
    const lx = m00 * wx + m01 * wy + m02 * wz, ly = m10 * wx + m11 * wy + m12 * wz, lz = m20 * wx + m21 * wy + m22 * wz;
    // The authored front is fixed in native world axes. A camera-angle change
    // exposes another part of the shell instead of turning the face to camera.
    const frontY = (-ly - .8 * lz) / referenceViewLength, frontZ = (-.8 * ly + lz) / referenceViewLength;
    if (nz >= .17) {
      // Low-contrast great-circle seams curve and foreshorten with the sphere.
      const seam = Math.abs(lx + lz * (identity.plating - 1) * .32) < .035 || Math.abs(ly + .18) < .025;
      if (seam) role = Math.max(2, role - 1);
      if (frontZ > .75) {
        const faceY = frontY + .035;
        if (identity.archetype === 'warden') {
          const lens = lx * lx + faceY * faceY;
          if (lens < .16 * .16) role = lens < .10 * .10 ? 8 : 7;
        } else {
          const faceWidth = identity.archetype === 'specter' ? .39 : .35;
          if ((lx / faceWidth) ** 2 + (faceY / .13) ** 2 < 1) {
            role = 7;
            const eyeX = identity.eye === 1 ? 0 : Math.abs(lx) - .14;
            if (Math.abs(eyeX) < (identity.eye === 1 ? .18 : .07) && Math.abs(faceY) < .055) role = 8;
          }
        }
        // A small seeded cap mark occupies curved metal, never a flat badge.
        const capX = (identity.insignia - 1.5) * .055;
        if (Math.abs(lx - capX) < .065 && Math.abs(frontY + .43) < .06) role = light > .17 ? 9 : 10;
      }
      // A small back-shell plate gives a readable mark through a full turn.
      if (frontZ < -.88 && Math.abs(lx) < .08 && Math.abs(frontY - .2) < .09) role = light > .17 ? 9 : 10;
      if (contactFlash && role === 5) role = 6;
      // Specular stays fixed under every orientation, including over a mark.
      const specular = -.22 * nx - .29 * ny + .931 * nz;
      if (specular > .984) role = 6;
    }
    indices[i] = role;
  }
  return Object.freeze({ width: 24, height: 24, indices, coverage, palette, animationFrame: 0, contactFlash });
}

/** Nearest indexed cells bounded by the projected native contact disk. All
 * validation precedes writes. The caller supplies the scene's palette mapping. */
export function drawRobotBall(target: PixelCanvas, center: readonly [number, number], radius: number, sprite: RobotBallSprite, inks: readonly number[]) {
  if (!Array.isArray(center) || center.length !== 2 || !Object.hasOwn(center, 0) || !Object.hasOwn(center, 1) || center.some(v => !Number.isFinite(v) || Math.abs(v) > 100000) || !Number.isFinite(radius) || radius < 1 || radius > 96) throw Error('Robot native projection');
  if (!sprite || sprite.width !== 24 || sprite.height !== 24 || !(sprite.indices instanceof Uint8Array) || !(sprite.coverage instanceof Uint8Array) || sprite.indices.length !== 576 || sprite.coverage.length !== 576) throw Error('Robot indexed sprite');
  if (!Array.isArray(inks) || inks.length !== 11 || Array.from({ length: 11 }, (_, i) => i).some(i => !Object.hasOwn(inks, i) || !Number.isInteger(inks[i]) || inks[i]! < 0 || inks[i]! >= target.palette.length)) throw Error('Robot palette mapping');
  for (let i = 0; i < 576; i++) if (sprite.coverage[i]! > 1 || sprite.indices[i]! > 10 || (sprite.coverage[i] && ((i % 24 - 11.5) ** 2 + (Math.floor(i / 24) - 11.5) ** 2 > 11.75 ** 2))) throw Error('Robot source disk/ink');
  if (![target.offsetX, target.offsetY].every(v => Number.isFinite(v) && Math.abs(v) <= 100000)) throw Error('Robot canvas offset');
  const [cx, cy] = center, clip = target.clip;
  const left = Math.max(0, Math.ceil(cx + target.offsetX - radius), clip ? Math.ceil(clip[0]) : 0);
  const right = Math.min(target.W - 1, Math.floor(cx + target.offsetX + radius), clip ? Math.floor(clip[2]) : target.W - 1);
  const top = Math.max(0, Math.ceil(cy + target.offsetY - radius), clip ? Math.ceil(clip[1]) : 0);
  const bottom = Math.min(target.H - 1, Math.floor(cy + target.offsetY + radius), clip ? Math.floor(clip[3]) : target.H - 1);
  let painted = 0;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const dx = x - cx - target.offsetX, dy = y - cy - target.offsetY;
    if (dx * dx + dy * dy > radius * radius) continue;
    const sx = Math.round(dx * 11.75 / radius + 11.5), sy = Math.round(dy * 11.75 / radius + 11.5);
    if (sx < 0 || sy < 0 || sx >= 24 || sy >= 24) continue;
    const source = sy * 24 + sx;
    if (sprite.coverage[source]) {
      // At fewer than six pixels across, retain a bright ball instead of a
      // dark visor fragment. The fallback still occupies the exact native disk.
      const role = radius < 3 ? dx + dy <= 0 ? 6 : 8 : sprite.indices[source]!;
      target.pixels[y * target.W + x] = inks[role]!; painted++;
    }
  }
  return { painted, bounds: [cx - radius, cy - radius, cx + radius, cy + radius] as const, nativeDisk: true as const };
}
