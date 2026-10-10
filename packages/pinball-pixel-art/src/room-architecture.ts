import{dsin,dcos,dhypot}from'@keel-engine/core';
import{artArguments}from'./validation.ts';
import type{ArenaWorldDefinition,ArenaSurface}from'@keel-engine/pinball-arena';import{PixelCanvas}from'./pixel-canvas.ts';import{roomGrammar}from'./room-grammar.ts';type PixelPoint=readonly[number,number];
/** Complete source-space scenic envelope, admitted outside every real surface.
 * This is noncontact machinery in the recess, never a new playable target. */
export function drawRoomArchitecture(p:PixelCanvas,world:ArenaWorldDefinition,field:ArenaWorldDefinition['arenas'][number],bed:ArenaSurface,project:(x:number,y:number,z:number)=>PixelPoint){
 artArguments(p);if(!world.arenas.includes(field)||p.offsetX!==0||p.offsetY!==0)throw Error('Source room field/offset ownership');
 const g=roomGrammar(world.seed,field,bed),[x0,y0,x1,y1]=g.bounds,rejected:string[]=[];
 for(const side of [g.serviceSide,-g.serviceSide]){
  const box=side<0?[x0-150,y0+170,x0-26,y1-70]:[x1+26,y0+170,x1+150,y1-70];
  const a=project(box[0]!,box[3]!,bed.height-12),b=project(box[2]!,box[1]!,bed.height-12),corner=project(box[0]!,box[1]!,bed.height-12),corner2=project(box[2]!,box[3]!,bed.height-12),x=a[0],y=a[1],w=b[0]-x,h=b[1]-y;
  artArguments(p,...a,...b,...corner,...corner2);if(w<48||h<100||w>768||h>768||Math.abs(corner[0]-a[0])>1||Math.abs(corner[1]-b[1])>1||Math.abs(corner2[0]-b[0])>1||Math.abs(corner2[1]-a[1])>1)throw Error('Room architecture requires bounded axis-aligned projection');
  const padX=Math.ceil(6*(box[2]!-box[0]!)/w),padY=Math.ceil(6*(box[3]!-box[1]!)/h),envelope=[box[0]!-padX,box[1]!-padY,box[2]!+padX,box[3]!+padY];
  const hit=field.surfaces.some(s=>{const xs=s.polygon.map(v=>v.x),ys=s.polygon.map(v=>v.y);return envelope[0]!<=Math.max(...xs)&&envelope[2]!>=Math.min(...xs)&&envelope[1]!<=Math.max(...ys)&&envelope[3]!>=Math.min(...ys);})||field.rails.some(r=>envelope[0]!<=Math.max(r.ax,r.bx)+r.radius&&envelope[2]!>=Math.min(r.ax,r.bx)-r.radius&&envelope[1]!<=Math.max(r.ay,r.by)+r.radius&&envelope[3]!>=Math.min(r.ay,r.by)-r.radius);if(hit){rejected.push(side<0?'left':'right');continue;}
  // Deep silhouette, warm facing metal and cool recessed sockets use distinct
  // pixel clusters rather than the same bevel applied to every material.
  p.poly([x+12,y,x+w-9,y,x+w,y+18,x+w-5,y+h-15,x+w-21,y+h,x+9,y+h-8,x,y+30],5);
  if(g.anatomy==='pressure-bank'){
   for(let k=0;k<2;k++){const xx=x+12+k*(w-24)/2;p.rect(xx,y+24,15,h-52,10);p.disk(xx+7,y+24,7,12,4);p.rect(xx+2,y+26,3,h-58,13);p.rect(xx+12,y+27,2,h-56,7);for(const t of [.13,.5,.83]){const yy=y+24+t*(h-52);p.rect(xx-3,yy,21,6,15);p.rect(xx-2,yy,19,1,19);p.bolt(xx+7,yy+3,2);}}
   p.beam(x+5,y+18,x+w-5,y+18,35,8);p.beam(x+9,y+h-19,x+w-9,y+h-19,35,9);
  }else if(g.anatomy==='turbine-court'){
   const cx=x+w/2;for(const t of [.23,.70]){const cy=y+h*t,r=w*.38;p.socket(cx,cy,r,10);p.disk(cx,cy,r-5,5);for(let k=0;k<5;k++){const a=k*Math.PI*2/5;p.poly([cx,cy,cx+dcos(a)*r*.7,cy+dsin(a)*r*.7,cx+dcos(a+.7)*r*.55,cy+dsin(a+.7)*r*.55],12);}p.bolt(cx,cy,3);}p.beam(x+6,y+12,x+6,y+h-12,35,4);
  }else{
   p.bevel([x+8,y+18,x+w-12,y+18,x+w-5,y+31,x+w-5,y+h-23,x+19,y+h-23,x+8,y+h-40],10);p.rect(x+17,y+35,w-34,h-76,5);for(let k=0;k<5;k++){const yy=y+43+k*(h-97)/5;p.rect(x+19,yy,w-38,9,7);p.line(x+20,yy,x+w-20,yy,12);p.rect(x+20,yy+3,4,3,k===1?23:17);}p.beam(x+6,y+h-17,x+w-5,y+h-17,15,8);
  }
  for(const yy of[y+8,y+h-8]){p.bolt(x+13,yy,3);p.bolt(x+w-13,yy,3);}
  return{bedId:bed.id,anatomy:g.anatomy,envelope,pixelPadding:6,rejected,kind:'noncontact-recess-architecture'};
 }
 return{bedId:bed.id,anatomy:g.anatomy,envelope:null,rejected,kind:'no-clear-source-envelope'};
}
