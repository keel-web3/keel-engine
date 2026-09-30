/** Conservative fixed-material glTF render-input optimization.
 * A core glTF tangent is consumed only by tangent-space normal mapping. With no
 * normal texture it cannot affect core glTF shading. This pass removes only that
 * unused input. It does not promise editable-asset equivalence, custom-shader
 * equivalence, or preservation after a future material change.
 */
import type {NormalizedAsset, NormalizedAccessor} from '../asset-normalize-v3.ts';

function references(json:any,visit:(o:any,k:string)=>void):void {
 for(const mesh of json.meshes??[])for(const p of mesh.primitives??[]){
  if(p.indices!==undefined)visit(p,'indices');
  for(const group of [p.attributes,...(p.targets??[])])for(const key of Object.keys(group??{}))visit(group,key);
 }
 for(const skin of json.skins??[])if(skin.inverseBindMatrices!==undefined)visit(skin,'inverseBindMatrices');
 for(const animation of json.animations??[])for(const sampler of animation.samplers??[]){visit(sampler,'input');visit(sampler,'output');}
}
function opaque(json:any):string|null {
 const visit=(v:any,path:string):string|null=>{
  if(!v||typeof v!=='object')return null;
  if(Object.keys(v.extensions??{}).length)return 'extensions may consume tangents or contain accessor references';
  if(v.extras!==undefined){
   const attribution=path==='/asset'&&v.extras&&typeof v.extras==='object'&&!Array.isArray(v.extras)&&Object.entries(v.extras).every(([k,x])=>['author','license','source','title','copyright'].includes(k)&&typeof x==='string');
   if(!attribution)return 'opaque extras may observe tangents or accessor identities';
  }
  for(const [k,x] of Object.entries(v))if(k!=='extras'){const reason=visit(x,path+'/'+k);if(reason)return reason;}
  return null;
 };
 if((json.extensionsUsed??[]).length||(json.extensionsRequired??[]).length)return 'declared extensions may consume tangents';
 return visit(json,'');
}
const standardSemantic=(s:string)=>['POSITION','NORMAL','TANGENT'].includes(s)||/^(TEXCOORD|COLOR|JOINTS|WEIGHTS)_\d+$/.test(s);
const descriptor=(a:NormalizedAccessor)=>({componentType:a.componentType,type:a.type,count:a.count,...(a.normalized?{normalized:true}:{})});
export interface UnusedTangentPrimitiveReport {mesh:number;primitive:number;semantic:string;accessor:number;removed:boolean;reason:string;retainedCornerRecordsChecked:number}

/** Preserves all retained accessor bytes, ordered vertex/triangle records, morph
 * deltas, rig, clips, materials and images. Only truly unreferenced tangent
 * accessors are removed; all standard accessor references are compacted.
 * Source provenance and original source JSON stay available in the audit IR.
 */
export function optimizeUnusedRenderAttributes(asset:NormalizedAsset,options:{unusedTexcoords?:boolean}={}){
 const json=structuredClone(asset.json),reason=opaque(json),candidates=new Set<number>(),metrics:UnusedTangentPrimitiveReport[]=[];
 const originalCount=asset.accessors.length;
 references(json,(o,k)=>{if(!Number.isSafeInteger(o[k])||o[k]<0||o[k]>=originalCount)throw Error('Unused tangents: invalid accessor reference');});
 for(let mi=0;mi<(json.meshes??[]).length;mi++)for(let pi=0;pi<json.meshes[mi].primitives.length;pi++){
  const p=json.meshes[mi].primitives[pi];
  for(const semantic of Object.keys(p.attributes??{}).filter(s=>s==='TANGENT'||options.unusedTexcoords!==false&&/^TEXCOORD_\d+$/.test(s))){
  const id=p.attributes[semantic];
  const a=asset.accessors[id]!,material=p.material===undefined?undefined:json.materials?.[p.material];
  const textureInfos=[material?.pbrMetallicRoughness?.baseColorTexture,material?.pbrMetallicRoughness?.metallicRoughnessTexture,material?.normalTexture,material?.occlusionTexture,material?.emissiveTexture].filter(x=>x!==undefined);
  const consumed=semantic==='TANGENT'?material?.normalTexture!==undefined:textureInfos.some(info=>(info.texCoord??0)===Number(semantic.slice(9)));
  const metric:UnusedTangentPrimitiveReport={mesh:mi,primitive:pi,semantic,accessor:id,removed:false,reason:'',retainedCornerRecordsChecked:0};metrics.push(metric);
  metric.reason=reason??(p.material!==undefined&&!material?'invalid material reference':consumed?'material consumes this attribute':(p.targets??[]).some((t:any)=>t[semantic]!==undefined)?'matching morph target is retained':Object.keys(p.attributes).some(s=>!standardSemantic(s))?'custom shader attribute is retained':semantic==='TANGENT'&&(a.type!=='VEC4'||a.componentType!==5126)?'unsupported tangent representation':'');
  if(metric.reason)continue;
  delete p.attributes[semantic];candidates.add(id);metric.removed=true;metric.reason=semantic==='TANGENT'?'core glTF material has no tangent-space normal texture':'no core glTF material texture consumes this coordinate set';
  // References and their entire typed-array records stay unchanged before the
  // accessor-table compaction. Therefore all ordered corners remain identical.
  const position=asset.accessors[p.attributes.POSITION],index=p.indices===undefined?undefined:asset.accessors[p.indices];
  metric.retainedCornerRecordsChecked=index?.count??position?.count??0;
  }
 }
 const used=new Set<number>();references(json,(o,k)=>used.add(o[k]));
 const removed=[...candidates].filter(id=>!used.has(id)).sort((a,b)=>a-b),removedSet=new Set(removed),oldToNew=new Array<number>(originalCount).fill(-1),accessors:NormalizedAccessor[]=[],metadata:any[]=[];
 for(let id=0;id<originalCount;id++)if(!removedSet.has(id)){oldToNew[id]=accessors.length;accessors.push(asset.accessors[id]!);metadata.push(structuredClone(asset.json.accessors?.[id]??descriptor(asset.accessors[id]!)));}
 references(json,(o,k)=>{const mapped=oldToNew[o[k]];if(mapped===undefined||mapped<0)throw Error('Unused tangents: removed accessor still referenced');o[k]=mapped;});
 if(json.accessors!==undefined||accessors.length)json.accessors=metadata;
 const normalized:NormalizedAsset={...asset,json,accessors,validation:{...asset.validation,accessorCount:accessors.length,decodedBytes:accessors.reduce((n,a)=>n+a.array.byteLength,0)+asset.images.reduce((n,i)=>n+i.data.byteLength,0)}};
 // Audit every retained reference by mapping it back to its source identity.
 const before=structuredClone(asset.json);for(const m of metrics)if(m.removed)delete before.meshes[m.mesh].primitives[m.primitive].attributes[m.semantic];
 const after=structuredClone(json),newToOld=oldToNew.flatMap((v,id)=>v<0?[]:[id]);references(after,(o,k)=>{o[k]=newToOld[o[k]];});delete before.accessors;delete after.accessors;
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Unused tangents: retained scene records changed');
 return {normalized,asset:normalized,accessorRemap:oldToNew,report:{version:'keel-unused-render-attributes-0.1.0',mode:'fixed-material-render-preservation',changedPrimitives:new Set(metrics.filter(m=>m.removed).map(m=>m.mesh+':'+m.primitive)).size,removedSemantics:[...new Set(metrics.filter(m=>m.removed).map(m=>m.semantic))],removedAccessors:removed.length,removedDecodedBytes:removed.reduce((n,id)=>n+asset.accessors[id]!.array.byteLength,0),oldToNew,metrics,removedAccessorAudit:removed.map(id=>({accessor:id,sourceIndex:asset.accessors[id]!.sourceIndex,descriptor:structuredClone(asset.json.accessors?.[id]??descriptor(asset.accessors[id]!))})),contract:'Core glTF 2.0 with fixed materials: all consumed accessor bytes, ordered corners, morph deltas, skinning, animation, material/image records and source provenance are preserved. Tangent inputs with no normal map and texture coordinates with no consuming texture are omitted. Opaque extensions, shader attributes, extras and matching morph targets are skipped.',limitations:['Future material changes, custom shader hooks and externally observed accessor identities are outside this contract.','This is an algebraic consumed-input proof, not a claim that every GPU backend was tested.','Original source JSON/provenance and removed accessor metadata are audit data; exact removed values remain in the original input, not the rendering payload.']}};
}

export function optimizeUnusedTangents(asset:NormalizedAsset){return optimizeUnusedRenderAttributes(asset,{unusedTexcoords:false});}
