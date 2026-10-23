import { PixelCanvas } from '@keel-engine/pinball-pixel-art';
import { dhypot } from '@keel-engine/core';
import type { RoomArtPlan, RoomProjection } from './index.ts';

/** Original masks are small hand-authored pixel clusters, stamped at source
 * machinery sockets. The whole illustrated assembly is below clear glass. */
export const HERO_CLUSTER_STAMPS=Object.freeze({
 vent:Object.freeze(['..111111111111..','.12344444444321.','1234566666654321','1234511111154321','1234578888754321','1234599998754321','1234511111154321','1234578888754321','1234599998754321','1234511111154321','1234566666654321','.12344444444321.','..111111111111..']),
 knot:Object.freeze(['....11111....','..112333211..','.12345554321.','1234566654321','1234561165431','1234564165431','1234561165431','1234556654321','.1234444321..','..11233321...','....11111....']),
 glass:Object.freeze(['.....111111.....','...1123333211...','..123455554321..','.12345666544321.','1234566655444321','1234566544444321','1234555444333321','1234444333322321','.12333333222221.','..122222222221..','...1111111111...'])
});
type Pt=readonly[number,number];
type PodKind='metal'|'rock'|'glaze';
type PodMask={width:number;pixels:Uint8Array;runs:Int32Array;bytes:number};
const podMasks=new Map<string,PodMask>();
let podMaskBytes=0;
const POD_MASK_BYTES=4194304,POD_MASK_ENTRIES=64,POD_MASK_PIXELS=262144;
const podDot=PixelCanvas.prototype.dot,podRect=PixelCanvas.prototype.rect;
// Only index storage is used. Do not re-admit or copy caller RGB values while
// building a private mask; the existing hero palette contract stays intact.
const podMaskPalette=Object.freeze(Array.from({length:32},()=>Object.freeze([0,0,0]as const)));
function stamp(p:PixelCanvas,mask:readonly string[],x:number,y:number,inks:readonly number[],s=1){const z=Math.max(1,Math.min(3,Math.round(s))),l=Math.round(x-mask[0]!.length*z/2),t=Math.round(y-mask.length*z/2);for(let j=0;j<mask.length;j++)for(let i=0;i<mask[j]!.length;i++){const c=mask[j]![i]!;if(c!=='.')p.rect(l+i*z,t+j*z,z,z,inks[Number(c)]!);}}
/** Pixel-space stamped relief. Quantized elliptical contours deliberately form
 * long stepped clusters, not smooth downsampled geometry. All shade selection
 * is indexed and bounded; no per-frame noise or external image is involved. */
function pod(p:PixelCanvas,c:Pt,rx:number,ry:number,kind:PodKind,ramp:readonly number[],variant=0){
 const X=Math.round(c[0]),Y=Math.round(c[1]),W=Math.max(5,Math.round(rx)),H=Math.max(5,Math.round(ry));
 const width=W*2+3,height=H*2+5;
 // Fractional offsets can extend rect coverage independently of dot rounding.
 // Keep that original path, as well as callers overriding public primitives.
 // All cached inks are below the transparent sentinel and admitted BEFORE a hit.
 // New mask canvases inherit the current prototype, even when the caller has
 // retained original own methods after a prototype override.
 const cacheable=p.constructor===PixelCanvas&&p.dot===podDot&&p.rect===podRect&&
  PixelCanvas.prototype.dot===podDot&&PixelCanvas.prototype.rect===podRect&&
  Number.isInteger(p.offsetX)&&Number.isInteger(p.offsetY)&&Math.abs(p.offsetX)<=1e6&&Math.abs(p.offsetY)<=1e6&&
  Number.isFinite(X)&&Number.isFinite(Y)&&Number.isFinite(W)&&Number.isFinite(H)&&
  X-W>=-1e6&&X+W+2<=1e6&&Y-H>=-1e6&&Y+H+4<=1e6&&
  width<=2048&&height<=2048&&width*height<=POD_MASK_PIXELS&&p.palette.length>=32&&
  Number.isSafeInteger(variant)&&Array.isArray(ramp)&&ramp.length>=6&&
  [0,1,2,3,4,5].every(i=>Object.hasOwn(ramp,i)&&Number.isInteger(ramp[i])&&ramp[i]!>=0&&ramp[i]!<32);
 if(cacheable){
  const key=JSON.stringify([W,H,kind,variant,ramp.slice(0,6)]);let mask=podMasks.get(key);
  if(!mask){
   const canvas=new PixelCanvas(width,height,podMaskPalette);canvas.pixels.fill(255);
   paintPodBody(canvas,W,H,W,H,kind,ramp,variant);
   const spans:number[]=[];
   for(let y=0;y<height;y++){let x=0;while(x<width){while(x<width&&canvas.pixels[y*width+x]===255)x++;const start=x;while(x<width&&canvas.pixels[y*width+x]!==255)x++;if(x>start)spans.push(y,start,x);}}
   const runs=Int32Array.from(spans);mask={width,pixels:canvas.pixels,runs,bytes:canvas.pixels.byteLength+runs.byteLength};
   while(podMasks.size&&(podMasks.size>=POD_MASK_ENTRIES||podMaskBytes+mask.bytes>POD_MASK_BYTES)){const oldest=podMasks.keys().next().value!;podMaskBytes-=podMasks.get(oldest)!.bytes;podMasks.delete(oldest);}
   podMasks.set(key,mask);podMaskBytes+=mask.bytes;
  }else{podMasks.delete(key);podMasks.set(key,mask);}
  const clip=p.clip,l=Math.max(0,clip?Math.ceil(clip[0]):0),r=Math.min(p.W,clip?Math.floor(clip[2])+1:p.W),
   t=Math.max(0,clip?Math.ceil(clip[1]):0),b=Math.min(p.H,clip?Math.floor(clip[3])+1:p.H),ox=X-W+p.offsetX,oy=Y-H+p.offsetY;
  for(let i=0;i<mask.runs.length;i+=3){const row=mask.runs[i]!,y=oy+row;if(y<t||y>=b)continue;
   const start=Math.max(mask.runs[i+1]!,l-ox),end=Math.min(mask.runs[i+2]!,r-ox);
   if(start<end)p.pixels.set(mask.pixels.subarray(row*mask.width+start,row*mask.width+end),y*p.W+ox+start);
  }
 }else paintPodBody(p,X,Y,W,H,kind,ramp,variant);
 // Keep the absolute rect arithmetic: fractional highlight edges can round
 // differently after translating a mask at very large caller coordinates.
 p.rect(X-W*.48,Y-H*.62,Math.max(3,W*.31),2,ramp[5]!);
 p.rect(X-W*.54,Y-H*.50,3,3,ramp[4]!);
}
function paintPodBody(p:PixelCanvas,X:number,Y:number,W:number,H:number,kind:PodKind,ramp:readonly number[],variant:number){
 const edge=(y:number)=>{let e=W;while(e>0&&e*e*H*H+y*y*W*W>W*W*H*H)e--;const notch=kind==='rock'&&((Math.floor((y+H)/5)+variant)%5===1)?Math.max(2,Math.floor(W*.10)):0;return Math.max(0,Math.floor((e-notch)/2)*2);};
 // Displaced dark underside, contained by the assembly's source bed clip.
 for(let yy=-H;yy<=H;yy++){const e=edge(yy);if(e)p.rect(X-e+2,Y+yy+4,e*2+1,1,1);}
 for(let yy=-H;yy<=H;yy++){const e=edge(yy);for(let xx=-e;xx<=e;xx++){
  const fromEdge=e-Math.abs(xx),v=(yy+H)/(H*2),u=xx/W;let shade=3;
  if(fromEdge<2||Math.abs(yy)>H-2)shade=0;
  else if(fromEdge<4)shade=xx<0&&yy<3?5:1;
  else if(v<.16)shade=kind==='glaze'?4:5;else if(v<.30)shade=4;else if(v>.80)shade=1;else if(v>.65)shade=2;
  if(kind==='metal'){
   // Unequal segmented cast ribs and inset winding windows.
   const band=Math.floor((xx+W)/(variant?11:14));
   if(Math.abs(yy)<H*.55&&((xx+W)%(variant?11:14)<2))shade=1;
   if(v>.24&&v<.68&&band%3===1&&fromEdge>7)shade=2;
   if(yy<0&&xx<0&&fromEdge>5&&((xx+W)%14===4))shade=5;
  }else if(kind==='rock'){
   const seam=yy-Math.floor(xx*.24/3)*3;
   if(Math.abs(seam-H*.18)<2&&fromEdge>5)shade=1;
   if(((Math.floor((xx+W)/7)+Math.floor((yy+H)/5)+variant)%7===0)&&fromEdge>5)shade=Math.max(1,shade-1);
   if(xx<-W*.25&&yy<-H*.15&&fromEdge>4)shade=Math.min(5,shade+1);if(v>.23&&v<.31&&u>-.5&&u<.3)shade=1;
  }else{
   if(u<-.37&&u>-.50&&v<.49&&v>.19)shade=5;
   if(u>-.35&&u<-.17&&v<.50&&v>.14)shade=4;
   if(v>.48&&v<.58&&u>-.1)shade=2;
  }
  let ink=ramp[shade]!;if(kind==='rock'&&yy<-H*.25&&xx>W*.10&&xx<W*.60&&fromEdge>4){const moss=(Math.floor(xx/3)+Math.floor(yy/2)+variant)%5;if(moss>=0&&moss<2)ink=10;}if(kind==='metal'&&Math.abs(xx)<W*.50&&Math.abs(yy)<H*.46&&W>19){const rib=(yy+H)%6;ink=rib<2?1:rib===2?14:rib===3?17:16;if(xx<-W*.28&&rib===3)ink=18;}p.dot(X+xx,Y+yy,ink);
 }}
}
function tube(p:PixelCanvas,a:Pt,b:Pt,width:number,ramp:readonly number[],rib=false){const d=dhypot(b[0]-a[0],b[1]-a[1])||1,nx=-(b[1]-a[1])/d,ny=(b[0]-a[0])/d;p.line(a[0]+2,a[1]+3,b[0]+2,b[1]+3,1,width+4);p.line(...a,...b,ramp[1]!,width);p.line(a[0]-1,a[1]-2,b[0]-1,b[1]-2,ramp[3]!,Math.max(2,width*.70));p.line(a[0]-2,a[1]-3,b[0]-2,b[1]-3,ramp[5]!,Math.max(1,width*.16));if(rib)for(let k=5;k<d-3;k+=7){const x=a[0]+(b[0]-a[0])*k/d,y=a[1]+(b[1]-a[1])*k/d;p.line(x-nx*width*.35,y-ny*width*.35,x+nx*width*.35,y+ny*width*.35,ramp[1]!,2);p.dot(x-nx*width*.32-1,y-ny*width*.32-1,ramp[4]!);}}
function root(p:PixelCanvas,a:Pt,b:Pt,width:number){
 const dx=b[0]-a[0],dy=b[1]-a[1],d=dhypot(dx,dy)||1,nx=-dy/d,ny=dx/d;
 const mid:Pt=[a[0]+dx*.48+nx*width*.43,a[1]+dy*.48+ny*width*.43];
 tube(p,a,mid,width,[1,13,14,15,16,17]);tube(p,mid,b,width*.64,[1,13,14,15,16,17]);
 for(let k=0;k<3;k++){const f=.19+k*.22,x=a[0]+dx*f+nx*width*.16,y=a[1]+dy*f+ny*width*.16;p.line(x-nx*width*.13,y-ny*width*.13,x+dx*.12,y+dy*.12,14,2);}
 stamp(p,HERO_CLUSTER_STAMPS.knot,mid[0],mid[1],[1,13,14,15,16,17,18],1);
}
function socket(p:PixelCanvas,c:Pt,w:number,kind:'metal'|'rock'|'glaze',ramp:readonly number[],light:readonly number[]){pod(p,c,w,w*.76,kind,ramp);stamp(p,kind==='rock'?HERO_CLUSTER_STAMPS.knot:kind==='glaze'?HERO_CLUSTER_STAMPS.glass:HERO_CLUSTER_STAMPS.vent,c[0],c[1],light,Math.max(1,w/14));}

/** A genuinely different native contact graph: two or more unequal source
 * spring disks coupled through real target faces. No hypothetical goal/NPC. */
function pressureCourt(p:PixelCanvas,r:RoomArtPlan,project:RoomProjection,a:Pt,b:Pt,bank:Pt){
 const w=b[0]-a[0],scale=w/(r.bounds[2]-r.bounds[0]),grove=r.theme==='grove',vapor=r.theme==='vaporwave';
 const steel=[1,2,3,4,5,6],copper=[1,13,14,16,17,18],rootRamp=[1,13,14,15,16,17],opal=[13,14,15,16,17,18];
 const sources=r.springs.filter(v=>r.workingTopology.primarySpringIds.includes(v.id)).sort((a,b)=>a.x-b.x).map(v=>({source:v,c:project(v.x,v.y,r.bed.height),radius:v.radius*scale}));
 const contacts=r.targets.map(t=>{const A=project(t.ax,t.ay,r.bed.height),B=project(t.bx,t.by,r.bed.height);return{A,B,c:[(A[0]+B[0])/2,(A[1]+B[1])/2]as Pt};});
 const central:Pt=contacts.length?contacts[0]!.c:[(sources[0]!.c[0]+sources.at(-1)!.c[0])/2,Math.min(...sources.map(v=>v.c[1]))-w*.04];
 // The coupling is flush under-glass artwork; native balls may pass over it.
 // Each lobe has its own source-sized central opening and asymmetric relief.
 for(const [i,q]of sources.entries()){
  const side=i%2===0?-1:1,rx=Math.max(q.radius*1.85,w*.12),ry=Math.max(q.radius*2.3,w*.17),back:Pt=[q.c[0]+side*q.radius*.23,q.c[1]-q.radius*.8];
  if(!grove&&!vapor){
   const rear:Pt=[back[0]+side*rx*.12,Math.max(a[1]+ry*.44,back[1]-ry*.66)];
   pod(p,rear,rx*.85,ry*.70,'metal',steel,i+1);tube(p,rear,back,rx*.67,steel,true);
   tube(p,[q.c[0]-side*rx*.15,back[1]-ry*.1],central,w*.048,steel,true);
   pod(p,back,rx,ry,'metal',steel,i);pod(p,[back[0]+side*rx*.65,back[1]+ry*.16],rx*.50,ry*.55,'metal',steel,1);
   stamp(p,HERO_CLUSTER_STAMPS.vent,back[0],back[1]-ry*.28,[1,1,2,3,4,5,6,14,17,18],Math.max(1,w/150));
   for(const edge of[-1,1]){const x=q.c[0]+edge*q.radius*1.15;tube(p,[x,q.c[1]-q.radius*.8],[x,q.c[1]+q.radius*.66],Math.max(4,w*.022),copper,true);}
   p.rect(back[0]-rx*.55,back[1]-ry*.57,rx*.35,4,1);p.rect(back[0]-rx*.51,back[1]-ry*.56,rx*.24,2,22);
  }else if(grove){
   // A forked mineral cavity. The bigger native spring owns the broader root
   // bulb; contacts are seed/mineral working faces, not decorative fruit NPCs.
   root(p,[a[0]+(i?1:.02)*(b[0]-a[0]),a[1]+ry*.28],[back[0]+side*rx*.65,back[1]+ry*.15],w*.055);
   pod(p,[back[0]-side*rx*.22,Math.max(a[1]+ry*.44,back[1]-ry*.64)],rx*.97,ry*.67,'rock',[1,2,3,4,5,6],i+5);
   pod(p,[back[0],back[1]+ry*.08],rx*1.16,ry,'rock',[1,2,3,4,5,6],i+1);
   pod(p,[back[0]+side*rx*.66,back[1]+ry*.40],rx*.58,ry*.48,'rock',[1,2,3,4,5,6],i+3);
   root(p,[q.c[0]+side*rx*.8,back[1]-ry*.75],[q.c[0]+side*q.radius*1.05,q.c[1]+q.radius*.30],w*.042);
   root(p,[q.c[0]+side*q.radius*1.05,q.c[1]+q.radius*.30],[q.c[0]-side*q.radius*.40,q.c[1]+q.radius*1.13],w*.033);
   root(p,[back[0]-side*rx*.5,back[1]],central,w*.035);
   stamp(p,HERO_CLUSTER_STAMPS.knot,back[0]+side*rx*.62,back[1]-ry*.15,[1,13,14,15,16,17,18],Math.max(1,w/220));
   // Moss grows as joined stepped patches on the actual cavity's shoulders.
   for(let k=0;k<3;k++){const xx=back[0]-rx*.5+k*rx*.36,yy=back[1]-ry*.55+(k%2)*3;p.rect(xx,yy,rx*.24,3,9);p.rect(xx+2,yy-2,rx*.13,2,11);p.dot(xx+4,yy-3,12);}
  }else{
   const rear:Pt=[back[0]-side*rx*.15,Math.max(a[1]+ry*.42,back[1]-ry*.66)];pod(p,rear,rx*.72,ry*.75,'glaze',i%2?opal:[1,2,3,4,5,6]);tube(p,rear,back,rx*.57,opal);
   tube(p,[back[0]-side*rx*.55,back[1]],central,w*.05,opal);
   // Unequal folded ceramic ribs surround dark saturated cyan cores.
   pod(p,back,rx,ry,'glaze',i%2?[1,2,3,4,5,6]:opal);
   pod(p,[back[0]+side*rx*.6,back[1]+ry*.28],rx*.52,ry*.62,'glaze',opal);
   stamp(p,HERO_CLUSTER_STAMPS.glass,back[0],back[1]-ry*.27,[1,13,14,20,21,22,24],Math.max(1,w/120));
   tube(p,[q.c[0]+side*q.radius*1.15,q.c[1]-q.radius*.7],[q.c[0]+side*q.radius*1.15,q.c[1]+q.radius*.65],w*.023,[1,20,21,22,23,24]);
  }
  // A dark flush moat immediately around the source disk distinguishes the
  // actual spring from its under-glass illustrated recess. Working renderer
  // restores the exact native disk; this outer ring has no collision meaning.
  p.disk(q.c[0],q.c[1],q.radius+2,1);
 }
 for(const t of contacts){const q:Pt=[t.c[0],t.c[1]-w*.055];socket(p,q,w*.073,grove?'rock':vapor?'glaze':'metal',grove?rootRamp:vapor?opal:steel,[1,1,2,3,4,5,6,14,17,18]);tube(p,q,t.c,w*.02,grove?rootRamp:vapor?opal:copper);}
}

export function paintHeroAssembly(p:PixelCanvas,r:RoomArtPlan,project:RoomProjection){
 const a=project(r.bounds[0],r.bounds[3],r.bed.height),b=project(r.bounds[2],r.bounds[1],r.bed.height),bank=project(r.bankCenter.x,r.bankCenter.y,r.bed.height),w=b[0]-a[0],h=b[1]-a[1];
 if(![...a,...b,...bank,w,h].every(Number.isFinite)||w<=0||h<=0||w>1536||h>1536||p.palette.length<32)throw Error('Hero raster bounds');
 if(w<96||h<120){p.rect(a[0],a[1],w,h,r.theme==='grove'?8:2);return{lod:'flat-material'};}
 const prior=p.clip,L=Math.max(0,a[0],prior?.[0]??0),T=Math.max(0,a[1],prior?.[1]??0),R=Math.min(p.W-1,b[0],prior?.[2]??p.W-1),B=Math.min(p.H-1,b[1],prior?.[3]??p.H-1);if(L>R||T>B)return;p.clip=[L,T,R,B];
 try{
 const scale=w/(r.bounds[2]-r.bounds[0]),theme=r.theme,grove=theme==='grove',vapor=theme==='vaporwave',kind=grove?'rock':vapor?'glaze':'metal';
 const metal=[1,2,3,4,5,6],wood=[1,13,14,15,16,17],opal=[13,14,15,16,17,18],stone=[1,2,3,4,5,6],ramp=grove?wood:vapor?opal:metal;
 const main=r.springs.filter(s=>s.y>r.bankCenter.y+190).sort((a,b)=>b.radius-a.radius)[0],spring=main?project(main.x,main.y,r.bed.height):[a[0]+w*.18,a[1]+h*.3]as const;
 const targets=r.targets.map(t=>{const A=project(t.ax,t.ay,r.bed.height),B=project(t.bx,t.by,r.bed.height);return{A,B,c:[(A[0]+B[0])/2,(A[1]+B[1])/2]as Pt};});
 const left=a[0]+w*.12,right=b[0]-w*.10,top=a[1]+h*.07,low=Math.max(spring[1],...targets.map(t=>t.c[1]))+w*.10;
 p.rect(a[0],a[1],w,h,grove?8:2);
 // Quiet continuous enamel/sediment plane, with edge wear and a few
 // short source-aligned reflections. No central badge, oval or trapezoid.
 for(const side of [0,1]){
  const x=side?b[0]-w*.055:a[0]+w*.055;
  for(let y=Math.ceil(low+12);y<bank[1]-8;y++){
   const band=Math.floor((y-low)/7)%5;
   if(band!==3)p.rect(x+(side?-2:0),y,2,1,grove?9:3);
   if(band===1)p.dot(x+(side?-5:4),y,grove?9:3);
  }
 }
 for(const [u,v,len]of[[.26,.31,.13],[.52,.58,.08],[.30,.83,.065]]){
  const x=a[0]+w*u!,y=low+(bank[1]-low)*v!;
  p.line(x,y,x+w*len!,y-2,grove?9:3,1);
  p.line(x+w*.025,y+3,x+w*len!*.75,y+2,grove?9:3,1);
 }
 // Three broad but broken brushed-reflection groups echo source machinery
 // direction. They are deliberately low-valued and omit the bank/ball area.
 for(const [u,v]of [[.22,.25],[.47,.49],[.36,.68]]){
  const xx=a[0]+w*u!,yy=low+(bank[1]-low)*v!;
  for(let k=0;k<4;k++){const len=w*(.14-k*.021);p.line(xx+k*3,yy+k*3,xx+len,yy+k*3-2,grove?9:3,1);}
 }
 // Build the assembly from connected curved volumes rather than a broad
 // polygon behind three equal tiles. Unequal anatomy follows actual contacts.
 if(r.workingTopology.kind==='coupled-pressure-disks'){
  pressureCourt(p,r,project,a,b,bank);
 }else if(!grove&&!vapor){
  const core:Pt=[a[0]+w*.53,top+w*.14],drive:Pt=[left+w*.08,top+w*.17];
  tube(p,drive,core,w*.10,metal,true);tube(p,core,[right,top+w*.26],w*.10,metal,true);
  pod(p,core,w*.27,w*.145,'metal',metal,1);pod(p,drive,w*.18,w*.17,'metal',metal);pod(p,[right-w*.035,top+w*.24],w*.095,w*.16,'metal',metal,1);
  stamp(p,HERO_CLUSTER_STAMPS.vent,core[0]+w*.045,core[1], [1,1,2,3,4,5,6,14,17,18],Math.max(1,w/115));
  tube(p,drive,spring,Math.max(8,w*.045),metal,true);
  for(const [i,t]of targets.entries()){const q:Pt=[t.c[0]-w*.018,t.c[1]-w*(i===1?.14:.10)];tube(p,core,q,w*.043,metal,true);socket(p,q,w*(i===1?.100:.080),'metal',metal,[1,1,2,3,4,5,6,14,17,18]);tube(p,q,t.c,w*.035,[1,13,14,16,17,18],true);}
  for(const q of [[core[0]-w*.13,core[1]-w*.05],[drive[0],drive[1]+w*.055]]as Pt[]){p.rect(q[0]-8,q[1]-3,16,6,1);p.rect(q[0]-6,q[1]-2,10,2,21);p.rect(q[0]-5,q[1]-2,4,1,23);}
 }else if(grove){
  const rootA:Pt=[left+w*.07,top+w*.08],rootB:Pt=[right-w*.10,top+w*.10],hollow:Pt=[a[0]+w*.53,top+w*.23];
  // Karst shoulders have staggered boulder masses and one continuous dark
  // water recess. Root branches are separate tapered relief, not lumber bars.
  pod(p,[hollow[0],hollow[1]+w*.01],w*.29,w*.16,'rock',[1,1,2,2,3,4],1);
  for(const [x,y,rx,ry]of [[rootA[0],rootA[1],.20,.145],[rootB[0],rootB[1],.18,.19],[hollow[0]-w*.13,hollow[1]+w*.09,.10,.09],[hollow[0]+w*.20,hollow[1]+w*.08,.12,.08]])pod(p,[x!,y!],w*rx!,w*ry!,'rock',stone,2);
  root(p,[left-w*.09,top],rootA,w*.08);root(p,rootA,spring,w*.052);root(p,[right+w*.06,top-w*.025],rootB,w*.10);root(p,rootB,[hollow[0]+w*.12,hollow[1]+w*.10],w*.07);
  for(const [i,t]of targets.entries()){const q:Pt=[t.c[0]+w*(i===1?-.015:.015),t.c[1]-w*.095];root(p,rootB,q,w*.04);socket(p,q,w*.080,'rock',stone,[1,1,8,9,10,11,12,14,15,17]);root(p,q,t.c,w*.028);}
  for(const q of [rootA,rootB,[hollow[0]+w*.16,hollow[1]+w*.08]as Pt])stamp(p,HERO_CLUSTER_STAMPS.knot,q[0]-3,q[1]+2,[1,13,14,15,16,17,18,9,10,12],Math.max(1,w/190));
 }else{
  const lensA:Pt=[left+w*.16,top+w*.15],lensB:Pt=[right-w*.09,top+w*.20],bridge:Pt=[a[0]+w*.54,top+w*.28];
  tube(p,lensA,bridge,w*.095,opal);tube(p,bridge,lensB,w*.065,opal);
  pod(p,lensA,w*.20,w*.19,'glaze',[13,14,15,16,17,18]);pod(p,lensB,w*.15,w*.13,'glaze',[1,2,3,4,5,6]);pod(p,bridge,w*.10,w*.075,'glaze',[13,14,15,15,16,17]);
  stamp(p,HERO_CLUSTER_STAMPS.glass,lensA[0],lensA[1],[1,13,14,20,21,22,24],Math.max(1,w/95));stamp(p,HERO_CLUSTER_STAMPS.glass,lensB[0],lensB[1],[1,13,14,20,21,22,23],Math.max(1,w/175));
  tube(p,lensA,spring,w*.044,opal);
  for(const [i,t]of targets.entries()){const q:Pt=[t.c[0]+w*(i===0?-.02:.02),t.c[1]-w*.09];tube(p,bridge,q,w*.047,opal);socket(p,q,w*.084,'glaze',[13,14,15,16,16,17],[1,13,14,20,21,22,24]);tube(p,q,t.c,w*.024,opal);}
 }
 // Short engraved contact bedding makes the actual two-sided capsule the
 // highest, unmistakable working edge; no broad housing is inferred solid.
 for(const t of targets){const dx=t.B[0]-t.A[0],dy=t.B[1]-t.A[1],d=dhypot(dx,dy)||1,nx=-dy/d,ny=dx/d;p.line(t.A[0]+nx*4,t.A[1]+ny*4,t.B[0]+nx*4,t.B[1]+ny*4,1,3);p.line(t.A[0]-nx*4,t.A[1]-ny*4,t.B[0]-nx*4,t.B[1]-ny*4,grove?14:vapor?14:3,2);}
 // Grounded wall sections terminate before the lower receiving apron. These
 // are clipped under-glass strata, not extra physical guides.
 for(const side of[0,1])for(let k=0;k<3;k++){const x=side?b[0]-5:a[0]+5,y=low+18+k*Math.max(16,(bank[1]-low-35)/3);if(grove)pod(p,[x,y],w*.032,w*.065,'rock',stone,k);else pod(p,[x,y],w*.029,w*.055,kind,ramp,k);}
 return{painted:true,plane:'under-glass',raisedHousingAdmitted:false};
 }finally{p.clip=prior;}
}
