// What a car drives on, as the physics needs it: how high the ground is under a
// point, and how much grip it gives there. A game hands one in -- a flat plane,
// a race track (tarmac, kerbs, grass), a city's road field -- and the physics
// never needs to know which.

export interface Ground {
  /** The ground's height (m) under a world point. */
  height(x: number, z: number): number;
  /** Grip there as a share of dry tarmac (1): grass ~0.6, wet ~0.75, ice ~0.15. */
  grip(x: number, z: number): number;
  /**
   * How much the ground catches a tyre skating across it sideways (0..1; left out, 0): tarmac lets it slide, grass and
   * dirt let it dig in, a kerb stops it dead. Past the tyre's own grip, low on the car -- what trips a sliding car over.
   */
  trip?(x: number, z: number): number;
  /** Rolling drag there, as a share of the weight on a tyre (left out, 0): sand and mud bog a car down. */
  drag?(x: number, z: number): number;
  /**
   * Which way the ground faces there (a unit vector, y up; left out, straight up). The body's corners pressed into the
   * ground are pushed out along it and slide across it: a steep face -- a cliff, a bank -- shoves a car back rather
   * than lifting it up the face.
   */
  normal?(x: number, z: number): readonly [number, number, number];
}

/** A flat, grippy plane at y = 0 (tests, the showroom). */
export const FLAT: Ground = { height: () => 0, grip: () => 1 };
