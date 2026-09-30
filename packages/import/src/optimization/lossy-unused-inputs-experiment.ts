/** Bounded experiment: omit fixed-material unused inputs, weld complete remaining
 * records, then retain the existing v4 simplification and image error gates.
 * This module is deliberately separate from the published compiler entry points.
 */
import type {NormalizedAsset} from '../asset-normalize-v3.ts';
import {compileCandidate} from '../asset-compiler-visual.ts';
import {prepareSharedTransport} from '../asset-shared-transport.ts';
import {buildFromPackage} from '../asset-replay-shared.ts';
import {optimizeUnusedRenderAttributes} from './exact-geometry-experiment.ts';
import {optimizeRenderEquivalent} from './render-equivalent.ts';
import {optimizeGeometry} from './geometry.ts';
import {optimizeTextures} from './textures.ts';

const bytes=(array:ArrayBufferView)=>new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
const equal=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const canonical=(value:any):string=>value===null||typeof value!=='object'?(Object.is(value,-0)?'-0':JSON.stringify(value)):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
const protectedKeys=['asset','nodes','skins','animations','materials','samplers','textures','cameras','scenes','scene'];

/** Compare semantic rig/clip records after accessor-table compaction, including
 * every protected accessor's exact bit pattern and descriptor. */
export function assertProtectedLossyScene(source:NormalizedAsset,candidate:NormalizedAsset):void {
 const resolved=(asset:NormalizedAsset)=>{
  const record=Object.fromEntries(protectedKeys.map(k=>[k,structuredClone(asset.json[k]??null)]));
  const accessor=(id:number)=>{
   const a=asset.accessors[id];if(!a)throw Error('Missing protected accessor '+id);
   return{type:a.type,componentType:a.componentType,normalized:a.normalized,count:a.count,bytes:Array.from(bytes(a.array))};
  };
  for(const skin of record.skins??[])if(skin.inverseBindMatrices!==undefined)skin.inverseBindMatrices=accessor(skin.inverseBindMatrices);
  for(const animation of record.animations??[])for(const sampler of animation.samplers??[]){sampler.input=accessor(sampler.input);sampler.output=accessor(sampler.output);}
  return record;
 };
 if(canonical(resolved(source))!==canonical(resolved(candidate)))throw Error('Protected scene or rig/animation accessor bytes changed');
}

export function prepareLossyUnusedInputs(source:NormalizedAsset){
 const started=performance.now(),pruned=optimizeUnusedRenderAttributes(source),pruneMs=performance.now()-started;
 const welded=optimizeRenderEquivalent(pruned.normalized),weldMs=performance.now()-started-pruneMs;
 assertProtectedLossyScene(source,welded.normalized);
 if(source.images.length!==welded.normalized.images.length||source.images.some((image,i)=>image.mimeType!==welded.normalized.images[i]!.mimeType||!equal(image.data,welded.normalized.images[i]!.data)))throw Error('Preprocessing changed an image');
 return{normalized:welded.normalized,report:{version:'keel-lossy-unused-inputs-experiment-0.1.0',pruning:pruned.report,welding:welded.report,protectedSceneExact:true,sourceImagesExact:true,contract:'Fixed core glTF materials; ordered consumed corner records exact before bounded-lossy geometry. Existing finite surface/animation and full source-resolution image gates are unchanged.'},timings:{pruneMs,weldMs,preparationMs:performance.now()-started}};
}

/** Compile either comparison arm with exactly the same existing encoder/gates.
 * The caller chooses settings and measures the entire payload with one codec.
 * A failed new arm must not replace the baseline. No new codec/search is added. */
export async function compileLossyUnusedInputsArm(input:any,source:NormalizedAsset,hints:Map<number,any>,apply:boolean){
 if(input.mode!=='bounded-lossy')throw Error('Experiment requires explicit bounded-lossy mode');
 const started=performance.now(),prepared=apply?prepareLossyUnusedInputs(source):null;
 const result=await compileCandidate(input,prepared?.normalized??source,hints);
 const transportStarted=performance.now(),transport=prepareSharedTransport(result.packageBytes,{separateStorageProvenance:false});
 const transportMs=performance.now()-transportStarted,replayStarted=performance.now(),replayed=await buildFromPackage(transport.packageBytes);
 if(!equal(replayed.glb,result.preview.data))throw Error('Shared transport replay changes candidate GLB');
 // CompileCandidate separately checks exact candidate replay, preserved scene
 // records, and all protected accessors. Preprocessing proves the bridge to source.
 return{result,packageBytes:transport.packageBytes,preparation:prepared?.report??null,timings:{...result.timings,preparation:prepared?.timings??null,transportMs,transportReplayMs:performance.now()-replayStarted,totalArmMs:performance.now()-started},validation:{...result.manifest.validation,transportReplayExact:true,preprocessingProtectedSceneExact:prepared?.report.protectedSceneExact??true},transport:transport.report};
}

/** Safer ordering: freeze the existing v4 lossy result first. The following
 * pruning/welding only changes its fixed-material render-input storage; no new
 * simplification or texture decision can change the accepted interpolation. */
export async function compileLossyUnusedInputsPostpassArm(input:any,source:NormalizedAsset,hints:Map<number,any>){
 if(input.mode!=='bounded-lossy')throw Error('Experiment requires explicit bounded-lossy mode');
 if(!input.geometry&&!input.textures)throw Error('Lossy mode requires explicit geometry and/or texture settings');
 const started=performance.now();let baseline=source,geometry:any=null,textures:any=null;
 const passTimings:Record<string,number>={};
 if(input.geometry){input.onProgress?.({stage:'original-v4-geometry',done:0,total:1});const at=performance.now(),r=await optimizeGeometry(baseline,{...input.geometry,mode:'bounded-lossy'});baseline=r.normalized;geometry=r.report;passTimings.originalGeometry=performance.now()-at;}
 if(input.textures){input.onProgress?.({stage:'original-v4-textures',done:0,total:1});const at=performance.now(),r=optimizeTextures(baseline,{...input.textures,mode:'lossy'});baseline=r.asset;textures=r.report;passTimings.originalTextures=performance.now()-at;}
 const prepared=prepareLossyUnusedInputs(baseline);
 // The bounded-lossy wire mode is retained, while targetRatio=1 makes encoding
 // bypass any further topology change. Its diagnostic manifest is restored to
 // the original lossy passes below; the package contains no diagnostic gates.
 const result=await compileCandidate({...input,geometry:{targetRatio:1},textures:undefined},prepared.normalized,hints);
 result.manifest.passes.geometry=geometry;result.manifest.passes.textures=textures;
 result.manifest.settings.geometry=geometry?.settings??null;result.manifest.settings.textures=textures?.settings??null;
 result.manifest.validation.geometryScope=geometry?'finite sampled bidirectional surfaces and animation poses':'unchanged topology';
 result.manifest.validation.textureScope=textures?'full source-resolution reconstructed pixel errors in texture report':'exact image pixels';
 const transportStarted=performance.now(),transport=prepareSharedTransport(result.packageBytes,{separateStorageProvenance:false}),transportMs=performance.now()-transportStarted;
 const replayStarted=performance.now(),replayed=await buildFromPackage(transport.packageBytes);
 if(!equal(replayed.glb,result.preview.data))throw Error('Postpass shared replay changes GLB');
 return{result,packageBytes:transport.packageBytes,baseline,normalized:prepared.normalized,preparation:{...prepared.report,ordering:'after unchanged v4 lossy geometry and textures'},timings:{...result.timings,...passTimings,preparation:prepared.timings,transportMs,transportReplayMs:performance.now()-replayStarted,totalArmMs:performance.now()-started},validation:{...result.manifest.validation,transportReplayExact:true,preprocessingProtectedSceneExact:true,postpassOnly:true},transport:transport.report};
}

/** Stable baseline on ties or failed quality/replay gates. A caller can require
 * an additional material saving; default is any strict complete-payload win. */
export function chooseLossyUnusedInputs(baselineBytes:number,candidateBytes:number|null,candidateGatesPassed:boolean,minimumSavingBytes=1){
 if(!Number.isSafeInteger(baselineBytes)||baselineBytes<0||!Number.isSafeInteger(minimumSavingBytes)||minimumSavingBytes<1)throw Error('Invalid size selection input');
 if(candidateBytes!==null&&(!Number.isSafeInteger(candidateBytes)||candidateBytes<0))throw Error('Invalid candidate size');
 const savingBytes=candidateBytes===null?0:baselineBytes-candidateBytes;
 return{selected:candidateGatesPassed&&candidateBytes!==null&&savingBytes>=minimumSavingBytes?'pruned-welded':'baseline',baselineBytes,candidateBytes,savingBytes:candidateGatesPassed&&candidateBytes!==null&&savingBytes>=minimumSavingBytes?savingBytes:0,reason:!candidateGatesPassed?'candidate failed a required gate':candidateBytes===null?'candidate unavailable':savingBytes<minimumSavingBytes?'candidate does not meet required payload saving':'candidate passes existing gates and wins complete per-asset transport cost'};
}
