// The Chromatic, measured. Millimetres, from ModRetro's product photographs (front, back, side, top and bottom at
// known scale) and its published size, 5.2 x 3 x 1.2 in. Plan positions are "photo space": x from the left edge,
// y DOWN from the top edge, as the pictures are read. z is depth: 0 at the face, negative into the body.

export const MM = {
  w: 76,
  h: 131.7,
  /** Corner radii: top-left, top-right, bottom-right, bottom-left. The bottom right is the Game Boy's big curve. */
  corners: [3.2, 3.2, 10, 3.2] as const,
  front: { z0: -10.6, z1: 0, chamfer: 0.85, roundClear: 1.5, wall: 1.8 },
  back: { z0: -20.6, z1: -10.95, round: 2.4 },
  /** The battery bulge: its top edge slopes from y 63 (at the back shell's face) to y 76 (at its own back). */
  hump: { z0: -19.6, z1: -28.4, topAt: [63, 76] as const, round: 2.8 },
  glass: { x0: 5.5, y0: 5.5, x1: 70.4, y1: 66.2, r: 2.4, rBig: 12.5, z0: -0.35, z1: 0.32, chamfer: 0.28 },
  screen: { x0: 13.7, y0: 13.6, x1: 62.3, y1: 57.4, px: [160, 144] as const },
  brand: { x: 38, y: 9.45, cap: 1.9 },
  wordmark: { x0: 6.4, y: 70.6, cap: 2.1, x1: 27.2 },
  bars: { x0: 30.2, pitch: 3.42, w: 2.0, first: 1.0, n: 11, h: 2.1, rise: [0, 0, 0, 0, 0, 0, 0, 0.6, 1.5, 2.7, 4.3] as const },
  dpad: { x: 17.9, y: 89.6, span: 22.4, arm: 7.3, top: 2.1, bevel: 0.9, ro: 1.1, ri: 0.9, well: 0.7 },
  a: { x: 64.6, y: 86.2, r: 4.75, top: 2.4, well: 0.75 },
  b: { x: 50.4, y: 92.6, r: 4.75, top: 2.4, well: 0.75 },
  labelA: { x: 68.4, y: 94.6 },
  labelB: { x: 54.0, y: 100.8 },
  select: { x: 30.0, y: 110.6, len: 11.6, w: 3.1, angle: 25.4, top: 1.25, well: 0.55 },
  start: { x: 44.4, y: 110.6, len: 11.6, w: 3.1, angle: 25.4, top: 1.25, well: 0.55 },
  labelSelect: { x: 31.2, y: 114.9, cap: 1.25 },
  labelStart: { x: 45.7, y: 114.9, cap: 1.25 },
  /** The two corner stripes: a 45 degree band and a small triangle, as lines y - x = c, inside a 2.6 mm margin. */
  stripes: { band: [108.5, 113.7] as const, triangle: 119.2, margin: 2.6, bottom: 129.3 },
  /** Side and edge parts (y down; x from the left edge; z depth). */
  wheel: { y: 40.5, z: -10.0, r: 7.0, w: 2.8, out: 2.0 },
  sideButton: { y: 57.5, z: -9.6, len: 6.0, w: 3.4, out: 0.9 },
  power: { x: 16.5, len: 15.8, z: -7.2 },
  ir: { x: 50, len: 24.5, z: -7.2 },
  link: { y: 57.5, z: -11.0, len: 10.4, width: 6.8 },
  cart: { x0: 9.2, x1: 66.8, y0: 0.2, y1: 64.5, z0: -19.4, z1: -11.4, window: { x0: 9.6, x1: 66.4, y1: 35, r: 3 } },
  /** Bottom edge: jack, LED, USB-C, speaker grille (2 rows x 6). */
  bottom: { jack: 19, led: 28, usb: 38, grille: { x0: 51, pitch: 3.0, rows: [-3.7, -6.7] as const, r: 0.90, n: 5 } },
  /** Screws on the back: two at the cart window's shoulders, four round the battery door. */
  screws: [[5.5, 6], [70.5, 6], [6, 84], [70, 84], [8, 126], [68, 126]] as const,
  door: { x0: 8.5, x1: 67.5, y0: 80, y1: 128.5, r: 2.4 },
} as const;

/** Scene units per millimetre (the studio's units: the Chromatic is 2.634 tall). */
export const UNIT = 1 / 50;

/** Photo-space mm to device-plan mm: centred, y up. */
export const toPlan = (x: number, y: number): [number, number] => [x - MM.w / 2, MM.h / 2 - y];
export const fromPlan = (X: number, Y: number): [number, number] => [X + MM.w / 2, MM.h / 2 - Y];

/** The detail levels: the grid's (cheaper tessellation, no inside parts) and the solo page's. */
export type Detail = "grid" | "solo";
export const SEGMENTS: Record<Detail, { corner: number; bevel: number; round: number }> = {
  grid: { corner: 6, bevel: 3, round: 24 },
  solo: { corner: 14, bevel: 7, round: 56 },
};
