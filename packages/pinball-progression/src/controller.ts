import {compileProgression,validateActuatorEffect} from './compiler.ts';
import {adaptActuatorEffects} from './adapters.ts';
import {ObservationPhase,PROGRESSION_REVISION,PROGRESSION_LIMITS as L,type CompiledProgression,type ContactBinding,type GraphState,type ObservationCursor,type PendingEffect,type PreparedActuatorTick,type ProgressionController,type ProgressionFrame,type ProgressionGraph,type ProgressionObservation,type ProgressionTransition,type RearmState,type SourceShot,type GateState,type DropBankState,type ActuatorEffect} from './types.ts';
import {array,clone,compareObservationCursors as compare,cursor,digest,endCursor,ensure,frozen,hashId,integer,record,textId} from './validation.ts';
interface SeenObservation {id:string;hash:string;cursor:ObservationCursor}
interface State {tick:number;actuatorTick:number;initialized:boolean;effectSerial:number;graphs:GraphState[];rearm:RearmState[];gates:GateState[];dropBanks:DropBankState[];pendingEffects:PendingEffect[];seen:SeenObservation[];transitions:ProgressionTransition[]}
const graphKey=(s:{graphId:string;actorId:number})=>`${s.graphId}/${s.actorId}`;
const rearmKey=(s:{bodyId:string;contactBindingId:string})=>`${s.bodyId}/${s.contactBindingId}`;
const sortKey=(a:string,b:string)=>a<b?-1:a>b?1:0;

export function createProgressionController(source:CompiledProgression):ProgressionController{
 const compiled=compileProgression(source.definition,source.catalog,source.roster);
 ensure(source.schema===compiled.schema&&source.revision===compiled.revision&&source.identity===compiled.identity&&source.graphDigest===compiled.graphDigest,'compiled identity');
 const graphById=new Map(compiled.definition.graphs.map(g=>[g.id,g])),contactById=new Map(compiled.definition.contacts.map(c=>[c.id,c])),bodyById=new Map(compiled.roster.bodies.map(b=>[b.id,b])),ownerById=new Map(compiled.roster.owners.map(o=>[o.ownerId,o])),colliderById=new Map(compiled.catalog.colliders.map(c=>[c.id,c]));
 const contactByCollider=new Map(compiled.definition.contacts.flatMap(c=>c.colliderIds.map(id=>[id,c] as const)));
 const contactGraph=new Map(compiled.definition.graphs.flatMap(g=>g.nodes.map(n=>[n.contactBindingId,g] as const)));
 const actors=(g:ProgressionGraph)=>g.scope==='world'?[-1]:g.scope==='owner'?compiled.roster.owners.map(o=>o.ownerId):[...new Set(compiled.roster.owners.map(o=>o.teamId))].sort((a,b)=>a-b);
 const actor=(g:ProgressionGraph,ownerId:number)=>g.scope==='world'?-1:g.scope==='owner'?ownerId:ownerById.get(ownerId)!.teamId;
 const initialGraphs:GraphState[]=compiled.definition.graphs.flatMap(g=>actors(g).map(actorId=>({graphId:g.id,actorId,nodeId:g.initialNodeId,entered:endCursor(0),transitionCount:0})));
 let state:State={tick:0,actuatorTick:0,initialized:false,effectSerial:0,graphs:clone(initialGraphs),rearm:[],gates:compiled.definition.gates.map(g=>({id:g.id,open:g.initiallyOpen})),dropBanks:compiled.definition.dropBanks.map(b=>({id:b.id,down:[...b.initiallyDown]})),pendingEffects:[],seen:[],transitions:[]};
 let version=0;
 const prepared=new WeakMap<PreparedActuatorTick,{version:number;candidate:State}>();
 const frame=():ProgressionFrame=>frozen(clone({schema:'keel-pinball-progression-frame@1' as const,identity:compiled.identity,tick:state.tick,actuatorTick:state.actuatorTick,initialized:state.initialized,graphs:state.graphs,rearm:state.rearm,gates:state.gates,dropBanks:state.dropBanks,pendingEffects:state.pendingEffects,transitions:state.transitions}));
 const stateFits=(s:State)=>ensure(new TextEncoder().encode(JSON.stringify(s)).byteLength<=L.snapshotBytes-1024,'state snapshot byte capacity');
 const queue=(s:State,g:ProgressionGraph,actorId:number,source:ObservationCursor,effects:readonly ActuatorEffect[])=>{for(const effect of effects){ensure(s.effectSerial<2147483647&&s.pendingEffects.length<L.pendingEffects,'effect capacity');const serial=++s.effectSerial;s.pendingEffects.push({id:`prog:${compiled.identity.slice(0,16)}:${serial}`,serial,graphId:g.id,actorId,source:clone(source),applyTick:source.tick+1,effect:clone(effect)});}};
 const transition=(s:State,index:number,toNodeId:string|null,cause:ProgressionTransition['cause'],source:ObservationCursor,effects:readonly ActuatorEffect[])=>{const before=s.graphs[index]!,g=graphById.get(before.graphId)!;ensure(before.transitionCount<2147483647,'transition capacity');s.graphs[index]={...before,nodeId:toNodeId,entered:clone(source),transitionCount:before.transitionCount+1};s.transitions.push({graphId:g.id,actorId:before.actorId,fromNodeId:before.nodeId,toNodeId,cause,source:clone(source)});queue(s,g,before.actorId,source,effects);};

 function validateObservation(v:unknown,tick:number):ProgressionObservation{
  ensure(v!==null&&typeof v==='object'&&!Array.isArray(v),'observation');const type=(v as {type?:unknown}).type;
  ensure(['contact','separation','drain'].includes(type as string),'observation type');
  const extra=type==='contact'?['colliderId','contactType','shot']:type==='separation'?['contactBindingId']:[];
  const r=record(v,['id','type','cursor','bodyId','ownerId',...extra],'observation');
  ensure(textId(r.id)&&textId(r.bodyId)&&integer(r.ownerId,0,99)&&bodyById.get(r.bodyId)?.ownerId===r.ownerId,'observation body/owner');const c=cursor(r.cursor);ensure(c.tick===tick,'observation tick');
  if(type==='separation'){ensure(c.phase===ObservationPhase.SEPARATION&&textId(r.contactBindingId)&&contactById.has(r.contactBindingId),'separation phase/binding');return {id:r.id,type,cursor:c,bodyId:r.bodyId,ownerId:r.ownerId,contactBindingId:r.contactBindingId};}
  if(type==='drain'){ensure(c.phase===ObservationPhase.SENSOR||c.phase===ObservationPhase.CAPTURE,'drain phase');return {id:r.id,type,cursor:c,bodyId:r.bodyId,ownerId:r.ownerId};}
  ensure(c.phase===ObservationPhase.NATIVE&&textId(r.colliderId)&&['rail','bumper','flipper'].includes(r.contactType as string),'contact phase/type');
  const collider=colliderById.get(r.colliderId);ensure(collider&&(collider.kind==='gate'?'rail':collider.kind)===r.contactType,'contact collider');
  let shot:SourceShot|null=null;
  if(r.shot!==null){const p=record(r.shot,['cursor','bodyId','ownerId','flipperId'],'shot'),sc=cursor(p.cursor);ensure(sc.phase===ObservationPhase.NATIVE&&p.bodyId===r.bodyId&&p.ownerId===r.ownerId&&textId(p.flipperId)&&colliderById.get(p.flipperId)?.kind==='flipper'&&compare(sc,c)<=0,'shot credential identity/order');shot={cursor:sc,bodyId:r.bodyId,ownerId:r.ownerId,flipperId:p.flipperId};}
  return {id:r.id,type:'contact',cursor:c,bodyId:r.bodyId,ownerId:r.ownerId,colliderId:r.colliderId,contactType:r.contactType as 'rail'|'bumper'|'flipper',shot};
 }
 function admittedShot(binding:ContactBinding,observation:Extract<ProgressionObservation,{type:'contact'}>,entered:ObservationCursor):boolean{
  if(!binding.requiresShot)return true;const shot=observation.shot;
  return !!shot&&binding.sourceFlipperIds.includes(shot.flipperId)&&observation.cursor.tick-shot.cursor.tick<=binding.maxShotAgeTicks&&(!binding.requireFreshShot||compare(shot.cursor,entered)>0);
 }

 function observeTick(tick:number,input:readonly ProgressionObservation[]):ProgressionFrame{
  ensure(integer(tick,1,L.tick)&&state.initialized&&tick===state.tick+1&&state.actuatorTick===tick,'observe lifecycle');
  const observations=array(input,L.observationsPerTick,'observations').map(v=>validateObservation(v,tick));
  for(let i=1;i<observations.length;i++)ensure(compare(observations[i-1]!.cursor,observations[i]!.cursor)<=0,'observations not in numeric causal order');
  const next=clone(state);next.transitions=[];
  // An exclusive deadline rejects that tick's old contact and rearms the graph
  // only after its end boundary. It never fabricates a native event.
  for(let i=0;i<next.graphs.length;i++){const s=next.graphs[i]!,g=graphById.get(s.graphId)!,n=g.nodes.find(n=>n.id===s.nodeId);if(n?.timeoutTicks!==null&&n?.timeoutTicks!==undefined&&tick-s.entered.tick>=n.timeoutTicks)transition(next,i,g.initialNodeId,'timeout',endCursor(tick),g.resetEffects);}
  const seen=new Map(next.seen.map(v=>[v.id,v])),cursorIds=new Map<string,string>(),rearm=new Map(next.rearm.map(v=>[rearmKey(v),v]));
  for(const observation of observations){
   const observationHash=digest(observation),old=seen.get(observation.id),at=JSON.stringify(observation.cursor),priorId=cursorIds.get(at);
   ensure(priorId===undefined||priorId===observation.id,'cursor reused by distinct observations');cursorIds.set(at,observation.id);
   if(old){ensure(old.hash===observationHash,'conflicting duplicate observation');continue;}
   const receipt={id:observation.id,hash:observationHash,cursor:clone(observation.cursor)};next.seen.push(receipt);seen.set(receipt.id,receipt);if(next.seen.length>L.dedupe){const removed=next.seen.shift()!;seen.delete(removed.id);}
   if(observation.type==='separation'){const key=rearmKey(observation),previous=rearm.get(key);if(previous){ensure(previous.lastContact!==null&&compare(observation.cursor,previous.lastContact)>0,'separation before contact');rearm.set(key,{...previous,armed:true});}continue;}
   if(observation.type==='drain'){for(let i=0;i<next.graphs.length;i++){const s=next.graphs[i]!,g=graphById.get(s.graphId)!;if(g.resetOnDrain&&s.actorId===actor(g,observation.ownerId))transition(next,i,g.initialNodeId,'drain',observation.cursor,g.resetEffects);}continue;}
   ensure(!next.dropBanks.some(b=>b.down.includes(observation.colliderId))&&!compiled.definition.gates.some(g=>g.colliderId===observation.colliderId&&next.gates.find(s=>s.id===g.id)!.open),'contact on disabled controlled collider');
   const binding=contactByCollider.get(observation.colliderId);if(!binding)continue;
   const key=rearmKey({bodyId:observation.bodyId,contactBindingId:binding.id}),previous=rearm.get(key),armed=previous?.armed??true;
   rearm.set(key,{bodyId:observation.bodyId,contactBindingId:binding.id,armed:false,lastContact:clone(observation.cursor)});
   if(!armed||!binding.eventTypes.includes(observation.contactType))continue;
   const g=contactGraph.get(binding.id)!,index=next.graphs.findIndex(s=>s.graphId===g.id&&s.actorId===actor(g,observation.ownerId)),s=next.graphs[index]!,node=g.nodes.find(n=>n.id===s.nodeId);
   if(!node||node.contactBindingId!==binding.id||compare(observation.cursor,s.entered)<=0||!admittedShot(binding,observation,s.entered))continue;
   transition(next,index,node.nextNodeId,'contact',observation.cursor,node.effects);
  }
  next.rearm=[...rearm.values()].sort((a,b)=>sortKey(rearmKey(a),rearmKey(b)));next.transitions.sort((a,b)=>compare(a.source,b.source)||sortKey(graphKey(a),graphKey(b)));
  // Timeout resets use an end boundary. Number effects in that same numeric
  // order even though expired nodes were blocked before scanning contacts.
  next.pendingEffects=next.pendingEffects.sort((a,b)=>compare(a.source,b.source)||sortKey(graphKey(a),graphKey(b))||a.serial-b.serial).map((effect,i)=>{const serial=state.effectSerial+i+1;return {...effect,id:`prog:${compiled.identity.slice(0,16)}:${serial}`,serial};});
  next.tick=tick;stateFits(next);state=next;version++;return frame();
 }

 function prepareActuatorTick(tick:number):PreparedActuatorTick{
  ensure(integer(tick,1,L.tick)&&tick===state.tick+1&&state.actuatorTick===state.tick,'actuator lifecycle');
  ensure(state.pendingEffects.every(e=>e.applyTick===tick),'missed or future effect boundary');
  const result=adaptActuatorEffects(compiled,state,state.pendingEffects,!state.initialized),next=clone(state);next.gates=result.state.gates;next.dropBanks=result.state.dropBanks;next.pendingEffects=[];next.initialized=true;next.actuatorTick=tick;stateFits(next);
  const plan=frozen({identity:compiled.identity,tick,mutations:clone(result.mutations),effectIds:state.pendingEffects.map(e=>e.id)});prepared.set(plan,{version,candidate:next});return plan;
 }
 function commitActuatorTick(plan:PreparedActuatorTick):ProgressionFrame{
  const entry=prepared.get(plan);ensure(entry&&entry.version===version&&plan.identity===compiled.identity&&plan.tick===state.tick+1&&state.actuatorTick===state.tick,'stale or foreign actuator plan');
  // Caller must already have atomically accepted/applied the entire native batch.
  state=entry.candidate;prepared.delete(plan);version++;return frame();
 }

 function snapshot():Uint8Array {const payload=clone(state),bytes=new TextEncoder().encode(JSON.stringify({schema:'keel-pinball-progression-snapshot@1',revision:PROGRESSION_REVISION,identity:compiled.identity,graphDigest:compiled.graphDigest,worldDigest:compiled.catalog.worldDigest,payload,checksum:digest(payload)}));ensure(bytes.byteLength<=L.snapshotBytes,'snapshot bytes');return bytes;}
 function restore(bytes:Uint8Array):void{
  ensure(bytes instanceof Uint8Array&&bytes.byteLength<=L.snapshotBytes,'snapshot bytes');
  const header=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),['schema','revision','identity','graphDigest','worldDigest','payload','checksum'],'snapshot');
  ensure(header.schema==='keel-pinball-progression-snapshot@1'&&header.revision===PROGRESSION_REVISION&&header.identity===compiled.identity&&header.graphDigest===compiled.graphDigest&&header.worldDigest===compiled.catalog.worldDigest&&hashId(header.checksum)&&digest(header.payload)===header.checksum,'snapshot identity/checksum');
  const p=record(header.payload,['tick','actuatorTick','initialized','effectSerial','graphs','rearm','gates','dropBanks','pendingEffects','seen','transitions'],'snapshot payload');
  ensure(integer(p.tick,0,L.tick)&&integer(p.actuatorTick,p.tick,Math.min(L.tick,p.tick+1))&&typeof p.initialized==='boolean'&&integer(p.effectSerial,0,2147483647)&&(p.initialized?p.actuatorTick>0:p.tick===0&&p.actuatorTick===0),'snapshot clocks');
  const restoredTick=p.tick,restoredActuatorTick=p.actuatorTick,restoredInitialized=p.initialized,restoredSerial=p.effectSerial;
  const graphStates:GraphState[]=array(p.graphs,initialGraphs.length,'graph states').map(v=>{const r=record(v,['graphId','actorId','nodeId','entered','transitionCount'],'graph state');ensure(textId(r.graphId)&&integer(r.actorId,-1,99)&&integer(r.transitionCount,0,2147483647),'graph state fields');const g=graphById.get(r.graphId);ensure(g&&actors(g).includes(r.actorId)&&(r.nodeId===null?g.nodes.some(n=>n.nextNodeId===null):textId(r.nodeId)&&g.nodes.some(n=>n.id===r.nodeId)),'graph state binding');const entered=cursor(r.entered);ensure(entered.tick<=restoredTick&&(!(r.transitionCount===0)||r.nodeId===g.initialNodeId&&compare(entered,endCursor(0))===0),'graph entry');return {graphId:r.graphId,actorId:r.actorId,nodeId:r.nodeId as string|null,entered,transitionCount:r.transitionCount};});
  ensure(graphStates.length===initialGraphs.length&&new Set(graphStates.map(graphKey)).size===initialGraphs.length,'graph state membership');
  const rearmStates:RearmState[]=array(p.rearm,L.bodies*L.contacts,'rearm states').map(v=>{const r=record(v,['bodyId','contactBindingId','armed','lastContact'],'rearm state');ensure(textId(r.bodyId)&&bodyById.has(r.bodyId)&&textId(r.contactBindingId)&&contactById.has(r.contactBindingId)&&typeof r.armed==='boolean','rearm binding');const lastContact=cursor(r.lastContact);ensure(lastContact.phase===ObservationPhase.NATIVE&&lastContact.tick>=1&&lastContact.tick<=restoredTick,'rearm clock');return {bodyId:r.bodyId,contactBindingId:r.contactBindingId,armed:r.armed,lastContact};});ensure(new Set(rearmStates.map(rearmKey)).size===rearmStates.length,'duplicate rearm');
  const gates:GateState[]=array(p.gates,compiled.definition.gates.length,'gate states').map(v=>{const r=record(v,['id','open'],'gate state');ensure(textId(r.id)&&compiled.definition.gates.some(g=>g.id===r.id)&&typeof r.open==='boolean','gate state binding');return {id:r.id,open:r.open};});ensure(gates.length===compiled.definition.gates.length&&new Set(gates.map(g=>g.id)).size===gates.length,'gate state membership');
  const dropBanks:DropBankState[]=array(p.dropBanks,compiled.definition.dropBanks.length,'bank states').map(v=>{const r=record(v,['id','down'],'bank state');ensure(textId(r.id),'bank state id');const spec=compiled.definition.dropBanks.find(b=>b.id===r.id);ensure(spec,'bank state binding');const down=array(r.down,spec.targetIds.length,'down mask');ensure(down.every(id=>typeof id==='string'&&spec.targetIds.includes(id))&&new Set(down).size===down.length,'down mask');return {id:r.id,down:[...down] as string[]};});ensure(dropBanks.length===compiled.definition.dropBanks.length&&new Set(dropBanks.map(b=>b.id)).size===dropBanks.length,'bank state membership');
  const seenObservations:SeenObservation[]=array(p.seen,L.dedupe,'seen observations').map(v=>{const r=record(v,['id','hash','cursor'],'seen observation');ensure(textId(r.id)&&hashId(r.hash),'seen id/hash');const c=cursor(r.cursor);ensure(c.tick>=1&&c.tick<=restoredTick,'seen clock');return {id:r.id,hash:r.hash,cursor:c};});ensure(new Set(seenObservations.map(s=>s.id)).size===seenObservations.length,'duplicate seen id');for(let i=1;i<seenObservations.length;i++)ensure(compare(seenObservations[i-1]!.cursor,seenObservations[i]!.cursor)<0,'seen cursor order');
  const transitions:ProgressionTransition[]=array(p.transitions,L.observationsPerTick+initialGraphs.length,'transitions').map(v=>{const r=record(v,['graphId','actorId','fromNodeId','toNodeId','cause','source'],'transition');ensure(textId(r.graphId)&&integer(r.actorId,-1,99)&&['contact','drain','timeout'].includes(r.cause as string),'transition fields');const g=graphById.get(r.graphId);ensure(g&&actors(g).includes(r.actorId),'transition graph');const from=g.nodes.find(n=>n.id===r.fromNodeId),c=cursor(r.source);ensure(c.tick===restoredTick&&(r.cause==='contact'?!!from&&r.toNodeId===from.nextNodeId&&c.phase===ObservationPhase.NATIVE&&seenObservations.some(s=>compare(s.cursor,c)===0):r.toNodeId===g.initialNodeId&&(r.cause==='drain'?g.resetOnDrain&&(c.phase===ObservationPhase.SENSOR||c.phase===ObservationPhase.CAPTURE):!!from&&from.timeoutTicks!==null&&compare(c,endCursor(restoredTick))===0)),'transition boundary');ensure(r.fromNodeId===null?g.nodes.some(n=>n.nextNodeId===null):!!from,'transition source node');return {graphId:r.graphId,actorId:r.actorId,fromNodeId:r.fromNodeId as string|null,toNodeId:r.toNodeId as string|null,cause:r.cause as ProgressionTransition['cause'],source:c};});
  const pendingEffects:PendingEffect[]=array(p.pendingEffects,L.pendingEffects,'pending effects').map(v=>{const r=record(v,['id','serial','graphId','actorId','source','applyTick','effect'],'pending effect');ensure(integer(r.serial,1,restoredSerial)&&r.id===`prog:${compiled.identity.slice(0,16)}:${r.serial}`&&textId(r.graphId)&&integer(r.actorId,-1,99)&&r.applyTick===restoredTick+1,'effect identity/clock');const g=graphById.get(r.graphId),c=cursor(r.source);ensure(g&&actors(g).includes(r.actorId)&&c.tick===restoredTick,'effect source');return {id:r.id as string,serial:r.serial,graphId:r.graphId,actorId:r.actorId,source:c,applyTick:r.applyTick as number,effect:validateActuatorEffect(r.effect,compiled.definition.gates,compiled.definition.dropBanks)};});
  ensure(new Set(pendingEffects.map(e=>e.id)).size===pendingEffects.length&&pendingEffects.every((e,i)=>i===0||pendingEffects[i-1]!.serial<e.serial),'pending effect order');
  const expected=transitions.flatMap(t=>{const g=graphById.get(t.graphId)!;const effects=t.cause==='contact'?g.nodes.find(n=>n.id===t.fromNodeId)!.effects:g.resetEffects;return effects.map(effect=>({graphId:t.graphId,actorId:t.actorId,source:t.source,effect}));});
  if(restoredActuatorTick===restoredTick)ensure(expected.length===pendingEffects.length&&expected.every(e=>pendingEffects.some(p=>p.graphId===e.graphId&&p.actorId===e.actorId&&compare(p.source,e.source)===0&&digest(p.effect)===digest(e.effect))),'pending effects do not match transitions');else ensure(pendingEffects.length===0,'applied phase still has pending effects');
  if(!restoredInitialized)ensure(graphStates.every(s=>s.transitionCount===0)&&rearmStates.length===0&&seenObservations.length===0&&transitions.length===0&&restoredSerial===0&&gates.every(g=>g.open===compiled.definition.gates.find(s=>s.id===g.id)!.initiallyOpen)&&dropBanks.every(b=>digest(b.down)===digest(compiled.definition.dropBanks.find(s=>s.id===b.id)!.initiallyDown)),'uninitialized state changed');
  const candidate:State={tick:restoredTick,actuatorTick:restoredActuatorTick,initialized:restoredInitialized,effectSerial:restoredSerial,graphs:graphStates,rearm:rearmStates,gates,dropBanks,pendingEffects,seen:seenObservations,transitions};
  ensure(digest(candidate)===digest(p),'noncanonical snapshot ordering');stateFits(candidate);state=candidate;version++; // All validation completed before replacing accepted state.
 }
 return {compiled,readFrame:frame,observeTick,prepareActuatorTick,commitActuatorTick,snapshot,restore};
}
