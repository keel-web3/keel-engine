/** Source-driven fixed-material preservation. No triangle approximation or image
 * quality reduction is used in either supported mode. */
import {normalizeAsset} from './asset-normalize-v3.ts';
import {extractDracoHints} from './optimization/draco-transforms.ts';
import {optimizeUnusedRenderAttributes} from './optimization/exact-geometry-experiment.ts';
import {optimizeRenderEquivalent} from './optimization/render-equivalent.ts';
import {compileCandidate} from './asset-compiler-visual.ts';
import {makeAssetZip} from './asset-package-v3.ts';
import {prepareSharedTransport} from './asset-shared-transport.ts';
import {prepareMixedPrimitives} from './asset-compiler-mixed.ts';
import {packAsset,unpackAsset} from './asset-binary-v3.ts';
import {encodeExactPngScanlines} from './optimization/exact-images-experiment.ts';
import {buildAsset,nativeBody,COMPILER_VERSION,V5_FORMAT} from './asset-replay-v5.ts';
import {decodePng} from './png.ts';
export {decodePackage,buildFromPackage,COMPILER_VERSION} from './asset-replay-v5.ts';
const raw=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength),same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const hash=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const canonical=(x:any):string=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
export async function compileAsset(input:any){
 const mode=input.mode??'visual-preservation';if(!['lossless','visual-preservation'].includes(mode))throw Error('v5 supports only exact-data or fixed-material appearance preservation');
 const started=performance.now(),timings:any={},stage=(name:string)=>input.onProgress?.({stage:name,done:0,total:1});stage('normalize');let at=performance.now();
 const source=await normalizeAsset(input);timings.normalize=performance.now()-at;stage('source-transforms');at=performance.now();const hints=await extractDracoHints(input,source);timings.sourceTransforms=performance.now()-at;
 at=performance.now();const unused=mode==='visual-preservation'?optimizeUnusedRenderAttributes(source):null,welded=mode==='visual-preservation'?optimizeRenderEquivalent(unused!.normalized):null,asset=welded?.normalized??source;timings.renderInputs=performance.now()-at;
 const result=await compileCandidate({...input,mode:'lossless'},asset,hints);Object.assign(timings,result.timings);stage('shared-transport');at=performance.now();
 let base:any,primitiveReport:any=null;
 if(mode==='lossless'&&source.validation.dracoPrimitives){const mixed=await prepareMixedPrimitives(input,result.packageBytes);base=unpackAsset(mixed.packageBytes);const {timingsMs,...stableReport}=mixed.report;primitiveReport=stableReport;}
 else base=unpackAsset(prepareSharedTransport(result.packageBytes,{separateStorageProvenance:true}).packageBytes);
 timings.transport=performance.now()-at;const body=nativeBody(base),images:any[]=[],imageReport:any[]=[],baseImageOverrides=new Set<number>(body.native.images.map((x:any)=>x.image));at=performance.now();
 // Host supplies a pinned Brotli implementation. The shared module is never
 // charged per image; every candidate includes its own headers and instructions.
 const codec=input.costCodec;
 if(codec&&(!codec.id||typeof codec.compress!=='function'))throw Error('Invalid pinned image cost codec');
 for(let i=0;i<asset.images.length;i++){
  const candidate=encodeExactPngScanlines(asset.images[i]!);if(!candidate.recipe){imageReport.push({image:i,selected:false,reason:candidate.reason});continue;}
  if(!codec){imageReport.push({image:i,selected:false,reason:'Pinned transport cost codec not supplied'});continue;}
  stage('exact-image-cost');const previous={image:body.native.base.images[i],override:body.native.images.find((x:any)=>x.image===i)??null},proposed={image:i,recipe:candidate.recipe};
  const oldBytes=(await codec.compress(packAsset(previous))).length,newBytes=(await codec.compress(packAsset(proposed))).length,selected=newBytes<oldBytes;
  if(selected){images.push(proposed);body.native.base.images[i]={mimeType:'image/png',data:null};body.native.images=body.native.images.filter((x:any)=>x.image!==i);}imageReport.push({image:i,selected,previousBrotliBytes:oldBytes,candidateBrotliBytes:newBytes,reason:candidate.reason});
 }
 timings.imageCost=performance.now()-at;const recipe={format:V5_FORMAT,compilerVersion:COMPILER_VERSION,mode,base,images},packageBytes=packAsset(recipe);stage('validation');at=performance.now();const built=await buildAsset(recipe,{dracoDecoder:input.dracoDecoder}),roundtrip=await normalizeAsset({files:[{name:'asset.glb',data:built.glb}],entry:'asset.glb'});
 if(roundtrip.accessors.length!==asset.accessors.length)throw Error('v5 accessor extent differs');
 for(let i=0;i<asset.accessors.length;i++)if(!same(raw(asset.accessors[i]!.array),raw(roundtrip.accessors[i]!.array)))throw Error('v5 retained accessor differs '+i);
 if(canonical(roundtrip.json)!==canonical(asset.json))throw Error('v5 scene metadata differs');
 for(let i=0;i<asset.images.length;i++){const a=asset.images[i]!,b=roundtrip.images[i]!;if(images.some(x=>x.image===i)||baseImageOverrides.has(i)){const ap=decodePng(a.data),bp=decodePng(b.data);if(ap.width!==bp.width||ap.height!==bp.height||!same(ap.data,bp.data))throw Error('v5 exact PNG pixels differ');}else if(!same(a.data,b.data))throw Error('v5 original image bytes differ');}
 timings.validation=performance.now()-at;timings.total=performance.now()-started;
 const requiresDraco=primitiveReport?.retainedDracoPrimitives>0;
 const program=`// ${COMPILER_VERSION}; shared reconstruction module is installed once.\nimport {buildFromPackage} from './asset-decoder.mjs';\nexport async function build(data,options={}){if(!data){const url=new URL('./asset-data.kap',import.meta.url);if(typeof process!=='undefined'&&process.versions?.node)data=new Uint8Array(await(await import('node:fs/promises')).readFile(url));else{const r=await fetch(url);if(!r.ok)throw Error('Asset data unavailable');data=new Uint8Array(await r.arrayBuffer());}}return buildFromPackage(data,options);}\n`;
 const manifest={...result.manifest,compilerVersion:COMPILER_VERSION,mode,representation:requiresDraco?'mixed-native-code':'native-code',packageBytes:packageBytes.length,packageSha256:await hash(packageBytes),outputSha256:await hash(built.glb),settings:{...result.manifest.settings,imageCostCodec:codec?.id??null},passes:{...result.manifest.passes,unusedRenderInputs:unused?.report??null,renderWeld:welded?.report??null,sourcePrimitiveCodec:primitiveReport,exactImageTransport:imageReport},validation:{decodedCandidateExact:true,losslessSourceAccessorsExact:mode==='lossless',sceneRecordsPreserved:true,glbReimportExact:true,consumedRenderInputsExact:true,geometryScope:mode==='lossless'?'all original decoded accessor values and order':'fixed standard glTF materials; all consumed ordered corner records exact; unused tangents omitted',textureScope:'exact decoded RGBA and supported color/transparency metadata; PNG encoding may change'},runtime:{required:['asset.generated.mjs','asset-data.kap','asset-decoder.mjs'],includedInPackageBytes:false,dracoRequiredForReplay:requiresDraco},warnings:mode==='visual-preservation'?['Standard glTF fixed-material rendering contract; future material edits, custom shaders and observed vertex/accessor identities are outside this scope.','All retained geometry, rig, animation and image inputs are exact. Cloud GPU parity is not verified.']:['All original decoded accessors are exact. PNG encoding bytes and original source storage layout may change.','Retained source Draco primitives use the pinned shared decoder at replay.']};
 return{packageBytes,program,manifest,preview:{name:'asset.glb',data:built.glb,files:[{name:'asset.glb',data:built.glb}]},nativeScene:built.scene,timings};
}
export function makeNativeArchive(result:any,support:any){
 for(const name of['LICENSE-KEEL.txt','LICENSE-fflate.txt','LICENSE-Draco-Apache-2.0.txt','LICENSE-meshoptimizer.txt'])if(!support.licenses?.some((f:any)=>f.name===name))throw Error('Missing runtime license '+name);
 const extras:any[]=result.manifest.runtime.dracoRequiredForReplay?(support.dracoFiles??[]):[];
 if(result.manifest.runtime.dracoRequiredForReplay)for(const name of['draco-factory.mjs','draco_decoder_gltf.wasm'])if(!extras.some(x=>x.name===name))throw Error('Missing shared Draco file '+name);
 return makeAssetZip([{name:'asset.generated.mjs',data:result.program},{name:'asset-data.kap',data:result.packageBytes},{name:'asset-decoder.mjs',data:support.decoder},{name:'manifest.json',data:JSON.stringify(result.manifest,null,2)},{name:'README.txt',data:'KEEL native v5. Run await build() from asset.generated.mjs. Shared decoder and optional pinned Draco files are reusable across assets. The KAP contains all asset-specific reconstruction instructions. Preserve-appearance mode uses a fixed standard glTF material contract; inspect manifest.\n'},...extras,...support.licenses]);
}
