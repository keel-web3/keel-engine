// Which slot each part of a car's body wears -- the index a paint (paint.ts) is looked up by.

/** The body's slots (paint.ts says what each wears). */
export const BODY_SLOT = {
  paint: 0, alt: 1, glass: 2, trim: 3, dark: 4, light: 5, tail: 6, carbon: 7, metal: 8, accent: 9, roof: 10, arch: 11, grille: 12,
  hood: 13, trunk: 14, doorL: 15, doorR: 16, fenderFL: 17, fenderFR: 18, quarterL: 19, quarterR: 20, bumperF: 21, bumperR: 22, interior: 23, wing: 24, neon: 25,
  /** The windscreen: glass, but its own piece (the build fits it on its own). */
  screen: 26,
  /** Reflectors: they look like the tail lamps' red, but they don't light up when the brakes do. */
  reflector: 27,
  /** The licence plate: its own layer (plate.ts plateDesign), drawn over the bumper's recess with the plate's text as its decal. */
  plate: 28,
  /** Enamel on the engine's covers and intake: coordinated with this car's paint. */
  engine: 29,
  /** A service vehicle's beacons, the two halves of its flash (service.ts; lights.ts flashes them): unused on any other car. */
  beaconA: 30,
  beaconB: 31,
} as const;
