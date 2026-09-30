/** v3 composes measured, exact attribute/image operations and optional bounded
 * base-position quantization. v2 remains a frozen replay dependency. */
import {compileAsset as compileV2,writeNativeGlb} from './asset-native-base-v3.ts';
import {normalizeAsset,validatePreservedContainer} from './asset-normalize-v3.ts';
import {encodeAttribute,decodeAttribute} from './asset-normal-codec-v3.ts';
import {encodeImage,decodeImageRecipe,imageRecipeToBytes} from './asset-image-codec-v3.ts';
import {quantizePositionAccessorsWithRecipes,replayQuantizedPositions} from './asset-position-quantize-v3.ts';
import {packAsset,unpackAsset,nativeV2RecipeToBinaryTree,binaryTreeToNativeV2Recipe} from './asset-binary-v3.ts';
import {decodePng} from './png.ts';
import {zlibSync} from 'fflate';
import {decodeBuffer} from './asset-buffer-codec.ts';
import {replaySurface} from './asset-native-surface-v3.ts';
import {makeNativeArchive} from './asset-package-v3.ts';
export {makeNativeArchive} from './asset-package-v3.ts';
export const COMPILER_VERSION='keel-native-asset-compiler-0.3.0';
const utf8=new TextEncoder();
const bytes=(a:any)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const hash=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a)))).map(x=>x.toString(16).padStart(2,'0')).join('');
function fail(s:string):never{throw Error('Native compiler v3: '+s)}
function canonical(x:any):string{if(x===null||typeof x!=='object')return Object.is(x,-0)?'-0':JSON.stringify(x);if(Array.isArray(x))return'['+x.map(canonical).join(',')+']';return'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}'}
const size=(x:any)=>packAsset(x).length;
function originalStorage(json:any){return{buffers:(json.buffers??[]).map((b:any)=>{const d={...b};if(typeof d.uri==='string'&&d.uri.startsWith('data:'))d.uri={embeddedDataPreservedAsDecodedAccessors:true};return d}),bufferViews:json.bufferViews??[],extensionsUsed:json.extensionsUsed??[],extensionsRequired:json.extensionsRequired??[],primitiveCompression:(json.meshes??[]).map((m:any)=>m.primitives.map((p:any)=>p.extensions?.KHR_draco_mesh_compression??null))}}
export async function compileAsset(input:any){
 const mode=input.mode??'lossless';if(!['lossless','bounded-lossy'].includes(mode))fail('unsupported mode');
 const original:any=await normalizeAsset(input);let candidate=original,quantized:any=null,worldGate:any=null;
 if(mode==='bounded-lossy'){
  if(input.maxRelativeError===undefined&&input.maxAbsoluteError===undefined)fail('lossy mode requires an explicit source-mesh error budget');
  if(input.maxWorldError!==undefined&&typeof input.validateWorldError!=='function')fail('world error cap requires an explicit sampling validator');
  for(let attempt=0;attempt<3;attempt++){
   const scale=2**-attempt;quantized=quantizePositionAccessorsWithRecipes(original,{mode:'bounded-lossy',...(input.maxRelativeError===undefined?{}:{maxRelativeError:input.maxRelativeError*scale}),...(input.maxAbsoluteError===undefined?{}:{maxAbsoluteError:input.maxAbsoluteError*scale}),minBits:input.minBits??8,maxBits:input.maxBits??24});candidate=quantized.normalized;
   if(input.maxWorldError===undefined)break;
   worldGate=await input.validateWorldError(original,candidate,{maxWorldError:input.maxWorldError});if(worldGate.passed)break;
   if(attempt===2){candidate=original;quantized=null;worldGate={...worldGate,selectedUnchangedPositions:true,reason:'No tried position candidate passed the sampled world-space cap'};}
  }
 }
 input.onProgress?.({stage:'native-base',done:0,total:1});
 const baseInput=mode==='lossless'?input:{files:[{name:'normalized.glb',data:writeNativeGlb(candidate.json,candidate.accessors.map((a:any)=>a.array),candidate.images)}],entry:'normalized.glb',mode:'lossless',onProgress:input.onProgress};
 const baseResult=await compileV2(baseInput),base=nativeV2RecipeToBinaryTree(JSON.parse(new TextDecoder().decode(baseResult.packageBytes)));base.sourceStorageMetadata=originalStorage(original.sourceJson);
 const attributes:any[]=[],images:any[]=[],positions:any[]=[],attributeStats:any[]=[],imageStats:any[]=[];
 for(let i=0;i<candidate.accessors.length;i++)if(base.residualAccessors[i]){
  input.onProgress?.({stage:'exact-attributes',done:i,total:candidate.accessors.length});const encoded=encodeAttribute(candidate.accessors[i]),old=base.residualAccessors[i];
  if(size(encoded.recipe)<size(old)){attributes.push({accessor:i,recipe:encoded.recipe});base.residualAccessors[i]=null;attributeStats.push({accessor:i,...encoded.metrics});}
 }
 for(const q of quantized?.positionRecipes??[]){const owners=base.surfaces.filter((s:any)=>s.positionAccessor===q.accessor);if(!owners.length)continue;const oldCost=owners.reduce((n:number,s:any)=>n+size(s.recipe.positions),0),copy=structuredClone(q.recipe);if(copy.codes){delete copy.codes.candidates;if(typeof copy.codes.data==='string')copy.codes.data=Uint8Array.from(atob(copy.codes.data),(c:string)=>c.charCodeAt(0));}
  if(size(copy)+owners.length*24<oldCost){positions.push({accessor:q.accessor,recipe:copy});for(const owner of owners)owner.recipe.positions={kind:'v3-position',accessor:q.accessor};}
 }
 for(let i=0;i<candidate.images.length;i++){
  input.onProgress?.({stage:'image-rules',done:i,total:candidate.images.length});const encoded=encodeImage(candidate.images[i],{decoderCostBytes:0});
  if(size(encoded.recipe)<size(base.images[i].data)){images.push({image:i,recipe:encoded.recipe});base.images[i].data=null;imageStats.push({image:i,...encoded.metrics});}
 }
 const recipe={format:'KEEL-NATIVE-V3',compilerVersion:COMPILER_VERSION,mode,base,attributes,images,positions},packageBytes=packAsset(recipe),built=await buildAsset(recipe);
 // The quantizer's chosen candidate is the exact replay reference. The original
 // remains the error reference, never a silently substituted source model.
 const reimport:any=await normalizeAsset({files:[{name:'asset.glb',data:built.glb}],entry:'asset.glb'}),positionIDs=new Set<number>();for(const m of original.json.meshes??[])for(const p of m.primitives)positionIDs.add(p.attributes.POSITION);
 for(let i=0;i<candidate.accessors.length;i++)if(!same(bytes(candidate.accessors[i].array),bytes(reimport.accessors[i].array)))fail('reconstructed accessor differs: '+i);
 for(let i=0;i<original.accessors.length;i++)if((mode==='lossless'||!positionIDs.has(i))&&!same(bytes(original.accessors[i].array),bytes(reimport.accessors[i].array)))fail('non-lossy source accessor differs: '+i);
 if(canonical(original.json)!==canonical(reimport.json))fail('scene metadata differs');
 for(let i=0;i<original.images.length;i++){const changed=images.find(x=>x.image===i),decoded=changed?decodeImageRecipe(changed.recipe):null;if(decoded?.kind==='rgba'){const a=decodePng(original.images[i].data),b=decodePng(reimport.images[i].data);if(a.width!==b.width||a.height!==b.height||!same(a.data,b.data))fail('image pixels differ: '+i)}else if(!same(original.images[i].data,reimport.images[i].data))fail('original image bytes differ: '+i)}
 const program=`// ${COMPILER_VERSION}. All binary data is in the counted companion asset-data.kap.\nimport {buildFromPackage} from './asset-decoder.mjs';\nexport async function build(data){if(!data){const url=new URL('./asset-data.kap',import.meta.url);if(typeof process!=='undefined'&&process.versions?.node){const fs=await import('node:fs/promises');data=new Uint8Array(await fs.readFile(url));}else{const response=await fetch(url);if(!response.ok)throw Error('Asset data unavailable');data=new Uint8Array(await response.arrayBuffer());}}return buildFromPackage(data);}\n`;
 const manifest={compilerVersion:COMPILER_VERSION,mode,losslessDefinition:'Exact decoded accessor values and image pixels/color metadata; source container and eligible PNG encoding bytes may change. Bounded-lossy changes base POSITION only within reported source-mesh bounds.',representation:'native-code',sourceBytes:input.files.reduce((n:number,f:any)=>n+f.data.length,0),sourceByteScope:'selected input files; unrelated folder files are not counted as a compression win',packageBytes:packageBytes.length,packageSha256:await hash(packageBytes),sourceSha256:original.source.files.find((f:any)=>f.name===original.source.entry)?.sha256,outputSha256:await hash(built.glb),features:baseResult.manifest.features,passes:{surfaces:baseResult.manifest.passes,attributes:attributeStats,images:imageStats,positionQuantization:quantized?.report??null,worldGate},validation:{exactDecodedReplay:true,nonPositionAccessorsExact:true,positionValuesExact:[...positionIDs].every(id=>same(bytes(original.accessors[id].array),bytes(reimport.accessors[id].array))),imagePixelsExact:true,sceneMetadataExact:true,glbReimportExact:true,resourceBytesExact:false},runtime:{required:['asset.generated.mjs','asset-data.kap','asset-decoder.mjs'],includedInPackageBytes:false},warnings:[...(original.validation.warnings??[]),'Native script, binary data and complete decoder must all be counted.','Lossy position error budgets are in source-mesh coordinates; any world gate is explicitly sampled, not an all-time proof.','Semantic image losslessness preserves exact decoded RGBA and eligible color metadata; unsupported profiles/images retain original file bytes.','A smaller output is not guaranteed.']};
 const native={packageBytes,program,manifest,preview:{name:'asset.glb',data:built.glb,files:[{name:'asset.glb',data:built.glb}]},nativeScene:built.scene};
 // Explicit opt-in no-growth policy. This is preserved original data, never
 // labelled generated native code. Multi-file savings are not inferred here.
 if(input.selection==='prefer-smaller'&&input.files.length===1){
  const source=input.files[0].data;if(!(input.decoderBytes instanceof Uint8Array)||!Array.isArray(input.licenses))fail('smaller-output selection requires the actual decoder and distribution licenses');
  const nativeCost=zlibSync(makeNativeArchive(native,{decoder:input.decoderBytes,licenses:input.licenses}),{level:9}).length,sourceCost=zlibSync(source,{level:9}).length;
  if(nativeCost>=sourceCost)return{packageBytes:source,program:null,manifest:{...manifest,representation:'original-preserved',packageBytes:source.length,packageSha256:await hash(source),outputSha256:await hash(source),validation:{resourceBytesExact:true,unchangedSource:true},selection:{codec:'zlib-level9',nativeCost,sourceCost,reason:'No smaller native candidate under measured data+program+decoder metric; original retained',archiveWrapperExcluded:false}},preview:{name:input.files[0].name,data:source,files:input.files},nativeCandidate:native};
 }
 return native;
}
export function preflightNativeRecipe(recipe:any,additionalBytes=0):void{
 if(!recipe||recipe.format!=='KEEL-NATIVE-V3'||recipe.compilerVersion!==COMPILER_VERSION||!['lossless','bounded-lossy'].includes(recipe.mode))fail('unsupported v3 recipe');const base=recipe.base;
 const C:Record<number,any>={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},N:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
 // Preflight the whole reconstruction before allocating any decoded payload.
 const LIMIT=256*1024*1024,MAX_RECORDS=100000;let total=0;
 const charge=(n:any,label:string)=>{if(!Number.isSafeInteger(n)||n<0)fail('invalid '+label+' budget');total+=n;if(total>LIMIT)fail('aggregate decoded budget exceeded')};
 charge(additionalBytes,'additional replay');
 const list=(a:any,label:string)=>{if(!Array.isArray(a)||a.length>MAX_RECORDS)fail('invalid '+label+' table');return a};
 list(base?.descriptors,'descriptor');list(base?.residualAccessors,'residual');list(base?.surfaces,'surface');list(base?.images,'image');
 if(base.residualAccessors.length!==base.descriptors.length)fail('residual descriptor count differs');
 const extent=(d:any)=>{if(!d||!Object.hasOwn(C,d.componentType)||!Object.hasOwn(N,d.type)||!Number.isSafeInteger(d.count)||d.count<0||typeof d.normalized!=='boolean')fail('invalid descriptor');return d.count*N[d.type]!*C[d.componentType].BYTES_PER_ELEMENT};
 for(const d of base.descriptors)charge(extent(d),'accessor');
 const target=(id:any)=>{if(!Number.isSafeInteger(id)||id<0||id>=base.descriptors.length)fail('invalid override target');return base.descriptors[id]};
 const seenAttribute=new Set<number>(),seenPosition=new Set<number>(),seenImage=new Set<number>(),seenSurface=new Set<string>();
 for(const item of list(recipe.attributes??[],'attribute override')){const d=target(item?.accessor),r=item?.recipe;if(seenAttribute.has(item.accessor)||base.residualAccessors[item.accessor]!==null)fail('duplicate or overlapping attribute override');seenAttribute.add(item.accessor);if(!r||r.count!==d.count||r.componentType!==d.componentType||r.type!==d.type||r.normalized!==d.normalized)fail('attribute override descriptor differs')}
 for(const item of list(recipe.positions??[],'position override')){const d=target(item?.accessor),r=item?.recipe;if(seenPosition.has(item.accessor)||seenAttribute.has(item.accessor)||base.residualAccessors[item.accessor]!==null)fail('duplicate or overlapping position override');seenPosition.add(item.accessor);if(d.type!=='VEC3'||d.componentType!==5126||!r||r.vertexCount!==d.count)fail('position override descriptor differs')}
 for(const item of list(recipe.images??[],'image override')){if(!Number.isSafeInteger(item?.image)||item.image<0||item.image>=base.images.length||seenImage.has(item.image)||base.images[item.image]?.data!==null)fail('invalid or duplicate image override');seenImage.add(item.image);const r=item.recipe;if(!r||typeof r.codec!=='string')fail('invalid image recipe');if(!r.codec.startsWith('original')){if(!Number.isSafeInteger(r.width)||r.width<1||!Number.isSafeInteger(r.height)||r.height<1)fail('invalid image dimensions');charge(r.width*r.height*8,'image RGBA and output')}}
 for(let i=0;i<base.images.length;i++)if(base.images[i]?.data===null&&!seenImage.has(i))fail('missing image override');
 for(const s of base.surfaces){if(!Number.isSafeInteger(s?.mesh)||s.mesh<0||!Number.isSafeInteger(s?.primitive)||s.primitive<0)fail('invalid surface target');const key=s.mesh+':'+s.primitive;if(seenSurface.has(key))fail('duplicate surface');seenSurface.add(key);const p=base.json?.meshes?.[s.mesh]?.primitives?.[s.primitive],d=target(s.positionAccessor);if(!p||p.attributes?.POSITION!==s.positionAccessor||d.componentType!==5126||d.type!=='VEC3'||s.recipe?.vertexCount!==d.count)fail('surface position descriptor differs');if(seenAttribute.has(s.positionAccessor))fail('surface overlaps attribute override');if((s.recipe.positions?.kind==='v3-position')!==seenPosition.has(s.positionAccessor))fail('surface position override mismatch');charge(d.count*3*8,'native mesh positions');
  for(const name of ['TEXCOORD_0','JOINTS_0','WEIGHTS_0','COLOR_0'])if(p.attributes[name]!==undefined){const ad=target(p.attributes[name]),lanes=N[ad.type]!;charge(ad.count*lanes*16,'native '+name+' numeric arrays');if(name==='COLOR_0'&&ad.type==='VEC3')charge(ad.count*4*8,'expanded native colors')}
  if(s.indexAccessor!==null){const id=target(s.indexAccessor);if(p.indices!==s.indexAccessor||id.type!=='SCALAR'||![5121,5123,5125].includes(id.componentType)||s.recipe.indexCount!==id.count||s.recipe.indexType!==id.componentType||seenAttribute.has(s.indexAccessor)||seenPosition.has(s.indexAccessor))fail('surface index descriptor differs');charge(id.count*8,'native mesh indices')}else{if(p.indices!==undefined||s.recipe.indexType!==0)fail('unindexed surface descriptor differs');charge(d.count*8,'native mesh indices')}
 }
 for(const id of seenPosition)if(!base.surfaces.some((s:any)=>s.positionAccessor===id))fail('unused position override');
 // Charge every declared intermediate inflate size, including repeated references.
 const scan=(x:any,depth:number)=>{if(depth>256)fail('recipe nesting limit');if(!x||typeof x!=='object'||x instanceof Uint8Array)return;if(Object.hasOwn(x,'sourceLength'))charge(x.sourceLength,'buffer inflate');if(Object.hasOwn(x,'decodedLength'))charge(x.decodedLength,'image inflate');if(Array.isArray(x)){for(const v of x)scan(v,depth+1)}else for(const [key,v]of Object.entries(x))if(key!=='json'&&key!=='sourceStorageMetadata')scan(v,depth+1)};
 scan({residual:base.residualAccessors,surfaces:base.surfaces,images:base.images,attributes:recipe.attributes,positions:recipe.positions,imageOverrides:recipe.images},0);
}
export async function buildAsset(recipe:any){
 if(!recipe||recipe.format!=='KEEL-NATIVE-V3'||recipe.compilerVersion!==COMPILER_VERSION||!['lossless','bounded-lossy'].includes(recipe.mode))fail('unsupported v3 recipe');const base=recipe.base;
 const C:Record<number,any>={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},N:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
 preflightNativeRecipe(recipe);
 const read=(w:any)=>decodeBuffer(w,256*1024*1024),typed=(id:number,data:Uint8Array)=>{const d=base.descriptors[id],ctor=C[d.componentType];if(data.length!==d.count*N[d.type]!*ctor.BYTES_PER_ELEMENT)fail('accessor extent differs');return new ctor(new Uint8Array(data).buffer)};
 const accessors:any[]=base.residualAccessors.map((w:any,id:number)=>w?typed(id,read(w)):null);
 for(const item of recipe.attributes??[])accessors[item.accessor]=decodeAttribute(item.recipe);
 const positionMap=new Map<number,Float32Array>();for(const item of recipe.positions??[]){positionMap.set(item.accessor,replayQuantizedPositions(item.recipe));}
 const primitives:any[]=[];
 const assign=(id:number,a:any)=>{if(!base.descriptors[id])fail('invalid accessor reference');if(accessors[id]&&!same(bytes(accessors[id]),bytes(a)))fail('shared surface accessor differs');accessors[id]=a};
 for(const s of base.surfaces){const surface:any=s.recipe,changed=positionMap.get(s.positionAccessor);
  // Topology does not depend on coordinate values. The lattice supplies the
  // final coordinates directly, avoiding a large transient base64 mesh buffer.
  const replay=replaySurface(surface,changed),positions=replay.positions;assign(s.positionAccessor,positions);if(s.indexAccessor!==null)assign(s.indexAccessor,replay.indices);
  const p=base.json.meshes[s.mesh].primitives[s.primitive];primitives.push({mesh:s.mesh,primitive:s.primitive,mode:p.mode??4,material:p.material??null,geometry:replay.mesh,attributes:p.attributes,targets:p.targets??[]});
 }
 for(let i=0;i<accessors.length;i++){const d=base.descriptors[i];if(!accessors[i]||!(accessors[i] instanceof C[d.componentType])||accessors[i].length!==d.count*N[d.type]!)fail('missing or invalid accessor '+i)}
 const numeric=(id:number)=>{const d=base.descriptors[id],v=Array.from(accessors[id])as number[];return d.normalized?v.map(x=>d.componentType===5120?Math.max(-1,x/127):d.componentType===5121?x/255:d.componentType===5122?Math.max(-1,x/32767):d.componentType===5123?x/65535:d.componentType===5125?x/4294967295:x):v};
 for(const p of primitives){const a=p.attributes,m=p.geometry;if(a.TEXCOORD_0!==undefined)m.uvs=numeric(a.TEXCOORD_0);if(a.JOINTS_0!==undefined)m.joints=Array.from(accessors[a.JOINTS_0]);if(a.WEIGHTS_0!==undefined)m.weights=numeric(a.WEIGHTS_0);if(a.COLOR_0!==undefined){const c=numeric(a.COLOR_0);m.colours=base.descriptors[a.COLOR_0].type==='VEC3'?c.flatMap((v:number,i:number)=>i%3===2?[v,1]:[v]):c}}
 const changedImages=new Map((recipe.images??[]).map((im:any)=>[im.image,im.recipe]));const images=base.images.map((im:any,i:number)=>changedImages.has(i)?imageRecipeToBytes(changedImages.get(i)as any):{mimeType:im.mimeType,data:read(im.data)});
 const scene={format:'KEEL-NATIVE-SCENE',version:3,json:base.json,sourceStorageMetadata:base.sourceStorageMetadata,primitives,accessors,images};return{scene,accessors,images,glb:writeNativeGlb(base.json,accessors,images)};
}
export async function buildFromPackage(data:Uint8Array){return buildAsset(unpackAsset(data))}
export async function decodePackage(data:Uint8Array){
 let first=0;while(first<data.length&&[9,10,13,32].includes(data[first]!))first++;
 const glb=data.length>=4&&new DataView(data.buffer,data.byteOffset,data.byteLength).getUint32(0,true)===0x46546c67;
 if(glb||data[first]===123){const extension=validatePreservedContainer(data),entry='asset.'+extension;return{entry,files:[{name:entry,data}],representation:'original-preserved',validation:{containerAndResourcesValid:true,semanticValidation:'Performed by compileAsset before selecting passthrough; decode does not execute Draco'}}}
 const b=await buildFromPackage(data);return{entry:'asset.glb',files:[{name:'asset.glb',data:b.glb}],nativeScene:b.scene,representation:'native-code'};
}
