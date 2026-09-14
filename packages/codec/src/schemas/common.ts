// The engine's units, as codec types, shared by every engine schema: where
// things are (millimetres across 16 km), how big (millimetres to a kilometre),
// which way they face (a 65536th of a turn), a share (a 1024th), a seed.

import { fixed, alt, num, ref, tuple, uint } from "../schema.ts";

/** A world coordinate in metres, to the millimetre: -8192..8192 m in 24 bits. */
export const coord = fixed(-8192, 8192, 0.001);
/**
 * A coordinate in a thing's own frame, to the millimetre, Golomb-coded: near its pivot is small (within
 * 0.5 m in 11 bits, 4 m in 15, 32 m in 21) -- a socket, a collider.
 */
export const local = fixed(-8192, 8192, 0.001, { k: 10 });
/** The same, delta-coded: each from the last one at this place in the document (a part after a part, a rail's next point). */
export const localDelta = fixed(-8192, 8192, 0.001, { k: 9, delta: true });
/** A size or half-extent in metres, to the millimetre, Golomb-coded (0.25 m in 10 bits, 2 m in 14). */
export const size = fixed(0, 1024, 0.001, { k: 9 });
/** The same, delta-coded (a stair's next step, the same half-width again in 1 bit). */
export const sizeDelta = fixed(0, 1024, 0.001, { k: 9, delta: true });
/** A yaw in radians, -pi..pi to a 65536th of a turn (17 bits; pi/2, pi and their kin exactly). */
export const yaw = fixed(-Math.PI, Math.PI, Math.PI / 32768);
/** 0..1 in 1024ths (10 bits... 11 with 1 itself). */
export const unit = fixed(0, 1, 1 / 1024);
/** -1..1 to the thousandth: a direction's component. */
export const signed = fixed(-1, 1, 0.001);

export const vec3 = tuple([coord, coord, coord]);
/** A point in a thing's own frame. */
export const lvec3 = tuple([local, local, local]);
/** A point in a thing's own frame, each axis from the last point at this place (parts, rails). */
export const dvec3 = tuple([localDelta, localDelta, localDelta]);
export const dhalf3 = tuple([sizeDelta, sizeDelta, sizeDelta]);
export const half3 = tuple([size, size, size]);
export const dir3 = tuple([signed, signed, signed]);

/** A seed: any text ("42", "garden"), a bytes32 hex seed packed to its 32 bytes; through the default table, so a seed repeated anywhere in a document (free JSON included) is written once. */
export const seedText = ref("str", { packHex: true });
/** A seed a caller may give as a number or text (the music's, NOCTURNES' tokens). */
export const seedAny = alt([num(), seedText]);

/** An OKLCH colour [L, C, hue], lossless (authored values in few bits, drawn ones whole). */
export const oklch = tuple([fixed(0, 1, 0.001, { off: "exact" }), fixed(0, 0.5, 0.001, { off: "exact" }), fixed(0, 360, 0.01, { off: "exact" })]);

/** A name from the document's shared table of ids. */
export const id = ref("ids");
/** A small count. */
export const count8 = uint(8);
