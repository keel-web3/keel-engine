import {dhypot} from '@keel-engine/core';
import type {ArenaFrame} from '@keel-engine/pinball-arena';
import type {PinballFeedbackSample} from '@keel-engine/pinball-feedback';
import type {PixelCanvas} from '@keel-engine/pinball-pixel-art';
import type {RoomArtTheme,RoomProjection} from './index.ts';

type Point=readonly[number,number];
const themes=['ion-relay','grove','vaporwave'];
function point(q:Point):Point {
 if(!Array.isArray(q)||q.length!==2||![0,1].every(i=>Object.hasOwn(q,i)&&Number.isFinite(q[i])&&Math.abs(q[i]!)<=1e6))throw Error('Working blade dense endpoint');
 return[q[0],q[1]];
}
function prepare(p:PixelCanvas,theme:RoomArtTheme,a:Point,b:Point,radius:number,flash:number){
 if(!themes.includes(theme)||p.palette.length<32||![radius,flash,p.offsetX,p.offsetY].every(Number.isFinite)||radius<=0||radius>32||flash<0||flash>1||Math.abs(p.offsetX)>1e6||Math.abs(p.offsetY)>1e6)throw Error('Working blade arguments');
 const A=point(a),B=point(b),dx=B[0]-A[0],dy=B[1]-A[1],length=dhypot(dx,dy);
 if(length>8192)throw Error('Working blade span');
 const minX=Math.max(Math.ceil(-p.offsetX-.5),Math.floor(Math.min(A[0],B[0])-radius)),maxX=Math.min(Math.ceil(p.W-p.offsetX-.5)-1,Math.ceil(Math.max(A[0],B[0])+radius));
 const minY=Math.max(Math.ceil(-p.offsetY-.5),Math.floor(Math.min(A[1],B[1])-radius)),maxY=Math.min(Math.ceil(p.H-p.offsetY-.5)-1,Math.ceil(Math.max(A[1],B[1])+radius));
 const work=Math.max(0,maxX-minX+1)*Math.max(0,maxY-minY+1);
 if(work>1048576)throw Error('Working blade raster budget');
 return{A,B,dx,dy,length,radius,flash,minX,maxX,minY,maxY,work};
}
type Blade=ReturnType<typeof prepare>;
function draw(p:PixelCanvas,theme:RoomArtTheme,v:Blade){
 const {A,dx,dy,length,radius,flash,minX,maxX,minY,maxY}=v,rr=radius*radius;
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  const t=length?Math.max(0,Math.min(1,((x-A[0])*dx+(y-A[1])*dy)/(length*length))):0;
  const qx=x-A[0]-dx*t,qy=y-A[1]-dy*t,d=qx*qx+qy*qy;if(d>rr)continue;
  // Contact silhouette is the actual current capsule. Inset material changes
  // within it; no oversized pivot housing or extrapolated blade is painted.
  const edge=Math.sqrt(d)/radius,lit=(qx+qy)/radius,along=t*length;
  let ink=1;
  if(edge<.86){
   if(theme==='ion-relay'){
    ink=lit<-.35?6:lit<.22?5:lit<.62?4:3;
    if(t>.15&&t<.89&&edge<.40)ink=16;
    if(t>.15&&t<.89&&edge<.22)ink=lit<0?18:17;
    if(t>.18&&t<.86&&Math.floor(along)%9<2&&edge<.58)ink=3;
   }else if(theme==='grove'){
    ink=lit<-.40?18:lit<.15?17:lit<.55?16:14;
    if(t>.14&&t<.91&&edge<.48)ink=15;
    if(t>.22&&t<.88&&Math.floor(along+lit*2)%11<2)ink=14;
   }else{
    ink=lit<-.40?19:lit<.12?18:lit<.60?17:15;
    if(t>.16&&t<.88&&edge<.37)ink=22;
    if(t>.16&&t<.88&&edge<.16)ink=24;
    if(t>.20&&t<.85&&Math.floor(along)%13<2&&edge<.55)ink=14;
   }
   const pivot=dhypot(x-A[0],y-A[1])/radius;
   if(pivot<.54)ink=theme==='grove'?13:theme==='vaporwave'?20:2;
   if(pivot<.24)ink=lit<0?24:theme==='grove'?17:6;
   if(flash>.10&&lit<-.32&&t>.16)ink=flash>.50?31:24;
  }
  p.dot(x,y,ink);
 }
}
/** Original indexed material sprite inside one exact source blade capsule. */
export function paintWorkingBlade(p:PixelCanvas,theme:RoomArtTheme,a:Point,b:Point,radius:number,flash=0){
 const v=prepare(p,theme,a,b,radius,flash);draw(p,theme,v);
 return{bounds:[Math.min(v.A[0],v.B[0])-radius,Math.min(v.A[1],v.B[1])-radius,Math.max(v.A[0],v.B[0])+radius,Math.max(v.A[1],v.B[1])+radius]as const,workingCapsuleExact:true};
}
/** All source poses/projections are preflighted before the first pixel. Flash
 * comes from this frame's actual flipper-contact event, never input intent. */
export function paintRoomWorkingBlades(p:PixelCanvas,theme:RoomArtTheme,arenaId:string,frame:ArenaFrame,project:RoomProjection,scale:number,reducedMotion=false,feedback?:PinballFeedbackSample){
 if(!themes.includes(theme)||p.palette.length<32||typeof arenaId!=='string'||!arenaId||!Number.isFinite(scale)||scale<=0||scale>4||typeof reducedMotion!=='boolean'||!Array.isArray(frame.flippers)||frame.flippers.length>256||!Array.isArray(frame.events)||frame.events.length>4096)throw Error('Working blade frame');
 const impacts=new Map<string,number>();
 if(feedback){
  if(!Number.isFinite(feedback.tick)||feedback.tick<frame.tick||feedback.tick>=frame.tick+1||!Array.isArray(feedback.bladeImpacts??[])||(feedback.bladeImpacts?.length??0)>256)throw Error('Working blade feedback');
  for(const v of feedback.bladeImpacts??[]){if(!v||typeof v.id!=='string'||!v.id||typeof v.arenaId!=='string'||!Number.isFinite(v.pulse)||v.pulse<0||v.pulse>1||impacts.has(v.id))throw Error('Working blade impact');if(v.arenaId===arenaId)impacts.set(v.id,v.pulse);}
 }
 const poses=frame.flippers.filter(f=>f.arenaId===arenaId).map(f=>{
  if(![f.pivotX,f.pivotY,f.tipX,f.tipY,f.elevation,f.radius].every(Number.isFinite))throw Error('Working blade native pose');
  const flash=reducedMotion?0:feedback?(impacts.get(f.id)??0):frame.events.some(e=>e.type==='flipper'&&e.colliderId===f.id)?1:0;
  return prepare(p,theme,project(f.pivotX,f.pivotY,f.elevation),project(f.tipX,f.tipY,f.elevation),f.radius*scale,flash);
 });
 if(poses.reduce((sum,v)=>sum+v.work,0)>1048576)throw Error('Working blades total raster budget');
 for(const v of poses)draw(p,theme,v);
 return{blades:poses.length,workingCapsulesExact:true};
}
