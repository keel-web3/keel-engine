// Fitting attributes: a design built to a socket, placed on a posed entity.
//
// An attribute is built in its socket's frame (bodies.ts: the socket's origin,
// +z the entity's front at rest, +y up, +x its right hand), sized to the
// socket's `size` -- so the same hat is built to a mouse's head or a bear's.
// placeAttribute() puts it on a posed skeleton: every point goes through the
// socket's bone, so it follows the head through a run, the back through a
// leap, the hand through a swing.
//
//   const sockets = socketsOf(spec);
//   const hat = { capsules: [{ a: [0, 0, 0], b: [0, sockets.head.size[1], 0], r: sockets.head.size[0] * 0.4 }] };
//   const fitted = placeAttribute(anim.skeleton(), sockets.head, hat);
//   renderer.setWorld({ capsules: [...anim.capsules(), ...fitted.capsules] });
//
// Runtime attributes (defineAttribute) whose design is an AttributeShape go
// straight through wear(): it finds the slot's socket on the entity and has
// the attribute build itself to it.

import { yawOf } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import type { AttributeDef, Pins, Stream } from "@keel-engine/runtime";
import { box, capsulePart, mk, sphere, turned } from "@keel-engine/scene";
import type { Mat3, SdfPart } from "@keel-engine/scene";
import { socketsOf } from "./bodies.ts";
import type { EntitySocket } from "./bodies.ts";
import { apply, boneToWorld, mul, rotY, transpose } from "./rig.ts";
import type { Skeleton } from "./rig.ts";
import { DEFAULT_MATERIALS, materialFor } from "./skin.ts";
import type { Capsule, MaterialTable, Role } from "./skin.ts";
import type { EntitySpec } from "./species.ts";

/** A capsule in the socket's frame. */
export interface AttributeCapsule {
  readonly a: Vec3Like;
  readonly b: Vec3Like;
  readonly r: number;
  readonly part?: string;
  readonly role?: Role;
}
/** A box in the socket's frame: centre, half-extents, turned by yaw about the socket's y. */
export interface AttributeBox {
  readonly c: Vec3Like;
  readonly h: Vec3Like;
  readonly yaw?: number;
  readonly part?: string;
  readonly role?: Role;
}
/** An attribute's design as the fitter takes it: capsules and boxes in its socket's frame. */
export interface AttributeShape {
  readonly capsules?: readonly AttributeCapsule[];
  readonly boxes?: readonly AttributeBox[];
}

/** A box in the world: m is its full turn (the bone's); yaw its heading, for consumers whose boxes only turn about y. */
export interface FittedBox {
  readonly c: Vec3;
  readonly h: Vec3;
  readonly m: Mat3;
  readonly yaw: number;
  readonly mat: number;
  readonly part: string;
  readonly role: Role;
}
export interface Fitted {
  readonly socket: string;
  readonly capsules: Capsule[];
  readonly boxes: FittedBox[];
}

/** A socket in the world, on a posed skeleton: its origin and its frame (local -> world). */
export interface SocketFrame {
  readonly p: Vec3;
  readonly m: Mat3;
}

type SocketLike = Pick<EntitySocket, "name" | "bone" | "at">;

/** Where a socket is on a posed skeleton: it rides its bone. */
export function socketFrame(skel: Skeleton, socket: SocketLike): SocketFrame {
  const b = skel.bones[socket.bone];
  if (!b) throw new RangeError(`Socket ${socket.name} rides ${socket.bone}, which this ${skel.plan} skeleton hasn't got.`);
  return { p: boneToWorld(skel, socket.bone, socket.at), m: b.m };
}

/** A point in a socket's frame -> world. */
export const socketToWorld = (frame: SocketFrame, local: Vec3Like): Vec3 => {
  const v = apply(frame.m, local);
  return [frame.p[0] + v[0], frame.p[1] + v[1], frame.p[2] + v[2]];
};
/** A world point -> the socket's frame (what a hit on a hat means to the hat). */
export const worldToSocket = (frame: SocketFrame, p: Vec3Like): Vec3 => apply(transpose(frame.m), [p[0] - frame.p[0], p[1] - frame.p[1], p[2] - frame.p[2]]);

export interface PlaceOptions {
  /** Material numbers by role (default: WALLRUN's, as skin.ts). */
  readonly materials?: MaterialTable;
  /** The part name for pieces that don't name one (default "attribute"). */
  readonly part?: string;
  /** The role for pieces that don't say (default "accent"). */
  readonly role?: Role;
}

/** Put an attribute built to `socket` onto a posed skeleton. */
export function placeAttribute(skel: Skeleton, socket: SocketLike, shape: AttributeShape, { materials = DEFAULT_MATERIALS, part = "attribute", role = "accent" }: PlaceOptions = {}): Fitted {
  const frame = socketFrame(skel, socket);
  const W = (v: Vec3Like): Vec3 => socketToWorld(frame, v);
  const capsules = (shape.capsules ?? []).map((c): Capsule => {
    const r = c.role ?? role;
    return { a: W(c.a), b: W(c.b), r: c.r, mat: materialFor(r, materials), part: c.part ?? part, role: r };
  });
  const boxes = (shape.boxes ?? []).map((bx): FittedBox => {
    const r = bx.role ?? role;
    const m = mul(frame.m, rotY(bx.yaw ?? 0));
    return { c: W(bx.c), h: [bx.h[0], bx.h[1], bx.h[2]], m, yaw: yawOf(apply(m, [0, 0, 1])), mat: materialFor(r, materials), part: bx.part ?? part, role: r };
  });
  return { socket: socket.name, capsules, boxes };
}

/**
 * A fitted attribute as scene parts (an SDF and bounds each): for bounds, rays and contact with the rest of a
 * scene. (A ball -- a capsule with both ends together -- goes in as a sphere: core's sdCapsule divides by the
 * segment's length, so a zero-length capsule part would read NaN everywhere.)
 */
export function fittedParts(fitted: Fitted): SdfPart[] {
  const ball = (c: Capsule): boolean => c.a[0] === c.b[0] && c.a[1] === c.b[1] && c.a[2] === c.b[2];
  return [
    ...fitted.capsules.map((c) => (ball(c) ? mk(sphere(c.a, c.r), { name: c.part }) : capsulePart({ a: c.a, b: c.b, r: c.r }, { name: c.part }))),
    ...fitted.boxes.map((b) => mk(turned(box(b.c, b.h, 0), b.m, b.c), { name: b.part })),
  ];
}

/** An attribute built to an entity: the socket its slot names, and the design built to it. */
export interface Worn<D extends AttributeShape = AttributeShape> {
  readonly slot: string;
  readonly socket: EntitySocket;
  readonly design: D;
}

/**
 * Build a runtime attribute to an entity's socket (whether it may go there at
 * all is runtime's fits(): packs and body contracts). Place it each frame with
 * placeAttribute(skeleton, worn.socket, worn.design).
 */
export function wear<D extends AttributeShape>(attribute: AttributeDef<D>, spec: EntitySpec, S: Stream, pins: Pins = {}): Worn<D> {
  const socket = socketsOf(spec)[attribute.slot];
  if (!socket) throw new RangeError(`${attribute.id} sits in "${attribute.slot}"; a ${spec.plan} ${spec.species} has no such socket (${Object.keys(socketsOf(spec)).join(", ")}).`);
  return { slot: attribute.slot, socket, design: attribute.build(S, socket, pins) };
}
