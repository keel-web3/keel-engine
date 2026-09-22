// Bumpers: their own pieces (slots bumperF and bumperR, so a build fits them on
// their own and a paint can pick them out), in the form the car was drawn with
// (CarParts.bumper). Every form wraps the car's corners -- a bumper is the one
// part of a body you see end-on, and a slab with square ends reads as a crate --
// and carries its own detail: an intake mouth and vents, a rub strip and a slim
// grille, a chrome bar and its overriders, or tubes over a skid plate. Behind:
// the same form, reflectors at its corners and a plate recess in its middle.

import type { Car } from "./car.ts";
import { BODY_SLOT as P } from "./slots.ts";
import { both, box, cap } from "./solids.ts";
import type { Solids } from "./solids.ts";

/** Where the bumpers go, as the body was built: its half width and half length, the bumpers' height, and the back panel. */
export interface BumperFit {
  readonly hw: number;
  readonly L2: number;
  readonly bumperH: number;
  /** The tail is rounded (tailEndOf): its own end slices ARE the rear bumper's shell. */
  readonly rounded: boolean;
  readonly backHalf: number;
  readonly backBottom: number;
  readonly backTop: number;
}

/** A painted cover across one end (`e` +1 front, -1 rear), its corners rounded in plan -- the shell every form starts from. */
function cover(S: Solids, slot: number, e: 1 | -1, half: number, y0: number, y1: number, zFace: number, depth: number): void {
  const rc = Math.min(0.08, (y1 - y0) * 0.45, half * 0.2);
  box(S, slot, -(half - rc), y0, zFace, half - rc, y1, zFace - e * depth);
  both((s) => {
    box(S, slot, s * (half - rc), y0, zFace - e * rc, s * half, y1, zFace - e * depth);
    cap(S, slot, [s * (half - rc), y0 + rc * 0.6, zFace - e * rc], [s * (half - rc), y1 - rc * 0.6, zFace - e * rc], rc);
  });
}

export function bumperSolids(S: Solids, car: Car, fit: BumperFit): void {
  const { hw, L2, bumperH } = fit, ride = car.body.ride, form = car.parts.bumper;
  const y0 = ride - 0.03, y1 = ride + bumperH;
  // ---- the front.
  const zF = L2 + 0.05;
  switch (form) {
    case "sport": {
      cover(S, P.bumperF, 1, hw * 0.98, y0, y1, zF, 0.16);
      // The mouth: a wide dark intake low across the middle, vents at the corners, a lip under it all.
      box(S, P.grille, -hw * 0.56, ride + 0.01, zF - 0.02, hw * 0.56, ride + bumperH * 0.62, zF + 0.006);
      both((s) => box(S, P.grille, s * hw * 0.68, ride + 0.02, zF - 0.03, s * hw * 0.88, ride + bumperH * 0.72, zF + 0.004));
      if (car.parts.splitter === "none") box(S, P.carbon, -hw * 0.94, y0 - 0.012, zF - 0.12, hw * 0.94, y0 + 0.012, zF + 0.05);
      break;
    }
    case "street": {
      cover(S, P.bumperF, 1, hw * 0.97, y0, y1, zF, 0.15);
      box(S, P.dark, -hw * 0.9, ride + bumperH * 0.5, zF - 0.02, hw * 0.9, ride + bumperH * 0.64, zF + 0.014);
      box(S, P.grille, -hw * 0.38, ride + 0.015, zF - 0.02, hw * 0.38, ride + bumperH * 0.38, zF + 0.006);
      break;
    }
    case "chrome": {
      cover(S, P.bumperF, 1, hw * 0.93, y0, ride + bumperH * 0.55, zF - 0.02, 0.12);
      const y = ride + bumperH * 0.72, r = 0.045;
      cap(S, P.metal, [-hw * 0.88, y, zF + 0.01], [hw * 0.88, y, zF + 0.01], r);
      both((s) => {
        cap(S, P.metal, [s * hw * 0.88, y, zF + 0.01], [s * (hw + 0.01), y, zF - 0.2], r);
        cap(S, P.metal, [s * hw * 0.42, y - 0.07, zF + 0.04], [s * hw * 0.42, y + 0.06, zF + 0.04], 0.028);
      });
      break;
    }
    case "tube": {
      cover(S, P.bumperF, 1, hw * 0.9, ride + 0.02, y1, zF - 0.03, 0.1);
      box(S, P.metal, -hw * 0.7, y0 - 0.01, zF - 0.3, hw * 0.7, y0 + 0.03, zF + 0.06);
      const y = y1 - 0.02;
      cap(S, P.dark, [-hw * 0.86, y, zF + 0.08], [hw * 0.86, y, zF + 0.08], 0.035);
      both((s) => {
        cap(S, P.dark, [s * hw * 0.58, ride + 0.01, zF + 0.06], [s * hw * 0.58, y, zF + 0.08], 0.03);
        cap(S, P.dark, [s * hw * 0.86, y, zF + 0.08], [s * hw * 0.96, y, zF - 0.14], 0.03);
      });
      break;
    }
  }
  if (car.parts.fogs) both((s) => cap(S, P.light, [s * hw * (form === "sport" ? 0.78 : 0.72), ride + bumperH * 0.28, zF - 0.01], [s * hw * (form === "sport" ? 0.78 : 0.72), ride + bumperH * 0.28, zF + 0.012], 0.032));

  // ---- the back. A rounded tail's end slices are its shell already; a square one gets a cover of its own.
  // (The face its details sit on: a rounded tail's own end, or the square cover's.)
  const zR = fit.rounded ? -L2 : -L2 - 0.04, half = fit.rounded ? fit.backHalf : hw * 0.97;
  const top = fit.rounded ? Math.min(y1, fit.backTop - 0.04) : y1;
  if (car.parts.bed) {
    // A pickup's step bumper: a steel beam across the tailgate's foot with a dark step pad on it.
    box(S, P.metal, -hw * 0.96, ride + 0.02, zR - 0.08, hw * 0.96, ride + bumperH * 0.8, zR + 0.1);
    box(S, P.dark, -hw * 0.3, ride + bumperH * 0.8, zR - 0.06, hw * 0.3, ride + bumperH * 0.8 + 0.015, zR + 0.06);
  } else if (form === "chrome") {
    if (!fit.rounded) cover(S, P.bumperR, -1, half, y0, ride + bumperH * 0.55, zR + 0.02, 0.12);
    const y = ride + bumperH * 0.72;
    cap(S, P.metal, [-half * 0.9, y, zR - 0.01], [half * 0.9, y, zR - 0.01], 0.045);
    both((s) => cap(S, P.metal, [s * half * 0.9, y, zR - 0.01], [s * (half + 0.01), y, zR + 0.2], 0.045));
  } else {
    if (!fit.rounded) cover(S, P.bumperR, -1, half, y0, top, zR, 0.14);
    // A rub strip across it, just proud of the face.
    box(S, P.dark, -half * 0.92, ride + bumperH * 0.52, zR + 0.02, half * 0.92, ride + bumperH * 0.64, zR - 0.012);
    if (form === "tube") box(S, P.metal, -hw * 0.6, y0 - 0.01, zR + 0.25, hw * 0.6, y0 + 0.03, zR - 0.04);
  }
  // Reflectors low at its corners, and the plate's recess in its middle (a plate is part of a real car's face).
  const ry = ride + bumperH * 0.32;
  both((s) => box(S, P.reflector, s * half * 0.8, ry - 0.015, zR - 0.004, s * half * 0.93, ry + 0.015, zR + 0.03));
  const py = Math.min(fit.backTop - 0.2, Math.max(fit.backBottom + 0.02, ride + bumperH * 0.9));
  box(S, P.dark, -0.27, py, zR + 0.03, 0.27, py + 0.15, zR - 0.006);
  box(S, P.metal, -0.24, py + 0.015, zR + 0.02, 0.24, py + 0.135, zR - 0.01);
}
