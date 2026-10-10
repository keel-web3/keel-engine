import{sceneRelief,sceneConduit,sceneFoliage,sceneRock}from'./environment.ts';
import{createRoll,deriveSeed,dhypot}from'@keel-engine/core';
import type{PixelCanvas}from'@keel-engine/pinball-pixel-art';
import type{PinballRoomEnvironmentTheme}from'./types.ts';
type Point={readonly x:number;readonly y:number;readonly elevation:number};
type Project=(x:number,y:number,z:number)=>readonly[number,number];
export interface PinballTrackEnvironmentRecipe{
 readonly worldSha256:string;readonly pathId:string;readonly detailSeed:string;
 readonly style:PinballRoomEnvironmentTheme;readonly vertices:readonly Point[];
}
export interface PinballTrackEnvironmentPlan{
 readonly worldSha256:string;readonly pathId:string;readonly style:PinballRoomEnvironmentTheme;
 readonly plane:'decorative-behind-native-playing-planes';
}
type Data={recipe:PinballTrackEnvironmentRecipe;stations:readonly Point[];key:string};
const plans=new WeakMap<PinballTrackEnvironmentPlan,Data>();
const cache=new Map<string,Uint8Array>();let cacheBytes=0;
const themes=['ion-relay','grove','vaporwave'];
function point(v:Point){return v&&['x','y','elevation'].every(k=>Object.hasOwn(v,k)&&Number.isFinite(v[k as keyof Point])&&Math.abs(v[k as keyof Point])<=1000000);}
/** Prepare scenery anchors from a caller's validated native orbit. This does
 * not manufacture a path, rail, platform or gameplay connection. */
export function preparePinballTrackEnvironment(r:PinballTrackEnvironmentRecipe):PinballTrackEnvironmentPlan{
 if(!r||!themes.includes(r.style)||!['worldSha256','pathId','detailSeed'].every(k=>typeof r[k as 'pathId']==='string'&&r[k as 'pathId'].length>0&&r[k as 'pathId'].length<=256)||!Array.isArray(r.vertices)||r.vertices.length<2||r.vertices.length>64||!r.vertices.every(point))throw Error('Track scenery recipe');
 const vertices=r.vertices.map(v=>Object.freeze({x:v.x,y:v.y,elevation:v.elevation})),stations:Point[]=[];
 let length=0;for(let i=1;i<vertices.length;i++){const a=vertices[i-1]!,b=vertices[i]!;length+=dhypot(b.x-a.x,b.y-a.y);}
 if(length<32||length>32768)throw Error('Track scenery extent');
 const pitch=Math.max(320,length/48);let next=0,walked=0;
 for(let i=1;i<vertices.length;i++){
  const a=vertices[i-1]!,b=vertices[i]!,d=dhypot(b.x-a.x,b.y-a.y);if(d===0)continue;
  while(next<=walked+d){const f=(next-walked)/d;stations.push(Object.freeze({x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,elevation:a.elevation+(b.elevation-a.elevation)*f}));next+=pitch;}
  walked+=d;
 }
 const recipe=Object.freeze({...r,vertices:Object.freeze(vertices)}),plan=Object.freeze({worldSha256:r.worldSha256,pathId:r.pathId,style:r.style,plane:'decorative-behind-native-playing-planes' as const});
 plans.set(plan,{recipe,stations:Object.freeze(stations),key:JSON.stringify(recipe)});return plan;
}
function projected(project:Project,v:Point){const q=project(v.x,v.y,v.elevation);if(!Array.isArray(q)||q.length!==2||![0,1].every(i=>Object.hasOwn(q,i)&&Number.isFinite(q[i])&&Math.abs(q[i])<=100000))throw Error('Track scenery projection');return q;}
/** A source-anchored pixel gallery behind active travel. Native decks, rails
 * and bodies must be painted afterwards. No body is included in this cache. */
export function paintPinballTrackEnvironment(p:PixelCanvas,plan:PinballTrackEnvironmentPlan,project:Project,o:{tick:number;reducedMotion:boolean;inkOffset:number}){
 const data=plans.get(plan);if(!data||!Number.isSafeInteger(o.tick)||o.tick<0||o.tick>432000||typeof o.reducedMotion!=='boolean'||!Number.isSafeInteger(o.inkOffset)||o.inkOffset<0||o.inkOffset+20>p.palette.length||p.W>1024||p.H>1024||p.offsetX!==0||p.offsetY!==0)throw Error('Track scenery budget');
 // Preflight every projected anchor before the first pixel is written.
 const anchors=data.stations.map(v=>projected(project,v)),r=data.recipe,first=r.vertices[0]!,a=projected(project,first),up=projected(project,{...first,y:first.y+600}),unit=dhypot(up[0]-a[0],up[1]-a[1])/600;
 if(unit<.015||unit>2)throw Error('Track scenery scale');
 const visible=anchors.map((v,i)=>({x:v[0],y:v[1],index:i})).filter(v=>v.x>=-100&&v.x<=p.W+100&&v.y>=-200&&v.y<=p.H+200),I=(v:number)=>o.inkOffset+v;
 const key=p.clip===null?JSON.stringify([data.key,p.W,p.H,o.inkOffset,anchors,unit]):null;
 const hit=key?cache.get(key):undefined;
 if(hit){p.pixels.set(hit);cache.delete(key!);cache.set(key!,hit);}else{
  p.rect(0,0,p.W,p.H,I(0));
  const roll=createRoll(deriveSeed(r.detailSeed,'track-gallery/'+r.style)),height=Math.max(120,Math.min(360,360*unit)),pitch=Math.max(48,Math.min(220,320*unit));
  // One continuous source-following enclosure, with unequal source/end
  // constructions. The active native deck always paints above this pass.
  for(let i=1;i<visible.length;i++){
   const A=visible[i-1]!,B=visible[i]!;if(B.index!==A.index+1)continue;
   const roofA=[A.x,A.y-height*.80]as const,roofB=[B.x,B.y-height*.80]as const;
   const wall=[A.x-pitch*.55,A.y-height,B.x+pitch*.55,B.y-height,B.x+pitch*.55,B.y+height*.37,A.x-pitch*.55,A.y+height*.37];p.poly(wall,I(1));
   if(r.style==='grove'){sceneConduit(p,[roofA,[(A.x+B.x)*.5,(A.y+B.y)*.5-height*.91],roofB],Math.min(24,18*unit+5),I,5);}
   else sceneConduit(p,[roofA,roofB],Math.min(24,14*unit+5),I,r.style==='ion-relay'?5:2);
  }
  for(const v of visible){
   const x=Math.round(v.x),y=Math.round(v.y),role=v.index===0?0:v.index===anchors.length-1?2:1,variation=roll.index(v.index,4),side=v.index%2?-1:1;
   // Only alternating distant anchors carry a large structure. Intervening
   // real path samples support the continuous wall, not duplicated pillars.
   if(role===1&&v.index%2===1)continue;
   if(r.style==='ion-relay'){
    const cx=x+side*pitch*.19,cy=y-height*.40,rx=pitch*(role===1?.32:.42),ry=height*.41;sceneRelief(p,cx,cy,rx,ry,I,5,variation%2);
    p.rect(cx-rx*.48,cy-ry*.61,rx*.92,ry*1.18,I(0));for(let k=0;k<7;k++){const yy=cy-ry*.50+k*ry*.15;p.rect(cx-rx*.39,yy,rx*.75,4,I(6));p.rect(cx-rx*.36,yy,rx*.60,1,I(8));if(k===variation)p.rect(cx-rx*.31,yy,rx*.37,1,I(18));}
    sceneConduit(p,[[cx+rx*.71,cy-ry*.8],[cx+rx*.86,cy+ry*.39],[cx+rx*.35,cy+ry*.74]],5,I,10);
   }else if(r.style==='grove'){
    const cx=x+side*pitch*.23,cy=y-height*.20;sceneRelief(p,cx,cy,pitch*.46,height*.67,I,1);
    sceneConduit(p,[[cx+side*pitch*.25,y+height*.28],[cx,y-height*.39],[cx-side*pitch*.21,y-height*.88]],Math.min(28,18*unit+6),I,5);
    sceneRock(p,cx,y+height*.14,pitch*.29,I);sceneRock(p,cx-side*pitch*.17,y-height*.52,pitch*.27,I);
    sceneFoliage(p,cx-side*pitch*.13,y-height*.77,pitch*.32,I,variation%3);sceneFoliage(p,cx+side*pitch*.25,y-height*.63,pitch*.23,I,(variation+1)%3);
   }else{
    const cx=x+side*pitch*.17,cy=y-height*.40;sceneRelief(p,cx,cy,pitch*.33,height*.43,I,5);sceneRelief(p,cx+side*pitch*.26,cy+height*.24,pitch*.19,height*.24,I,10);
    p.rect(cx-pitch*.16,cy-height*.29,pitch*.32,height*.56,I(0));p.rect(cx-pitch*.12,cy-height*.25,pitch*.24,height*.46,I(10));p.rect(cx-pitch*.10,cy-height*.24,pitch*.065,height*.31,I(12));p.rect(cx-pitch*.09,cy-height*.23,2,height*.15,I(14));
    sceneConduit(p,[[cx-pitch*.33,cy+height*.29],[cx-pitch*.39,cy-height*.2],[cx,cy-height*.48],[cx+pitch*.34,cy-height*.34]],7,I,5);
   }
  }
  if(key&&p.pixels.length<=2097152){while(cache.size&&(cacheBytes+p.pixels.length>2097152||cache.size>=8)){const oldest=cache.keys().next().value!;cacheBytes-=cache.get(oldest)!.length;cache.delete(oldest);}const bytes=p.pixels.slice();cache.set(key,bytes);cacheBytes+=bytes.length;}
 }
 // Tiny ambient lamps are separate from the static wall cache. Their native
 // clock cannot change the source path or suggest a moving gameplay body.
 const tick=o.reducedMotion?0:o.tick;
 for(const v of visible){const x=Math.round(v.x),y=Math.round(v.y-58*unit),lit=(Math.floor(tick/24)+v.index)%7===0;
  if(r.style==='grove'){p.rect(x-1,y,2,2,I(lit?18:12));if(lit)p.dot(x,y-1,I(19));}
  else{p.rect(x-6,y,12,3,I(r.style==='ion-relay'?16:17));p.rect(x-4,y,8,1,I(lit?19:18));}
 }
 return plan;
}
function band(p:PixelCanvas,x:number,y:number,w:number,h:number,I:(n:number)=>number,ramp:number){p.rect(x+2,y+3,w,h,I(0));p.rect(x,y,w,h,I(ramp));p.rect(x+2,y+1,w-4,2,I(ramp+3));p.rect(x+2,y+3,2,h-5,I(ramp+2));p.rect(x+w-4,y+3,2,h-5,I(ramp+1));}
function pressureVault(p:PixelCanvas,cx:number,top:number,w:number,h:number,I:(n:number)=>number,variant:number,role:number){
 const x=cx-w/2,y=top;
 p.rect(x,y,w,h,I(1));p.rect(x+8,y+10,w-16,h-27,I(0));
 if(role!==0){
  // Complementary plant anatomy: a heat-exchanger stack and an inspection
  // coil share the same enclosing span with the vessel in the remaining bay.
  band(p,x-5,y,11,h,I,1);band(p,x+w-6,y,11,h,I,1);band(p,x-5,y+h-17,w+10,12,I,2);
  if(role===1){const xx=x+17,yy=y+19,ww=w-34,hh=h-45;band(p,xx,yy,ww,hh,I,5);p.rect(xx+6,yy+7,ww-12,hh-16,I(0));
   for(let k=0;k<7;k++){const py=yy+12+k*(hh-22)/7;p.rect(xx+8,py,ww-16,4,I(5));p.rect(xx+10,py,ww-21,1,I(8));p.rect(xx+12+(k%2)*8,py+1,4,2,I(6));}
   for(const side of[0,1]){const px=xx+side*(ww-5);p.rect(px,yy+5,4,hh-10,I(6));p.rect(px,yy+5,1,hh-10,I(8));}
   p.rect(cx-12,y+h-32,24,7,I(1));p.rect(cx-10,y+h-31,4,1,I(16));
  }else{const xx=x+18,yy=y+21,ww=w-37,hh=h-49;p.rect(xx,yy,ww,hh,I(2));p.rect(xx+4,yy+4,ww-8,hh-8,I(0));
   for(let k=0;k<4;k++){const py=yy+12+k*(hh-18)/4;p.line(xx+12,py,xx+ww-12,py,I(6),5);p.line(xx+13,py-2,xx+ww-13,py-2,I(8));p.line(k%2?xx+12:xx+ww-12,py,k%2?xx+12:xx+ww-12,py+(hh-18)/4,I(5),5);}
   p.rect(xx+8,yy+7,2,hh*.31,I(3));p.rect(xx+12,yy+11,1,hh*.2,I(4));
   band(p,xx-2,yy+hh*.54,ww+4,6,I,2);p.rect(xx+ww-10,yy+8,4,hh-16,I(1));
  }
  return;
 }
 // A joined ribbed tank and service manifold; light catches broken clusters
 // on its curved skin instead of outlining a plain vector capsule.
 const tx=x+w*.18,tw=w*.52,ty=y+23,th=h-64;
 p.rect(tx+5,ty,tw-10,th,I(5));p.rect(tx,ty+9,tw,th-18,I(5));p.rect(tx+4,ty+9,tw*.24,th-18,I(6));p.rect(tx+6,ty+10,3,th-21,I(8));p.rect(tx+10,ty+13,2,th*.21,I(9));p.rect(tx+tw*.43,ty+12,tw*.24,th-21,I(7));p.rect(tx+tw*.55,ty+13,3,th*.38,I(8));
 for(let k=0;k<4;k++){const yy=ty+15+k*(th-25)/4;band(p,tx-3,yy,tw+6,7,I,5);p.rect(tx+tw*.34,yy+10,tw*.31,11,I(1));for(let j=0;j<3;j++)p.rect(tx+tw*.37+j*3,yy+12,1,5,I(j===variant?12:3));}
 const px=x+w*.77;p.rect(px,y+8,5,h-18,I(2));p.rect(px,y+8,2,h-18,I(4));
 for(let k=0;k<3;k++){const yy=y+35+k*(h-45)/3;p.line(px+2,yy,tx+tw,yy,I(6),4);p.line(px+1,yy-1,tx+tw,yy-1,I(8));p.rect(px-3,yy-3,11,8,I(5));p.dot(px-1,yy-2,I(9));}
 band(p,x-5,y,11,h,I,1);band(p,x+w-6,y,11,h,I,1);band(p,x-5,y+h-17,w+10,12,I,2);
 // A restrained warm gauge belongs to this machinery, well behind the rail.
 const gx=tx+tw*.5,gy=ty+th*.62;p.disk(gx+1,gy+1,8,I(0));p.disk(gx,gy,7,I(6));p.disk(gx-1,gy-1,5,I(8));p.disk(gx,gy,4,I(1));p.line(gx,gy,gx+(variant-1)*2,gy-3,I(18));p.dot(gx,gy,I(19));
 for(let k=0;k<7;k++){const yy=ty+9+k*(th-18)/7;p.rect(tx+tw*.43,yy,5+(k%3)*2,1,I(8));p.rect(tx+tw*.16,yy+5,2,3,I(7));}
}
function neonAtrium(p:PixelCanvas,cx:number,top:number,w:number,h:number,I:(n:number)=>number,variant:number){
 const x=cx-w/2,y=top;
 p.rect(x,y,w,h,I(1));band(p,x+4,y+10,w-8,h-26,I,2);p.rect(x+12,y+20,w-24,h-50,I(0));
 // Layered stained glass with a stepped fan, ceramic jambs and selected pink
 // highlights. Broad shadow areas stay dark enough for the active ball.
 const mx=cx,gy=y+h*.46,gw=w*.31;
 for(let k=0;k<4;k++){const yy=gy-k*11,ww=gw-k*5;p.rect(mx-ww,yy,ww*2,6,I(k%2?3:2));p.rect(mx-ww+2,yy,ww*2-4,1,I(4));}
 p.line(x+14,y+22,cx,y+h*.22,I(3),3);p.line(x+w-14,y+22,cx,y+h*.22,I(3),3);
 p.rect(cx-2,y+30,4,h-78,I(2));p.rect(cx-1,y+31,1,h-80,I(4));
 for(const side of[-1,1]){const px=cx+side*w*.38;band(p,px-4,y+4,9,h-8,I,5);p.rect(px-2,y+17,2,h-36,I(8));p.rect(px-1,y+18,1,h*.24,I(9));p.rect(px-3,y+h*.7,6,18,I(16));p.rect(px-2,y+h*.7+1,1,15,I(18));}
 band(p,x-3,y+h-19,w+6,12,I,5);p.rect(x+8,y+h-18,w-16,1,I(17));p.rect(x+12,y+h-18,w*.25,1,I(18));
 const yy=y+h*.65;p.rect(cx-15,yy,30,19,I(1));p.line(cx-14,yy+17,cx+14,yy+17,I(3));for(let k=0;k<3;k++)p.rect(cx-10+k*9,yy+3,4,8,I(k===variant?12:3));
 // Broken reflected colours sit inside the glass, with a deliberate dark
 // centre. The working route above this pass keeps its stronger highlights.
 for(let k=0;k<5;k++){const xx=x+19+k*(w-40)/5,gy=y+26+k*7;p.rect(xx,gy,7,h*.28,I(k%2?3:2));p.rect(xx+1,gy+3,2,h*.11,I(k%2?4:6));}
 const plantX=x+w*.2,plantY=y+h-23;p.line(plantX,plantY,plantX+5,plantY-42,I(10),2);for(let k=0;k<4;k++)for(const side of[-1,1]){const yy=plantY-10-k*8;p.line(plantX+3,yy,plantX+3+side*(12-k*2),yy-9,I(11),3);p.line(plantX+3,yy-1,plantX+3+side*(11-k*2),yy-10,I(12));}p.rect(plantX-7,plantY-1,18,9,I(5));p.rect(plantX-5,plantY,3,6,I(8));
}
const leaves=['000001110000','000123321000','001234432100','012344332210','123443222221','123332233321','012221233210','001122222100','000011110000']as const;
function foliage(p:PixelCanvas,x:number,y:number,s:number,I:(n:number)=>number,mirror:boolean){for(let j=0;j<leaves.length;j++)for(let i=0;i<12;i++){const v=Number(leaves[j]![mirror?11-i:i]);if(v)p.rect(x+i*s,y+j*s,s,s,I(9+v));}}
function gardenVault(p:PixelCanvas,cx:number,top:number,w:number,h:number,I:(n:number)=>number,variant:number){
 const x=cx-w/2,y=top;
 p.rect(x,y,w,h,I(0));
 // The cave opening has one irregular perimeter and sparse wet strata. No
 // stacked polygon boulders or timber panel grid fills the background.
 for(let k=0;k<5;k++){const yy=y+k*h/5,ww=14+(k%3)*5;
  for(let row=0;row<h/5+2;row++){const bite=row<5?5-row:row>h/5-5?row-(h/5-5):0;p.rect(x,yy+row,ww-bite,1,I(2));p.rect(x+w-ww+bite,yy+row+7,ww-bite,1,I(2));}
  p.line(x+2,yy+7,x+ww-4,yy+3,I(3),2);p.line(x+w-ww+3,yy+13,x+w-3,yy+17,I(3),2);
 }
 for(let k=0;k<6;k++){const xx=x+k*w/6,drop=14+(k%3)*11;p.rect(xx,y,w/6+1,drop,I(2));p.line(xx+3,y+5,xx+w/6-3,y+9,I(3));}
 const root=cx+w*.19;p.line(root,y+3,root-7,y+h*.31,I(5),8);p.line(root-2,y+4,root-9,y+h*.3,I(7),3);p.line(root-8,y+h*.28,root-23,y+h*.49,I(5),4);p.line(root-9,y+h*.28,root-22,y+h*.47,I(6));
 for(let k=0;k<3;k++){const xx=x+9+k*(w-29)/3,ss=Math.max(.65,Math.min(1.4,w/85));foliage(p,xx,y+9+(k%2)*8,ss,I,k%2===0);if(k===variant)foliage(p,xx+3,y+h*.68,ss*.8,I,true);}
 const fall=x+w*.67;p.rect(fall,y+h*.36,6,h*.47,I(15));p.rect(fall+1,y+h*.36,2,h*.47,I(16));p.rect(fall+2,y+h*.41,1,h*.18,I(17));
 p.rect(x+4,y+h-18,w-8,18,I(2));p.rect(x+8,y+h-17,w-16,3,I(3));foliage(p,x+13,y+h-22,.85,I,false);
 for(let k=0;k<6;k++){const xx=x+4+k*(w-16)/6,ss=Math.max(.85,Math.min(1.8,w/72));foliage(p,xx,y+8+(k%3)*10,ss,I,k%2===0);}
 const archY=y+h*.42;for(let k=0;k<3;k++){const xx=x+8+k*w*.32;p.line(xx,archY+(k%2)*13,xx+w*.3,archY-7,I(1),7);p.line(xx+2,archY-2+(k%2)*13,xx+w*.28,archY-9,I(2),2);}
}
