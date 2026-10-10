import type{PixelCanvas}from'@keel-engine/pinball-pixel-art';
import type{PinballFeedbackSample}from'@keel-engine/pinball-feedback';
export type PinballRoomLightTheme='ion-relay'|'grove'|'vaporwave';
type RGB=readonly[number,number,number];
export type PinballRoomLightPalette=Readonly<{palette:readonly RGB[]}>;
export type PinballRoomLightRequest=Readonly<{theme:PinballRoomLightTheme;arenaId:string;scale:number;project:(x:number,y:number,z:number)=>readonly[number,number];feedback:PinballFeedbackSample;reducedMotion:boolean}>;
export type PinballRoomEmitter=Readonly<{id:string;x:number;y:number;elevation:number;radius:number;strength:number}>;
export type PinballRoomEmitterRequest=Readonly<{theme:PinballRoomLightTheme;project:(x:number,y:number,z:number)=>readonly[number,number];scale:number;emitters:readonly PinballRoomEmitter[]}>;
type Plan={theme:PinballRoomLightTheme;low:readonly number[];high:readonly number[];base:readonly number[]};
const plans=new WeakMap<PinballRoomLightPalette,Plan>();
const emitters:Record<PinballRoomLightTheme,RGB>={'ion-relay':[101,237,255],grove:[192,255,142],vaporwave:[255,105,205]};
function matchesPalette(actual:readonly(readonly number[])[],expected:readonly RGB[]){
 if(!Array.isArray(actual)||actual.length!==expected.length)return false;
 for(let i=0;i<actual.length;i++){const row=actual[i];if(!Object.hasOwn(actual,i)||!Array.isArray(row)||row.length!==3)return false;for(let k=0;k<3;k++)if(!Object.hasOwn(row,k)||row[k]!==expected[i]![k])return false;}
 return true;
}
/** Keep authored albedo shade clusters. Only caller-selected material colours
 * receive two extra indexed reflected-light ramps; robot colours stay separate. */
export function createPinballRoomLightPalette(palette:readonly(readonly number[])[],theme:PinballRoomLightTheme,materialIndices:readonly number[]):PinballRoomLightPalette{
 if(!Object.hasOwn(emitters,theme)||!Array.isArray(palette)||palette.length<1||palette.length>256||Array.from({length:palette.length},(_,i)=>{const v=palette[i];return!Object.hasOwn(palette,i)||!Array.isArray(v)||v.length!==3||[0,1,2].some(k=>!Object.hasOwn(v,k)||!Number.isInteger(v[k])||v[k]!<0||v[k]!>255);}).some(Boolean)||!Array.isArray(materialIndices)||materialIndices.length>48||Array.from({length:materialIndices.length},(_,i)=>!Object.hasOwn(materialIndices,i)||!Number.isSafeInteger(materialIndices[i])||materialIndices[i]!<1||materialIndices[i]!>=palette.length).some(Boolean)||new Set(materialIndices).size!==materialIndices.length||palette.length+materialIndices.length*2>256)throw Error('Room light palette budget');
 const colours=palette.map(v=>[...v]as[number,number,number]),low=Array(256).fill(-1)as number[],high=Array(256).fill(-1)as number[],base=Array.from({length:256},(_,i)=>i),emitter=emitters[theme];
 for(const i of materialIndices){for(const[tint,lift,map]of[[.16,12,low],[.32,24,high]]as const){const j=colours.length;colours.push(palette[i]!.map((v:number,k:number)=>Math.min(255,Math.round(v+(emitter[k]!-v)*tint+lift)))as[number,number,number]);map[i]=j;base[j]=i;}}
 const result=Object.freeze({palette:Object.freeze(colours.map(v=>Object.freeze(v)))});plans.set(result,{theme,low:Object.freeze(low),high:Object.freeze(high),base:Object.freeze(base)});return result;
}
/** A reflected light pool is centred on an actual native feedback pulse.
 * This pass precedes current balls, blades and impact sprites. No body path,
 * new emitter position, contact geometry or simulation state is synthesized. */
export function paintPinballRoomLighting(p:PixelCanvas,palette:PinballRoomLightPalette,r:PinballRoomLightRequest){
 const plan=plans.get(palette);
 if(!plan||r.theme!==plan.theme||typeof r.arenaId!=='string'||!r.arenaId||!Number.isFinite(r.scale)||r.scale<=0||r.scale>2||typeof r.project!=='function'||typeof r.reducedMotion!=='boolean'||!r.feedback||!Number.isFinite(r.feedback.tick)||r.feedback.tick<0||r.feedback.tick>=432001||!Array.isArray(r.feedback.pulses)||r.feedback.pulses.length>512||p.W>2048||p.H>2048||p.W*p.H>1048576||p.offsetX!==0||p.offsetY!==0||!matchesPalette(p.palette,palette.palette))throw Error('Room light request');
 const lights:{x:number;y:number;radius:number;alpha:number;id:string}[]=[],ids=new Set<string>();
 for(let i=0;i<r.feedback.pulses.length;i++){
  const q=r.feedback.pulses[i];if(!q||!['spark','mist','ring','charge'].includes(q.kind)||typeof q.id!=='string'||!q.id||q.id.length>256||typeof q.arenaId!=='string'||![q.x,q.y,q.elevation].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6)||!Number.isFinite(q.alpha)||q.alpha<0||q.alpha>1||!Number.isFinite(q.radius)||q.radius<0||q.radius>256)throw Error('Room light native pulse');
  if(ids.has(q.id))throw Error('Room light duplicate pulse');ids.add(q.id);
  if(q.arenaId!==r.arenaId)continue;const v=r.project(q.x,q.y,q.elevation);if(!Array.isArray(v)||v.length!==2||![0,1].every(k=>Object.hasOwn(v,k)&&Number.isFinite(v[k])&&Math.abs(v[k]!)<=100000))throw Error('Room light projection');
  const radius=Math.min(64,Math.max(8,q.radius*r.scale*3+8));if(v[0]+radius<0||v[1]+radius<0||v[0]-radius>=p.W||v[1]-radius>=p.H||q.alpha<.08)continue;
  lights.push({x:v[0],y:v[1],radius,alpha:q.alpha,id:q.id});
 }
 if(r.reducedMotion)return{lights:0,pixels:0};
 return paintLightPools(p,plan,lights);
}
/** Caller-authored ambient fixture light is separate from actual hit pulses.
 * Positions/radii are supplied in native world units; this changes indexed
 * material colour only, with no actors, paths or collision geometry. */
export function paintPinballRoomEmitterLighting(p:PixelCanvas,palette:PinballRoomLightPalette,r:PinballRoomEmitterRequest){
 const plan=plans.get(palette);
 if(!plan||r.theme!==plan.theme||typeof r.project!=='function'||!Number.isFinite(r.scale)||r.scale<=0||r.scale>2||!Array.isArray(r.emitters)||r.emitters.length>16||p.W>2048||p.H>2048||p.W*p.H>1048576||p.offsetX!==0||p.offsetY!==0||!matchesPalette(p.palette,palette.palette))throw Error('Room emitter lighting request');
 const lights:{x:number;y:number;radius:number;alpha:number;id:string}[]=[],ids=new Set<string>();
 for(let i=0;i<r.emitters.length;i++){
  const e=r.emitters[i];
  if(!Object.hasOwn(r.emitters,i)||!e||typeof e.id!=='string'||!e.id||e.id.length>256||ids.has(e.id)||![e.x,e.y,e.elevation,e.radius,e.strength].every(Number.isFinite)||Math.abs(e.x)>1e6||Math.abs(e.y)>1e6||Math.abs(e.elevation)>1e6||e.radius<=0||e.radius>256||e.strength<0||e.strength>1)throw Error('Room authored emitter');
  ids.add(e.id);const q=r.project(e.x,e.y,e.elevation);
  if(!Array.isArray(q)||q.length!==2||![0,1].every(k=>Object.hasOwn(q,k)&&Number.isFinite(q[k])&&Math.abs(q[k]!)<=100000))throw Error('Room emitter projection');
  const radius=Math.min(48,e.radius*r.scale);
  if(radius<1||e.strength===0||q[0]+radius<0||q[1]+radius<0||q[0]-radius>=p.W||q[1]-radius>=p.H)continue;
  lights.push({x:q[0],y:q[1],radius,alpha:e.strength,id:e.id});
 }
 return paintLightPools(p,plan,lights);
}
function paintLightPools(p:PixelCanvas,plan:Plan,lights:{x:number;y:number;radius:number;alpha:number;id:string}[]){
 lights.sort((a,b)=>b.alpha-a.alpha||(a.id<b.id?-1:a.id>b.id?1:0));const selected=lights.slice(0,4),clip=p.clip;let pixels=0;
 // Ordered light coverage supplies pixel shade steps without smoothing the
 // sprites. Sampling is fixed to the logical grid, not frame-rate randomness.
 const order=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
 for(const light of selected){const left=Math.max(0,Math.ceil(light.x-light.radius),clip?Math.ceil(clip[0]):0),right=Math.min(p.W-1,Math.floor(light.x+light.radius),clip?Math.floor(clip[2]):p.W-1),top=Math.max(0,Math.ceil(light.y-light.radius),clip?Math.ceil(clip[1]):0),bottom=Math.min(p.H-1,Math.floor(light.y+light.radius),clip?Math.floor(clip[3]):p.H-1),rr=light.radius*light.radius;
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){const strength=(1-((x-light.x)**2+(y-light.y)**2)/rr)*light.alpha;if(strength<=0)continue;const at=y*p.W+x,old=p.pixels[at]!,base=plan.base[old]!,near=strength>.54,target=near?plan.high[base]!:plan.low[base]!;if(target<0||(!near&&old===plan.high[base])||strength*16<=order[(y&3)*4+(x&3)]!)continue;if(old!==target){p.pixels[at]=target;pixels++;}}
 }
 return{lights:selected.length,pixels};
}
