import {createRoll,deriveSeed,normalizeSeed} from '@keel-engine/core/rng';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {compilePinballMap} from '@keel-engine/pinball-map';
import type {PinballMap,CompiledPinballMap} from '@keel-engine/pinball-map';
export const CABINET_GENERATOR_VERSION='keel-pinball-mapgen@1';
export const CABINET_GRAMMAR_VERSION='keel-pinball-cabinet-grammar@1';
export const MAX_CABINET_STAGE=2147483647;
export const CABINET_THEMES=['nightshift','cyberpunk','vaporwave','gold','nature'] as const;
export const CABINET_STYLES=['pixel','dither','arcade','realistic','cartoon'] as const;
export type CabinetTheme=typeof CABINET_THEMES[number];
export type CabinetStyle=typeof CABINET_STYLES[number];
export interface CabinetRecipe {
 readonly schema:'keel-pinball-cabinet@1';readonly seed:string;readonly theme:CabinetTheme;readonly style:CabinetStyle;
 readonly styleFamily:string;readonly decorationSeed:string;readonly grammarVersion:typeof CABINET_GRAMMAR_VERSION;
 readonly recipeId:string;readonly canonical:string;readonly sha256:string;
}
export interface CabinetLayout {readonly id:string;readonly bumperPositions:readonly {readonly id:string;readonly x:number;readonly y:number}[]}
export interface CabinetStageOptions {readonly layouts?:readonly CabinetLayout[]}
const digest=(canonical:string)=>toHex(sha256(new TextEncoder().encode(canonical)));
const compare=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
export function createCabinetRecipe(seedHex:string,options:{theme?:CabinetTheme;style?:CabinetStyle}={}):CabinetRecipe {
 if(typeof seedHex!=='string')throw new TypeError('Cabinet seed must be hexadecimal text');
 const seed=normalizeSeed(seedHex),roll=createRoll(deriveSeed(seed,`${CABINET_GRAMMAR_VERSION}:traits`));
 const theme=options.theme??roll.pick(16,CABINET_THEMES),style=options.style??roll.pick(17,CABINET_STYLES);
 if(!(CABINET_THEMES as readonly string[]).includes(theme)||!(CABINET_STYLES as readonly string[]).includes(style))throw new Error('Unknown cabinet theme/style');
 const body={schema:'keel-pinball-cabinet@1' as const,seed,theme,style,styleFamily:`${theme}.${style}.v1`,decorationSeed:deriveSeed(seed,`${CABINET_GRAMMAR_VERSION}:decoration:${theme}:${style}`),grammarVersion:CABINET_GRAMMAR_VERSION} as const;
 const canonical=JSON.stringify(body),hash=digest(canonical);
 return Object.freeze({...body,recipeId:`cabinet-${hash}`,canonical,sha256:hash});
}
function verifyRecipe(recipe:CabinetRecipe):CabinetRecipe {
 const expected=createCabinetRecipe(recipe.seed,{theme:recipe.theme,style:recipe.style});
 for(const key of Object.keys(expected) as (keyof CabinetRecipe)[])if(recipe[key]!==expected[key])throw new Error('Cabinet recipe identity mismatch');
 return expected;
}
const qi=(value:number)=>BigInt(Math.round(value*1024));
const square=(value:bigint)=>value*value;
function circleClear(ax:bigint,ay:bigint,bx:bigint,by:bigint,r:bigint):boolean{return square(ax-bx)+square(ay-by)>=square(r);}
function segmentClear(x:bigint,y:bigint,ax:bigint,ay:bigint,bx:bigint,by:bigint,r:bigint):boolean {
 const dx=bx-ax,dy=by-ay,ll=dx*dx+dy*dy,px=x-ax,py=y-ay,t=px*dx+py*dy;
 if(t<=0n)return circleClear(x,y,ax,ay,r);if(t>=ll)return circleClear(x,y,bx,by,r);
 return square(px*dy-py*dx)>=square(r)*ll;
}
/** Exact Q10/BigInt static clearance checks. They do not prove shot reachability. */
function validateClearances(map:CompiledPinballMap):void {
 const corridor=map.ballRadius*2+2;
 for(let i=0;i<map.bumpers.length;i++){
  const b=map.bumpers[i]!,r=b.radius+corridor,x=qi(b.x),y=qi(b.y);
  if(b.x<r||b.y<r||b.x>map.width-r||b.y>Math.min(map.height,map.drainY)-r)throw new Error(`Bumper ${b.id} violates playfield clearance`);
  if(!circleClear(x,y,qi(map.launch.x),qi(map.launch.y),qi(r)))throw new Error(`Bumper ${b.id} blocks launch socket`);
  for(const rail of map.segments)if(rail.layer===b.layer&&!segmentClear(x,y,qi(rail.ax),qi(rail.ay),qi(rail.bx),qi(rail.by),qi(r)))throw new Error(`Bumper ${b.id} violates rail clearance`);
  for(const f of map.flippers)if(f.layer===b.layer&&!circleClear(x,y,qi(f.pivotX),qi(f.pivotY),qi(r+f.length+f.radius)))throw new Error(`Bumper ${b.id} violates flipper sweep clearance`);
  for(let j=0;j<i;j++){const other=map.bumpers[j]!;if(other.layer===b.layer&&!circleClear(x,y,qi(other.x),qi(other.y),qi(b.radius+other.radius+corridor)))throw new Error(`Bumpers ${b.id}/${other.id} violate corridor clearance`);}
 }
}
export function createCabinetStage(source:CabinetRecipe,stageIndex:number,baseSource:PinballMap,options:CabinetStageOptions={}) {
 const cabinet=verifyRecipe(source);
 if(!Number.isSafeInteger(stageIndex)||stageIndex<0||stageIndex>MAX_CABINET_STAGE)throw new RangeError('Cabinet stage must be an integer in 0..2147483647');
 const base=compilePinballMap(baseSource);
 const supplied=options.layouts??[{id:'base',bumperPositions:base.bumpers.map(b=>({id:b.id,x:b.x,y:b.y}))}];
 if(!Array.isArray(supplied)||supplied.length<1||supplied.length>32)throw new Error('Cabinet requires 1..32 authored layouts');
 const ids=new Set<string>(),geometries=new Set<string>();
 const layouts=[...supplied].sort(compare).map(layout=>{
  if(!/^[A-Za-z0-9._-]{1,40}$/.test(layout.id)||ids.has(layout.id))throw new Error('Invalid or duplicate layout ID');ids.add(layout.id);
  if(!Array.isArray(layout.bumperPositions)||layout.bumperPositions.length!==base.bumpers.length)throw new Error('Layout must position every canonical bumper');
  const positions=[...layout.bumperPositions].sort(compare);
  for(let i=0;i<positions.length;i++)if(positions[i]!.id!==base.bumpers[i]!.id)throw new Error('Layout bumper IDs differ from base map');
  const candidate=compilePinballMap({...base,bumpers:base.bumpers.map((b,i)=>({...b,x:positions[i]!.x,y:positions[i]!.y}))});
  validateClearances(candidate);
  const bumperPositions=candidate.bumpers.map(b=>Object.freeze({id:b.id,x:b.x,y:b.y}));
  const geometry=JSON.stringify(bumperPositions);if(geometries.has(geometry))throw new Error('Duplicate layout geometry');geometries.add(geometry);
  return Object.freeze({id:layout.id,bumperPositions:Object.freeze(bumperPositions)});
 });
 const templateSha256=digest(JSON.stringify({base:base.canonical,layouts}));
 const stageSeed=deriveSeed(cabinet.seed,`${CABINET_GENERATOR_VERSION}:${cabinet.sha256}:${templateSha256}:stage:${stageIndex}`);
 // Fixed cabinet slot selects the cycle offset. Adjacent stages use different
 // authored layouts when >=2 exist, regardless of generation request order.
 const roll=createRoll(deriveSeed(cabinet.seed,`${CABINET_GENERATOR_VERSION}:${templateSha256}:layout-cycle`));
 const selected=layouts[(roll.index(16,layouts.length)+stageIndex)%layouts.length]!;
 const progressionStep=Math.min(stageIndex,200),scoreMultiplierQ10=1024+progressionStep*8,bumperImpulseBonus=progressionStep/256;
 const difficulty=Object.freeze({progressionStep,scoreMultiplierQ10,bumperImpulseBonus});
 const identity=digest(JSON.stringify({cabinet:cabinet.sha256,stageIndex,stageSeed,templateSha256}));
 const map=compilePinballMap({...base,id:`stage-${identity.slice(0,32)}-${stageIndex}`,bumpers:base.bumpers.map((b,i)=>({...b,x:selected.bumperPositions[i]!.x,y:selected.bumperPositions[i]!.y,impulse:Math.min(12,b.impulse!+bumperImpulseBonus),points:Math.min(100000,Math.floor(b.points!*scoreMultiplierQ10/1024))}))});
 const body={schema:'keel-pinball-cabinet-stage@1' as const,generatorVersion:CABINET_GENERATOR_VERSION,cabinetId:cabinet.recipeId,cabinetSha256:cabinet.sha256,templateSha256,stageSeed,stageIndex,difficulty,theme:cabinet.theme,style:cabinet.style,styleFamily:cabinet.styleFamily,decorationSeed:deriveSeed(stageSeed,`${CABINET_GRAMMAR_VERSION}:decoration`),layoutId:selected.id,qualification:'static-clearance-validated' as const,mapSha256:digest(map.canonical)};
 const canonical=JSON.stringify(body);
 return Object.freeze({...body,map,canonical,sha256:digest(canonical)});
}
export type CabinetStage=ReturnType<typeof createCabinetStage>;
