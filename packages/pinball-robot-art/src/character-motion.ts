import { dcos, dhypot, dsin } from '@keel-engine/core';
import type { ArenaFrame } from '@keel-engine/pinball-arena';

/** Cosmetic shell orientation in native world axes, quaternion XYZW. */
export type RobotShellOrientation = readonly [number, number, number, number];
type Sample = { x: number; y: number; layer: number; arenaId: string; radius: number; ownerId: number; travelQ: number; flashTick: number; orientation: RobotShellOrientation };
export type RobotMotionPose = Readonly<{ bodyId: string; frame: number; contactFlash: number; tick: number; orientation: RobotShellOrientation }>;
const still: RobotShellOrientation = Object.freeze([0, 0, 0, 1]);
const discontinuities = new Set(['portal', 'capture-enter', 'capture-release', 'transit-start', 'drain', 'fall', 'escape', 'eliminated', 'launch']);
const contacts = new Set(['rail', 'bumper', 'flipper', 'ball-contact']);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;

/** Observed signed native XY displacement drives a cosmetic no-slip ground
 * roll: axis = ground normal cross displacement, angle = distance / radius.
 * This is presentation, not native spin, angular momentum or a slope solver.
 * Reset at replay boundaries; captured/inactive bodies have no visible pose. */
export function createRobotBallMotion() {
  let tick = -1, signature = '', poses: readonly RobotMotionPose[] = Object.freeze([]);
  let samples = new Map<string, Sample>();
  const reset = () => { tick = -1; signature = ''; poses = Object.freeze([]); samples = new Map(); };
  const update = (frame: ArenaFrame) => {
    if (!frame || !Number.isSafeInteger(frame.tick) || frame.tick < 0 || frame.tick > 432000 || !Array.isArray(frame.balls) || frame.balls.length > 128 || !Array.isArray(frame.events) || frame.events.length > 2048) throw Error('Robot native motion budget');
    const ids = new Set<string>();
    for (let i = 0; i < frame.balls.length; i++) {
      const b = frame.balls[i];
      if (!Object.hasOwn(frame.balls, i) || !b || !validId(b.id) || !validId(b.arenaId) || ids.has(b.id) || !Number.isInteger(b.ownerId) || b.ownerId < 0 || b.ownerId > 99 || !Number.isInteger(b.layer) || b.layer < 0 || b.layer > 3 || ![b.x, b.y, b.radius].every(v => Number.isFinite(v) && Math.abs(v) <= 1e6) || b.radius < .5 || b.radius > 96 || typeof b.active !== 'boolean' || typeof b.eliminated !== 'boolean' || !(b.transport === null || b.transport && typeof b.transport === 'object')) throw Error('Robot native body sample');
      ids.add(b.id);
    }
    const broken = new Set<string>(), flashes = new Set<string>();
    for (let i = 0; i < frame.events.length; i++) {
      const e = frame.events[i];
      if (!Object.hasOwn(frame.events, i) || !e || !validId(e.id) || !Number.isSafeInteger(e.tick) || e.tick !== frame.tick || typeof e.type !== 'string' || (e.bodyId !== undefined && !validId(e.bodyId))) throw Error('Robot native event sample');
      // Only an explicit body ID can bind a contact flash. Shared owner IDs or
      // nearby coordinates cannot tell us which multiball body was struck.
      if (e.bodyId !== undefined && contacts.has(e.type)) flashes.add(e.bodyId);
      if (discontinuities.has(e.type)) {
        if (e.bodyId !== undefined) broken.add(e.bodyId);
        else if (e.ownerId !== undefined) for (const b of frame.balls) if (b.ownerId === e.ownerId) broken.add(b.id);
      }
    }
    const nextSignature = JSON.stringify([frame.balls.map(b => [b.id, b.ownerId, b.x, b.y, b.radius, b.layer, b.arenaId, b.active, b.eliminated, b.transport !== null]), [...broken], [...flashes]]);
    if (frame.tick === tick) {
      if (nextSignature !== signature) throw Error('Robot conflicting native tick');
      return poses;
    }
    if (frame.tick < tick) throw Error('Robot motion reset required');
    const fresh = new Map<string, Sample>(), next: RobotMotionPose[] = [];
    for (const b of frame.balls) {
      if (!b.active || b.eliminated || b.transport !== null) continue;
      const prior = samples.get(b.id), continuity = prior && frame.tick - tick <= 16 && prior.layer === b.layer && prior.arenaId === b.arenaId && prior.radius === b.radius && prior.ownerId === b.ownerId && !broken.has(b.id);
      const displacement = continuity ? dhypot(b.x - prior.x, b.y - prior.y) : 0;
      const travelQ = continuity && displacement <= 96 ? (prior.travelQ + Math.round(displacement * 1024)) % Math.round(b.radius * 6432) : 0;
      // Missing ticks can hide a turn. Keep the historical seam-frame behavior,
      // but start an unambiguous orientation at the next consecutive sample.
      let orientation = continuity && frame.tick === tick + 1 && displacement <= 96 ? prior.orientation : still;
      if (continuity && frame.tick === tick + 1 && displacement > 0 && displacement <= 96) {
        const halfAngle = displacement / b.radius / 2, sine = dsin(halfAngle);
        const ax = -(b.y - prior.y) / displacement * sine, ay = (b.x - prior.x) / displacement * sine, aw = dcos(halfAngle);
        const [qx, qy, qz, qw] = orientation;
        // Left multiplication applies each observed delta in native axes.
        const x = aw * qx + ax * qw + ay * qz, y = aw * qy + ay * qw - ax * qz;
        const z = aw * qz + ax * qy - ay * qx, w = aw * qw - ax * qx - ay * qy;
        const length = Math.sqrt(x * x + y * y + z * z + w * w);
        orientation = Object.freeze([x / length, y / length, z / length, w / length]);
      }
      const flashTick = flashes.has(b.id) ? frame.tick : continuity ? prior.flashTick : -100;
      const age = frame.tick - flashTick;
      const animationFrame = Math.min(7, Math.floor(travelQ * 8 / Math.round(b.radius * 6432)));
      fresh.set(b.id, {x:b.x,y:b.y,layer:b.layer,arenaId:b.arenaId,radius:b.radius,ownerId:b.ownerId,travelQ,flashTick,orientation});
      next.push(Object.freeze({bodyId:b.id,frame:animationFrame,contactFlash:age < 6 ? 3 - Math.floor(age / 2) : 0,tick:frame.tick,orientation}));
    }
    samples = fresh; tick = frame.tick; signature = nextSignature; poses = Object.freeze(next);
    return poses;
  };
  return Object.freeze({ update, reset, snapshot: () => poses });
}
