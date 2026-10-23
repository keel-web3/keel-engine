import type {ArenaWorldDefinition} from '@keel-engine/pinball-arena';
import {PROGRESSION_SCHEMA,PROGRESSION_REVISION,PROGRESSION_LIMITS as L,type ActuatorEffect,type CompiledProgression,type ContactBinding,type DropBankDefinition,type GateDefinition,type ProgressionCatalog,type ProgressionDefinition,type ProgressionGraph,type ProgressionNode,type ProgressionRoster,type ColliderBinding} from './types.ts';
import {array,digest,ensure,frozen,hashId,ids,integer,record,textId} from './validation.ts';
const byId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;

/** Derive identities from exact source descriptors, not rendered labels. */
export function createProgressionCatalog(world:ArenaWorldDefinition):ProgressionCatalog{
 ensure(hashId(world.sha256)&&typeof world.canonical==='string','world identity');
 const {canonical,sha256:worldDigest,...body}=world;
 ensure(JSON.stringify(body)===canonical&&digest(body)===worldDigest,'world canonical binding');
 const colliders:ColliderBinding[]=[];
 for(const a of world.arenas){
  for(const r of a.rails)colliders.push({id:r.id,arenaId:a.id,kind:'rail',target:r.kind==='target'});
  for(const b of a.bumpers)colliders.push({id:b.id,arenaId:a.id,kind:'bumper',target:false});
  for(const f of a.flippers)colliders.push({id:f.id,arenaId:a.id,kind:'flipper',target:false});
  for(const g of a.gates)colliders.push({id:g.id,arenaId:a.id,kind:'gate',target:false});
 }
 return frozen({worldDigest,colliders:colliders.sort(byId)});
}

export function validateActuatorEffect(v:unknown,gates:readonly GateDefinition[],banks:readonly DropBankDefinition[]):ActuatorEffect{
 ensure(v!==null&&typeof v==='object'&&!Array.isArray(v),'effect');const type=(v as {type?:unknown}).type;
 if(type==='gate'){const e=record(v,['type','gateId','open'],'gate effect');ensure(textId(e.gateId)&&gates.some(g=>g.id===e.gateId)&&typeof e.open==='boolean','gate effect binding');return {type,gateId:e.gateId,open:e.open};}
 if(type==='drop-target'){const e=record(v,['type','bankId','targetId'],'drop effect');ensure(textId(e.bankId)&&textId(e.targetId)&&banks.some(b=>b.id===e.bankId&&b.targetIds.includes(e.targetId as string)),'drop effect binding');return {type,bankId:e.bankId,targetId:e.targetId};}
 ensure(type==='reset-bank','unsupported actuator effect');const e=record(v,['type','bankId'],'reset effect');ensure(textId(e.bankId)&&banks.some(b=>b.id===e.bankId),'reset effect binding');return {type,bankId:e.bankId};
}

/** All effects have finite descriptor-bound adapters; no scripts, score or impulses. */
export function compileProgression(source:ProgressionDefinition,catalogSource:ProgressionCatalog,rosterSource:ProgressionRoster):CompiledProgression{
 const c=record(catalogSource,['worldDigest','colliders'],'catalog');ensure(hashId(c.worldDigest),'world digest');
 const colliders=array(c.colliders,2048,'collider catalog').map(v=>{const r=record(v,['id','arenaId','kind','target'],'collider');ensure(textId(r.id)&&textId(r.arenaId)&&['rail','bumper','flipper','gate'].includes(r.kind as string)&&typeof r.target==='boolean'&&(!r.target||r.kind==='rail'),'collider binding');return {id:r.id,arenaId:r.arenaId,kind:r.kind as ColliderBinding['kind'],target:r.target};}).sort(byId);
 ensure(new Set(colliders.map(v=>v.id)).size===colliders.length,'duplicate collider');const colliderById=new Map(colliders.map(v=>[v.id,v]));
 const roster=record(rosterSource,['owners','bodies'],'roster');
 const owners=array(roster.owners,L.owners,'owners').map(v=>{const r=record(v,['ownerId','teamId'],'owner');ensure(integer(r.ownerId,0,99)&&integer(r.teamId,0,99),'owner/team');return {ownerId:r.ownerId,teamId:r.teamId};}).sort((a,b)=>a.ownerId-b.ownerId);
 ensure(owners.length>0&&new Set(owners.map(o=>o.ownerId)).size===owners.length,'owner roster');
 const bodies=array(roster.bodies,L.bodies,'bodies').map(v=>{const r=record(v,['id','ownerId'],'body');ensure(textId(r.id)&&integer(r.ownerId,0,99)&&owners.some(o=>o.ownerId===r.ownerId),'body owner');return {id:r.id,ownerId:r.ownerId};}).sort(byId);
 ensure(new Set(bodies.map(b=>b.id)).size===bodies.length&&owners.every(o=>bodies.some(b=>b.ownerId===o.ownerId)),'body roster');
 const s=record(source,['schema','revision','contacts','gates','dropBanks','graphs'],'definition');ensure(s.schema===PROGRESSION_SCHEMA&&textId(s.revision),'definition identity');
 const claimed=new Set<string>();const claim=(id:string)=>{ensure(!claimed.has(id),'duplicate mechanism/graph identity');claimed.add(id);};
 const boundColliders=new Set<string>();
 const contacts:ContactBinding[]=array(s.contacts,L.contacts,'contacts').map(v=>{
  const r=record(v,['id','colliderIds','eventTypes','sourceFlipperIds','requiresShot','requireFreshShot','maxShotAgeTicks'],'contact binding');ensure(textId(r.id),'contact id');claim(r.id);
  const colliderIds=ids(r.colliderIds,256,'contact colliders').slice().sort(),eventTypes=ids(r.eventTypes,3,'contact event types'),sourceFlipperIds=ids(r.sourceFlipperIds,256,'source flippers',false).slice().sort();
  ensure(eventTypes.every(t=>['rail','bumper','flipper'].includes(t)),'contact event type');
  for(const id of colliderIds){const binding=colliderById.get(id);ensure(binding&&!boundColliders.has(id)&&eventTypes.includes(binding.kind==='gate'?'rail':binding.kind),'contact collider/event binding');boundColliders.add(id);}
  ensure(typeof r.requiresShot==='boolean'&&typeof r.requireFreshShot==='boolean'&&integer(r.maxShotAgeTicks,1,12000),'contact admission');
  ensure(r.requiresShot?sourceFlipperIds.length>0:sourceFlipperIds.length===0&&!r.requireFreshShot,'shot policy');
  ensure(sourceFlipperIds.every(id=>colliderById.get(id)?.kind==='flipper'),'source flipper absent');
  return {id:r.id,colliderIds,eventTypes:eventTypes.slice().sort() as ContactBinding['eventTypes'],sourceFlipperIds,requiresShot:r.requiresShot,requireFreshShot:r.requireFreshShot,maxShotAgeTicks:r.maxShotAgeTicks};
 }).sort(byId);
 const gates:GateDefinition[]=array(s.gates,L.gates,'gates').map(v=>{const r=record(v,['id','colliderId','initiallyOpen'],'gate');ensure(textId(r.id)&&textId(r.colliderId)&&colliderById.get(r.colliderId)?.kind==='gate'&&typeof r.initiallyOpen==='boolean','gate binding');claim(r.id);return {id:r.id,colliderId:r.colliderId,initiallyOpen:r.initiallyOpen};}).sort(byId);
 ensure(new Set(gates.map(g=>g.colliderId)).size===gates.length,'duplicate gate actuator');
 const allTargets=new Set<string>();
 const dropBanks:DropBankDefinition[]=array(s.dropBanks,L.dropBanks,'drop banks').map(v=>{const r=record(v,['id','targetIds','initiallyDown'],'drop bank');ensure(textId(r.id),'drop bank id');claim(r.id);const targetIds=ids(r.targetIds,L.targets,'bank targets').slice().sort(),initiallyDown=ids(r.initiallyDown,L.targets,'initially down',false).slice().sort();for(const id of targetIds){ensure(colliderById.get(id)?.target&&!allTargets.has(id),'drop target absent, non-target or duplicate');allTargets.add(id);}ensure(initiallyDown.every(id=>targetIds.includes(id)),'initial target state');return {id:r.id,targetIds,initiallyDown};}).sort(byId);
 ensure(allTargets.size<=L.targets,'target capacity');
 const contactGraph=new Map<string,string>(),actuatorGraph=new Map<string,string>();let totalNodes=0;
 const effects=(v:unknown,graphId:string)=>array(v,32,'effects').map(e=>{
  const effect=validateActuatorEffect(e,gates,dropBanks),key=effect.type==='gate'?`gate:${effect.gateId}`:`bank:${effect.bankId}`,previous=actuatorGraph.get(key);ensure(previous===undefined||previous===graphId,'multiple graph actuator writers');actuatorGraph.set(key,graphId);return effect;
 });
 const graphs:ProgressionGraph[]=array(s.graphs,L.graphs,'graphs').map(v=>{
  const r=record(v,['id','scope','initialNodeId','nodes','resetOnDrain','resetEffects'],'graph');ensure(textId(r.id)&&textId(r.initialNodeId)&&['owner','team','world'].includes(r.scope as string)&&typeof r.resetOnDrain==='boolean','graph identity/scope');claim(r.id);
  const graphId=r.id;
  const nodes:ProgressionNode[]=array(r.nodes,L.nodesPerGraph,'nodes').map(v=>{const n=record(v,['id','contactBindingId','nextNodeId','effects','timeoutTicks'],'node');ensure(textId(n.id)&&textId(n.contactBindingId)&&contacts.some(c=>c.id===n.contactBindingId)&&(n.nextNodeId===null||textId(n.nextNodeId))&&(n.timeoutTicks===null||integer(n.timeoutTicks,1,L.tick)),'node binding/timing');const previous=contactGraph.get(n.contactBindingId);ensure(previous===undefined||previous===graphId,'contact binding belongs to multiple graphs');contactGraph.set(n.contactBindingId,graphId);return {id:n.id,contactBindingId:n.contactBindingId,nextNodeId:n.nextNodeId,effects:effects(n.effects,graphId),timeoutTicks:n.timeoutTicks};}).sort(byId);
  totalNodes+=nodes.length;ensure(nodes.length>0&&new Set(nodes.map(n=>n.id)).size===nodes.length&&nodes.some(n=>n.id===r.initialNodeId),'node identity');
  ensure(nodes.every(n=>n.nextNodeId===null||nodes.some(p=>p.id===n.nextNodeId)),'next node absent');
  const reachable=new Set<string>();let at:string|null=r.initialNodeId;while(at!==null&&!reachable.has(at)){reachable.add(at);at=nodes.find(n=>n.id===at)!.nextNodeId;}ensure(reachable.size===nodes.length,'unreachable graph node');
  const resetEffects=effects(r.resetEffects,graphId);ensure(r.resetOnDrain||nodes.some(n=>n.timeoutTicks!==null)||resetEffects.length===0,'unused reset effects');
  return {id:graphId,scope:r.scope as ProgressionGraph['scope'],initialNodeId:r.initialNodeId,nodes,resetOnDrain:r.resetOnDrain,resetEffects};
 }).sort(byId);
 ensure(graphs.length>0&&totalNodes<=L.totalNodes&&contacts.every(c=>contactGraph.has(c.id)),'graph/node/contact capacity');
 ensure(gates.every(g=>actuatorGraph.has(`gate:${g.id}`))&&dropBanks.every(b=>actuatorGraph.has(`bank:${b.id}`)),'unwritten actuator');
 const definition:ProgressionDefinition={schema:PROGRESSION_SCHEMA,revision:s.revision,contacts,gates,dropBanks,graphs},catalog:ProgressionCatalog={worldDigest:c.worldDigest,colliders},normalizedRoster:ProgressionRoster={owners,bodies};
 const graphDigest=digest(definition),identity=digest({schema:'keel-pinball-progression-compiled@1',revision:PROGRESSION_REVISION,graphDigest,catalog,roster:normalizedRoster});
 return frozen({schema:'keel-pinball-progression-compiled@1',revision:PROGRESSION_REVISION,graphDigest,identity,definition,catalog,roster:normalizedRoster});
}
