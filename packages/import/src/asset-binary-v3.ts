/** Deterministic binary transport for explicit reconstruction IR. Binary fields
 * are externalized, not hidden in base64. All data dependencies remain counted. */
import {crc32} from './png.ts';
const MAGIC=0x3350414b,VERSION=1,MAX=512*1024*1024,MAX_META=32*1024*1024,MAX_BLOCKS=1000000;
const text=new TextEncoder(),utf8=new TextDecoder('utf-8',{fatal:true});
function fail(s:string):never{throw Error('Asset binary v3: '+s)}
function integer(n:any,max:number,label:string){if(!Number.isSafeInteger(n)||n<0||n>max)fail('invalid '+label);return n as number}
function same(a:Uint8Array,b:Uint8Array){return a.length===b.length&&a.every((v,i)=>v===b[i])}
function stable(x:any):string{if(x===null||typeof x!=='object'){if(typeof x==='number'&&!Number.isFinite(x))fail('nonfinite metadata');return Object.is(x,-0)?'-0':JSON.stringify(x)}if(Array.isArray(x))return '['+x.map(stable).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}'}
export function packAsset(value:any):Uint8Array{
 const blocks:Uint8Array[]=[],checksums:number[]=[],paths:Array<{path:Array<string|number>;block:number}>=[],buckets=new Map<string,number[]>();let binaryBytes=0;
 const visit=(x:any,path:Array<string|number>,depth:number):any=>{
  if(depth>256)fail('metadata nesting exceeds limit');
  if(x instanceof Uint8Array){const crc=crc32(x),key=x.length+':'+crc;let id=(buckets.get(key)??[]).find(i=>same(blocks[i]!,x));if(id===undefined){id=blocks.length;if(id>=MAX_BLOCKS)fail('too many blocks');binaryBytes+=x.length;if(binaryBytes>MAX)fail('payload exceeds limit');blocks.push(new Uint8Array(x));checksums.push(crc);const list=buckets.get(key)??[];list.push(id);buckets.set(key,list)}paths.push({path,block:id});return null}
  if(x===null||typeof x==='string'||typeof x==='boolean'||typeof x==='number')return x;
  if(Array.isArray(x))return x.map((v,i)=>visit(v,[...path,i],depth+1));
  if(typeof x!=='object'||(Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null))fail('unsupported metadata value');
  const result=Object.create(null);for(const k of Object.keys(x).sort())Object.defineProperty(result,k,{value:visit(x[k],[...path,k],depth+1),enumerable:true,writable:true,configurable:true});return result;
 };
 const tree=visit(value,[],0),metadata=text.encode(stable({tree,paths}));if(metadata.length>MAX_META)fail('metadata exceeds limit');const total=24+8*blocks.length+metadata.length+binaryBytes;if(total>MAX)fail('package exceeds limit');
 const out=new Uint8Array(total),d=new DataView(out.buffer);d.setUint32(0,MAGIC,true);d.setUint16(4,VERSION,true);d.setUint16(6,0,true);d.setUint32(8,metadata.length,true);d.setUint32(12,blocks.length,true);d.setUint32(16,total,true);d.setUint32(20,crc32(metadata),true);
 let off=24+blocks.length*8;out.set(metadata,off);off+=metadata.length;for(let i=0;i<blocks.length;i++){d.setUint32(24+i*8,blocks[i]!.length,true);d.setUint32(28+i*8,checksums[i]!,true);out.set(blocks[i]!,off);off+=blocks[i]!.length}return out;
}
export function unpackAsset(bytes:Uint8Array):any{
 if(!(bytes instanceof Uint8Array)||bytes.length<24||bytes.length>MAX)fail('invalid package extent');const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(d.getUint32(0,true)!==MAGIC||d.getUint16(4,true)!==VERSION||d.getUint16(6,true)!==0||d.getUint32(16,true)!==bytes.length)fail('invalid header');
 const ml=integer(d.getUint32(8,true),MAX_META,'metadata length'),count=integer(d.getUint32(12,true),MAX_BLOCKS,'block count'),start=24+8*count;if(start+ml>bytes.length)fail('truncated directory');const metadata=bytes.subarray(start,start+ml);if(crc32(metadata)!==d.getUint32(20,true))fail('metadata checksum mismatch');let parsed;try{parsed=JSON.parse(utf8.decode(metadata))}catch{return fail('invalid metadata JSON')}
 if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.paths)||parsed.paths.length>MAX_BLOCKS)fail('invalid binary references');const blocks:Uint8Array[]=[];let off=start+ml;
 for(let i=0;i<count;i++){const n=integer(d.getUint32(24+i*8,true),MAX,'block length');if(off+n>bytes.length)fail('truncated block');const b=bytes.subarray(off,off+n);if(crc32(b)!==d.getUint32(28+i*8,true))fail('block checksum mismatch');blocks.push(new Uint8Array(b));off+=n}if(off!==bytes.length)fail('trailing bytes');
 let tree=parsed.tree;const assigned=new Set<string>();for(const ref of parsed.paths){if(!ref||!Array.isArray(ref.path)||ref.path.length>256)fail('invalid reference path');const bi=integer(ref.block,count-1,'block reference'),key=JSON.stringify(ref.path);if(assigned.has(key))fail('duplicate reference path');assigned.add(key);if(!ref.path.length){if(tree!==null)fail('nonempty root placeholder');tree=blocks[bi];continue}let parent=tree;for(let i=0;i<ref.path.length;i++){const k=ref.path[i];if((typeof k!=='string'&&(!Number.isSafeInteger(k)||k<0))||parent===null||typeof parent!=='object'||!Object.hasOwn(parent,k))fail('invalid path segment');if(i===ref.path.length-1){if(parent[k]!==null)fail('nonempty binary placeholder');Object.defineProperty(parent,k,{value:blocks[bi],enumerable:true,writable:true,configurable:true})}else parent=parent[k]}}
 return tree;
}
/** Converts only known v0.2 IR binary fields, never arbitrary scene metadata. */
export function nativeV2RecipeToBinaryTree(recipe:any):any{
 const copy=structuredClone(recipe);for(const key of['surfaces','residualAccessors','images'])if(copy[key]!==undefined)copy[key]=structuredClone(copy[key]);
 const visit=(x:any):void=>{if(!x||typeof x!=='object')return;if(typeof x.codec==='string'&&x.parameters?.version===1&&typeof x.data==='string'&&Number.isSafeInteger(x.sourceLength)){x.data=Uint8Array.from(atob(x.data),c=>c.charCodeAt(0));return}if(Array.isArray(x)){for(const v of x)visit(v)}else for(const v of Object.values(x))visit(v)};
 visit(copy.surfaces);visit(copy.residualAccessors);visit(copy.images);return copy;
}
export function binaryTreeToNativeV2Recipe(tree:any):any{
 const copy=structuredClone(tree);for(const key of['surfaces','residualAccessors','images'])if(copy[key]!==undefined)copy[key]=structuredClone(copy[key]);const visit=(x:any):void=>{if(!x||typeof x!=='object')return;if(typeof x.codec==='string'&&x.parameters?.version===1&&x.data instanceof Uint8Array){let s='';for(let i=0;i<x.data.length;i+=32768)s+=String.fromCharCode(...x.data.subarray(i,i+32768));x.data=btoa(s);return}if(Array.isArray(x)){for(const v of x)visit(v)}else for(const v of Object.values(x))visit(v)};visit(copy.surfaces);visit(copy.residualAccessors);visit(copy.images);return copy;
}
