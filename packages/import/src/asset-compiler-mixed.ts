/** Bounded exact source-codec candidate. This retains selected existing Draco
 * primitive streams, never a whole input GLB. Scenes, residual attributes and
 * images continue through the ordinary native asset compiler. */
import {normalizeAsset} from './asset-normalize-v3.ts';
import type {NormalizeAssetInput} from './asset-normalize-v3.ts';
import {unpackAsset,packAsset} from './asset-binary-v3.ts';
import {prepareSharedTransport} from './asset-shared-transport.ts';
import {buildFromPackage as buildShared} from './asset-replay-shared.ts';
import {MIXED_FORMAT,mixedNativeBody,buildMixedAsset} from './asset-replay-mixed.ts';
const raw=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const same=(a:ArrayBufferView,b:ArrayBufferView)=>a.byteLength===b.byteLength&&raw(a).every((v,i)=>v===raw(b)[i]);
function path(s:string){const p:string[]=[];for(const c of s.split('/')){if(c==='..'){if(!p.length)throw Error('Resource escapes root');p.pop()}else if(c&&c!=='.')p.push(c)}return p.join('/')}
function resource(input:NormalizeAssetInput,uri:string):Uint8Array {
 if(uri.startsWith('data:')){const comma=uri.indexOf(','),body=uri.slice(comma+1);if(uri.slice(0,comma).endsWith(';base64'))return Uint8Array.from(atob(body),c=>c.charCodeAt(0));const a:number[]=[];for(let i=0;i<body.length;i++){if(body[i]==='%'){a.push(parseInt(body.slice(i+1,i+3),16));i+=2}else a.push(body.charCodeAt(i))}return Uint8Array.from(a)}
 const name=path(path(input.entry).split('/').slice(0,-1).concat(decodeURIComponent(uri)).join('/')),f=input.files.find(f=>path(f.name)===name);if(!f)throw Error('Source resource absent');return f.data;
}
export async function prepareMixedPrimitives(input:NormalizeAssetInput,nativeBytes:Uint8Array) {
 const started=performance.now(),source=await normalizeAsset(input),baseInput:any=unpackAsset(nativeBytes);if(baseInput.format!=='KEEL-NATIVE-V4'||baseInput.mode!=='lossless')throw Error('Mixed exact candidate requires lossless native v4');
 const current=await buildShared(nativeBytes);for(let i=0;i<source.accessors.length;i++)if(!same(current.accessors[i],source.accessors[i]!.array))throw Error('Native base is not exact source');
 if(!source.validation.dracoPrimitives)return{packageBytes:prepareSharedTransport(nativeBytes).packageBytes,changed:false,report:{retainedDracoPrimitives:0,timingsMs:performance.now()-started}};
 const entry=input.files.find(f=>path(f.name)===source.source.entry)!.data;let bin:Uint8Array|undefined;
 if(source.source.container==='glb'){const d=new DataView(entry.buffer,entry.byteOffset,entry.length);for(let at=12;at<entry.length;){const n=d.getUint32(at,true);if(d.getUint32(at+4,true)===0x004e4942)bin=entry.subarray(at+8,at+8+n);at+=8+n}}
 const j=source.sourceJson,buffers=(j.buffers??[]).map((b:any,i:number)=>b.uri?resource(input,b.uri):i===0?bin:undefined),blocks:Uint8Array[]=[],primitives:any[]=[],accessorMap:number[]=[],ids=new Map<number,number>();
 const local=(id:number)=>{let n=ids.get(id);if(n===undefined){n=ids.size;ids.set(id,n);accessorMap.push(id)}return n};
 for(let mi=0;mi<(j.meshes??[]).length;mi++)for(let pi=0;pi<j.meshes[mi].primitives.length;pi++){
  const p=j.meshes[mi].primitives[pi],ext=p.extensions?.KHR_draco_mesh_compression;if(!ext)continue;
  // Sparse overrides require a separate exact patch; retain native coding now.
  if(ext.attributes.POSITION===undefined||p.indices!==undefined&&j.accessors[p.indices].sparse||Object.keys(ext.attributes).some(s=>j.accessors[p.attributes[s]].sparse))continue;
  const v=j.bufferViews[ext.bufferView],b=buffers[v.buffer],block=b?.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);if(!block||block.length!==v.byteLength)throw Error('Draco source extent');
  const normalized=source.json.meshes[mi].primitives[pi],attributes=Object.fromEntries(Object.keys(ext.attributes).sort().map(s=>[s,local(p.attributes[s])]));
  primitives.push({attributes,indices:local(normalized.indices),mode:4,extensions:{KHR_draco_mesh_compression:{bufferView:blocks.length,attributes:ext.attributes}}});blocks.push(new Uint8Array(block));
 }
 const base:any=unpackAsset(prepareSharedTransport(nativeBytes,{separateStorageProvenance:true}).packageBytes),body=mixedNativeBody(base),native=body.native.base;
 for(const id of accessorMap){body.affine=body.affine.filter((x:any)=>x.accessor!==id);body.indices=body.indices.filter((x:any)=>x.accessor!==id);body.native.attributes=body.native.attributes.filter((x:any)=>x.accessor!==id);const owners=native.surfaces.filter((s:any)=>s.positionAccessor===id||s.indexAccessor===id);if(owners.length){for(const s of owners)s.recipe[s.positionAccessor===id?'positions':'topology']={kind:'source-draco',accessor:id};native.residualAccessors[id]=null;}else native.residualAccessors[id]={kind:'source-draco',accessor:id};}
 const mini={asset:{version:'2.0'},accessors:accessorMap.map(id=>{const d=native.descriptors[id];return{componentType:d.componentType,type:d.type,count:d.count,...(d.normalized?{normalized:true}:{})}}),meshes:[{primitives}],extensionsRequired:['KHR_draco_mesh_compression'],extensionsUsed:['KHR_draco_mesh_compression']};
 const recipe={format:MIXED_FORMAT,version:1,base,accessorMap,json:mini,blocks},packageBytes=packAsset(recipe),built=await buildMixedAsset(recipe,{dracoDecoder:input.dracoDecoder});
 for(let i=0;i<source.accessors.length;i++)if(!same(built.accessors[i],source.accessors[i]!.array))throw Error('Mixed candidate changes source accessor '+i);
 if(!same(built.glb,current.glb))throw Error('Mixed candidate changes reconstructed GLB');
 return{packageBytes,changed:blocks.length>0,report:{retainedDracoPrimitives:blocks.length,retainedDracoBytes:blocks.reduce((n,b)=>n+b.length,0),retainedAccessors:accessorMap.length,semantics:'all source decoded accessors, images and generated scene GLB exact; existing Draco codec explicitly retained',timingsMs:performance.now()-started}};
}
