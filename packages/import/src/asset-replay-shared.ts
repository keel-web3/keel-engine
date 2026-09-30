import {unpackAsset} from './asset-binary-v3.ts';
import {buildAsset as buildNative} from './asset-replay-v4.ts';
import {buildAsset as buildPredicted} from './asset-replay-topology.ts';
import {buildGeometricNormals} from './asset-replay-geometric-normals.ts';
const buildLegacy=(recipe:any)=>recipe?.format==='KEEL-NATIVE-V4'?buildNative(recipe):recipe?.format==='KEEL-TOPOLOGY-ATTRIBUTES-V1'?buildPredicted(recipe):recipe?.format==='KEEL-GEOMETRIC-NORMALS-V1'?buildGeometricNormals(recipe):Promise.reject(Error('Unsupported shared asset format'));
export const RAW_TRANSPORT_FORMAT='KEEL-RAW-TRANSFORM-TRANSPORT-V1';
const codecs=new Set(['zlib','byteplanes-zlib','delta-zlib','xor-zlib','delta-byteplanes-zlib','xor-byteplanes-zlib','row-dictionary-zlib','float32-runs-zlib']);
const MAX=128*1024*1024;
/** Wrap existing transformed bytes in uncompressed RFC1950/RFC1951 blocks.
 * This changes transport only; the original decoder applies every predictor.
 */
export function storedZlib(data:Uint8Array):Uint8Array{
 if(!(data instanceof Uint8Array)||data.length>MAX)throw Error('Raw transport payload limit');
 const blocks=Math.max(1,Math.ceil(data.length/65535)),out=new Uint8Array(data.length+6+blocks*5),v=new DataView(out.buffer);out[0]=0x78;out[1]=1;let src=0,dst=2,a=1,b=0;
 for(let block=0;block<blocks;block++){const n=Math.min(65535,data.length-src);out[dst++]=block===blocks-1?1:0;v.setUint16(dst,n,true);v.setUint16(dst+2,n^65535,true);dst+=4;out.set(data.subarray(src,src+n),dst);for(let end=src+n;src<end;){const stop=Math.min(end,src+5552);for(;src<stop;src++){a+=data[src]!;b+=a;}a%=65521;b%=65521;}dst+=n;}
 v.setUint32(dst,((b<<16)|a)>>>0,false);return out;
}
/** Two passes bound allocations before reconstructing any transport block. */
export function restoreRawTransport(wrapper:any):any{
 if(wrapper?.format!==RAW_TRANSPORT_FORMAT||!wrapper.recipe||typeof wrapper.recipe!=='object')throw Error('Invalid raw transport package');
 const pending:any[]=[];let nodes=0,total=0;
 const visit=(x:any,depth:number):void=>{
  if(depth>256||++nodes>2000000)throw Error('Raw transport metadata budget');
  if(x===null||typeof x!=='object'||x instanceof Uint8Array)return;
  if(Object.hasOwn(x,'rawTransport')){
   if(x.rawTransport!==1||!codecs.has(x.codec)||x.parameters?.version!==1||!(x.data instanceof Uint8Array)||!Number.isSafeInteger(x.sourceLength)||x.sourceLength<0||x.sourceLength>MAX)throw Error('Invalid raw transport buffer');
   const p=x.parameters;let expected=x.sourceLength;
   if(x.codec==='row-dictionary-zlib'){if(!Number.isSafeInteger(p.stride)||p.stride<1||p.stride>4096||x.sourceLength%p.stride||!Number.isSafeInteger(p.dictionaryRows)||p.dictionaryRows<1||p.dictionaryRows>x.sourceLength/p.stride||![1,2,4].includes(p.indexBytes))throw Error('Invalid raw dictionary');expected=p.dictionaryRows*p.stride+(x.sourceLength/p.stride)*p.indexBytes;}
   else if(x.codec==='float32-runs-zlib')expected=p.decodedLength;
   if(!Number.isSafeInteger(expected)||expected<0||expected>MAX||x.data.length!==expected)throw Error('Raw transport extent differs');
   total+=x.data.length+6+5*Math.max(1,Math.ceil(x.data.length/65535));if(total>MAX)throw Error('Raw transport replay budget');pending.push(x);return;
  }
  for(const[key,value]of Object.entries(x))if(key!=='json'&&key!=='sourceStorageMetadata')visit(value,depth+1);
 };
 visit(wrapper.recipe,0);
 for(const x of pending){x.data=storedZlib(x.data);delete x.rawTransport;}
 return wrapper.recipe;
}
export async function buildFromPackage(data:Uint8Array){const recipe:any=unpackAsset(data);return buildLegacy(recipe?.format===RAW_TRANSPORT_FORMAT?restoreRawTransport(recipe):recipe);}
export async function decodePackage(data:Uint8Array){const built=await buildFromPackage(data);return{entry:'asset.glb',files:[{name:'asset.glb',data:built.glb}],nativeScene:built.scene,representation:'native-code'};}
