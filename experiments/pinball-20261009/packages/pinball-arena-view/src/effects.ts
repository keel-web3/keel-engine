import type { ArenaBallFrame } from "@keel-engine/pinball-arena";

export interface ArenaPulseCue {
  readonly id: string; readonly arenaId: string; readonly x: number; readonly y: number;
  readonly elevation: number; readonly radius: number; readonly ownerId: number; readonly born: number;
}

/** All native bodies and blades remain at their true positions and dimensions.
 * Distance changes only presentation detail/contrast and event-effect weight. */
export function arenaActivityWeight(ownerId:number,body:Pick<ArenaBallFrame,"arenaId"|"x"|"y"|"elevation">|undefined,activity:{readonly ownerId:number|null;readonly arenaId:string;readonly x:number;readonly y:number;readonly elevation:number}):1|.65|.30 {
  if(activity.ownerId===ownerId)return 1;
  if(!body||activity.arenaId!==body.arenaId)return .30;
  const distance=Math.hypot(activity.x-body.x,activity.y-body.y,(activity.elevation-body.elevation)*2);
  return distance<=480?1:distance<=1100?.65:.30;
}

/** A shared burst cannot evict the owned attack feedback in favor of far owners. */
export function prioritizeArenaPulseCues(cues: Iterable<ArenaPulseCue>, ownerId: number, body: Pick<ArenaBallFrame, "arenaId" | "x" | "y"> | undefined, capacity: number): readonly ArenaPulseCue[] {
  const priority = (cue: ArenaPulseCue): number => cue.ownerId === ownerId ? -1 : !body || cue.arenaId !== body.arenaId ? 1e12 : Math.hypot(cue.x - body.x, cue.y - body.y);
  return [...cues].sort((a, b) => priority(a) - priority(b) || b.born - a.born || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, capacity);
}

/** Cosmetic arcade rhythm derives only from stable identity and render time;
 * culling, draw order, replay frame arrival and geometry style do not reseed it. */
export function arenaLampSignal(seed: string, instanceId: string, timeMs: number, reducedMotion = false): number {
  if (reducedMotion) return .82;
  let hash = 2166136261;
  for (const c of `${seed}/${instanceId}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const n = hash >>> 0, phase = (n % 4096) / 4096 * Math.PI * 2, seconds = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0) / 1000;
  const wave = (Math.sin(seconds * (.65 + n % 7 * .09) * Math.PI * 2 + phase) + 1) * .5;
  const shimmer = (Math.sin(seconds * 4.3 + phase * 1.7) + 1) * .5;
  return .18 + wave * .68 + shimmer * .14;
}
