/** Experimental bounded connectivity prediction; v4 and visual baseline unchanged. */
import{compileAsset as compileVisual,makeNativeArchive as archiveVisual}from'./asset-compiler-visual.ts';
import{normalizeAsset}from'./asset-normalize-v3.ts';import{optimizeRenderEquivalent}from'./optimization/render-equivalent.ts';import{extractDracoHints}from'./optimization/draco-transforms.ts';
import{encodeTopologyAttribute,replayTopologyAttribute}from'./optimization/topology-predictor.ts';
import{packAsset,unpackAsset}from'./asset-binary-v3.ts';import{zlibSync}from'fflate';import{buildAsset as replayFull}from'./asset-replay-topology.ts';import{buildAsset as replayCore}from'./asset-replay-topology-core.ts';
const hash=async(a:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(a)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const raw=(a:any)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength),same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]),cost=(x:any)=>packAsset(x).length;
export function makeNativeArchive(result:any,support:any){if(result.runtimeVariant==='topology-core')return archiveVisual(result,{...support,decoder:support.topologyCoreDecoder});if(result.runtimeVariant==='topology-meshopt')return archiveVisual(result,{...support,decoder:support.topologyDecoder});return archiveVisual(result,support);}
export async function compileAsset(input:any){
 const started=performance.now(),baseline=await compileVisual(input);if(input.mode!=='visual-preservation')return baseline;
 if(!input.support?.topologyDecoder||!input.support?.topologyCoreDecoder)throw Error('Topology experiment requires both counted decoder variants');
 const original=await normalizeAsset(input),asset=baseline.selection.selected==='welded-render-inputs'?optimizeRenderEquivalent(original).normalized:original,hints=await extractDracoHints(input,original),recipe:any=unpackAsset(baseline.packageBytes),base=recipe.native.base,predictions:any[]=[],visited=new Set<number>(),metrics:any[]=[];
 for(let mi=0;mi<(asset.json.meshes??[]).length;mi++)for(let pi=0;pi<asset.json.meshes[mi].primitives.length;pi++){
  const p=asset.json.meshes[mi].primitives[pi];if((p.mode??4)!==4)continue;const surface=base.surfaces.find((s:any)=>s.mesh===mi&&s.primitive===pi);if(!surface||!['residual','v4-index','unindexed'].includes(surface.recipe.topology.kind))continue;
  const indices=p.indices===undefined?Uint32Array.from({length:asset.accessors[p.attributes.POSITION]!.count},(_,i)=>i):asset.accessors[p.indices]!.array as Uint8Array|Uint16Array|Uint32Array;
  for(const semantic of Object.keys(p.attributes).sort()){
   const id=p.attributes[semantic];if(visited.has(id))continue;visited.add(id);const a=asset.accessors[id]!,hint=hints.get(a.sourceIndex),encoded=encodeTopologyAttribute({...a,indices},hint?.kind==='float-affine'?hint:undefined);if(encoded.recipe.kind!=='topology')continue;
   const affine=recipe.affine.find((x:any)=>x.accessor===id),attribute=recipe.native.attributes.find((x:any)=>x.accessor===id),owners=base.surfaces.filter((s:any)=>s.positionAccessor===id),old=affine??attribute??(owners.length?owners.map((s:any)=>s.recipe.positions):base.residualAccessors[id]);
   const item={accessor:id,mesh:mi,primitive:pi,recipe:encoded.recipe};if(cost(item)>=cost(old))continue;
   if(!same(raw(replayTopologyAttribute(encoded.recipe,indices)),raw(a.array)))throw Error('Topology attribute differs from candidate');
   predictions.push(item);metrics.push({accessor:id,semantic,oldRecipeBytes:cost(old),predictedRecipeBytes:cost(item),domain:encoded.recipe.domain.kind});recipe.affine=recipe.affine.filter((x:any)=>x.accessor!==id);recipe.native.attributes=recipe.native.attributes.filter((x:any)=>x.accessor!==id);
   if(owners.length)for(const s of owners)s.recipe.positions={kind:'topology-attribute',accessor:id};else base.residualAccessors[id]={kind:'topology-attribute',accessor:id};
  }
 }
 const baselineBytes=zlibSync(makeNativeArchive(baseline,input.support),{level:9}).length;let candidateBytes:number|null=null,selected=baseline;
 if(predictions.length){const wrapper={format:'KEEL-TOPOLOGY-ATTRIBUTES-V1',base:recipe,predictions},packageBytes=packAsset(wrapper),core=baseline.runtimeVariant==='core',built=await(core?replayCore:replayFull)(wrapper);if(!same(built.glb,baseline.preview.data))throw Error('Topology replay changes the selected visual GLB');
  const candidate={...baseline,packageBytes,program:baseline.program.replace('// keel-native-asset-compiler-0.4.0;','// topology-conditioned exact replay;'),manifest:structuredClone(baseline.manifest),runtimeVariant:core?'topology-core':'topology-meshopt'};candidate.manifest.compilerVersion='keel-topology-attribute-experiment-0.1.0';candidate.manifest.packageBytes=packageBytes.length;candidate.manifest.packageSha256=await hash(packageBytes);candidate.manifest.runtime.decoderVariant=candidate.runtimeVariant;candidate.manifest.passes.topologyPrediction={count:predictions.length,metrics};candidateBytes=zlibSync(makeNativeArchive(candidate,input.support),{level:9}).length;if(candidateBytes<baselineBytes)selected=candidate;
 }
 selected.topologySelection={metric:'zlib9 of complete runnable archive including selected runtime and licenses',baselineBytes,candidateBytes,predictedAccessors:predictions.length,selected:selected!==baseline,savingBytes:selected===baseline?0:baselineBytes-candidateBytes!};selected.timings={...selected.timings,totalWithTopologySearch:performance.now()-started};return selected;
}
