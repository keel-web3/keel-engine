import { createRoll, deriveSeed, type RoleLook } from '@keel-engine/core';
import type { SlotDecal } from '@keel-engine/bake';
import type { PinballFrameTheme } from './framing.ts';

export const PINBALL_CABINET_PRINT_REVISION = 'pinball-cabinet-print/2026-10-07.1';
export interface PinballCabinetPrintOptions {
  readonly seed: string;
  readonly theme: PinballFrameTheme;
  readonly size: 16 | 32 | 64 | 128 | 256 | 512;
  readonly ground: RoleLook;
}
export interface PinballCabinetPrintJob {
  readonly yieldControl?:()=>Promise<void>;
  readonly signal?:AbortSignal;
  /** Cosmetic work granularity only; never changes the generated texels. */
  readonly maxRowsPerChunk?:number;
}
export interface PinballCabinetPrintGenome {
  readonly revision: typeof PINBALL_CABINET_PRINT_REVISION;
  readonly theme: PinballFrameTheme;
  readonly variant: number;
  readonly panelWidth: number;
  readonly period: number;
  readonly phase: number;
  readonly slope: number;
  readonly branches: readonly { readonly y: number; readonly reach: number; readonly bend: number }[];
}
const THEMES = ['cyber', 'vapor', 'gold', 'nature', 'crypto', 'nightshift'] as const;
const BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5] as const;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const distance = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx=bx-ax,dy=by-ay,t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1),0,1);
  return Math.hypot(x-ax-t*dx,y-ay-t*dy);
};
const grain = (x: number, y: number, salt: number) => {
  let n=(Math.imul(x,0x1f123bb5)^Math.imul(y,0x5f356495)^salt)>>>0;
  n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/0x100000000;
};

/** The same cabinet composition at every detail tier. The seed varies the
 * illustration's structure rather than placing unrelated objects on a table. */
export function planPinballCabinetPrint(seed: string, theme: PinballFrameTheme): PinballCabinetPrintGenome {
  if(typeof seed!=='string'||!seed.length||seed.length>1024||!THEMES.includes(theme))throw new RangeError('Invalid pinball cabinet print identity');
  const roll=createRoll(deriveSeed(seed,`${PINBALL_CABINET_PRINT_REVISION}:${theme}`));
  const branches=Array.from({length:6},(_,i)=>Object.freeze({y:26+i*29+roll.index(12+i*3,11),reach:18+roll.index(13+i*3,28),bend:roll.index(14+i*3,21)-10}));
  return Object.freeze({revision:PINBALL_CABINET_PRINT_REVISION,theme,variant:roll.index(0,16),panelWidth:24+roll.index(1,13),period:20+roll.index(2,13),phase:roll.index(3,32),slope:.25+roll.index(4,100)/200,branches:Object.freeze(branches)});
}

/** Printed enamel/pixel illustration on the actual native playfield. Four
 * bounded KEEL ink ramps receive real light and shadow; it is not an overlay,
 * a target, a collider, or a substitute playfield. The center stays quieter
 * than the perimeter and moving ball. Resampling changes detail, not layout. */
function* buildCabinetPrint(options: PinballCabinetPrintOptions,rowsPerChunk=16):Generator<void,SlotDecal,void> {
  const size=options.size;
  if(![16,32,64,128,256,512].includes(size))throw new RangeError('Pinball cabinet print size must be a bounded power of two');
  const g=planPinballCabinetPrint(options.seed,options.theme),ground=options.ground;
  if(!ground||![ground.hue,ground.chroma,ground.light,ground.span].every(Number.isFinite))throw new RangeError('Cabinet print requires a finite ground look');
  const tint=options.theme==='nature'?143:options.theme==='gold'?83:options.theme==='vapor'?330:options.theme==='cyber'?192:options.theme==='crypto'?172:45;
  const look=(hue:number,chroma:number,light:number):RoleLook=>({hue:(hue+360)%360,chroma:clamp(chroma,0,.18),light:clamp(light,.12,.56),span:.16,finish:'matte',pattern:{kind:'none',freq:1,angle:0,width:1,shift:0,ink:null}});
  const inks=[look(ground.hue,ground.chroma*.85,ground.light-.025),look(ground.hue,ground.chroma*.72,ground.light-.105),look(ground.hue,ground.chroma*.90,ground.light+.065),look(tint,.12,ground.light+.125)];
  // Build one canonical 512-square illustration. Coarse tiers vote its inks
  // and average tones instead of rerolling motifs or losing thin edge detail.
  const side=512,master=new Uint8Array(side*side*4),salt=g.variant*91771+g.phase*47737;
  for(let py=0;py<side;py++){for(let px=0;px<side;px++){
    const x=(px+.5)/2,y=(py+.5)/2,sx=Math.min(x,256-x),sy=Math.min(y,256-y),edge=Math.min(sx,sy),v=(y+g.phase)/g.period;
    let ink=1,tone=128;
    // Coat variation and shallow edge recess, not a frame painted in neon.
    const light=.24*Math.sin(y/79+g.phase*.05)+.18*Math.cos(x/61)-Math.max(0,9-edge)*.14;
    tone+=light*16+(grain(px,py,salt)-.5)*4;
    if(edge<3.5){ink=2;tone+=8;}else if(edge<4.3){ink=3;tone+=4;}
    const shoulder=sx<g.panelWidth, lower=y>200;
    if(g.theme==='cyber'){
      const panel=shoulder&&y>12&&y<238;
      if(panel){ink=2;if(sx>g.panelWidth-2)ink=3;}
      for(const b of g.branches){
        const elbow=g.panelWidth+b.reach*.35,by=b.y+b.bend;
        const d=Math.min(distance(sx,y,9,b.y,elbow,b.y),distance(sx,y,elbow,b.y,elbow+b.reach*.38,by),distance(sx,y,elbow+b.reach*.38,by,elbow+b.reach*.60,by));
        if(d<.55){ink=4;tone-=8;}else if(d<1.1){ink=3;tone-=5;}
        if(sx<g.panelWidth-7&&y>b.y+5&&y<b.y+10&&Math.floor((sx+g.phase)/3)%2===0)ink=3;
      }
      // A recessed sweeping motif remains low contrast across the open fan.
      const wave=44+Math.sin(y/53+g.phase*.12)*12;
      if(sx>wave&&sx<wave+2&&y<196){ink=2;tone+=12;}
    }else if(g.theme==='vapor'){
      const coast=24+Math.sin(y/37+g.phase*.08)*9+(y/256)*12;
      if(sx<coast){ink=2;if(sx>coast-2.4)ink=4;}
      if(sx<coast+18&&Math.abs(Math.sin((y+sx*g.slope+g.phase)/11))<.09){ink=3;tone+=2;}
      if(y<190&&sx>coast+8&&sx<coast+37){const ridge=20+Math.floor(y/47)*47+sx*g.slope;if(Math.abs(y-ridge)<1.1){ink=3;tone-=7;}}
      const horizon=188+Math.sin(x/45+g.phase*.05)*8;
      if(y>horizon&&y<horizon+1.25){ink=2;tone+=10;}
    }else if(g.theme==='gold'){
      if(shoulder){ink=2;if(sx>g.panelWidth-3||Math.abs((sx-6)%7)<.7)ink=3;}
      const diagonal=16+sx*g.slope;
      if(y<100&&Math.abs((y-diagonal+g.phase)%g.period)<1){ink=4;tone-=6;}
      if(y>184&&y<228&&sx<60&&distance(sx,y,8,230,60,190)<.8)ink=4;
      if(y>228&&y<230&&sx>8&&sx<80)ink=3;
    }else if(g.theme==='nature'){
      const root=16+Math.sin(y/33+g.phase*.05)*6+Math.sin(y/79)*5;
      if(Math.abs(sx-root)<2.1){ink=2;tone+=4;}else if(Math.abs(sx-root)<3.5){ink=3;tone-=5;}
      for(const b of g.branches){
        const cx=20+b.reach*.60,cy=b.y+b.bend,dx=sx-cx,dy=y-cy,rx=dx*.78+dy*.62,ry=-dx*.62+dy*.78;
        const leaf=(rx/(b.reach*.4))**2+(ry/4.5)**2;
        if(leaf<1&&sx<80){ink=leaf>.72?2:3;tone-=leaf*4;if(Math.abs(ry)<.45)ink=4;}
        if(distance(sx,y,root,b.y,cx,cy)<.65&&sx<75)ink=2;
      }
      if(sx<32&&grain(Math.floor(x/5),Math.floor(y/5),salt)>.84){ink=2;tone+=6;}
    }else if(g.theme==='crypto'){
      const cell=Math.floor(v),yy=(y+g.phase)%g.period,cx=g.panelWidth+((cell+g.variant)%3)*5,hex=Math.abs(sx-cx)+Math.abs(yy-g.period/2)*.58;
      if(sx<g.panelWidth+18){ink=2;if(Math.abs(hex-g.period*.31)<.7)ink=3;}
      if(sx>7&&sx<g.panelWidth+12&&yy>g.period-3&&yy<g.period-2)ink=4;
      if(sx<g.panelWidth-5&&Math.floor(sx/3)%3===0&&yy>3&&yy<8)ink=3;
    }else{
      if(shoulder){ink=2;const hatch=((y+sx*g.slope+g.phase)%g.period);if(hatch>2&&hatch<5)ink=3;}
      if(sx>g.panelWidth-1&&sx<g.panelWidth+1)ink=4;
      if(sx<g.panelWidth-6&&y>20&&y<232&&Math.floor((y+g.phase)/4)%3===0){ink=2;tone-=9;}
    }
    // Stroke bed gets subtle print grain only: no misleading arrows, rings,
    // enemy silhouettes or bright marks immediately ahead of the blades.
    if(lower&&sx>64){ink=1;tone=128+light*8+(grain(px,py,salt)-.5)*2;}
    const at=(py*side+px)*4;master[at]=ink;master[at+1]=clamp(Math.round(tone),96,160);master[at+2]=230;master[at+3]=255;
  }if((py+1)%rowsPerChunk===0)yield;}
  const texels=new Uint8Array(size*size*4),factor=side/size;
  for(let y=0;y<size;y++){for(let x=0;x<size;x++){
    const counts=[0,0,0,0,0],tones=[0,0,0,0,0];
    for(let yy=0;yy<factor;yy++)for(let xx=0;xx<factor;xx++){const at=((y*factor+yy)*side+x*factor+xx)*4,ink=master[at]!;counts[ink]!++;tones[ink]!+=master[at+1]!;}
    const count=factor*factor,dominant=counts.slice(1).reduce((best,n,i)=>n>counts[best]!?i+1:best,1);
    // Preserve sparse engraving with deterministic area dither at coarse LOD.
    const threshold=(BAYER[(y%4)*4+x%4]!+.5)/16;let ink=dominant;
    for(const mark of [4,3,2])if(counts[mark]!/count>threshold){ink=mark;break;}
    const at=(y*size+x)*4;texels[at]=ink;texels[at+1]=Math.round(tones[ink]!/counts[ink]!);texels[at+2]=230;texels[at+3]=255;
  }if((y+1)%rowsPerChunk===0)yield;}
  return {decal:{width:size,height:size,texels},rect:[0,0,1,1],inks};
}

export function createPinballCabinetPrint(options:PinballCabinetPrintOptions):SlotDecal {
 const generator=buildCabinetPrint(options);let step=generator.next();while(!step.done)step=generator.next();return step.value;
}

/** Cooperative initialization/rebuild with exactly the synchronous bytes.
 * The host can keep its current renderer alive while warming the next atlas,
 * then switch resources atomically. Cancellation discards only this job.
 * A scheduling point is bounded work, not a certified device time slice. */
export async function createPinballCabinetPrintAsync(options:PinballCabinetPrintOptions,job:PinballCabinetPrintJob={}):Promise<SlotDecal> {
 const rows=job.maxRowsPerChunk??4;
 if(!Number.isInteger(rows)||rows<1||rows>16)throw new RangeError('Cabinet print chunk must contain1–16 rows');
 const generator=buildCabinetPrint(options,rows),schedule=job.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0))),signal=job.signal;
 try{
  while(true){if(signal?.aborted)throw new DOMException('Cabinet print cancelled','AbortError');const step=generator.next();if(step.done)return step.value;await schedule();}
 }finally{generator.return(undefined as never);}
}
