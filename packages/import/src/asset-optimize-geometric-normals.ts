/** Bounded shared-module post-pass. Infers geometric normal residuals from an
 * already validated native package. No source filename or model constants. */
import {packAsset,unpackAsset} from './asset-binary-v3.ts';
import {buildFromPackage,restoreRawTransport,RAW_TRANSPORT_FORMAT} from './asset-replay-shared.ts';
import {decodeBuffer} from './asset-buffer-codec.ts';
import {encodeGeometricNormals} from './optimization/geometric-normals.ts';
import {selectSharedAssetPayload} from './asset-payload-selection.ts';
import type {PinnedBrotliCodec} from './asset-payload-selection.ts';
const bytes=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
function normalPairs(r:any):Uint32Array|null {
 const s=r?.storage;if(r?.version!==3||r.componentType!==5126||r.type!=='VEC3'||s?.kind!=='octahedral-f32'||s.exceptions||s.fourth||!Number.isSafeInteger(r.count)||r.count<1||r.count>1048576||!Number.isInteger(s.bits)||s.bits<2||s.bits>16||![0,1].includes(s.predictor))return null;
 const length=Math.ceil(r.count*s.bits/4);if(s.pairs?.sourceLength!==length)throw Error('Invalid source normal pair extent');const data=decodeBuffer(s.pairs,length),pairs=new Uint32Array(r.count*2),mask=2**s.bits-1;let bit=0;
 for(let i=0;i<pairs.length;i++){let code=0;for(let k=0;k<s.bits;k++,bit++)code|=((data[bit>>>3]!>>>(bit&7))&1)<<k;const delta=code&1?-(code+1)/2:code/2;pairs[i]=s.predictor?((i>=2?pairs[i-2]!:0)+delta)&mask:code;if(pairs[i]===mask)throw Error('Invalid source octahedral coordinate');}
 if(bit%8&&(data[data.length-1]!>>>(bit%8)))throw Error('Nonzero source normal padding');return pairs;
}
export async function optimizeGeometricNormalPayload(packageBytes:Uint8Array,codec:PinnedBrotliCodec){
 const started=performance.now(),original:any=unpackAsset(packageBytes),isRaw=original?.format===RAW_TRANSPORT_FORMAT,root=isRaw?original.recipe:original;
 if(!['KEEL-NATIVE-V4','KEEL-TOPOLOGY-ATTRIBUTES-V1'].includes(root?.format))throw Error('Expected native or topology package');
 const resolved:any=isRaw?restoreRawTransport(structuredClone(original)):structuredClone(root),legacy=root.format==='KEEL-TOPOLOGY-ATTRIBUTES-V1'?root.base:root,resolvedLegacy=resolved.format==='KEEL-TOPOLOGY-ATTRIBUTES-V1'?resolved.base:resolved,base=legacy?.native?.base;
 const source=await buildFromPackage(packageBytes),normalStart=performance.now(),timings:any={inputReplay:performance.now()-started},normals:any[]=[],visited=new Set<number>(),choices:any[]=[];
 for(let mesh=0;mesh<(base.json.meshes??[]).length;mesh++)for(let primitive=0;primitive<base.json.meshes[mesh].primitives.length;primitive++){
  const p=base.json.meshes[mesh].primitives[primitive],accessor=p.attributes?.NORMAL;if((p.mode??4)!==4||accessor===undefined||visited.has(accessor))continue;visited.add(accessor);
  const entry=(legacy.native.attributes??[]).find((x:any)=>x.accessor===accessor),resolvedEntry=(resolvedLegacy.native.attributes??[]).find((x:any)=>x.accessor===accessor);if(!entry||!resolvedEntry)continue;const pairs=normalPairs(resolvedEntry.recipe);if(!pairs)continue;
  const normal=source.accessors[accessor],positions=source.accessors[p.attributes.POSITION];if(!(normal instanceof Float32Array)||!(positions instanceof Float32Array)||normal.length!==positions.length||positions.length%3||positions.length>3145728||positions.some(v=>!Number.isFinite(v)))continue;
  const indices=p.indices===undefined?Uint32Array.from({length:normal.length/3},(_,i)=>i):source.accessors[p.indices];if(!(indices instanceof Uint8Array||indices instanceof Uint16Array||indices instanceof Uint32Array)||indices.length%3||indices.length>6291456)continue;
  const encoded=encodeGeometricNormals(normal,positions,indices,{kind:'octahedral',bits:resolvedEntry.recipe.storage.bits,source:normal,pairs},base.descriptors[accessor].normalized);if(!encoded)continue;
  const record={mesh,primitive,accessor,positionAccessor:p.attributes.POSITION,indexAccessor:p.indices??null,recipe:encoded.recipe},oldBytes=(await codec.compress(packAsset(entry))).length,newBytes=(await codec.compress(packAsset(record))).length,selected=newBytes<oldBytes;choices.push({accessor,oldBytes,newBytes,selected});if(!selected)continue;
  legacy.native.attributes=legacy.native.attributes.filter((x:any)=>x.accessor!==accessor);legacy.affine=(legacy.affine??[]).filter((x:any)=>x.accessor!==accessor);base.residualAccessors[accessor]={kind:'geometric-normal-marker',accessor};normals.push(record);
 }
 timings.streamInferenceAndSelection=performance.now()-normalStart;const validationStart=performance.now(),candidates:any[]=[{id:'unchanged',data:packageBytes,representation:'native-code'}];
 if(normals.length){const wrapper={format:'KEEL-GEOMETRIC-NORMALS-V1',base:root,normals},candidate=packAsset(isRaw?{...original,recipe:wrapper}:wrapper),replayed=await buildFromPackage(candidate);if(!same(replayed.glb,source.glb))throw Error('Geometric normals change native GLB');for(let i=0;i<source.accessors.length;i++)if(!same(bytes(replayed.accessors[i]),bytes(source.accessors[i])))throw Error('Geometric normals change accessor '+i);candidates.push({id:'geometric-normals',data:candidate,representation:'native-code'});}
 timings.exactCandidateValidation=performance.now()-validationStart;const compressionStart=performance.now(),selected=await selectSharedAssetPayload(candidates,codec);timings.wholePayloadCompressionAndSelection=performance.now()-compressionStart;timings.totalWithCompressionAndValidation=performance.now()-started;return{...selected,normalPrediction:{eligibleStreams:choices.length,candidateStreams:normals.length,selectedStreams:selected.report.selected==='geometric-normals'?normals.length:0,choices,validation:'All decoded accessor bytes and complete generated GLB are identical to input native package.',scope:'Existing exact octahedral NORMAL streams only; other streams retain fallback.'},timings};
}
