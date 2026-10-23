import {planPinballFraming,type PinballSceneBlueprint} from '@keel-engine/pinball-world-art';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {createArenaMatch,validateArenaWorld,type ArenaField,type ArenaWorldDefinition,type ArenaBiomeBlend,type ArenaPoint,type ArenaRouteChallenge,type ArenaHazard,type ArenaSurface,type ArenaRail,type ArenaPinballPort,type ArenaPlayer,type ArenaGate,type ArenaGateRequirement,type ArenaCapture,type ArenaSwitch} from '@keel-engine/pinball-arena';
import {compileArcadeCatch,type ArcadeCatchOptions} from './catch.ts';
import {compileTrack,cubic,type TrackVertex} from './tracks.ts';
import type {ArcadeAssemblyPlan,ArcadeShotPlan} from './arcade-script.ts';
import {createPinballBudget,countPinballMechanisms} from './budget.ts';
import {inspectPinballGeometry,type GeometryIssue} from './admission-geometry.ts';

export const ARCADE_COMPILER_REVISION='arcade-physical-compiler/2026-10-07.17';
const q=(n:number)=>Math.round(n*1024)/1024;
const hash=(v:unknown)=>toHex(sha256(new TextEncoder().encode(JSON.stringify(v))));
const themedBiome=(theme:ArcadeAssemblyPlan['framing']['theme']):ArenaBiomeBlend=>theme==='cyber'?{forge:.15,neon:.85,garden:0,glacier:0,ruins:0}:theme==='gold'?{forge:.45,neon:0,garden:0,glacier:0,ruins:.55}:theme==='vapor'?{forge:0,neon:.6,garden:0,glacier:.4,ruins:0}:theme==='nature'?{forge:0,neon:0,garden:1,glacier:0,ruins:0}:{forge:.8,neon:.2,garden:0,glacier:0,ruins:0};
export interface ArcadeRayBinding extends ArenaPoint {readonly vx:number;readonly vy:number;readonly bits:1|3;readonly startTick:number}
export interface ArcadeAssemblyBindings {readonly orbit:ArcadeRayBinding;readonly cross:ArcadeRayBinding}
export interface ArcadeBankServe {readonly bank:'basin'|'upper';readonly ownerId:number}
export interface ArcadeAssemblyCompileOptions {readonly bankServes?:readonly ArcadeBankServe[];readonly attempt:number;readonly catchActiveAngle?:number;readonly transportClearWidth?:32|40|48|64;readonly feed:ArcadeCatchOptions['feed'];readonly bindings?:ArcadeAssemblyBindings;readonly bankIndex?:number;readonly translation?:ArenaPoint;readonly terraceCascade?:boolean;readonly forkReceiver?:{readonly center:ArenaPoint;readonly attempt:number;readonly inletOffset:number;readonly upperInletOffset?:number;readonly upperReceivingBlade?:'left'|'right';readonly eastReturn?:ArcadeRayBinding;readonly basinReturnOffset?:number;readonly basinReturnBlade?:'left'|'right';readonly bindings?:ArcadeAssemblyBindings};readonly sourceRecovery?:ArcadeRayBinding;readonly normalizeUpperAlternate?:boolean;readonly upperReceivingScoop?:boolean;readonly downstreamBinding?:ArcadeRayBinding;readonly downstreamAlternative?:ArcadeRayBinding;readonly downstreamAttempt?:number;readonly downstreamSide?:-1|1;readonly downstreamSeparation?:number;readonly downstreamInletOffset?:number;readonly downstreamRestitution?:number;readonly downstreamRecoveryRestitution?:number;readonly framing?:'none'|'canonical';readonly compoundGoal?:boolean;readonly mergeRecoveries?:boolean;readonly recoveryBlade?:'left'|'right';readonly returnScoop?:boolean;readonly sceneBlueprint?:PinballSceneBlueprint;readonly sceneStage?:number;readonly cabinetSeed?:string}
export interface ArcadeCompiledPortBinding {readonly requestedPortId:string;readonly actualPortId:string;readonly requestedPose:ArenaPoint;readonly actualPose:ArenaPoint;readonly requestedReturnSide?:ArcadeShotPlan['returnSide'];readonly actualReceivingBladeId?:string;readonly requestedReceivingBladeId?:string}
export interface ArcadeAssemblyFragment {
 readonly status:'unqualified-fragment';readonly compiler:string;readonly plan:ArcadeAssemblyPlan;readonly options:ArcadeAssemblyCompileOptions;
 readonly field:ArenaField;readonly portBindings:readonly ArcadeCompiledPortBinding[];readonly staticIssues:ReturnType<typeof inspectPinballGeometry>;
}
function transform(plan:ArcadeAssemblyPlan,bankIndex:number,translation:ArenaPoint={x:0,y:0}){const bank=plan.banks[bankIndex]!,origin={x:bank.center.x+translation.x,y:bank.center.y+translation.y};
 const rotation=(p:ArenaPoint):ArenaPoint=>plan.quarterTurns===1?{x:-p.y,y:p.x}:plan.quarterTurns===2?{x:-p.x,y:-p.y}:plan.quarterTurns===3?{x:p.y,y:-p.x}:p;
 const p=(x:number,y:number,layer=plan.layer,elevation=plan.elevation):TrackVertex=>{const r=rotation({x,y});return {x:q(origin.x+r.x),y:q(origin.y+r.y),layer,elevation};};
 return {origin,p,rotation};
}
const splitRail=(id:string,a:TrackVertex,b:TrackVertex):ArenaRail[]=>{const n=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/768);return Array.from({length:n},(_,i)=>({id:`${id}.${i}`,ax:q(a.x+(b.x-a.x)*i/n),ay:q(a.y+(b.y-a.y)*i/n),bx:q(a.x+(b.x-a.x)*(i+1)/n),by:q(a.y+(b.y-a.y)*(i+1)/n),radius:3,restitution:.9,layer:a.layer,elevation:a.elevation,elevationB:b.elevation,material:'steel',kind:'guide'}));};

/** Every bank owns an open, blade-relative aiming fan. This is an authority
 * geometry check: camera orientation and transparent rendering cannot pass it.
 * Flat inlanes may approach from the sides, but no ramp or overhead track may
 * cover the fan, including tracks belonging to another layer or bank. */
export function inspectArcadeBankClearance(field:ArenaField,ballRadius=12):GeometryIssue[]{
 if(!Number.isFinite(ballRadius)||ballRadius<6||ballRadius>24)throw new Error('Bank clearance ball radius');
 const issues:GeometryIssue[]=[];
 if(field.stations.length>128||[field.rails,field.ramps,field.surfaces,field.pinball?.paths??[]].some(items=>items.length>4096)||field.surfaces.some(surface=>surface.polygon.length>64)||(field.pinball?.paths??[]).some(path=>path.vertices.length>64))return [{code:'BANK_CLEARANCE_BUDGET',subject:field.id,detail:'Bounded clearance descriptor budget exceeded.'}];
 const distance=(p:ArenaPoint,a:ArenaPoint,b:ArenaPoint)=>{const dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy,t=ll?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/ll)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
 const cross=(a:ArenaPoint,b:ArenaPoint,c:ArenaPoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const contains=(p:ArenaPoint,polygon:readonly ArenaPoint[])=>{let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[j]!,b=polygon[i]!;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;};
 const overlaps=(a:readonly ArenaPoint[],b:readonly ArenaPoint[],margin:number)=>a.some(p=>contains(p,b))||b.some(p=>contains(p,a))||a.some((p,i)=>{const q=a[(i+1)%a.length]!;return b.some((r,j)=>{const u=b[(j+1)%b.length]!;return cross(p,q,r)*cross(p,q,u)<0&&cross(r,u,p)*cross(r,u,q)<0||Math.min(distance(p,r,u),distance(q,r,u),distance(r,p,q),distance(u,p,q))<margin;});});
 for(const station of field.stations){
  const left=field.flippers.find(b=>station.flipperIds.includes(b.id)&&b.side==='left'),right=field.flippers.find(b=>station.flipperIds.includes(b.id)&&b.side==='right');if(!left||!right)continue;
  const span=Math.hypot(right.pivotX-left.pivotX,right.pivotY-left.pivotY),axis={x:(right.pivotX-left.pivotX)/span,y:(right.pivotY-left.pivotY)/span},up={x:-axis.y,y:axis.x},center={x:(left.pivotX+right.pivotX)/2,y:(left.pivotY+right.pivotY)/2};
  const local=(p:ArenaPoint)=>({x:(p.x-center.x)*axis.x+(p.y-center.y)*axis.y,y:(p.x-center.x)*up.x+(p.y-center.y)*up.y});
  const fan=[{x:-span/2,y:0},{x:span/2,y:0},{x:span/2+160,y:400},{x:-span/2-160,y:400}];
  for(const surface of field.surfaces){const heights=surface.vertexElevations??[surface.height],low=Math.min(...heights),high=Math.max(...heights);if(high<station.elevation-ballRadius*2||surface.kind!=='ramp'&&low<=station.elevation+ballRadius*2)continue;if(overlaps(surface.polygon.map(local),fan,ballRadius))issues.push({code:surface.kind==='ramp'?'BANK_PHYSICAL_RAMP':'BANK_PHYSICAL_DECK',subject:`${station.id}:${surface.id}`,detail:'Physical ramp or deck overlaps the served-ball-expanded bank fan.'});}
  for(const ramp of field.ramps){if(Math.max(ramp.fromElevation,ramp.toElevation)<station.elevation-ballRadius*2)continue;const a=local({x:ramp.ax,y:ramp.ay}),b=local({x:ramp.bx,y:ramp.by}),length=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/length*ramp.width/2,ny=(b.x-a.x)/length*ramp.width/2,polygon=[{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},{x:a.x-nx,y:a.y-ny}];if(overlaps(polygon,fan,ballRadius))issues.push({code:'BANK_PHYSICAL_RAMP',subject:`${station.id}:${ramp.id}`,detail:'Native ramp corridor overlaps the served-ball-expanded bank fan.'});}
  for(const path of field.pinball?.paths??[])for(let index=0;index<path.vertices.length-1;index++){
   const a=path.vertices[index]!,b=path.vertices[index+1]!,pa=local(a),pb=local(b),radius=Math.max(path.clearWidths?.[index]??path.clearWidth,path.clearWidths?.[index+1]??path.clearWidth)/2+ballRadius+6,length=Math.hypot(pb.x-pa.x,pb.y-pa.y),steps=Math.max(1,Math.ceil(length/8));
   if(steps>4096){issues.push({code:'BANK_CLEARANCE_BUDGET',subject:path.id,detail:'Path segment exceeds bounded inspection work.'});continue;}
   const sloped=a.elevation!==b.elevation,overhead=Math.max(a.elevation,b.elevation)>station.elevation+ballRadius*2;
   if(!sloped&&!overhead)continue;
   for(let sample=0;sample<=steps;sample++){
    const t=sample/steps,x=pa.x+(pb.x-pa.x)*t,y=pa.y+(pb.y-pa.y)*t,z=a.elevation+(b.elevation-a.elevation)*t;
    if(z<station.elevation-ballRadius*2||y+radius<0||y-radius>=400||Math.abs(x)>span/2+Math.max(0,y)*.4+radius)continue;
    issues.push({code:sloped?'BANK_AIM_RAMP':'BANK_AIM_OVERHEAD',subject:`${station.id}:${path.id}:${index}`,detail:'Track envelope intersects the open 400-unit blade-relative aiming fan.'});break;
   }
  }
  // Test the complete physical blade sweep, expanded by the served ball disk.
  for(const blade of [left,right])for(const rail of field.rails){
   if(Math.abs(rail.elevation-station.elevation)>ballRadius*2||Math.abs((rail.elevationB??rail.elevation)-station.elevation)>ballRadius*2)continue;
   const dx=rail.bx-rail.ax,dy=rail.by-rail.ay,ll=dx*dx+dy*dy;
   const reach=blade.length+blade.radius+rail.radius+ballRadius+8;if(blade.pivotX<Math.min(rail.ax,rail.bx)-reach||blade.pivotX>Math.max(rail.ax,rail.bx)+reach||blade.pivotY<Math.min(rail.ay,rail.by)-reach||blade.pivotY>Math.max(rail.ay,rail.by)+reach)continue;const subdivisions=Math.ceil(blade.length/8),samplingMargin=blade.length*Math.abs(blade.activeAngle-blade.restAngle)*Math.PI/180/48+4;
   let hit=false;for(let angle=0;angle<=24&&!hit;angle++){const radians=(blade.restAngle+(blade.activeAngle-blade.restAngle)*angle/24)*Math.PI/180;for(let sample=0;sample<=subdivisions;sample++){const distance=blade.length*sample/subdivisions,x=blade.pivotX+Math.cos(radians)*distance,y=blade.pivotY+Math.sin(radians)*distance,t=ll?Math.max(0,Math.min(1,((x-rail.ax)*dx+(y-rail.ay)*dy)/ll)):0;if(rail.id.startsWith(`${station.id}.outer-`)&&distance<=blade.radius+rail.radius+ballRadius+samplingMargin)continue;if(Math.hypot(x-rail.ax-t*dx,y-rail.ay-t*dy)<blade.radius+rail.radius+ballRadius+samplingMargin){hit=true;break;}}}
   if(hit)issues.push({code:'BANK_BLADE_SWEEP',subject:`${blade.id}:${rail.id}`,detail:'Rail overlaps a complete blade sweep expanded by the served ball disk.'});
  }
 }
 return issues.slice(0,256);
}

/** Only physical fragments are emitted here. Callers cannot treat this status as
 * an admitted world: shared-bank merges, connectors, goal cuts and legal tapes
 * are separate compile/qualification work. No whole cabinet is cloned. */
function compileFamily(plan:ArcadeAssemblyPlan,options:ArcadeAssemblyCompileOptions):ArcadeAssemblyFragment{
 const transportWidth=options.transportClearWidth??32;if(![32,40,48,64].includes(transportWidth))throw new Error('Transport clearance profile');if(options.downstreamSide!==undefined&&![-1,1].includes(options.downstreamSide))throw new Error('Downstream receiver side');
 if(options.downstreamSeparation!==undefined&&(!Number.isFinite(options.downstreamSeparation)||options.downstreamSeparation<700||options.downstreamSeparation>1400))throw new Error('Downstream chamber separation');
 if(!['fork-basin','terrace-switchback','loop-gallery'].includes(plan.family))throw new Error('Arcade physical family capability absent');
 const bankIndex=options.bankIndex??0;if(!plan.banks[bankIndex])throw new Error('Arcade bank absent');
 // This first emission slice must not silently omit requested shared banks.
 if(plan.bankCount!==1)throw new Error('Shared upper route merge is not yet physically qualified');
 const biome=options.sceneBlueprint?.biome??themedBiome(plan.framing.theme),foundation=compileArcadeCatch(plan,{bankIndex,attempt:options.attempt,feed:options.feed,biome,trackClearWidth:transportWidth,...(options.catchActiveAngle===undefined?{}:{activeAngle:options.catchActiveAngle}),...(options.translation?{translation:options.translation}:{})}),{p,origin,rotation}=transform(plan,bankIndex,options.translation),routes=plan.shots.filter(s=>s.sourceBanks.includes(bankIndex)),orbitRequest=routes.find(s=>s.family==='ground-orbit')!,crossRequest=routes.find(s=>s.family==='elevated-cross-return')!;
 if(!orbitRequest||!crossRequest)throw new Error('Two physical main shot requests absent');
 const switches:ArenaSwitch[]=[],captures:ArenaCapture[]=[],gates:ArenaGate[]=[],requirements:ArenaGateRequirement[]=[],flippers=[...foundation.flippers],stations=[...foundation.stations],flows=[...foundation.flows],rails=[...foundation.rails],surfaces=[...foundation.surfaces],hazards=[...foundation.hazards],paths=[...foundation.paths],ports=[...foundation.ports],ramps=[...foundation.ramps],challenges:ArenaRouteChallenge[]=[],portBindings:ArcadeCompiledPortBinding[]=[];
 const chamberBoundaries:{id:string;vertices:readonly TrackVertex[]}[]=[];
 const bindings=options.bindings;
 if(bindings){
  const steps=Math.max(8,Math.min(16,orbitRequest.bendCount*2)),family=plan.family,width=plan.silhouette.width,height=plan.silhouette.height,left=width*plan.silhouette.leftShoulder*.75,right=width*plan.silhouette.rightShoulder*.6;
  const orbit=bindings.orbit,cross=bindings.cross,os=Math.hypot(orbit.vx,orbit.vy),cs=Math.hypot(cross.vx,cross.vy);if(os<6||cs<6)throw new Error('Measured outgoing rays too weak');
  const crest=options.feed==='peripheral'?Math.max(orbit.y+180,Math.min(height-120,orbit.y+orbit.vy*orbit.vy/(2*.04)*.55)):Math.max(orbit.y+400,Math.min(height-120,orbit.y+os*os/(2*.04)*.42)),receiverX=orbitRequest.returnSide==='same'?-125:125,orbitReceiver=Math.sign(receiverX),crossReceiver=options.downstreamSide??(crossRequest.returnSide==='same'?1:-1);
  // Mirror the entire outer turn and receiving guide when the plan requests
  // the opposite bank. A final-collider label cannot repair a left-only return.
  const returnShoulder=orbitReceiver<0?left:right,oppositeShoulder=orbitReceiver<0?right:left,sharedRecovery=options.mergeRecoveries&&options.terraceCascade&&orbitReceiver===crossReceiver?compileTrack({id:`${plan.id}.lower.shared-recovery`,role:'inlane',vertices:[p(orbitReceiver*500,options.feed==='peripheral'?440:600),p(orbitReceiver*500,options.feed==='peripheral'?400:460),...(options.feed==='peripheral'?cubic({x:orbitReceiver*500,y:400},{x:orbitReceiver*500,y:300},{x:orbitReceiver*180,y:300},{x:orbitReceiver*180,y:160},8).slice(1).map(v=>p(v.x,v.y)):[...cubic({x:orbitReceiver*500,y:460},{x:orbitReceiver*500,y:260},{x:orbitReceiver*60,y:320},{x:orbitReceiver*60,y:220},8).slice(1).map(v=>p(v.x,v.y)),p(orbitReceiver*60,120)])],clearWidth:64,...(options.forkReceiver?{clearWidths:Array.from({length:10},(_,i)=>i===0?80:64)}:{}),restitution:options.downstreamRecoveryRestitution??.8,deck:'solid',biome,receiverCatchId:foundation.spec.id}):null;
  if(options.mergeRecoveries&&!sharedRecovery)throw new Error('Shared recovery requires convergent lower receiving sides');
  if(sharedRecovery){rails.push(...sharedRecovery.rails);surfaces.push(...sharedRecovery.surfaces);paths.push(sharedRecovery.path);ports.push(...sharedRecovery.ports);}
  if(sharedRecovery&&options.feed==='peripheral'){const basin=[[780,710],[options.forkReceiver?260:340,710],[options.forkReceiver?460:465,440],[options.forkReceiver?540:535,440]].map(([x,y])=>p(orbitReceiver*x!,y!));surfaces.push({id:`${plan.id}.lower.merge-basin`,kind:'playfield',role:'catch',polygon:basin,layer:plan.layer,height:plan.elevation,material:'pinball-inlay',biome});rails.push(...[...splitRail(`${plan.id}.lower.merge-basin.outer`,basin[0]!,basin[3]!),...splitRail(`${plan.id}.lower.merge-basin.inner`,basin[1]!,basin[2]!)].map(rail=>({...rail,restitution:.3})));}
  if(sharedRecovery&&options.feed==='peripheral'&&options.returnScoop!==false){
   const id=`${plan.id}.lower.return-scoop`,entry=p(orbitReceiver*500,450),exit=p(orbitReceiver*500,420),tangent=rotation({x:0,y:-1}),gateA=p(orbitReceiver*500-(options.forkReceiver?38:34),480),gateB=p(orbitReceiver*500+(options.forkReceiver?38:34),480),gateId=`${id}.shutter`;
   const trigger=p(orbitReceiver*500,550);switches.push({id:`${id}.rollover`,x:trigger.x,y:trigger.y,radius:80,layer:plan.layer,elevation:plan.elevation,gateIds:[gateId],holdTicks:240});
   gates.push({id:gateId,ax:gateA.x,ay:gateA.y,bx:gateB.x,by:gateB.y,radius:3,restitution:.3,layer:plan.layer,elevation:plan.elevation,initiallyOpen:true,kind:'door'});
   const common={mechanismId:id,layer:plan.layer,elevation:plan.elevation,tangent,clearWidth:64,direction:'forward' as const,maxBallRadius:12,admittedSpeed:{min:0,max:18},receiverCatchId:foundation.spec.id};
   ports.push({...common,clearWidth:options.forkReceiver?72:64,id:`${id}.entry`,role:'capture-entry',x:entry.x,y:entry.y,surfaceIds:[`${plan.id}.lower.merge-basin`]}, {...common,id:`${id}.exit`,role:'release-exit',x:exit.x,y:exit.y,surfaceIds:sharedRecovery.path.surfaceIds});
   captures.push({id,kind:'scoop',entryPortId:`${id}.entry`,exitArenaId:plan.id,exitPortId:`${id}.exit`,fallbackExitPortId:`${id}.exit`,approach:{minSpeed:.2,maxSpeed:18,minDot:.4},captureTicks:18,travelTicks:0,maxExitWaitTicks:60,exitVelocity:rotation({x:0,y:-4.5}),release:{kind:'timer'},busyGateIds:[gateId],blockedTerminal:'drain'});
  }

  let forkCatch:ReturnType<typeof compileArcadeCatch>|undefined;
  const fork=options.forkReceiver;
  if(fork){
   if(family!=='fork-basin'||options.feed!=='peripheral'||!options.terraceCascade||!Number.isFinite(fork.center.x)||Math.abs(fork.center.x)<1500||Math.abs(fork.center.x)>2400||!Number.isFinite(fork.center.y)||Math.abs(fork.center.y)>300||!Number.isFinite(fork.inletOffset)||Math.abs(fork.inletOffset)>120)throw new Error('Explicit fork receiver bounds');
   const center=p(fork.center.x,fork.center.y),receiverPlan:ArcadeAssemblyPlan={...plan,id:`${plan.id}.basin`,bankCount:1,banks:[{...plan.banks[0]!,center,index:0,launchOwnerId:null}],launchOwners:[],silhouette:{...plan.silhouette,height:700}};
   forkCatch=compileArcadeCatch(receiverPlan,{bankIndex:0,attempt:fork.attempt,feed:'peripheral',biome,arrivalOnly:true});
   const outline=[[-680,-190],[680,-190],[680,300],[650,650],[-650,650],[-680,300]].map(([x,y])=>p(fork.center.x+x!,fork.center.y+y!));
   surfaces.push({id:`${plan.id}.fork-basin`,kind:'playfield',role:'catch',polygon:outline,layer:plan.layer,height:plan.elevation,material:'pinball-inlay',biome},...forkCatch.surfaces);rails.push(...forkCatch.rails,...splitRail(`${plan.id}.fork-basin.drain-left`,outline[0]!,p(fork.center.x-100,fork.center.y-190)),...splitRail(`${plan.id}.fork-basin.drain-right`,p(fork.center.x+100,fork.center.y-190),outline[1]!));
   hazards.push(...forkCatch.hazards);flippers.push(...forkCatch.flippers);stations.push(...forkCatch.stations);chamberBoundaries.push({id:`${plan.id}.fork-basin`,vertices:outline});
   // A separate slope strip serves this branch without stacking forces over
   // the source bank's three adjacent strips (which end at local x=±900).
   const slopeWidth=Math.min(450,(Math.abs(fork.center.x)-900)/1.5);for(const strip of [-1,0,1]){const slopeA=p(fork.center.x+strip*slopeWidth,fork.center.y-200),slopeB=p(fork.center.x+strip*slopeWidth,fork.center.y+700);flows.push({id:`${plan.id}.fork-basin.slope.${strip}`,ax:slopeA.x,ay:slopeA.y,bx:slopeB.x,by:slopeB.y,width:slopeWidth,fx:plan.physics.localDown.x*.04,fy:plan.physics.localDown.y*.04,layer:plan.layer,elevation:plan.elevation,maxSpeed:18});}
  }
  let orbitPoints:ArenaPoint[];
  if(family==='fork-basin')orbitPoints=[...cubic(orbit,{x:orbit.x+orbit.vx/os*390,y:orbit.y+orbit.vy/os*390},{x:-orbitReceiver*oppositeShoulder,y:crest},{x:0,y:crest},steps),...cubic({x:0,y:crest},{x:orbitReceiver*returnShoulder,y:crest},{x:orbitReceiver*500,y:800},{x:orbitReceiver*500,y:sharedRecovery?(options.feed==='peripheral'?710:600):460},steps).slice(1)];
  else if(family==='terrace-switchback')orbitPoints=[...cubic(orbit,{x:orbit.x+orbit.vx/os*(options.feed==='peripheral'?180:300),y:orbit.y+orbit.vy/os*(options.feed==='peripheral'?180:300)},{x:-orbitReceiver*oppositeShoulder,y:crest*.85},{x:-orbitReceiver*oppositeShoulder*.7,y:crest},steps),...cubic({x:-orbitReceiver*oppositeShoulder*.7,y:crest},{x:orbitReceiver*returnShoulder*.9,y:crest+80},{x:orbitReceiver*500,y:options.feed==='peripheral'?810:680},{x:orbitReceiver*500,y:sharedRecovery?(options.feed==='peripheral'?710:600):460},steps).slice(1)];
  else orbitPoints=[...cubic(orbit,{x:orbit.x+orbit.vx/os*450,y:orbit.y+orbit.vy/os*450},{x:-orbitReceiver*oppositeShoulder,y:crest},{x:0,y:crest+150},steps),...cubic({x:0,y:crest+150},{x:orbitReceiver*returnShoulder,y:crest+150},{x:orbitReceiver*540,y:650},{x:orbitReceiver*500,y:sharedRecovery?(options.feed==='peripheral'?710:600):460},steps).slice(1)];
  if(fork)orbitPoints=cubic(orbit,{x:orbit.x+orbit.vx/os*180,y:orbit.y+orbit.vy/os*180},{x:fork.center.x+fork.inletOffset,y:crest+250},{x:fork.center.x+fork.inletOffset,y:fork.center.y+450},24);
  const recovery=cubic({x:orbitReceiver*500,y:460},{x:orbitReceiver*580,y:350},{x:orbitReceiver*250,y:150},{x:orbitReceiver*125,y:45},8),orbitVertices=[...orbitPoints,...(sharedRecovery||fork?[]:recovery.slice(1))].map(v=>p(v.x,v.y));
  const lead=160,ascent=350,intake={x:q(cross.x+cross.vx/cs*lead),y:q(cross.y+cross.vy/cs*lead)},rampEnd={x:q(intake.x+cross.vx/cs*ascent),y:q(intake.y+cross.vy/cs*ascent)},rise=crossRequest.crestElevation,upper=crossRequest.crestLayer;
  const downstreamCenter={x:crossReceiver*(options.downstreamSeparation??(options.feed==='peripheral'?900:700)),y:options.feed==='peripheral'?500:800};
  const highExit=options.terraceCascade?{x:downstreamCenter.x+(options.downstreamInletOffset??0),y:downstreamCenter.y+450}:family==='terrace-switchback'?{x:crossReceiver*450,y:840}:family==='loop-gallery'?{x:crossReceiver*600,y:1050}:{x:crossReceiver*700,y:840};
  const highCurve=cubic(rampEnd,{x:rampEnd.x+cross.vx/cs*(family==='loop-gallery'?780:650),y:rampEnd.y+cross.vy/cs*(family==='terrace-switchback'?520:650)},{x:highExit.x,y:Math.max(height*.78,highExit.y+400)},highExit,Math.min(24,steps+5));
  let crossVertices=[p(cross.x,cross.y),p(intake.x,intake.y),p(rampEnd.x,rampEnd.y,upper,rise),...highCurve.slice(1).map(v=>p(v.x,v.y,upper,rise)),p(crossReceiver*500,460),...cubic({x:crossReceiver*500,y:460},{x:crossReceiver*580,y:350},{x:crossReceiver*250,y:150},{x:crossReceiver*125,y:45},8).slice(1).map(v=>p(v.x,v.y))];
  let downstream:ReturnType<typeof compileArcadeCatch>|undefined;
  if(options.terraceCascade){
   if(family!=='terrace-switchback'&&!(family==='fork-basin'&&options.forkReceiver))throw new Error('Downstream cascade requires an explicit terrace or fork receiver grammar');
   const center=p(downstreamCenter.x,downstreamCenter.y,upper,rise),downstreamPlan:ArcadeAssemblyPlan={...plan,id:`${plan.id}.terrace`,layer:upper,elevation:rise,bankCount:1,banks:[{...plan.banks[0]!,center,index:0,launchOwnerId:null}],launchOwners:[],silhouette:{...plan.silhouette,height:600}};
   downstream=compileArcadeCatch(downstreamPlan,{bankIndex:0,attempt:options.downstreamAttempt??options.attempt,feed:options.feed,biome,arrivalOnly:true,arrivalOffset:options.downstreamInletOffset??0});
   const upperOutline=(options.feed==='peripheral'?[[-680,-190],[500,-190],[800,300],[650,650],[-520,650],[-760,350]]:[[-680,-190],[1100,-190],[1300,300],[1100,650],[-520,650],[-760,350]]).map(([x,y])=>p(downstreamCenter.x+x!,downstreamCenter.y+y!,upper,rise));
   surfaces.push({id:`${plan.id}.upper-terrace`,kind:'playfield',role:'catch',polygon:upperOutline,layer:upper,height:rise,material:'pinball-inlay',biome});
   chamberBoundaries.push({id:`${plan.id}.upper-terrace`,vertices:upperOutline});
   rails.push(...splitRail(`${plan.id}.upper-terrace.drain-left`,upperOutline[0]!,p(downstreamCenter.x-100,downstreamCenter.y-190,upper,rise)),...splitRail(`${plan.id}.upper-terrace.drain-right`,p(downstreamCenter.x+100,downstreamCenter.y-190,upper,rise),upperOutline[1]!));
   rails.push(...downstream.rails);surfaces.push(...downstream.surfaces);hazards.push(...downstream.hazards);ramps.push(...downstream.ramps);paths.push(...downstream.paths);ports.push(...downstream.ports);flippers.push(...downstream.flippers);stations.push(...downstream.stations);flows.push(...downstream.flows);
   crossVertices=[p(cross.x,cross.y),p(intake.x,intake.y),p(rampEnd.x,rampEnd.y,upper,rise),...highCurve.slice(1).map(v=>p(v.x,v.y,upper,rise)),...(options.feed==='peripheral'?[]:[p(downstreamCenter.x+(options.downstreamInletOffset??0),downstreamCenter.y+120,upper,rise),p(downstreamCenter.x+(options.downstreamInletOffset??0),downstreamCenter.y+60,upper,rise)])];
   const addUpperScoop=(id:string,inlet:number,orbit=false)=>{
    const orbitFirst=cubic({x:-500,y:460},{x:-500,y:300},{x:-220,y:300},{x:-220,y:200},8)[1]!,exitLocal=orbit?{x:(-500+orbitFirst.x)/2,y:(460+orbitFirst.y)/2}:{x:inlet,y:430},exitDelta={x:exitLocal.x-inlet,y:exitLocal.y-460},exitSpeed=Math.hypot(exitDelta.x,exitDelta.y);
    const entry=p(downstreamCenter.x+inlet,downstreamCenter.y+460,upper,rise),exit=p(downstreamCenter.x+exitLocal.x,downstreamCenter.y+exitLocal.y,upper,rise),tangent=rotation({x:0,y:-1}),gateA=p(downstreamCenter.x+inlet-40,downstreamCenter.y+485,upper,rise),gateB=p(downstreamCenter.x+inlet+40,downstreamCenter.y+485,upper,rise),gateId=`${id}.shutter`,common={mechanismId:id,layer:upper,elevation:rise,tangent,clearWidth:72,direction:'forward' as const,maxBallRadius:12,admittedSpeed:{min:0,max:18},receiverCatchId:downstream!.spec.id,surfaceIds:[`${plan.id}.upper-terrace`]};
    ports.push({...common,id:`${id}.entry`,role:'capture-entry',x:entry.x,y:entry.y},{...common,id:`${id}.exit`,role:'release-exit',x:exit.x,y:exit.y});
    gates.push({id:gateId,ax:gateA.x,ay:gateA.y,bx:gateB.x,by:gateB.y,radius:3,restitution:.3,layer:upper,elevation:rise,initiallyOpen:true,kind:'door'});
    const trigger=p(downstreamCenter.x+inlet,downstreamCenter.y+550,upper,rise);switches.push({id:`${id}.rollover`,x:trigger.x,y:trigger.y,radius:80,layer:upper,elevation:rise,gateIds:[gateId],holdTicks:240});
    captures.push({id,kind:'scoop',entryPortId:`${id}.entry`,exitArenaId:plan.id,exitPortId:`${id}.exit`,fallbackExitPortId:`${id}.exit`,approach:{minSpeed:.2,maxSpeed:18,minDot:.4},captureTicks:18,travelTicks:0,maxExitWaitTicks:60,exitVelocity:rotation({x:exitDelta.x/exitSpeed*18,y:exitDelta.y/exitSpeed*18}),release:{kind:'timer'},busyGateIds:[gateId],blockedTerminal:'drain'});
   };
   if(options.upperReceivingScoop)addUpperScoop(`${plan.id}.terrace.receiving-scoop`,options.downstreamInletOffset??0);
   const alternative=options.downstreamAlternative;
   if(alternative){
    const speed=Math.hypot(alternative.vx,alternative.vy),r=(v:ArenaPoint)=>p(downstreamCenter.x+v.x,downstreamCenter.y+v.y,upper,rise),turn=options.upperReceivingScoop?{x:-1500,y:1200}:{x:-700,y:1100};
    if(speed<6||alternative.x>(options.upperReceivingScoop?-250:-400)||options.feed!=='peripheral'&&alternative.vx>=0)throw new Error('Upper local orbit requires an actual outward western ray');
    const outgoing=cubic(alternative,{x:alternative.x+alternative.vx/speed*350,y:alternative.y+alternative.vy/speed*350},{x:-1150,y:1100},turn,14).map(r);
    // The normalized western shot crosses the old return inlane. Lift its outer
    // return over that outbound corridor, then descend beyond the open bank fan.
    const returnVertices=options.upperReceivingScoop?[
     ...[...cubic({x:-1900,y:1200},{x:-2500,y:1200},{x:-2500,y:900},{x:-2200,y:900},10),...cubic({x:-2200,y:900},{x:-1300,y:900},{x:-500,y:1200},{x:-500,y:900},10).slice(1)].map(v=>p(downstreamCenter.x+v.x,downstreamCenter.y+v.y,3,rise+200)),
     r({x:-500,y:460}),...cubic({x:-500,y:460},{x:-500,y:300},{x:-220,y:300},{x:-220,y:200},8).slice(1).map(r)
    ]:[...cubic(turn,{x:-400,y:1100},{x:-500,y:700},{x:-500,y:460},14).slice(1),...(options.feed==='peripheral'?cubic({x:-500,y:460},{x:-500,y:300},{x:-220,y:300},{x:-220,y:200},8):cubic({x:-500,y:460},{x:-580,y:350},{x:-250,y:150},{x:-125,y:45},8)).slice(1)].map(r);
    const vertices=[...outgoing,...returnVertices],id=`${plan.id}.terrace.local-orbit`,track=compileTrack({id,role:'orbit',vertices,clearWidth:transportWidth,restitution:.8,deck:'wireform',biome,receiverCatchId:downstream.spec.id,qualificationId:`${id}.route`,returnStartVertex:14});
    rails.push(...track.rails);surfaces.push(...track.surfaces);paths.push(track.path);ports.push(...track.ports);ramps.push(...track.ramps);
    if(options.upperReceivingScoop)addUpperScoop(`${plan.id}.terrace.orbit-scoop`,-500,true);
    challenges.push({id:`${id}.route`,name:'UPPER LOCAL ORBIT',kind:'main-shot',sourceFlipperIds:alternative.bits===3?[downstream.spec.leftFlipperId,downstream.spec.rightFlipperId]:[downstream.spec.leftFlipperId],entryDirection:rotation({x:alternative.vx/speed,y:alternative.vy/speed}),maxTraversalTicks:1400,finalColliderId:downstream.spec.leftFlipperId,checkpoints:[{...vertices[0]!,radius:65},{...vertices[14]!,radius:85},{...r(options.feed==='peripheral'?{x:0,y:0}:{x:-125,y:20}),radius:options.feed==='peripheral'?150:100}]});
   }
   const ray=options.downstreamBinding;
   if(ray){
    const speed=Math.hypot(ray.vx,ray.vy),start={x:downstreamCenter.x+ray.x,y:downstreamCenter.y+ray.y},exit={x:crossReceiver*(options.feed==='peripheral'?400:500),y:options.feed==='peripheral'?1040:840};
    if(speed<6)throw new Error('Downstream outgoing ray too weak');
    const returnLayer=upper+1,returnElevation=rise+100; if(returnLayer>3||returnElevation>400)throw new Error('Downstream crossover exceeds native tiers');
    const rampStart={x:start.x+ray.vx/speed*50,y:start.y+ray.vy/speed*50},rampEnd={x:rampStart.x+ray.vx/speed*220,y:rampStart.y+ray.vy/speed*220};
    const curve=cubic(rampEnd,{x:rampEnd.x+ray.vx/speed*500,y:rampEnd.y+ray.vy/speed*500},{x:exit.x,y:Math.max(start.y+600,plan.silhouette.height)},exit,20),vertices=[p(start.x,start.y,upper,rise),p(rampStart.x,rampStart.y,upper,rise),...curve.map(v=>p(v.x,v.y,returnLayer,returnElevation)),p(crossReceiver*(options.feed==='peripheral'?400:500),sharedRecovery?(options.feed==='peripheral'?710:600):460),...(sharedRecovery?[]:cubic({x:crossReceiver*500,y:460},{x:crossReceiver*580,y:350},{x:crossReceiver*250,y:150},{x:crossReceiver*125,y:45},8).slice(1).map(v=>p(v.x,v.y)))],id=`${plan.id}.terrace.return`;
    const track=compileTrack({id,role:'cross-return',vertices,restitution:options.downstreamRestitution??.8,clearWidth:transportWidth,deck:'wireform',biome,receiverCatchId:foundation.spec.id,qualificationId:`${id}.route`,returnStartVertex:10});
    rails.push(...track.rails.map(rail=>rail.elevation===plan.elevation&&(rail.elevationB??rail.elevation)===plan.elevation?{...rail,restitution:options.downstreamRecoveryRestitution??.8}:rail));surfaces.push(...track.surfaces);paths.push(track.path);ports.push(...track.ports.map(port=>port.id===track.path.exitPortId?{...port,surfaceIds:[...new Set([...port.surfaceIds,...track.surfaces.filter(surface=>surface.id.endsWith('exit-apron')&&surface.layer===port.layer&&surface.height===port.elevation&&Math.hypot(surface.polygon[0]!.x-port.x,surface.polygon[0]!.y-port.y)<=port.clearWidth+12).map(surface=>surface.id)])]}:port));ramps.push(...track.ramps);
    if(options.compoundGoal){
     // The only entry to the new upper deck is this supported, gated throat.
     // Its gate spans the taper before the one-way rising crossover ramp.
     const gateId=`${plan.id}.terrace.goal-throat`,goalId=`${plan.id}.terrace.goal`;
     if(options.upperReceivingScoop){
      // A returning ball must reach the bank before it can earn the cross-group.
      // Put this lock across the isolated elevated deck, beyond its native ascent,
      // so it cannot close the shared receiving inlane before that first contact.
      const v=vertices[3]!,w=vertices[4]!,length=Math.hypot(w.x-v.x,w.y-v.y),normal={x:-(w.y-v.y)/length,y:(w.x-v.x)/length},center={x:(v.x+w.x)/2,y:(v.y+w.y)/2},half=transportWidth/2+8;
      gates.push({id:gateId,ax:center.x-normal.x*half,ay:center.y-normal.y*half,bx:center.x+normal.x*half,by:center.y+normal.y*half,radius:4,restitution:.65,layer:returnLayer,elevation:returnElevation,initiallyOpen:false,kind:'door'});
     }else{
      const tangent={x:ray.vx/speed,y:ray.vy/speed},normal={x:-tangent.y,y:tangent.x},center={x:rampStart.x-tangent.x*16,y:rampStart.y-tangent.y*16},a=p(center.x-normal.x*44,center.y-normal.y*44,upper,rise),b=p(center.x+normal.x*44,center.y+normal.y*44,upper,rise);
      // Native acquisition covers the first eighth; its side-entry region needs
      // the same physical cut as the centerline.
      for(const side of [-1,1])rails.push(...splitRail(`${gateId}.entry-collar.${side}`,p(rampStart.x-tangent.x*32+normal.x*44*side,rampStart.y-tangent.y*32+normal.y*44*side,upper,rise),p(rampStart.x+tangent.x*42+normal.x*44*side,rampStart.y+tangent.y*42+normal.y*44*side,upper,rise)));
      gates.push({id:gateId,ax:a.x,ay:a.y,bx:b.x,by:b.y,radius:4,restitution:.65,layer:upper,elevation:rise,initiallyOpen:false,kind:'door'});
     }
     const orbitAlternatives=options.downstreamAlternative&&!fork?[orbitRequest.id,`${plan.id}.terrace.local-orbit.route`]:[orbitRequest.id],crossAlternatives=options.sourceRecovery?[crossRequest.id,`${plan.id}.source.recovery-junction.route`]:[crossRequest.id];
     requirements.push({id:`${gateId}.requirement`,name:'ORBIT AND TERRACE',routeIds:[...orbitAlternatives,...crossAlternatives],routeGroups:[orbitAlternatives,crossAlternatives],gateIds:[gateId],scope:'owner',holdTicks:120,persistent:true});
     challenges.push({id:goalId,name:'UPPER GOAL DECK',kind:'main-shot',sourceFlipperIds:[downstream.spec.leftFlipperId,downstream.spec.rightFlipperId],entryDirection:rotation({x:ray.vx/speed,y:ray.vy/speed}),maxTraversalTicks:1200,checkpoints:[{...vertices[0]!,radius:40},{...vertices[5]!,radius:45},{...vertices[10]!,radius:45}]});
     const request=plan.ports.find(port=>port.role==='locked-branch');if(request)portBindings.push({requestedPortId:request.id,actualPortId:track.ports[0]!.id,requestedPose:request.position,actualPose:track.ports[0]!});
    }

    challenges.push({id:`${id}.route`,name:'TERRACE DESCENT',kind:'main-shot',sourceFlipperIds:[downstream.spec.leftFlipperId,downstream.spec.rightFlipperId],entryDirection:rotation({x:ray.vx/speed,y:ray.vy/speed}),maxTraversalTicks:1400,finalColliderId:options.recoveryBlade==='right'?foundation.spec.rightFlipperId:options.recoveryBlade==='left'?foundation.spec.leftFlipperId:crossReceiver<0?foundation.spec.leftFlipperId:foundation.spec.rightFlipperId,checkpoints:[{...vertices[0]!,radius:75},{...vertices[10]!,radius:95},...(options.feed==='peripheral'?[{...p(crossReceiver*500,460),radius:85}]:[]),{...(options.feed==='peripheral'?p(0,0):p(crossReceiver*125,20)),radius:options.feed==='peripheral'?150:100}]});
   }
  }
  if(fork&&forkCatch&&fork.bindings){
   if(!sharedRecovery)throw new Error('Fork return needs its declared physical shared receiver');
   const local=(v:ArenaPoint,layer=plan.layer,z=plan.elevation)=>p(fork.center.x+v.x,fork.center.y+v.y,layer,z),alternative=fork.bindings.orbit,returnRay=fork.bindings.cross;
   const as=Math.hypot(alternative.vx,alternative.vy),rs=Math.hypot(returnRay.vx,returnRay.vy);if(as<6||rs<6||alternative.x<100||Math.hypot(alternative.x-returnRay.x,alternative.y-returnRay.y)<120)throw new Error('Fork receiver choices need distinct actual rays');
   if(!downstream)throw new Error('Fork outer transfer requires its physical upper receiver');
   const upperInlet=fork.upperInletOffset??-80;if(!Number.isFinite(upperInlet)||Math.abs(upperInlet)>120)throw new Error('Fork upper arrival inlet');
   const outerStart={x:fork.center.x+alternative.x,y:fork.center.y+alternative.y},outerRampStart={x:outerStart.x+alternative.vx/as*80,y:outerStart.y+alternative.vy/as*80},outerRampEnd={x:outerRampStart.x+alternative.vx/as*350,y:outerRampStart.y+alternative.vy/as*350},outerExit={x:downstreamCenter.x+upperInlet,y:downstreamCenter.y+450};
   const orbitId=`${plan.id}.basin.outer-transfer`,outerCurve=cubic(outerRampEnd,{x:outerRampEnd.x+alternative.vx/as*500,y:outerRampEnd.y+alternative.vy/as*500},{x:outerExit.x,y:plan.silhouette.height+1000},outerExit,28),orbitVertices=[p(outerStart.x,outerStart.y),p(outerRampStart.x,outerRampStart.y),...outerCurve.map(v=>p(v.x,v.y,upper,rise))];
   const loop=compileTrack({id:orbitId,role:'cross-return',vertices:orbitVertices,clearWidth:transportWidth,restitution:.8,deck:'wireform',biome,receiverCatchId:downstream.spec.id,qualificationId:`${orbitId}.route`,returnStartVertex:18});
   rails.push(...loop.rails);surfaces.push(...loop.surfaces);paths.push(loop.path);ports.push(...loop.ports);ramps.push(...loop.ramps);
   if(options.normalizeUpperAlternate){
    if(!options.upperReceivingScoop||rise<50)throw new Error('Alternate upper tunnel requires its supported receiving scoop');
    const id=`${plan.id}.terrace.alternate-tunnel`,entry=p(downstreamCenter.x+upperInlet,downstreamCenter.y+460,upper,rise),exitPort=ports.find(port=>port.id===`${plan.id}.terrace.receiving-scoop.exit`)!;
    const tunnel=compileTrack({id:`${id}.under-bed`,role:'travel',vertices:[{...entry,layer:upper-1,elevation:rise-50},{x:exitPort.x,y:exitPort.y,layer:upper-1,elevation:rise-50}],clearWidth:transportWidth,restitution:.8,deck:'solid',biome,receiverCatchId:downstream.spec.id});
    rails.push(...tunnel.rails);surfaces.push(...tunnel.surfaces);paths.push(tunnel.path);ports.push(...tunnel.ports);
    const gateId=`${id}.shutter`,ga=p(downstreamCenter.x+upperInlet-40,downstreamCenter.y+485,upper,rise),gb=p(downstreamCenter.x+upperInlet+40,downstreamCenter.y+485,upper,rise),trigger=p(downstreamCenter.x+upperInlet,downstreamCenter.y+550,upper,rise);
    ports.push({id:`${id}.entry`,mechanismId:id,role:'capture-entry',x:entry.x,y:entry.y,layer:upper,elevation:rise,tangent:rotation({x:0,y:-1}),clearWidth:72,direction:'forward',maxBallRadius:12,admittedSpeed:{min:0,max:18},receiverCatchId:downstream.spec.id,surfaceIds:[`${plan.id}.upper-terrace`]});
    gates.push({id:gateId,ax:ga.x,ay:ga.y,bx:gb.x,by:gb.y,radius:3,restitution:.3,layer:upper,elevation:rise,initiallyOpen:true,kind:'door'});
    switches.push({id:`${id}.rollover`,x:trigger.x,y:trigger.y,radius:80,layer:upper,elevation:rise,gateIds:[gateId],holdTicks:240});
    captures.push({id,kind:'tunnel',entryPortId:`${id}.entry`,exitArenaId:plan.id,exitPortId:exitPort.id,fallbackExitPortId:exitPort.id,approach:{minSpeed:.2,maxSpeed:18,minDot:.4},captureTicks:18,travelTicks:24,maxExitWaitTicks:60,exitVelocity:rotation({x:0,y:-18}),release:{kind:'timer'},busyGateIds:[gateId],blockedTerminal:'drain'});
    portBindings.push({requestedPortId:loop.ports[1]!.id,requestedReceivingBladeId:fork.upperReceivingBlade==='right'?downstream.spec.rightFlipperId:downstream.spec.leftFlipperId,actualReceivingBladeId:downstream.spec.rightFlipperId,actualPortId:exitPort.id,requestedPose:loop.ports[1]!,actualPose:exitPort});
   }

   challenges.push({id:`${orbitId}.route`,name:'OUTER COASTER TO UPPER CATCH',kind:'main-shot',sourceFlipperIds:[forkCatch.spec.leftFlipperId],entryDirection:rotation({x:alternative.vx/as,y:alternative.vy/as}),maxTraversalTicks:1800,finalColliderId:options.normalizeUpperAlternate||fork.upperReceivingBlade==='right'?downstream.spec.rightFlipperId:downstream.spec.leftFlipperId,checkpoints:[{...orbitVertices[0]!,radius:50},{...orbitVertices[16]!,radius:65},{...p(downstreamCenter.x,downstreamCenter.y,upper,rise),radius:150}]});
   const start={x:fork.center.x+returnRay.x,y:fork.center.y+returnRay.y},rampStart={x:start.x+returnRay.vx/rs*80,y:start.y+returnRay.vy/rs*80},rampEnd={x:rampStart.x+returnRay.vx/rs*350,y:rampStart.y+returnRay.vy/rs*350},exit={x:crossReceiver*280,y:1040},z=rise+65,layer=upper+1;if(z>400||layer>3)throw new Error('Fork crossover tier budget');
   const curve=cubic(rampEnd,{x:rampEnd.x+returnRay.vx/rs*500,y:rampEnd.y+returnRay.vy/rs*500},{x:exit.x,y:plan.silhouette.height+600},exit,24),vertices=[p(start.x,start.y),p(rampStart.x,rampStart.y),...curve.map(v=>p(v.x,v.y,layer,z)),p(exit.x,710)],id=`${plan.id}.basin.shared-return`,track=compileTrack({id,role:'cross-return',vertices,clearWidth:transportWidth,restitution:.85,deck:'wireform',biome,receiverCatchId:foundation.spec.id,qualificationId:`${id}.route`,returnStartVertex:16});
   rails.push(...track.rails);surfaces.push(...track.surfaces);paths.push(track.path);ports.push(...track.ports);ramps.push(...track.ramps);
   challenges.push({id:`${id}.route`,name:'BASIN TO SHARED CATCH',kind:'main-shot',sourceFlipperIds:[forkCatch.spec.leftFlipperId,forkCatch.spec.rightFlipperId],entryDirection:rotation({x:returnRay.vx/rs,y:returnRay.vy/rs}),maxTraversalTicks:1800,finalColliderId:foundation.spec.rightFlipperId,checkpoints:[{...vertices[0]!,radius:50},{...vertices[12]!,radius:65},{...p(crossReceiver*500,460),radius:85},{...p(0,0),radius:150}]});
   if(fork.eastReturn){
    const ray=fork.eastReturn,speed=Math.hypot(ray.vx,ray.vy),inlet=fork.basinReturnOffset??-40;
    if(!Number.isFinite(speed)||speed<6||speed>24||ray.x<100||ray.y<450||ray.y>650||!Number.isFinite(inlet)||Math.abs(inlet)>120)throw new Error('Fork east return requires a measured upfield ray and bounded receiving inlet');
    const start={x:downstreamCenter.x+ray.x,y:downstreamCenter.y+ray.y},a={x:start.x+ray.vx/speed*60,y:start.y+ray.vy/speed*60},b={x:a.x+ray.vx/speed*300,y:a.y+ray.vy/speed*300},crest={x:fork.center.x+inlet,y:fork.center.y+1000},layer=3,z=rise+(options.normalizeUpperAlternate?250:200);
    if(layer>3||z>400)throw new Error('Fork east return tier budget');
    const curve=cubic(b,{x:b.x+ray.vx/speed*500,y:b.y+ray.vy/speed*500},{x:crest.x,y:plan.silhouette.height+1200},crest,28),vertices=[p(start.x,start.y,upper,rise),p(a.x,a.y,upper,rise),...curve.map(v=>p(v.x,v.y,layer,z)),p(crest.x,fork.center.y+450)],id=`${plan.id}.terrace.east-return`;
    const track=compileTrack({id,role:'cross-return',vertices,clearWidth:transportWidth,restitution:.85,deck:'wireform',biome,receiverCatchId:forkCatch.spec.id,qualificationId:`${id}.route`,returnStartVertex:18});
    rails.push(...track.rails);surfaces.push(...track.surfaces);paths.push(track.path);ports.push(...track.ports);ramps.push(...track.ramps);
    challenges.push({id:`${id}.route`,name:'UPPER TO BASIN COASTER',kind:'main-shot',sourceFlipperIds:[downstream.spec.leftFlipperId],entryDirection:rotation({x:ray.vx/speed,y:ray.vy/speed}),maxTraversalTicks:1800,finalColliderId:fork.basinReturnBlade==='right'?forkCatch.spec.rightFlipperId:forkCatch.spec.leftFlipperId,checkpoints:[{...vertices[0]!,radius:50},{...vertices[16]!,radius:65},{...p(fork.center.x,fork.center.y),radius:150}]});
   }

  }
  for(const [request,vertices,returnStart]of [[orbitRequest,orbitVertices,steps],[crossRequest,crossVertices,3+highCurve.length/2]] as const){
   const track=compileTrack({id:request.sharedRouteId,role:request.family==='ground-orbit'?'orbit':'cross-return',vertices,clearWidth:transportWidth,clearWidths:vertices.map((_,i)=>i===0?Math.max(transportWidth,Math.min(48,request.intakeWidth)):transportWidth),deck:'wireform',biome,receiverCatchId:request.family==='elevated-cross-return'&&downstream?downstream.spec.id:forkCatch?forkCatch.spec.id:foundation.spec.id,qualificationId:request.id,returnStartVertex:Math.floor(returnStart)});
   rails.push(...track.rails);surfaces.push(...track.surfaces);paths.push(track.path);ports.push(...track.ports);ramps.push(...track.ramps);
   const requestPort=plan.ports.find(p=>p.id===request.entryPortId)!,returnPort=plan.ports.find(p=>p.id===request.recoveryPortId)!;
   portBindings.push({requestedPortId:request.entryPortId,actualPortId:track.ports[0]!.id,requestedPose:requestPort.position,actualPose:track.ports[0]!},{requestedPortId:request.recoveryPortId,requestedReturnSide:request.returnSide,actualReceivingBladeId:request.family==='elevated-cross-return'&&downstream?downstream.spec.rightFlipperId:forkCatch?forkCatch.spec.rightFlipperId:options.recoveryBlade==='right'?foundation.spec.rightFlipperId:options.recoveryBlade==='left'?foundation.spec.leftFlipperId:(request.family==='ground-orbit'?orbitReceiver:crossReceiver)<0?foundation.spec.leftFlipperId:foundation.spec.rightFlipperId,actualPortId:sharedRecovery&&!forkCatch&&request.family==='ground-orbit'?sharedRecovery.ports[1]!.id:track.ports[1]!.id,requestedPose:returnPort.position,actualPose:sharedRecovery&&!forkCatch&&request.family==='ground-orbit'?sharedRecovery.ports[1]!:track.ports[1]!});
   const direction=rotation({x:request.family==='ground-orbit'?orbit.vx/os:cross.vx/cs,y:request.family==='ground-orbit'?orbit.vy/os:cross.vy/cs}),entry=vertices[0]!,middle=vertices[Math.floor(vertices.length/3)]!,receiver=request.family==='elevated-cross-return'&&downstream?p(downstreamCenter.x,downstreamCenter.y+20,upper,rise):p(request.family==='ground-orbit'?receiverX:crossReceiver*125,20);
   challenges.push({id:request.id,name:request.family.toUpperCase(),kind:'main-shot',sourceFlipperIds:[foundation.spec.leftFlipperId,foundation.spec.rightFlipperId],entryDirection:direction,maxTraversalTicks:1200,finalColliderId:request.family==='elevated-cross-return'&&downstream?downstream.spec.rightFlipperId:forkCatch?forkCatch.spec.rightFlipperId:options.recoveryBlade==='right'?foundation.spec.rightFlipperId:options.recoveryBlade==='left'?foundation.spec.leftFlipperId:(request.family==='ground-orbit'?orbitReceiver:crossReceiver)<0?foundation.spec.leftFlipperId:foundation.spec.rightFlipperId,checkpoints:[{...entry,radius:75},{...middle,radius:95},...(options.feed==='peripheral'&&request.family==='ground-orbit'&&!fork?[{...p(orbitReceiver*500,460),radius:85}]:[]),{...(options.feed==='peripheral'?(request.family==='elevated-cross-return'&&downstream?p(downstreamCenter.x,downstreamCenter.y,upper,rise):fork?p(fork.center.x,fork.center.y):p(0,0)):receiver),radius:options.feed==='peripheral'?150:100}]});
  }
  if(options.sourceRecovery){
   if(!fork||!downstream)throw new Error('Source recovery junction requires the explicit fork receiver graph');
   const ray=options.sourceRecovery,speed=Math.hypot(ray.vx,ray.vy);if(!Number.isFinite(speed)||speed<6||speed>24||ray.y<450||ray.y>650||Math.abs(ray.x)>400)throw new Error('Source recovery junction needs a measured upfield shot envelope');
   const id=`${plan.id}.source.recovery-junction`,a={x:ray.x+ray.vx/speed*160,y:ray.y+ray.vy/speed*160},b={x:a.x+ray.vx/speed*350,y:a.y+ray.vy/speed*350},join=crossVertices[18]!;
   // The recipe uses the bank basis. Recover local coordinates for every
   // orientation instead of treating a translated world point as a local ray.
   const inverse=(v:ArenaPoint)=>{const dx=v.x-origin.x,dy=v.y-origin.y;return plan.quarterTurns===1?{x:dy,y:-dx}:plan.quarterTurns===2?{x:-dx,y:-dy}:plan.quarterTurns===3?{x:-dy,y:dx}:{x:dx,y:dy};},j=inverse(join),before=inverse(crossVertices[17]!),after=inverse(crossVertices[19]!),tx=after.x-before.x,ty=after.y-before.y,ts=Math.hypot(tx,ty),landing={x:j.x-tx/ts*100-ty/ts*50,y:j.y-ty/ts*100+tx/ts*50},downStart={x:landing.x-tx/ts*220,y:landing.y-ty/ts*220},curve=cubic(b,{x:b.x+ray.vx/speed*180,y:b.y+ray.vy/speed*180},{x:downStart.x-tx/ts*180,y:downStart.y-ty/ts*180},downStart,18),landingCurve=cubic(landing,{x:landing.x+tx/ts*50,y:landing.y+ty/ts*50},{x:j.x-tx/ts*25,y:j.y-ty/ts*25},j,8),vertices=[p(ray.x,ray.y),p(a.x,a.y),...curve.map(v=>p(v.x,v.y,3,rise+200)),...landingCurve.map(v=>p(v.x,v.y,upper,rise))];
   const track=compileTrack({id,role:'cross-return',vertices,clearWidth:transportWidth,clearWidths:vertices.map((_,i)=>i===0?48:transportWidth),restitution:.8,deck:'wireform',biome,qualificationId:`${id}.route`,returnStartVertex:14});
   rails.push(...track.rails);surfaces.push(...track.surfaces);paths.push(track.path);ports.push(...track.ports);ramps.push(...track.ramps);
   const junctionSurface=`${id}.support`,participating=[id,crossRequest.sharedRouteId],changed=new Map<string,string[]>(),retained:ArenaRail[]=[],original=[...rails];
   surfaces.push({id:junctionSurface,kind:'bridge',role:'travel',polygon:Array.from({length:8},(_,i)=>({x:q(join.x+Math.cos(i*Math.PI/4)*24),y:q(join.y+Math.sin(i*Math.PI/4)*24)})),layer:upper,height:rise,material:'wireform-track',biome});
   const quads=new Map<string,ArenaPoint[][]>();for(const prefix of participating){const regions:ArenaPoint[][]=[];for(const left of original.filter(rail=>rail.id.startsWith(prefix+'.rail.')&&rail.id.endsWith('.-1')&&rail.layer===upper&&rail.elevation===rise&&(rail.elevationB??rail.elevation)===rise)){const right=original.find(rail=>rail.id===left.id.slice(0,-2)+'1');if(right)regions.push([{x:left.ax,y:left.ay},{x:left.bx,y:left.by},{x:right.bx,y:right.by},{x:right.ax,y:right.ay}]);}quads.set(prefix,regions);}
   const within=(point:ArenaPoint,polygon:readonly ArenaPoint[])=>{let sign=0;for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);if(Math.abs(cross)<1e-7)return false;const next=Math.sign(cross);if(sign&&sign!==next)return false;sign=next;}return true;};
   // Form the real Y boundary from the union of both exact guide envelopes.
   // Interior dividers end at analytic guide intersections; exterior rails keep
   // their original curve. No open bowl, widened road, or route teleport exists.
   for(const rail of original){const own=participating.find(prefix=>rail.id.startsWith(prefix+'.rail.'));if(!own||rail.layer!==upper||rail.elevation!==rise||(rail.elevationB??rail.elevation)!==rise){retained.push(rail);continue;}const regions=quads.get(participating.find(prefix=>prefix!==own)!)!,dx=rail.bx-rail.ax,dy=rail.by-rail.ay,breaks=[0,1];for(const polygon of regions)for(let i=0;i<polygon.length;i++){const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,ex=b.x-a.x,ey=b.y-a.y,den=dx*ey-dy*ex;if(Math.abs(den)<1e-9)continue;const ax=a.x-rail.ax,ay=a.y-rail.ay,t=(ax*ey-ay*ex)/den,u=(ax*dy-ay*dx)/den;if(t>1e-8&&t<1-1e-8&&u>=0&&u<=1)breaks.push(t);}breaks.sort((a,b)=>a-b);const unique=breaks.filter((t,i)=>!i||t-breaks[i-1]!>1e-8),ids:string[]=[];for(let i=0;i<unique.length-1;i++){const from=unique[i]!,to=unique[i+1]!,mid=(from+to)/2;if(regions.some(polygon=>within({x:rail.ax+dx*mid,y:rail.ay+dy*mid},polygon)))continue;const piece={...rail,id:ids.length?`${rail.id}.outside.${ids.length}`:rail.id,ax:q(rail.ax+dx*from),ay:q(rail.ay+dy*from),bx:q(rail.ax+dx*to),by:q(rail.ay+dy*to)};if(Math.hypot(piece.bx-piece.ax,piece.by-piece.ay)<1/1024)continue;retained.push(piece);ids.push(piece.id);}changed.set(rail.id,ids);}
   const endpoints=retained.flatMap(rail=>[{rail,x:rail.ax,y:rail.ay,z:rail.elevation},{rail,x:rail.bx,y:rail.by,z:rail.elevationB??rail.elevation}]),loose=endpoints.filter(e=>participating.some(prefix=>e.rail.id.startsWith(prefix+'.rail.'))&&e.rail.layer===upper&&e.z===rise&&!endpoints.some(other=>other.rail.id!==e.rail.id&&other.rail.layer===upper&&other.z===rise&&Math.hypot(other.x-e.x,other.y-e.y)<=2/1024)),sealed=new Set<number>(),welds:ArenaRail[]=[];
   // Rounding and a ramp landing cross-section can leave overlapping capsule
   // tips with distinct centers. Physically bridge only those <=6-unit tips;
   // larger gaps remain rejected by the exact seam inspector.
   for(let i=0;i<loose.length;i++){if(sealed.has(i))continue;const a=loose[i]!,j=loose.findIndex((b,j)=>j>i&&!sealed.has(j)&&Math.hypot(a.x-b.x,a.y-b.y)<=6);if(j<0)continue;const b=loose[j]!;sealed.add(i);sealed.add(j);welds.push({id:`${id}.weld.${welds.length}`,ax:a.x,ay:a.y,bx:b.x,by:b.y,radius:3,restitution:.8,layer:upper,elevation:rise,material:'steel',kind:'guide'});}
   rails.splice(0,rails.length,...retained,...welds);for(let i=0;i<paths.length;i++){const path=paths[i]!;if(participating.includes(path.id))paths[i]={...path,colliderIds:[...path.colliderIds.flatMap(id=>changed.get(id)??[id]),...welds.map(rail=>rail.id)],surfaceIds:[...path.surfaceIds,junctionSurface]};}
   ports.push({id:`${id}.junction`,mechanismId:id,role:'shot-exit',x:join.x,y:join.y,layer:upper,elevation:rise,tangent:rotation({x:tx/ts,y:ty/ts}),clearWidth:transportWidth,direction:'forward',surfaceIds:[junctionSurface],maxBallRadius:12,admittedSpeed:{min:1,max:18},receiverCatchId:downstream.spec.id});
   challenges.push({id:`${id}.route`,name:'RECOVERY JUNCTION TO UPPER',kind:'main-shot',sourceFlipperIds:[foundation.spec.leftFlipperId,foundation.spec.rightFlipperId],entryDirection:rotation({x:ray.vx/speed,y:ray.vy/speed}),maxTraversalTicks:1800,finalColliderId:downstream.spec.rightFlipperId,checkpoints:[{...vertices[0]!,radius:50},{...join,radius:90},{...p(downstreamCenter.x,downstreamCenter.y,upper,rise),radius:150}]});
  }
 }
 // Each advertised home is a fixed native plunger and a physical perimeter
 // route. The recipe assigns ownership explicitly; arrival-only fallback poses
 // are never promoted to supported homes by station-array position.
 if(options.bankServes?.length){
  if(options.bankServes.length>2||!options.forkReceiver||!options.normalizeUpperAlternate)throw new Error('Bank serve requires the declared fork/tunnel grammar');
  const owners=new Set<number>([plan.banks[bankIndex]!.launchOwnerId??0]),banks=new Set<string>();
  for(const serve of options.bankServes){
   if(!Number.isInteger(serve.ownerId)||serve.ownerId<0||serve.ownerId>99||owners.has(serve.ownerId)||banks.has(serve.bank))throw new Error('Bank serve owner/bank must be unique');owners.add(serve.ownerId);banks.add(serve.bank);
   const suffix=serve.bank==='basin'?'basin':'terrace',stationIndex=stations.findIndex(station=>station.id===`${plan.id}.${suffix}.bank.0.catch`),station=stations[stationIndex];if(!station)throw new Error('Bank serve station absent');
   const blades=station.flipperIds.map(id=>flippers.find(blade=>blade.id===id)!),left=blades.find(blade=>blade.side==='left')!,right=blades.find(blade=>blade.side==='right')!,span=Math.hypot(right.pivotX-left.pivotX,right.pivotY-left.pivotY),axis={x:(right.pivotX-left.pivotX)/span,y:(right.pivotY-left.pivotY)/span},up={x:-axis.y,y:axis.x},center={x:(left.pivotX+right.pivotX)/2,y:(left.pivotY+right.pivotY)/2};
   const point=(x:number,y:number,layer=station.layer,elevation=station.elevation):TrackVertex=>({x:q(center.x+axis.x*x+up.x*y),y:q(center.y+axis.y*x+up.y*y),layer,elevation}),velocity=(x:number,y:number)=>({x:q(axis.x*x+up.x*y),y:q(axis.y*x+up.y*y)}),inlet=serve.bank==='basin'?options.forkReceiver.inletOffset:options.forkReceiver.upperInletOffset??-100,highLayer=serve.bank==='basin'?2:3,highElevation=serve.bank==='basin'?230:265,id=`${station.id}.home-shooter`;
   const vertices=[point(560,60),point(560,430,highLayer,highElevation),...cubic({x:560,y:430},{x:560,y:1000},{x:inlet,y:1250},{x:inlet,y:850},16).slice(1).map(v=>point(v.x,v.y,highLayer,highElevation)),point(inlet,serve.bank==='basin'?550:480),point(inlet,450)],track=compileTrack({id,role:'shooter',vertices,clearWidth:32,deck:'wireform',biome,receiverCatchId:station.id,returnStartVertex:8});
   rails.push(...track.rails);ramps.push(...track.ramps);surfaces.push(...track.surfaces);paths.push(track.path);ports.push(...track.ports);
   const start=vertices[0]!,launch=velocity(0,12);stations[stationIndex]={...station,ownerId:serve.ownerId,teamId:serve.ownerId,launchX:start.x,launchY:start.y,launchVx:launch.x,launchVy:launch.y};
   for(let i=0;i<flippers.length;i++)if(station.flipperIds.includes(flippers[i]!.id))flippers[i]={...flippers[i]!,ownerId:serve.ownerId};
   if(serve.bank==='basin'){
    // The release is a measured native incoming pose, declared before any
    // qualification. Both the home and connected ground route share this scoop.
    const scoop=`${station.id}.receiving-scoop`,entry=point(inlet,460),exit=point(37.4169921875,417.34375),tangent=velocity(0,-1),gateId=`${scoop}.shutter`,a=point(inlet-40,485),b=point(inlet+40,485),trigger=point(inlet,550),common={mechanismId:scoop,layer:station.layer,elevation:station.elevation,tangent,clearWidth:72,direction:'forward' as const,maxBallRadius:12,admittedSpeed:{min:0,max:18},receiverCatchId:station.id,surfaceIds:[`${plan.id}.fork-basin`]};
    ports.push({...common,id:`${scoop}.entry`,role:'capture-entry',x:entry.x,y:entry.y},{...common,id:`${scoop}.exit`,role:'release-exit',x:exit.x,y:exit.y});gates.push({id:gateId,ax:a.x,ay:a.y,bx:b.x,by:b.y,radius:3,restitution:.3,layer:station.layer,elevation:station.elevation,initiallyOpen:true,kind:'door'});switches.push({id:`${scoop}.rollover`,x:trigger.x,y:trigger.y,radius:80,layer:station.layer,elevation:station.elevation,gateIds:[gateId],holdTicks:240});captures.push({id:scoop,kind:'scoop',entryPortId:`${scoop}.entry`,exitArenaId:plan.id,exitPortId:`${scoop}.exit`,fallbackExitPortId:`${scoop}.exit`,approach:{minSpeed:.2,maxSpeed:18,minDot:.4},captureTicks:18,travelTicks:0,maxExitWaitTicks:60,exitVelocity:velocity(-.6953125,-14.7607421875),release:{kind:'timer'},busyGateIds:[gateId],blockedTerminal:'drain'});
   }
  }
 }
 // Perimeter walls keep misses on the upper bed. Only actual compiled
 // track mouths reserve apertures; an entire open edge is not a shot mouth.
 for(const {id:boundaryId,vertices:terraceBoundary} of chamberBoundaries){
  const z=terraceBoundary[0]!.elevation,layer=terraceBoundary[0]!.layer,segments=paths.flatMap(path=>path.vertices.slice(0,-1).flatMap((a,i)=>{const b=path.vertices[i+1]!;const clearance=Math.max(path.clearWidths?.[i]??path.clearWidth,path.clearWidths?.[i+1]??path.clearWidth)/2+24;
   if(a.layer===layer&&b.layer===layer&&a.elevation===z&&b.elevation===z)return[{a,b,clearance}];
   // A ramp may cross a chassis wall before it has gained a ball diameter of
   // height. Reserve only that native near-floor section, never its whole span.
   if(a.elevation!==b.elevation){const near=(from:typeof a,to:typeof b)=>{const t=Math.min(1,24/Math.abs(to.elevation-from.elevation));return{...from,x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,elevation:from.elevation+(to.elevation-from.elevation)*t};};if(a.layer===layer&&a.elevation===z)return[{a,b:near(a,b),clearance}];if(b.layer===layer&&b.elevation===z)return[{a:near(b,a),b,clearance}];}
   return[];}));
  let apertureSegments=segments;
  const reserved=(point:ArenaPoint)=>apertureSegments.some(({a,b,clearance})=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy)<clearance;});
  for(const edge of [1,2,3,4,5]){const a=terraceBoundary[edge]!,b=terraceBoundary[(edge+1)%terraceBoundary.length]!;apertureSegments=segments.filter(segment=>{const ux=b.x-a.x,uy=b.y-a.y,vx=segment.b.x-segment.a.x,vy=segment.b.y-segment.a.y,dx=segment.a.x-a.x,dy=segment.a.y-a.y,den=ux*vy-uy*vx;if(Math.abs(den)<1e-6)return false;const t=(dx*vy-dy*vx)/den,u=(dx*uy-dy*ux)/den;return t>=0&&t<=1&&u>=0&&u<=1;});const count=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/8),point=(i:number):TrackVertex=>({x:q(a.x+(b.x-a.x)*i/count),y:q(a.y+(b.y-a.y)*i/count),layer,elevation:z}),open=Array.from({length:count+1},(_,i)=>reserved(point(i)));let start:number|null=null,part=0;
   for(let i=0;i<count;i++){const clear=!open[Math.max(0,i-1)]&&!open[i]&&!open[i+1]&&!open[Math.min(count,i+2)];if(clear&&start===null)start=i;if(start!==null&&(!clear||i===count-1)){const end=clear?i+1:i;if(end>start)rails.push(...splitRail(`${boundaryId}.edge.${edge}.part.${part++}`,point(start),point(end)));start=null;}}
  }
 }
 // Shape only the catch/miss support and the actual guide envelopes. There is
 // no giant rectangle underneath every route, nor an invisible ground void.
 const fanOutline=[p(-680,-190),p(680,-190),p(Math.max(720,plan.silhouette.width*.44),360),p(plan.silhouette.width*.34,600),p(-plan.silhouette.width*.4,600),p(-plan.silhouette.width*.48,360)];
 surfaces.push({id:`${plan.id}.catch-support`,kind:'playfield',role:'catch',polygon:fanOutline.map(({x,y})=>({x,y})),layer:plan.layer,height:plan.elevation,material:'pinball-inlay',biome});
 for(let i=1;i<fanOutline.length;i++){const a=fanOutline[i]!,b=fanOutline[(i+1)%fanOutline.length]!;if(i===2||i===3||i===4)continue;rails.push(...splitRail(`${plan.id}.miss-guide.${i}`,a,b));}
 // The void is real authority hazard, behind actual guides. Required track
 // beds stay outside its swept footprint; static/trajectory admission checks it.
 if(plan.silhouette.centralVoid!=='none'&&bindings){const center=p(0,Math.min(plan.silhouette.height*.65,950));hazards.push({id:`${plan.id}.void`,kind:'drain',x:center.x,y:center.y,radius:plan.family==='loop-gallery'?180:100,layer:plan.layer,elevation:plan.elevation,damage:1,cooldownTicks:180});}
 const all=surfaces.flatMap(s=>s.polygon),xs=all.map(p=>p.x),ys=all.map(p=>p.y),bounds=[q(Math.min(...xs)-40),q(Math.min(...ys)-40),q(Math.max(...xs)+40),q(Math.max(...ys)+40)] as const,regionId=`${plan.id}.region`;
 const physicalField:ArenaField={id:plan.id,name:plan.family.toUpperCase(),seed:plan.seed,gravity:{x:0,y:0},bounds,regions:[{id:regionId,name:plan.family.toUpperCase(),bounds,center:origin,seed:plan.seed,biome,neighbors:[]}],chunks:[],rails,bumpers:[],flippers,stations,switches,gates,ramps,captures,portals:[],surfaces,hazards,flows,routes:{nodes:[],edges:[]},challenges,requirements,pinball:{paths,ports},playfields:[{id:`${plan.id}.playfield`,name:plan.family.toUpperCase(),regionId,bounds,stationIds:stations.map(s=>s.id),shotRouteIds:challenges.map(c=>c.id)}]};
 const framing=options.framing==='canonical'?planPinballFraming(physicalField,{family:plan.family,theme:plan.framing.theme,unitScale:.025,seed:options.cabinetSeed??plan.seed,...(options.sceneBlueprint?{sceneBlueprint:options.sceneBlueprint}:{}),...(options.sceneStage===undefined?{}:{stage:options.sceneStage}),maxInstances:48,structuralSurfaceIds:surfaces.filter(s=>s.kind==='playfield').map(s=>s.id)}):null;
 // Scenery extents are presentation data. They must not move the authority's
 // storm, escape bounds, or shared playable territory.
 const field:ArenaField=framing?{...physicalField,scene:framing.genome,chunks:framing.chunks}:physicalField;
 return {status:'unqualified-fragment',compiler:ARCADE_COMPILER_REVISION,plan,options,field,portBindings,staticIssues:[...inspectPinballGeometry(field,{ballRadius:12}),...inspectArcadeBankClearance(field)]};
}
export function compileForkBasin(plan:ArcadeAssemblyPlan,options:ArcadeAssemblyCompileOptions){if(plan.family!=='fork-basin')throw new Error('Fork family required');return compileFamily(plan,options);}
export function compileTerraceSwitchback(plan:ArcadeAssemblyPlan,options:ArcadeAssemblyCompileOptions){if(plan.family!=='terrace-switchback')throw new Error('Terrace family required');return compileFamily(plan,options);}
export function compileLoopGallery(plan:ArcadeAssemblyPlan,options:ArcadeAssemblyCompileOptions){if(plan.family!=='loop-gallery')throw new Error('Loop family required');return compileFamily(plan,options);}
/** A fixture wrapper for exact authority calibration only. Its world identity
 * binds the entire requested plan plus the rebound physical fragment. */
export function arcadeFragmentProbeWorld(fragment:ArcadeAssemblyFragment):ArenaWorldDefinition{
 const body={schema:'keel-pinball-arena-world@1' as const,generatorVersion:ARCADE_COMPILER_REVISION,id:`${fragment.plan.id}.probe.${hash({plan:fragment.plan,options:fragment.options})}`,seed:fragment.plan.seed,unitScale:.025,arenas:[fragment.field],links:[]},world={...body,canonical:JSON.stringify(body),sha256:hash(body)},player:ArenaPlayer={ownerId:fragment.plan.banks[fragment.options.bankIndex??0]!.launchOwnerId??0,teamId:fragment.plan.banks[fragment.options.bankIndex??0]!.launchOwnerId??0,name:'PHYSICAL CALIBRATION',role:'vector',bot:false,ballRadius:12};
 const budget=createPinballBudget();budget.reserve('authority',{players:1,bodies:1,arenas:1});budget.reserve(fragment.plan.id,countPinballMechanisms(fragment.field));budget.assertCompiled(world,[player]);validateArenaWorld(world);return world;
}
/** Solve actual launcher→blade→outgoing rays. This does not grant route/return
 * acceptance; the resulting exact bindings still need eight-start witnesses. */
export function measureArcadeCatch(plan:ArcadeAssemblyPlan,options:Omit<ArcadeAssemblyCompileOptions,'bindings'>){
 const fragment=compileFamily(plan,options),world=arcadeFragmentProbeWorld(fragment),ownerId=plan.banks[options.bankIndex??0]!.launchOwnerId??0,player:ArenaPlayer={ownerId,teamId:ownerId,name:'CATCH PROBE',role:'vector',bot:false,ballRadius:12};
 const run=(bits:0|1|3,start:number)=>{const match=createArenaMatch(world,{players:[player],mode:'expedition',defeatPolicy:'eliminate',maxTicks:2400});let firstBlade:number|null=null,actuated=false;const {origin,rotation}=transform(plan,options.bankIndex??0,options.translation),up=rotation({x:0,y:1});
  for(let tick=1;tick<=1200;tick++){const held=bits!==0&&tick>=start&&tick<start+120,frame=match.step([{ownerId,bits:tick===1?4:held?bits:0}]),b=frame.balls[0]!;for(const event of frame.events.filter(e=>e.type==='flipper')){firstBlade??=tick;const blade=fragment.field.flippers.find(f=>f.id===event.colliderId)!,pose=frame.flippers.find(f=>f.id===event.colliderId)!;if(held&&(bits&(blade.side==='left'?1:2))&&pose.ownerId===ownerId&&Math.abs(pose.angle-blade.restAngle)>.1)actuated=true;}if(match.getStats().contactBudget||frame.events.some(e=>['ramp-abort','fall','escape','drain'].includes(e.type)))break;const dx=b.x-origin.x,dy=b.y-origin.y,y=dx*up.x+dy*up.y,x=dx*up.y-dy*up.x,vy=b.vx*up.x+b.vy*up.y,vx=b.vx*up.y-b.vy*up.x;if(actuated&&y>=(options.feed==='peripheral'?460:400)&&vy>(options.feed==='peripheral'?5:6))return {firstBlade,ray:{x:q(x),y:q(y),vx,vy,bits:bits as 1|3,startTick:start}};}
  return {firstBlade,ray:null};};
 const baseline=run(0,0);if(baseline.firstBlade===null)throw new Error('Actual shooter did not reach a usable blade');const start=Math.max(2,baseline.firstBlade-37),orbit=run(1,start),cross=run(3,start);if(!orbit.ray||!cross.ray||Math.hypot(orbit.ray.x-cross.ray.x,orbit.ray.y-cross.ray.y)<120)throw new Error('Two actual catch rays not separated');return {world,firstBladeTick:baseline.firstBlade,bindings:{orbit:orbit.ray,cross:cross.ray} satisfies ArcadeAssemblyBindings};
}

/** Measures the next controlled shot after a supported ascent into a different
 * bank. The body and lease are produced entirely by launch and button input. */
export function measureArcadeDownstreamCatch(plan:ArcadeAssemblyPlan,options:Omit<ArcadeAssemblyCompileOptions,'bindings'|'downstreamBinding'>,controlBits:1|3=3,startOffset=0){
 const first=measureArcadeCatch(plan,options),fragment=compileTerraceSwitchback(plan,{...options,bindings:first.bindings,terraceCascade:true}),world=arcadeFragmentProbeWorld(fragment),ownerId=plan.banks[options.bankIndex??0]!.launchOwnerId??0,player:ArenaPlayer={ownerId,teamId:ownerId,name:'TERRACE TRANSFER',role:'vector',bot:false,ballRadius:12},station=fragment.field.stations.find(s=>s.id===`${plan.id}.terrace.bank.0.catch`)!;
 const blades=fragment.field.flippers.filter(f=>station.flipperIds.includes(f.id)),center={x:(blades[0]!.pivotX+blades[1]!.pivotX)/2,y:(blades[0]!.pivotY+blades[1]!.pivotY)/2},up=transform(plan,options.bankIndex??0).rotation({x:0,y:1});
 const run=(secondStart:number,secondBits:0|1|3)=>{const match=createArenaMatch(world,{players:[player],mode:'expedition',defeatPolicy:'eliminate',maxTicks:2400});let firstBlade:number|null=null,actuated=false;
  for(let tick=1;tick<=900;tick++){const held=secondBits!==0&&tick>=secondStart&&tick<secondStart+120,firstHeld=tick>=first.bindings.cross.startTick&&tick<first.bindings.cross.startTick+120,frame=match.step([{ownerId,bits:tick===1?4:firstHeld?3:held?secondBits:0}]),ball=frame.balls[0]!;
   for(const event of frame.events.filter(e=>e.type==='flipper'&&station.flipperIds.includes(e.colliderId!))){firstBlade??=tick;const blade=fragment.field.flippers.find(f=>f.id===event.colliderId)!,pose=frame.flippers.find(f=>f.id===event.colliderId)!;if(held&&(secondBits&(blade.side==='left'?1:2))&&pose.ownerId===ownerId&&Math.abs(pose.angle-blade.restAngle)>.1)actuated=true;}
   if(match.getStats().contactBudget||frame.events.some(e=>['ramp-abort','fall','escape','drain'].includes(e.type)))break;
   const dx=ball.x-center.x,dy=ball.y-center.y,y=dx*up.x+dy*up.y,x=dx*up.y-dy*up.x,vy=ball.vx*up.x+ball.vy*up.y,vx=ball.vx*up.y-ball.vy*up.x;
   if(actuated&&y>=(options.feed==='peripheral'?460:300)&&vy>6)return {firstBlade,ray:{x:q(x),y:q(y),vx,vy,bits:secondBits as 1|3,startTick:secondStart}};
  }return {firstBlade,ray:null};};
 const baseline=run(0,0);if(baseline.firstBlade===null)throw new Error('Upper terrace did not receive an actual blade contact');const controlled=run(Math.max(2,baseline.firstBlade-37+startOffset),controlBits);if(!controlled.ray)throw new Error('Upper terrace did not yield an actual controlled outgoing ray');
 return {first,firstBladeTick:baseline.firstBlade,downstreamBinding:controlled.ray};
}
