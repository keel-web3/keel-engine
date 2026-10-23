import{dsin,dcos,dhypot}from'@keel-engine/core';
import{artArguments,artSeed,artSegment,artTheme}from'./validation.ts';
import type{PinballArcadeTheme}from'./theme-backdrop.ts';import{PixelCanvas}from'./pixel-canvas.ts';import{springActuator,nativeBlade,formedGuide}from'./arcade-pixel-kit.ts';
export const PINBALL_PIXEL_MECHANISM_PADDING=Object.freeze({spring:Object.freeze({left:18,top:36,right:18,bottom:20}),rebound:Object.freeze({left:16,top:52,right:16,bottom:5})});
/** Every skin retains the exact working disk/capsule/rail. Extra assembly is
 * noncontact art and its complete envelope must be reserved by the caller. */
export function themedSpring(p:PixelCanvas,theme:PinballArcadeTheme,x:number,y:number,r:number,recoil:number,pulse:number,seed:string){
 artTheme(theme);artArguments(p,x,y,r,recoil,pulse);artSeed(seed);
 if(!Number.isFinite(r)||r<12||r>128||![recoil,pulse].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Themed spring bounds');
 if(theme==='ion-relay'||theme==='synthwave'){
  const travel=Math.round(recoil*8),top=y-r-32;
  // Rear accumulator is an asymmetric cast volume, with a dark side wall and
  // a lit crown. Bellows shorten into it; the working pressure disk never moves.
  p.poly([x-r-9,top+8,x-r+2,top,x+r-5,top,x+r+15,top+13,x+r+15,y-4,x+r+7,y+5,x-r-9,y-4],5);
  p.poly([x-r-8,top+8,x-r+2,top+2,x+r-7,top+2,x+r+5,top+10,x+r+5,y-8,x-r-8,y-8],11);
  p.poly([x+r+5,top+10,x+r+14,top+14,x+r+14,y-4,x+r+5,y+3],6);
  p.line(x-r+3,top+2,x+r-8,top+2,14,2);p.line(x-r+1,top+6,x+r-9,top+6,12,2);
  p.rect(x-r+1,top+11,r*1.45,10,2);for(let k=0;k<4;k++){const xx=x-r+4+k*r*.3;p.rect(xx,top+13,Math.max(2,r*.15),5,7);p.dot(xx,top+12,13);}
  for(const side of[-1,1]){const xx=x+side*r*.61,yy=top+25+travel;p.line(xx,yy,xx,y-r*.35,35,8);p.line(xx-2,yy,xx-2,y-r*.35,39,2);for(let k=0;k<4;k++){const cy=yy+k*(r*.65+6-travel)/4;p.line(xx-6,cy,xx+6,cy,15,3);p.line(xx-5,cy-1,xx+5,cy-1,19,1);}}
  springActuator(p,x,y,r,recoil,pulse,seed);
  return{workingBounds:[x+p.offsetX-r,y+p.offsetY-r,x+p.offsetX+r,y+p.offsetY+r],noncontactBounds:[x+p.offsetX-r-18,y+p.offsetY-r-36,x+p.offsetX+r+18,y+p.offsetY+r+20]};
 }
 const compression=Math.round(recoil*5);
 if(theme==='grove'){
  // Broken root crown grows around one source-owned pressure stone. Broad
  // shaded lobes form a continuous cradle, not a row of floating leaf stamps.
  const top=y-r-29;
  p.poly([x-r-13,y+2,x-r-16,top+22,x-r-7,top+5,x-4,top+13,x+7,top,x+r+10,top+9,x+r+15,y-6,x+r-2,y+10],10);
  p.poly([x-r-12,y-5,x-r-10,top+24,x-r-5,top+11,x-5,top+19,x+8,top+7,x+r+4,top+13,x+r+7,y-13],12);
  p.poly([x-r-5,top+12,x-5,top+21,x+8,top+9,x+r+3,top+14,x+r-3,top+21,x+8,top+17,x-3,top+29],14);
  p.poly([x-r+3,top+29,x+2,top+21,x+r-3,top+25,x+r-1,y-r*.3,x-r+2,y-r*.3],2);
  for(const side of[-1,1]){const xx=x+side*r*.65;p.line(xx,top+27+compression,xx-side*5,y-r*.25,11,7);p.line(xx-2,top+27+compression,xx-side*5-2,y-r*.25,14,2);}
  // Layered shale pressure plate; the complete outer disk stays solid.
  for(const side of[-1,1]){p.line(x+side*r*.62,y+r*.55+compression,x+side*(r+8),y+r+7+compression,10,7);p.line(x+side*r*.62-1,y+r*.55-1+compression,x+side*(r+8)-1,y+r+6+compression,12,2);}
  p.disk(x+2,y+3,r+2,0);p.disk(x,y,r,10);p.disk(x-1,y-1,r-1,12);
  p.poly([x-r*.75,y+2,x-r*.32,y-r*.76,x+r*.55,y-r*.60,x+r*.80,y+r*.12,x+r*.2,y+r*.77,x-r*.56,y+r*.61],37);
  p.poly([x-r*.69,y,x-r*.3,y-r*.62,x+r*.5,y-r*.52,x+r*.3,y-r*.13,x-r*.15,y+r*.14],39);
  p.line(x-r*.55,y+r*.27,x+r*.49,y-r*.04,35,2);p.line(x-r*.13,y+r*.18,x+r*.21,y+r*.58,35,2);
  p.disk(x-2,y-3,r*.23,pulse>.2?34:23);for(let k=0;k<7;k++){const a=k*.61-2.5,xx=x+dcos(a)*(r-3),yy=y+dsin(a)*(r-3);p.disk(xx,yy,3,21);p.dot(xx-1,yy-1,24);}
  }else if(theme==='sun-vault'){
  const top=y-r-32;
  p.poly([x-r-12,y-3,x-r-12,top+14,x-r+1,top,x+r-1,top,x+r+12,top+14,x+r+12,y-3],5);
  p.poly([x-r-10,y-6,x-r-10,top+15,x-r,top+4,x+r-3,top+4,x+r+8,top+16,x+r+8,y-6],11);
  p.poly([x-r,top+4,x+r-3,top+4,x+r+8,top+16,x+r,top+13,x-r+4,top+10],18);
  for(const side of[-1,1]){const xx=x+side*r*.72;p.rect(xx-4,top+18,8,r+13,16);p.rect(xx-3,top+18,2,r+13,19);p.rect(xx-7,top+22+compression,14,7,17);p.line(xx-6,top+22+compression,xx+5,top+22+compression,19,1);}
  p.poly([x-r-7,y+r+6,x-r-7,y-r+5+compression,x-r+3,y-r-8+compression,x+r-3,y-r-8+compression,x+r+7,y-r+5+compression,x+r+7,y+r+6],10);
  for(const side of[-1,1]){p.rect(x+side*(r+3)-3,y-r+8+compression,6,r*1.7-compression,16);p.line(x+side*(r+3)-2,y-r+8+compression,x+side*(r+3)-2,y+r-4,19,1);}
  p.disk(x,y,r,15);p.disk(x-1,y-1,r-1,18);p.disk(x,y,r-5,12);
  for(let k=0;k<8;k++){const a=k*Math.PI/4;const q=(d:number,t:number)=>[x+dcos(a+t)*d,y+dsin(a+t)*d];p.poly([...q(r-6,0),...q(r*.42,-.18),...q(r*.50,.18)],k<4?19:16);}
  p.disk(x-1,y-2,r*.34,pulse>.2?34:24);p.line(x-r*.2,y-r*.34,x+r*.15,y-r*.34,34,1);
 }else{
  // A translucent upper vessel seats into a broad asymmetrical ceramic
  // socket. Its moving inner plunger is recessed behind the fixed impact dome.
  const top=y-r-30;
  p.poly([x-r-10,y-1,x-r-13,top+16,x-r+1,top+2,x+r-5,top,x+r+13,top+17,x+r+10,y+5],35);
  p.poly([x-r-8,y-7,x-r-9,top+18,x-r+1,top+6,x+r-6,top+4,x+r+8,top+18,x+r+5,y-5],27);
  p.poly([x-r+1,top+7,x+r-7,top+5,x+r+3,top+14,x+r-2,top+18,x-r+4,top+16,x-r+7,top+27,x-r+5,y-8,x-r+1,y-8],29);
  p.poly([x-r+7,top+21,x+r-6,top+19,x+r-3,y-r*.1,x-r+5,y-r*.1],20);
  p.rect(x-r*.4,top+25+compression,r*.8,8,23);p.line(x-r*.35,top+25+compression,x+r*.3,top+25+compression,24,2);
  // Rounded ceramic float collar; no steel bolts.
  p.line(x-r+2,y+r+3-compression,x+r-2,y+r+3-compression,35,17);p.line(x-r+1,y+r+1-compression,x+r-3,y+r+1-compression,38,11);
  p.disk(x,y,r,25);p.disk(x-1,y-1,r-1,28);p.disk(x,y,r-4,20);p.disk(x-3,y-4,r-7,23);
  p.poly([x-r*.62,y-r*.1,x-r*.32,y-r*.63,x+r*.23,y-r*.72,x+r*.55,y-r*.36,x-r*.02,y-r*.3],29);
  p.disk(x+r*.22,y+r*.28,r*.19,pulse>.2?34:24);p.line(x-r*.43,y-r*.27,x-r*.19,y-r*.49,34,2);
 }
 return{workingBounds:[x+p.offsetX-r,y+p.offsetY-r,x+p.offsetX+r,y+p.offsetY+r],noncontactBounds:[x+p.offsetX-r-18,y+p.offsetY-r-36,x+p.offsetX+r+18,y+p.offsetY+r+20]};
}
export function themedBlade(p:PixelCanvas,theme:PinballArcadeTheme,x:number,y:number,a:number,b:number,r:number){
 artTheme(theme);artSegment(p,[x,y],[a,b],r*2);if(r<=0||r>24)throw Error('Themed blade radius');
 if(theme==='ion-relay'||theme==='synthwave'){nativeBlade(p,x,y,a,b,r);return;}
 const dx=a-x,dy=b-y,d=dhypot(dx,dy);if(d<1)return;const nx=-dy/d,ny=dx/d;
 if(theme==='grove'){p.poly([x-10,y+5,x-8,y-8,x+3,y-11,x+11,y-2,x+8,y+9,x-4,y+11],35);p.poly([x-8,y+2,x-6,y-7,x+2,y-8,x+8,y-2,x+2,y+2],38);}
 else if(theme==='sun-vault'){p.poly([x,y-12,x+11,y-5,x+11,y+6,x,y+12,x-11,y+6,x-11,y-5],16);p.disk(x-1,y-1,7,19);}
 else{p.disk(x+1,y+2,11,35);p.disk(x-1,y-1,10,28);p.disk(x-3,y-3,6,29);}
 const base=theme==='grove'?12:theme==='sun-vault'?17:27;p.line(x,y,a,b,base,r*2);p.line(x+nx*r*.35,y+ny*r*.35,a+nx*r*.35,b+ny*r*.35,base+1,Math.max(1,r));p.line(x-nx*r*.55,y-ny*r*.55,a-nx*r*.55,b-ny*r*.55,34,1);
 if(theme==='grove'){for(const t of[.22,.54,.77]){const xx=x+dx*t,yy=y+dy*t;p.line(xx-nx*r*.3,yy-ny*r*.3,xx+dx*.10+nx*r*.25,yy+dy*.10+ny*r*.25,10,1);}}
 p.disk(x,y,3,theme==='grove'?16:23);p.dot(x-1,y-1,34);
}
export function themedGuide(p:PixelCanvas,theme:PinballArcadeTheme,a:readonly[number,number],b:readonly[number,number],outside:-1|1,radius:number,purpose:'return'|'drain-apron'='return'){
 artTheme(theme);artSegment(p,a,b,4);artArguments(p,radius);if(radius<=0||radius>12||(outside!==-1&&outside!==1))throw Error('Themed guide extent');if(purpose!=='return'&&purpose!=='drain-apron')throw Error('Native guide purpose');const apron=purpose==='drain-apron';
 if(theme==='ion-relay'||theme==='synthwave'){formedGuide(p,a,b,outside,apron?6:12,radius);return;}
 const dx=b[0]-a[0],dy=b[1]-a[1],d=dhypot(dx,dy);if(d<1)return;const nx=outside*Math.abs(dy)/d,ny=-outside*dx/d,depth=apron?6:theme==='grove'?12:14,at=(t:number,n:number):[number,number]=>[a[0]+dx*t+nx*n,a[1]+dy*t+ny*n];
 if(theme==='grove'){
  p.poly([...at(0,0),...at(1,0),...at(1,depth-5),...at(.78,depth+3),...at(.44,depth-3),...at(.1,depth+2),...at(0,depth)],10);
  for(const off of[depth*.3,depth*.7]){const q=at(0,off),r=at(1,off-3);p.line(q[0],q[1],r[0],r[1],off===6?14:12,2);}
  if(!apron)for(const t of[.19,.57]){const q=at(t,depth*.5);p.disk(q[0],q[1],3,11,2);p.dot(q[0]-1,q[1]-1,14);}
 }else if(theme==='sun-vault'){
  p.poly([...at(0,0),...at(1,0),...at(1,depth*.35),...at(.25,depth),...at(0,depth)],11);for(const t of[.16,.53]){const q=at(t,2),r=at(t,depth*(1-t*.5));p.line(q[0],q[1],r[0],r[1],16,3);p.line(q[0]-1,q[1]-1,r[0]-1,r[1]-1,19,1);}
 }else{
  const u=at(.04,depth*.5),v=at(.96,depth*.3);p.line(u[0]+1,u[1]+2,v[0]+1,v[1]+2,35,depth);p.line(u[0],u[1],v[0],v[1],27,depth-2);p.line(u[0]-1,u[1]-1,v[0]-1,v[1]-1,29,3);for(const t of[.2,.8]){const c=at(t,depth*.4);p.disk(c[0],c[1],apron?1:2,23);p.dot(c[0]-1,c[1]-1,34);}
 }
 p.line(a[0],a[1],b[0],b[1],theme==='grove'?18:24,radius*2);p.line(a[0]-1,a[1]-1,b[0]-1,b[1]-1,34,1);
}
export function themedRebound(p:PixelCanvas,theme:PinballArcadeTheme,x:number,y:number,w:number,radius:number,hit:boolean){
 artTheme(theme);artArguments(p,x,y,w,radius);artSegment(p,[x,y],[x+w,y],radius*2);if(typeof hit!=='boolean')throw Error('Native hit state');
 if(![x,y,w,radius].every(Number.isFinite)||w<12||w>512||radius<0||radius>32)throw Error('Pixel rebound geometry');
 // Rear drive and end cheeks belong to this one continuous working bar.
 // Unequal end heights and deep pockets give the contact face a mounting purpose.
 const mass=theme==='grove'?10:theme==='vaporwave'?25:theme==='sun-vault'?15:10;
 p.poly([x-10,y-3,x-12,y-28,x+1,y-45,x+w*.34,y-49,x+w*.48,y-39,x+w+8,y-34,x+w+12,y-7,x+w+3,y-1],mass);
 p.poly([x-9,y-5,x-8,y-26,x+3,y-41,x+w*.31,y-44,x+w*.46,y-35,x+w+5,y-30,x+w+6,y-7],mass+1);
 p.poly([x+3,y-41,x+w*.31,y-44,x+w*.46,y-35,x+w*.41,y-31,x+w*.27,y-38,x+5,y-36],mass+3);
 p.poly([x+7,y-31,x+w*.38,y-31,x+w*.48,y-24,x+w-8,y-24,x+w-8,y-8,x+7,y-8],2);
 if(theme==='grove'){for(const t of[.18,.73]){const xx=x+w*t;p.line(xx-2,y-34,xx+4,y-15,12,5);p.line(xx-3,y-34,xx+2,y-16,14,1);}}
 else if(theme==='vaporwave'){p.line(x+6,y-31,x+w*.32,y-35,29,4);p.line(x+8,y-26,x+w*.3,y-29,23,3);}
 else{for(const t of[.16,.76]){const xx=x+w*t;p.rect(xx-3,y-33,6,22,35);p.rect(xx-2,y-33,2,22,39);for(let k=0;k<3;k++)p.line(xx-5,y-28+k*5+(hit?2:0),xx+5,y-28+k*5+(hit?2:0),theme==='sun-vault'?18:16,2);}}
 if(theme==='grove'){
  p.poly([x-4,y-3,x-2,y-20,x+13,y-30,x+w-14,y-26,x+w+3,y-16,x+w+3,y-3],10);
  p.poly([x+3,y-5,x+7,y-18,x+16,y-23,x+w-15,y-20,x+w-4,y-13,x+w-4,y-5],12);
  p.line(x+11,y-11,x+w-12,y-14,10,2);p.line(x+18,y-19,x+w-22,y-17,14,1);
  for(const t of[.18,.75]){const xx=x+w*t;p.poly([xx,y-22,xx-8,y-34,xx+7,y-29,xx+14,y-35,xx+9,y-20],22);}
 }else if(theme==='sun-vault'){
  p.poly([x-5,y-3,x-5,y-23,x+9,y-35,x+w-9,y-35,x+w+5,y-23,x+w+5,y-3],11);p.poly([x+4,y-6,x+4,y-20,x+14,y-29,x+w-14,y-29,x+w-4,y-20,x+w-4,y-6],5);
  for(let k=0;k<4;k++){const xx=x+(k+.5)*w/4;p.rect(xx-5,y-27,10,17,16);p.line(xx-4,y-27,xx-4,y-11,19,1);}p.line(x+12,y-32,x+w-12,y-32,19,2);
 }else if(theme==='vaporwave'){
  p.line(x+9,y-13,x+w-9,y-13,35,27);p.line(x+9,y-15,x+w-9,y-15,28,23);p.line(x+12,y-21,x+w-12,y-21,29,3);p.line(x+15,y-10,x+w-15,y-10,23,4);
 }else{
  p.poly([x-3,y-3,x-3,y-24,x+8,y-34,x+w-10,y-34,x+w+3,y-22,x+w+3,y-3],10);p.poly([x+3,y-5,x+3,y-20,x+11,y-28,x+w-13,y-28,x+w-3,y-20,x+w-3,y-5],2);
  p.beam(x+9,y-21,x+w-12,y-21,35,5);p.beam(x+10,y-12,x+w-11,y-12,15,4);for(const t of[.13,.5,.87]){const xx=x+w*t;p.rect(xx-4,y-23,8,13,7);p.rect(xx-3,y-23,2,12,13);p.bolt(xx,y-9,2);}
 }
 p.line(x,y,x+w,y,hit?34:18,radius*2);p.line(x,y-1,x+w,y-1,hit?34:19,1);
 return{workingBounds:[x+p.offsetX-radius,y+p.offsetY-radius,x+p.offsetX+w+radius,y+p.offsetY+radius],noncontactBounds:[x+p.offsetX-Math.max(16,radius+1),y+p.offsetY-52,x+p.offsetX+w+Math.max(16,radius+1),y+p.offsetY+Math.max(5,radius+1)]};
}
export function themedCapture(p:PixelCanvas,theme:PinballArcadeTheme,x:number,y:number,halfWidth:number,phase:string|null,progress:number){
 artTheme(theme);artArguments(p,x,y,halfWidth,progress);if(phase!==null&&!['captured','transit','exit-blocked'].includes(phase))throw Error('Native transport phase');
 if(!Number.isFinite(halfWidth)||halfWidth<8||halfWidth>128||!Number.isFinite(progress)||progress<0||progress>1)throw Error('Pixel capture extent');const r=halfWidth;
 const base=theme==='grove'?10:theme==='sun-vault'?15:theme==='vaporwave'?25:35;
 // The approach remains open downfield. No decorative crossbar obstructs the
 // real entry mouth; the lintel lies behind the native capture plane.
 if(theme==='grove'){for(const side of[-1,1]){p.line(x+side*r,y+5,x+side*(r+3),y-10,base,7);p.line(x+side*(r+3),y-10,x+side*(r-5),y-20,base+2,6);}p.line(x-r+5,y-20,x+r-5,y-20,13,5);}
 else if(theme==='vaporwave'){p.line(x-r-3,y+4,x-r-3,y-15,28,10);p.line(x+r+3,y+4,x+r+3,y-15,28,10);p.line(x-r-3,y-15,x+r+3,y-15,29,10);}
 else{p.rect(x-r-7,y-15,7,23,base+1);p.rect(x+r,y-15,7,23,base+1);p.rect(x-r-7,y-22,r*2+14,9,base+2);p.line(x-r-5,y-21,x+r+5,y-21,base+4,2);}
 p.rect(x-r+3,y-18,r*2-6,3,phase?24:21);if(phase)p.rect(x-r+3,y-18,(r*2-6)*progress,3,34);
}
