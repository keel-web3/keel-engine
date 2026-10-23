import {dsin,dhypot} from '@keel-engine/core';
import type {PixelCanvas} from '@keel-engine/pinball-pixel-art';
import type {PinballRoomEnvironmentTheme} from './types.ts';
export type PinballFoliageAnchor=Readonly<{id:string;x:number;y:number;elevation:number;size:number;kind:'broad'|'spear'|'fern';mirror:boolean;phase:number}>;
export type PinballFoliageBody=Readonly<{id:string;x:number;y:number;elevation:number;vx:number;vy:number;radius:number}>;
export type PinballReactiveFoliageRequest=Readonly<{theme:PinballRoomEnvironmentTheme;tick:number;reducedMotion:boolean;inkOffset:number;anchors:readonly PinballFoliageAnchor[];bodies:readonly PinballFoliageBody[];project:(x:number,y:number,z:number)=>readonly[number,number]}>;
// Original asymmetrical leaf clusters, with grouped veins and specular cells.
// This is a presentation sprite vocabulary; anchors belong to caller's scene.
const masks={
 broad:['........1111........','......11233211......','....11234443321.....','..11234443333221....','.1234443332233321...','123443322123443321..','123332211233443321..','.1232212334433221...','..1122334433221.....','....123332211.......','.....112211.........','.......11...........'],
 spear:['................111.','.............112331.','..........112344321.','.......11234443321..','.....123444333221...','...1234433323321....','.12344332233321.....','1233322333321.......','12322333221.........','.12222211...........','..1111..............','....................'],
 fern:['.........11.........','...11....12....11...','..1231...123..1231..','.123431..123.123431.','..1234321231234321..','...1234321234321....','....12343234321.....','......1234321.......','...112123321211.....','..12343213234321....','...123432123321.....','....112321211.......','......11211.........','........11..........']
}as const;
const themes=['ion-relay','grove','vaporwave'];
function finite(v:number){return Number.isFinite(v)&&Math.abs(v)<=1e6;}
/** Foliage bends away from caller-supplied CURRENT native body positions and
 * velocity. It never alters the body, physics, routes or interaction state.
 * Draw behind native rails and current balls to retain gameplay readability. */
export function paintPinballReactiveFoliage(p:PixelCanvas,r:PinballReactiveFoliageRequest){
 if(!themes.includes(r.theme)||!Number.isSafeInteger(r.tick)||r.tick<0||r.tick>432000||typeof r.reducedMotion!=='boolean'||!Number.isSafeInteger(r.inkOffset)||r.inkOffset<0||r.inkOffset+20>p.palette.length||!Array.isArray(r.anchors)||r.anchors.length>64||!Array.isArray(r.bodies)||r.bodies.length>128||typeof r.project!=='function'||p.W>1024||p.H>1024||![p.offsetX,p.offsetY].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6))throw Error('Reactive foliage budget');
 const ids=new Set<string>(),bodyIds=new Set<string>();
 const project=(x:number,y:number,z:number)=>{const q=r.project(x,y,z);if(!Array.isArray(q)||q.length!==2||![0,1].every(i=>Object.hasOwn(q,i)&&Number.isFinite(q[i])&&Math.abs(q[i]!)<=100000))throw Error('Reactive foliage projection');return[q[0],q[1]]as const;};
 const anchors=Array.from({length:r.anchors.length},(_,i)=>{
  const a=r.anchors[i];if(!Object.hasOwn(r.anchors,i)||!a||typeof a.id!=='string'||!a.id||a.id.length>256||ids.has(a.id)||![a.x,a.y,a.elevation,a.size].every(finite)||a.size<.35||a.size>2||!Object.hasOwn(masks,a.kind)||typeof a.mirror!=='boolean'||!Number.isInteger(a.phase)||a.phase<0||a.phase>255)throw Error('Reactive foliage anchor');ids.add(a.id);return{source:a,q:project(a.x,a.y,a.elevation)};
 });
 const bodies=Array.from({length:r.bodies.length},(_,i)=>{
  const b=r.bodies[i];if(!Object.hasOwn(r.bodies,i)||!b||typeof b.id!=='string'||!b.id||b.id.length>256||bodyIds.has(b.id)||![b.x,b.y,b.elevation,b.vx,b.vy,b.radius].every(finite)||b.radius<=0||b.radius>128||Math.abs(b.vx)>1024||Math.abs(b.vy)>1024)throw Error('Reactive foliage body');bodyIds.add(b.id);return{source:b,q:project(b.x,b.y,b.elevation),velocity:project(b.x+b.vx,b.y+b.vy,b.elevation)};
 }).sort((a,b)=>a.source.id<b.source.id?-1:a.source.id>b.source.id?1:0);
 let bending=0,clusters=0,maxDisplacement=0;
 for(const a of anchors){
  const mask=masks[a.source.kind],size=a.source.size,left=a.q[0]-mask[0].length*size*.5,top=a.q[1]-mask.length*size*.6;
  if(left+p.offsetX+mask[0].length*size+8<0||left+p.offsetX-8>p.W||top+p.offsetY+mask.length*size+8<0||top+p.offsetY-8>p.H)continue;
  let windX=0,windY=0,strength=0;
  if(!r.reducedMotion)for(const b of bodies){
   const distance=dhypot(a.source.x-b.source.x,a.source.y-b.source.y),reach=Math.min(180,120+b.source.radius*2);
   if(Math.abs(a.source.elevation-b.source.elevation)>80||distance>=reach)continue;
   const weight=(1-distance/reach)*Math.min(1,dhypot(b.source.vx,b.source.vy)/8+.15);
   if(weight<=strength)continue;strength=weight;
   const dx=a.q[0]-b.q[0],dy=a.q[1]-b.q[1],d=dhypot(dx,dy)||1;
   windX=weight*(dx/d*5+Math.max(-1,Math.min(1,b.velocity[0]-b.q[0]))*2);
   windY=weight*(dy/d*3+Math.max(-1,Math.min(1,b.velocity[1]-b.q[1])));
  }
  if(strength>.02)bending++;clusters++;
  const ambient=r.reducedMotion?0:dsin(r.tick*.025+a.source.phase*.1)*.8;
  for(let y=0;y<mask.length;y++){
   const tip=1-y/Math.max(1,mask.length-1),bendX=Math.round((windX+ambient)*tip),bendY=Math.round(windY*tip);maxDisplacement=Math.max(maxDisplacement,Math.abs(bendX),Math.abs(bendY));
   for(let x=0;x<mask[y]!.length;){const cell=mask[y]![a.source.mirror?mask[y]!.length-1-x:x]!;let end=x+1;while(end<mask[y]!.length&&mask[y]![a.source.mirror?mask[y]!.length-1-end:end]===cell)end++;
    if(cell!=='.')p.rect(left+x*size+bendX,top+y*size+bendY,(end-x)*size,size,r.inkOffset+9+Number(cell));x=end;
   }
  }
 }
 return{clusters,bending,maxDisplacement,scope:'Decorative current-body wind response; no collision or hidden player state'};
}
