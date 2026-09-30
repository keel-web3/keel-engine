/** Bounded base-POSITION preprocessing. All other decoded fields remain exact.
 * This pass changes Float32 values only in explicitly lossy mode. The outer
 * compiler must compare the full encoded scene plus runtime cost before selection.
 */
import type { NormalizedAsset } from './asset-normalize-v2.ts';
import {encodeBuffer,decodeBuffer} from './asset-buffer-codec.ts';
import {compileSurface} from './asset-native-surface-v2.ts';

export const POSITION_QUANTIZER_VERSION = 'keel-position-quantizer-0.3.0';
export interface PositionQuantizationOptions {
  mode:'lossless'|'bounded-lossy';
  /** Fraction of each base POSITION accessor's bounding-box diagonal. */
  maxRelativeError?:number;
  /** Optional additional hard bound, in the accessor's mesh coordinates. */
  maxAbsoluteError?:number;
  minBits?:number;
  maxBits?:number;
}
export interface PositionQuantizationMetric {
  accessor:number; primitives:Array<{mesh:number;primitive:number}>;
  vertexCount:number; boundsMin:number[]; boundsMax:number[]; boundsDiagonal:number;
  maxAllowedError:number; maxPositionError:number; rmsPositionError:number;
  relativeMaxError:number; changedComponents:number; bits:number|null;
  applied:boolean; reason:string;
}
function fail(message:string):never {throw Error('Position quantizer v3: '+message)}
function bound(value:unknown,name:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail('invalid '+name);
  return value;
}
function bits(value:unknown,name:string):number {
  if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>24)fail('invalid '+name);
  return value;
}
function cloneJSON<T>(value:T):T {return structuredClone(value)}
type Wire={codec:string;parameters:Record<string,number>;sourceLength:number;data:string|Uint8Array};
export interface QuantizedPositionRecipe {kind:'quantized-lattice';version:3;vertexCount:number;bits:number;minimumWords:number[];maximumWords:number[];codes:Wire}
function b64(a:Uint8Array):string {let s='';for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s)}
function wire(a:Uint8Array,stride:number,componentBytes:number):Wire {const e=encodeBuffer(a,{stride,componentBytes});return {...e,data:b64(e.data)}}
const recipeSize=(r:unknown)=>new TextEncoder().encode(JSON.stringify(r)).length;
function floatWords(values:number[]):number[] {return Array.from(new Uint32Array(new Float32Array(values).buffer));}
function fromWords(words:number[]):Float32Array {if(!Array.isArray(words)||words.length!==3||words.some(x=>!Number.isSafeInteger(x)||x<0||x>0xffffffff))fail('invalid lattice endpoint words');return new Float32Array(new Uint32Array(words).buffer)}
function latticePayload(data:string|Uint8Array):Uint8Array {
  if(data instanceof Uint8Array){if(data.byteLength>128*1024*1024)fail('invalid lattice payload');return data;}
  if(typeof data!=='string'||data.length>128*1024*1024||data.length%4!==0||/[^A-Za-z0-9+/=]/.test(data))fail('invalid lattice payload');
  // Linear scans avoid the engine stack growth of repeated-group base64 regexes.
  const padding=data.indexOf('=');
  if(padding!==-1){const tail=data.slice(padding);if(tail!=='='&&tail!=='==')fail('invalid lattice payload');}
  try{return Uint8Array.from(atob(data),c=>c.charCodeAt(0));}catch{return fail('invalid lattice payload');}
}
export function replayQuantizedPositions(recipe:QuantizedPositionRecipe):Float32Array {
  if(!recipe||recipe.kind!=='quantized-lattice'||recipe.version!==3)fail('unsupported lattice recipe');
  const n=bits(recipe.bits,'lattice bits'),count=recipe.vertexCount,width=n<=8?1:n<=16?2:4;
  if(!Number.isSafeInteger(count)||count<0||count*12>64*1024*1024)fail('invalid lattice vertex count');
  const min=fromWords(recipe.minimumWords),max=fromWords(recipe.maximumWords);
  for(let k=0;k<3;k++)if(!Number.isFinite(min[k])||!Number.isFinite(max[k])||max[k]!<min[k]!)fail('invalid lattice extent');
  const w=recipe.codes;if(!w||w.sourceLength!==count*3*width)fail('invalid lattice payload');
  const bytes=decodeBuffer({...w,data:latticePayload(w.data)},64*1024*1024),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=new Float32Array(count*3),levels=2**n-1;
  for(let i=0;i<out.length;i++){const q=width===1?bytes[i]!:width===2?view.getUint16(i*2,true):view.getUint32(i*4,true),k=i%3;if(q>levels)fail('lattice code out of range');out[i]=max[k]===min[k]?min[k]!:Math.fround(min[k]!+q/levels*(max[k]!-min[k]!));}
  return out;
}
function latticeRecipe(source:Float32Array,result:ReturnType<typeof quantizePositions>):QuantizedPositionRecipe|null {
  if(!result.applied||result.bits===null)return null;
  const n=result.bits,width=n<=8?1:n<=16?2:4,levels=2**n-1,codes=new Uint8Array(source.length*width),view=new DataView(codes.buffer),sourceWords=new Uint32Array(source.buffer,source.byteOffset,source.length);
  const minimumWords=floatWords(result.boundsMin),maximumWords=floatWords(result.boundsMax);
  for(let i=0;i<source.length;i++){
    const k=i%3,e=result.boundsMax[k]!-result.boundsMin[k]!;
    if(e===0&&sourceWords[i]!==minimumWords[k])return null; // Mixed +0/-0 constant axes need the exact residual path.
    const q=e===0?0:Math.max(0,Math.min(levels,Math.round((source[i]!-result.boundsMin[k]!)/e*levels)));
    if(width===1)codes[i]=q;else if(width===2)view.setUint16(i*2,q,true);else view.setUint32(i*4,q,true);
  }
  const recipe:QuantizedPositionRecipe={kind:'quantized-lattice',version:3,vertexCount:source.length/3,bits:n,minimumWords,maximumWords,codes:wire(codes,3*width,width)};
  const replay=replayQuantizedPositions(recipe),a=new Uint32Array(replay.buffer),b=new Uint32Array(result.positions.buffer);
  if(a.some((v,i)=>v!==b[i]))fail('lattice reconstruction did not reproduce measured Float32 values');
  return recipe;
}
function measure(source:Float32Array,output:Float32Array) {
  const a=new Uint32Array(source.buffer,source.byteOffset,source.length),b=new Uint32Array(output.buffer,output.byteOffset,output.length);
  let max=0,squares=0,changed=0;
  for(let i=0;i<source.length;i+=3){const error=Math.hypot(output[i]!-source[i]!,output[i+1]!-source[i+1]!,output[i+2]!-source[i+2]!);max=Math.max(max,error);squares+=error*error;for(let k=0;k<3;k++)if(a[i+k]!==b[i+k])changed++;}
  return {max,rms:source.length?Math.sqrt(squares/(source.length/3)):0,changed};
}
export function quantizePositions(source:Float32Array,options:PositionQuantizationOptions) {
  if(!(source instanceof Float32Array)||source.length%3||source.byteLength>64*1024*1024)fail('POSITION must be Float32 VEC3 within the 64 MiB surface limit');
  if(options.mode!=='lossless'&&options.mode!=='bounded-lossy')fail('unsupported mode');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<source.length;i++){const v=source[i]!;if(!Number.isFinite(v))fail('nonfinite POSITION');const k=i%3;if(v<min[k]!)min[k]=v;if(v>max[k]!)max[k]=v;}
  if(!source.length){min.fill(0);max.fill(0);}
  const extent=max.map((v,k)=>v-min[k]!),diagonal=Math.hypot(...extent);
  if(!Number.isFinite(diagonal))fail('nonfinite POSITION extent');
  let allowed=0;
  if(options.mode==='bounded-lossy'){
    if(options.maxRelativeError===undefined&&options.maxAbsoluteError===undefined)fail('an explicit error budget is required');
    const relative=options.maxRelativeError===undefined?Infinity:bound(options.maxRelativeError,'relative error')*diagonal;
    const absolute=options.maxAbsoluteError===undefined?Infinity:bound(options.maxAbsoluteError,'absolute error');
    allowed=Math.min(relative,absolute);if(!Number.isFinite(allowed))fail('nonfinite error budget');
  }
  const original=new Float32Array(source),base={boundsMin:min,boundsMax:max,boundsDiagonal:diagonal,maxAllowedError:allowed};
  const exact=(reason:string)=>({positions:original,...base,maxPositionError:0,rmsPositionError:0,relativeMaxError:0,changedComponents:0,bits:null as number|null,applied:false,reason});
  if(options.mode==='lossless')return exact('lossless mode preserves every Float32 bit');
  if(!source.length||diagonal===0||allowed===0)return exact('zero extent, empty input or zero error budget');
  const lo=bits(options.minBits??8,'minimum bits'),hi=bits(options.maxBits??24,'maximum bits');if(lo>hi)fail('minimum bits exceeds maximum bits');
  // Deterministic ascending precision. Measure decoded Float32 values instead
  // of treating an ideal real-number quantization bound as the actual error.
  for(let n=lo;n<=hi;n++){
    const levels=2**n-1,out=new Float32Array(source.length);
    for(let i=0;i<source.length;i++){
      const k=i%3,e=extent[k]!;
      // Preserve constant-axis bits, including signed zeros, without division.
      if(e===0){out[i]=source[i]!;continue;}
      const q=Math.max(0,Math.min(levels,Math.round((source[i]!-min[k]!)/e*levels)));
      out[i]=Math.fround(min[k]!+q/levels*e);
    }
    const result=measure(source,out);
    if(result.max<=allowed)return {positions:out,...base,maxPositionError:result.max,rmsPositionError:result.rms,relativeMaxError:diagonal?result.max/diagonal:0,changedComponents:result.changed,bits:result.changed?n:null,applied:result.changed>0,reason:result.changed?'measured Float32 mesh-space error satisfies the requested bound':'quantized reconstruction is already exact'};
  }
  return exact('no candidate satisfied the requested error budget');
}

export function quantizePositionAccessors(asset:NormalizedAsset,options:PositionQuantizationOptions) {
  if(!asset||!Array.isArray(asset.accessors)||!asset.json)fail('invalid normalized asset');
  if(options.mode!=='lossless'&&options.mode!=='bounded-lossy')fail('unsupported mode');
  if(options.maxRelativeError!==undefined)bound(options.maxRelativeError,'relative error');
  if(options.maxAbsoluteError!==undefined)bound(options.maxAbsoluteError,'absolute error');
  if(options.mode==='bounded-lossy'&&options.maxRelativeError===undefined&&options.maxAbsoluteError===undefined)fail('an explicit error budget is required');
  const minBits=bits(options.minBits??8,'minimum bits'),maxBits=bits(options.maxBits??24,'maximum bits');if(minBits>maxBits)fail('minimum bits exceeds maximum bits');
  const refs=new Map<number,Array<{mesh:number;primitive:number}>>(),protectedIds=new Set<number>();
  const protect=(x:any)=>{if(Number.isInteger(x))protectedIds.add(x)};
  for(let mi=0;mi<(asset.json.meshes??[]).length;mi++)for(let pi=0;pi<asset.json.meshes[mi].primitives.length;pi++){
    const p=asset.json.meshes[mi].primitives[pi];
    for(const [semantic,index] of Object.entries(p.attributes??{})){
      if(semantic==='POSITION'){if(!Number.isInteger(index)||!asset.accessors[index as number])fail('missing POSITION accessor');const a=refs.get(index as number)??[];a.push({mesh:mi,primitive:pi});refs.set(index as number,a);}
      else protect(index);
    }
    protect(p.indices);for(const target of p.targets??[])for(const id of Object.values(target))protect(id);
  }
  for(const skin of asset.json.skins??[])protect(skin.inverseBindMatrices);
  for(const animation of asset.json.animations??[])for(const sampler of animation.samplers??[]){protect(sampler.input);protect(sampler.output);}
  // Unknown extension accessor references cannot safely be inferred. Freeze
  // positions when extensions are present instead of accidentally changing one.
  const opaqueExtensions=(asset.json.extensionsUsed??[]).length>0||(asset.json.extensionsRequired??[]).length>0;
  const json=cloneJSON(asset.json),accessors=asset.accessors.slice(),metrics:PositionQuantizationMetric[]=[],warnings:string[]=[];
  for(const [id,primitives] of [...refs].sort((a,b)=>a[0]-b[0])){
    const a=asset.accessors[id]!;if(a.componentType!==5126||a.type!=='VEC3'||!(a.array instanceof Float32Array))fail('base POSITION must be Float32 VEC3');
    const protectedAccessor=protectedIds.has(id)||opaqueExtensions;
    const result=quantizePositions(a.array,protectedAccessor?{mode:'lossless'}:options);
    const {positions,...metric}=result;
    if(protectedAccessor&&options.mode==='bounded-lossy')metric.reason=opaqueExtensions?'preserved because opaque extension accessor references may alias POSITION':'preserved because a non-position semantic shares this accessor';
    metrics.push({accessor:id,primitives,vertexCount:a.count,...metric});
    if(result.applied)accessors[id]={...a,array:positions};
  }
  if(options.mode==='bounded-lossy')warnings.push('Only base POSITION is quantized. Every other accessor, image, material, rig, animation and morph record remains unchanged. Normals are preserved rather than recomputed.');
  if(metrics.some(m=>m.reason.startsWith('preserved because')))warnings.push('Some POSITION accessors were protected from quantization because another semantic or opaque extension may share their data.');
  return {asset:{...asset,json,accessors} as NormalizedAsset,metrics,warnings,version:POSITION_QUANTIZER_VERSION,settings:{...options},changedAccessorIds:metrics.filter(m=>m.applied).map(m=>m.accessor)};
}

/** Apply relative and/or absolute mesh-space caps, returning compact recipes
 * under the same alias protection and encoded-position cost selection. Relative
 * caps use each accessor's own bounding-box diagonal. Full scene/runtime cost
 * selection remains the caller's responsibility. */
export function quantizePositionAccessorsWithRecipes(asset:NormalizedAsset,options:PositionQuantizationOptions) {
  const mode=options.mode;
  const result=quantizePositionAccessors(asset,options);
  const positionRecipes:Array<{accessor:number;recipe:QuantizedPositionRecipe;recipeBytes:number;quantizedFloatResidualBytes:number;exactPositionRecipeBytes:number}>=[];
  const costs:Array<{accessor:number;exactPositionRecipeBytes:number;candidatePositionRecipeBytes:number;operation:string;selected:boolean}>=[];
  for(const metric of result.metrics){if(!metric.applied)continue;const source=asset.accessors[metric.accessor]!.array as Float32Array;
    const candidate=quantizePositions(source,options),recipe=latticeRecipe(source,candidate);
    const exactPosition=compileSurface({positions:source,indices:null}).recipe.positions;
    const quantizedPosition=compileSurface({positions:candidate.positions,indices:null}).recipe.positions;
    const exactBytes=recipeSize(exactPosition),quantizedBytes=recipeSize(quantizedPosition),latticeBytes=recipe?recipeSize(recipe):Infinity;
    const bestBytes=Math.min(quantizedBytes,latticeBytes),useLattice=latticeBytes<quantizedBytes,selected=bestBytes<exactBytes;
    costs.push({accessor:metric.accessor,exactPositionRecipeBytes:exactBytes,candidatePositionRecipeBytes:bestBytes,operation:useLattice?'quantized-lattice':quantizedPosition.kind,selected});
    if(!selected){result.asset.accessors[metric.accessor]=asset.accessors[metric.accessor]!;metric.applied=false;metric.bits=null;metric.maxPositionError=0;metric.rmsPositionError=0;metric.relativeMaxError=0;metric.changedComponents=0;metric.reason='preserved because no quantized position recipe reduced encoded payload bytes';continue;}
    if(recipe&&useLattice){const decoded=candidate.positions,raw=new Uint8Array(decoded.buffer,decoded.byteOffset,decoded.byteLength);positionRecipes.push({accessor:metric.accessor,recipe,recipeBytes:latticeBytes,quantizedFloatResidualBytes:recipeSize({kind:'residual',buffer:wire(raw,12,4)}),exactPositionRecipeBytes:exactBytes});}
  }
  return {normalized:result.asset,positionRecipes,report:{version:result.version,mode,definition:'Maximum Euclidean base-vertex displacement in each source mesh coordinate system.',settings:{mode,maxAbsoluteError:options.maxAbsoluteError??null,maxRelativeError:options.maxRelativeError??null,minBits:options.minBits??8,maxBits:options.maxBits??24},relativeErrorReference:'Each base POSITION accessor bounding-box diagonal.',metrics:result.metrics,costs,changedAccessorIds:result.metrics.filter(m=>m.applied).map(m=>m.accessor),warnings:[...result.warnings,'An animated-world or screen-space error bound requires a separate transform/pose validation gate.','Select candidates using the complete emitted code, data and shared runtime cost. Component recipe size alone is not a package saving.']}};
}

/** Backward-compatible absolute-error alias. maxError is Euclidean
 * displacement in source mesh coordinates, never animated/world-space error. */
export function quantizeBasePositions(asset:NormalizedAsset,options:{maxError:number;mode?:'lossless'|'bounded-lossy';minBits?:number;maxBits?:number}) {
  bound(options.maxError,'maximum error');
  const result=quantizePositionAccessorsWithRecipes(asset,{mode:options.mode??'bounded-lossy',maxAbsoluteError:options.maxError,...(options.minBits===undefined?{}:{minBits:options.minBits}),...(options.maxBits===undefined?{}:{maxBits:options.maxBits})});
  return {...result,report:{...result.report,maxError:options.maxError}};
}
