import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinballSession,deriveScoreCurve,DEFAULT_SCORE_PRESSURE,SessionAction} from '../src/index.ts';
import type {PinballSessionRules} from '../src/index.ts';
import {field,worldFrom,player} from '../../pinball-arena/test/fixtures.ts';

const pressure={...DEFAULT_SCORE_PRESSURE,startGraceTicks:10,deficitGraceTicks:12,damageIntervalTicks:120};
const options={players:[player(0),player(1)],stormDelayTicks:1200,maxTicks:1200,launchDeadlineTicks:1200};
const baseRules:PinballSessionRules={mode:'battle-royale',scorePressure:pressure};
function scoringWorld(){return worldFrom([field({
 stations:[{...field().stations[0]!,launchX:200,launchY:200,launchVx:11},{...field().stations[0]!,id:'home-1',ownerId:1,teamId:1,x:900,y:700,launchX:900,launchY:700,launchVx:0}],
 bumpers:[{id:'scoring-coil',x:400,y:200,radius:35,impulse:1,layer:0,elevation:0,kind:'coil'}],
 })]);}
test('global live score quantile handles ties, outliers, dead players, two lives and integer extremes',()=>{
 const life=(ownerId:number,score:number,eliminated=false)=>({ownerId,score,eliminated});
 assert.deepEqual(deriveScoreCurve([life(0,0),life(1,100)],pressure),{living:2,benchmark:60,cutoff:39});
 assert.deepEqual(deriveScoreCurve([life(0,100),life(1,100)],pressure),{living:2,benchmark:100,cutoff:65});
 assert.deepEqual(deriveScoreCurve([life(0,0),life(1,100,true)],pressure),{living:1,benchmark:0,cutoff:0});
 assert.equal(deriveScoreCurve([life(0,0),life(1,0),life(2,0),life(3,100000)],pressure).cutoff,0);
 assert.equal(deriveScoreCurve([life(0,2147483647),life(1,2147483647)],pressure).cutoff,1395864370);
 assert.equal(deriveScoreCurve([life(0,Number.MAX_SAFE_INTEGER),life(1,Number.MAX_SAFE_INTEGER)],pressure).cutoff,5854679515581644);
 assert.throws(()=>deriveScoreCurve([life(0,1),life(0,2)],pressure));
});
test('actual earned score puts the other live owner under pressure and drains authoritative health after warning',()=>{
 const session=createPinballSession(scoringWorld(),baseRules,options);let warned=false,damaged=false;
 for(let tick=1;tick<=80;tick++){const frame=session.step(tick===1?[{ownerId:0,bits:4},{ownerId:1,bits:4}]:[]);warned||=frame.events.some(e=>e.type==='pressure-warning'&&e.ownerId===1);damaged||=frame.arena.events.some(e=>e.type==='damage'&&e.ownerId===1&&e.cause==='score-pressure');assert.equal(session.getStats().contactBudget,0);}
 const frame=session.readFrame();assert(frame.arena.balls[0]!.score>0);assert.equal(frame.arena.balls[1]!.score,0);assert(warned&&damaged);assert.equal(frame.arena.balls[1]!.health,5);assert.equal(frame.arena.balls[0]!.health,6);
});
test('physical crate opens once, medkit healing consumes an input edge, and snapshots continue exact live rules',()=>{
 const world=worldFrom([field({stations:[{...field().stations[0]!,launchX:200,launchY:200,launchVx:4},{...field().stations[0]!,id:'home-1',ownerId:1,teamId:1,x:900,y:700,launchX:900,launchY:700,launchVx:0}],switches:[{id:'crate-switch',x:280,y:200,radius:20,layer:0,elevation:0,gateIds:[],holdTicks:1}],hazards:[{id:'hit',kind:'damage',x:400,y:200,radius:20,layer:0,elevation:0,damage:2,cooldownTicks:1000}]})]);
 const rules:PinballSessionRules={mode:'battle-royale',scorePressure:null,loadouts:[{ownerId:0,weapon:null,passive:null,medkits:0},{ownerId:1,weapon:null,passive:null,medkits:0}],crates:[{id:'supply',admission:{kind:'switch',mechanismId:'crate-switch'},pool:[{itemId:'impact-core',weight:1}],medkits:1}]};
 const session=createPinballSession(world,rules,options);let opens=0;
 for(let t=1;t<=70;t++){const frame=session.step(t===1?[{ownerId:0,bits:4},{ownerId:1,bits:4}]:[]);opens+=frame.events.filter(e=>e.type==='crate-open').length;}
 assert.equal(opens,1);assert.equal(session.readFrame().crates[0]!.claimedBy,0);assert.equal(session.readFrame().inventories[0]!.weapon,'impact-core');assert.equal(session.readFrame().arena.balls[0]!.health,4);
 session.step([{ownerId:0,bits:0,actions:SessionAction.MEDKIT}]);const saved=session.snapshot();assert.equal(session.readFrame().inventories[0]!.medkits,0);const clone=createPinballSession(world,rules,options);clone.restore(saved);assert.deepEqual(clone.snapshot(),saved);
 for(let t=0;t<140;t++){const input=[{ownerId:0,bits:0,actions:SessionAction.MEDKIT}];session.step(input);clone.step(input);assert.deepEqual(clone.snapshot(),session.snapshot());}
 assert.equal(session.readFrame().arena.balls[0]!.health,6);assert.equal(session.readFrame().inventories[0]!.medkits,0);
});
test('passing equipment damages a real moving opponent; solid rails and friendly teams block it',()=>{
 function make(blocked=false,friendly=false){const world=worldFrom([field({stations:[{...field().stations[0]!,launchX:200,launchY:200,launchVx:5},{...field().stations[0]!,id:'home-1',ownerId:1,teamId:friendly?0:1,x:450,y:260,launchX:450,launchY:260,launchVx:0}],rails:blocked?[{id:'separator',ax:100,ay:230,bx:600,by:230,radius:4,restitution:1,layer:0,elevation:0,material:'steel'}]:[]})]);return createPinballSession(world,{mode:friendly?'roguelike-coop':'battle-royale',scorePressure:null,loadouts:[{ownerId:0,weapon:null,passive:'arc-field',medkits:0},{ownerId:1,weapon:null,passive:null,medkits:0}]},{...options,players:[player(0,0),player(1,friendly?0:1)]});}
 const moving=make(),blocked=make(true),friendly=make(false,true);let hit=false;
 for(let tick=1;tick<=100;tick++){const inputs=tick===1?[{ownerId:0,bits:4},{ownerId:1,bits:4}]:[];const f=moving.step(inputs);blocked.step(inputs);friendly.step(inputs);hit||=f.events.some(e=>e.type==='equipment-hit'&&e.otherOwnerId===1&&e.itemId==='arc-field');}
 assert(hit);assert.equal(moving.readFrame().arena.balls[1]!.health,5);assert.equal(blocked.readFrame().arena.balls[1]!.health,6);assert.equal(friendly.readFrame().arena.balls[1]!.health,6);
});
test('rule input and cross-world or malformed restores fail atomically; BR crates are rejected in rogue modes',()=>{
 const session=createPinballSession(scoringWorld(),baseRules,options);session.step([{ownerId:0,bits:4},{ownerId:1,bits:4}]);const before=session.snapshot();
 assert.throws(()=>session.step([{ownerId:0,bits:0,actions:2}]));assert.deepEqual(session.snapshot(),before);
 for(const change of [{pendingHeal:[{ownerId:0,amount:999,serial:1}]},{claimedBy:[0]},{pressure:[{ownerId:0,belowSince:999,lastDamageTick:0},{ownerId:1,belowSince:null,lastDamageTick:-1}]},{hitCooldowns:{'99:0:passing':999}},{tick:900}]){const data={...JSON.parse(new TextDecoder().decode(before)),...change};assert.throws(()=>session.restore(new TextEncoder().encode(JSON.stringify(data))));assert.deepEqual(session.snapshot(),before);}
 assert.throws(()=>createPinballSession(scoringWorld(),{...baseRules,scorePressure:{...pressure,pacePermille:700}},options).restore(before));
 assert.throws(()=>createPinballSession(scoringWorld(),{mode:'roguelike-coop',crates:[{id:'bad',admission:{kind:'switch',mechanismId:'missing'},pool:[{itemId:'impact-core',weight:1}],medkits:0}]},{players:[player(0,0),player(1,0)]}));
});

test('a swept passing attack cannot borrow clear sight from a later position already outside its radius',()=>{
 const make=(blocked:boolean)=>createPinballSession(worldFrom([field({stations:[{...field().stations[0]!,launchX:302,launchY:200,launchVx:18},{...field().stations[0]!,id:'home-1',ownerId:1,teamId:1,x:300,y:260,launchX:300,launchY:260,launchVx:0}],rails:blocked?[{id:'short-divider',ax:100,ay:230,bx:314,by:230,radius:4,restitution:1,layer:0,elevation:0,material:'steel'}]:[]})]),{mode:'battle-royale',scorePressure:null,loadouts:[{ownerId:0,weapon:null,passive:'arc-field',medkits:0},{ownerId:1,weapon:null,passive:null,medkits:0}]},options);
 const blocked=make(true),clear=make(false);for(const session of [blocked,clear])session.step([{ownerId:0,bits:4},{ownerId:1,bits:4}]);
 assert(!blocked.step().events.some(e=>e.type==='equipment-hit'));assert(clear.step().events.some(e=>e.type==='equipment-hit'));
 blocked.step();clear.step();assert.equal(blocked.readFrame().arena.balls[1]!.health,6);assert.equal(clear.readFrame().arena.balls[1]!.health,5);
});

test('a forged pending pressure command cannot skip the actual remaining deficit grace',()=>{
 const session=createPinballSession(scoringWorld(),baseRules,options);let warning=false;
 for(let tick=1;tick<80&&!warning;tick++){const f=session.step(tick===1?[{ownerId:0,bits:4},{ownerId:1,bits:4}]:[]);warning=f.events.some(e=>e.type==='pressure-warning'&&e.ownerId===1);}
 assert(warning);const original=session.snapshot(),data=JSON.parse(new TextDecoder().decode(original));data.serial++;data.pendingDamage=[{ownerId:1,amount:1,sourceOwnerId:null,cause:'pressure',serial:data.serial}];data.pressure.find((p:{ownerId:number})=>p.ownerId===1).lastDamageTick=data.tick+1;
 assert.throws(()=>session.restore(new TextEncoder().encode(JSON.stringify(data))));assert.deepEqual(session.snapshot(),original);
});

test('equipment acquired inside this tick cannot damage a target retroactively during that same sweep',()=>{
 const world=worldFrom([field({stations:[{...field().stations[0]!,launchX:200,launchY:200,launchVx:5},{...field().stations[0]!,id:'home-1',ownerId:1,teamId:1,x:235,y:260,launchX:235,launchY:260,launchVx:0}],switches:[{id:'arc-cache',x:270,y:200,radius:20,layer:0,elevation:0,gateIds:[],holdTicks:1000}]})]);
 const session=createPinballSession(world,{mode:'battle-royale',scorePressure:null,crates:[{id:'cache',admission:{kind:'switch',mechanismId:'arc-cache'},pool:[{itemId:'arc-field',weight:1}],medkits:0}]},options);let claimTick=0,hitTick=0;
 for(let tick=1;tick<=20;tick++){const f=session.step(tick===1?[{ownerId:0,bits:4},{ownerId:1,bits:4}]:[]);if(f.events.some(e=>e.type==='crate-open')){claimTick=tick;assert(!f.events.some(e=>e.type==='equipment-hit'));}if(f.events.some(e=>e.type==='equipment-hit'))hitTick=tick;}
 assert(claimTick>1);assert.equal(hitTick,claimTick+1);
});

test('healing point presentation reads each owner native cooldown without changing rules or saved state',()=>{
 const world=worldFrom([field({stations:[{...field().stations[0]!,launchX:200,launchY:200,launchVx:0}],switches:[{id:'heal-switch',x:200,y:200,radius:20,layer:0,elevation:0,gateIds:[],holdTicks:1}],hazards:[{id:'wound',kind:'damage',x:200,y:200,radius:20,layer:0,elevation:0,damage:2,cooldownTicks:1000}]})]),rules:PinballSessionRules={mode:'roguelike-solo',healingPoints:[{id:'fountain',admission:{kind:'switch',mechanismId:'heal-switch'},amount:2,cooldownTicks:120}]},options={players:[player()],maxTicks:1000},session=createPinballSession(world,rules,options);
 assert.equal(session.readHealingPointStates(0)[0]!.available,true);assert.throws(()=>session.readHealingPointStates(99));
 const first=session.step([{ownerId:0,bits:4}]);assert(first.events.some(e=>e.type==='healing-point'));assert.equal(session.readHealingPointStates(0)[0]!.remainingTicks,120);assert.equal(session.readHealingPointStates(0)[0]!.lastClaimTick,1);
 for(let tick=2;tick<=60;tick++)session.step();const saved=session.snapshot(),states=session.readHealingPointStates(0);assert.equal(states[0]!.remainingTicks,61);assert.equal(states[0]!.available,false);assert(Object.isFrozen(states)&&Object.isFrozen(states[0])&&Object.isFrozen(states[0]!.admission));assert.deepEqual(session.snapshot(),saved);
 const restored=createPinballSession(world,rules,options);restored.restore(saved);assert.deepEqual(restored.readHealingPointStates(0),states);
 for(let tick=61;tick<=120;tick++){assert.deepEqual(restored.step(),session.step());assert.deepEqual(restored.readHealingPointStates(0),session.readHealingPointStates(0));}
 assert.equal(session.readHealingPointStates(0)[0]!.remainingTicks,1);assert(session.step().events.some(e=>e.type==='healing-point'));assert.equal(session.readHealingPointStates(0)[0]!.remainingTicks,120);
});
