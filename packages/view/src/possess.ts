// Possession: one unit taken out of its AI and driven by a player, through a
// COMMAND STREAM -- per simulation tick, for that unit, where it moves, which
// way it faces, what it does. The input side samples the keys, the mouse and
// the camera into a command; the simulation only ever reads commands. So the
// same commands give the same run, bit for bit (a replay, a test), and the
// stream is what a lockstep game sends: each peer's commands for tick T are
// applied by every peer at T (sampled at T - delay), and nothing a peer sees
// on its own screen -- its camera, its frame rate -- reaches the simulation.
//
//   const cmds = createCommandStream({ delay: 0 });
//   each frame:  input -> sampleCommand(...) -> cmds.push(command)       (the player's side)
//   each tick:   for (const c of cmds.take(tick)) stepPossessed(unit, c, DT, rules)   (the simulation)
//
// A command is quantised (move: -127..127 a way; facing: 1/65536 of a turn;
// actions: bits) -- 13 bytes on the wire (encodeCommands), and what's
// quantised is what's simulated, so a sender and a receiver agree exactly.
// Possessing and releasing are commands too (ACT.possess / ACT.release): a
// hero changes hands on a tick, the same tick everywhere.

import { TAU } from "@keel-engine/core";

/** Action bits. */
export const ACT = Object.freeze({ attack: 1, use: 2, run: 4, jump: 8, possess: 16, release: 32 });

export interface PossessCommand {
  /** The simulation tick it's for. */
  readonly tick: number;
  readonly unit: number;
  /** Where to move in the world, x and z, -127..127 each (a unit vector and its strength, quantised). */
  readonly mx: number;
  readonly mz: number;
  /** Which way to face: 0..65535 of a turn (the frame convention's yaw). */
  readonly face: number;
  /** ACT bits. */
  readonly act: number;
}

const q8 = (v: number): number => Math.max(-127, Math.min(127, Math.round(v * 127)));
const wrapTurn = (yaw: number): number => { const t = Math.round((yaw / TAU) * 65536); return ((t % 65536) + 65536) % 65536; };

/** A command from world-space move (x, z; clamped to length 1), a facing yaw and action bits. */
export function commandOf(tick: number, unit: number, move: readonly [number, number], yaw: number, act = 0): PossessCommand {
  let [x, z] = move;
  const l = Math.hypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  return { tick, unit, mx: q8(x), mz: q8(z), face: wrapTurn(yaw), act: act & 0xff };
}
/** A command's move, in the world (length 0..1). */
export const moveOf = (c: PossessCommand): [number, number] => { const x = c.mx / 127, z = c.mz / 127; const l = Math.hypot(x, z); return l > 1 ? [x / l, z / l] : [x, z]; };
/** A command's facing yaw (-pi..pi). */
export const faceOf = (c: PossessCommand): number => { const y = (c.face / 65536) * TAU; return y > Math.PI ? y - TAU : y; };

/** What the player's input says this frame: forward/back and strafe (-1..1 each), the actions held, and how the unit faces. */
export interface PossessInput {
  readonly forward: number;
  readonly strafe: number;
  readonly act?: number;
  /** "move": the way it's going (a third-person view); "camera": where the camera looks (first person, aiming); a yaw: that. */
  readonly facing?: "move" | "camera" | number;
}

/**
 * Sample a command: the input turned into the world by the camera's yaw (W goes where the camera looks), the facing
 * by its rule (keeping the unit's own when it isn't moving and faces "move").
 */
export function sampleCommand(tick: number, unit: number, input: PossessInput, cameraYaw: number, unitYaw: number): PossessCommand {
  const s = Math.sin(cameraYaw), c = Math.cos(cameraYaw);
  // (Forward along the yaw [sin, cos]; right of it [cos, -sin]: the frame convention.)
  const x = input.forward * s + input.strafe * c, z = input.forward * c - input.strafe * s;
  const f = input.facing ?? "move";
  const moving = Math.hypot(x, z) > 1e-3;
  const yaw = typeof f === "number" ? f : f === "camera" ? cameraYaw : moving ? Math.atan2(x, z) : unitYaw;
  return commandOf(tick, unit, [x, z], yaw, input.act ?? 0);
}

// ---------------------------------------------------------------- the wire

/** Bytes a command takes on the wire. */
export const COMMAND_BYTES = 13;

/** Commands as bytes: tick u32, unit u32, mx i8, mz i8, face u16, act u8 (little endian). */
export function encodeCommands(list: readonly PossessCommand[]): Uint8Array {
  const out = new Uint8Array(list.length * COMMAND_BYTES);
  const v = new DataView(out.buffer);
  list.forEach((c, n) => {
    const o = n * COMMAND_BYTES;
    v.setUint32(o, c.tick >>> 0, true); v.setUint32(o + 4, c.unit >>> 0, true);
    v.setInt8(o + 8, c.mx); v.setInt8(o + 9, c.mz); v.setUint16(o + 10, c.face, true); v.setUint8(o + 12, c.act);
  });
  return out;
}
export function decodeCommands(bytes: Uint8Array): PossessCommand[] {
  if (bytes.length % COMMAND_BYTES) throw new RangeError(`${bytes.length} bytes isn't a whole number of commands.`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: PossessCommand[] = [];
  for (let o = 0; o < bytes.length; o += COMMAND_BYTES) out.push({ tick: v.getUint32(o, true), unit: v.getUint32(o + 4, true), mx: v.getInt8(o + 8), mz: v.getInt8(o + 9), face: v.getUint16(o + 10, true), act: v.getUint8(o + 12) });
  return out;
}

// ---------------------------------------------------------------- the stream

export interface CommandStream {
  /** Ticks between sampling a command and applying it (a lockstep game's input delay; 0 for a local game). */
  readonly delay: number;
  /** A command sampled now: scheduled for its tick + delay. Returns the command as scheduled. */
  push(c: PossessCommand): PossessCommand;
  /** A command from a peer, already scheduled. */
  receive(c: PossessCommand): void;
  /** The commands for a tick (in unit order, the last per unit wins) -- and forgets them. */
  take(tick: number): PossessCommand[];
  /** Everything scheduled, oldest first (what a replay records). */
  readonly pending: readonly PossessCommand[];
}

export function createCommandStream({ delay = 0 }: { delay?: number } = {}): CommandStream {
  const byTick = new Map<number, Map<number, PossessCommand>>();
  const put = (c: PossessCommand) => { let m = byTick.get(c.tick); if (!m) byTick.set(c.tick, (m = new Map())); m.set(c.unit, c); };
  return {
    delay,
    push(c) { const s = { ...c, tick: c.tick + delay }; put(s); return s; },
    receive: put,
    take(tick) {
      const m = byTick.get(tick);
      // (Anything older than the tick asked for is late -- a lockstep peer would have waited for it; locally it's dropped.)
      for (const t of byTick.keys()) if (t < tick) byTick.delete(t);
      if (!m) return [];
      byTick.delete(tick);
      return [...m.values()].sort((a, b) => a.unit - b.unit);
    },
    get pending() { return [...byTick.keys()].sort((a, b) => a - b).flatMap((t) => [...byTick.get(t)!.values()].sort((a, b) => a.unit - b.unit)); },
  };
}

// ---------------------------------------------------------------- the simulation's side

/** A possessed unit's state, as the simulation holds it (plain numbers: save and restore by copying). */
export interface Driven {
  x: number;
  z: number;
  yaw: number;
  /** Its speed this tick (m/s): the animation reads it (idle, walk, run). */
  speed: number;
  /** The action under way (0 none, else an ACT bit) and how far into it (s). */
  action: number;
  actionT: number;
  /** Distance walked (the gait's phase runs on it). */
  dist: number;
}

export interface DriveRules {
  /** m/s walking, running (ACT.run). */
  readonly walk: number;
  readonly run: number;
  /** rad/s it turns toward its facing. */
  readonly turn: number;
  /** Seconds an action takes (by bit; default 0.62 for attack, 0.9 for use). */
  readonly actionTime?: Readonly<Record<number, number>>;
  /** Where a step from (x, z) toward (nx, nz) ends (the ground's rules: cliffs, water, buildings). Default: anywhere. */
  readonly move?: (x: number, z: number, nx: number, nz: number) => readonly [number, number];
}

export const newDriven = (x: number, z: number, yaw: number): Driven => ({ x, z, yaw, speed: 0, action: 0, actionT: 0, dist: 0 });

/**
 * One tick of a possessed unit under a command (null: no command this tick -- it stands, finishing any action). Pure:
 * the same state and command give the same next state. Movement stops while an attack is under way (it's planted).
 */
export function stepPossessed(d: Driven, c: PossessCommand | null, dt: number, rules: DriveRules): Driven {
  const times = rules.actionTime ?? { [ACT.attack]: 0.62, [ACT.use]: 0.9 };
  // Actions: one at a time, started on the tick the bit arrives.
  if (d.action) { d.actionT += dt; if (d.actionT >= (times[d.action] ?? 0.6)) { d.action = 0; d.actionT = 0; } }
  if (!d.action && c && c.act & (ACT.attack | ACT.use)) { d.action = c.act & ACT.attack ? ACT.attack : ACT.use; d.actionT = 0; }
  if (!c) { d.speed = 0; return d; }
  // Facing: turn toward the command's yaw at most `turn` a second.
  const want = faceOf(c);
  let dy = want - d.yaw;
  dy -= Math.round(dy / TAU) * TAU;
  const most = rules.turn * dt;
  d.yaw += dy > most ? most : dy < -most ? -most : dy;
  d.yaw -= Math.round(d.yaw / TAU) * TAU;
  // Moving (not during an attack).
  const [mx, mz] = moveOf(c);
  const k = Math.hypot(mx, mz);
  const planted = d.action === ACT.attack;
  const v = planted || k < 1e-3 ? 0 : (c.act & ACT.run ? rules.run : rules.walk) * k;
  if (v > 0) {
    const nx = d.x + (mx / k) * v * dt, nz = d.z + (mz / k) * v * dt;
    const [x, z] = rules.move ? rules.move(d.x, d.z, nx, nz) : [nx, nz];
    const moved = Math.hypot(x - d.x, z - d.z);
    d.dist += moved;
    d.speed = moved / dt;
    d.x = x; d.z = z;
  } else d.speed = 0;
  return d;
}
