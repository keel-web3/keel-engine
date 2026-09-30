/** Regenerate only changed native fields using the baseline's codec families.
 * The result uses the existing shared runtime, so no new decoder is required.
 */
import type {NormalizedAsset} from '../asset-normalize-v3.ts';
import type {DracoHint} from './draco-transforms.ts';
import {encodeAffineHint,encodeOctHint} from './draco-transforms.ts';
import {encodeExactBuffer,encodeResidualAttribute,encodeSurface} from './exact-encoding.ts';
import {encodeExactIndexSequence} from './index-codec.ts';
import {encodeTopologyAttribute} from './topology-predictor.ts';
import {packAsset,unpackAsset} from '../asset-binary-v3.ts';
import {unzlibSync} from 'fflate';
import type {PlanarMetric} from './planar-patches.ts';
const bytes=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const encode=(a:Uint8Array,h?:{stride:number;componentBytes:number})=>encodeExactBuffer(a,h).recipe;
export async function encodePlanarPatchPayload(baseline:Uint8Array,asset:NormalizedAsset,metrics:PlanarMetric[],hints:Map<number,DracoHint>){
 if(!metrics.some(m=>m.applied))return baseline.slice();
 const wrapper:any=unpackAsset(baseline);if(wrapper.format!=='KEEL-RAW-TRANSFORM-TRANSPORT-V1')throw Error('Planar experiment requires raw native transport');
 const topology=wrapper.recipe.format==='KEEL-TOPOLOGY-ATTRIBUTES-V1',recipe=topology?wrapper.recipe.base:wrapper.recipe,base=recipe.native.base;
 base.json=structuredClone(asset.json);base.descriptors=asset.accessors.map(a=>({type:a.type,componentType:a.componentType,count:a.count,normalized:a.normalized}));
 for(const metric of metrics.filter(m=>m.applied)){
  const p=asset.json.meshes[metric.mesh].primitives[metric.primitive],surface=base.surfaces.find((s:any)=>s.mesh===metric.mesh&&s.primitive===metric.primitive);if(!surface)throw Error('Planar surface missing');
  const position=asset.accessors[p.attributes.POSITION]!,indices=asset.accessors[p.indices]!.array as Uint8Array|Uint16Array|Uint32Array;
  surface.recipe=encodeSurface({positions:position.array as Float32Array,indices,mode:4}).recipe;
  const index=recipe.indices.find((x:any)=>x.accessor===p.indices);
  if(index){index.recipe=(await encodeExactIndexSequence(indices,{compress:true})).recipe;surface.recipe.topology={kind:'v4-index',accessor:p.indices};}
  else surface.recipe.topology={kind:'residual',buffer:encode(bytes(indices),{stride:indices.BYTES_PER_ELEMENT,componentBytes:indices.BYTES_PER_ELEMENT})};
  const ids=new Set<number>();for(const group of[p.attributes,...p.targets??[]])for(const id of Object.values(group))ids.add(id as number);
  for(const id of ids){const a=asset.accessors[id]!,hint=hints.get(a.sourceIndex),affine=recipe.affine.find((x:any)=>x.accessor===id),attribute=recipe.native.attributes.find((x:any)=>x.accessor===id),predicted=topology&&wrapper.recipe.predictions.find((x:any)=>x.accessor===id);
   if(predicted){const result=encodeTopologyAttribute({...a,indices},hint?.kind==='float-affine'?hint:undefined);if(result.recipe.kind!=='topology')throw Error('Bounded planar topology predictor unavailable');predicted.recipe=result.recipe;if(id===p.attributes.POSITION)surface.recipe.positions={kind:'topology-attribute',accessor:id};}
   else if(affine){if(hint?.kind!=='float-affine')throw Error('Source affine hint missing');const result=encodeAffineHint(id,a,hint,encode);if(!result)throw Error('Exact planar affine encoding failed');Object.assign(affine,result);if(id===p.attributes.POSITION)surface.recipe.positions={kind:'v4-affine',accessor:id};}
   else if(attribute){if(hint?.kind!=='octahedral')throw Error('Unsupported baseline attribute family');const result=encodeOctHint(a,hint,encode);if(!result)throw Error('Exact planar octahedral encoding failed');attribute.recipe=result;}
   else if(id!==p.attributes.POSITION)base.residualAccessors[id]=encodeResidualAttribute(a).recipe;
  }
 }
 const unwrap=(x:any):void=>{if(!x||typeof x!=='object'||x instanceof Uint8Array)return;if(x.codec&&x.codec!=='raw'&&x.data instanceof Uint8Array){if(!x.rawTransport){x.data=unzlibSync(x.data);x.rawTransport=1;}return;}for(const[k,v]of Object.entries(x))if(k!=='json'&&k!=='sourceStorageMetadata')unwrap(v);};unwrap(wrapper.recipe);
 return packAsset(wrapper);
}
