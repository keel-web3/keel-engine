import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProgression,createProgressionController,compareObservationCursors,PROGRESSION_SCHEMA,ObservationPhase,type ProgressionDefinition,type ProgressionCatalog,type ProgressionRoster,type ContactObservation,type ProgressionController,type ProgressionObservation,type ObservationCursor} from '../src/index.ts';
import {digest} from '../src/validation.ts';
const catalog:ProgressionCatalog={worldDigest:'a'.repeat(64),colliders:[{id:'pressure',arenaId:'field',kind:'bumper',target:false},{id:'relay',arenaId:'field',kind:'rail',target:true},{id:'return',arenaId:'field',kind:'rail',target:true},{id:'gate',arenaId:'field',kind:'gate',target:false},{id:'right',arenaId:'field',kind:'flipper',target:false},{id:'wrong',arenaId:'field',kind:'flipper',target:false}]};
const roster:ProgressionRoster={owners:[{ownerId:0,teamId:0},{ownerId:1,teamId:0}],bodies:[{id:'core-0',ownerId:0},{id:'core-1',ownerId:1}]};
const definition=():ProgressionDefinition=>({schema:PROGRESSION_SCHEMA,revision:'test.1',contacts:['pressure','relay','return'].map(id=>({id:`contact.${id}`,colliderIds:[id],eventTypes:[id==='pressure'?'bumper':'rail'],sourceFlipperIds:['right'],requiresShot:true,requireFreshShot:true,maxShotAgeTicks:120})),gates:[{id:'exit',colliderId:'gate',initiallyOpen:false}],dropBanks:[{id:'relay-bank',targetIds:['relay'],initiallyDown:[]}],graphs:[{id:'order',scope:'owner',initialNodeId:'pressure',resetOnDrain:false,resetEffects:[],nodes:[{id:'pressure',contactBindingId:'contact.pressure',nextNodeId:'relay',effects:[],timeoutTicks:null},{id:'relay',contactBindingId:'contact.relay',nextNodeId:'return',effects:[{type:'drop-target',bankId:'relay-bank',targetId:'relay'}],timeoutTicks:null},{id:'return',contactBindingId:'contact.return',nextNodeId:null,effects:[{type:'gate',gateId:'exit',open:true}],timeoutTicks:null}]}]});
const native=(tick:number,ordinal:number):ObservationCursor=>({tick,phase:ObservationPhase.NATIVE,nativeOrdinal:ordinal,serial:ordinal});
const contact=(tick:number,id:string,ordinal=2,ownerId=0,shotCursor=native(tick,0),flipperId='right'):ContactObservation=>({id:`obs:${tick}:${ordinal}:${ownerId}`,type:'contact',cursor:native(tick,ordinal),bodyId:`core-${ownerId}`,ownerId,colliderId:id,contactType:id==='pressure'?'bumper':'rail',shot:{cursor:shotCursor,bodyId:`core-${ownerId}`,ownerId,flipperId}});
const controller=(d=definition(),r=roster)=>createProgressionController(compileProgression(d,catalog,r));
function begin(c:ProgressionController,tick:number){const plan=c.prepareActuatorTick(tick);c.commitActuatorTick(plan);return plan;}
function step(c:ProgressionController,tick:number,observations:readonly ProgressionObservation[]=[]){const plan=begin(c,tick);return {plan,frame:c.observeTick(tick,observations)};}
function separated(tick:number,id:string,ownerId=0):ProgressionObservation{return {id:`sep:${tick}:${id}:${ownerId}`,type:'separation',cursor:{tick,phase:ObservationPhase.SEPARATION,nativeOrdinal:null,serial:10},bodyId:`core-${ownerId}`,ownerId,contactBindingId:`contact.${id}`};}
function altered(bytes:Uint8Array,change:(p:Record<string,any>)=>void){const header=JSON.parse(new TextDecoder().decode(bytes)) as {payload:Record<string,any>;checksum:string};change(header.payload);header.checksum=digest(header.payload);return new TextEncoder().encode(JSON.stringify(header));}

test('compiler binds content and rejects absent, non-target, sparse and competing-writer definitions',()=>{
 const a=compileProgression(definition(),catalog,roster);assert.equal(a.identity,compileProgression(definition(),catalog,roster).identity);assert(Object.isFrozen(a.definition.graphs));
 for(const mutate of [(d:any)=>{d.dropBanks[0].targetIds=['pressure'];},(d:any)=>{d.contacts[0].colliderIds=['missing'];},(d:any)=>{d.graphs[0].nodes[0].nextNodeId='missing';},(d:any)=>{d.graphs[0].nodes.push({...d.graphs[0].nodes[0],id:'unreachable'});},(d:any)=>{d.graphs.push({...d.graphs[0],id:'other'});},(d:any)=>{delete d.graphs[0].nodes[1];}]){const d=definition();mutate(d);assert.throws(()=>compileProgression(d,catalog,roster));}
});
test('initialization and ordered progression emit actual next-tick collider mutations',()=>{
 const c=controller();assert.deepEqual(begin(c,1).mutations.map(m=>[m.colliderId,m.enabled]),[['gate',true],['relay',true]]);c.observeTick(1,[contact(1,'pressure')]);
 assert.equal(c.readFrame().graphs[0]!.nodeId,'relay');assert.equal(c.readFrame().pendingEffects.length,0);
 step(c,2,[contact(2,'relay')]);assert.deepEqual(c.readFrame().dropBanks[0]!.down,[]);assert.equal(c.readFrame().pendingEffects[0]!.applyTick,3);
 assert.deepEqual(begin(c,3).mutations.map(m=>[m.colliderId,m.enabled]),[['relay',false]]);c.observeTick(3,[contact(3,'return')]);assert.equal(c.readFrame().gates[0]!.open,false);
 const p=begin(c,4);assert.deepEqual(p.mutations.map(m=>[m.colliderId,m.enabled]),[['gate',false]]);assert.equal(c.readFrame().gates[0]!.open,true);assert(!p.mutations.some(m=>m.colliderId==='return'));c.observeTick(4,[]);
});
test('out-of-order contacts cannot be reused while touching; explicit separation rearms',()=>{
 const c=controller();step(c,1,[contact(1,'return')]);step(c,2,[contact(2,'pressure')]);step(c,3,[contact(3,'relay')]);step(c,4,[contact(4,'return')]);assert.equal(c.readFrame().graphs[0]!.nodeId,'return');
 step(c,5,[separated(5,'return')]);step(c,6,[contact(6,'return')]);assert.equal(c.readFrame().graphs[0]!.nodeId,null);
});
test('fresh contact with old shot and wrong blade cannot advance the newly entered node',()=>{
 const c=controller();step(c,1,[contact(1,'pressure')]);step(c,2,[contact(2,'relay',2,0,native(1,0))]);assert.equal(c.readFrame().graphs[0]!.nodeId,'relay');
 step(c,3,[separated(3,'relay')]);step(c,4,[contact(4,'relay',2,0,native(4,0),'wrong')]);assert.equal(c.readFrame().graphs[0]!.nodeId,'relay');
 step(c,5,[separated(5,'relay')]);step(c,6,[contact(6,'relay')]);assert.equal(c.readFrame().graphs[0]!.nodeId,'return');
});
test('numeric ordinal2 precedes10 regardless of lexical event IDs; a new same-tick shot may advance',()=>{
 const c=controller();const first={...contact(1,'pressure',2),id:'z-first'},second={...contact(1,'relay',10,0,native(1,8)),id:'a-second'};assert(compareObservationCursors(first.cursor,second.cursor)<0);step(c,1,[first,second]);assert.equal(c.readFrame().graphs[0]!.nodeId,'return');
 const bad=controller();begin(bad,1);const before=bad.snapshot();assert.throws(()=>bad.observeTick(1,[second,first]));assert.deepEqual(bad.snapshot(),before);
});
test('exact duplicates dedupe; conflicting duplicate IDs and cursor aliases reject atomically',()=>{
 const c=controller(),a=contact(1,'pressure');step(c,1,[a,a]);assert.equal(c.readFrame().graphs[0]!.transitionCount,1);
 for(const input of [[a,{...a,colliderId:'relay',contactType:'rail' as const}],[a,{...a,id:'different'}]]){const b=controller();begin(b,1);const before=b.snapshot();assert.throws(()=>b.observeTick(1,input));assert.deepEqual(b.snapshot(),before);}
});
test('shot credential cannot borrow another owner/body or a future source cursor',()=>{
 for(const source of [{bodyId:'core-1',ownerId:1},{cursor:native(2,0)}]){const c=controller();begin(c,1);const a=contact(1,'pressure'),before=c.snapshot();assert.throws(()=>c.observeTick(1,[{...a,shot:{...a.shot!,...source}}]));assert.deepEqual(c.snapshot(),before);}
});
test('discarded, foreign and stale actuator plans never consume pending effects',()=>{
 const c=controller();step(c,1,[contact(1,'pressure')]);step(c,2,[contact(2,'relay')]);const saved=c.snapshot(),p=c.prepareActuatorTick(3);assert.deepEqual(c.snapshot(),saved);assert.throws(()=>c.commitActuatorTick({...p}));assert.deepEqual(c.snapshot(),saved);
 c.restore(saved);assert.throws(()=>c.commitActuatorTick(p));assert.deepEqual(c.snapshot(),saved);const current=c.prepareActuatorTick(3);c.commitActuatorTick(current);assert.throws(()=>c.commitActuatorTick(current));assert.deepEqual(c.readFrame().dropBanks[0]!.down,['relay']);
});
test('snapshot restore reproduces pending-effect and post-actuator phases exactly',()=>{
 const c=controller();step(c,1,[contact(1,'pressure')]);step(c,2,[contact(2,'relay')]);const clone=controller();clone.restore(c.snapshot());assert.deepEqual(clone.snapshot(),c.snapshot());
 assert.deepEqual(begin(clone,3),begin(c,3));const applied=controller();applied.restore(c.snapshot());assert.deepEqual(applied.snapshot(),c.snapshot());for(const next of [c,clone,applied])next.observeTick(3,[contact(3,'return')]);assert.deepEqual(clone.snapshot(),c.snapshot());assert.deepEqual(applied.snapshot(),c.snapshot());
});
test('malformed and cross-identity restores fail without changing accepted state',()=>{
 const c=controller();step(c,1,[contact(1,'pressure')]);const before=c.snapshot();
 for(const mutate of [(p:Record<string,any>)=>{p.graphs[0].nodeId='missing';},(p:Record<string,any>)=>{p.actuatorTick=99;},(p:Record<string,any>)=>{p.dropBanks[0].down=['return'];},(p:Record<string,any>)=>{p.seen.push(p.seen[0]);},(p:Record<string,any>)=>{p.graphs[0].transitionCount=0;}]){assert.throws(()=>c.restore(altered(before,mutate)));assert.deepEqual(c.snapshot(),before);}
 const changed=definition();(changed as {revision:string}).revision='other';assert.throws(()=>controller(changed).restore(before));assert.throws(()=>createProgressionController(compileProgression(definition(),{...catalog,worldDigest:'b'.repeat(64)},roster)).restore(before));
});
test('exclusive timeout and drain reset do not reuse prior contact or old shot',()=>{
 const d=definition();const g=d.graphs[0]!;(g as {resetOnDrain:boolean}).resetOnDrain=true;(g.nodes[0] as {timeoutTicks:number|null}).timeoutTicks=2;
 const c=controller(d);step(c,1,[]);step(c,2,[contact(2,'pressure'),separated(2,'pressure')]);assert.equal(c.readFrame().graphs[0]!.nodeId,'pressure');assert.equal(c.readFrame().transitions[0]!.cause,'timeout');
 step(c,3,[contact(3,'pressure')]);assert.equal(c.readFrame().graphs[0]!.nodeId,'relay');
 step(c,4,[{id:'drain:4',type:'drain',cursor:{tick:4,phase:ObservationPhase.SENSOR,nativeOrdinal:null,serial:0},bodyId:'core-0',ownerId:0}]);assert.equal(c.readFrame().graphs[0]!.nodeId,'pressure');
});
test('team and world scopes share graph state while owner scope remains independent',()=>{
 const own=controller();step(own,1,[contact(1,'pressure',2,1)]);assert.equal(own.readFrame().graphs.find(g=>g.actorId===0)!.nodeId,'pressure');assert.equal(own.readFrame().graphs.find(g=>g.actorId===1)!.nodeId,'relay');
 for(const scope of ['team','world'] as const){const d=definition();(d.graphs[0] as {scope:string}).scope=scope;const c=controller(d);step(c,1,[contact(1,'pressure',2,1)]);step(c,2,[contact(2,'relay',2,0)]);assert.equal(c.readFrame().graphs.length,1);assert.equal(c.readFrame().graphs[0]!.nodeId,'return');}
});
test('disabled dropped targets cannot produce accepted authoritative contacts',()=>{
 const c=controller();step(c,1,[contact(1,'pressure')]);step(c,2,[contact(2,'relay')]);begin(c,3);const before=c.snapshot();assert.throws(()=>c.observeTick(3,[contact(3,'relay')]));assert.deepEqual(c.snapshot(),before);
});
test('drop then drain in one tick produces one final reset write without disabling return facets',()=>{
 const d=definition();const g=d.graphs[0]!;(g as {resetOnDrain:boolean}).resetOnDrain=true;(g as unknown as {resetEffects:unknown[]}).resetEffects=[{type:'reset-bank',bankId:'relay-bank'},{type:'gate',gateId:'exit',open:false}];
 const c=controller(d);step(c,1,[contact(1,'pressure')]);step(c,2,[contact(2,'relay'),{id:'drain:2',type:'drain',cursor:{tick:2,phase:ObservationPhase.SENSOR,nativeOrdinal:null,serial:0},bodyId:'core-0',ownerId:0}]);const pending=c.snapshot(),copy=controller(d);copy.restore(pending);assert.deepEqual(copy.snapshot(),pending);
 const plan=begin(c,3);assert.deepEqual(plan.mutations.map(m=>[m.colliderId,m.enabled]),[['gate',true],['relay',true]]);assert.equal(plan.mutations.find(m=>m.colliderId==='relay')!.causeEffectIds.length,2);assert.deepEqual(c.readFrame().dropBanks[0]!.down,[]);assert(!plan.mutations.some(m=>m.colliderId==='return'));c.observeTick(3,[]);
});
