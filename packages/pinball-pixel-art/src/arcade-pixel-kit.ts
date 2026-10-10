import{dsin,dcos,dhypot}from'@keel-engine/core';
import{artArguments,artSeed,artSegment}from'./validation.ts';
import{createRoll,deriveSeed}from'@keel-engine/core';import{PixelCanvas}from'./pixel-canvas.ts';
/** Authored pixel clusters. These shapes are art components, not collisions.
 * Roles distinguish cast metal, ceramic, hose and deep structural shadow. */
export function castShell(p:PixelCanvas,x:number,y:number,w:number,h:number,ramp:number,seed:string){
 artArguments(p,x,y,w,h,ramp);artSeed(seed);if(w<8||h<12||w>1024||h>1024||w*h>1048576||!Number.isInteger(ramp)||ramp<0||ramp+4>=p.palette.length)throw Error('Cast shell dimensions/ink');
 const rng=createRoll(deriveSeed(seed,'casting')),cut=Math.max(4,Math.min(12,Math.round(w*.12)));
 p.poly([x+cut,y,x+w-cut,y,x+w,y+cut,x+w,y+h-cut,x+w-cut,y+h,x+cut,y+h,x,y+h-cut,x,y+cut],ramp+1);
 p.poly([x+cut,y+2,x+w-cut,y+2,x+w-3,y+cut,x+w-3,y+h-cut,x+w-cut,y+h-4,x+cut,y+h-4,x+3,y+h-cut,x+3,y+cut],ramp+2);
 p.line(x+cut,y+1,x+w-cut,y+1,ramp+4,2);p.line(x+2,y+cut,x+2,y+h-cut,ramp+3,2);p.line(x+w-2,y+cut,x+w-2,y+h-cut,ramp,3);p.line(x+cut,y+h-1,x+w-cut,y+h-1,ramp,3);
 // Casting grain is clustered into small shaded chips, never uniform noise.
 for(let k=0;k<Math.ceil(w*h/280);k++){const xx=x+cut+Math.floor((rng.at(k*3)/65536)*(w-cut*2)),yy=y+6+Math.floor((rng.at(k*3+1)/65536)*(h-12)),n=2+Math.floor((rng.at(k*3+2)/65536)*4);p.line(xx,yy,xx+n,yy,ramp+1);p.dot(xx,yy-1,ramp+3);}
 for(const xx of[x+cut,x+w-cut])for(const yy of[y+7,y+h-9]){p.disk(xx,yy,3,ramp);p.dot(xx-1,yy-1,ramp+4);}
}
export function piston(p:PixelCanvas,x:number,y:number,w:number,h:number,warm=false){
 artArguments(p,x,y,w,h);if(w<8||w>64||h<8||h>1024||typeof warm!=='boolean')throw Error('Piston extent');
 const r=warm?15:35;p.rect(x+3,y,w-6,h, r+1);p.rect(x+5,y,Math.max(2,w*.18),h,r+4);p.rect(x+w-7,y,3,h,r);
 for(const yy of[y,y+h*.28,y+h*.74,y+h-5]){p.rect(x,yy,w,5,r);p.rect(x+1,yy,w-2,2,r+3);p.rect(x+2,yy,w-4,1,r+4);}
}
export function hose(p:PixelCanvas,points:readonly(readonly[number,number])[],radius:number,ramp:number){
 artArguments(p,radius,ramp);if(!Number.isInteger(ramp)||ramp<0||ramp+2>=p.palette.length||radius<0||radius>28)throw Error('Hose radius/ink');
 if(!Array.isArray(points)||points.length<2||points.length>32)throw Error('Pixel hose point budget');
 for(let i=0;i<points.length;i++){if(!Array.isArray(points[i])||points[i]!.length!==2)throw Error('Hose point');artArguments(p,...points[i]!);if(i)artSegment(p,points[i-1]!,points[i]!,radius*2+3);}
 for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!;p.line(a[0]+2,a[1]+3,b[0]+2,b[1]+3,0,radius*2+3);p.line(a[0],a[1],b[0],b[1],ramp,radius*2);p.line(a[0]-1,a[1]-1,b[0]-1,b[1]-1,ramp+2,Math.max(1,radius));const n=Math.ceil(dhypot(b[0]-a[0],b[1]-a[1])/6);for(let k=0;k<n;k++){const t=k/n,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;p.line(x-2,y,x+1,y+2,ramp+1,1);}}
}
export function webBeam(p:PixelCanvas,x:number,y:number,a:number,b:number,width:number,ramp:number){
 artSegment(p,[x,y],[a,b],width);artArguments(p,ramp);if(!Number.isInteger(ramp)||ramp<0||ramp+2>=p.palette.length||width<=0||dhypot(a-x,b-y)<1||Math.abs(a-x)+width>1024||Math.abs(b-y)+width>1024)throw Error('Web beam extent');
 const dx=a-x,dy=b-y,d=dhypot(dx,dy),nx=-dy/d*width/2,ny=dx/d*width/2;p.poly([x+nx,y+ny,a+nx,b+ny,a-nx,b-ny,x-nx,y-ny],ramp);
 p.line(x+nx,y+ny,a+nx,b+ny,ramp+2,2);p.line(x-nx,y-ny,a-nx,b-ny,ramp+1,2);const n=Math.max(1,Math.floor(d/23));for(let k=0;k<n;k++){const t=k/n,u=(k+1)/n,side=k%2?1:-1;p.line(x+dx*t+nx*side,y+dy*t+ny*side,x+dx*u-nx*side,y+dy*u-ny*side,ramp+1,2);}
}
export function recessMachinery(p:PixelCanvas,x:number,y:number,w:number,h:number,seed:string,anatomy:string){
 artArguments(p,x,y,w,h);artSeed(seed);if(w<100||h<140||w>768||h>768||!['pressure-bank','turbine-court','relay-foundry'].includes(anatomy))throw Error('Recess grammar extent');
 // All these elements are seen through the same uninterrupted glass/enamel
 // play surface; deliberately dark enough to read behind the real ball.
 p.rect(x,y,w,h,1);const rng=createRoll(deriveSeed(seed,'deep-room')),side=rng.index(0,2)?1:-1;
 const bx=side<0?x+8:x+w-58;
 if(anatomy==='pressure-bank'){
  castShell(p,bx,y+20,50,h*.55,5,seed+'/tank');piston(p,bx+12,y+34,25,h*.48);
  hose(p,[[bx+25,y+h*.62],[bx+25,y+h*.74],[x+w*.45,y+h*.79],[x+w*.35,y+h*.89]],5,5);
  for(let k=0;k<3;k++)castShell(p,x+w*.25+k*24,y+h*.10+k*9,22,36,5,seed+'/valve'+k);
 }else if(anatomy==='turbine-court'){
  castShell(p,x+w*.18,y+25,w*.65,h*.25,5,seed+'/duct');
  for(let k=0;k<7;k++){const yy=y+35+k*10;p.line(x+w*.24,yy,x+w*.75,yy+5,7,3);p.line(x+w*.24,yy+2,x+w*.75,yy+7,5,2);}
  hose(p,[[x+w*.18,y+h*.28],[x+w*.11,y+h*.40],[x+w*.20,y+h*.61],[x+w*.38,y+h*.70]],6,5);
  hose(p,[[x+w*.78,y+h*.29],[x+w*.89,y+h*.43],[x+w*.72,y+h*.63]],4,5);
 }else{
  castShell(p,bx,y+22,47,h*.58,5,seed+'/relay');for(let k=0;k<5;k++){const yy=y+40+k*h*.09;p.rect(bx+10,yy,26,18,1);p.line(bx+12,yy+3,bx+32,yy+3,7);p.rect(bx+13,yy+7,5,5,6);}
  hose(p,[[bx+20,y+h*.65],[bx+20,y+h*.75],[x+w*.60,y+h*.85]],4,5);
 }
 // Irregular structural depth crosses behind the clear near-bank fan.
 webBeam(p,x-8,y+h*.50,x+w*.65,y+h*.96,16,5);webBeam(p,x+w+8,y+h*.42,x+w*.32,y+h*.96,13,5);
 webBeam(p,x+10,y+h*.31,x+w-12,y+h*.23,11,5);
 for(const t of [.36,.63,.86]){const yy=y+h*t;p.line(x+2,yy,x+14,yy,7,3);p.line(x+w-14,yy+8,x+w-2,yy+8,7,3);}
 // Wide glass glare clusters, muted and sparse, establish a continuous plane.
 p.line(x+w*.18,y+12,x+w*.34,y+12,8,2);p.line(x+w*.15,y+15,x+w*.22,y+15,7);
 p.line(x+w*.62,y+h-20,x+w*.79,y+h-20,7,2);
}
/** Sectioned cheek outside the native return rail; the working edge stays exact. */
export function formedGuide(p:PixelCanvas,a:readonly[number,number],b:readonly[number,number],outside:-1|1,depth=26,radius=2){
 artSegment(p,a,b,4);artArguments(p,depth,radius);if((outside!==-1&&outside!==1)||depth<4||depth>48||radius<=0||radius>12)throw Error('Guide extent');
 const dx=b[0]-a[0],dy=b[1]-a[1],d=dhypot(dx,dy);if(d<1)return;const nx=outside*Math.abs(dy)/d,ny=-outside*dx/d;
 const at=(t:number,n:number):[number,number]=>[a[0]+dx*t+nx*n,a[1]+dy*t+ny*n];
 // Cast outside cheek: broad at its mounting shoulder, tapering toward the
 // native lower contact. Broken dark recesses read as housing, not a second rail.
 const profile=[...at(0,1),...at(1,1),...at(1,Math.max(3,depth*.32)),...at(.72,depth*.55),...at(.25,depth),...at(.06,depth+2)];
 p.poly(profile,35);p.poly([...at(.05,3),...at(.92,3),...at(.68,depth*.48),...at(.24,depth-2),...at(.07,depth-1)],10);
 p.line(...at(.06,depth),...at(.25,depth-2),37,2);
 for(const t of [.13,.47]){const d=depth*(1-t*.6),u=at(t,3),v=at(t,d);p.line(u[0],u[1],v[0],v[1],36,3);p.line(u[0]-1,u[1]-1,v[0]-1,v[1]-1,38,1);if(depth>=10){const c=at(t,d*.6);p.disk(c[0],c[1],2,5);p.dot(c[0]-1,c[1]-1,38);}}

 p.line(a[0],a[1],b[0],b[1],16,radius*2);p.line(a[0]+nx*radius*.35,a[1]+ny*radius*.35,b[0]+nx*radius*.35,b[1]+ny*radius*.35,19,1);
}
export function springActuator(p:PixelCanvas,x:number,y:number,r:number,recoil:number,pulse:number,seed:string){
 artArguments(p,x,y,r,recoil,pulse);artSeed(seed);
 if(!Number.isFinite(r)||r<12||r>128)throw Error('Pixel spring radius12..128 required');
 if(!Number.isFinite(recoil)||!Number.isFinite(pulse)||recoil<0||recoil>1||pulse<0||pulse>1)throw Error('Pixel spring feedback');
 const compression=Math.round(recoil*5);castShell(p,x-r-9,y-r-6,r*2+18,r*2+15,10,seed);
 for(const side of[-1,1]){const xx=x+side*(r+6);piston(p,xx-4,y-r+compression,8,r*1.8-compression,true);}
 // The complete native solid working disk stays filled. Its shaded segments
 // are a pressure plate, not an open scoop or a smaller replacement collider.
 p.disk(x+2,y+3,r+2,0);p.disk(x,y,r,15);p.disk(x-1,y-1,r-1,18);p.disk(x,y,r-5,36);p.disk(x-2,y-3,r-8,38);
 p.poly([x-r*.64,y-2,x-3,y-r*.57,x+r*.60,y-r*.25,x+r*.55,y+r*.42,x-r*.32,y+r*.59],22);
 p.line(x-r*.55,y-3,x-4,y-r*.47,24,2);p.disk(x-3,y-3,r*.29,pulse>.25?34:24);
 for(const a of[.4,2.5,4.5]){const xx=x+dcos(a)*(r-3),yy=y+dsin(a)*(r-3);p.disk(xx,yy,2,16);p.dot(xx-1,yy-1,19);}
 return{workingBounds:[x+p.offsetX-r,y+p.offsetY-r,x+p.offsetX+r,y+p.offsetY+r],noncontactBounds:[x+p.offsetX-r-12,y+p.offsetY-r-9,x+p.offsetX+r+12,y+p.offsetY+r+12]};
}
export function nativeBlade(p:PixelCanvas,x:number,y:number,a:number,b:number,radius:number){
 artSegment(p,[x,y],[a,b],radius*2);if(radius<=0||radius>24)throw Error('Native blade radius');
 const dx=a-x,dy=b-y,d=dhypot(dx,dy);if(d<1)return;const nx=-dy/d,ny=dx/d;
 // The bearing is a recessed support; the actual bright rubber capsule keeps
 // the exact native blade radius and endpoint positions.
 p.disk(x+2,y+3,11,0);p.disk(x,y,10,35);p.disk(x-1,y-1,8,37);p.disk(x,y,5,15);
 p.line(x,y,a,b,16,radius*2);p.line(x+nx*radius*.45,y+ny*radius*.45,a+nx*radius*.45,b+ny*radius*.45,18,Math.max(1,radius));
 p.line(x-nx*radius*.45,y-ny*radius*.45,a-nx*radius*.45,b-ny*radius*.45,34,1);
 p.disk(x,y,3,36);p.dot(x-1,y-1,39);
}
