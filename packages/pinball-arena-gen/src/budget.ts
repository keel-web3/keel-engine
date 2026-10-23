import {ARENA_CONTENT_LIMITS,ARENA_AUTHORITY_REVISION} from '@keel-engine/pinball-arena';
import type {ArenaField,ArenaWorldDefinition,ArenaPlayer} from '@keel-engine/pinball-arena';

export const PINBALL_BUDGET_REVISION='pinball-global-budget/2026-10-07.2';
const resources=['players','bodies','colliders','flippers','ramps','captures','mechanisms','arenas'] as const;
export type PinballBudgetResource=typeof resources[number];
export type PinballBudgetCounts=Readonly<Record<PinballBudgetResource,number>>;
export type PinballBudgetRequest=Partial<PinballBudgetCounts>;
export interface PinballBudgetIssue {readonly allocationId:string;readonly resource:PinballBudgetResource;readonly limit:number;readonly used:number;readonly requested:number;readonly proposed:number;readonly remaining:number}
export interface PinballBudgetCheckpoint {readonly ordinal:number}
const zero=():Record<PinballBudgetResource,number>=>({players:0,bodies:0,colliders:0,flippers:0,ramps:0,captures:0,mechanisms:0,arenas:0});
const counts=(request:PinballBudgetRequest):PinballBudgetCounts=>{
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!(resources as readonly string[]).includes(key)))throw new Error('Invalid pinball budget resource');
 const result=zero();for(const resource of resources){const n=request[resource]??0;if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid pinball budget count');result[resource]=n;}return Object.freeze(result);
};
const validId=(id:string)=>{if(typeof id!=='string'||id.length<1||id.length>120)throw new Error('Invalid pinball allocation ID');};
export class PinballBudgetError extends Error {
 readonly issues:readonly PinballBudgetIssue[];
 constructor(issues:readonly PinballBudgetIssue[]){super('Pinball global capacity exhausted: '+issues.map(issue=>`${issue.allocationId}:${issue.resource} ${issue.proposed}/${issue.limit}`).join(', '));this.name='PinballBudgetError';this.issues=Object.freeze(issues.map(issue=>Object.freeze({...issue})));}
}

/** Count the same collider categories admitted by the shared authority.
 * A field's mechanisms may be composed into an existing arena, so this helper
 * does not debit an additional arena or invent a private cabinet per owner. */
export function countPinballMechanisms(field:Pick<ArenaField,'rails'|'gates'|'bumpers'|'flippers'|'ramps'|'stations'|'switches'|'captures'>):PinballBudgetRequest{
 const captures=field.captures?.length??0;
 return Object.freeze({colliders:field.rails.length+field.gates.length+field.bumpers.length+field.flippers.length,flippers:field.flippers.length,ramps:field.ramps.length,captures,mechanisms:field.bumpers.length+field.stations.length+field.switches.length+field.gates.length+captures});
}

/** Additional bodies are a declared reservation, not a claim that the current
 * authority already implements multiball spawning. Count the whole world. */
export function countPinballWorld(world:ArenaWorldDefinition,players:readonly ArenaPlayer[],additionalBodies=0):PinballBudgetCounts{
 if(!Number.isSafeInteger(additionalBodies)||additionalBodies<0||additionalBodies>ARENA_CONTENT_LIMITS.bodies)throw new Error('Invalid additional pinball body reservation');
 const ownerIds=new Set<number>();for(const player of players){if(!Number.isInteger(player.ownerId)||player.ownerId<0||player.ownerId>=ARENA_CONTENT_LIMITS.players||ownerIds.has(player.ownerId))throw new Error('Invalid pinball budget roster');ownerIds.add(player.ownerId);}
 const result=zero();result.players=players.length;result.bodies=players.length+additionalBodies;result.arenas=world.arenas.length;
 for(const field of world.arenas){const measured=countPinballMechanisms(field);result.colliders+=measured.colliders!;result.flippers+=measured.flippers!;result.ramps+=measured.ramps!;result.captures+=measured.captures!;result.mechanisms+=measured.mechanisms!;}return Object.freeze(result);
}

/** One ledger for every arena, assembly and body in a generated world. Lower
 * target budgets are allowed; raising the frozen authority caps is rejected.
 * This is capacity accounting only. Geometry and legal-input admission remain
 * independent mandatory checks. */
export function createPinballBudget(target:PinballBudgetRequest={}){
 const limit=counts({...Object.fromEntries(resources.map(resource=>[resource,ARENA_CONTENT_LIMITS[resource]])),...target});
 for(const resource of resources)if(limit[resource]>ARENA_CONTENT_LIMITS[resource])throw new Error('Pinball target exceeds authority capacity');
 if(limit.bodies<limit.players)throw new Error('Pinball target cannot reserve an owned body per player');
 let allocations=new Map<string,PinballBudgetCounts>(),used=zero(),ordinal=0;
 const checkpoints=new Map<PinballBudgetCheckpoint,{allocations:Map<string,PinballBudgetCounts>;used:Record<PinballBudgetResource,number>}>();
 function proposed(id:string,request:PinballBudgetRequest,previous:PinballBudgetCounts=counts({})){
  validId(id);const next=counts(request),total=zero(),issues:PinballBudgetIssue[]=[];
  for(const resource of resources){total[resource]=used[resource]-previous[resource]+next[resource];if(!Number.isSafeInteger(total[resource])||total[resource]>limit[resource])issues.push({allocationId:id,resource,limit:limit[resource],used:used[resource]-previous[resource],requested:next[resource],proposed:total[resource],remaining:limit[resource]-(used[resource]-previous[resource])});}
  if(issues.length)throw new PinballBudgetError(issues);return {next,total};
 }
 function stats(){const remaining=zero();for(const resource of resources)remaining[resource]=limit[resource]-used[resource];return Object.freeze({revision:PINBALL_BUDGET_REVISION,authority:ARENA_AUTHORITY_REVISION,limits:limit,used:Object.freeze({...used}),remaining:Object.freeze(remaining),allocations:Object.freeze([...allocations].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,value])=>Object.freeze({id,counts:value})))});}
 return {
  reserve(id:string,request:PinballBudgetRequest){if(allocations.has(id))throw new Error('Duplicate pinball allocation ID');if(allocations.size>=4096)throw new Error('Pinball allocation record cap');const candidate=proposed(id,request);allocations.set(id,candidate.next);used=candidate.total;return candidate.next;},
  replace(id:string,request:PinballBudgetRequest){const previous=allocations.get(id);if(!previous)throw new Error('Missing pinball allocation ID');const candidate=proposed(id,request,previous);allocations.set(id,candidate.next);used=candidate.total;return candidate.next;},
  release(id:string){const previous=allocations.get(id);if(!previous)throw new Error('Missing pinball allocation ID');for(const resource of resources)used[resource]-=previous[resource];allocations.delete(id);},
  checkpoint():PinballBudgetCheckpoint{if(checkpoints.size>=64)throw new Error('Pinball checkpoint cap');const token=Object.freeze({ordinal:++ordinal});checkpoints.set(token,{allocations:new Map(allocations),used:{...used}});return token;},
  rollback(token:PinballBudgetCheckpoint){const saved=checkpoints.get(token);if(!saved)throw new Error('Foreign or consumed pinball checkpoint');allocations=new Map(saved.allocations);used={...saved.used};for(const checkpoint of checkpoints.keys())if(checkpoint.ordinal>=token.ordinal)checkpoints.delete(checkpoint);},
  forget(token:PinballBudgetCheckpoint){if(!checkpoints.delete(token))throw new Error('Foreign or consumed pinball checkpoint');},
  /** Detect an under-debit after composing the exact final descriptor. */
  assertCompiled(world:ArenaWorldDefinition,players:readonly ArenaPlayer[],additionalBodies=0){
   const measured=countPinballWorld(world,players,additionalBodies),issues:PinballBudgetIssue[]=[];
   for(const resource of resources)if(measured[resource]>used[resource])issues.push({allocationId:'compiled-world',resource,limit:used[resource],used:0,requested:measured[resource],proposed:measured[resource],remaining:used[resource]});
   if(issues.length)throw new PinballBudgetError(issues);return measured;
  },
  getStats:stats,
 };
}
