import type { RoleLook } from './look.ts';
/** Fresh plain material role; callers may choose its span without a pattern catalogue. */
export function plainRole(hue: number, chroma: number, light: number, finish: RoleLook['finish'], span = 0.3): RoleLook {
  return { hue, chroma, light, span, finish, pattern: { kind: 'none', freq: 1, angle: 0, width: 4, shift: 0, ink: null } };
}
