import type {ArenaPoint,ArenaBounds,ArenaRail,ArenaFlipper,ArenaStation,ArenaGate,ArenaHazard,ArenaFlow,ArenaSurface,ArenaRouteChallenge,ArenaGateRequirement,ArenaBiomeBlend} from '@keel-engine/pinball-arena';
const q=(n:number)=>Math.round(n*1024)/1024;
export interface PinballSectorOptions {readonly id:string;readonly origin:ArenaPoint;readonly owners:readonly {readonly ownerId:number;readonly teamId:number}[];readonly biome:ArenaBiomeBlend}
export interface PinballSectorPort {readonly id:string;readonly role:'shot-exit'|'return-entry';readonly x:number;readonly y:number;readonly layer:number;readonly elevation:number;readonly direction:ArenaPoint;readonly width:number}
/** Calibrated local scale: 96-unit flippers, 250-unit serve fall, target shots
 * within 900 units of the bats. Five banks share the entire upper field. */
export function compilePinballSector(options:PinballSectorOptions){
 const {id,origin,owners,biome}=options;if(!id||owners.length<1||owners.length>5)throw new Error('Pinball sector bank count');
 const rails:ArenaRail[]=[],flippers:ArenaFlipper[]=[],stations:ArenaStation[]=[],gates:ArenaGate[]=[],hazards:ArenaHazard[]=[],flows:ArenaFlow[]=[],surfaces:ArenaSurface[]=[],challenges:ArenaRouteChallenge[]=[],requirements:ArenaGateRequirement[]=[],ports:PinballSectorPort[]=[],pitch=1200,base=origin.y,centers=owners.map((_,i)=>origin.x+(i-(owners.length-1)/2)*pitch),bounds:ArenaBounds=[centers[0]!-600,base-200,centers.at(-1)!+600,base+1800];
 const rail=(key:string,ax:number,ay:number,bx:number,by:number)=>{const pieces=Math.ceil(Math.hypot(bx-ax,by-ay)/768);for(let n=0;n<pieces;n++)rails.push({id:`${id}.${key}.${n}`,ax:q(ax+(bx-ax)*n/pieces),ay:q(ay+(by-ay)*n/pieces),bx:q(ax+(bx-ax)*(n+1)/pieces),by:q(ay+(by-ay)*(n+1)/pieces),radius:3,restitution:.95,layer:0,elevation:0,material:'steel',kind:'guide'});};
 // Only the sector exterior has sidewalls. Every upper shot lane is common.
 rail('outer-left',bounds[0]+80,base+400,bounds[0]+80,base+1400);rail('outer-right',bounds[2]-80,base+400,bounds[2]-80,base+1400);
 const leftRoutes:string[]=[],rightRoutes:string[]=[];
 for(let i=0;i<owners.length;i++){
  const owner=owners[i]!,x=centers[i]!,sid=`${id}.bank.${i}`,left=`${sid}.left-flipper`,right=`${sid}.right-flipper`;
  flippers.push({id:left,ownerId:owner.ownerId,side:'left',pivotX:q(x-125),pivotY:base,length:96,radius:8,restAngle:-18,activeAngle:35,layer:0,elevation:0},{id:right,ownerId:owner.ownerId,side:'right',pivotX:q(x+125),pivotY:base,length:96,radius:8,restAngle:198,activeAngle:145,layer:0,elevation:0});
  stations.push({id:sid,ownerId:owner.ownerId,teamId:owner.teamId,x:q(x),y:q(base+40),layer:0,elevation:0,launchX:q(x-50),launchY:q(base+250),launchVx:0,launchVy:-6,flipperIds:[left,right]});
  rail(`bank.${i}.catch-left`,x-520,base+400,x-125,base);rail(`bank.${i}.catch-right`,x+520,base+400,x+125,base);
  hazards.push({id:`${sid}.drain`,kind:'drain',x:q(x),y:q(base-140),radius:90,layer:0,elevation:0,damage:1,cooldownTicks:180});
  for(const [side,tx,ty,dx,dy,mx,my]of [['left',-340,900,110,34,-225,640],['right',170,900,110,-28,140,840]] as const){
   const gid=`${id}.target-bank.${side}.${i}`,routeId=`${sid}.shot.${side}`;
   gates.push({id:gid,kind:'target',ax:q(x+tx-dx/2),ay:q(base+ty-dy/2),bx:q(x+tx+dx/2),by:q(base+ty+dy/2),radius:4,restitution:.95,layer:0,elevation:0,initiallyOpen:false});
   challenges.push({id:routeId,name:side==='left'?'LEFT TARGET SHOT':'RIGHT TARGET SHOT',finalColliderId:gid,checkpoints:[{x:q(x+mx),y:q(base+my),radius:65,layer:0,elevation:0},{x:q(x+tx),y:q(base+ty),radius:65,layer:0,elevation:0}]});
   (side==='left'?leftRoutes:rightRoutes).push(routeId);
  }
 }
 for(let x=bounds[0]+300;x<bounds[2];x+=600)flows.push({id:`${id}.slope.${Math.round(x)}`,ax:q(x),ay:q(base-200),bx:q(x),by:q(base+1750),width:600,fx:0,fy:-.04,layer:0,maxSpeed:18});
 // A shared target bank stays solid until two distinct physical shots qualify.
 requirements.push({id:`${id}.two-shot-lock`,name:'LEFT + RIGHT TARGET SHOTS',routeIds:[leftRoutes[0]!,rightRoutes[0]!],routeGroups:[leftRoutes,rightRoutes],gateIds:gates.map(g=>g.id),scope:'team',holdTicks:1800,persistent:true});
 surfaces.push({id:`${id}.bed`,kind:'playfield',role:'shot',polygon:[{x:bounds[0],y:bounds[1]},{x:bounds[2],y:bounds[1]},{x:bounds[2],y:bounds[3]},{x:bounds[0],y:bounds[3]}],layer:0,height:0,material:'pinball-inlay',biome});
 ports.push({id:`${id}.shared-upper-exit`,role:'shot-exit',x:q(centers.at(-1)!+500),y:q(base+1500),layer:0,elevation:0,direction:{x:1,y:0},width:240},{id:`${id}.shared-return-entry`,role:'return-entry',x:q(centers[0]!-500),y:q(base+700),layer:0,elevation:0,direction:{x:0,y:-1},width:240});
 return {id,bounds,rails,flippers,stations,gates,hazards,flows,surfaces,challenges,requirements,ports};
}
