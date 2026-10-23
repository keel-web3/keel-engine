import type {ActuatorEffect,ColliderMutation,CompiledProgression,DropBankState,GateState,PendingEffect} from './types.ts';
import {clone,ensure} from './validation.ts';
export interface ActuatorState {gates:GateState[];dropBanks:DropBankState[]}
/** Pure native adapter: a down target is collision-disabled, an open gate too. */
export function adaptActuatorEffects(compiled:CompiledProgression,current:ActuatorState,effects:readonly PendingEffect[],initialize=false):{state:ActuatorState;mutations:readonly ColliderMutation[]}{
 const state=clone(current),writes=new Map<string,{enabled:boolean;mechanismId:string;causeEffectIds:string[]}>();
 // One compiled graph owns each actuator. Its ordered effect serials resolve
 // to one final native write, so hit-then-drain can reset without a transient
 // close/drop inside the same admitted boundary. Cause IDs retain both effects.
 const write=(colliderId:string,enabled:boolean,mechanismId:string,cause:string)=>{const old=writes.get(colliderId);if(old){old.enabled=enabled;if(!old.causeEffectIds.includes(cause))old.causeEffectIds.push(cause);}else writes.set(colliderId,{enabled,mechanismId,causeEffectIds:[cause]});};
 ensure(effects.every((e,i)=>i===0||effects[i-1]!.serial<e.serial),'actuator effect serial order');
 const apply=(effect:ActuatorEffect,id:string)=>{
  if(effect.type==='gate'){const spec=compiled.definition.gates.find(g=>g.id===effect.gateId)!;const at=state.gates.findIndex(g=>g.id===spec.id);ensure(at>=0,'gate state missing');state.gates[at]={id:spec.id,open:effect.open};write(spec.colliderId,!effect.open,spec.id,id);}
  else {const spec=compiled.definition.dropBanks.find(b=>b.id===effect.bankId)!,at=state.dropBanks.findIndex(b=>b.id===spec.id);ensure(at>=0,'bank state missing');if(effect.type==='reset-bank'){state.dropBanks[at]={id:spec.id,down:[]};for(const targetId of spec.targetIds)write(targetId,true,spec.id,id);}else{const down=new Set(state.dropBanks[at]!.down);down.add(effect.targetId);state.dropBanks[at]={id:spec.id,down:[...down].sort()};write(effect.targetId,false,spec.id,id);}}
 };
 if(initialize){for(const spec of compiled.definition.gates)write(spec.colliderId,!state.gates.find(g=>g.id===spec.id)!.open,spec.id,`init:${spec.id}`);for(const spec of compiled.definition.dropBanks){const down=state.dropBanks.find(b=>b.id===spec.id)!.down;for(const id of spec.targetIds)write(id,!down.includes(id),spec.id,`init:${spec.id}`);}}
 for(const pending of effects)apply(pending.effect,pending.id);
 return {state,mutations:[...writes].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([colliderId,v])=>({colliderId,...v}))};
}
