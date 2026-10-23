import {normalizeSeed} from '@keel-engine/core/rng';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {createArenaMatch,validateArenaWorld,ARENA_AUTHORITY_REVISION,ARENA_KERNEL_SHA256,ARENA_CONTENT_LIMITS,type ArenaWorldDefinition,type ArenaPlayer,type ArenaEvent} from '@keel-engine/pinball-arena';
import {compilePinballMachine,type PinballMachineRecipe,type PinballShotBinding} from './machine.ts';
import {inspectPinballGeometry} from './admission-geometry.ts';
export const PINBALL_COMPILER_REVISION='procedural-pinball/2026-10-07.2';
const hash=(value:unknown)=>toHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export interface PinballInputSpan {/** Completed simulation ticks, inclusive and one-based. */ readonly fromTick:number;readonly toTick:number;readonly bits:number}
export interface PinballShotReceipt {readonly routeId:string|null;readonly ticks:number;readonly inputs:readonly PinballInputSpan[];readonly events:readonly ArenaEvent[];readonly digest:string;readonly contactBudget:number;readonly firstCatchTick:number|null;readonly maximumSlowTicks:number;readonly failure:string|null}
export interface PinballTimingWindow {readonly fromTick:number;readonly toTick:number;readonly bits:1|3;readonly holdTicks:120;readonly witnesses:readonly PinballShotReceipt[]}
export interface PinballControlReceipt extends PinballShotReceipt {readonly control:{readonly flipperId:string;readonly contactTick:number;readonly vx:number;readonly vy:number;readonly returnColliderId:string;readonly returnTick:number}}
export interface QualifiedPinballMachine {readonly schema:'keel-qualified-pinball-machine@1';readonly compiler:string;readonly authority:string;readonly kernel:string;readonly recipe:PinballMachineRecipe;readonly world:ArenaWorldDefinition;readonly players:readonly ArenaPlayer[];readonly admission:{readonly ballRadius:12;readonly staticIssues:readonly never[];readonly baseline:PinballShotReceipt;readonly orbit:PinballShotReceipt;readonly crossReturn:PinballShotReceipt;readonly rightControl:PinballControlReceipt;readonly orbitWindow:PinballTimingWindow;readonly crossReturnWindow:PinballTimingWindow};readonly rejected:readonly {readonly attempt:number;readonly reason:string}[]}
export interface PinballQualificationOptions {readonly maxAttempts?:number;readonly variation?:boolean;readonly maxPairs?:number}
export class PinballGenerationError extends Error {readonly seed:string;readonly rejected:readonly {readonly attempt:number;readonly reason:string}[];constructor(seed:string,rejected:readonly {readonly attempt:number;readonly reason:string}[]){super(`No physically qualified pinball candidate for ${seed}: ${rejected.map(r=>`${r.attempt}:${r.reason}`).join('; ')}`);this.name='PinballGenerationError';this.seed=seed;this.rejected=rejected;}}
const player:ArenaPlayer={ownerId:0,teamId:0,name:'QUALIFICATION',role:'vector',bot:false,ballRadius:12};
/** Identity contains all mechanical recipe output, not cosmetic renderer state. */
export function createPinballCandidateWorld(recipe:PinballMachineRecipe):ArenaWorldDefinition {
 const field=compilePinballMachine(recipe),body={schema:'keel-pinball-arena-world@1' as const,generatorVersion:PINBALL_COMPILER_REVISION,id:`${recipe.id}.world`,seed:normalizeSeed(recipe.seed),unitScale:.025,arenas:[field],links:[]};
 const world={...body,canonical:JSON.stringify(body),sha256:hash(body)};validateArenaWorld(world);return freeze(world);
}
export function replayPinballReceipt(world:ArenaWorldDefinition,receipt:Pick<PinballShotReceipt,'inputs'|'ticks'>):PinballShotReceipt {
 if(!Number.isSafeInteger(receipt.ticks)||receipt.ticks<1||receipt.ticks>3600||!Array.isArray(receipt.inputs)||receipt.inputs.length>16)throw new Error('Invalid pinball receipt budget');
 const inputs=receipt.inputs.map(span=>{if(!span||!Number.isSafeInteger(span.fromTick)||!Number.isSafeInteger(span.toTick)||span.fromTick<1||span.toTick<span.fromTick||span.toTick>receipt.ticks||!Number.isSafeInteger(span.bits)||span.bits<0||span.bits>63)throw new Error('Invalid pinball receipt span');return {...span};});
 return simulate(world,inputs,receipt.ticks,null);
}
function simulate(world:ArenaWorldDefinition,inputs:readonly PinballInputSpan[],ticks:number,target:string|null):PinballShotReceipt {
 const match=createArenaMatch(world,{players:[player],mode:'expedition',defeatPolicy:'eliminate',maxTicks:3600}),events:ArenaEvent[]=[];
 let contactBudget=0,firstCatchTick:number|null=null,slow=0,maximumSlowTicks=0,failure:string|null=null;
 for(let tick=1;tick<=ticks;tick++){
  const bits=inputs.reduce((sum,span)=>tick>=span.fromTick&&tick<=span.toTick?sum|span.bits:sum,0),frame=match.step([{ownerId:0,bits}]);
  contactBudget+=match.getStats().contactBudget;if(contactBudget&&!failure)failure='contact-budget';
  const ball=frame.balls[0]!;slow=ball.active&&Math.hypot(ball.vx,ball.vy)<.15?slow+1:0;maximumSlowTicks=Math.max(maximumSlowTicks,slow);
  for(const event of frame.events){if(event.type!=='rail'&&event.type!=='lease')events.push(event);if(event.type==='flipper'&&firstCatchTick===null)firstCatchTick=frame.tick;if(['ramp-abort','fall','escape','drain','eliminated'].includes(event.type)&&!failure)failure=event.type;}
  if(target&&frame.events.some(e=>e.type==='route-complete'&&e.colliderId===target))return {routeId:target,ticks:frame.tick,inputs,events,digest:toHex(sha256(match.snapshot())),contactBudget,firstCatchTick,maximumSlowTicks,failure};
 }
 return {routeId:null,ticks,inputs,events,digest:toHex(sha256(match.snapshot())),contactBudget,firstCatchTick,maximumSlowTicks,failure};
}
interface Mouth extends PinballShotBinding {readonly start:number;readonly bits:1|3}
function solveMouths(recipe:PinballMachineRecipe):{firstCatch:number;mouths:Mouth[]} {
 const world=createPinballCandidateWorld({...recipe,foundation:true}),baseline=simulate(world,[{fromTick:1,toTick:1,bits:4}],650,null);
 if(baseline.firstCatchTick===null||baseline.contactBudget)throw new Error('shooter cannot reach a usable blade');
 const firstCatch=baseline.firstCatchTick,start=Math.max(2,firstCatch-37),mouths:Mouth[]=[];
 for(const bits of [1,3] as const){
  const match=createArenaMatch(world,{players:[player],mode:'expedition',defeatPolicy:'eliminate',maxTicks:3600});let actuated=false,bad=false;
  for(let tick=1;tick<=firstCatch+120;tick++){
   const held=tick>=start&&tick<start+120,frame=match.step([{ownerId:0,bits:tick===1?4:held?bits:0}]);
   if(match.getStats().contactBudget||frame.events.some(e=>['ramp-abort','fall','escape','drain'].includes(e.type)))bad=true;
   if(held&&frame.events.some(e=>e.type==='flipper'&&e.colliderId===`${recipe.id}.catch.${bits===1?'left':'right'}`))actuated=true;
   const b=frame.balls[0]!;
   if(actuated&&b.y>=recipe.origin.y+400&&b.vy>6){if(!bad&&b.layer===0&&b.elevation===0&&Math.abs(b.x-recipe.origin.x)<600)mouths.push({start,bits,x:b.x-recipe.origin.x,y:b.y-recipe.origin.y,vx:b.vx,vy:b.vy});break;}
  }
 }
 return {firstCatch,mouths};
}
function solveReturnControl(world:ArenaWorldDefinition,orbit:PinballShotReceipt):PinballControlReceipt|null {
 const id=world.arenas[0]!.id,right=`${id}.catch.right`;
 for(const bitsPolicy of [2,3])for(const holdTicks of [14,28,60])for(const lead of [6,7,8,5,4,3,2,1,9,10,11,12,13,14,15,16,20,24,28,32,40,48]){
  const fromTick=orbit.ticks-lead,inputs=[...orbit.inputs,{fromTick,toTick:fromTick+holdTicks-1,bits:bitsPolicy}],match=createArenaMatch(world,{players:[player],mode:'expedition',defeatPolicy:'eliminate',maxTicks:3600}),events:ArenaEvent[]=[];
  let contact:null|{flipperId:string;contactTick:number;vx:number;vy:number}=null,contactBudget=0,slow=0,maximumSlowTicks=0,firstCatchTick:number|null=null,bad=false;
  for(let tick=1;tick<=Math.min(2200,orbit.ticks+700);tick++){
   const bits=inputs.reduce((sum,span)=>tick>=span.fromTick&&tick<=span.toTick?sum|span.bits:sum,0),frame=match.step([{ownerId:0,bits}]),ball=frame.balls[0]!;
   contactBudget+=match.getStats().contactBudget;if(frame.events.some(e=>['ramp-abort','fall','escape','drain','eliminated'].includes(e.type)))bad=true;slow=ball.active&&Math.hypot(ball.vx,ball.vy)<.15?slow+1:0;maximumSlowTicks=Math.max(maximumSlowTicks,slow);
   for(const e of frame.events){if(e.type!=='rail'&&e.type!=='lease')events.push(e);if(e.type==='flipper'&&firstCatchTick===null)firstCatchTick=tick;if(['ramp-abort','fall','escape','drain','eliminated'].includes(e.type))bad=true;
    if(e.type==='flipper'&&e.colliderId===right&&tick>=fromTick&&(bits&2)&&ball.vy>6&&!contact)contact={flipperId:right,contactTick:tick,vx:ball.vx,vy:ball.vy};
    else if(contact&&e.type==='flipper'&&tick>contact.contactTick+8&&!bad&&!contactBudget&&maximumSlowTicks<180)return {routeId:null,ticks:tick,inputs,events,digest:toHex(sha256(match.snapshot())),contactBudget,firstCatchTick,maximumSlowTicks,failure:null,control:{...contact,returnColliderId:e.colliderId!,returnTick:tick}};
   }
   if(bad||contactBudget)break;
  }
 }
 return null;
}
/** Offline/worker compiler slice: bounded deterministic physical rejection and
 * retry. This does not yet allocate the giant shared macro or multiball locks. */
export function generateQualifiedPinballMachine(seedHex:string,options:PinballQualificationOptions={}):QualifiedPinballMachine {
 const seed=normalizeSeed(seedHex),maxAttempts=options.maxAttempts??8,maxPairs=options.maxPairs??6;
 if(options.variation!==undefined&&typeof options.variation!=='boolean'||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>8||!Number.isInteger(maxPairs)||maxPairs<1||maxPairs>8)throw new Error('Pinball qualification budget');
 const rejected:{attempt:number;reason:string}[]=[];
 for(let attempt=0;attempt<maxAttempts;attempt++){
  const base:PinballMachineRecipe={id:'pinball-machine',seed,attempt,origin:{x:2000,y:500},ownerId:0,teamId:0,centerCatch:true,deck:'wireform',...(options.variation!==undefined?{variation:options.variation}:{})};
  try{
   const {mouths}=solveMouths(base),orbit=mouths.find(m=>m.bits===1),cross=mouths.find(m=>m.bits===3);
   const pairs=orbit&&cross&&Math.hypot(orbit.x-cross.x,orbit.y-cross.y)>=120?[{orbit,cross}]:[];if(!pairs.length)throw new Error('no separated physical shot mouths');
   for(const pair of pairs){
    const recipe={...base,shotBindings:{orbit:pair.orbit,cross:pair.cross}},world=createPinballCandidateWorld(recipe),field=world.arenas[0]!;
    if(field.rails.length+field.flippers.length>ARENA_CONTENT_LIMITS.colliders||field.ramps.length>ARENA_CONTENT_LIMITS.ramps)throw new Error('global content budget');
    const issues=inspectPinballGeometry(field,{ballRadius:12});if(issues.length){rejected.push({attempt,reason:`static:${issues[0]!.code}:${issues[0]!.subject}`});continue;}
    const baseline=simulate(world,[{fromTick:1,toTick:1,bits:4}],1000,null);
    if(baseline.contactBudget||baseline.firstCatchTick===null||baseline.events.some(e=>e.type==='route-complete'&&!e.colliderId?.endsWith('launch.skillshot'))){rejected.push({attempt,reason:'launch-only main progression or unusable shooter'});continue;}
    const qualify=(mouth:Mouth,route:string):PinballTimingWindow|null=>{
     const witnesses:PinballShotReceipt[]=[];
     for(let start=mouth.start;start<mouth.start+8;start++){
      const inputs=[{fromTick:1,toTick:1,bits:4},{fromTick:start,toTick:start+119,bits:mouth.bits}],receipt=simulate(world,inputs,1400,route);
      if(receipt.routeId!==route||receipt.failure||receipt.maximumSlowTicks>=180)return null;witnesses.push(receipt);
     }
     return {fromTick:mouth.start,toTick:mouth.start+7,bits:mouth.bits,holdTicks:120,witnesses};
    };
    const orbitWindow=qualify(pair.orbit,`${base.id}.shot.orbit`);if(!orbitWindow){rejected.push({attempt,reason:'ground orbit eight-start interval rejection'});continue;}
    const crossReturnWindow=qualify(pair.cross,`${base.id}.shot.cross-return`);if(!crossReturnWindow){rejected.push({attempt,reason:'elevated cross-return eight-start interval rejection'});continue;}
    const orbit=orbitWindow.witnesses[0]!,crossReturn=crossReturnWindow.witnesses[0]!;
    const descent=field.ramps.find(r=>r.id.startsWith(`${base.id}.cross-return.slope.`)&&r.toElevation<r.fromElevation);
    if(!descent||!crossReturn.events.some(e=>e.type==='ramp-exit'&&e.colliderId===descent.id)){rejected.push({attempt,reason:'cross-return did not traverse its descent'});continue;}
    const rightControl=solveReturnControl(world,crossReturn);if(!rightControl){rejected.push({attempt,reason:'right blade return-control rejection'});continue;}
    return freeze({schema:'keel-qualified-pinball-machine@1' as const,compiler:PINBALL_COMPILER_REVISION,authority:ARENA_AUTHORITY_REVISION,kernel:ARENA_KERNEL_SHA256,recipe,world,players:[player],admission:{ballRadius:12 as const,staticIssues:[],baseline,orbit,crossReturn,rightControl,orbitWindow,crossReturnWindow},rejected});
   }
  }catch(error){rejected.push({attempt,reason:error instanceof Error?error.message:String(error)});}
 }
 throw new PinballGenerationError(seed,rejected);
}
