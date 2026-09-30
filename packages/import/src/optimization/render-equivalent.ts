/** Full-record welding for the standard glTF render-input contract.
 * This changes storage, vertex IDs and accessor indexing. It preserves ordered
 * triangle corners and every supplied attribute/morph byte at those corners.
 * Applications observing vertex IDs, buffer layout, unused vertices or accessor
 * IDs are outside this contract. No surfaces, material records or clips vanish.
 */
import type {NormalizedAsset,NormalizedAccessor,NativeArray} from '../asset-normalize-v3.ts';
const widths:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const raw=(a:NativeArray)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
function references(json:any,visit:(o:any,k:string)=>void){
 for(const m of json.meshes??[])for(const p of m.primitives??[]){if(p.indices!==undefined)visit(p,'indices');for(const group of[p.attributes,...(p.targets??[])])for(const k of Object.keys(group??{}))visit(group,k);}
 for(const s of json.skins??[])if(s.inverseBindMatrices!==undefined)visit(s,'inverseBindMatrices');
 for(const a of json.animations??[])for(const s of a.samplers??[]){visit(s,'input');visit(s,'output');}
}
function extensions(value:any):boolean{return !!value&&typeof value==='object'&&(Object.keys(value.extensions??{}).length>0||Object.entries(value).some(([k,v])=>k!=='extras'&&extensions(v)));}
function observerExtras(json:any):boolean {
 if(json.extras!==undefined)return true;
 const attribution=json.asset?.extras;if(attribution!==undefined&&(!attribution||typeof attribution!=='object'||Array.isArray(attribution)||Object.entries(attribution).some(([k,v])=>!['author','license','source','title','copyright'].includes(k)||typeof v!=='string')))return true;
 const walk=(v:any):boolean=>!!v&&typeof v==='object'&&(v.extras!==undefined||Object.entries(v).some(([k,x])=>k!=='extras'&&walk(x)));return Object.entries(json).some(([k,v])=>k!=='asset'&&walk(v));
}
function metadata(a:NormalizedAccessor,prior:any={}){const out={...prior,componentType:a.componentType,type:a.type,count:a.count};delete out.bufferView;delete out.byteOffset;delete out.sparse;if(a.normalized)out.normalized=true;else delete out.normalized;
 if(prior.min||prior.max){const w=widths[a.type]!,lo=new Array<number>(w).fill(Infinity),hi=new Array<number>(w).fill(-Infinity);for(let i=0;i<a.array.length;i++){lo[i%w]=Math.min(lo[i%w]!,a.array[i]!);hi[i%w]=Math.max(hi[i%w]!,a.array[i]!);}if(prior.min)out.min=lo;if(prior.max)out.max=hi;}return out;}
export interface RenderPrimitiveReport {mesh:number;primitive:number;applied:boolean;reason:string;originalVertices:number;outputVertices:number;triangles:number;cornerRecordsChecked:number;removedUnusedVertices:number;weldedVertices:number;}
export function optimizeRenderEquivalent(asset:NormalizedAsset){
 const normalized:NormalizedAsset={...asset,json:structuredClone(asset.json),accessors:asset.accessors.slice(),validation:structuredClone(asset.validation)};
 const metrics:RenderPrimitiveReport[]=[],generated:Array<{source:number|null;value:NormalizedAccessor;metadata:any}>=[],originalCount=asset.accessors.length;
 const append=(source:number|null,value:NormalizedAccessor)=>{const id=originalCount+generated.length;generated.push({source,value,metadata:metadata(value,source===null?{}:asset.json.accessors?.[source])});return id;};
 const opaque=extensions(asset.json)||(asset.json.extensionsUsed??[]).length>0||(asset.json.extensionsRequired??[]).length>0;
 for(let mi=0;mi<(asset.json.meshes??[]).length;mi++)for(let pi=0;pi<asset.json.meshes[mi].primitives.length;pi++){
  const primitive=asset.json.meshes[mi].primitives[pi],position=asset.accessors[primitive.attributes?.POSITION],count=position?.count??0;
  const metric:RenderPrimitiveReport={mesh:mi,primitive:pi,applied:false,reason:'',originalVertices:count,outputVertices:count,triangles:0,cornerRecordsChecked:0,removedUnusedVertices:0,weldedVertices:0};metrics.push(metric);
  const start=generated.length;
  try{
   if(opaque)throw Error('opaque extension references are retained');
   if(observerExtras(asset.json))throw Error('opaque extras may observe vertex or accessor IDs; retained');
   if((primitive.mode??4)!==4)throw Error('only ordered triangle lists are eligible');
   if(!position||!Number.isSafeInteger(count)||count<1||count>4_000_000)throw Error('invalid vertex count');
   const material=asset.json.materials?.[primitive.material];if(material?.normalTexture&&primitive.attributes.TANGENT===undefined)throw Error('implicit tangent generation with a normal map is retained');
   const streams=new Map<number,NormalizedAccessor>();for(const group of[primitive.attributes,...(primitive.targets??[])])for(const name of Object.keys(group??{}).sort()){
    const id=group[name],a=asset.accessors[id];if(!Number.isInteger(id)||!a||!widths[a.type]||a.count!==count||a.array.length!==count*widths[a.type]!)throw Error('invalid complete vertex stream '+name);streams.set(id,a);
   }
   const ia=primitive.indices===undefined?undefined:asset.accessors[primitive.indices];
   if(primitive.indices!==undefined&&!ia)throw Error('missing index stream');
   if(ia&&(ia.type!=='SCALAR'||ia.normalized||![5121,5123,5125].includes(ia.componentType)||ia.array.length!==ia.count))throw Error('invalid index stream');
   const source=ia?Uint32Array.from(ia.array):Uint32Array.from({length:count},(_,i)=>i);if(source.length%3||source.some(i=>i>=count))throw Error('invalid triangle indices');metric.triangles=source.length/3;
   const fields=[...streams].map(([id,a])=>({id,a,bytes:raw(a.array),stride:widths[a.type]!*a.array.BYTES_PER_ELEMENT}));
   const buckets=new Map<number,number[]>(),retained:number[]=[],output=new Uint32Array(source.length),seen=new Set<number>();
   const equal=(a:number,b:number)=>fields.every(f=>{for(let k=0;k<f.stride;k++)if(f.bytes[a*f.stride+k]!==f.bytes[b*f.stride+k])return false;return true;});
   const sourceMap=new Map<number,number>();
   for(let corner=0;corner<source.length;corner++){
    const v=source[corner]!;seen.add(v);let compact=sourceMap.get(v);
    if(compact===undefined){let h=2166136261;for(const f of fields)for(let k=0;k<f.stride;k++)h=Math.imul(h^f.bytes[v*f.stride+k]!,16777619);const bucket=buckets.get(h)??[];compact=bucket.find(i=>equal(v,retained[i]!));if(compact===undefined){if(bucket.length>=64)throw Error('vertex hash collision work budget exceeded');compact=retained.length;retained.push(v);bucket.push(compact);buckets.set(h,bucket);}sourceMap.set(v,compact);}output[corner]=compact;
   }
   metric.removedUnusedVertices=count-seen.size;metric.weldedVertices=seen.size-retained.length;
   if(metric.removedUnusedVertices)throw Error('unreferenced vertices retained to preserve renderer bounds and transparent sorting');
   // No change is required merely to make a different ordering. Wider source
   // connectivity may be narrowed, but only when the complete archive wins later.
   if(retained.length===count&&ia&&ia.componentType===(count<=255?5121:count<=65535?5123:5125)){metric.reason='no duplicate, unused or narrower vertex records';continue;}
   const target=structuredClone(primitive),ids=new Map<number,number>();
   for(const {id,a,bytes:sourceBytes,stride}of fields){const array=new(a.array.constructor as{new(n:number):NativeArray})(retained.length*widths[a.type]!);const dest=raw(array);for(let v=0;v<retained.length;v++)dest.set(sourceBytes.subarray(retained[v]!*stride,(retained[v]!+1)*stride),v*stride);ids.set(id,append(id,{...a,count:retained.length,array}));}
   for(const group of[target.attributes,...(target.targets??[])])for(const key of Object.keys(group))group[key]=ids.get(group[key])!;
   const array:NativeArray=retained.length<=255?Uint8Array.from(output):retained.length<=65535?Uint16Array.from(output):output;
   target.indices=append(primitive.indices??null,{sourceIndex:ia?.sourceIndex??-1,type:'SCALAR',componentType:array.BYTES_PER_ELEMENT===1?5121:array.BYTES_PER_ELEMENT===2?5123:5125,normalized:false,count:array.length,array});
   // Independent byte check of every expanded output corner, not just hash matches.
   for(let corner=0;corner<source.length;corner++){if(!equal(source[corner]!,retained[array[corner]!]!))throw Error('ordered corner proof failed');metric.cornerRecordsChecked++;}
   normalized.json.meshes[mi].primitives[pi]=target;metric.applied=true;metric.outputVertices=retained.length;metric.reason='every ordered corner attribute and morph record is byte-identical';
  }catch(error){generated.length=start;metric.reason=error instanceof Error?error.message:String(error);metric.applied=false;metric.outputVertices=count;metric.cornerRecordsChecked=0;metric.removedUnusedVertices=0;metric.weldedVertices=0;}
 }
 const used=new Set<number>();references(normalized.json,(o,k)=>{if(o[k]<originalCount)used.add(o[k]);});const remap=new Map<number,number>(),reused=new Set<number>(),jsonAccessors=structuredClone(asset.json.accessors??asset.accessors.map(a=>metadata(a)));
 for(let i=0;i<generated.length;i++){const item=generated[i]!,reuse=item.source!==null&&!used.has(item.source)&&!reused.has(item.source),slot=reuse?item.source!:normalized.accessors.length;if(reuse)reused.add(slot);normalized.accessors[slot]=item.value;jsonAccessors[slot]=item.metadata;remap.set(originalCount+i,slot);}
 references(normalized.json,(o,k)=>{if(remap.has(o[k]))o[k]=remap.get(o[k]);});if(asset.json.accessors!==undefined||jsonAccessors.length)normalized.json.accessors=jsonAccessors;
 normalized.validation.accessorCount=normalized.accessors.length;normalized.validation.decodedBytes=normalized.accessors.reduce((n,a)=>n+a.array.byteLength,0)+normalized.images.reduce((n,a)=>n+a.data.length,0);
 return{normalized,report:{version:'keel-render-input-preservation-0.1.0',mode:'visual-preservation',contract:'Ordered triangle corners with byte-identical supplied attributes and all morph deltas under standard glTF rendering; original rig, clips, materials and images. Vertex/accessor IDs are not observable under this contract; all source vertices participate in the draw.',metrics,changedPrimitives:metrics.filter(m=>m.applied).length,originalVertices:metrics.reduce((n,m)=>n+m.originalVertices,0),outputVertices:metrics.reduce((n,m)=>n+m.outputVertices,0),triangles:metrics.reduce((n,m)=>n+m.triangles,0),warnings:['No triangles, surfaces, shadows, materials, animation channels or images are removed.','No camera, visibility or closed-volume assumption is made.','Custom vertex-ID shaders and external accessor/index observers are outside this contract; opaque extensions and extras are retained, except string-only asset author/license/source/title/copyright attribution.','Implicit normal-map tangent generation and draws with unused vertices are conservatively skipped.','This proof concerns render inputs. GPU pixels and every rendering backend are not independently proven.','A candidate must still win complete archive cost before selection.']}};
}
