import {sha256,toHex} from '@keel-engine/codec/hash';
import {createArenaMatch,ARENA_AUTHORITY_REVISION,ARENA_KERNEL_SHA256,type ArenaEvent,type ArenaWorldDefinition,type ArenaPlayer} from '@keel-engine/pinball-arena';
import type {ArcadeAssemblyPlan} from './arcade-script.ts';
import {compileForkBasin,compileTerraceSwitchback,compileLoopGallery,measureArcadeCatch,measureArcadeDownstreamCatch,arcadeFragmentProbeWorld,type ArcadeAssemblyCompileOptions,type ArcadeAssemblyFragment} from './arcade-compiler.ts';

export interface ArcadeInputSpan {readonly fromTick:number;readonly toTick:number;readonly bits:number}
export interface ArcadeRouteReceipt {
 readonly ticks:number;readonly inputs:readonly ArcadeInputSpan[];readonly targetRouteId:string|null;readonly completed:boolean;
 readonly events:readonly ArenaEvent[];readonly digest:string;readonly contactBudget:number;readonly maximumSlowTicks:number;
 readonly firstBladeTick:number|null;readonly firstRecoveryBladeId:string|null;readonly failure:string|null;
}
export interface ArcadeQualifiedAssembly {
 readonly status:'physically-qualified-assembly';readonly authority:string;readonly kernel:string;
 readonly fragment:ArcadeAssemblyFragment;readonly world:ArenaWorldDefinition;readonly player:ArenaPlayer;
 readonly baseline:ArcadeRouteReceipt;
 readonly windows:readonly {readonly routeId:string;readonly bits:1|3;readonly fromTick:number;readonly toTick:number;readonly holdTicks:120;readonly witnesses:readonly ArcadeRouteReceipt[]}[];
 readonly rejected:readonly {readonly attempt:number;readonly reason:string}[];
 readonly pending:readonly ['wide-tall-visibility','shared-bank-merges','connected-junctions','compound-goal-cut'];
}
const hash=(bytes:Uint8Array)=>toHex(sha256(bytes));
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
export function replayArcadeRoute(world:ArenaWorldDefinition,player:ArenaPlayer,inputs:readonly ArcadeInputSpan[],ticks:number,targetRouteId:string|null=null):ArcadeRouteReceipt{
 if(!Number.isSafeInteger(ticks)||ticks<1||ticks>2400||inputs.length>16||inputs.some(s=>!Number.isSafeInteger(s.fromTick)||!Number.isSafeInteger(s.toTick)||s.fromTick<1||s.toTick<s.fromTick||s.toTick>ticks||!Number.isSafeInteger(s.bits)||s.bits<0||s.bits>63))throw new Error('Arcade tape bounds');
 const match=createArenaMatch(world,{players:[player],mode:'expedition',defeatPolicy:'eliminate',maxTicks:2400}),events:ArenaEvent[]=[];let firstBladeTick:number|null=null,firstRecoveryBladeId:string|null=null,contactBudget=0,slow=0,maximumSlowTicks=0,failure:string|null=null,routeReady=false;
 for(let tick=1;tick<=ticks;tick++){
  const bits=inputs.reduce((sum,s)=>tick>=s.fromTick&&tick<=s.toTick?sum|s.bits:sum,0),frame=match.step([{ownerId:player.ownerId,bits}]),ball=frame.balls[0]!;contactBudget+=match.getStats().contactBudget;slow=ball.active&&Math.hypot(ball.vx,ball.vy)<.15?slow+1:0;maximumSlowTicks=Math.max(maximumSlowTicks,slow);
  if(contactBudget&&!failure)failure='contact-budget';
  for(const event of frame.events){if(event.type!=='rail'&&event.type!=='lease'&&event.type!=='mechanism-actuate')events.push(event);if(event.type==='flipper'){firstBladeTick??=tick;if(routeReady&&firstRecoveryBladeId===null)firstRecoveryBladeId=event.colliderId!;}
   if(['ramp-abort','fall','escape','drain','eliminated'].includes(event.type)&&!failure)failure=event.type;
  }
  if(targetRouteId){const progress=frame.routeProgress.find(p=>p.ownerId===player.ownerId&&p.routeId===targetRouteId),challenge=world.arenas[0]!.challenges!.find(c=>c.id===targetRouteId)!;routeReady=!!progress&&progress.nextCheckpoint>=challenge.checkpoints.length-1;
   if(firstRecoveryBladeId&&firstRecoveryBladeId!==challenge.finalColliderId&&!failure)failure='wrong-first-receiving-blade';
   if(progress?.completed)return {ticks:tick,inputs,targetRouteId,completed:true,events,digest:hash(match.snapshot()),contactBudget,maximumSlowTicks,firstBladeTick,firstRecoveryBladeId,failure};
  }
 }
 return {ticks,inputs,targetRouteId,completed:false,events,digest:hash(match.snapshot()),contactBudget,maximumSlowTicks,firstBladeTick,firstRecoveryBladeId,failure};
}
/** Bounded rejection/retry admits only an actual assembly's two route windows.
 * It deliberately does not admit the planned multi-chamber or100-owner world. */
export function qualifyArcadeAssembly(plan:ArcadeAssemblyPlan,options:Omit<ArcadeAssemblyCompileOptions,'attempt'|'bindings'>&{readonly maxAttempts?:number}):ArcadeQualifiedAssembly{
 const maxAttempts=options.maxAttempts??8;if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>32)throw new Error('Arcade attempt budget');const rejected:{attempt:number;reason:string}[]=[];
 const ownerId=plan.banks[options.bankIndex??0]!.launchOwnerId??0,player:ArenaPlayer={ownerId,teamId:ownerId,name:'ASSEMBLY QUALIFICATION',role:'vector',bot:false,ballRadius:12},build=plan.family==='fork-basin'?compileForkBasin:plan.family==='terrace-switchback'?compileTerraceSwitchback:compileLoopGallery;
 for(let attempt=0;attempt<maxAttempts;attempt++)try{
  const compileOptions={...options,attempt},measured=measureArcadeCatch(plan,compileOptions),fragment=build(plan,{...compileOptions,bindings:measured.bindings});if(fragment.staticIssues.length)throw new Error(`static:${fragment.staticIssues[0]!.code}`);
  const world=arcadeFragmentProbeWorld(fragment),baseline=replayArcadeRoute(world,player,[{fromTick:1,toTick:1,bits:4}],1000);
  if(baseline.firstBladeTick===null||baseline.contactBudget||baseline.events.some(e=>e.type==='route-complete'))throw new Error('Shooter-only main credit or no usable blade');
  const windows=[];
  for(const [family,ray]of Object.entries(measured.bindings)){const routeId=plan.shots.find(s=>s.sourceBanks.includes(options.bankIndex??0)&&s.family===(family==='orbit'?'ground-orbit':'elevated-cross-return'))!.id,witnesses:ArcadeRouteReceipt[]=[];
   for(let start=ray.startTick;start<ray.startTick+8;start++){const receipt=replayArcadeRoute(world,player,[{fromTick:1,toTick:1,bits:4},{fromTick:start,toTick:start+119,bits:ray.bits}],2000,routeId);if(!receipt.completed||receipt.failure||receipt.maximumSlowTicks>=180)throw new Error(`${family} start${start}: ${receipt.failure??'route-not-completed'}`);witnesses.push(receipt);}
   if(family==='cross'){const descents=fragment.field.ramps.filter(r=>r.id.startsWith(plan.shots.find(s=>s.id===routeId)!.sharedRouteId)&&r.toElevation<r.fromElevation);if(!descents.length||descents.some(r=>!witnesses.every(w=>w.events.some(e=>e.type==='ramp-exit'&&e.colliderId===r.id))))throw new Error('Actual cross descent exit absent');}
   windows.push({routeId,bits:ray.bits,fromTick:ray.startTick,toTick:ray.startTick+7,holdTicks:120 as const,witnesses});
  }
  return freeze({status:'physically-qualified-assembly' as const,authority:ARENA_AUTHORITY_REVISION,kernel:ARENA_KERNEL_SHA256,fragment,world,player,baseline,windows,rejected,pending:['wide-tall-visibility','shared-bank-merges','connected-junctions','compound-goal-cut'] as const});
 }catch(error){rejected.push({attempt,reason:String(error)});}
 throw new Error(`No admitted ${plan.family} assembly: ${rejected.map(r=>`${r.attempt}:${r.reason}`).join('; ')}`);
}

export interface ArcadeRecoveryReceipt {
 readonly stationId:string;readonly receivingTick:number;readonly leasedTick:number;readonly delayTicks:number;readonly holdTicks:30;readonly observedTicks:120;
 readonly controlledBladeIds:readonly string[];readonly controlledContact:boolean;readonly digest:string;
}
/** Recovery credit requires a real receiving lease and a bounded legal next
 * input which moves those blades while the ball remains supported/alive. */
export function qualifyArcadeRecovery(world:ArenaWorldDefinition,player:ArenaPlayer,receipt:ArcadeRouteReceipt):ArcadeRecoveryReceipt{
 const field=world.arenas[0]!,route=field.challenges?.find(r=>r.id===receipt.targetRouteId),station=field.stations.find(s=>s.flipperIds.includes(route?.finalColliderId??''));
 if(!receipt.completed||!station)throw new Error('Receiving station absent');
 const match=createArenaMatch(world,{players:[player],mode:'expedition',defeatPolicy:'eliminate',maxTicks:2400});
 for(let tick=1;tick<=receipt.ticks;tick++)match.step([{ownerId:player.ownerId,bits:receipt.inputs.reduce((bits,s)=>tick>=s.fromTick&&tick<=s.toTick?bits|s.bits:bits,0)}]);
 let leasedTick=receipt.ticks,frame=match.readFrame();
 const leased=()=>frame.balls.some(b=>b.ownerId===player.ownerId&&b.stationId===station.id)&&frame.stations.some(s=>s.id===station.id&&s.ownerId===player.ownerId);
 if(!leased()){frame=match.step([{ownerId:player.ownerId,bits:0}]);leasedTick++;}
 if(!leased())throw new Error(`Receiving bank not controllable:${station.id}@${receipt.ticks}`);
 const snapshot=match.snapshot();
 for(const delayTicks of [0,10,20]){
  match.restore(snapshot);const controlled=new Set<string>();let failed=false,controlledContact=false;
  for(let step=1;step<=120;step++){
   const held=step>delayTicks&&step<=delayTicks+30;frame=match.step([{ownerId:player.ownerId,bits:held?3:0}]);
   if(match.getStats().contactBudget||frame.events.some(e=>['fall','escape','ramp-abort','drain','eliminated'].includes(e.type))){failed=true;break;}
   if(held)for(const blade of frame.flippers)if(station.flipperIds.includes(blade.id)&&blade.ownerId===player.ownerId&&Math.abs(blade.angle-field.flippers.find(b=>b.id===blade.id)!.restAngle)>.1)controlled.add(blade.id);
   if(held&&frame.events.some(e=>e.type==='flipper'&&controlled.has(e.colliderId!)))controlledContact=true;
  }
  if(!failed&&controlled.size)return {stationId:station.id,receivingTick:receipt.ticks,leasedTick,delayTicks,holdTicks:30,observedTicks:120,controlledBladeIds:[...controlled].sort(),controlledContact,digest:hash(match.snapshot())};
 }
 throw new Error(`No safe legal receiving continuation:${station.id}@${receipt.ticks}`);
}

export interface ArcadeQualifiedCascade {
 readonly status:'physically-qualified-cascade';readonly authority:string;readonly kernel:string;
 readonly fragment:ArcadeAssemblyFragment;readonly world:ArenaWorldDefinition;readonly player:ArenaPlayer;
 readonly baseline:ArcadeRouteReceipt;readonly passiveArrival:ArcadeRouteReceipt;readonly passiveArrivalRecovery:ArcadeRecoveryReceipt;readonly unactuatedReturn:ArcadeRouteReceipt;readonly unactuatedAlternative:ArcadeRouteReceipt|null;
 readonly windows:readonly {readonly role:'ground-orbit'|'lower-to-upper-to-lower'|'upper-catch-return'|'upper-local-orbit';readonly routeId:string;readonly fromTick:number;readonly toTick:number;readonly witnesses:readonly ArcadeRouteReceipt[];readonly recoveries:readonly ArcadeRecoveryReceipt[]}[];
 readonly rejected:readonly {readonly attempt:number;readonly reason:string}[];
 readonly pending:readonly ['wide-tall-visibility','shared-bank-merges','connected-junctions','compound-goal-cut'];
}
/** An actual two-bank circuit. Both independently shifted input windows must
 * retain the upper receiving bank, real elevated descent, and lower recovery.
 * This narrow admission never stands in for an entire script/world topology. */
export function qualifyArcadeTerraceCascade(plan:ArcadeAssemblyPlan,options:Omit<ArcadeAssemblyCompileOptions,'attempt'|'bindings'|'downstreamBinding'|'terraceCascade'>&{readonly maxAttempts?:number;readonly requireUpperChoices?:boolean}):ArcadeQualifiedCascade{
 const maxAttempts=options.maxAttempts??8;if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>32)throw new Error('Arcade attempt budget');
 const rejected:{attempt:number;reason:string}[]=[],ownerId=plan.banks[options.bankIndex??0]!.launchOwnerId??0,player:ArenaPlayer={ownerId,teamId:ownerId,name:'CASCADE QUALIFICATION',role:'vector',bot:false,ballRadius:12};
 for(let attempt=0;attempt<maxAttempts;attempt++)try{
  const measured=measureArcadeDownstreamCatch(plan,{...options,attempt,framing:'none'}),alternative=options.requireUpperChoices?measureArcadeDownstreamCatch(plan,{...options,attempt,framing:'none'},1).downstreamBinding:null,fragment=compileTerraceSwitchback(plan,{...options,attempt,bindings:measured.first.bindings,terraceCascade:true,downstreamBinding:measured.downstreamBinding,...(alternative?{downstreamAlternative:alternative}:{})});
  if(fragment.staticIssues.length)throw new Error(`static:${fragment.staticIssues[0]!.code}`);
  const world=arcadeFragmentProbeWorld(fragment),launch={fromTick:1,toTick:1,bits:4},baseline=replayArcadeRoute(world,player,[launch],1000),first=measured.first.bindings.cross,second=measured.downstreamBinding,orbitId=plan.shots.find(s=>s.family==='ground-orbit'&&s.sourceBanks.includes(options.bankIndex??0))!.id,upperId=plan.shots.find(s=>s.family==='elevated-cross-return'&&s.sourceBanks.includes(options.bankIndex??0))!.id,returnId=`${plan.id}.terrace.return.route`;
  if(baseline.firstBladeTick===null||baseline.contactBudget||baseline.events.some(e=>e.type==='route-complete'))throw new Error('Cascade shooter-only credit or missing catch');
  const passiveArrival=replayArcadeRoute(world,player,[launch,{fromTick:first.startTick,toTick:first.startTick+119,bits:first.bits}],1600,upperId);
  if(!passiveArrival.completed||passiveArrival.failure)throw new Error(`Unsupported upper arrival:${passiveArrival.failure??'missing'}`);
  const passiveArrivalRecovery=qualifyArcadeRecovery(world,player,passiveArrival);
  const noSecond=replayArcadeRoute(world,player,[launch,{fromTick:first.startTick,toTick:first.startTick+119,bits:first.bits}],1600,returnId);
  if(noSecond.completed)throw new Error('Unactuated upper bank earned downstream route');
  if(noSecond.failure&&noSecond.failure!=='drain')throw new Error(`Unsafe unactuated upper return:${noSecond.failure}`);
  const localId=`${plan.id}.terrace.local-orbit.route`,unactuatedAlternative=alternative?replayArcadeRoute(world,player,[launch,{fromTick:first.startTick,toTick:first.startTick+119,bits:first.bits}],1600,localId):null;
  if(unactuatedAlternative?.completed)throw new Error('Unactuated upper bank earned local orbit');
  if(unactuatedAlternative?.failure&&unactuatedAlternative.failure!=='drain')throw new Error(`Unsafe unactuated upper local catch:${unactuatedAlternative.failure}`);
  const windows:ArcadeQualifiedCascade['windows'][number][]=[];
  for(const role of (alternative?['ground-orbit','lower-to-upper-to-lower','upper-catch-return','upper-local-orbit']:['ground-orbit','lower-to-upper-to-lower','upper-catch-return']) as readonly ArcadeQualifiedCascade['windows'][number]['role'][]){const ray=role==='ground-orbit'?measured.first.bindings.orbit:role==='upper-local-orbit'?alternative!:role==='upper-catch-return'?second:first,routeId=role==='ground-orbit'?orbitId:role==='upper-local-orbit'?localId:returnId,witnesses:ArcadeRouteReceipt[]=[],recoveries:ArcadeRecoveryReceipt[]=[];
   for(let start=ray.startTick;start<ray.startTick+8;start++){
    const inputs=role==='ground-orbit'?[launch,{fromTick:start,toTick:start+119,bits:ray.bits}]:[launch,{fromTick:role==='lower-to-upper-to-lower'?start:first.startTick,toTick:(role==='lower-to-upper-to-lower'?start:first.startTick)+119,bits:first.bits},{fromTick:role==='upper-catch-return'||role==='upper-local-orbit'?start:second.startTick,toTick:(role==='upper-catch-return'||role==='upper-local-orbit'?start:second.startTick)+119,bits:role==='upper-local-orbit'?alternative!.bits:second.bits}],receipt=replayArcadeRoute(world,player,inputs,2000,routeId);
    if(!receipt.completed||receipt.failure||receipt.maximumSlowTicks>=180)throw new Error(`${role} start${start}:${receipt.failure??'route-not-completed'}`);
    if(role!=='ground-orbit'){
     if(!receipt.events.some(e=>e.type==='route-complete'&&e.colliderId===upperId)||!receipt.events.some(e=>e.type==='flipper'&&e.colliderId===`${plan.id}.terrace.bank.0.catch.right`))throw new Error('Actual upper bank transition absent');
     const descents=fragment.field.ramps.filter(r=>r.id.startsWith(`${plan.id}.terrace.return`)&&r.toElevation<r.fromElevation);
     if(role!=='upper-local-orbit'&&(!descents.length||descents.some(r=>!receipt.events.some(e=>e.type==='ramp-exit'&&e.colliderId===r.id))))throw new Error('Cascade physical descent absent');
    }
    const scoop=fragment.field.captures?.find(c=>c.id===`${plan.id}.lower.return-scoop`);if(scoop&&role!=='upper-local-orbit'){const enters=receipt.events.filter(e=>e.type==='capture-enter'&&e.mechanismId===scoop.id),releases=receipt.events.filter(e=>e.type==='capture-release'&&e.mechanismId===scoop.id);if(enters.length!==1||releases.length!==1||releases[0]!.tick-enters[0]!.tick!==scoop.captureTicks+scoop.travelTicks||!receipt.events.some(e=>e.type==='switch'&&e.colliderId===`${scoop.id}.rollover`)||receipt.events.some(e=>e.type==='exit-blocked'))throw new Error('Actual shared scoop cycle absent or blocked');}
    recoveries.push(qualifyArcadeRecovery(world,player,receipt));witnesses.push(receipt);
   }windows.push({role,routeId,fromTick:ray.startTick,toTick:ray.startTick+7,witnesses,recoveries});
  }
  return freeze({status:'physically-qualified-cascade' as const,authority:ARENA_AUTHORITY_REVISION,kernel:ARENA_KERNEL_SHA256,fragment,world,player,baseline,passiveArrival,passiveArrivalRecovery,unactuatedReturn:noSecond,unactuatedAlternative,windows,rejected,pending:['wide-tall-visibility','shared-bank-merges','connected-junctions','compound-goal-cut'] as const});
 }catch(error){rejected.push({attempt,reason:String(error)});}
 throw new Error(`No admitted terrace cascade: ${rejected.map(r=>`${r.attempt}:${r.reason}`).join('; ')}`);
}
