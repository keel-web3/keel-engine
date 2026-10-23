import {createRoll,deriveSeed,normalizeSeed} from '@keel-engine/core/rng';
import type {ArenaBiomeBlend,ArenaFlipper,ArenaFlow,ArenaHazard,ArenaPoint,ArenaRail,ArenaStation,ArenaSurface} from '@keel-engine/pinball-arena';
import type {ArcadeAssemblyPlan} from './arcade-script.ts';
import {compileTrack,cubic,type TrackVertex} from './tracks.ts';

export const ARCADE_CATCH_REVISION='arcade-catch/2026-10-07.6';
const q=(n:number)=>Math.round(n*1024)/1024;
export interface ArcadeCatchOptions {readonly bankIndex:number;readonly attempt:number;readonly biome:ArenaBiomeBlend;readonly feed:'calibrated-wireform'|'peripheral';readonly translation?:ArenaPoint;readonly arrivalOnly?:boolean;readonly arrivalOffset?:number;readonly activeAngle?:number;readonly trackClearWidth?:32|40|48|64}
export interface ArcadeCatchSpec {
 readonly id:string;readonly bankIndex:number;readonly pivot:ArenaPoint;readonly leftFlipperId:string;readonly rightFlipperId:string;
 readonly guideIds:readonly string[];readonly shooterPathId:string;readonly drainId:string;
 readonly span:number;readonly length:number;readonly rest:number;readonly active:number;readonly feed:ArcadeCatchOptions['feed'];
}
/** A local bank is a physical fragment, never an admitted standalone cabinet.
 * Shared arrays only get the two outside funnel walls; their interior stays open.
 * The calibrated feed is retained as a diagnostic primitive while each family
 * peripheral feed is independently measured. No shot routes are emitted here. */
export function compileArcadeCatch(plan:ArcadeAssemblyPlan,options:ArcadeCatchOptions){
 const {bankIndex,attempt,biome,feed}=options,bank=plan.banks[bankIndex];
 if(![32,40,48,64].includes(options.trackClearWidth??32))throw new Error('Catch track clearance profile');
 if(options.activeAngle!==undefined&&(!Number.isFinite(options.activeAngle)||options.activeAngle<8||options.activeAngle>60))throw new Error('Catch active angle');
 if(!bank||!Number.isFinite(options.arrivalOffset??0)||Math.abs(options.arrivalOffset??0)>120||!Number.isInteger(attempt)||attempt<0||attempt>31)throw new Error('Arcade catch recipe bounds');
 const seed=deriveSeed(normalizeSeed(plan.seed),`catch:${bankIndex}:${attempt}`),roll=createRoll(seed),span=212+roll.index(0,9),length=94+roll.index(1,3),rest=28+roll.index(2,5),active=options.activeAngle??(feed==='peripheral'?10+roll.index(3,12):32+roll.index(3,7));
 const id=`${plan.id}.bank.${bankIndex}.catch`,left=`${id}.left`,right=`${id}.right`,o={x:bank.center.x+(options.translation?.x??0),y:bank.center.y+(options.translation?.y??0)},turns=plan.quarterTurns,baseLayer=plan.layer,z=plan.elevation;
 const rotate=(p:ArenaPoint):ArenaPoint=>turns===1?{x:-p.y,y:p.x}:turns===2?{x:-p.x,y:-p.y}:turns===3?{x:p.y,y:-p.x}:p;
 const p=(x:number,y:number,layer=baseLayer,elevation=z):TrackVertex=>{const r=rotate({x,y});return {x:q(o.x+r.x),y:q(o.y+r.y),layer,elevation};};
 const rails:ArenaRail[]=[],flippers:ArenaFlipper[]=[],surfaces:ArenaSurface[]=[],hazards:ArenaHazard[]=[],flows:ArenaFlow[]=[];
 const rail=(suffix:string,a:TrackVertex,b:TrackVertex)=>rails.push({id:`${id}.${suffix}`,ax:a.x,ay:a.y,bx:b.x,by:b.y,radius:3,restitution:.88,layer:a.layer,elevation:a.elevation,material:'steel',kind:'guide'});
 if(bankIndex===0){rail('outer-left-upper',p(-620,400),p(-400,210));rail('outer-left-lower',p(-400,210),p(-span/2,0));}
 if(bankIndex===plan.bankCount-1){rail('outer-right-upper',p(520,400),p(300,210));rail('outer-right-lower',p(300,210),p(span/2,0));}
 for(const side of ['left','right'] as const){const v=p(side==='left'?-span/2:span/2,0);flippers.push({id:side==='left'?left:right,ownerId:bank.launchOwnerId??-1,side,pivotX:v.x,pivotY:v.y,length,radius:8,restAngle:((side==='left'?-rest:180+rest)+turns*90+180)%360-180,activeAngle:((side==='left'?-rest:180+rest)+turns*90+180)%360-180+(side==='left'?rest+active:-rest-active),layer:baseLayer,elevation:z});}
 // Elevation is allocated before a feed: never silently exceed native layers.
 const shooterLayer=Math.min(3,baseLayer+2),shooterZ=z+Math.min(180,400-z);
 if(!options.arrivalOnly&&(baseLayer>=3||shooterZ<=z))throw new Error('Catch shooter tier capacity');
 const crestY=feed==='calibrated-wireform'?430:Math.max(430,plan.silhouette.height*.32),crestX=feed==='calibrated-wireform'?560:Math.max(560,plan.silhouette.width*.38);
 const feedOffset=(attempt%9-4)*8;
 const points=(path:ArenaPoint[],layer=baseLayer,elevation=z)=>path.map(v=>p(v.x,v.y,layer,elevation));
 const shooter=feed==='calibrated-wireform'?[p(560,60),p(560,430,shooterLayer,shooterZ),...points(cubic({x:560,y:430},{x:560,y:900},{x:0,y:1100},{x:0,y:650},16),shooterLayer,shooterZ).slice(1),p(0,120)]:[p(560,60),p(560,430,shooterLayer,shooterZ),...points(cubic({x:560,y:430},{x:560,y:900},{x:feedOffset,y:1100},{x:feedOffset,y:650},16),shooterLayer,shooterZ).slice(1),p(feedOffset,450)];
 const shot=options.arrivalOnly?null:compileTrack({id:`${id}.shooter`,role:'shooter',vertices:shooter,clearWidth:options.trackClearWidth??32,deck:'wireform',biome,receiverCatchId:id,returnStartVertex:8,qualificationId:`${id}.skillshot`}),inlane=compileTrack({id:`${id}.feed`,role:'inlane',vertices:[p(options.arrivalOffset??0,120),p(options.arrivalOffset??0,60)],clearWidth:32,clearWidths:[64,32],biome,receiverCatchId:id});
 if(!options.arrivalOnly){rails.push(...shot!.rails);surfaces.push(...shot!.surfaces);}if(feed==='calibrated-wireform'){rails.push(...inlane.rails);surfaces.push(...inlane.surfaces);}
 const fan=[p(-400,-190),p(400,-190),p(520,400),p(300,350),p(-400,350),p(-620,400)];
 surfaces.unshift({id:`${id}.fan`,kind:'playfield',role:'catch',polygon:fan.map(({x,y})=>({x,y})),layer:baseLayer,height:z,material:'pinball-inlay',biome});
 const drain=p(0,-140);hazards.push({id:`${id}.drain`,kind:'drain',x:drain.x,y:drain.y,radius:90,layer:baseLayer,elevation:z,damage:1,cooldownTicks:180});
 // Parallel bounded strips are the real local slope, rotated with the bank.
 // Higher layers get their own support-aligned force in the assembly compiler.
 for(const [i,x]of [-600,0,600].entries()){const a=p(x,-200),b=p(x,options.arrivalOnly?400:Math.max(1100,plan.silhouette.height));flows.push({id:`${id}.slope.${i}`,ax:a.x,ay:a.y,bx:b.x,by:b.y,width:600,fx:plan.physics.localDown.x*.04,fy:plan.physics.localDown.y*.04,layer:baseLayer,elevation:z,maxSpeed:18});}
 const start=options.arrivalOnly?p(0,80):shooter[0]!,direction=rotate({x:0,y:9+roll.index(7,4)}),center=p(0,-130),stations:ArenaStation[]=[{id,ownerId:bank.launchOwnerId??-1,teamId:bank.launchOwnerId??-1,x:center.x,y:center.y,layer:baseLayer,elevation:z,launchX:start.x,launchY:start.y,launchVx:direction.x,launchVy:direction.y,flipperIds:[left,right]}];
 return {spec:{id,bankIndex,pivot:o,leftFlipperId:left,rightFlipperId:right,guideIds:rails.slice(0,bankIndex===0&&bankIndex===plan.bankCount-1?4:bankIndex===0||bankIndex===plan.bankCount-1?2:0).map(r=>r.id),shooterPathId:shot?.path.id??`${id}.feed`,drainId:`${id}.drain`,span,length,rest,active,feed} satisfies ArcadeCatchSpec,rails,flippers,stations,surfaces,hazards,flows,ramps:[...(options.arrivalOnly?[]:shot!.ramps),...(feed==='calibrated-wireform'?inlane.ramps:[])],paths:[...(options.arrivalOnly?[]:[shot!.path]),...(feed==='calibrated-wireform'?[inlane.path]:[])],ports:[...(options.arrivalOnly?[]:shot!.ports),...(feed==='calibrated-wireform'?inlane.ports:[])]};
}
