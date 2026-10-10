import type { RoomArtTheme } from './index.ts';

/** Palette indices refer to the existing 32-slot room material palette. This
 * sampler changes neither coverage nor geometry, and never emits ball-white31. */
export type TubeMaterialFace = 'shell' | 'rim' | 'throat' | 'underside' | 'lining' | 'collar';
export type TubeMaterialSampler = Readonly<{
  theme: RoomArtTheme;
  sample(light: number, profile: number, along: number, face: TubeMaterialFace, facing?: number, specular?: number): number;
}>;

/** Allocate once per source path/material. Fragment sampling has no loops,
 * allocations, trigonometry, canvas writes or hidden screen-space coordinates.
 * profile is the native section's signed lateral coordinate [-1,1]; light is
 * actual normalized normal illumination. Facing and specular are true normal-dot-view
 * and normal-dot-normalized(light+view), supplied by geometry, never inferred
 * from lateral profile. Both optional terms default to zero. Path distance
 * remains native units. */
export function createTubeMaterialSampler(theme: RoomArtTheme, seed: string): TubeMaterialSampler {
  if (!['ion-relay', 'grove', 'vaporwave'].includes(theme) || typeof seed !== 'string' || seed.length < 1 || seed.length > 4096) throw Error('Tube material theme/seed');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619) >>> 0;
  const phase = hash % 101;
  return Object.freeze({ theme, sample(light: number, profile: number, along: number, face: TubeMaterialFace, facing = 0, specular = 0): number {
    if (!Number.isFinite(light) || light < 0 || light > 1 || !Number.isFinite(profile) || profile < -1 || profile > 1 || !Number.isFinite(along) || Math.abs(along) > 1e6 || (face !== 'shell' && face !== 'rim' && face !== 'throat' && face !== 'underside' && face !== 'lining' && face !== 'collar') || !Number.isFinite(facing) || facing < 0 || facing > 1 || !Number.isFinite(specular) || specular < 0 || specular > 1) throw Error('Tube material sample');
    // Unequal 256-unit material cells carry sparse broad reflected windows.
    // No hash/noise per fragment: the whole window has a stepped pixel contour.
    const a = along + phase, cell = Math.floor(a / 256), u = a - cell * 256;
    let cellHash = Math.imul((cell | 0) ^ hash, 0x45d9f3b) >>> 0;
    cellHash = Math.imul(cellHash ^ (cellHash >>> 16), 0x45d9f3b) >>> 0;
    const variation = cellHash % 3, shift = (cellHash >>> 9) % 29,
      stepped = Math.floor(u / 12), bend = (stepped < 5 ? stepped : stepped < 10 ? 10 - stepped : 0) * .012,
      patch = u > 22 + shift + variation * 9 && u < 100 + shift + variation * 13,
      glint = patch && Math.abs(profile + .27 - bend - ((cellHash >>> 18) % 5) * .012) < .038 && light > .56;
    if (theme === 'ion-relay') {
      // Root geometry supplies true normal/view and normal/half-vector dots.
      // The palette's pale values are specular only, never a broad diffuse cap.
      if (face === 'throat') return light > .60 && facing > .35 ? 2 : 1;
      if (face === 'lining') return light > .70 && facing > .55 ? 3 : light > .28 ? 2 : 1;
      if (face === 'underside') return light > .70 ? 3 : light > .32 ? 2 : 1;
      if (face === 'rim' || face === 'collar') {
        if (specular > .986 && light > .28) return 5;
        return light > .73 ? 4 : light > .38 ? 3 : light > .15 ? 2 : 1;
      }
      const shade = light * (.72 + facing * .28);
      let ink = shade < .15 ? 1 : shade < .34 ? 2 : shade < .65 ? 3 : 4;
      // Small reflected copper fragments live in the midtone, never form a
      // continuous painted band. Cell variations remain native-path seeded.
      const reflected = u > 46 + shift && u < 62 + shift + variation * 4;
      if (reflected && facing > .42 && facing < .70 && shade > .30 && shade < .55) ink = 14;
      if (specular > .978 && light > .32) ink = 5;
      if (specular > .998 && light > .50 && u > 24 + shift && u < 114 + shift) ink = 6;
      return ink;
    }
    // Existing non-Ion faces retain R16b output byte-for-byte. New geometry
    // roles map deliberately to those materials' existing mouth/rim families.
    if (face === 'lining') face = 'throat';
    if (face === 'collar') face = 'rim';
    if (theme === 'grove') {
      if (face === 'throat') return light > .48 ? 13 : 1;
      if (face === 'underside') return light > .55 ? 14 : 13;
      if (face === 'rim') return light > .83 ? 16 : light > .48 ? 15 : 14;
      let ink = light < .18 ? 13 : light < .40 ? 14 : light < .69 ? 15 : 16;
      // Broad offset mineral/moss veins, with dark split edges. These are
      // material inlays, not branches or rails added to the working route.
      const vein = profile - (.18 + (stepped % 4) * .035);
      if (u > 108 + shift && u < 210 + shift && vein > -.09 && vein < .13) ink = light > .58 ? 4 : 3;
      if (u > 114 + shift && u < 198 + shift && vein > -.09 && vein < -.055) ink = 13;
      if (glint) ink = 17;
      return ink;
    }
    if (face === 'throat') return light > .48 ? 2 : 1;
    if (face === 'underside') return light > .58 ? 3 : 1;
    if (face === 'rim') return light > .82 ? 17 : light > .48 ? 16 : 14;
    let ink = light < .16 ? 1 : light < .37 ? 2 : light < .61 ? 3 : light < .87 ? 4 : 5;
    // A single irregular cyan reflection crosses lavender ceramic. Pink is
    // localized to the physical rim, not every persistent shell edge.
    if (patch && profile > -.46 + bend && profile < -.13 + bend) ink = light > .75 ? 11 : light > .43 ? 10 : 9;
    if (glint) ink = 23;
    return ink;
  }});
}
