/** Optional experiment adapter; frozen v4/topology modules remain unchanged.
 * Call after restoring raw transformed transport, then pass the returned recipe
 * to the existing buildAsset. Shared runtime costs are charged once by the host.
 */
import { replayShapeReuse } from './shape-reuse.ts';
import type { ShapeReuseRecipe } from './shape-reuse.ts';
export function restoreShapeReuse(wrapper:any):any {
 if(!wrapper||typeof wrapper!=='object'||!['KEEL-NATIVE-V4','KEEL-TOPOLOGY-ATTRIBUTES-V1'].includes(wrapper.format))throw Error('Shape reuse: unsupported asset format');
 const shape=wrapper.shapeReuse as ShapeReuseRecipe|undefined;if(!shape)return wrapper;
 const v4=wrapper.format==='KEEL-TOPOLOGY-ATTRIBUTES-V1'?wrapper.base:wrapper;
 if(v4?.format!=='KEEL-NATIVE-V4'||!Array.isArray(v4.affine)||!Array.isArray(v4.native?.base?.descriptors))throw Error('Shape reuse: invalid asset descriptors');
 const decoded=replayShapeReuse(shape),pending:Array<{affine:any;codes:Uint16Array|Uint32Array}>=[],seen=new Set<number>();
 for(const affine of v4.affine){if(!affine?.codes||!Object.hasOwn(affine.codes,'shapeReuse'))continue;
  const id=affine.accessor,codes=decoded.get(id),d=v4.native.base.descriptors[id];
  if(!Number.isSafeInteger(id)||affine.codes.shapeReuse!==id||Object.keys(affine.codes).length!==1||seen.has(id)||!codes||affine.width!==3||affine.count*3!==codes.length||affine.codeWidth!==codes.BYTES_PER_ELEMENT||d?.componentType!==5126||d.type!=='VEC3'||d.count!==affine.count)throw Error('Shape reuse: asset marker mismatch');
  seen.add(id);pending.push({affine,codes});
 }
 if(seen.size!==decoded.size)throw Error('Shape reuse: unreferenced shape stream');
 for(const {affine,codes}of pending){const data=new Uint8Array(codes.byteLength),view=new DataView(data.buffer);for(let i=0;i<codes.length;i++)if(codes.BYTES_PER_ELEMENT===2)view.setUint16(i*2,codes[i]!,true);else view.setUint32(i*4,codes[i]!,true);affine.codes={codec:'raw',parameters:{version:1},sourceLength:data.length,data};}
 delete wrapper.shapeReuse;return wrapper;
}
