import {replayTopologyAttribute} from './topology-predictor.ts';
import {decodeBuffer} from '../asset-buffer-codec.ts';
import {preflightNativeRecipe} from '../asset-compiler-v3.ts';
import type {TriangleIndices} from './topology-predictor.ts';
/** Resolves only explicitly bound triangle-list dependencies, before native replay. */
export async function restoreTopologyPredictions(wrapper:any,decodeSequence?:(recipe:any,count:number)=>Promise<TriangleIndices>){
 if(wrapper?.format!=='KEEL-TOPOLOGY-ATTRIBUTES-V1'||!Array.isArray(wrapper.predictions)||wrapper.predictions.length>100000)throw Error('Invalid topology package');
 const recipe=structuredClone(wrapper.base),base=recipe?.native?.base,descriptors=base?.descriptors;
 if(!Array.isArray(descriptors)||!Array.isArray(base.surfaces))throw Error('Invalid topology native base');
 const ids=new Set<number>();let extra=0;const widths:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
 for(const item of wrapper.predictions){const d=descriptors[item?.accessor],r=item?.recipe,p=base.json.meshes?.[item?.mesh]?.primitives?.[item?.primitive];if(!Number.isSafeInteger(item?.accessor)||item.accessor<0||ids.has(item.accessor)||base.surfaces.some((s:any)=>s.indexAccessor===item.accessor)||!d||!p||!Object.values(p.attributes??{}).includes(item.accessor)||(p.mode??4)!==4||r?.kind!=='topology'||d.componentType!==r.componentType||d.type!==r.type||d.count!==r.count||d.normalized!==r.normalized||!widths[d.type]||!Number.isSafeInteger(d.count)||d.count<0||d.count>1048576)throw Error('Topology attribute binding differs');ids.add(item.accessor);extra+=d.count*(widths[d.type]!*4+20);if(!Number.isSafeInteger(extra)||extra>128*1024*1024)throw Error('Topology replay budget exceeded');if(p.indices!==undefined){const ix=descriptors[p.indices];if(!ix||ix.type!=='SCALAR'||ix.normalized!==false||![5121,5123,5125].includes(ix.componentType)||ix.count!==r.indexCount)throw Error('Topology index descriptor differs');}else if(r.indexCount!==d.count)throw Error('Implicit topology count differs');}
 // Charge the downstream v4 expansion before allocating predictor plans or
 // decoded dependency streams. A later v4 rejection is too late for this gate.
 if(!Array.isArray(recipe.affine)||recipe.affine.length>descriptors.length||!Array.isArray(recipe.indices)||recipe.indices.length>descriptors.length)throw Error('Invalid v4 expansion tables');
 const affineIds=new Set<number>(),indexIds=new Set<number>();let affineBytes=0,indexBytes=0;
 for(const r of recipe.affine){const d=descriptors[r?.accessor];if(!Number.isSafeInteger(r?.accessor)||r.accessor<0||affineIds.has(r.accessor)||ids.has(r.accessor)||!d||d.componentType!==5126||!Number.isSafeInteger(d.count)||d.count<0||d.count!==r.count||!['SCALAR','VEC2','VEC3','VEC4'].includes(d.type)||widths[d.type]!==r.width)throw Error('Affine expansion descriptor differs');affineIds.add(r.accessor);affineBytes+=d.count*r.width*4;}
 for(const item of recipe.indices){const d=descriptors[item?.accessor],r=item?.recipe;if(!Number.isSafeInteger(item?.accessor)||item.accessor<0||indexIds.has(item.accessor)||ids.has(item.accessor)||!d||!Number.isSafeInteger(d.count)||d.count<0||d.type!=='SCALAR'||d.normalized!==false||![5121,5123,5125].includes(d.componentType)||d.componentType!==r?.componentType||d.count!==r?.count)throw Error('Index expansion descriptor differs');indexIds.add(item.accessor);indexBytes+=d.count*8;}
 if(!Number.isSafeInteger(affineBytes)||affineBytes>128*1024*1024||!Number.isSafeInteger(indexBytes)||indexBytes>128*1024*1024)throw Error('V4 expansion budget exceeded');
 for(const item of wrapper.predictions){const surfaces=base.surfaces.filter((s:any)=>s.positionAccessor===item.accessor);if(surfaces.length){if(base.residualAccessors[item.accessor]!==null||surfaces.some((s:any)=>s.recipe.positions?.kind!=='topology-attribute'||s.recipe.positions.accessor!==item.accessor))throw Error('Predicted surface owner differs');}else if(base.residualAccessors[item.accessor]?.kind!=='topology-attribute'||base.residualAccessors[item.accessor].accessor!==item.accessor)throw Error('Predicted attribute owner differs');}
 preflightNativeRecipe(recipe.native,extra+affineBytes+indexBytes);
 const cache=new Map<string,TriangleIndices>();
 for(const item of wrapper.predictions){const p=base.json.meshes[item.mesh].primitives[item.primitive],r=item.recipe,key=p.indices===undefined?'implicit:'+r.count:'index:'+p.indices;let indices=cache.get(key);
  if(!indices){if(p.indices===undefined)indices=Uint32Array.from({length:r.count},(_,i)=>i);else{
   const surface=base.surfaces.find((s:any)=>s.mesh===item.mesh&&s.primitive===item.primitive&&s.indexAccessor===p.indices);if(!surface)throw Error('Missing topology surface');const topology=surface.recipe.topology,d=descriptors[p.indices];
   if(topology?.kind==='v4-index'){const encoded=recipe.indices.find((x:any)=>x.accessor===p.indices);if(!decodeSequence||!encoded)throw Error('Topology sequence runtime unavailable');indices=await decodeSequence(encoded.recipe,r.count);}
   else if(topology?.kind==='residual'){const width=d.componentType===5121?1:d.componentType===5123?2:4;if(topology.buffer?.sourceLength!==d.count*width)throw Error('Topology byte extent differs');const data=decodeBuffer(topology.buffer,d.count*width).slice();indices=width===1?data:width===2?new Uint16Array(data.buffer):new Uint32Array(data.buffer);}
   else throw Error('Unsupported topology dependency representation');
  }cache.set(key,indices);}
  const array=replayTopologyAttribute(r,indices),data=new Uint8Array(array.buffer,array.byteOffset,array.byteLength),wire={codec:'raw',parameters:{version:1},sourceLength:data.length,data};
  const surfaces=base.surfaces.filter((s:any)=>s.positionAccessor===item.accessor);
  if(surfaces.length){if(base.residualAccessors[item.accessor]!==null)throw Error('Predicted surface overlaps residual');for(const s of surfaces){if(s.recipe.positions?.kind!=='topology-attribute'||s.recipe.positions.accessor!==item.accessor)throw Error('Predicted position marker differs');s.recipe.positions={kind:'residual',buffer:wire};}}
  else{if(base.residualAccessors[item.accessor]?.kind!=='topology-attribute'||base.residualAccessors[item.accessor].accessor!==item.accessor)throw Error('Predicted attribute marker differs');base.residualAccessors[item.accessor]=wire;}
 }
 return recipe;
}
