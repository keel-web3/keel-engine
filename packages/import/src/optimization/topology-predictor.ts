/** Bounded, exact topology-conditioned attribute residuals. Topology is supplied by
 * the caller and must be charged once by the containing package. No vertex order,
 * parent table, source geometry or source codec is hidden in this recipe.
 * Two full candidates at most: unsigned component words, and a verified affine
 * integer domain when supplied. The actual complete packed recipe must win.
 */
import {zlibSync} from 'fflate';
import {decodeBuffer} from '../asset-buffer-codec.ts';
import {encodeResidualAttribute,exactRecipeBytes} from './exact-encoding.ts';
import type {NativeArray} from '../asset-normalize-v3.ts';
import type {AffineHint} from './draco-transforms.ts';
import type {ExactBuffer} from './exact-encoding.ts';

export const TOPOLOGY_PREDICTOR_POLICY=Object.freeze({version:1,maxVertices:1048576,maxTriangles:262144,maxBytes:256*1024*1024,fullCandidates:2,compressionLevel:6});
const widths:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const constructors={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const littleEndian=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
export type TriangleIndices=Uint8Array|Uint16Array|Uint32Array;
export interface TopologyAttributeInput {array:NativeArray;componentType:number;type:string;normalized:boolean;count:number;indices:TriangleIndices}
interface Descriptor {componentType:number;type:string;normalized:boolean;count:number}
interface AffineDomain {kind:'affine';bits:number;minimumWords:number[];scaleWord:number}
export type TopologyAttributeRecipe=(Descriptor&{version:1;kind:'residual';payload:ExactBuffer})|(Descriptor&{version:1;kind:'topology';predictor:'parallelogram-parent-v1';indexCount:number;indexHash:number;wordBytes:number;domain:{kind:'words'}|AffineDomain;payload:ExactBuffer});
export interface TopologyAttributeMetrics {sourceBytes:number;recipeBytes:number;residualRecipeBytes:number;selected:string;fullCandidates:number;topologyBytes:number;parentTableBytes:0;parallelogramVertices:number;neighborVertices:number;sequentialVertices:number;candidates:Array<{name:string;bytes:number}>;exact:true;costBasis:string;skipReason?:string}
const fail=(reason:string):never=>{throw Error('Topology predictor: '+reason)};
function int(x:unknown,min:number,max:number,label:string):number{if(typeof x!=='number'||!Number.isSafeInteger(x)||x<min||x>max)fail('invalid '+label);return x as number;}
function descriptor(d:Descriptor):{width:number;bytes:number}{const C=constructors[d.componentType as keyof typeof constructors],width=widths[d.type];if(!C||!width||typeof d.normalized!=='boolean')fail('invalid descriptor');int(d.count,0,TOPOLOGY_PREDICTOR_POLICY.maxBytes,'count');if(d.count*width!*C!.BYTES_PER_ELEMENT>TOPOLOGY_PREDICTOR_POLICY.maxBytes)fail('attribute exceeds budget');return{width:width!,bytes:C!.BYTES_PER_ELEMENT};}
function canonical(array:NativeArray):Uint8Array{const source=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);if(littleEndian||array.BYTES_PER_ELEMENT===1)return source;const out=new Uint8Array(source.length),w=array.BYTES_PER_ELEMENT;for(let i=0;i<source.length;i+=w)for(let j=0;j<w;j++)out[i+j]=source[i+w-j-1]!;return out;}
function typed(data:Uint8Array,d:Descriptor):NativeArray{const C=constructors[d.componentType as keyof typeof constructors]!,out=new C(d.count*widths[d.type]!),raw=new Uint8Array(out.buffer),w=C.BYTES_PER_ELEMENT;if(littleEndian||w===1)raw.set(data);else for(let i=0;i<data.length;i+=w)for(let j=0;j<w;j++)raw[i+j]=data[i+w-j-1]!;return out;}
function indicesHash(indices:TriangleIndices,count:number):number{if(!(indices instanceof Uint8Array||indices instanceof Uint16Array||indices instanceof Uint32Array)||indices.length%3)fail('invalid triangle indices');int(indices.length,0,TOPOLOGY_PREDICTOR_POLICY.maxBytes/4,'index count');let h=2166136261;for(const i of indices){if(i>=count)fail('index outside vertex extent');for(let b=0;b<4;b++)h=Math.imul(h^(i>>>(b*8)&255),16777619)>>>0;}return h;}
interface Plan {a:Int32Array;b:Int32Array;c:Int32Array;parallelogramVertices:number;neighborVertices:number;sequentialVertices:number}
/** Natural vertex order means every predictor references smaller IDs only.
 * The smallest opposite vertex for an unordered edge and first qualifying
 * triangle in source order fix all ties, including non-manifold meshes.
 */
function plan(indices:TriangleIndices,count:number):Plan{
 const a=new Int32Array(count),b=new Int32Array(count).fill(-1),c=new Int32Array(count).fill(-1),neighbors=new Int32Array(count).fill(-1),opposites=new Map<number,number>();
 for(let v=0;v<count;v++)a[v]=v-1;
 const key=(x:number,y:number)=>Math.min(x,y)*count+Math.max(x,y);
 for(let at=0;at<indices.length;at+=3){const x=indices[at]!,y=indices[at+1]!,z=indices[at+2]!;if(x===y||y===z||z===x)continue;for(const[u,v,w]of[[x,y,z],[y,z,x],[z,x,y]]){const k=key(u!,v!),prior=opposites.get(k);if(prior===undefined||w!<prior)opposites.set(k,w!);if(u!<v!&&u!>neighbors[v!]!)neighbors[v!]=u!;if(v!<u!&&v!>neighbors[u!]!)neighbors[u!]=v!;}}
 for(let v=0;v<count;v++)if(neighbors[v]!>=0)a[v]=neighbors[v]!;
 for(let at=0;at<indices.length;at+=3){const x=indices[at]!,y=indices[at+1]!,z=indices[at+2]!;if(x===y||y===z||z===x)continue;for(const[v,u,w]of[[x,y,z],[y,z,x],[z,x,y]]){if(b[v!]!==-1||u!>=v!||w!>=v!)continue;const opposite=opposites.get(key(u!,w!));if(opposite!==undefined&&opposite<v!){a[v!]=u!;b[v!]=w!;c[v!]=opposite;}}}
 let parallelogramVertices=0,neighborVertices=0;for(let v=0;v<count;v++){if(b[v]!>=0)parallelogramVertices++;else if(neighbors[v]!>=0)neighborVertices++;}
 return{a,b,c,parallelogramVertices,neighborVertices,sequentialVertices:count-parallelogramVertices-neighborVertices};
}
function word(view:DataView,at:number,w:number):number{return w===1?view.getUint8(at):w===2?view.getUint16(at,true):view.getUint32(at,true);}
function put(view:DataView,at:number,w:number,x:number):void{if(w===1)view.setUint8(at,x);else if(w===2)view.setUint16(at,x,true);else view.setUint32(at,x,true);}
function prediction(view:DataView,p:Plan,v:number,lane:number,width:number,w:number):number{const a=p.a[v]!;if(a<0)return 0;const first=word(view,(a*width+lane)*w,w);return p.b[v]!<0?first:first+word(view,(p.b[v]!*width+lane)*w,w)-word(view,(p.c[v]!*width+lane)*w,w);}
function residual(source:Uint8Array,p:Plan,count:number,width:number,w:number):Uint8Array{const n=count*width,out=new Uint8Array(source.length),v=new DataView(source.buffer,source.byteOffset,source.byteLength),mod=2**(w*8),half=mod/2;for(let row=0;row<count;row++)for(let lane=0;lane<width;lane++){const i=row*width+lane,delta=(word(v,i*w,w)-prediction(v,p,row,lane,width,w))>>>0,d=delta%mod,signed=d>=half?d-mod:d,zigzag=((signed<<1)^(signed>>31))>>>0;for(let byte=0;byte<w;byte++)out[byte*n+i]=zigzag>>>(8*byte)&255;}return out;}
function restore(data:Uint8Array,p:Plan,count:number,width:number,w:number):Uint8Array{const n=count*width,out=new Uint8Array(n*w),v=new DataView(out.buffer);for(let row=0;row<count;row++)for(let lane=0;lane<width;lane++){const i=row*width+lane;let zigzag=0;for(let byte=0;byte<w;byte++)zigzag|=data[byte*n+i]!<<(8*byte);const delta=(zigzag>>>1)^-(zigzag&1);put(v,i*w,w,prediction(v,p,row,lane,width,w)+delta);}return out;}
function fword(x:number):number{const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,x,true);return v.getUint32(0,true);}
function float(x:number):number{const v=new DataView(new ArrayBuffer(4));v.setUint32(0,x,true);return v.getFloat32(0,true);}
function affine(source:Uint8Array,d:Descriptor,h:AffineHint,width:number):{data:Uint8Array;domain:AffineDomain;wordBytes:number}|null{
 if(d.componentType!==5126||h.kind!=='float-affine'||h.width!==width||!Number.isSafeInteger(h.bits)||h.bits<1||h.bits>30||!Number.isFinite(h.scale)||h.scale<0||!Array.isArray(h.minimum)||h.minimum.length!==width||h.minimum.some(x=>!Number.isFinite(x)))return null;
 const domain:AffineDomain={kind:'affine',bits:h.bits,minimumWords:h.minimum.map(fword),scaleWord:fword(h.scale)},minimum=domain.minimumWords.map(float),scale=float(domain.scaleWord),wordBytes=h.bits<=16?2:4,data=new Uint8Array(d.count*width*wordBytes),input=new DataView(source.buffer,source.byteOffset,source.byteLength),output=new DataView(data.buffer),max=2**h.bits-1;
 for(let i=0;i<d.count*width;i++){const value=input.getFloat32(i*4,true),lo=minimum[i%width]!,guess=scale?Math.round((value-lo)/scale):0;let found=false;for(const q of[guess,guess-1,guess+1])if(Number.isSafeInteger(q)&&q>=0&&q<=max&&fword(Math.fround(Math.fround(q*scale)+lo))===input.getUint32(i*4,true)){put(output,i*wordBytes,wordBytes,q);found=true;break;}if(!found)return null;}return{data,domain,wordBytes};
}
export function encodeTopologyAttribute(input:TopologyAttributeInput,hint?:AffineHint):{recipe:TopologyAttributeRecipe;metrics:TopologyAttributeMetrics}{
 const{width,bytes}=descriptor(input),C=constructors[input.componentType as keyof typeof constructors]!;if(!(input.array instanceof C)||input.array.length!==input.count*width)fail('array differs from descriptor');const indexHash=indicesHash(input.indices,input.count),d:Descriptor={componentType:input.componentType,type:input.type,normalized:input.normalized,count:input.count},fallback=encodeResidualAttribute(input);
 let recipe:TopologyAttributeRecipe={version:1,kind:'residual',...d,payload:fallback.recipe},recipeBytes=exactRecipeBytes(recipe);const residualRecipeBytes=recipeBytes,candidates=[{name:'residual',bytes:recipeBytes}],metrics:TopologyAttributeMetrics={sourceBytes:input.array.byteLength,recipeBytes,residualRecipeBytes,selected:'residual',fullCandidates:0,topologyBytes:input.indices.byteLength,parentTableBytes:0,parallelogramVertices:0,neighborVertices:0,sequentialVertices:input.count,candidates,exact:true,costBasis:'Complete packAsset recipe including domain/dependency metadata and payload. Caller-supplied decoded indices and decoder closure must be charged once by the enclosing package; no parent or traversal payload.'};
 if(input.count>TOPOLOGY_PREDICTOR_POLICY.maxVertices||input.indices.length/3>TOPOLOGY_PREDICTOR_POLICY.maxTriangles){metrics.skipReason='topology work budget exceeded';return{recipe,metrics};}
 const source=canonical(input.array),p=plan(input.indices,input.count);metrics.parallelogramVertices=p.parallelogramVertices;metrics.neighborVertices=p.neighborVertices;metrics.sequentialVertices=p.sequentialVertices;
 const domains:Array<{data:Uint8Array;domain:{kind:'words'}|AffineDomain;wordBytes:number}>=[{data:source,domain:{kind:'words'},wordBytes:bytes}];if(hint){const a=affine(source,input,hint,width);if(a)domains.push(a);}
 for(const item of domains){const r=residual(item.data,p,input.count,width,item.wordBytes),candidate:TopologyAttributeRecipe={version:1,kind:'topology',...d,predictor:'parallelogram-parent-v1',indexCount:input.indices.length,indexHash,wordBytes:item.wordBytes,domain:item.domain,payload:{codec:'zlib',parameters:{version:1},sourceLength:r.length,data:zlibSync(r,{level:TOPOLOGY_PREDICTOR_POLICY.compressionLevel})}},cost=exactRecipeBytes(candidate);metrics.fullCandidates++;candidates.push({name:'topology-'+item.domain.kind,bytes:cost});if(cost<recipeBytes){recipe=candidate;recipeBytes=cost;metrics.selected='topology-'+item.domain.kind;}}
 metrics.recipeBytes=recipeBytes;return{recipe,metrics};
}
export function replayTopologyAttribute(recipe:TopologyAttributeRecipe,indices?:TriangleIndices):NativeArray{
 if(!recipe||recipe.version!==1)fail('invalid version');const{width,bytes}=descriptor(recipe),length=recipe.count*width*bytes;
 if(recipe.kind==='residual'){if(!recipe.payload||recipe.payload.sourceLength!==length)fail('residual extent differs');return typed(decodeBuffer(recipe.payload,length),recipe);}
 if(recipe.kind!=='topology'||recipe.predictor!=='parallelogram-parent-v1')fail('unsupported predictor');if(!indices)return fail('missing topology');int(recipe.count,0,TOPOLOGY_PREDICTOR_POLICY.maxVertices,'topology count');int(recipe.indexCount,0,TOPOLOGY_PREDICTOR_POLICY.maxTriangles*3,'topology index count');int(recipe.indexHash,0,0xffffffff,'index hash');if(indices.length!==recipe.indexCount||indicesHash(indices,recipe.count)!==recipe.indexHash)fail('topology dependency differs');
 if(!recipe.domain||!['words','affine'].includes(recipe.domain.kind))fail('invalid domain');let wordBytes=bytes,minimum:number[]=[],scale=0;
 if(recipe.domain.kind==='affine'){const a=recipe.domain;if(recipe.componentType!==5126)fail('affine domain requires Float32');int(a.bits,1,30,'affine bits');if(!Array.isArray(a.minimumWords)||a.minimumWords.length!==width)fail('invalid affine minimum');minimum=a.minimumWords.map(x=>float(int(x,0,0xffffffff,'minimum word')));scale=float(int(a.scaleWord,0,0xffffffff,'scale word'));if(minimum.some(x=>!Number.isFinite(x))||!Number.isFinite(scale)||scale<0)fail('invalid affine values');wordBytes=a.bits<=16?2:4;}
 if(recipe.wordBytes!==wordBytes||!recipe.payload||recipe.payload.codec!=='zlib'||recipe.payload.sourceLength!==recipe.count*width*wordBytes)fail('prediction extent differs');const p=plan(indices,recipe.count),data=restore(decodeBuffer(recipe.payload,recipe.count*width*wordBytes),p,recipe.count,width,wordBytes);
 if(recipe.domain.kind==='words')return typed(data,recipe);const v=new DataView(data.buffer),out=new Float32Array(recipe.count*width),max=2**recipe.domain.bits-1;for(let i=0;i<out.length;i++){const q=word(v,i*wordBytes,wordBytes);if(q>max)fail('affine code outside domain');out[i]=Math.fround(Math.fround(q*scale)+minimum[i%width]!);}return out;
}
