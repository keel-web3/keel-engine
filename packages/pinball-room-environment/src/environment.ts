import{createRoll,deriveSeed,dsin}from'@keel-engine/core';
import type{PixelCanvas}from'@keel-engine/pinball-pixel-art';
import type{PinballRoomEnvironmentRecipe as RoomArtRecipe,PinballRoomEnvironmentTheme as RoomStyle}from'./types.ts';
type RGB=readonly[number,number,number];
type Project=(x:number,y:number,z:number)=>readonly[number,number];
const colours:Record<RoomStyle,readonly RGB[]>={
 'ion-relay':[[5,5,22],[15,13,39],[29,23,60],[47,33,79],[77,48,101],[14,32,48],[28,56,76],[47,86,111],[75,133,153],[153,197,193],[37,63,90],[59,97,126],[91,150,164],[133,221,212],[235,253,230],[46,22,46],[99,40,69],[178,73,88],[244,135,94],[255,221,149]],
 vaporwave:[[12,8,33],[27,16,48],[47,27,66],[72,40,89],[109,58,121],[60,39,80],[108,68,123],[157,99,161],[212,154,202],[255,214,232],[34,53,78],[51,88,116],[88,142,157],[146,215,199],[222,255,228],[59,29,66],[120,49,102],[196,82,148],[255,150,193],[255,232,221]],
 grove:[[3,12,19],[8,24,30],[18,38,44],[32,54,54],[53,76,60],[24,32,40],[44,49,57],[71,73,78],[111,108,98],[161,153,124],[8,46,37],[17,77,42],[46,114,56],[101,166,72],[207,223,121],[8,39,53],[18,70,81],[43,114,120],[92,175,153],[204,242,185]],
};
export function roomEnvironmentPalette(style:RoomStyle):readonly RGB[]{if(!Object.hasOwn(colours,style))throw Error('Native environment style');return Object.freeze(colours[style].map(v=>Object.freeze([...v] as[number,number,number])));}
// Hand-authored 16px material cells. They are composed into source-anchored
// walls, not scattered props or a downsampled 3D surface. 0 is transparent.
const tiles:Record<RoomStyle,readonly string[]>={
 'ion-relay':['1111111111111111','1444444433333331','1432222222222331','1422222222222231','1422333322222231','1422344322222231','1422333322222231','1422222222222231','1422222233322231','1422222344322231','1422222233322231','1422222222222231','1422222222222231','1433333333333331','1333333333333311','1111111111111111'],
 vaporwave:['0001111111111000','0013444444433100','0134322222233310','1343222222222331','1432222222222231','1432222222222231','1432222222222231','1432222222222231','1432222222222231','1432222222222231','1432222222222231','1432222222222231','1333222222222331','0133333333333310','0013333333331100','0001111111111000'],
 grove:['0000001141110000','0001144433311000','0014443333221100','0144433332222110','1443333322222211','1433332222222221','1433322222222221','1433332222222211','1433333222222110','1143333322221100','0114433332211000','0011443332110000','0001143321100000','0000113211000000','0000011110000000','0000000000000000'],
};
// Full opaque exterior layers can be reused across native ticks that render
// the same indexed motion pose. This cache never includes a ball or working
// mechanism, and holds at most4MiB of indexed cells across all viewports/seeds.
const environmentCache=new Map<string,{indices:Uint8Array;meta:ReturnType<typeof environmentMeta>}>();
let environmentCacheBytes=0;
function environmentMeta(r:RoomArtRecipe){return Object.freeze({revision:'native-room-environment/whole-scene-r13',bedId:r.bed.id,worldSha256:r.worldSha256,style:r.style,plane:'decorative-behind-native-playing-planes' as const});}
/** Decorative exterior behind the actual native playing planes. Nothing in
 * this pass is an extra court, rail, ramp, collider, NPC, or travelled route. */
export function paintRoomEnvironment(p:PixelCanvas,r:RoomArtRecipe,project:Project,o:{tick:number;reducedMotion:boolean;inkOffset:number;background?:boolean}){
 if(!Object.hasOwn(colours,r.style)||!Number.isSafeInteger(o.tick)||o.tick<0||o.tick>432000||typeof o.reducedMotion!=='boolean'||(o.background!==undefined&&typeof o.background!=='boolean')||!Number.isSafeInteger(o.inkOffset)||o.inkOffset<0||o.inkOffset+20>p.palette.length||p.W>1024||p.H>1024)throw Error('Native environment budget');
 const a=project(r.bounds[0],r.bounds[3],r.bed.height),b=project(r.bounds[2],r.bounds[1],r.bed.height),base=project(r.center.x,r.bounds[1],0);
 for(const q of[a,b,base])if(!Array.isArray(q)||q.length!==2||![0,1].every(i=>Object.hasOwn(q,i)&&Number.isFinite(q[i])&&Math.abs(q[i])<100000))throw Error('Native environment projection');
 const x=a[0],y=a[1],w=b[0]-x,h=b[1]-y;if(w<24||h<80||w>1536||h>1536)throw Error('Native environment bed');
 const I=(v:number)=>o.inkOffset+v,roll=createRoll(deriveSeed(r.detailSeed,'exterior/'+r.style)),tick=o.reducedMotion?0:Math.floor(o.tick/6)*6,phase=dsin(tick*.026+roll.index(0,64)/10);
 const cacheable=o.background!==false&&p.clip===null&&p.offsetX===0&&p.offsetY===0,key=cacheable?JSON.stringify([r.worldSha256,r.roomId,r.bed.id,r.detailSeed,r.style,p.W,p.H,a,b,base,o.inkOffset,tick]):null;
 if(key){const cached=environmentCache.get(key);if(cached){p.pixels.set(cached.indices);environmentCache.delete(key);environmentCache.set(key,cached);return cached.meta;}}
 const old=p.clip;try{
  paintEnclosingArchitecture(p,r.style,x,y,w,h,base[1],tick,I,roll.index(0,3),o.background!==false);
  const meta=environmentMeta(r);if(key){while(environmentCache.size&&(environmentCacheBytes+p.pixels.length>4194304||environmentCache.size>=12)){const oldest=environmentCache.keys().next().value!;environmentCacheBytes-=environmentCache.get(oldest)!.indices.length;environmentCache.delete(oldest);}const indices=p.pixels.slice();environmentCache.set(key,{indices,meta});environmentCacheBytes+=indices.length;}
  return meta;
 }finally{p.clip=old;}
}
function casing(p:PixelCanvas,x:number,y:number,w:number,h:number,I:(v:number)=>number,ramp:number){
 p.rect(x+4,y+5,w,h,I(0));polygon(p,[x+5,y,x+w-5,y,x+w,y+5,x+w,y+h-6,x+w-5,y+h,x+5,y+h,x,y+h-6,x,y+5],I(ramp));p.rect(x+4,y+4,w-8,h-8,I(ramp+2));p.line(x+5,y+1,x+w-6,y+1,I(ramp+4),2);p.line(x+1,y+6,x+1,y+h-8,I(ramp+3),2);p.rect(x+w-5,y+6,3,h-12,I(ramp));
}
function vent(p:PixelCanvas,x:number,y:number,w:number,h:number,I:(v:number)=>number){casing(p,x,y,w,h,I,5);p.rect(x+7,y+10,w-14,h-20,I(0));for(let k=0;k<7;k++){const yy=y+12+k*6;p.rect(x+8,yy,w-16,3,I(6));p.line(x+9,yy,x+w-10,yy,I(8));}p.rect(x+11,y+h-7,6,2,I(17));}
// Original leaf clusters use authored indexed shade groups. The light cells
// form broken leaves and veins rather than outlines around a flat polygon.
const leafRows=[
 '0000001111000000','0000112222110000','0001233332221000',
 '0012344433222100','0123444332322210','1234433322333221',
 '1233332223443321','1233221234433221','0122212343322210',
 '0011123332221100','0000122211110000','0000011100000000',
]as const;
// Two further original silhouettes: a long folded spear leaf and a broad
// lobed leaf. Their clustered highlights and veins are authored at16×12;
// deterministic composition varies the actual leaf anatomy, not colour noise.
const spearRows=[
 '0000000000000011','0000000000011221','0000000011233321',
 '0000001234433221','0000123443322210','0012344332322100',
 '0123433223321000','1233322233210000','1232222332100000',
 '0122222211000000','0011111100000000','0000000000000000',
]as const;
const lobedRows=[
 '0000111001110000','0001232112321000','0012344323442100',
 '0123444334433210','1234432333322221','1233322234433221',
 '0122212344322210','0011223433221100','0001233322210000',
 '0001222222110000','0000112221100000','0000001111000000',
]as const;
const leafAtlas=[leafRows,spearRows,lobedRows]as const;
function leaf(p:PixelCanvas,x:number,y:number,s:number,I:(v:number)=>number,mirror:boolean,variant=0){
 const rows=leafAtlas[variant%3]!;
 // Equal-ink authored spans preserve crisp clusters while reducing raster
 // calls. The scale still belongs to the source-anchored foliage composition.
 for(let j=0;j<12;j++)for(let i=0;i<16;){const v=Number(rows[j]![mirror?15-i:i]);let end=i+1;while(end<16&&Number(rows[j]![mirror?15-end:end])===v)end++;if(v)p.rect(x+i*s,y+j*s,(end-i)*s,s,I(9+v));i=end;}
}
function cluster(p:PixelCanvas,x:number,y:number,r:number,I:(v:number)=>number,variant=0){
 const s=Math.max(.5,r/15);p.rect(x-r*.42,y+r*.12,r*.83,r*.43,I(10));
 if(variant===1){leaf(p,x-r*.94,y-r*.66,s,I,false,1);leaf(p,x-r*.36,y-r*.72,s*.79,I,true,1);leaf(p,x-r*.12,y-r*.17,s*.76,I,false,0);}
 else if(variant===2){leaf(p,x-r*.84,y-r*.62,s,I,false,2);leaf(p,x-r*.24,y-r*.85,s*.80,I,true,0);leaf(p,x-r*.08,y-r*.09,s*.66,I,false,2);}
 else{leaf(p,x-r*.97,y-r*.4,s,I,false,0);leaf(p,x-r*.21,y-r*.76,s*.87,I,true,1);leaf(p,x-r*.03,y-r*.03,s*.71,I,false,2);}
 p.line(x-r*.39,y+r*.22,x+r*.41,y-r*.11,I(11));p.dot(x-r*.16,y-r*.23,I(14));
}
function rivet(p:PixelCanvas,x:number,y:number,I:(v:number)=>number){p.rect(x-1,y-1,3,3,I(5));p.rect(x-1,y-1,2,1,I(9));p.dot(x,y,I(8));}
function rock(p:PixelCanvas,x:number,y:number,r:number,I:(v:number)=>number){
 polygon(p,[x-r,y-r*.22,x-r*.63,y-r*.61,x-r*.14,y-r*.66,x+r*.18,y-r*.42,x+r*.76,y-r*.47,x+r,y+r*.04,x+r*.7,y+r*.62,x-r*.59,y+r*.71,x-r*.94,y+r*.34],I(5));
 polygon(p,[x-r*.9,y-r*.17,x-r*.57,y-r*.5,x-r*.12,y-r*.55,x+r*.15,y-r*.31,x+r*.69,y-r*.35,x+r*.88,y+r*.06,x+r*.54,y+r*.29,x-r*.61,y+r*.36],I(7));
 polygon(p,[x-r*.79,y-r*.17,x-r*.49,y-r*.41,x-r*.14,y-r*.47,x+r*.14,y-r*.25,x+r*.61,y-r*.29,x+r*.7,y-r*.07,x+r*.21,y-r*.02,x-r*.21,y-r*.11,x-r*.46,y+r*.06],I(8));
 polygon(p,[x-r*.61,y+r*.39,x-r*.14,y+r*.26,x+r*.47,y+r*.29,x+r*.72,y+r*.1,x+r*.56,y+r*.53,x-r*.48,y+r*.61],I(6));
 p.line(x-r*.45,y-r*.42,x-r*.15,y-r*.45,I(9));p.line(x+r*.12,y-r*.24,x+r*.43,y-r*.27,I(9));
 p.line(x-r*.15,y-r*.13,x-r*.01,y+r*.17,I(5));p.line(x-r*.11,y-r*.1,x+r*.02,y+r*.09,I(8));
 p.rect(x+r*.28,y+r*.15,r*.23,2,I(5));
}
function pressurePod(p:PixelCanvas,x:number,y:number,w:number,h:number,I:(v:number)=>number,tick:number,variant:number){
 casing(p,x,y,w,h,I,10);p.rect(x+5,y+7,w-10,h-14,I(5));p.rect(x+6,y+8,4,h-17,I(8));p.rect(x+w-10,y+9,3,h-18,I(6));
 for(let k=0;k<3;k++){const yy=y+14+k*14;p.rect(x+3,yy,w-6,5,I(10));p.line(x+4,yy,x+w-5,yy,I(12));rivet(p,x+5,yy+2,I);rivet(p,x+w-6,yy+2,I);}
 const gx=x+w*.55,gy=y+h*.45;p.disk(gx+1,gy+1,8,I(0));p.disk(gx,gy,7,I(11));p.disk(gx-1,gy-1,5,I(8));p.disk(gx,gy,4,I(1));p.line(gx,gy,gx+dsin(tick*.035+variant)*3,gy-3,I(19));p.dot(gx,gy,I(14));
 p.rect(x+10,y+h-11,10,4,I(16));p.rect(x+12,y+h-11,5,1,I((Math.floor(tick/18)+variant)%5===0?19:17));
}
function distantArcadeWall(p:PixelCanvas,style:RoomStyle,x:number,y:number,w:number,h:number,tick:number,I:(v:number)=>number,variant:number){
 // A three-plane chamber silhouette follows the source bed. Uneven service
 // cavities are joined by structural beams, with quiet light well behind it.
 const l=x-w*.67,r=x+w*1.63,top=y-54,bottom=y+h+100;
 polygon(p,[l,top,l+w*.23,top-32,r-w*.18,top-20,r,top+16,r,bottom,l,bottom],I(1));
 polygon(p,[l+7,top+10,x-w*.15,top+10,x-w*.15,bottom,l+7,bottom],I(2));
 polygon(p,[x+w*1.13,top-4,r-7,top+24,r-7,bottom,x+w*1.13,bottom],I(2));
 const brace=(ax:number,ay:number,bx:number,by:number)=>{p.line(ax+2,ay+3,bx+2,by+3,I(0),6);p.line(ax,ay,bx,by,I(2),4);p.line(ax-1,ay-1,bx-1,by-1,I(3));};
 if(style==='ion-relay'){
  for(const side of[-1,1]){const xx=side<0?l+12:r-26,yy=top+22;p.rect(xx,yy,14,Math.min(930,h+134),I(0));p.rect(xx+2,yy+1,3,Math.min(929,h+131),I(3));
   for(let k=0;k<4;k++){const qy=yy+25+k*(h+80)/4;brace(xx+8,qy,xx+side*w*.21,qy+48);brace(xx+side*w*.21,qy+48,xx+8,qy+88);p.rect(xx-6,qy+7,26,5,I(2));}}
  polygon(p,[x-w*.36,top+15,x-w*.11,top+8,x+w*.24,top+46,x+w*.12,top+84,x-w*.27,top+60],I(3));
  polygon(p,[x+w*.87,top+11,x+w*1.18,top+28,x+w*1.22,top+93,x+w*.92,top+55],I(3));
 }else{
  const cy=y+h*.45;for(const side of[-1,1]){const xx=side<0?l+18:r-30;brace(xx,top+13,xx,cy-28);brace(xx,cy+14,xx,bottom);p.rect(xx-5,cy-25,21,36,I(1));p.rect(xx-3,cy-23,3,30,I(4));
   p.line(xx+side*10,cy-80,xx+side*10,cy-42,I(16),3);p.line(xx+side*10-1,cy-79,xx+side*10-1,cy-44,I((Math.floor(tick/36)+variant)%7===0?18:17));}
  polygon(p,[l+22,top+9,l+w*.46,top+9,l+w*.42,top+98,l+22,top+104],I(3));p.line(l+26,top+13,l+w*.42,top+13,I(4),2);
  polygon(p,[r-w*.4,top+15,r-17,top+37,r-17,top+116,r-w*.44,top+92],I(3));
 }
}
function tile(p:PixelCanvas,rows:readonly string[],x:number,y:number,scale:number,I:(v:number)=>number,ramp:number){for(let j=0;j<16;j++)for(let i=0;i<16;i++){const v=Number(rows[j]![i]);if(v)p.rect(x+i*scale,y+j*scale,scale,scale,I(ramp+v-1));}}
// Clip scenery before allocating the polygon mask. A large projected source
// bed can surround a small viewport; its offscreen art must not allocate a
// larger raster than the visible indexed canvas.
function polygon(p:PixelCanvas,points:readonly number[],ink:number){
 let vertices:[number,number][]=[];for(let i=0;i<points.length;i+=2)vertices.push([points[i]!,points[i+1]!]);
 const clip=p.clip,l=Math.max(-p.offsetX,clip?clip[0]-p.offsetX:-Infinity),r=Math.min(p.W-1-p.offsetX,clip?clip[2]-p.offsetX:Infinity),t=Math.max(-p.offsetY,clip?clip[1]-p.offsetY:-Infinity),b=Math.min(p.H-1-p.offsetY,clip?clip[3]-p.offsetY:Infinity);
 if(l>r||t>b)return;
 for(const[axis,edge,inside]of[[0,l,1],[0,r,-1],[1,t,1],[1,b,-1]]as const){
  const out:[number,number][]=[];if(!vertices.length)return;
  for(let i=0;i<vertices.length;i++){const a=vertices[i]!,q=vertices[(i+1)%vertices.length]!,ai=(a[axis]-edge)*inside>=0,qi=(q[axis]-edge)*inside>=0;
   if(ai)out.push(a);if(ai!==qi){const f=(edge-a[axis])/(q[axis]-a[axis]);out.push(axis===0?[edge,a[1]+(q[1]-a[1])*f]:[a[0]+(q[0]-a[0])*f,edge]);}}
  vertices=out;
 }
 if(vertices.length>=3)p.poly(vertices.flat(),ink);
}

/** Original curved pixel relief. Rasterized directly into indexed spans,
 * with stepped contour bands and intentionally unequal highlights. */
function relief(p:PixelCanvas,cx:number,cy:number,rx:number,ry:number,I:(n:number)=>number,ramp:number,variant=0){
 const W=Math.max(4,Math.min(250,Math.round(rx))),H=Math.max(4,Math.min(400,Math.round(ry)));cx=Math.round(cx);cy=Math.round(cy);
 for(let yy=-H;yy<=H;yy++){let e=W;while(e>0&&e*e*H*H+yy*yy*W*W>W*W*H*H)e--;e=Math.floor(e/2)*2;if(!e)continue;
  const y=cy+yy;if(y+p.offsetY<-3||y+p.offsetY>p.H+3)continue;
  p.rect(cx-e+3,y+4,e*2+1,1,I(0));
  const v=(yy+H)/(H*2),shade=v<.16?4:v<.32?3:v>.80?0:v>.65?1:2;
  p.rect(cx-e,y,e*2+1,1,I(ramp));if(e>3)p.rect(cx-e+2,y,e*2-3,1,I(ramp+Math.min(3,shade)));
  if(e>7&&yy<H*.48)p.rect(cx-e+3,y,Math.max(2,e*.16),1,I(ramp+3));
  if(yy<-H*.22&&yy>-H*.68&&e>9)p.rect(cx-e+5,y,Math.max(2,e*.12),1,I(ramp+4));
  if(variant===1&&yy%11===0&&e>12){p.rect(cx-e+3,y,e*2-6,2,I(ramp));p.rect(cx-e+5,y,e*.6,1,I(ramp+3));}
 }
}
function conduit(p:PixelCanvas,points:readonly(readonly[number,number])[],thickness:number,I:(n:number)=>number,ramp:number){
 const span=Math.max(1,...points.slice(1).map((q,i)=>Math.max(Math.abs(q[0]-points[i]![0]),Math.abs(q[1]-points[i]![1]))));thickness=Math.min(56,thickness);while(thickness>1&&(Math.ceil(span)+1)*Math.ceil(thickness+5)**2>1048576)thickness--;
 for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!;p.line(a[0]+3,a[1]+4,b[0]+3,b[1]+4,I(0),thickness+5);p.line(...a,...b,I(ramp),thickness);p.line(a[0]-1,a[1]-2,b[0]-1,b[1]-2,I(ramp+2),Math.max(2,thickness*.65));p.line(a[0]-2,a[1]-3,b[0]-2,b[1]-3,I(ramp+4),Math.max(1,thickness*.12));}
}
function paintEnclosingArchitecture(p:PixelCanvas,style:RoomStyle,x:number,y:number,w:number,h:number,baseY:number,tick:number,I:(n:number)=>number,variant:number,background:boolean){
 const bottom=y+h,unit=Math.max(.45,Math.min(1.4,w/270));
 if(background)p.rect(0,0,p.W,p.H,I(0));
 // Source-height shadow belongs to this real cabinet only. No new floor or
 // false table is drawn; native playing planes later cover all overlap.
 const skirt=Math.max(8,Math.min(65,baseY-bottom+20));p.rect(x-10,bottom+3,w+26,skirt,I(0));
 if(style==='ion-relay'){
  // A deliberately asymmetric plant: broad left exchanger, high right
  // induction riser, joined by one curved overhead supply trunk.
  if(background){p.rect(x-w*.6,y-120,w*2.2,h+240,I(1));for(const [u,v,rw,rh]of[[-.46,.28,.28,.40],[1.13,.05,.25,.45]])relief(p,x+w*u!,y+h*v!,w*rw!,h*rh!,I,1,1);}
  const left=x-29*unit,right=x+w+29*unit;
  conduit(p,[[left-20,y+h*.60],[left-28,y+h*.12],[left+2,y-31],[x+w*.35,y-47],[right-2,y-28],[right+17,y+h*.21]],18*unit,I,5);
  relief(p,left-10,y+h*.57,43*unit,h*.31,I,5,1);
  relief(p,right+9,y+h*.25,34*unit,h*.24,I,10,0);
  const chamberX=right-12*unit,chamberY=y+h*.10,chamberH=h*.30;p.rect(chamberX,chamberY,35*unit,chamberH,I(0));p.rect(chamberX+3*unit,chamberY+3*unit,28*unit,chamberH-6*unit,I(5));for(let k=0;k<6;k++){const yy=chamberY+7*unit+k*(chamberH-12*unit)/6;p.rect(chamberX+5*unit,yy,23*unit,3*unit,I(6));p.rect(chamberX+6*unit,yy,18*unit,unit,I(8));}conduit(p,[[right+25*unit,y+h*.07],[right+31*unit,y+h*.19],[right+26*unit,y+h*.47]],5*unit,I,15);
  // Deep inset exchanger window with copper sectional fins and steel ends.
  const vx=left-34*unit,vy=y+h*.35,vw=43*unit,vh=h*.39;
  p.rect(vx,vy,vw,vh,I(0));for(let k=0;k<7;k++){const yy=vy+6+k*(vh-10)/7;p.rect(vx+3,yy,vw-6,4*unit,I(16));p.rect(vx+4,yy,vw-10,unit,I(18));p.rect(vx+vw*.60,yy+unit,vw*.18,unit,I(17));}
  conduit(p,[[right+8,y+h*.48],[right+20,y+h*.64],[right-1,bottom-9]],11*unit,I,5);
  for(const [xx,yy,ww]of[[left+5,y+h*.19,11],[right-4,y+h*.17,12],[left-17,y+h*.79,15]]){p.rect(xx!-2,yy!-2,ww!*unit+4,8*unit,I(0));p.rect(xx!,yy!,ww!*unit,3*unit,I(12));p.rect(xx!+1,yy!,ww!*unit*.44,unit,I(14));}
  // The underside is a few substantial joined ribs, not a repeated tile row.
  p.rect(x+2,bottom+1,w-4,12*unit,I(5));p.rect(x+5,bottom+2,w-10,2*unit,I(8));for(const u of[.14,.49,.82]){p.rect(x+w*u,bottom+5,13*unit,skirt*.8,I(1));p.rect(x+w*u+2,bottom+5,3*unit,skirt*.8,I(6));}
 }else if(style==='grove'){
  // One hollow living chamber. Roots weave into an irregular mineral lip;
  // foliage crowns those connected limbs, never regular floating leaf rows.
  const l=x-24*unit,r=x+w+25*unit,top=y-29*unit;
  if(background){relief(p,l-w*.18,y+h*.50,w*.29,h*.78,I,1,0);relief(p,r+w*.18,y+h*.38,w*.31,h*.75,I,1,0);
   // One connected canopy roof, broken into stepped leaf-shadow clusters.
   relief(p,x+w*.24,y-42*unit,w*.39,48*unit,I,1,0);relief(p,x+w*.72,y-56*unit,w*.34,51*unit,I,1,0);
   conduit(p,[[l-15,y+h*.29],[x+w*.09,y-29*unit],[x+w*.37,y-51*unit],[x+w*.69,y-47*unit],[r+9,y+h*.18]],13*unit,I,5);
   for(const [u,v,sz]of [[.10,-.19,42],[.32,-.24,34],[.59,-.24,41],[.86,-.18,44]])cluster(p,x+w*u!,y+h*v!,sz!*unit,I,variant);
  }
  const leftRoot:[[number,number],[number,number],[number,number],[number,number]]=[[l-25,bottom+40],[l+3,y+h*.65],[l-9,y+h*.23],[x+w*.20,top-20]];
  const rightRoot:[[number,number],[number,number],[number,number],[number,number]]=[[r+39,bottom+15],[r-3,y+h*.56],[r+16,y+h*.08],[x+w*.70,top-32]];
  conduit(p,leftRoot,24*unit,I,5);conduit(p,rightRoot,31*unit,I,5);
  for(const [xx,yy,rr]of[[l-8,y+h*.20,35],[l-18,y+h*.73,29],[r+12,y+h*.42,43],[x+w*.18,top+7,33],[x+w*.83,top-2,40]]){rock(p,xx!,yy!,rr!*unit,I);}
  // Crown masses are unequal and structurally connected to the root forks.
  for(const [u,v,rr,vr]of[[.13,-.10,41,2],[.36,-.13,31,1],[.79,-.14,47,0],[1.10,.24,34,2],[-.10,.53,29,1],[1.08,.69,28,0]]){const xx=x+w*u!,yy=y+h*v!;cluster(p,xx,yy,rr!*unit,I,vr!);cluster(p,xx-rr!*unit*.35,yy+rr!*unit*.28,rr!*unit*.62,I,(vr!+1)%3);}
  // Joined ledges flank a deep opening below the real apron, avoiding a
  // manufactured plank sheet spanning the entire downfield silhouette.
  const ledgeY=bottom+19*unit;for(const [u,rr,dy]of[[.01,40,4],[.18,32,9],[.80,37,6],[1.00,44,0]]){rock(p,x+w*u!,ledgeY+dy!*unit,rr!*unit,I);cluster(p,x+w*u!,ledgeY-rr!*unit*.24,rr!*unit*.62,I,variant);}
  const fall=x+w*.66;p.rect(fall,ledgeY+9,4*unit,Math.max(8,Math.min(140,p.H-ledgeY)),I(15));p.rect(fall+unit,ledgeY+9,unit,Math.max(8,Math.min(140,p.H-ledgeY)),I(17));
  for(let k=0;k<4;k++){const yy=ledgeY+12+(k*29+Math.floor(tick/5))%116;p.rect(fall+unit,yy,unit,5*unit,I(18));}
 }else{
  // Curved ceramic acoustics hall: one broad left scalloped rib, two unequal
  // saturated glazing wells on the right, no rectangular pilaster wallpaper.
  const l=x-31*unit,r=x+w+31*unit;
  if(background){relief(p,l-w*.22,y+h*.50,w*.33,h*.76,I,1);relief(p,r+w*.24,y+h*.40,w*.39,h*.66,I,1);}
  conduit(p,[[l-15,bottom+27],[l-32,y+h*.64],[l-20,y+h*.20],[x+w*.12,y-39],[x+w*.65,y-57],[r+5,y-3],[r+24,y+h*.40]],21*unit,I,5);
  relief(p,r+13,y+h*.28,36*unit,h*.24,I,10);relief(p,l-24,y+h*.65,28*unit,h*.20,I,5);
  const lc=l-31*unit,ly=y+h*.51;p.rect(lc,ly,25*unit,h*.25,I(1));p.rect(lc+4*unit,ly+3*unit,16*unit,h*.23,I(10));p.rect(lc+5*unit,ly+4*unit,4*unit,h*.16,I(12));p.rect(lc+7*unit,ly+5*unit,unit,h*.09,I(14));
  for(let k=0;k<3;k++){const yy=ly+9*unit+k*h*.064;p.rect(lc-3*unit,yy,31*unit,4*unit,I(5));p.rect(lc-1*unit,yy,27*unit,unit,I(8));}

  // Original glass reflections have broad dark cores and short cyan/pink
  // clusters. They remain well behind the actual body and working surfaces.
  const wx=r-4*unit,wy=y+h*.12,wh=h*.29;p.rect(wx,wy,26*unit,wh,I(0));p.rect(wx+4*unit,wy+4*unit,16*unit,wh-8*unit,I(10));p.rect(wx+5*unit,wy+5*unit,5*unit,wh*.65,I(12));p.rect(wx+7*unit,wy+6*unit,unit,wh*.31,I(14));
  for(const [xx,yy,len]of[[l-13,y+h*.28,30],[r+4,y+h*.63,24],[x+w*.45,y-31,37]]){p.rect(xx!,yy!,len!*unit,4*unit,I(16));p.rect(xx!+2*unit,yy!,len!*unit*.56,unit,I(18));}
  const sy=bottom+2;conduit(p,[[x+7,sy],[x+w*.23,sy+11],[x+w*.66,sy+7],[x+w-6,sy]],9*unit,I,5);
 }
}

// Internal shared cluster vocabulary; intentionally not re-exported by package index.
export{relief as sceneRelief,conduit as sceneConduit,cluster as sceneFoliage,rock as sceneRock};
