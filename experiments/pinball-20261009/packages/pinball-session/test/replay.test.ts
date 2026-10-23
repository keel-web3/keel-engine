import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinballSession,createSessionReplayRecorder,createSessionReplayPlayer,encodeSessionReplay,decodeSessionReplay,DEFAULT_SCORE_PRESSURE,SessionAction} from '../src/index.ts';
import {sha256} from '@keel-engine/codec/hash';
import {field,worldFrom,player} from '../../pinball-arena/test/fixtures.ts';

function fixture(){
 const world=worldFrom([field({stations:[{...field().stations[0]!,launchX:200,launchY:200,launchVx:4},{...field().stations[0]!,id:'home-1',ownerId:1,teamId:1,x:200,y:450,launchX:200,launchY:450,launchVx:11}],switches:[{id:'cache-sensor',x:280,y:200,radius:20,layer:0,elevation:0,gateIds:[],holdTicks:1}],hazards:[{id:'electrical-hit',kind:'damage',x:400,y:200,radius:20,layer:0,elevation:0,damage:2,cooldownTicks:1000}],bumpers:[{id:'score-coil',x:400,y:450,radius:35,impulse:1,layer:0,elevation:0,kind:'coil'}]})]);
 const rules={mode:'battle-royale' as const,scorePressure:{...DEFAULT_SCORE_PRESSURE,startGraceTicks:10,deficitGraceTicks:12,damageIntervalTicks:120},crates:[{id:'supply',admission:{kind:'switch' as const,mechanismId:'cache-sensor'},pool:[{itemId:'arc-field',weight:1}],medkits:1}]};
 const options={players:[player(0),player(1)],stormDelayTicks:1200,maxTicks:1200,launchDeadlineTicks:1200};
 return{world,rules,options};
}
const controls=(tick:number)=>tick===1?[{ownerId:0,bits:4},{ownerId:1,bits:4}]:[{ownerId:0,bits:0,steerX:.317,steerY:-.173,actions:tick>=71?SessionAction.MEDKIT:0}];

test('portable session replay derives actual crate, health, pressure, inventory and medkit state from controls',()=>{
 const descriptor=fixture(),live=createPinballSession(descriptor.world,descriptor.rules,descriptor.options),journal=createSessionReplayRecorder(live,descriptor,200),frames=[];
 let crate=false,medkit=false,pressure=false;
 for(let tick=1;tick<=180;tick++){const frame=journal.step(controls(tick));frames.push(frame);crate||=frame.events.some(e=>e.type==='crate-open');medkit||=frame.events.some(e=>e.type==='medkit');pressure||=frame.arena.events.some(e=>e.type==='damage'&&e.cause==='score-pressure');}
 assert(crate&&medkit&&pressure);assert.equal(live.readFrame().crates[0]!.claimedBy,0);assert.equal(live.readFrame().inventories[0]!.medkits,0);
 const before=live.snapshot(),bytes=encodeSessionReplay(journal.exportTape()),replay=createSessionReplayPlayer(decodeSessionReplay(bytes));
 for(const expected of frames)assert.deepEqual(replay.step(),expected);
 assert(replay.complete);assert.deepEqual(replay.snapshot(),before);assert.deepEqual(live.snapshot(),before);assert.deepEqual(replay.step(),frames.at(-1));
});

test('rolling baseline retains pending healing, held action edges and exact full session continuation',()=>{
 const descriptor=fixture(),live=createPinballSession(descriptor.world,descriptor.rules,descriptor.options),journal=createSessionReplayRecorder(live,descriptor,71),frames=[];
 for(let tick=1;tick<=100;tick++)frames.push(journal.step(controls(tick)));
 const tape=journal.exportTape(),initial=JSON.parse(new TextDecoder().decode(tape.initialSnapshot));
 assert.equal(tape.startTick,71);assert.equal(tape.ticks,29);assert(tape.recentSegment);assert.equal(initial.pendingHeal.length,1);assert.equal(initial.inventory[0].previousActions,1);assert.equal(initial.inventory[0].medkits,0);
 const replay=createSessionReplayPlayer(decodeSessionReplay(encodeSessionReplay(tape))),before=live.snapshot();
 for(const frame of frames.slice(71))assert.deepEqual(replay.step(),frame);
 assert(replay.complete);assert.deepEqual(replay.snapshot(),before);assert.deepEqual(live.snapshot(),before);
});

test('a replay uses copied metadata and input bytes and rejects mismatched rules or external journal steps',()=>{
 const descriptor=fixture(),live=createPinballSession(descriptor.world,descriptor.rules,descriptor.options),journal=createSessionReplayRecorder(live,descriptor,200);
 for(let tick=1;tick<=80;tick++)journal.step(controls(tick));
 const before=live.snapshot(),tape=journal.exportTape(),replay=createSessionReplayPlayer(tape);
 tape.inputs.fill(0);(tape.descriptor.rules.crates![0]!.pool[0] as {weight:number}).weight=99;
 for(let tick=1;tick<=80;tick++)replay.step();assert(replay.complete);assert.deepEqual(replay.snapshot(),before);
 assert.throws(()=>createSessionReplayRecorder(live,{...descriptor,rules:{...descriptor.rules,scorePressure:{...descriptor.rules.scorePressure,pacePermille:700}}}));assert.deepEqual(live.snapshot(),before);
 live.step();assert.throws(()=>journal.step());assert.throws(()=>journal.exportTape());
});

test('invalid journal inputs and forged replay controls/versions fail without mutating live session',()=>{
 const descriptor=fixture(),live=createPinballSession(descriptor.world,descriptor.rules,descriptor.options),journal=createSessionReplayRecorder(live,descriptor,20),before=live.snapshot();
 for(const inputs of [[{ownerId:0,bits:0,actions:2}],[{ownerId:0,bits:0},{ownerId:0,bits:4}],[{ownerId:99,bits:0}],[{ownerId:0,bits:64}],[{ownerId:0,bits:0,steerX:NaN}]]){assert.throws(()=>journal.step(inputs));assert.deepEqual(live.snapshot(),before);assert.equal(journal.ticks,0);}
 journal.step(controls(1));const liveAtReplayStart=live.snapshot(),tape=journal.exportTape(),bytes=encodeSessionReplay(tape),damaged=bytes.slice();damaged[20]=damaged[20]!^1;assert.throws(()=>decodeSessionReplay(damaged));
 for(const change of [{revision:'pinball-session/2026-10-07.old'},{authority:'shared-arena/2026-10-07.13'},{ownerIds:[1,0]},{identity:'0'.repeat(64)},{startTick:99},{finalDigest:'0'.repeat(64)}]){
  const changed={...tape,...change};assert.throws(()=>{const replay=createSessionReplayPlayer(changed);while(!replay.complete)replay.step();});
 }
 const invalid=bytes.slice(),view=new DataView(invalid.buffer),at=16+view.getUint32(4,true)+view.getUint32(8,true);invalid[at+3]=2;invalid.set(sha256(invalid.subarray(0,invalid.length-32)),invalid.length-32);assert.throws(()=>decodeSessionReplay(invalid),/admitted controls/);
 const offset=new Uint8Array(bytes.length+13);offset.set(bytes,7);assert.deepEqual(decodeSessionReplay(offset.subarray(7,7+bytes.length)),tape);assert.deepEqual(live.snapshot(),liveAtReplayStart);
});

test('direct in-memory playback enforces the same metadata bound as the binary importer before constructing a session',()=>{
 const descriptor=fixture(),live=createPinballSession(descriptor.world,descriptor.rules,descriptor.options),journal=createSessionReplayRecorder(live,descriptor,20),tape=journal.exportTape(),before=live.snapshot();
 (tape.descriptor.rules as unknown as {ignoredPadding:string}).ignoredPadding='x'.repeat(8*1024*1024);
 assert.throws(()=>createSessionReplayPlayer(tape),/metadata cap/);assert.throws(()=>encodeSessionReplay(tape),/metadata cap/);assert.deepEqual(live.snapshot(),before);
});
