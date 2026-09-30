/** Keep the accepted v4 lossy scene, then compact only unused fixed-material
 * inputs and exact texture storage. No extra triangle or texel loss is introduced
 * by these postpasses. Exact-data and appearance modes delegate to frozen v5. */
import {compileAsset as compileV5} from './asset-compiler-v5.ts';
import {makeAssetZip} from './asset-package-v3.ts';
import {normalizeAsset} from './asset-normalize-v3.ts';
import {extractDracoHints} from './optimization/draco-transforms.ts';
import {compileLossyUnusedInputsPostpassArm,assertProtectedLossyScene} from './optimization/lossy-unused-inputs-experiment.ts';
import {encodeExactPngScanlines} from './optimization/exact-images-experiment.ts';
import {nativeBody} from './asset-replay-v5.ts';
import {packAsset,unpackAsset} from './asset-binary-v3.ts';
import {decodePng} from './png.ts';
import {buildAsset,COMPILER_VERSION,V6_FORMAT} from './asset-replay-v6.ts';
export {decodePackage,buildFromPackage,COMPILER_VERSION} from './asset-replay-v6.ts';
const PROGRAM=`// keel-native-asset-compiler-0.6.0; shared reconstruction module is installed once.\nimport {buildFromPackage} from './asset-decoder.mjs';\nexport async function build(data,options={}){if(!data){const url=new URL('./asset-data.kap',import.meta.url);if(typeof process!=='undefined'&&process.versions?.node)data=new Uint8Array(await(await import('node:fs/promises')).readFile(url));else{const r=await fetch(url);if(!r.ok)throw Error('Asset data unavailable');data=new Uint8Array(await r.arrayBuffer());}}return buildFromPackage(data,options);}\n`;
const raw=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength),same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const hash=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a)))).map(v=>v.toString(16).padStart(2,'0')).join('');
export async function compileAsset(input:any){
 if(input.mode!=='bounded-lossy')return{...await compileV5(input),program:PROGRAM};
 if(!input.geometry&&!input.textures)throw Error('Lossy mode requires explicit geometry and/or texture settings');
 const started=performance.now(),timings:any={},stage=(name:string)=>input.onProgress?.({stage:name,done:0,total:1});stage('normalize');let at=performance.now();const source=await normalizeAsset(input);timings.normalize=performance.now()-at;stage('source-transforms');at=performance.now();const hints=await extractDracoHints(input,source);timings.sourceTransforms=performance.now()-at;
 const arm=await compileLossyUnusedInputsPostpassArm(input,source,hints);assertProtectedLossyScene(source,arm.normalized);Object.assign(timings,arm.timings);
 const base:any=unpackAsset(arm.packageBytes),body=nativeBody(base),images:any[]=[],imageReport:any[]=[],codec=input.costCodec;if(codec&&(!codec.id||typeof codec.compress!=='function'))throw Error('Invalid pinned image cost codec');at=performance.now();
 for(let i=0;i<arm.normalized.images.length;i++){
  const candidate=encodeExactPngScanlines(arm.normalized.images[i]!);if(!candidate.recipe||!codec){imageReport.push({image:i,selected:false,reason:!candidate.recipe?candidate.reason:'Pinned image cost codec not supplied'});continue;}
  stage('exact-image-cost');const previous={image:body.native.base.images[i],override:body.native.images.find((x:any)=>x.image===i)??null},proposed={image:i,recipe:candidate.recipe},previousBytes=(await codec.compress(packAsset(previous))).length,candidateBytes=(await codec.compress(packAsset(proposed))).length,selected=candidateBytes<previousBytes;
  if(selected){images.push(proposed);body.native.base.images[i]={mimeType:'image/png',data:null};body.native.images=body.native.images.filter((x:any)=>x.image!==i);}imageReport.push({image:i,selected,previousBrotliBytes:previousBytes,candidateBrotliBytes:candidateBytes,reason:candidate.reason});
 }
 timings.exactImageCost=performance.now()-at;const recipe=images.length?{format:V6_FORMAT,compilerVersion:COMPILER_VERSION,mode:'bounded-lossy',base,images}:base,packageBytes=packAsset(recipe);stage('postpass-validation');at=performance.now();const built=await buildAsset(recipe,{dracoDecoder:input.dracoDecoder});
 if(built.accessors.length!==arm.result.nativeScene.accessors.length)throw Error('Postpass accessor extent changed');for(let i=0;i<built.accessors.length;i++)if(!same(raw(built.accessors[i]),raw(arm.result.nativeScene.accessors[i])))throw Error('Postpass changed rendered accessor '+i);
 for(let i=0;i<built.images.length;i++){const before=arm.result.nativeScene.images[i],after=built.images[i];if(images.some(x=>x.image===i)){const a=decodePng(before.data),b=decodePng(after.data);if(a.width!==b.width||a.height!==b.height||!same(a.data,b.data))throw Error('Postpass changed texture pixels');}else if(!same(before.data,after.data))throw Error('Postpass changed image bytes');}
 timings.postpassValidation=performance.now()-at;timings.total=performance.now()-started;
 const {internalRecipe,...result}=arm.result;void internalRecipe;
 const manifest={...result.manifest,compilerVersion:COMPILER_VERSION,packageBytes:packageBytes.length,packageSha256:await hash(packageBytes),outputSha256:await hash(built.glb),settings:{...result.manifest.settings,imageCostCodec:codec?.id??null},passes:{...result.manifest.passes,renderInputPostpass:arm.preparation,exactImageTransport:imageReport},validation:{...arm.validation,sourceProtectedSceneExact:true,renderedInputsExactToAcceptedV4:true,postpassAddsNoGeometryOrTextureLoss:true},runtime:{...result.manifest.runtime,dracoRequiredForReplay:false},warnings:['Geometry and texture loss remain governed by the existing v4 sampled/error gates.','The subsequent fixed-material input and exact image postpasses add no further rendered-input loss.','Future material edits, custom shaders and observed vertex/accessor identities are outside the fixed-material contract.','Cloud GPU parity is not verified.']};
 return{...result,program:PROGRAM,packageBytes,preview:{name:'asset.glb',data:built.glb,files:[{name:'asset.glb',data:built.glb}]},nativeScene:built.scene,timings,manifest};
}

export function makeNativeArchive(result:any,support:any){
 for(const name of['LICENSE-KEEL.txt','LICENSE-fflate.txt','LICENSE-Draco-Apache-2.0.txt','LICENSE-meshoptimizer.txt'])if(!support.licenses?.some((f:any)=>f.name===name))throw Error('Missing runtime license '+name);
 const extras:any[]=result.manifest.runtime.dracoRequiredForReplay?(support.dracoFiles??[]):[];
 if(result.manifest.runtime.dracoRequiredForReplay)for(const name of['draco-factory.mjs','draco_decoder_gltf.wasm'])if(!extras.some(x=>x.name===name))throw Error('Missing shared Draco file '+name);
 return makeAssetZip([{name:'asset.generated.mjs',data:result.program},{name:'asset-data.kap',data:result.packageBytes},{name:'asset-decoder.mjs',data:support.decoder},{name:'manifest.json',data:JSON.stringify(result.manifest,null,2)},{name:'README.txt',data:'KEEL native pipeline v6. Run await build() from asset.generated.mjs. Shared decoder and optional pinned Draco files are reusable across assets. KAP contains all asset-specific instructions. Exact/appearance modes use the frozen v5 algorithm; lossy mode preserves v4 decisions and adds exact fixed-material input/image postpasses. Inspect manifest for fidelity scope.\n'},...extras,...support.licenses]);
}
