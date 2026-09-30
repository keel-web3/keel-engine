/** Exact mixed native reconstruction. Existing source Draco is an explicit
 * primitive codec; every other scene field remains a native reconstruction rule.
 * The host supplies the pinned, reusable Draco module once. */
import {unpackAsset} from './asset-binary-v3.ts';
import {normalizeAsset} from './asset-normalize-v3.ts';
import {buildFromPackage as buildShared,RAW_TRANSPORT_FORMAT} from './asset-replay-shared.ts';
import {packAsset} from './asset-binary-v3.ts';
export const MIXED_FORMAT='KEEL-MIXED-PRIMITIVES-V1';
const same=(a:Uint8Array,b:Uint8Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const raw=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
export function writeDracoGlb(json:any,blocks:Uint8Array[]):Uint8Array {
 let length=0;const views=blocks.map(data=>{const v={buffer:0,byteOffset:length,byteLength:data.length};length=(length+data.length+3)&~3;return v});
 const j={...json,buffers:[{byteLength:length}],bufferViews:views},encoded=new TextEncoder().encode(JSON.stringify(j)),jl=(encoded.length+3)&~3;
 if(length+jl>128*1024*1024)throw Error('Mixed primitive budget exceeded');
 const out=new Uint8Array(28+jl+length),d=new DataView(out.buffer);d.setUint32(0,0x46546c67,true);d.setUint32(4,2,true);d.setUint32(8,out.length,true);d.setUint32(12,jl,true);d.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jl);out.set(encoded,20);d.setUint32(20+jl,length,true);d.setUint32(24+jl,0x004e4942,true);blocks.forEach((b,i)=>out.set(b,28+jl+views[i]!.byteOffset));return out;
}
export function mixedNativeBody(recipe:any):any {
 const r=recipe?.format===RAW_TRANSPORT_FORMAT?recipe.recipe:recipe;
 if(r?.format!=='KEEL-NATIVE-V4')throw Error('Mixed replay requires native v4 base');
 return r;
}
export async function buildMixedAsset(recipe:any,options:{dracoDecoder:any}) {
 if(recipe?.format!==MIXED_FORMAT||recipe.version!==1||!Array.isArray(recipe.blocks)||recipe.blocks.length>10000||!recipe.blocks.every((b:any)=>b instanceof Uint8Array)||!Array.isArray(recipe.accessorMap)||recipe.accessorMap.length>100000||!recipe.json)throw Error('Invalid mixed primitive recipe');
 const byteCount=recipe.blocks.reduce((n:number,b:Uint8Array)=>n+b.length,0);if(byteCount>128*1024*1024)throw Error('Mixed primitive byte budget');
 const cloned=structuredClone(recipe.base),body=mixedNativeBody(cloned),base=body.native?.base,seen=new Set<number>();
 if(!Array.isArray(base?.descriptors)||recipe.accessorMap.length!==(recipe.json.accessors??[]).length)throw Error('Mixed descriptor extent');
 for(let i=0;i<recipe.accessorMap.length;i++){const id=recipe.accessorMap[i],d=base.descriptors[id],s=recipe.json.accessors[i];if(!Number.isSafeInteger(id)||id<0||!d||seen.has(id)||d.type!==s.type||d.componentType!==s.componentType||d.count!==s.count||d.normalized!==(s.normalized??false))throw Error('Mixed descriptor differs');seen.add(id);}
 const glb=writeDracoGlb(recipe.json,recipe.blocks),decoded=await normalizeAsset({files:[{name:'primitives.glb',data:glb}],entry:'primitives.glb',dracoDecoder:options.dracoDecoder});
 if(decoded.accessors.length!==recipe.accessorMap.length)throw Error('Mixed decoded accessor extent');
 for(let local=0;local<recipe.accessorMap.length;local++){
  const id=recipe.accessorMap[local],a=decoded.accessors[local]!.array,wire={codec:'raw',parameters:{version:1},sourceLength:a.byteLength,data:raw(a)},owners=base.surfaces.filter((s:any)=>s.positionAccessor===id||s.indexAccessor===id);
  if(owners.length){if(base.residualAccessors[id]!==null)throw Error('Mixed owned accessor overlap');for(const s of owners){const key=s.positionAccessor===id?'positions':'topology';if(s.recipe[key]?.kind!=='source-draco'||s.recipe[key].accessor!==id)throw Error('Mixed source marker missing');s.recipe[key]={kind:'residual',buffer:wire};}}
  else{if(base.residualAccessors[id]?.kind!=='source-draco'||base.residualAccessors[id].accessor!==id)throw Error('Mixed residual marker missing');base.residualAccessors[id]=wire;}
 }
 const built=await buildShared(packAsset(cloned));
 for(let i=0;i<recipe.accessorMap.length;i++)if(!same(raw(built.accessors[recipe.accessorMap[i]]),raw(decoded.accessors[i]!.array)))throw Error('Mixed native accessor differs');
 return built;
}
export async function buildFromPackage(data:Uint8Array,options:{dracoDecoder:any}){return buildMixedAsset(unpackAsset(data),options)}
