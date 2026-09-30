/** Import-time extraction of source Draco quantization. Every proposed rule is
 * checked against decoded source Float32 words before it can replace a residual. */
import type {NormalizedAsset,NormalizeAssetInput,NormalizedAccessor} from '../asset-normalize-v3.ts';
import {decodeBuffer} from '../asset-buffer-codec.ts';
export interface AffineHint {kind:'float-affine';width:number;bits:number;minimum:number[];scale:number}
export interface OctHint {kind:'octahedral';bits:number;source:Float32Array;pairs:Uint32Array}
export type DracoHint=AffineHint|OctHint;
export interface Wire {codec:string;parameters:Record<string,number>;sourceLength:number;data:Uint8Array}
export interface AffineRecipe {kind:'float-affine';accessor:number;count:number;width:number;minimum:number[];scale:number;codeWidth:2|4;codes:Wire}
const raw=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const same=(a:ArrayBufferView,b:ArrayBufferView)=>a.byteLength===b.byteLength&&raw(a).every((v,i)=>v===raw(b)[i]);
function canonicalPath(value:string):string{const out:string[]=[];for(const part of value.split('/')){if(part==='..'){if(!out.length)throw Error('Draco hint resource escapes root');out.pop()}else if(part&&part!=='.')out.push(part)}return out.join('/')}
function resource(input:NormalizeAssetInput,uri:string):Uint8Array{
 if(uri.startsWith('data:')){const comma=uri.indexOf(','),body=uri.slice(comma+1);if(uri.slice(0,comma).endsWith(';base64'))return Uint8Array.from(atob(body),c=>c.charCodeAt(0));const out:number[]=[];for(let i=0;i<body.length;i++){if(body[i]==='%'){out.push(parseInt(body.slice(i+1,i+3),16));i+=2;}else out.push(body.charCodeAt(i));}return new Uint8Array(out)}
 const base=canonicalPath(input.entry).split('/').slice(0,-1).join('/'),name=canonicalPath((base?base+'/':'')+decodeURIComponent(uri)),file=input.files.find(f=>canonicalPath(f.name)===name);if(!file)throw Error('Draco hint resource missing');return file.data;
}
export async function extractDracoHints(input:NormalizeAssetInput,asset:NormalizedAsset):Promise<Map<number,DracoHint>>{
 const hints=new Map<number,DracoHint>();if(!asset.validation.dracoPrimitives)return hints;const mod=await input.dracoDecoder;if(!mod)throw Error('Draco hints require decoder');const entry=input.files.find(f=>canonicalPath(f.name)===asset.source.entry)!.data;let binary:Uint8Array|undefined;if(asset.source.container==='glb'){const v=new DataView(entry.buffer,entry.byteOffset,entry.byteLength);let at=12;while(at<entry.length){const n=v.getUint32(at,true),type=v.getUint32(at+4,true);if(type===0x004e4942)binary=entry.subarray(at+8,at+8+n);at+=8+n}}
 const j=asset.sourceJson,buffers=(j.buffers??[]).map((b:any,i:number)=>b.uri!==undefined?resource(input,b.uri):i===0&&binary?binary:undefined);
 for(const mesh of j.meshes??[])for(const primitive of mesh.primitives){const compressed=primitive.extensions?.KHR_draco_mesh_compression;if(!compressed)continue;const view=j.bufferViews[compressed.bufferView],buf=buffers[view.buffer];if(!buf)throw Error('Draco hint buffer missing');const bytes=buf.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),decoder=new mod.Decoder(),buffer=new mod.DecoderBuffer(),decoded=new mod.Mesh();let status:any;
  try{for(const t of[mod.POSITION,mod.NORMAL,mod.TEX_COORD,mod.COLOR,mod.GENERIC])decoder.SkipAttributeTransform(t);buffer.Init(bytes,bytes.length);status=decoder.DecodeBufferToMesh(buffer,decoded);if(!status.ok())throw Error('Draco hint decode failed');
   for(const[semantic,unique]of Object.entries(compressed.attributes)){const id=primitive.attributes[semantic],source=asset.accessors[id];if(!source||source.componentType!==5126)continue;const a=decoder.GetAttributeByUniqueId(decoded,unique),quant=new mod.AttributeQuantizationTransform(),oct=new mod.AttributeOctahedronTransform();
    try{if(quant.InitFromAttribute(a)){const width=a.num_components(),bits=quant.quantization_bits();hints.set(id,{kind:'float-affine',width,bits,minimum:Array.from({length:width},(_,i)=>quant.min_value(i)),scale:Math.fround(quant.range()/(2**bits-1))});}
     else if(semantic==='NORMAL'&&oct.InitFromAttribute(a)&&a.num_components()===2){const n=decoded.num_points()*2,pointer=mod._malloc(n*4);try{if(!decoder.GetAttributeDataArrayForAllPoints(decoded,a,mod.DT_UINT32,n*4,pointer))throw Error('Draco normal codes missing');hints.set(id,{kind:'octahedral',bits:oct.quantization_bits(),source:source.array as Float32Array,pairs:new Uint32Array(mod.HEAPU8.buffer,pointer,n).slice()});}finally{mod._free(pointer)}}
    }finally{mod.destroy(quant);mod.destroy(oct)}
   }
  }finally{if(status)mod.destroy(status);mod.destroy(decoded);mod.destroy(buffer);mod.destroy(decoder)}
 }
 return hints;
}
export function encodeAffineHint(accessor:number,a:NormalizedAccessor,hint:AffineHint,encode:(bytes:Uint8Array,hints?:{stride:number;componentBytes:number})=>Wire):AffineRecipe|null{
 if(a.componentType!==5126||a.array.length!==a.count*hint.width||!Number.isFinite(hint.scale)||hint.scale<0||hint.bits<1||hint.bits>30)return null;
 const codeWidth=hint.bits<=16?2:4,codes=codeWidth===2?new Uint16Array(a.array.length):new Uint32Array(a.array.length),probe=new Float32Array(a.array.length),max=2**hint.bits-1;
 for(let i=0;i<a.array.length;i++){const value=a.array[i]!,minimum=hint.minimum[i%hint.width]!,guess=hint.scale?Math.round((value-minimum)/hint.scale):0;let found=false;for(const q of[guess,guess-1,guess+1])if(q>=0&&q<=max&&Object.is(Math.fround(Math.fround(q*hint.scale)+minimum),value)){codes[i]=q;probe[i]=value;found=true;break}if(!found)return null}
 const recipe:AffineRecipe={kind:'float-affine',accessor,count:a.count,width:hint.width,minimum:hint.minimum,scale:hint.scale,codeWidth,codes:encode(raw(codes),{stride:hint.width*codeWidth,componentBytes:codeWidth})};if(!same(replayAffineHint(recipe),a.array))return null;return recipe;
}
export function replayAffineHint(r:AffineRecipe):Float32Array{
 if(r.kind!=='float-affine'||!Number.isSafeInteger(r.count)||r.count<0||r.count>4000000||!Number.isSafeInteger(r.width)||r.width<1||r.width>16||![2,4].includes(r.codeWidth)||!Array.isArray(r.minimum)||r.minimum.length!==r.width||r.minimum.some(x=>!Number.isFinite(x))||!Number.isFinite(r.scale)||r.scale<0)throw Error('Invalid affine attribute recipe');
 const length=r.count*r.width;if(length*4>256*1024*1024||r.codes.sourceLength!==length*r.codeWidth)throw Error('Affine attribute extent exceeds budget');const b=decodeBuffer(r.codes,length*r.codeWidth),v=new DataView(b.buffer,b.byteOffset,b.byteLength),out=new Float32Array(length);for(let i=0;i<length;i++){const q=r.codeWidth===2?v.getUint16(i*2,true):v.getUint32(i*4,true);out[i]=Math.fround(Math.fround(q*r.scale)+r.minimum[i%r.width]!)}return out;
}
/** Build a recipe accepted by the existing exact octahedral decoder. */
export function encodeOctHint(a:NormalizedAccessor,hint:OctHint,encode:(bytes:Uint8Array,hints?:{stride:number;componentBytes:number})=>Wire):any|null{
 if(a.type!=='VEC3'||a.componentType!==5126||hint.bits<2||hint.bits>16)return null;let pairs=hint.pairs;
 if(!same(a.array,hint.source)){const sourceWords=new Uint32Array(hint.source.buffer,hint.source.byteOffset,hint.source.length),words=new Uint32Array(a.array.buffer,a.array.byteOffset,a.array.length),lookup=new Map<string,number>();for(let i=0;i<sourceWords.length;i+=3)lookup.set(sourceWords[i]+','+sourceWords[i+1]+','+sourceWords[i+2],i/3);pairs=new Uint32Array(a.count*2);for(let i=0;i<a.count;i++){const row=lookup.get(words[i*3]+','+words[i*3+1]+','+words[i*3+2]);if(row===undefined)return null;pairs.set(hint.pairs.subarray(row*2,row*2+2),i*2)}}
 const packed=new Uint8Array(Math.ceil(pairs.length*hint.bits/8));let bit=0;const mask=2**hint.bits-1,half=2**(hint.bits-1);for(let i=0;i<pairs.length;i++){let delta=(pairs[i]!-(i>=2?pairs[i-2]!:0))&mask;if(delta>=half)delta-=mask+1;const code=delta<0?-delta*2-1:delta*2;for(let k=0;k<hint.bits;k++,bit++)if(code&(2**k))packed[bit>>>3]!|=1<<(bit&7)}
 return{version:3,componentType:5126,type:'VEC3',count:a.count,normalized:a.normalized,storage:{kind:'octahedral-f32',bits:hint.bits,predictor:1,pairs:encode(packed)}};
}
