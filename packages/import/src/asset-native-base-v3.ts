// V3-compatible baseline emitter. Frozen v2 source remains unchanged.
/** Native scene reconstruction compiler. Semantic losslessness is relative to
 * decoded glTF accessors (including the original Draco decoder's output), not
 * byte identity of the original container. No source GLB is stored in recipes. */
import { normalizeAsset } from './asset-normalize-v3.ts';
import type { NormalizeAssetInput } from './asset-normalize-v3.ts';
export interface NativeCompileProgress { stage:'normalize'|'surfaces'|'attributes'|'images'|'validate';done:number;total:number }
export interface NativeCompileInput extends NormalizeAssetInput { mode?:'lossless';onProgress?:(event:NativeCompileProgress)=>void }
import { compileSurface, replaySurface } from './asset-native-surface-v3.ts';
import { encodeBuffer, decodeBuffer } from './asset-buffer-codec.ts';
export const COMPILER_VERSION = 'keel-native-asset-compiler-0.2.0';
const te = new TextEncoder(), td = new TextDecoder('utf-8', {fatal:true});
const MAX = 256 * 1024 * 1024;
const ctors: Record<number, any> = {5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const components: Record<string, number> = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
function fail(s:string):never{throw Error('Native asset compiler: '+s)}
function bytes(a:any):Uint8Array{return new Uint8Array(a.buffer,a.byteOffset,a.byteLength)}
function same(a:Uint8Array,b:Uint8Array):boolean{return a.length===b.length&&a.every((v,i)=>v===b[i])}
const hash=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a)))).map(v=>v.toString(16).padStart(2,'0')).join('');
function b64(a:Uint8Array):string{let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s)}
function validLargeBase64(s:string):boolean {const pad=s.endsWith('==')?2:s.endsWith('=')?1:0,at=s.indexOf('=');return s.length%4===0&&!/[^A-Za-z0-9+/=]/.test(s)&&(at===-1||at===s.length-pad)}
function unb64(s:string):Uint8Array{if(typeof s!=='string'||s.length>MAX*1.4||!validLargeBase64(s))fail('invalid base64');return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function canonical(x:any):string{if(x===null||typeof x!=='object')return Object.is(x,-0)?'-0':JSON.stringify(x);if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}'}
function clone(x:any):any{return JSON.parse(canonical(x))}
function encodeData(a:Uint8Array,hints?:any){const e=encodeBuffer(a,hints);return{codec:e.codec,parameters:e.parameters,sourceLength:e.sourceLength,data:b64(e.data)}}
function decodeData(e:any):Uint8Array{if(!e||!Number.isSafeInteger(e.sourceLength)||e.sourceLength<0||e.sourceLength>MAX)fail('invalid data length');return decodeBuffer({...e,data:unb64(e.data)},MAX)}
function typed(componentType:number,data:Uint8Array){const C=ctors[componentType];if(!C||data.length%C.BYTES_PER_ELEMENT)fail('invalid typed data');return new C(new Uint8Array(data).buffer)}
function numeric(a:any,info:any):number[]{const xs=Array.from(a) as number[];if(!info.normalized)return xs;const t=info.componentType;return xs.map(x=>t===5120?Math.max(-1,x/127):t===5121?x/255:t===5122?Math.max(-1,x/32767):t===5123?x/65535:t===5125?x/4294967295:x)}
function accessorBytes(a:any,info:any):Uint8Array{
  const raw=bytes(a),m=/^MAT([234])$/.exec(info.type);if(!m)return raw;
  const n=Number(m[1]),w=a.BYTES_PER_ELEMENT,col=Math.ceil(n*w/4)*4;if(col===n*w)return raw;
  const out=new Uint8Array(info.count*n*col);for(let e=0;e<info.count;e++)for(let c=0;c<n;c++)out.set(raw.subarray((e*n*n+c*n)*w,(e*n*n+c*n+n)*w),e*n*col+c*col);return out;
}
export function writeNativeGlb(jsonInput:any,accessors:any[],images:any[]):Uint8Array{
  const json=clone(jsonInput),views:any[]=[],parts:Uint8Array[]=[];let total=0;
  const append=(b:Uint8Array)=>{const pad=(4-total%4)%4;if(pad){parts.push(new Uint8Array(pad));total+=pad}const i=views.length;views.push({buffer:0,byteOffset:total,byteLength:b.length});parts.push(b);total+=b.length;return i};
  if((json.accessors??[]).length!==accessors.length||(json.images??[]).length!==images.length)fail('scene table lengths differ');
  if(json.accessors!==undefined)json.accessors=json.accessors.map((a:any,i:number)=>{const d={...a};delete d.sparse;delete d.byteOffset;d.bufferView=append(accessorBytes(accessors[i],d));return d});
  if(json.images!==undefined)json.images=json.images.map((im:any,i:number)=>{const d={...im};delete d.uri;d.bufferView=append(images[i].data);d.mimeType=images[i].mimeType;return d});
  if(views.length){json.bufferViews=views;json.buffers=[{byteLength:total}]}else{delete json.bufferViews;delete json.buffers}
  const j=te.encode(canonical(json)),jl=(j.length+3)&~3,bl=(total+3)&~3,out=new Uint8Array(12+8+jl+(total?8+bl:0)),dv=new DataView(out.buffer);
  dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,out.length,true);dv.setUint32(12,jl,true);dv.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jl);out.set(j,20);if(total){dv.setUint32(20+jl,bl,true);dv.setUint32(24+jl,0x004e4942,true);let off=28+jl;for(const p of parts){out.set(p,off);off+=p.length}}return out;
}
export async function compileAsset(input:NativeCompileInput){
  if(input.mode!==undefined&&input.mode!=='lossless')fail('only semantic lossless mode is implemented');
  const progress=(stage:NativeCompileProgress['stage'],done:number,total:number)=>input.onProgress?.({stage,done,total});progress('normalize',0,1);
  const normalized:any=await normalizeAsset(input),json=normalized.json,sourceAccessors=normalized.accessors;
  progress('normalize',1,1);const surfaceTotal=(json.meshes??[]).reduce((n:number,m:any)=>n+m.primitives.length,0);
  const surfaces:any[]=[],owners=new Set<number>(),metrics:any[]=[];
  for(let mi=0;mi<(json.meshes??[]).length;mi++)for(let pi=0;pi<json.meshes[mi].primitives.length;pi++){
    const p=json.meshes[mi].primitives[pi],pos=p.attributes?.POSITION;if(!Number.isInteger(pos)||!sourceAccessors[pos])fail('primitive requires POSITION');
    const a=sourceAccessors[pos];if(a.componentType!==5126||a.type!=='VEC3')fail('v0.2 native surface requires Float32 VEC3 POSITION');
    const ix=p.indices!==undefined?sourceAccessors[p.indices].array:null;
    progress('surfaces',surfaces.length,surfaceTotal);
    const compiled:any=compileSurface({positions:a.array,indices:ix,mode:p.mode??4});
    surfaces.push({mesh:mi,primitive:pi,positionAccessor:pos,indexAccessor:p.indices??null,recipe:compiled.recipe});metrics.push({mesh:mi,primitive:pi,...compiled.metrics});owners.add(pos);if(p.indices!==undefined)owners.add(p.indices);
  }
  progress('surfaces',surfaces.length,surfaceTotal);progress('attributes',0,sourceAccessors.length);
  const descriptors=sourceAccessors.map((a:any)=>({type:a.type,componentType:a.componentType,normalized:a.normalized,count:a.count}));
  const residualAccessors=sourceAccessors.map((a:any,i:number)=>owners.has(i)?null:encodeData(bytes(a.array),{stride:components[a.type]!*a.array.BYTES_PER_ELEMENT,componentBytes:a.array.BYTES_PER_ELEMENT}));
  progress('attributes',sourceAccessors.length,sourceAccessors.length);progress('images',0,normalized.images.length);
  const imageData=normalized.images.map((im:any)=>({mimeType:im.mimeType,data:encodeData(im.data)}));
  progress('images',normalized.images.length,normalized.images.length);progress('validate',0,1);
  const sourceStorageMetadata={buffers:(normalized.sourceJson.buffers??[]).map((b:any)=>{const d={...b};if(typeof d.uri==='string'&&d.uri.startsWith('data:'))d.uri={embeddedDataPreservedAsDecodedAccessors:true};return d}),bufferViews:normalized.sourceJson.bufferViews??[],extensionsUsed:normalized.sourceJson.extensionsUsed??[],extensionsRequired:normalized.sourceJson.extensionsRequired??[],primitiveCompression:(normalized.sourceJson.meshes??[]).map((m:any)=>m.primitives.map((p:any)=>p.extensions?.KHR_draco_mesh_compression??null))};
  const recipe={sourceStorageMetadata,format:'KEEL-NATIVE-ASSET',compilerVersion:COMPILER_VERSION,mode:'lossless',json,descriptors,residualAccessors,surfaces,images:imageData};
  const built=await buildNativeAsset(recipe);
  for(let i=0;i<sourceAccessors.length;i++)if(!same(bytes(sourceAccessors[i].array),bytes(built.accessors[i])))fail('reconstructed accessor differs: '+i);
  for(let i=0;i<normalized.images.length;i++)if(!same(normalized.images[i].data,built.images[i].data))fail('image bytes differ');
  // Re-import the exported, constructed model through the same generic parser.
  const roundtrip:any=await normalizeAsset({files:[{name:'asset.glb',data:built.glb}],entry:'asset.glb'});
  for(let i=0;i<sourceAccessors.length;i++)if(!same(bytes(sourceAccessors[i].array),bytes(roundtrip.accessors[i].array)))fail('GLB roundtrip accessor differs: '+i);
  if(canonical(roundtrip.json)!==canonical(normalized.json))fail('GLB roundtrip scene metadata differs');
  const packageBytes=te.encode(canonical(recipe));
  const program=`// ${COMPILER_VERSION}: executed native surfaces and exact residual attributes.\nimport {buildNativeAsset} from './asset-decoder.mjs';\nexport const recipe=${canonical(recipe)};\nexport const build=()=>buildNativeAsset(recipe);\n`;
  const entry=input.files.find((f:any)=>f.name===input.entry)?.data??input.files[0]!.data;
  const manifest={compilerVersion:COMPILER_VERSION,mode:'lossless',losslessDefinition:'Every decoded accessor byte, image byte and normalized scene/rig/material/morph/animation record is exact; original compressed container bytes may change.',sourceBytes:input.files.reduce((n:number,f:any)=>n+f.data.length,0),packageBytes:packageBytes.length,sourceSha256:normalized.source.files.find((f:any)=>f.name===normalized.source.entry)?.sha256??await hash(entry),outputSha256:await hash(built.glb),packageSha256:await hash(packageBytes),features:{meshes:(json.meshes??[]).length,primitives:surfaces.length,nodes:(json.nodes??[]).length,materials:(json.materials??[]).length,images:normalized.images.length,skins:(json.skins??[]).length,animations:(json.animations??[]).length,animationChannels:(json.animations??[]).reduce((n:number,a:any)=>n+a.channels.length,0),morphTargets:(json.meshes??[]).reduce((n:number,m:any)=>n+m.primitives.reduce((n:number,p:any)=>n+(p.targets??[]).length,0),0)},passes:{nativeSurfaces:metrics,residualAccessorCount:residualAccessors.filter(Boolean).length},validation:{decodedAccessorsExact:true,imageBytesExact:true,sceneMetadataExact:true,glbReimportExact:true,resourceBytesExact:false},runtime:{required:'asset-decoder.mjs',includedInPackageBytes:false,dracoDecode:'compile-time only when source requires Draco'},warnings:[...(normalized.validation.warnings??[]),'Source buffer/view layout metadata is retained in native-scene provenance; generated GLB storage layout changes.','Semantic lossless output is relative to decoded source geometry, including source Draco quantization.','Native MeshData carries core vertex fields; all additional attributes and material/morph/animation records remain in the extended native scene and exported GLB.','Compression improvement is not guaranteed.'],limits:{qualityMode:false}};
  progress('validate',1,1);
  return{packageBytes,program,manifest,preview:{name:'asset.glb',data:built.glb,files:[{name:'asset.glb',data:built.glb}]},nativeScene:built.scene};
}
export async function buildNativeAsset(recipe:any){
  if(!recipe||recipe.format!=='KEEL-NATIVE-ASSET'||recipe.compilerVersion!==COMPILER_VERSION||recipe.mode!=='lossless')fail('unsupported recipe');
  if(!Array.isArray(recipe.descriptors)||!Array.isArray(recipe.surfaces)||recipe.descriptors.length>1000000)fail('invalid recipe tables');
  let total=0;for(const d of recipe.descriptors){if(!ctors[d.componentType]||!components[d.type]||!Number.isSafeInteger(d.count)||d.count<0)fail('invalid accessor descriptor');total+=d.count*components[d.type]!*ctors[d.componentType].BYTES_PER_ELEMENT;if(total>MAX)fail('native asset exceeds memory budget')}
  const accessors:any[]=recipe.descriptors.map((d:any,i:number)=>recipe.residualAccessors[i]?typed(d.componentType,decodeData(recipe.residualAccessors[i])):null),nativePrimitives:any[]=[];
  const assign=(id:number,a:any)=>{const d=recipe.descriptors[id];if(!d)fail('invalid surface accessor');const expected=d.count*components[d.type]!;if(a.length!==expected)fail('surface accessor size mismatch');const output=a.constructor===ctors[d.componentType]?a:new ctors[d.componentType](a);if(accessors[id]&&!same(bytes(accessors[id]),bytes(output)))fail('shared surface accessor conflict');accessors[id]=output};
  for(const s of recipe.surfaces){const replayed:any=replaySurface(s.recipe),mesh=replayed.mesh??replayed.native??replayed;const p=recipe.json.meshes[s.mesh].primitives[s.primitive];assign(s.positionAccessor,replayed.positions??new Float32Array(mesh.positions));if(s.indexAccessor!==null)assign(s.indexAccessor,replayed.indices??new Uint32Array(mesh.indices));nativePrimitives.push({mesh:s.mesh,primitive:s.primitive,mode:p.mode??4,material:p.material??null,geometry:mesh,attributes:p.attributes,targets:p.targets??[]})}
  for(let i=0;i<accessors.length;i++)if(!accessors[i]||accessors[i].length!==recipe.descriptors[i].count*components[recipe.descriptors[i].type]!)fail('missing or invalid reconstructed accessor');
  for(const p of nativePrimitives){const a=p.attributes,m=p.geometry;if(a.TEXCOORD_0!==undefined)m.uvs=numeric(accessors[a.TEXCOORD_0],recipe.descriptors[a.TEXCOORD_0]);if(a.JOINTS_0!==undefined)m.joints=Array.from(accessors[a.JOINTS_0]);if(a.WEIGHTS_0!==undefined)m.weights=numeric(accessors[a.WEIGHTS_0],recipe.descriptors[a.WEIGHTS_0]);if(a.COLOR_0!==undefined){const c=numeric(accessors[a.COLOR_0],recipe.descriptors[a.COLOR_0]);m.colours=recipe.descriptors[a.COLOR_0].type==='VEC3'?c.flatMap((v:number,i:number)=>i%3===2?[v,1]:[v]):c}}
  for(const image of recipe.images){if(!Number.isSafeInteger(image?.data?.sourceLength)||image.data.sourceLength<0)fail('invalid image length');total+=image.data.sourceLength;if(total>MAX)fail('native asset exceeds image budget')}
  const images=recipe.images.map((im:any)=>({mimeType:im.mimeType,data:decodeData(im.data)}));
  const scene={format:'KEEL-NATIVE-SCENE',version:2,sourceStorageMetadata:recipe.sourceStorageMetadata,json:recipe.json,primitives:nativePrimitives,accessors,images};
  return{scene,accessors,images,glb:writeNativeGlb(recipe.json,accessors,images)};
}
export async function decodePackage(packageBytes:Uint8Array){if(packageBytes.length>MAX*2)fail('package too large');const recipe=JSON.parse(td.decode(packageBytes));const built=await buildNativeAsset(recipe);return{entry:'asset.glb',files:[{name:'asset.glb',data:built.glb}],nativeScene:built.scene}}
