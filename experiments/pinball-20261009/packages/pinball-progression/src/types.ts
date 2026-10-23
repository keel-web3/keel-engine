export const PROGRESSION_SCHEMA='keel-pinball-progression@1';
export const PROGRESSION_REVISION='ordered-mechanisms/2026-10-08.1';
export const PROGRESSION_LIMITS=Object.freeze({owners:100,bodies:128,graphs:32,nodesPerGraph:64,totalNodes:256,contacts:128,gates:128,dropBanks:64,targets:256,observationsPerTick:4096,pendingEffects:4096,dedupe:4096,snapshotBytes:4000000,tick:432000});
/** Phases describe exported authority order, not unexported native substeps. */
export const ObservationPhase=Object.freeze({NATIVE:0,SENSOR:1,CAPTURE:2,SEPARATION:3});
export interface ObservationCursor {readonly tick:number;readonly phase:0|1|2|3;readonly nativeOrdinal:number|null;readonly serial:number}
export interface SourceShot {readonly cursor:ObservationCursor;readonly bodyId:string;readonly ownerId:number;readonly flipperId:string}
export interface ContactObservation {readonly id:string;readonly type:'contact';readonly cursor:ObservationCursor;readonly bodyId:string;readonly ownerId:number;readonly colliderId:string;readonly contactType:'rail'|'bumper'|'flipper';readonly shot:SourceShot|null}
/** Only the authority may produce this after proving full separation. */
export interface SeparationObservation {readonly id:string;readonly type:'separation';readonly cursor:ObservationCursor;readonly bodyId:string;readonly ownerId:number;readonly contactBindingId:string}
export interface DrainObservation {readonly id:string;readonly type:'drain';readonly cursor:ObservationCursor;readonly bodyId:string;readonly ownerId:number}
export type ProgressionObservation=ContactObservation|SeparationObservation|DrainObservation;
export interface ContactBinding {readonly id:string;readonly colliderIds:readonly string[];readonly eventTypes:readonly ('rail'|'bumper'|'flipper')[];readonly sourceFlipperIds:readonly string[];readonly requiresShot:boolean;readonly requireFreshShot:boolean;readonly maxShotAgeTicks:number}
export interface GateDefinition {readonly id:string;readonly colliderId:string;readonly initiallyOpen:boolean}
/** Targets name native rail IDs with explicit target role, never passive returns implicitly. */
export interface DropBankDefinition {readonly id:string;readonly targetIds:readonly string[];readonly initiallyDown:readonly string[]}
export type ActuatorEffect={readonly type:'gate';readonly gateId:string;readonly open:boolean}|{readonly type:'drop-target';readonly bankId:string;readonly targetId:string}|{readonly type:'reset-bank';readonly bankId:string};
export interface ProgressionNode {readonly id:string;readonly contactBindingId:string;readonly nextNodeId:string|null;readonly effects:readonly ActuatorEffect[];readonly timeoutTicks:number|null}
export interface ProgressionGraph {readonly id:string;readonly scope:'owner'|'team'|'world';readonly initialNodeId:string;readonly nodes:readonly ProgressionNode[];readonly resetOnDrain:boolean;readonly resetEffects:readonly ActuatorEffect[]}
export interface ProgressionDefinition {readonly schema:typeof PROGRESSION_SCHEMA;readonly revision:string;readonly contacts:readonly ContactBinding[];readonly gates:readonly GateDefinition[];readonly dropBanks:readonly DropBankDefinition[];readonly graphs:readonly ProgressionGraph[]}
export interface ColliderBinding {readonly id:string;readonly arenaId:string;readonly kind:'rail'|'bumper'|'flipper'|'gate';readonly target:boolean}
export interface ProgressionCatalog {readonly worldDigest:string;readonly colliders:readonly ColliderBinding[]}
export interface ProgressionOwner {readonly ownerId:number;readonly teamId:number}
export interface ProgressionBody {readonly id:string;readonly ownerId:number}
export interface ProgressionRoster {readonly owners:readonly ProgressionOwner[];readonly bodies:readonly ProgressionBody[]}
export interface CompiledProgression {readonly schema:'keel-pinball-progression-compiled@1';readonly revision:typeof PROGRESSION_REVISION;readonly graphDigest:string;readonly identity:string;readonly definition:ProgressionDefinition;readonly catalog:ProgressionCatalog;readonly roster:ProgressionRoster}
export interface GraphState {readonly graphId:string;readonly actorId:number;readonly nodeId:string|null;readonly entered:ObservationCursor;readonly transitionCount:number}
export interface RearmState {readonly bodyId:string;readonly contactBindingId:string;readonly armed:boolean;readonly lastContact:ObservationCursor|null}
export interface GateState {readonly id:string;readonly open:boolean}
export interface DropBankState {readonly id:string;readonly down:readonly string[]}
export interface PendingEffect {readonly id:string;readonly serial:number;readonly graphId:string;readonly actorId:number;readonly source:ObservationCursor;readonly applyTick:number;readonly effect:ActuatorEffect}
export interface ProgressionTransition {readonly graphId:string;readonly actorId:number;readonly fromNodeId:string|null;readonly toNodeId:string|null;readonly cause:'contact'|'drain'|'timeout';readonly source:ObservationCursor}
export interface ProgressionFrame {readonly schema:'keel-pinball-progression-frame@1';readonly identity:string;readonly tick:number;readonly actuatorTick:number;readonly initialized:boolean;readonly graphs:readonly GraphState[];readonly rearm:readonly RearmState[];readonly gates:readonly GateState[];readonly dropBanks:readonly DropBankState[];readonly pendingEffects:readonly PendingEffect[];readonly transitions:readonly ProgressionTransition[]}
export interface ColliderMutation {readonly colliderId:string;readonly enabled:boolean;readonly mechanismId:string;readonly causeEffectIds:readonly string[]}
/** Opaque controller-owned plan. Native authority must atomically apply these first. */
export interface PreparedActuatorTick {readonly identity:string;readonly tick:number;readonly mutations:readonly ColliderMutation[];readonly effectIds:readonly string[]}
export interface ProgressionController {readonly compiled:CompiledProgression;readFrame():ProgressionFrame;observeTick(tick:number,observations:readonly ProgressionObservation[]):ProgressionFrame;prepareActuatorTick(tick:number):PreparedActuatorTick;commitActuatorTick(plan:PreparedActuatorTick):ProgressionFrame;snapshot():Uint8Array;restore(bytes:Uint8Array):void}
