/** Lossless transport preparation. Required asset instructions remain in KAP;
 * shared executable code is external and counted once by the application. */
import{packAsset,unpackAsset}from'./asset-binary-v3.ts';import{decodeBuffer}from'./asset-buffer-codec.ts';import{RAW_TRANSPORT_FORMAT}from'./asset-replay-shared.ts';
const codecs=new Set(['zlib','byteplanes-zlib','delta-zlib','xor-zlib','delta-byteplanes-zlib','xor-byteplanes-zlib','row-dictionary-zlib','float32-runs-zlib']),MAX=128*1024*1024;
export function prepareSharedTransport(nativeBytes:Uint8Array,options:{separateStorageProvenance?:boolean}={}){
 const recipe:any=unpackAsset(nativeBytes);if(!['KEEL-NATIVE-V4','KEEL-TOPOLOGY-ATTRIBUTES-V1'].includes(recipe?.format))throw Error('Expected validated native asset package');
 let nodes=0,total=0,buffers=0;const pending:Array<{wire:any;length:number}>=[];
 const visit=(x:any,depth:number):void=>{if(depth>256||++nodes>2000000)throw Error('Transport metadata budget');if(!x||typeof x!=='object'||x instanceof Uint8Array)return;
  if(codecs.has(x.codec)&&x.data instanceof Uint8Array){if(x.parameters?.version!==1||!Number.isSafeInteger(x.sourceLength)||x.sourceLength<0||x.sourceLength>MAX)throw Error('Invalid transport buffer');const p=x.parameters;let length=x.sourceLength;
   if(x.codec==='row-dictionary-zlib'){if(!Number.isSafeInteger(p.stride)||p.stride<1||p.stride>4096||x.sourceLength%p.stride||!Number.isSafeInteger(p.dictionaryRows)||p.dictionaryRows<1||p.dictionaryRows>x.sourceLength/p.stride||![1,2,4].includes(p.indexBytes))throw Error('Invalid transport dictionary');length=p.dictionaryRows*p.stride+x.sourceLength/p.stride*p.indexBytes;}
   else if(x.codec==='float32-runs-zlib')length=p.decodedLength;
   if(!Number.isSafeInteger(length)||length<0||length>MAX||(total+=length)>MAX)throw Error('Transport allocation budget');pending.push({wire:x,length});return;}
  for(const[k,v]of Object.entries(x))if(k!=='json'&&k!=='sourceStorageMetadata')visit(v,depth+1);
 };visit(recipe,0);
 for(const{wire,length}of pending){wire.data=decodeBuffer({codec:'zlib',parameters:{version:1},sourceLength:length,data:wire.data},length);wire.rawTransport=1;buffers++;}
 let provenance:any;const body=recipe.format==='KEEL-TOPOLOGY-ATTRIBUTES-V1'?recipe.base:recipe,base=body?.native?.base;if(!base||base.format!=='KEEL-NATIVE-ASSET')throw Error('Native base absent');
 if(options.separateStorageProvenance&&Object.hasOwn(base,'sourceStorageMetadata')){provenance=base.sourceStorageMetadata;delete base.sourceStorageMetadata;}
 return{packageBytes:packAsset({format:RAW_TRANSPORT_FORMAT,recipe}),provenance,report:{format:RAW_TRANSPORT_FORMAT,transformedBuffers:buffers,transformedBytes:total,separatedStorageProvenance:provenance!==undefined,scope:'All unique native asset data and instructions; optional original storage-layout audit property may be a sidecar. Shared runtime is separate.'}};
}
