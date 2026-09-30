/** Fixed-budget generic native compiler with explicit lossy geometry/texture passes. */
import {normalizeAsset} from './asset-normalize-v3.ts';
import {encodeSurface,encodeResidualAttribute,encodeExactBuffer,EXACT_ENCODING_POLICY} from './optimization/exact-encoding.ts';
import {extractDracoHints,encodeAffineHint,encodeOctHint} from './optimization/draco-transforms.ts';
import {optimizeGeometry} from './optimization/geometry.ts';
import {optimizeTextures} from './optimization/textures.ts';
import {encodeExactIndexSequence} from './optimization/index-codec.ts';
import {decodeAttribute} from './asset-normal-codec-v3.ts';
import {encodeImage,decodeImageRecipe} from './asset-image-codec-v3.ts';
import {packAsset} from './asset-binary-v3.ts';
import {makeAssetZip} from './asset-package-v3.ts';
import {buildAsset,COMPILER_VERSION} from './asset-replay-v4.ts';
import {decodePng} from './png.ts';
export {buildAsset,buildFromPackage,decodePackage,COMPILER_VERSION} from './asset-replay-v4.ts';
const bytes=(a:any)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength),same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const hash=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const canonical=(x:any):string=>x===null||typeof x!=='object'?Object.is(x,-0)?'-0':JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const cost=(x:any)=>packAsset(x).length;
const encode=(b:Uint8Array,h?:any)=>encodeExactBuffer(b,h).recipe;
export async function compileAsset(input:any){
 const mode=input.mode??'lossless';if(!['lossless','bounded-lossy'].includes(mode))throw Error('Unsupported optimization mode');
 const timings:Record<string,number>={},started=performance.now();let phase=started;
 const stage=(name:string)=>{const now=performance.now();if(phase!==started){}input.onProgress?.({stage:name,done:0,total:1});return now};
 stage('normalize');const original=await normalizeAsset(input);timings.normalize=performance.now()-phase;phase=stage('source-transforms');
 const hints=await extractDracoHints(input,original);timings.sourceTransforms=performance.now()-phase;let asset=original,geometry:any=null,textures:any=null;
 if(mode==='bounded-lossy'){
  if(!input.geometry&&!input.textures)throw Error('Lossy mode requires explicit geometry and/or texture settings');
  if(input.geometry){phase=stage('geometry');const result=await optimizeGeometry(asset,{...input.geometry,mode:'bounded-lossy'});asset=result.normalized;geometry=result.report;timings.geometry=performance.now()-phase;}
  if(input.textures){phase=stage('textures');const result=optimizeTextures(asset,{...input.textures,mode:'lossy'});asset=result.asset;textures=result.report;timings.textures=performance.now()-phase;}
 }
 phase=stage('native-encoding');const json=asset.json,surfaces:any[]=[],owners=new Set<number>(),surfaceMetrics:any[]=[],affine:any[]=[],affineById=new Map<number,any>(),attributes:any[]=[],attributeMetrics:any[]=[],indices:any[]=[],indexById=new Map<number,any>();
 // Exact source grids are candidates even after vertex retention/remapping. A
 // changed value must reproduce bit-for-bit or this candidate is ineligible.
 for(let id=0;id<asset.accessors.length;id++){const a=asset.accessors[id]!,hint=hints.get(a.sourceIndex);if(hint?.kind==='float-affine'){const r=encodeAffineHint(id,a,hint,encode);if(r)affineById.set(id,r);}}
 for(let mi=0;mi<(json.meshes??[]).length;mi++)for(let pi=0;pi<json.meshes[mi].primitives.length;pi++){
  const p=json.meshes[mi].primitives[pi],id=p.attributes.POSITION,a=asset.accessors[id]!;if(a.componentType!==5126||a.type!=='VEC3')throw Error('Native surface requires Float32 VEC3 positions');
  const r=encodeSurface({positions:a.array as Float32Array,indices:p.indices===undefined?null:asset.accessors[p.indices]!.array as any,mode:p.mode??4}),candidate=affineById.get(id);
  if(candidate&&cost(candidate)<cost(r.recipe.positions)){(r.recipe as any).positions={kind:'v4-affine',accessor:id};if(!affine.some(x=>x.accessor===id))affine.push(candidate);}
  if(p.indices!==undefined){let indexCandidate=indexById.get(p.indices);if(indexCandidate===undefined){indexCandidate=(await encodeExactIndexSequence(asset.accessors[p.indices]!.array as any,{compress:true})).recipe;indexById.set(p.indices,indexCandidate);}if(cost(indexCandidate)<cost(r.recipe.topology)){if(!indices.some(x=>x.accessor===p.indices))indices.push({accessor:p.indices,recipe:indexCandidate});(r.recipe as any).topology={kind:'v4-index',accessor:p.indices};}}
  surfaces.push({mesh:mi,primitive:pi,positionAccessor:id,indexAccessor:p.indices??null,recipe:r.recipe});surfaceMetrics.push({mesh:mi,primitive:pi,positionOperation:(r.recipe as any).positions.kind,topologyOperation:r.metrics.topologyOperation,triangles:r.metrics.explicitResidualTriangles+r.metrics.filledContourTriangles+r.metrics.stripTriangles,generatedTriangles:r.metrics.filledContourTriangles+r.metrics.stripTriangles});owners.add(id);if(p.indices!==undefined)owners.add(p.indices);
 }
 const residualAccessors:any[]=asset.accessors.map((a,id)=>{if(owners.has(id))return null;const r=encodeResidualAttribute(a),hint=hints.get(a.sourceIndex),candidate=affineById.get(id);if(candidate&&cost(candidate)<cost(r.recipe)){affine.push(candidate);attributeMetrics.push({accessor:id,selected:'source-float-affine'});return{kind:'v4-affine',accessor:id};}if(hint?.kind==='octahedral'){const oct=encodeOctHint(a,hint,encode);if(oct&&cost(oct)<cost(r.recipe)&&same(bytes(decodeAttribute(oct)),bytes(a.array))){attributes.push({accessor:id,recipe:oct});attributeMetrics.push({accessor:id,selected:'source-octahedral'});return null;}}attributeMetrics.push({accessor:id,selected:r.recipe.codec});return r.recipe;});
 // A shared position may have chosen an affine rule in one owner. All owners
 // must use the same exact coordinates while retaining independent topology.
 for(const r of affine)for(const s of surfaces)if(s.positionAccessor===r.accessor)(s.recipe as any).positions={kind:'v4-affine',accessor:r.accessor};
 for(const item of indices)for(const surface of surfaces)if(surface.indexAccessor===item.accessor)surface.recipe.topology={kind:'v4-index',accessor:item.accessor};
 const imageOverrides:any[]=[],imageMetrics:any[]=[];const images=asset.images.map((im,i)=>{const wire=encode(im.data);if(im.mimeType==='image/png'){const r=encodeImage(im,{decoderCostBytes:0});if(cost(r.recipe)<cost(wire)){imageOverrides.push({image:i,recipe:r.recipe});imageMetrics.push({image:i,codec:r.recipe.codec});return{mimeType:im.mimeType,data:null};}}imageMetrics.push({image:i,codec:wire.codec});return{mimeType:im.mimeType,data:wire};});
 const sourceStorageMetadata={buffers:(original.sourceJson.buffers??[]).map((b:any)=>{const d={...b};if(d.uri?.startsWith('data:'))d.uri={decoded:true};return d}),bufferViews:original.sourceJson.bufferViews??[],extensionsUsed:original.sourceJson.extensionsUsed??[],extensionsRequired:original.sourceJson.extensionsRequired??[]};
 const base={format:'KEEL-NATIVE-ASSET',compilerVersion:'keel-native-asset-compiler-0.2.0',mode:'lossless',json,sourceStorageMetadata,descriptors:asset.accessors.map(a=>({type:a.type,componentType:a.componentType,count:a.count,normalized:a.normalized})),residualAccessors,surfaces,images};
 const native={format:'KEEL-NATIVE-V3',compilerVersion:'keel-native-asset-compiler-0.3.0',mode,base,attributes,images:imageOverrides,positions:[]};const recipe={format:'KEEL-NATIVE-V4',compilerVersion:COMPILER_VERSION,mode,native,affine,indices},packageBytes=packAsset(recipe);timings.encoding=performance.now()-phase;phase=stage('validation');
 const built=await buildAsset(recipe),roundtrip=await normalizeAsset({files:[{name:'asset.glb',data:built.glb}],entry:'asset.glb'});
 for(let i=0;i<asset.accessors.length;i++)if(!same(bytes(asset.accessors[i]!.array),bytes(roundtrip.accessors[i]!.array)))throw Error('Native replay differs at accessor '+i);
 if(canonical(asset.json)!==canonical(roundtrip.json))throw Error('Reconstructed scene metadata differs');
 for(let i=0;i<asset.images.length;i++){const override=imageOverrides.find(x=>x.image===i),decoded=override?decodeImageRecipe(override.recipe):null;if(decoded?.kind==='rgba'){const a=decodePng(asset.images[i]!.data),b=decodePng(roundtrip.images[i]!.data);if(a.width!==b.width||a.height!==b.height||!same(a.data,b.data))throw Error('Exact encoded image pixels differ')}else if(!same(asset.images[i]!.data,roundtrip.images[i]!.data))throw Error('Encoded image bytes differ')}
 // Geometry remapping is allowed to change accessor references/counts, but rig,
 // clips, transforms and materials must be structurally unchanged in both modes.
 for(const key of['nodes','skins','animations','materials','samplers','textures','cameras','scenes','scene'])if(canonical(original.json[key]??null)!==canonical(asset.json[key]??null))throw Error('Protected scene record changed: '+key);
 if(mode==='lossless'){if(asset.accessors.length!==original.accessors.length)throw Error('Lossless accessor count changed');for(let i=0;i<original.accessors.length;i++)if(!same(bytes(original.accessors[i]!.array),bytes(roundtrip.accessors[i]!.array)))throw Error('Lossless source values changed')}
 timings.validation=performance.now()-phase;timings.total=performance.now()-started;
 const program=`// ${COMPILER_VERSION}; binary rules and residuals are in asset-data.kap.\nimport {buildFromPackage} from './asset-decoder.mjs';\nexport async function build(data){if(!data){const url=new URL('./asset-data.kap',import.meta.url);if(typeof process!=='undefined'&&process.versions?.node){data=new Uint8Array(await(await import('node:fs/promises')).readFile(url));}else{const r=await fetch(url);if(!r.ok)throw Error('Asset data unavailable');data=new Uint8Array(await r.arrayBuffer());}}return buildFromPackage(data);}\n`;
 const manifest={compilerVersion:COMPILER_VERSION,mode,representation:'native-code',sourceBytes:input.files.reduce((n:number,f:any)=>n+f.data.length,0),sourceByteScope:'selected input closure',packageBytes:packageBytes.length,packageSha256:await hash(packageBytes),outputSha256:await hash(built.glb),sourceSha256:original.source.files.find(f=>f.name===original.source.entry)?.sha256,features:{meshes:(json.meshes??[]).length,primitives:surfaces.length,nodes:(json.nodes??[]).length,images:images.length,skins:(json.skins??[]).length,animations:(json.animations??[]).length},settings:{encoding:EXACT_ENCODING_POLICY,geometry:geometry?.settings??null,textures:textures?.settings??null},passes:{surfaces:surfaceMetrics,attributes:attributeMetrics,affineRules:affine.length,indexRules:indices.length,imageRules:imageMetrics,geometry,textures},validation:{decodedCandidateExact:true,losslessSourceAccessorsExact:mode==='lossless',sceneRecordsPreserved:true,glbReimportExact:true,geometryScope:geometry?'finite sampled bidirectional surfaces and animation poses':'unchanged topology',textureScope:textures?'full source-resolution reconstructed pixel errors in texture report':'exact image pixels'},runtime:{required:['asset.generated.mjs','asset-data.kap','asset-decoder.mjs'],includedInPackageBytes:false,encoderDependenciesRequiredForReplay:false},warnings:[...original.validation.warnings,'Lossy geometry checks are sampled; no continuous-time, all-surface or screen-space guarantee.','No hidden/occluded geometry is removed by assumption.','A complete executable package may be larger than the source; all runtime and residual data must be counted.']};
 return{packageBytes,program,manifest,preview:{name:'asset.glb',data:built.glb,files:[{name:'asset.glb',data:built.glb}]},nativeScene:built.scene,timings};
}
export function makeNativeArchive(result:any,support:any){for(const name of['LICENSE-KEEL.txt','LICENSE-fflate.txt','LICENSE-Draco-Apache-2.0.txt','LICENSE-meshoptimizer.txt'])if(!support.licenses.some((f:any)=>f.name===name))throw Error('Missing runtime license '+name);return makeAssetZip([{name:'asset.generated.mjs',data:result.program},{name:'asset-data.kap',data:result.packageBytes},{name:'asset-decoder.mjs',data:support.decoder},{name:'manifest.json',data:JSON.stringify(result.manifest,null,2)},{name:'README.txt',data:'KEEL native compiler v0.4. Keep program, binary data and decoder together; await build() reconstructs native surfaces and a GLB. See manifest for exact/lossy scope and measurements. Encoder-only simplification and image codecs are not needed at replay.\n'},...support.licenses])}
