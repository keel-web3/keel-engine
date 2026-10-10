import {createRoll, deriveSeed, rampColours, dsin, dcos, dhypot, type RoleLook} from '@keel-engine/core';
import type {ArenaBallFrame, ArenaSurface, ArenaField} from '@keel-engine/pinball-arena';
import type {PixelCanvas} from './pixel-canvas.ts';
import {nativeRectangleBounds} from './validation.ts';

export type PinballArcadeTheme = 'ion-relay' | 'grove' | 'sun-vault' | 'vaporwave' | 'synthwave';
type Point = readonly [number, number];
const densePoint=(q:unknown):q is Point=>Array.isArray(q)&&q.length===2&&[0,1].every(i=>Object.hasOwn(q,i)&&Number.isFinite(q[i])&&Math.abs(q[i])<=100000);
type Ramp = readonly [number, number, number, number];
const themes: Record<PinballArcadeTheme, readonly Ramp[]> = {
  'ion-relay': [[266,.09,.17,.12],[292,.11,.34,.18],[192,.14,.51,.34],[35,.17,.65,.33],[187,.17,.68,.33],[330,.21,.63,.31],[75,.05,.86,.22],[235,.04,.63,.30]],
  grove: [[172,.07,.21,.12],[155,.09,.37,.16],[45,.09,.54,.32],[60,.15,.68,.30],[157,.12,.67,.32],[23,.15,.64,.30],[85,.05,.86,.22],[50,.04,.62,.30]],
  'sun-vault': [[300,.06,.21,.12],[24,.09,.37,.16],[42,.12,.55,.32],[75,.16,.70,.29],[197,.11,.69,.31],[345,.15,.64,.30],[80,.07,.89,.20],[32,.06,.65,.30]],
  vaporwave: [[280,.08,.23,.13],[300,.08,.40,.16],[288,.10,.61,.32],[35,.12,.73,.28],[180,.12,.75,.28],[333,.15,.73,.27],[315,.03,.92,.16],[210,.06,.75,.27]],
  synthwave: [[278,.09,.21,.12],[264,.11,.38,.16],[286,.13,.52,.33],[41,.19,.66,.32],[189,.16,.68,.32],[335,.23,.65,.31],[72,.04,.89,.20],[248,.06,.65,.30]],
};

/** Shared material roles: deep void, recessed art, shell, warm face, light,
 * accent, ball highlight, support metal. Theme identity is more than a LUT:
 * each theme below uses a separate authored environment grammar. */
export function pinballArcadeThemePalette(theme: PinballArcadeTheme): readonly (readonly [number,number,number])[] {
  const roles=themes[theme];
  if(!roles)throw Error('Unknown arcade pixel theme');
  return Object.freeze(roles.flatMap(([hue,chroma,light,span])=>{
    const role:RoleLook={hue,chroma,light,span,finish:'matte',pattern:{kind:'none',freq:1,angle:0,width:1,shift:0,ink:null}};
    return rampColours(role,5).map(c=>Object.freeze([...c] as [number,number,number]));
  }));
}

export interface PinballThemeBackdropRequest {
  readonly theme: PinballArcadeTheme;
  readonly seed: string;
  readonly arenaId: string;
  readonly field: ArenaField;
  readonly bed: ArenaSurface;
  readonly tick: number;
  readonly project: (x:number,y:number,z:number)=>Point;
  readonly balls: readonly ArenaBallFrame[];
  readonly reducedMotion?: boolean;
}

/** Indexed, source-bound art below a continuous native play surface.
 * It creates neither collisions nor imaginary routes. Physical mechanisms,
 * native ball and flippers must be drawn after this underglass layer. */
export function drawPinballThemeBackdrop(p:PixelCanvas,r:PinballThemeBackdropRequest) {
  if(!Object.hasOwn(themes,r.theme)||typeof r.seed!=='string'||typeof r.arenaId!=='string'||typeof r.project!=='function'||!Array.isArray(r.balls)||r.balls.length>128||(r.reducedMotion!==undefined&&typeof r.reducedMotion!=='boolean'))throw Error('Invalid arcade pixel theme request');
  if(r.field.id!==r.arenaId||!r.field.surfaces.includes(r.bed))throw Error('Exact native field and bed required');
  if(r.bed.kind!=='playfield'||r.bed.polygon.length!==4||!Number.isSafeInteger(r.tick)||r.tick<0)throw Error('Native rectangular pixel bed and tick required');
  const [x0,y0,x1,y1]=nativeRectangleBounds(r.bed.polygon);
  if(!Number.isFinite(r.bed.height)||Math.abs(r.bed.height)>1e6)throw Error('Invalid native rectangular bed');
  const corners=r.bed.polygon.map(q=>r.project(q.x,q.y,r.bed.height));
  if(corners.some(q=>!densePoint(q)))throw Error('Nonfinite pixel projection');
  const a=corners.map(q=>q[0]),b=corners.map(q=>q[1]),x=Math.round(Math.min(...a))+3,y=Math.round(Math.min(...b))+3,w=Math.round(Math.max(...a))-x-3,h=Math.round(Math.max(...b))-y-3;
  if(w<96||h<160||w>1024||h>1024)throw Error('Pixel room extent outside theme budget');
  const bodyPoints=r.balls.filter(q=>q.arenaId===r.arenaId&&!q.eliminated&&q.transport===null&&q.layer===r.bed.layer&&Math.abs(q.elevation-r.bed.height)<1&&q.x>=x0&&q.x<=x1&&q.y>=y0&&q.y<=y1).map(q=>r.project(q.x,q.y,q.elevation));
  if(bodyPoints.some(q=>!densePoint(q)))throw Error('Nonfinite pixel body projection');
  if(!Array.isArray(r.field.rails)||r.field.rails.length>2048)throw Error('Native pixel rail budget');
  const nativeTargets=r.field.rails.filter(q=>q.kind==='target'&&q.layer===r.bed.layer&&q.elevation===r.bed.height&&q.ax>=x0&&q.ax<=x1&&q.bx>=x0&&q.bx<=x1&&q.ay>=y0&&q.ay<=y1&&q.by>=y0&&q.by<=y1);
  const targetPoints=nativeTargets.flatMap(q=>[r.project(q.ax,q.ay,q.elevation),r.project(q.bx,q.by,q.elevationB??q.elevation)]);
  if(targetPoints.some(q=>!densePoint(q)))throw Error('Nonfinite native target projection');
  const oldClip=p.clip;
  p.clip=[Math.max(x,oldClip?.[0]??x),Math.max(y,oldClip?.[1]??y),Math.min(x+w-1,oldClip?.[2]??x+w-1),Math.min(y+h-1,oldClip?.[3]??y+h-1)];
  try {
    const roll=createRoll(deriveSeed(r.seed,r.bed.id+'/arcade-environment/'+r.theme)),variant=roll.index(0,3),side=roll.index(1,2)===0?-1:1;
    const tick=r.reducedMotion?0:r.tick,balls=bodyPoints;
    const influence=(px:number,py:number)=>balls.reduce((n,q)=>Math.max(n,Math.max(0,1-dhypot(q[0]-px,q[1]-py)/43)),0);
    p.rect(x,y,w,h,2);
    if(r.theme==='grove')garden(p,x,y,w,h,side,variant,tick,influence);
    else if(r.theme==='sun-vault')vault(p,x,y,w,h,side,variant,tick);
    else if(r.theme==='vaporwave')atrium(p,x,y,w,h,side,variant,tick,influence);
    else foundry(p,x,y,w,h,side,variant,tick,r.theme==='synthwave');
    // The focal architecture is centered on actual working targets, not a
    // fixed screen coordinate or a decorative invented bumper.
    if(targetPoints.length){const cx=targetPoints.reduce((n,q)=>n+q[0],0)/targetPoints.length,cy=targetPoints.reduce((n,q)=>n+q[1],0)/targetPoints.length;
      focalBank(p,r.theme,cx,cy,Math.min(w*.53,175),Math.min(h*.25,120),variant,tick);
    }
    // Sparse clustered glints read as reflections without an opaque tilted
    // rectangle floating over the room. The material remains one ball plane.
    p.line(x+w*.40,y+h*.11,x+w*.47,y+h*.10,4,1);
    p.line(x+w*.405,y+h*.115,x+w*.44,y+h*.11,3,1);
    // The recessed scene ends at a material rim; no foreground foliage covers
    // the ball and no stripe masquerades as a rail through its shot fan.
    p.line(x,y,x+w-1,y,8,2);p.line(x,y,x,y+h-1,7,2);
    p.line(x+w-1,y,x+w-1,y+h-1,0,2);p.line(x,y+h-1,x+w-1,y+h-1,0,2);
    return {theme:r.theme,bedId:r.bed.id,variant,side,kind:'noncontact-underglass-art' as const};
  } finally {p.clip=oldClip;}
}

function focalBank(p:PixelCanvas,theme:PinballArcadeTheme,cx:number,cy:number,w:number,h:number,variant:number,tick:number) {
  const x=cx-w*.5,y=cy-h*.77;
  if(theme==='grove'){
    // Split rooted trunk encloses the actual relay court. Its open central
    // recess and broad shaded side masses direct attention to the working face.
    p.poly([x+5,y+h-6,x+2,y+h*.4,x+18,y+8,cx-11,y,x+w-16,y+10,x+w-1,y+h*.38,x+w-7,y+h,x+w-29,y+h*.9,x+w-30,y+h*.4,cx+14,y+22,cx-17,y+17,x+26,y+h*.44,x+27,y+h*.91],5);
    p.line(x+6,y+h*.47,x+20,y+14,8,5);p.line(x+20,y+14,cx-8,y+5,8,4);p.line(cx+7,y+8,x+w-19,y+14,7,5);
    for(const side of[-1,1]){const xx=cx+side*w*.41;for(let k=0;k<3;k++){const yy=y+h*(.32+k*.16);p.line(xx-side*3,yy,xx-side*8,yy+h*.11,7,3);p.line(xx,yy+3,xx-side*4,yy+h*.11,4,2);}}
    for(let k=0;k<8;k++){const xx=x+14+k*(w-28)/7,yy=y+6+dsin(k*.7)*5,rad=5+(k%3);p.disk(xx,yy,rad,6,rad*.75);leaf(p,xx-3,yy+1,8,-6,7);p.line(xx-2,yy-3,xx+1,yy-3,9,2);}
    p.line(x+27,y+h-5,x+w-29,y+h-4,6,4);
  }else if(theme==='sun-vault'){
    p.poly([x,y+h,x,y+24,x+25,y+3,x+w-25,y+3,x+w,y+24,x+w,y+h,x+w-20,y+h,x+w-20,y+32,x+w-31,y+21,x+31,y+21,x+20,y+32,x+20,y+h],5);
    p.line(x+4,y+24,x+25,y+7,9,4);p.line(x+25,y+7,x+w-25,y+7,8,4);p.line(x+w-25,y+7,x+w-4,y+24,7,4);
    for(const xx of[x+4,x+w-17]){p.rect(xx,y+30,13,h-31,7);p.line(xx+1,y+31,xx+1,y+h-5,9,2);p.line(xx+10,y+31,xx+10,y+h-5,5,2);}
    for(let k=0;k<5;k++){const xx=x+29+k*(w-58)/4;p.poly([xx,y+12,xx+4,y+16,xx,y+20,xx-4,y+16],7);p.dot(xx,y+13,9);}
  }else if(theme==='vaporwave'){
    // Rounded ceramic portal has a broad facing surface and a colored cast
    // shadow, with recessed piers behind the native pastel working mechanisms.
    p.line(x+14,y+h-4,x+14,y+26,5,25);p.line(x+w-14,y+h-4,x+w-14,y+26,5,25);p.line(x+14,y+26,x+w-14,y+26,5,28);
    p.line(x+12,y+h-8,x+12,y+24,8,18);p.line(x+w-16,y+h-8,x+w-16,y+24,7,18);p.line(x+14,y+23,x+w-17,y+23,8,21);
    p.line(x+9,y+h-10,x+9,y+23,9,2);p.line(x+17,y+15,x+w-22,y+15,9,2);
    p.line(x+18,y+32,x+w-20,y+32,4,5);p.line(x+23,y+h,x+w-24,y+h,6,6);
    const xx=cx+(variant-1)*10;p.rect(xx-8,y+19,16,4,((tick>>5)&1)?9:7);
  }else{
    // Cast reactor cradle: layered cheeks, recessed piston banks, stepped
    // shoulders and a lintel connect into one recognizable native goal frame.
    p.poly([x+3,y+h,x,y+29,x+18,y+8,x+39,y,x+w-39,y,x+w-17,y+10,x+w,y+29,x+w-3,y+h,x+w-26,y+h,x+w-31,y+38,x+w-42,y+28,x+40,y+28,x+28,y+39,x+26,y+h],5);
    p.poly([x+4,y+29,x+20,y+11,x+39,y+4,x+w-39,y+4,x+w-20,y+14,x+w-4,y+31,x+w-9,y+39,x+w-25,y+27,x+27,y+25,x+10,y+40],8);
    p.line(x+21,y+10,x+40,y+3,9,2);p.line(x+40,y+3,x+w-41,y+3,9,2);p.line(x+4,y+35,x+8,y+h-4,8,3);
    for(const xx of[x+7,x+w-23]){motor(p,xx,y+40,16,h-43);}
    for(const xx of[x+20,x+w-20]){p.disk(xx,y+21,5,5);p.disk(xx-1,y+20,3,8);p.dot(xx-2,y+19,9);}
    p.line(x+28,y+h-3,x+w-28,y+h-3,6,5);p.line(x+31,y+h-4,x+w-33,y+h-4,8,2);
  }
}

// Component silhouettes use clusters rather than isolated randomly scattered
// props. They form contiguous service banks and low-contrast room interiors.
function housing(p:PixelCanvas,x:number,y:number,w:number,h:number) {
  p.poly([x+7,y+5,x+w-3,y+5,x+w+4,y+14,x+w+1,y+h,x+w-6,y+h+5,x+8,y+h+5,x+4,y+h-5,x+4,y+13],0);
  p.poly([x+6,y,x+w-7,y,x+w,y+9,x+w-3,y+h-6,x+w-10,y+h,x+5,y+h,x,y+h-9,x,y+8],5);
  p.poly([x+7,y+3,x+w-9,y+3,x+w-3,y+11,x+w-6,y+h-8,x+7,y+h-5,x+3,y+h-12,x+3,y+9],8);
  p.poly([x+8,y+7,x+w-10,y+7,x+w-7,y+13,x+w-8,y+h-11,x+9,y+h-9,x+6,y+h-13,x+6,y+11],6);
  p.line(x+7,y+1,x+w-8,y+1,9,2);p.line(x+2,y+9,x+3,y+h-12,9,2);p.line(x+w-2,y+10,x+w-5,y+h-7,5,3);
  p.rect(x+9,y+12,Math.max(1,w-19),Math.max(1,h-25),3);
  p.line(x+9,y+12,x+w-11,y+12,1,2);p.line(x+9,y+12,x+9,y+h-15,1,2);
  // Uneven grouped chips on cast corners, rather than white outlines around
  // every silhouette. Their shadow and facing clusters are separate values.
  p.line(x+7,y+5,x+12,y+5,9);p.dot(x+6,y+7,9);
  p.line(x+w-15,y+h-7,x+w-10,y+h-7,7);p.dot(x+w-10,y+h-8,8);
}
function pipe(p:PixelCanvas,points:readonly Point[],radius:number) {
  for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!;
    p.line(a[0]+2,a[1]+3,b[0]+2,b[1]+3,0,radius*2+3);
    p.line(a[0],a[1],b[0],b[1],5,radius*2+1);
    p.line(a[0]-1,a[1]-1,b[0]-1,b[1]-1,8,radius*2-2);
    p.line(a[0]-radius*.3,a[1]-radius*.3,b[0]-radius*.3,b[1]-radius*.3,9,1);
    p.disk(a[0],a[1],radius+2,5);p.disk(a[0]-1,a[1]-1,radius+1,8);p.disk(a[0],a[1],Math.max(1,radius-1),6);
  }
}
function motor(p:PixelCanvas,x:number,y:number,w:number,h:number) {
  if(h<14||w<16)return;
  p.poly([x+5,y,x+w-6,y,x+w,y+8,x+w,y+h-5,x+w-7,y+h,x+5,y+h,x,y+h-9,x,y+6],5);
  p.rect(x+4,y+5,w-8,h-11,6);p.line(x+5,y+1,x+w-6,y+1,9,2);p.line(x+1,y+7,x+1,y+h-10,8,2);
  for(let k=0;k<6;k++){const xx=x+6+k*(w-13)/6;p.line(xx,y+7,xx,y+h-10,8,2);p.line(xx+2,y+8,xx+2,y+h-11,4,2);}
  for(const yy of[y+3,y+h-6]){p.line(x-2,yy,x+w+2,yy,5,4);p.line(x-1,yy-1,x+w+1,yy-1,9,1);}
}
function roundFan(p:PixelCanvas,x:number,y:number,r:number,tick:number) {
  p.disk(x+2,y+3,r+4,0);p.disk(x,y,r+2,5);p.disk(x-1,y-1,r,8);p.disk(x,y,r-3,2);
  for(let k=0;k<6;k++){const a=k*Math.PI/3+tick/210;
    p.poly([x,y,x+dcos(a)*r*.8,y+dsin(a)*r*.8,x+dcos(a+.46)*r*.65,y+dsin(a+.46)*r*.65],6);
    p.line(x+dcos(a)*r*.35,y+dsin(a)*r*.35,x+dcos(a)*r*.73,y+dsin(a)*r*.73,7);
  }
  p.disk(x,y,4,8);p.dot(x-1,y-1,9);
}
function foundry(p:PixelCanvas,x:number,y:number,w:number,h:number,side:number,variant:number,tick:number,synth:boolean) {
  // One recessed machine room. Its dark, broad wall blocks and edge service
  // piers cannot be mistaken for diagonal ball tracks across the shot fan.
  const bayX=x+w*.20,bayW=w*.60,bayY=y+h*.12,bayH=h*.77;
  p.poly([bayX+12,bayY,bayX+bayW-12,bayY,bayX+bayW,bayY+15,bayX+bayW,bayY+bayH-15,bayX+bayW-12,bayY+bayH,bayX+12,bayY+bayH,bayX,bayY+bayH-15,bayX,bayY+15],0);
  p.poly([bayX+14,bayY+5,bayX+bayW-14,bayY+5,bayX+bayW-5,bayY+18,bayX+bayW-5,bayY+bayH-17,bayX+bayW-14,bayY+bayH-5,bayX+14,bayY+bayH-5,bayX+5,bayY+bayH-17,bayX+5,bayY+18],1);
  // Offset wall courses use deliberately shaped chipped clusters. Their
  // shading is material pixel art, confined to the recessed architecture.
  const courseH=Math.max(24,Math.round(h*.09)),courseW=Math.max(30,Math.round(w*.22));
  for(let row=0;row<7;row++){
    const yy=bayY+12+row*courseH;
    for(let col=0;col<3;col++){
      const xx=bayX+8+col*courseW+(row%2?courseW*.25:0),ww=Math.min(courseW-3,bayX+bayW-9-xx);
      if(ww<10||yy+courseH>bayY+bayH-7)continue;
      p.poly([xx+3,yy,xx+ww-4,yy,xx+ww,yy+4,xx+ww,yy+courseH-7,xx+ww-5,yy+courseH-3,xx,yy+courseH-3,xx,yy+5],2);
      p.line(xx+5,yy+1,xx+ww-5,yy+1,3);p.line(xx+1,yy+6,xx+1,yy+courseH-9,3);
      p.rect(xx+ww-12,yy+courseH-8,7,2,1);p.rect(xx+ww-5,yy+courseH-10,2,3,1);
      if((row+col+variant)%3===0){p.line(xx+8,yy+5,xx+12,yy+5,4);p.dot(xx+13,yy+6,4);p.line(xx+7,yy+6,xx+9,yy+6,3);}
    }
  }
  // Deep shadow behind the native lower receiving fan gives the ball and
  // working blades a quiet silhouette. The machinery stays at the room edges.
  p.poly([x+w*.29,y+h*.52,x+w*.71,y+h*.52,x+w*.68,y+h*.86,x+w*.55,y+h*.94,x+w*.45,y+h*.94,x+w*.32,y+h*.86],1);
  const pierW=Math.max(18,w*.105);
  for(const direction of[-1,1]){
    const px=direction<0?x+7:x+w-pierW-7,py=y+h*.08,ph=h*.80;
    p.poly([px+5,py,px+pierW-5,py,px+pierW,py+8,px+pierW,py+ph-7,px+pierW-5,py+ph,px+3,py+ph,px,py+ph-9,px,py+8],5);
    p.poly([px+5,py+4,px+pierW-6,py+4,px+pierW-3,py+10,px+pierW-3,py+ph-10,px+5,py+ph-6,px+3,py+ph-11,px+3,py+10],7);
    p.line(px+5,py+4,px+pierW-6,py+4,8,2);p.line(px+3,py+10,px+3,py+ph-12,8,2);
    for(let k=0;k<4;k++){
      const yy=py+15+k*ph*.21,rh=ph*.14;p.rect(px+7,yy,pierW-14,rh,1);
      p.line(px+8,yy+2,px+pierW-8,yy+2,3);
      for(let j=0;j<3;j++)p.line(px+9,yy+5+j*4,px+pierW-9,yy+5+j*4,2);
      p.rect(px+7,yy+rh-4,3,2,(k+variant)%3===0?((tick>>4)&1?24:22):6);
      p.rect(px+pierW-10,yy+rh-4,3,2,6);
    }
    // Copper conduits hug their service bay instead of crossing gameplay.
    const wireX=direction<0?px+pierW+4:px-5;
    p.line(wireX,py+20,wireX,py+ph-7,5,4);p.line(wireX-1,py+20,wireX-1,py+ph-7,7);
    for(let k=0;k<5;k++)p.rect(wireX-3,py+25+k*ph*.14,6,3,6);
  }
  const fanX=x+w*(side<0?.83:.17),fanY=y+h*(.34+variant*.04),rr=Math.min(18,w*.065);
  roundFan(p,fanX,fanY,rr,tick);p.line(fanX-rr,fanY-rr-5,fanX+rr-2,fanY-rr-5,8);
  if(synth){const sx=x+w*.5,sy=y+h*.13,rad=Math.min(30,w*.13);p.disk(sx,sy,rad,26,rad*.75);for(let k=1;k<5;k++)p.rect(sx-rad,sy-2+k*5,rad*2,2+k*.5,1);}
  else{const yy=y+h*.075;for(let k=0;k<3;k++){const xx=x+w*(.44+k*.055);p.rect(xx,yy,5,2,((tick>>5)+k+variant)%3===0?24:21);p.rect(xx+1,yy-1,3,1,23);}}
}

function leaf(p:PixelCanvas,x:number,y:number,dx:number,dy:number,c:number) {
  p.poly([x,y,x+dx*.45-dy*.19,y+dy*.45+dx*.19,x+dx,y+dy,x+dx*.62+dy*.17,y+dy*.62-dx*.17],c);
  p.line(x,y,x+dx*.83,y+dy*.83,Math.min(9,c+1));
}
function fern(p:PixelCanvas,x:number,y:number,h:number,lean:number,tick:number,react:number) {
  const sway=dsin(tick/100+x*.03)*1.4+react*5,tx=x+lean+sway,ty=y-h;
  p.line(x+1,y+1,tx+1,ty+1,0,3);p.line(x,y,tx,ty,7,2);
  for(let k=1;k<7;k++){const t=k/7,cx=x+(tx-x)*t,cy=y-h*t,reach=(1-t)*h*.49+4;
    leaf(p,cx,cy,-reach,-reach*.45,5+(k%2));leaf(p,cx,cy,reach, -reach*.40,6+(k%2));
  }
}
function garden(p:PixelCanvas,x:number,y:number,w:number,h:number,side:number,variant:number,tick:number,influence:(x:number,y:number)=>number) {
  // Deep roots and timber borders anchor two different planted bays. The
  // plants are visible through the deck, leaving the native ball unobstructed.
  const bx=x+(side<0?5:w*.77),bw=w*.23,by=y+15;
  p.poly([bx+5,by,bx+bw-3,by+10,bx+bw,by+h*.65,bx+9,by+h*.78,bx,by+h*.58],5);
  p.line(bx+5,by+6,bx+10,by+h*.60,8,5);p.line(bx+bw-7,by+17,bx+bw-4,by+h*.66,6,4);
  p.poly([bx+9,by+12,bx+bw*.4,by+16,bx+bw*.53,by+h*.54,bx+bw*.37,by+h*.69,bx+13,by+h*.58],7);
  p.poly([bx+bw*.61,by+24,bx+bw*.85,by+29,bx+bw*.90,by+h*.57,bx+bw*.7,by+h*.66],4);
  for(let k=0;k<12;k++){const xx=bx+8+(k%3)*bw*.22,yy=by+15+Math.floor(k/3)*h*.17;p.line(xx,yy,xx+3,yy+h*.11,7,2);p.line(xx+2,yy+3,xx+5,yy+h*.10,4);}
  // Broad root buttresses and clustered stones make a planted room rather
  // than a few disconnected fern stamps on a dark-green sheet.
  const rootY=y+h*.80;p.poly([x+7,rootY-25,x+w*.24,rootY-10,x+w*.38,rootY+22,x+w*.77,rootY+30,x+w-7,rootY+17,x+w-7,rootY+50,x+w*.70,rootY+59,x+w*.32,rootY+50,x+w*.18,rootY+14,x+7,rootY+5],5);
  p.line(x+9,rootY-24,x+w*.24,rootY-9,8,3);p.line(x+w*.24,rootY-9,x+w*.38,rootY+23,7,4);
  p.line(x+w*.39,rootY+25,x+w*.77,rootY+31,7,4);
  for(let k=0;k<4;k++){const yy=by+28+k*h*.135;pipe(p,[[bx+8,yy],[bx+bw*.58,yy+10],[bx+bw+14,yy+7]],2);}
  // The living canopy is one connected crown with stepped clustered edges and
  // light-facing leaf groups. It grows from the tree bank, not random points.
  const crownX=side<0?x+w*.26:x+w*.73,crownY=y+h*.14;
  p.poly([bx+bw*.5,by+20,crownX-w*.07,crownY-7,crownX+w*.12,crownY+6,crownX+w*.14,crownY+h*.08,crownX-w*.12,crownY+h*.10,bx+bw*.34,by+53],5);
  for(let k=0;k<9;k++){const u=k/8,xx=crownX+(u-.5)*w*.39,yy=crownY+(k%3)*6+dsin(u*3.1)*h*.02,rad=8+(k%3)*3;
    p.disk(xx+1,yy+3,rad,1,rad*.78);p.disk(xx,yy,rad,6,rad*.78);
    p.poly([xx-rad*.65,yy,xx-rad*.3,yy-rad*.65,xx+rad*.42,yy-rad*.61,xx+rad*.65,yy-rad*.13,xx-rad*.1,yy+rad*.2],7);
    p.line(xx-rad*.3,yy-rad*.49,xx+rad*.18,yy-rad*.49,9,2);
  }
  const cx=x+w*(side<0?.58:.35),cy=y+h*.30;
  p.disk(cx,cy,w*.19,1,h*.11);p.disk(cx-2,cy-2,w*.18,3,h*.10);
  p.poly([cx-w*.11,cy+9,cx-w*.04,cy-4,cx+w*.12,cy-2,cx+w*.15,cy+12,cx+w*.06,cy+19,cx-w*.09,cy+17],6);
  p.poly([cx-w*.09,cy+8,cx-w*.04,cy+1,cx+w*.09,cy+1,cx+w*.10,cy+6,cx+w*.04,cy+10],8);
  for(let k=0;k<7;k++){const xx=cx-w*.14+k*w*.047,yy=cy+14+(k%3)*5,rr=5+(k%2)*2;p.disk(xx+1,yy+2,rr,0,rr*.7);p.disk(xx,yy,rr,6,rr*.7);p.line(xx-rr*.4,yy-rr*.5,xx+1,yy-rr*.5,8,2);}
  // Two rooted living banks, with shaded limestone faces and a connected
  // moss edge. Their quiet center remains open beneath the receiving fan.
  for(const direction of[-1,1]){
    const xx=x+w*(direction<0?.07:.83),yy=y+h*.54,rw=w*.11,rh=h*.29;
    p.poly([xx+4,yy,xx+rw-4,yy+8,xx+rw,yy+rh*.65,xx+rw-6,yy+rh,xx-3,yy+rh+6,xx,yy+rh*.55,xx-5,yy+9],1);
    p.poly([xx+4,yy+3,xx+rw-6,yy+9,xx+rw-3,yy+rh*.65,xx+rw-8,yy+rh-3,xx+1,yy+rh,xx+3,yy+rh*.52,xx-1,yy+10],5);
    p.poly([xx+5,yy+6,xx+rw-8,yy+12,xx+rw-8,yy+rh*.57,xx+rw-13,yy+rh*.68,xx+5,yy+rh*.63],7);
    p.line(xx+5,yy+5,xx+rw-8,yy+11,8,2);
    // Chipped facing clusters, broken shadow seams and a few lit moss caps.
    for(let k=0;k<4;k++){
      const sy=yy+13+k*rh*.18;p.line(xx+4,sy,xx+rw-7,sy+3,4,2);
      p.rect(xx+5,sy-3,6,2,8);p.dot(xx+12,sy-2,8);p.rect(xx+rw-11,sy+4,4,2,6);
    }
    const baseX=xx+rw*.5,baseY=yy+rh,fh=Math.min(57,h*(.105+.01*variant));
    fern(p,baseX,baseY,fh,direction*-9,tick,influence(baseX,baseY-fh*.5));
    fern(p,baseX+direction*8,baseY+3,fh*.58,direction*8,tick,influence(baseX,baseY-fh*.3));
    for(let k=0;k<5;k++){const mx=xx+k*rw/4,my=baseY+(k%2)*2;p.disk(mx,my,4,6,2);leaf(p,mx,my,3,-5,7);}
  }
  // Root lattice follows the room border rather than filling its center with
  // unrelated props. Dark broad shapes build depth; clustered moss caps them.
  pipe(p,[[x+w*.13,y+h*.42],[x+w*.11,y+h*.78],[x+w*.30,y+h*.91],[x+w*.80,y+h*.90]],4);
  for(let k=0;k<6;k++){const xx=x+w*(.25+k*.1),yy=y+h*.9+(k%2)*3;p.disk(xx,yy,6,6,3);p.line(xx-3,yy-2,xx+1,yy-2,8,2);}
  for(let k=0;k<5;k++){const xx=x+w*(.19+k*.15),yy=rootY+20+(k%2)*9;leaf(p,xx,yy,-10,-11,6);leaf(p,xx,yy,9,-8,7);p.disk(xx,yy+1,3,5,2);}
  // A few illuminated spores use a slow deterministic drift, inside a single
  // planted basin. No random scatter across the playing field.
  for(let k=0;k<5;k++){const t=(tick/240+k*.19)%1,xx=cx+dsin(k*2.3+t*3)*w*.105,yy=cy+18-t*h*.15;p.dot(xx,yy,k%2?7:9);}
}

function vault(p:PixelCanvas,x:number,y:number,w:number,h:number,side:number,variant:number,tick:number) {
  const col=Math.max(18,w*.095);
  // Paired carved pilasters support one continuous vault, not loose bricks.
  for(const xx of[x+8,x+w-col-8]){p.poly([xx+3,y+19,xx+col-3,y+19,xx+col,y+31,xx+col-2,y+h*.72,xx+col-7,y+h*.76,xx+3,y+h*.76,xx,y+30],5);p.rect(xx+4,y+32,col-8,h*.63,7);p.line(xx+4,y+31,xx+4,y+h*.66,9,2);for(let k=0;k<4;k++){const yy=y+40+k*h*.14;p.poly([xx+4,yy,xx+col-4,yy+4,xx+col-6,yy+12,xx+5,yy+8],6);p.line(xx+5,yy,xx+col-5,yy+3,8);}}
  const cx=x+w*.5,cy=y+h*.19,rx=w*.27,ry=h*.115;
  p.disk(cx,cy,rx,5,ry);p.disk(cx,cy+5,rx-7,2,ry-6);
  for(let k=0;k<7;k++){const a=Math.PI+k*Math.PI/6,xx=cx+dcos(a)*rx*.86,yy=cy+dsin(a)*ry*.86;p.disk(xx,yy,4,7,5);p.line(xx-2,yy-3,xx+1,yy-3,9);}
  const sx=x+w*(side<0?.38:.63),sy=y+h*.43,size=w*.12;
  p.poly([sx,sy-size,sx+size*.8,sy,sx,sy+size,sx-size*.8,sy],5);
  p.poly([sx,sy-size+4,sx+size*.64,sy,sx,sy+size-5,sx-size*.64,sy],7);
  p.line(sx,sy-size+5,sx,sy+size-6,9);p.line(sx-size*.55,sy,sx+size*.55,sy,8);
  // Distant lit alcoves have recessed bottoms and carved rims, never contact.
  const yy=y+h*.73;for(let k=0;k<3;k++){const xx=x+w*(.27+k*.22);housing(p,xx-13,yy,26,h*.14);p.poly([xx-7,yy+8,xx+7,yy+8,xx+7,yy+h*.10,xx-7,yy+h*.10],1);p.disk(xx,yy+h*.07,4,((tick>>5)+k+variant)%3===0?9:7,6);p.dot(xx-1,yy+h*.07-2,9);}
  p.line(x+w*.21,y+h*.95,x+w*.79,y+h*.95,8,3);p.line(x+w*.25,y+h*.955,x+w*.75,y+h*.955,5,3);
}

function atrium(p:PixelCanvas,x:number,y:number,w:number,h:number,side:number,variant:number,tick:number,influence:(x:number,y:number)=>number) {
  // Pastel terrazzo atrium under a clear deck: curved balcony, glass skylight,
  // planted corners and a sun disk form a whole room, not a palette-swapped pump.
  const cx=x+w*.5,cy=y+h*.17,rx=w*.30;
  p.disk(cx,cy,rx,5,h*.105);p.disk(cx,cy+5,rx-6,1,h*.095);
  p.line(cx-rx+6,cy+4,cx+rx-6,cy+4,8,2);
  for(let k=1;k<5;k++)p.line(cx-rx+k*rx*.4,cy-h*.08,cx-rx+k*rx*.4,cy+h*.085,6,2);
  const sx=x+w*(side<0?.65:.35),sy=y+h*.34,rad=Math.min(32,w*.13);
  p.disk(sx,sy,rad,7,rad*.82);for(let k=1;k<5;k++)p.rect(sx-rad,sy+k*5,rad*2,1+k,3);
  // Two sunken curved wall alcoves. Nothing bridges across the working fan:
  // a broad dark inset distinguishes the room art from real ball mechanisms.
  for(const direction of[-1,1]){
    const ax=x+w*(direction<0?.105:.895),ay=y+h*.57,ar=w*.12;
    p.disk(ax,ay,ar,5,h*.15);p.disk(ax-direction*3,ay-3,ar-4,7,h*.14);
    p.disk(ax-direction*5,ay-2,ar-9,1,h*.125);
    p.line(ax-direction*ar*.5,ay-h*.1,ax-direction*ar*.5,ay+h*.09,6,2);
    p.line(ax-direction*ar*.5-1,ay-h*.1,ax-direction*ar*.5-1,ay+h*.09,8);
    p.rect(ax-6,ay+h*.105,12,3,8);p.rect(ax-4,ay+h*.105,8,1,9);
  }
  // Recessed vertical arcade columns have different facing and shadow planes.
  for(const xx of[x+w*.08,x+w*.84]){p.rect(xx+3,y+h*.38,w*.08,h*.24,1);p.poly([xx,y+h*.35,xx+w*.08,y+h*.35,xx+w*.09,y+h*.59,xx+3,y+h*.61],5);p.line(xx,y+h*.355,xx+2,y+h*.595,9,3);p.line(xx+w*.078,y+h*.36,xx+w*.086,y+h*.58,7,3);p.line(xx+3,y+h*.37,xx+w*.06,y+h*.37,8,2);}
  for(let k=0;k<2;k++){const xx=x+w*(k?.86:.13),yy=y+h*.85;housing(p,xx-14,yy-12,28,27);fern(p,xx,yy-10,Math.min(55,h*.14),(k?1:-1)*(8+variant*2),tick,influence(xx,yy-30));}
  const fx=x+w*(side<0?.21:.79),fy=y+h*.80;
  p.disk(fx,fy,w*.16,5,h*.025);p.disk(fx,fy-3,w*.145,7,h*.021);p.disk(fx,fy-4,w*.1,3,h*.012);
  p.line(fx-2,fy-5,fx-2,fy-21,8,2);p.dot(fx-2,fy-22+Math.round(dsin(tick/32)),9);
}
