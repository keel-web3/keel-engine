import { PixelCanvas } from '@keel-engine/pinball-pixel-art';
import { dhypot, dsin, dcos } from '@keel-engine/core';
import type { ArenaWorldDefinition,ArenaField,ArenaFrame } from '@keel-engine/pinball-arena';
import type { RoomArtTheme,RoomProjection } from './index.ts';
type Point={x:number;y:number;elevation:number};
export type NativeTrackShellMaterial={kind:'tube'|'wireform';theme:RoomArtTheme;collarSpacing?:number};
export type NativeTrackShellPlan=Readonly<{worldSha256:string;arenaId:string;pathId:string;kind:'tube'|'wireform';theme:RoomArtTheme;scope:'cosmetic-shell-on-native-support'}>;
type Data={vertices:Point[];surfaces:{polygon:Point[]}[];half:number;length:number;spacing:number};
const plans=new WeakMap<NativeTrackShellPlan,Data>();
function finite(n:unknown){return typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e6;}
function dense<T>(a:readonly T[],max:number){if(!Array.isArray(a)||!a.length||a.length>max)throw Error('Track shell array');for(let i=0;i<a.length;i++)if(!Object.hasOwn(a,i))throw Error('Track shell sparse array');}
/** Material is explicit. A tube skin adds no native ceiling collision or route. */
export function prepareNativeTrackShell(world:ArenaWorldDefinition,field:ArenaField,pathId:string,material:NativeTrackShellMaterial):NativeTrackShellPlan{
 if(!world.arenas.includes(field)||!material||!['tube','wireform'].includes(material.kind)||!['ion-relay','grove','vaporwave'].includes(material.theme))throw Error('Track shell native member/material');
 const path=field.pinball?.paths.find(p=>p.id===pathId);if(!path||!finite(path.clearWidth)||path.clearWidth<8||path.clearWidth>256)throw Error('Track shell native path');dense(path.vertices,128);dense(path.surfaceIds,256);
 if(path.vertices.length<2)throw Error('Track shell length');const vertices=path.vertices.map(v=>{if(!v||![v.x,v.y,v.elevation].every(finite))throw Error('Track shell vertex');return{x:v.x,y:v.y,elevation:v.elevation};});
 let length=0;for(let i=1;i<vertices.length;i++){const a=vertices[i-1]!,b=vertices[i]!,d=dhypot(b.x-a.x,b.y-a.y);if(d<=0||d>32768)throw Error('Track shell segment');length+=d;}if(length>65536)throw Error('Track shell length');
 const surfaces=path.surfaceIds.map(id=>{const s=field.surfaces.find(v=>v.id===id);if(!s)throw Error('Track shell support member');dense(s.polygon,32);if(s.polygon.length<3)throw Error('Track shell polygon');return{polygon:s.polygon.map((v,i)=>{const elevation=s.vertexElevations?.[i]??s.height;if(!v||![v.x,v.y,elevation].every(finite))throw Error('Track shell support coordinate');return{x:v.x,y:v.y,elevation};})};});
 const supportHalf=Math.max(path.clearWidth/2,...surfaces.flatMap(s=>s.polygon.map(q=>{let nearest=Infinity;for(let i=1;i<vertices.length;i++){const a=vertices[i-1]!,b=vertices[i]!,dx=b.x-a.x,dy=b.y-a.y,d2=dx*dx+dy*dy,t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/d2));nearest=Math.min(nearest,dhypot(q.x-a.x-dx*t,q.y-a.y-dy*t));}return nearest;})));if(!Number.isFinite(supportHalf)||supportHalf>512)throw Error('Track shell support width');
 const spacing=material.collarSpacing??160;if(!Number.isFinite(spacing)||spacing<64||spacing>1024)throw Error('Track shell collar budget');
 const plan=Object.freeze({worldSha256:world.sha256,arenaId:field.id,pathId,kind:material.kind,theme:material.theme,scope:'cosmetic-shell-on-native-support' as const});plans.set(plan,{vertices,surfaces,half:supportHalf,length,spacing});return plan;
}
function point(project:RoomProjection,v:Point){const q=project(v.x,v.y,v.elevation);if(!Array.isArray(q)||q.length!==2||![0,1].every(i=>Object.hasOwn(q,i)&&finite(q[i])))throw Error('Track shell projection');return[q[0],q[1]]as const;}
function inside(poly:readonly(readonly[number,number])[],x:number,y:number){let odd=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i]!,b=poly[j]!;if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])odd=!odd;}return odd;}
/** Rounded indexed shell clipped to actual support polygons. Draw after the
 * native floor/deck and before current balls. Active-body cutaway reveals the
 * interior; captured/inactive balls cannot manufacture a travelling pose. */
export function paintNativeTrackShell(p:PixelCanvas,plan:NativeTrackShellPlan,project:RoomProjection,o:{frame?:ArenaFrame;ownerId?:number;reducedMotion?:boolean}={}){
 const data=plans.get(plan);if(!data||p.palette.length<32||p.W>1024||p.H>1024||p.offsetX!==0||p.offsetY!==0||o.ownerId!==undefined&&(!Number.isSafeInteger(o.ownerId)||o.ownerId<0)||o.reducedMotion!==undefined&&typeof o.reducedMotion!=='boolean')throw Error('Track shell canvas/options');
 const polygons=data.surfaces.map(s=>s.polygon.map(v=>point(project,v)));let walked=0;
 const segments=data.vertices.slice(1).map((b,i)=>{const a=data.vertices[i]!,d=dhypot(b.x-a.x,b.y-a.y),A=point(project,a),B=point(project,b),nx=-(b.y-a.y)/d,ny=(b.x-a.x)/d,E=point(project,{x:a.x+nx*data.half,y:a.y+ny*data.half,elevation:a.elevation}),half=dhypot(E[0]-A[0],E[1]-A[1]),screen=dhypot(B[0]-A[0],B[1]-A[1]);if(!finite(half)||half<.01||half>512)throw Error('Track shell projected width');const result={a,b,A,B,d,start:walked,half,screen};walked+=d;return result;});
 const boxes=polygons.map(poly=>({x0:Math.max(0,Math.floor(Math.min(...poly.map(v=>v[0])))),x1:Math.min(p.W-1,Math.ceil(Math.max(...poly.map(v=>v[0])))),y0:Math.max(0,Math.floor(Math.min(...poly.map(v=>v[1])))),y1:Math.min(p.H-1,Math.ceil(Math.max(...poly.map(v=>v[1]))))}));
 const work=boxes.reduce((n,b)=>n+Math.max(0,b.x1-b.x0+1)*Math.max(0,b.y1-b.y0+1),0);if(work>1048576||work*segments.length>8388608)throw Error('Track shell raster budget');
 // Endpoint section is an explicit cosmetic half-round canopy, anchored to
 // the actual support edges. Its elevation is presentation only, not a roof
 // collider. Unlike strip banding, the projected rim exposes real section depth.
 const mouths=plan.kind==='tube'?[0,segments.length-1].map((i,end)=>{
  const s=segments[i]!,v=end?s.b:s.a,nx=-(s.b.y-s.a.y)/s.d,ny=(s.b.x-s.a.x)/s.d;
  const rim=Array.from({length:33},(_,j)=>{const angle=j*Math.PI/32;return point(project,{x:v.x+nx*data.half*dcos(angle),y:v.y+ny*data.half*dcos(angle),elevation:v.elevation+data.half*dsin(angle)});});
  const floorA=point(project,{x:v.x-nx*data.half,y:v.y-ny*data.half,elevation:v.elevation}),floorB=point(project,{x:v.x+nx*data.half,y:v.y+ny*data.half,elevation:v.elevation});
  const all=[...rim,floorA,floorB];if(Math.max(...all.map(q=>q[0]))-Math.min(...all.map(q=>q[0]))>1024||Math.max(...all.map(q=>q[1]))-Math.min(...all.map(q=>q[1]))>1024)throw Error('Track shell mouth budget');
  return{rim,floorA,floorB};
 }):[];
 const cuts:{along:number;length:number;side:number}[]=[];
 if(o.frame){dense(o.frame.balls,128);for(const b of o.frame.balls){if(!b||!finite(b.x)||!finite(b.y)||!finite(b.elevation)||!finite(b.radius)||b.radius<=0)throw Error('Track shell native body');if(!b.active||b.eliminated||b.transport!==null||b.arenaId!==plan.arenaId||o.ownerId!==undefined&&b.ownerId!==o.ownerId)continue;
  for(const s of segments){const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y,t=Math.max(0,Math.min(1,((b.x-s.a.x)*dx+(b.y-s.a.y)*dy)/(s.d*s.d))),z=s.a.elevation+(s.b.elevation-s.a.elevation)*t;if(dhypot(b.x-s.a.x-dx*t,b.y-s.a.y-dy*t)<=data.half+b.radius&&Math.abs(b.elevation-z)<=b.radius+2){const q=point(project,{x:b.x,y:b.y,elevation:b.elevation}),sx=s.B[0]-s.A[0],sy=s.B[1]-s.A[1];cuts.push({along:s.start+t*s.d,length:Math.max(b.radius*3,data.half*1.8),side:s.screen>.01?((q[0]-s.A[0])*-sy+(q[1]-s.A[1])*sx)/(s.screen*s.half):0});break;}
  }
 }}
 // Stage all indexed changes. Late primitive failures cannot half-paint caller.
 const stage=new PixelCanvas(p.W,p.H,p.palette);stage.pixels.fill(255);stage.clip=p.clip;let pixels=0,cutawayPixels=0;
 const steel=plan.theme==='grove'?[13,14,15,16,17]:plan.theme==='vaporwave'?[20,21,22,23,24]:[1,2,4,5,6];
 for(let k=0;k<polygons.length;k++){const poly=polygons[k]!,box=boxes[k]!;for(let y=box.y0;y<=box.y1;y++)for(let x=box.x0;x<=box.x1;x++){if(!inside(poly,x+.5,y+.5))continue;let best=Infinity,side=0,along=0,half=1;
  for(const s of segments){if(s.screen<.01)continue;const dx=s.B[0]-s.A[0],dy=s.B[1]-s.A[1],raw=((x-s.A[0])*dx+(y-s.A[1])*dy)/(s.screen*s.screen),t=Math.max(0,Math.min(1,raw)),dist=(x-s.A[0]-dx*t)**2+(y-s.A[1]-dy*t)**2;if(dist<best){best=dist;side=((x-s.A[0])*-dy+(y-s.A[1])*dx)/s.screen;half=s.half;along=s.start+t*s.d;}}
  if(!Number.isFinite(best))continue;const row=side/half,abs=Math.abs(row),collar=((along%data.spacing)+data.spacing)%data.spacing,cap=along<4||along>data.length-4;let ink:number;
  if(plan.kind==='wireform'){ink=abs>.83?steel[3]!:abs>.66?steel[1]!:1;if(collar<6)ink=steel[2]!;if(abs>.92)ink=steel[0]!;}
  else{ink=row<-.78?steel[1]!:row<-.43?steel[3]!:row<-.20?steel[4]!:row<.19?steel[3]!:row<.61?steel[2]!:row<.88?steel[1]!:steel[0]!;
   // Sparse reflected windows vary along the source span; the bright ridge
   // narrows and drifts, so the shell reads as curved metal/ceramic rather than
   // equal-width painted planks. No extra route or collision edge is created.
   const phase=(along+plan.worldSha256.charCodeAt(0)*7)%192,glint=(phase>34&&phase<110),ridge=-.30+(phase-72)/960;
   if(glint&&Math.abs(row-ridge)<.055)ink=steel[4]!;
   if(row>.30&&row<.68&&phase>126&&phase<163)ink=steel[1]!;
   if(collar<3||cap)ink=abs>.78?steel[4]!:abs>.42?steel[2]!:steel[1]!;
   // Native-tangent aperture: long feathered shoulders instead of a punched
   // screen-space circle. The current active body's window is presentation only.
   for(const c of cuts){const u=Math.abs(along-c.along)/c.length;if(u>=1)continue;const taper=(1-u*u),width=.84*taper,relative=Math.abs(row-c.side);if(relative<width){
    const edge=width-relative;ink=edge<.10?steel[row<c.side?1:2]!:steel[0]!;cutawayPixels++;break;
   }}
  }
  stage.dot(x,y,ink);pixels++;
 }}
 // Dark opening plus stepped rim at source endpoints. The body is painted
 // later by the host; an inactive/captured body is never synthesised here.
 for(const mouth of mouths){
  const polygon=[...mouth.rim,mouth.floorA,mouth.floorB],x0=Math.max(0,Math.floor(Math.min(...polygon.map(q=>q[0])))),x1=Math.min(p.W-1,Math.ceil(Math.max(...polygon.map(q=>q[0])))),y0=Math.max(0,Math.floor(Math.min(...polygon.map(q=>q[1])))),y1=Math.min(p.H-1,Math.ceil(Math.max(...polygon.map(q=>q[1]))));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(inside(polygon,x+.5,y+.5))stage.dot(x,y,1);
  for(let i=1;i<mouth.rim.length;i++){const a=mouth.rim[i-1]!,b=mouth.rim[i]!;stage.line(a[0],a[1],b[0],b[1],steel[1]!,3);stage.line(a[0],a[1],b[0],b[1],i<17?steel[4]!:steel[2]!,1);}
 }
 for(let i=0;i<stage.pixels.length;i++)if(stage.pixels[i]!==255)p.pixels[i]=stage.pixels[i]!;
 return{pathId:plan.pathId,kind:plan.kind,pixels,cutawayPixels,activeBodyCutaways:cuts.length,nativeSupportUnchanged:true,ceilingCollisionAdded:false,cosmeticEndpointSections:mouths.length};
}
