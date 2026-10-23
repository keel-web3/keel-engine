import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dcos, dsin } from '@keel-engine/core';
import { PixelCanvas } from '../../pinball-pixel-art/src/pixel-canvas.ts';
import { createRobotBallMotion, drawRobotBall, generateRobotBallIdentity, rollingRobotBallSprite, withRobotBallPalette, type RobotShellOrientation } from '../src/index.ts';
import type { ArenaBallFrame, ArenaEvent, ArenaFrame } from '../../pinball-arena/src/types.ts';

const rest: RobotShellOrientation = [0, 0, 0, 1];
const identity = generateRobotBallIdentity('rolling-native-shell');
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const body = (overrides: Partial<ArenaBallFrame> = {}): ArenaBallFrame => ({ id: 'core-0', ownerId: 0, teamId: 0, arenaId: 'field', regionId: 'bed', x: 0, y: 0, vx: 0, vy: 0, radius: 16, layer: 0, elevation: 80, active: true, health: 6, energy: 100, shieldTicks: 0, cooldowns: [0, 0, 0], eliminated: false, score: 0, portalCooldown: 0, rampId: null, stationId: null, nextStationId: null, transport: null, ...overrides });
const frame = (tick: number, balls: readonly ArenaBallFrame[] = [body()], events: readonly ArenaEvent[] = []): ArenaFrame => ({ schema: 'keel-pinball-arena-frame@2', tick, mode: 'expedition', phase: 'playing', balls, events, captures: [], mechanisms: [], flippers: [], gates: [], switches: [], portals: [], stations: [], routeProgress: [], qualifications: [], teams: [], storm: { active: false, arenaId: 'field', x: 0, y: 0, radius: 0 }, winnerTeamId: null, finishReason: null });
const close = (a: readonly number[], b: readonly number[], tolerance = 1e-12) => { assert.equal(a.length, b.length); a.forEach((v, i) => assert(Math.abs(v - b[i]!) <= tolerance, `${i}: ${v} != ${b[i]}`)); };
const axis = (x: number, y: number, z: number, angle: number): RobotShellOrientation => [x * dsin(angle / 2), y * dsin(angle / 2), z * dsin(angle / 2), dcos(angle / 2)];

test('signed observed displacement rotates about the native ground-roll axis and reverses', () => {
  for (const [dx, dy, expected] of [[8, 0, axis(0, 1, 0, .5)], [-8, 0, axis(0, -1, 0, .5)], [0, 8, axis(-1, 0, 0, .5)], [0, -8, axis(1, 0, 0, .5)]] as const) {
    const motion = createRobotBallMotion(); motion.update(frame(0));
    const outward = motion.update(frame(1, [body({ x: dx, y: dy })]))[0]!;
    close(outward.orientation, expected);
    const back = motion.update(frame(2))[0]!; close(back.orientation, rest);
    assert(Object.isFrozen(outward) && Object.isFrozen(outward.orientation));
  }
  const motion = createRobotBallMotion(); motion.update(frame(0));
  const forward = motion.update(frame(1, [body({ x: 8 })]))[0]!.orientation;
  const reverse = createRobotBallMotion(); reverse.update(frame(0));
  const backward = reverse.update(frame(1, [body({ x: -8 })]))[0]!.orientation;
  assert.notDeepEqual(rollingRobotBallSprite(identity, forward).indices, rollingRobotBallSprite(identity, backward).indices);
});

test('noncommuting X then Y and Y then X rolls preserve native-axis multiplication order', () => {
  const xy = createRobotBallMotion(), yx = createRobotBallMotion();
  xy.update(frame(0)); yx.update(frame(0));
  xy.update(frame(1, [body({ x: 16 })])); yx.update(frame(1, [body({ y: 16 })]));
  const xyPose = xy.update(frame(2, [body({ x: 16, y: 16 })]))[0]!;
  const yxPose = yx.update(frame(2, [body({ x: 16, y: 16 })]))[0]!;
  const sine = dsin(.5), cosine = dcos(.5);
  // World-axis deltas left multiply the previous shell orientation. A later
  // +Y roll applies -X, so reversing path order reverses the accumulated Z.
  close(xyPose.orientation, [-sine * cosine, sine * cosine, -sine * sine, cosine * cosine]);
  close(yxPose.orientation, [-sine * cosine, sine * cosine, sine * sine, cosine * cosine]);
  assert.equal(xyPose.frame, yxPose.frame, 'equal distance retains the old seam frame');
  assert.notDeepEqual(xyPose.orientation, yxPose.orientation);
  assert.notDeepEqual(rollingRobotBallSprite(identity, xyPose.orientation).indices, rollingRobotBallSprite(identity, yxPose.orientation).indices);
  xy.update(frame(3, [body({ x: 16 })])); yx.update(frame(3, [body({ y: 16 })]));
  close(xy.update(frame(4))[0]!.orientation, rest); close(yx.update(frame(4))[0]!.orientation, rest);
});

test('stationary bodies retain exactly the same orientation and pixels despite velocity or render calls', () => {
  const motion = createRobotBallMotion(); motion.update(frame(0));
  const moved = motion.update(frame(1, [body({ x: 7, y: -3 })]))[0]!;
  const before = rollingRobotBallSprite(identity, moved.orientation).indices;
  for (let tick = 2; tick < 20; tick++) {
    const stopped = motion.update(frame(tick, [body({ x: 7, y: -3, vx: 999, vy: -999 })]))[0]!;
    assert.strictEqual(stopped.orientation, moved.orientation);
    assert.deepEqual(rollingRobotBallSprite(identity, stopped.orientation).indices, before);
    assert.strictEqual(motion.snapshot()[0], stopped);
  }
});

test('each native discontinuity, gap, teleport and body identity change resets orientation', () => {
  for (const type of ['portal', 'capture-enter', 'capture-release', 'transit-start', 'drain', 'fall', 'escape', 'eliminated', 'launch'] as const) {
    for (const binding of [{ bodyId: 'core-0' }, { ownerId: 0 }]) {
      const motion = createRobotBallMotion(); motion.update(frame(0)); motion.update(frame(1, [body({ x: 8 })]));
      const pose = motion.update(frame(2, [body({ x: 12 })], [{ id: 'event', tick: 2, type, ...binding }]))[0]!;
      assert.deepEqual(pose.orientation, rest);
    }
  }
  for (const [tick, change] of [[3, { x: 9 }], [2, { x: 105 }], [2, { layer: 1 }], [2, { arenaId: 'other' }], [2, { radius: 15 }], [2, { ownerId: 1 }], [2, { id: 'new-body' }]] as const) {
    const motion = createRobotBallMotion(); motion.update(frame(0)); motion.update(frame(1, [body({ x: 8 })]));
    assert.deepEqual(motion.update(frame(tick, [body(change)]))[0]!.orientation, rest);
  }
});

test('hidden captured/inactive/eliminated bodies do not roll and resume at rest', () => {
  for (const change of [{ active: false }, { eliminated: true }, { transport: { phase: 'captured' } }]) {
    const motion = createRobotBallMotion(); motion.update(frame(0)); motion.update(frame(1, [body({ x: 8 })]));
    assert.deepEqual(motion.update(frame(2, [body({ ...change, x: 1000 } as Partial<ArenaBallFrame>)])), []);
    assert.deepEqual(motion.update(frame(3, [body({ x: 1001 })]))[0]!.orientation, rest);
  }
});

test('each multiball body has independent signed rotation and explicit contact flash', () => {
  const motion = createRobotBallMotion(), second = body({ id: 'second', ownerId: 0, x: 40 });
  motion.update(frame(0, [body(), second]));
  const poses = motion.update(frame(1, [body({ x: 8 }), { ...second, x: 32 }], [{ id: 'contact', tick: 1, type: 'rail', bodyId: 'second' }]));
  close(poses[0]!.orientation, axis(0, 1, 0, .5)); close(poses[1]!.orientation, axis(0, -1, 0, .5));
  assert.equal(poses[0]!.contactFlash, 0); assert.equal(poses[1]!.contactFlash, 3);
  const unbound = motion.update(frame(2, [body({ x: 8 }), { ...second, x: 32 }], [{ id: 'contact', tick: 2, type: 'rail', ownerId: 0 }]));
  assert.equal(unbound[0]!.contactFlash, 0);
});

test('sphere coverage and fixed glints are independent of shell orientation', () => {
  let sprites = 0; const digests: string[] = [];
  for (const archetype of ['relay', 'warden', 'specter'] as const) for (let seed = 0; seed < 16; seed++) {
    const id = generateRobotBallIdentity('sphere-' + seed, archetype), base = rollingRobotBallSprite(id);
    const glints = Array.from(base.indices.entries()).filter(([, ink]) => ink === 6).map(([i]) => i);
    assert(glints.length > 0 && glints.length < 24);
    const differences = new Set<string>();
    for (let step = 0; step < 16; step++) for (const q of [axis(1, 0, 0, step * Math.PI / 8), axis(0, 1, 0, step * Math.PI / 8)]) {
      const sprite = rollingRobotBallSprite(id, q), digest = hash(sprite.indices);
      assert.deepEqual(sprite.coverage, base.coverage);
      assert.deepEqual(Array.from(sprite.indices.entries()).filter(([, ink]) => ink === 6).map(([i]) => i), glints);
      for (let i = 0; i < 576; i++) {
        const disk = (i % 24 - 11.5) ** 2 + (Math.floor(i / 24) - 11.5) ** 2;
        assert.equal(sprite.coverage[i], disk <= 11.75 ** 2 ? 1 : 0);
        assert(sprite.indices[i]! <= 10);
      }
      differences.add(digest); digests.push(digest); sprites++;
    }
    assert(differences.size > 8, 'native directional rolling should visibly move shell marks');
    const faceCells = base.indices.filter(ink => ink === 7 || ink === 8).length;
    assert(faceCells > 0 && faceCells <= 40, 'the face must remain a small curved surface mark');
    assert(base.indices.filter(ink => ink >= 4 && ink <= 6).length > 120, 'bright metal must dominate the ball');
  }
  console.log(JSON.stringify({ status: 'ROLLING_SHELL_SPRITE_VECTORS', sprites, digest: hash(digests.join('\n')) }));
});

test('camera view ratio changes surface sampling but leaves normals, glints, disk and palette stable', () => {
  const base = rollingRobotBallSprite(identity, rest, 0, false, .8);
  for (const ratio of [0, .4, 1.2, 2]) {
    const sprite = rollingRobotBallSprite(identity, axis(0, 1, 0, .9), 0, false, ratio);
    assert.deepEqual(sprite.coverage, base.coverage); assert.deepEqual(sprite.palette, base.palette);
    assert.deepEqual(Array.from(sprite.indices.entries()).filter(([, role]) => role === 6).map(([i]) => i), Array.from(base.indices.entries()).filter(([, role]) => role === 6).map(([i]) => i));
  }
});

test('reduced motion uses the resting shell while native observation continues', () => {
  const q = axis(1, 0, 0, 1.5);
  assert.deepEqual(rollingRobotBallSprite(identity, q, 3, true).indices, rollingRobotBallSprite(identity).indices);
  const motion = createRobotBallMotion(); motion.update(frame(0));
  for (let tick = 1; tick <= 6; tick++) {
    const pose = motion.update(frame(tick, [body({ x: tick * 4 })]))[0]!;
    assert.deepEqual(rollingRobotBallSprite(identity, pose.orientation, 3, true).indices, rollingRobotBallSprite(identity).indices);
  }
  close(motion.snapshot()[0]!.orientation, axis(0, 1, 0, 1.5));
});

test('actual game radii and fractional offset/clip writes stay inside the exact native disk', () => {
  const sprite = rollingRobotBallSprite(identity, axis(0, 1, 0, .75));
  const mapped = withRobotBallPalette([[3, 4, 5], [6, 7, 8]]), inks = mapped.inkMap(identity);
  // The exact adaptive-fit radius from the live camera review is included,
  // with fractional source centers and offset preimages around pixel edges.
  for (const radius of [1, 2.5, 3, 4.1553245817573085, 7, 7.25, 8.5, 10, 12, 17.5, 96]) for (const center of [[32, 32], [32.25, 31.5], [32.5, 31.25], [32.375, 31.625], [0, 0], [-5, 32]] as const) for (const offset of [[0, 0], [.5, -.75], [3, -2]] as const) {
    const p = new PixelCanvas(64, 64, mapped.palette); p.pixels.fill(0); p.offsetX = offset[0]; p.offsetY = offset[1]; p.clip = [4.25, 5.5, 55.75, 57.25];
    drawRobotBall(p, center, radius, sprite, inks);
    let painted = 0;
    for (let i = 0; i < p.pixels.length; i++) if (p.pixels[i] !== 0) {
      const x = i % 64, y = Math.floor(i / 64);
      assert(x >= 4.25 && x <= 55.75 && y >= 5.5 && y <= 57.25);
      assert((x - center[0] - offset[0]) ** 2 + (y - center[1] - offset[1]) ** 2 <= radius ** 2);
      painted++;
    }
    if (center[0] > 20 && radius >= 4 && radius <= 12) assert(painted >= radius * radius * 2.5, 'a round shell should fill its native disk at adaptive and game scale');
  }
});

test('orientation and motion invalid guards are atomic and replay reset is exact', () => {
  for (const bad of [[], new Array(4), [0, 0, 0, 0], [0, 0, 0, 2], [NaN, 0, 0, 1], [0, 0, Infinity, 1]]) assert.throws(() => rollingRobotBallSprite(identity, bad as unknown as RobotShellOrientation));
  assert.throws(() => rollingRobotBallSprite(identity, rest, 4));
  assert.throws(() => rollingRobotBallSprite(identity, rest, 0, false, NaN));
  assert.throws(() => rollingRobotBallSprite(identity, rest, 0, false, 3));
  const motion = createRobotBallMotion(), frames = [frame(0), frame(1, [body({ x: 8 })]), frame(2, [body({ x: 8, y: 4 })])];
  const poses = frames.map(f => motion.update(f));
  const before = motion.snapshot();
  for (const bad of [frame(1), frame(2, [body({ x: 99 })]), frame(3, [body({ radius: NaN })]), frame(3, [body(), body()]), frame(3, [body()], [{ id: 'bad', tick: 2, type: 'rail' }])]) { assert.throws(() => motion.update(bad)); assert.strictEqual(motion.snapshot(), before); }
  motion.reset(); assert.deepEqual(motion.snapshot(), []);
  assert.deepEqual(frames.map(f => motion.update(f)), poses);
});

test('prepared actual native frame corpora remain pure and replay their shell poses exactly', () => {
  const paths: string[] = JSON.parse(process.env.ROLLING_NATIVE_FRAME_PATHS ?? '[]');
  if (!paths.length) return; // The prepared workspace runner supplies both actual source corpora.
  let frameCount = 0, visiblePoses = 0; const digests: string[] = [];
  for (const path of paths) {
    const bytes = readFileSync(path), source = JSON.parse(bytes.toString()) as ArenaFrame[], untouched = hash(JSON.stringify(source));
    const a = createRobotBallMotion(), b = createRobotBallMotion(), observed = [];
    for (const native of source) {
      const poses = a.update(native); assert.deepEqual(poses, b.update(native)); assert.strictEqual(a.update(native), poses);
      for (const pose of poses) {
        assert(Math.abs(pose.orientation.reduce((sum, v) => sum + v * v, 0) - 1) <= 1e-12);
        const sprite = rollingRobotBallSprite(identity, pose.orientation, pose.contactFlash);
        digests.push(hash(sprite.indices)); visiblePoses++;
      }
      for (const ball of native.balls) if (!ball.active || ball.eliminated || ball.transport !== null) assert(!poses.some(p => p.bodyId === ball.id));
      observed.push(poses); frameCount++;
    }
    assert.equal(hash(JSON.stringify(source)), untouched); a.reset(); assert.deepEqual(source.map(f => a.update(f)), observed);
    digests.push(hash(JSON.stringify(observed)));
  }
  console.log(JSON.stringify({ status: 'ROLLING_SHELL_NATIVE_VECTORS', frameCount, visiblePoses, digest: hash(digests.join('\n')) }));
});
