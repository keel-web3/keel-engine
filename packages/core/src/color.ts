/** Presentation sRGB byte channel to linear light. Deliberately preserves Math exponentiation. */
export function srgb8ToLinear(byte: number): number {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
