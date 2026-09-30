/** Exact component coordinate-template experiment. Templates are learned solely
 * from integer source lattices, under 48 signed axis permutations, translation,
 * and optionally per-axis integer scale. Geometry and every accessor order stay
 * unchanged. The caller must choose on COMPLETE asset bytes, never this fragment.
 * No quantization is introduced: each supplied lattice is checked against every
 * original Float32 word before eligibility, and the complete recipe is replayed.
 */
import { decodeBuffer } from '../asset-buffer-codec.ts';
import { encodeExactBuffer } from './exact-encoding.ts';
import type { ExactBuffer } from './exact-encoding.ts';
export const SHAPE_REUSE_POLICY = Object.freeze({ version: 1, maxVertices: 4_000_000, maxComponentVertices: 4096, orientations: 48, minOccurrences: 2 });
const permutations = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]] as const;
export interface ShapeReuseInput { accessor: number; positions: Float32Array; codes: Uint16Array | Uint32Array; indices: Uint8Array | Uint16Array | Uint32Array | null; minimum: number[]; scale: number }
export interface ShapeReuseStream { accessor: number; count: number; codeWidth: 2 | 4; instances: ExactBuffer; map: ExactBuffer; residual: ExactBuffer }
export interface ShapeReuseRecipe { kind: 'exact-shape-reuse'; version: 1; axisScale: boolean; templateCounts: ExactBuffer; templates: ExactBuffer; streams: ShapeReuseStream[] }
export interface ShapeReuseReport { eligibleStreams: number; components: number; templates: number; reusedComponents: number; generatedVertices: number; totalVertices: number; exactFloatWords: number; dictionaryBytes: number; instanceBytes: number; mapBytes: number; residualBytes: number }
const raw = (a: ArrayBufferView) => new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const encode = (a: Uint16Array | Uint32Array, stride = a.BYTES_PER_ELEMENT): ExactBuffer => encodeExactBuffer(raw(a),{componentBytes:a.BYTES_PER_ELEMENT,stride}).recipe;
function fail(message: string): never { throw Error('Shape reuse: '+message); }
function integer(x: unknown, low: number, high: number, label: string): number { if (typeof x !== 'number' || !Number.isSafeInteger(x) || x<low || x>high) fail('invalid '+label); return x; }
function gcd(a: number,b: number): number { while(b){const r=a%b;a=b;b=r;}return a; }
function components(count: number,indices: ShapeReuseInput['indices']): number[][] {
 const parent=Uint32Array.from({length:count},(_,i)=>i);
 const find=(x:number):number=>{while(parent[x]!==x){parent[x]=parent[parent[x]!]!;x=parent[x]!;}return x;};
 const join=(x:number,y:number):void=>{const a=find(x),b=find(y);if(a!==b)parent[b]=a;};
 if(indices){if(indices.length%3)fail('triangle indices required');for(let i=0;i<indices.length;i+=3){const a=integer(indices[i],0,count-1,'index'),b=integer(indices[i+1],0,count-1,'index'),c=integer(indices[i+2],0,count-1,'index');join(a,b);join(a,c);}}
 else {if(count%3)fail('triangle vertices required');for(let i=0;i<count;i+=3){join(i,i+1);join(i,i+2);}}
 const groups=new Map<number,number[]>();for(let i=0;i<count;i++){const root=find(i);let group=groups.get(root);if(!group){group=[];groups.set(root,group);}group.push(i);}return [...groups.values()];
}
interface Canonical { key: string; coordinates: number[]; orientation: number; origins: number[]; scales: number[]; rows: number[] }
function canonical(codes: ShapeReuseInput['codes'],vertices:number[],axisScale:boolean):Canonical|null {
 if(vertices.length>SHAPE_REUSE_POLICY.maxComponentVertices)return null;
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],scales=[0,0,0];
 for(const v of vertices)for(let k=0;k<3;k++){const q=codes[v*3+k]!;lo[k]=Math.min(lo[k]!,q);hi[k]=Math.max(hi[k]!,q);}
 for(const v of vertices)for(let k=0;k<3;k++)scales[k]=gcd(scales[k]!,codes[v*3+k]!-lo[k]!);
 for(let k=0;k<3;k++)scales[k]=axisScale?Math.max(1,scales[k]!):1;
 const extent=hi.map((x,k)=>(x-lo[k]!)/scales[k]!),sorted=extent.slice().sort((a,b)=>a-b);let best:Canonical|null=null;
 for(let pi=0;pi<permutations.length;pi++){const p=permutations[pi]!;if(p.some((a,k)=>extent[a]!==sorted[k]))continue;
  for(let sign=0;sign<8;sign++){
   const rows=vertices.map(v=>p.map((a,k)=>(sign&(1<<k)?hi[a]!-codes[v*3+a]!:codes[v*3+a]!-lo[a]!)/scales[a]!));
   const ordered=rows.slice().sort((a,b)=>a[0]!-b[0]!||a[1]!-b[1]!||a[2]!-b[2]!);const unique=ordered.filter((x,i)=>!i||x.some((q,k)=>q!==ordered[i-1]![k]));const key=unique.map(x=>x.join(',')).join(';');
   if(best!==null&&key>=best.key)continue;
   const lookup=new Map(unique.map((x,i)=>[x.join(','),i]));const origins=lo.slice();for(let k=0;k<3;k++)if(sign&(1<<k))origins[p[k]!]=hi[p[k]!]!;
   best={key,coordinates:unique.flat(),orientation:pi*8+sign,origins,scales:scales.slice(),rows:rows.map(x=>lookup.get(x.join(','))!)};
  }
 }
 return best;
}
/** Produces a candidate only; the caller retains the baseline if full cost grows. */
export function encodeShapeReuse(inputs:ShapeReuseInput[],options:{axisScale?:boolean}={}):{recipe:ShapeReuseRecipe;report:ShapeReuseReport} {
 const axisScale=options.axisScale??false,ids=new Set<number>();let totalVertices=0;
 const groups=new Map<string,{canonical:Canonical;uses:number;id:number}>();
 const work=inputs.map(input=>{
  integer(input.accessor,0,1_000_000,'accessor');if(ids.has(input.accessor))fail('duplicate accessor');ids.add(input.accessor);
  if(!(input.positions instanceof Float32Array)||!(input.codes instanceof Uint16Array||input.codes instanceof Uint32Array)||input.positions.length!==input.codes.length||input.codes.length%3)fail('position/code layout');
  const count=integer(input.codes.length/3,0,SHAPE_REUSE_POLICY.maxVertices,'vertex count');totalVertices+=count;if(totalVertices>SHAPE_REUSE_POLICY.maxVertices)fail('total vertex budget');
  if(input.minimum.length!==3||input.minimum.some(x=>!Number.isFinite(x))||!Number.isFinite(input.scale)||input.scale<0)fail('affine parameters');
  const f=new Float32Array(1),w=new Uint32Array(f.buffer),words=new Uint32Array(input.positions.buffer,input.positions.byteOffset,input.positions.length);
  for(let i=0;i<input.codes.length;i++){integer(input.codes[i],0,0x3fffffff,'lattice code');f[0]=Math.fround(Math.fround(input.codes[i]!*input.scale)+input.minimum[i%3]!);if(w[0]!==words[i])fail('lattice does not recover source Float32 word');}
  return{input,components:components(count,input.indices).map(vertices=>{const c=canonical(input.codes,vertices,axisScale);if(c){const group=groups.get(c.key);if(group)group.uses++;else groups.set(c.key,{canonical:c,uses:1,id:-1});}return{vertices,c};})};
 });
 const counts:number[]=[],coordinates:number[]=[];for(const g of groups.values())if(g.uses>=SHAPE_REUSE_POLICY.minOccurrences){g.id=counts.length;counts.push(g.canonical.coordinates.length/3);coordinates.push(...g.canonical.coordinates);}
 let reusedComponents=0,generatedVertices=0;const streams:ShapeReuseStream[]=work.map(({input,components})=>{
  const mapping=new Uint32Array(input.codes.length/3),instances:number[]=[],residual:number[]=[];let firstPoint=0;
  for(const {vertices,c}of components){if(!c)continue;const group=groups.get(c.key)!;if(group.id<0)continue;instances.push(group.id,c.orientation,...c.origins);if(axisScale)instances.push(...c.scales);for(let i=0;i<vertices.length;i++)mapping[vertices[i]!]=firstPoint+c.rows[i]!+1;firstPoint+=c.coordinates.length/3;generatedVertices+=vertices.length;reusedComponents++;}
  for(let i=0;i<mapping.length;i++)if(!mapping[i])residual.push(input.codes[i*3]!,input.codes[i*3+1]!,input.codes[i*3+2]!);
  const C=input.codes.constructor as typeof Uint16Array|typeof Uint32Array;
  return{accessor:input.accessor,count:mapping.length,codeWidth:input.codes.BYTES_PER_ELEMENT as 2|4,instances:encode(Uint32Array.from(instances),(axisScale?8:5)*4),map:encode(mapping),residual:encode(C.from(residual),3*C.BYTES_PER_ELEMENT)};
 });
 const recipe:ShapeReuseRecipe={kind:'exact-shape-reuse',version:1,axisScale,templateCounts:encode(Uint32Array.from(counts)),templates:encode(Uint32Array.from(coordinates),12),streams};
 const decoded=replayShapeReuse(recipe);for(const input of inputs){const result=decoded.get(input.accessor)!;if(result.length!==input.codes.length||result.some((x,i)=>x!==input.codes[i]))fail('full exact lattice replay failed');}
 const report:ShapeReuseReport={eligibleStreams:inputs.length,components:work.reduce((n,w)=>n+w.components.length,0),templates:counts.length,reusedComponents,generatedVertices,totalVertices,exactFloatWords:totalVertices*3,dictionaryBytes:recipe.templates.data.length+recipe.templateCounts.data.length,instanceBytes:streams.reduce((n,s)=>n+s.instances.data.length,0),mapBytes:streams.reduce((n,s)=>n+s.map.data.length,0),residualBytes:streams.reduce((n,s)=>n+s.residual.data.length,0)};
 return{recipe,report};
}
function decodeWords(wire:ExactBuffer,width:2|4,maxWords:number):Uint16Array|Uint32Array {
 if(!wire||wire.sourceLength%width)fail('word extent');integer(wire.sourceLength/width,0,maxWords,'word budget');const bytes=decodeBuffer(wire,maxWords*width),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=width===2?new Uint16Array(bytes.length/2):new Uint32Array(bytes.length/4);for(let i=0;i<out.length;i++)out[i]=width===2?view.getUint16(i*2,true):view.getUint32(i*4,true);return out;
}
/** Portable replay, independent of source GLB, Draco, topology and mesh names. */
export function replayShapeReuse(recipe:ShapeReuseRecipe):Map<number,Uint16Array|Uint32Array> {
 if(!recipe||recipe.kind!=='exact-shape-reuse'||recipe.version!==1||typeof recipe.axisScale!=='boolean'||!Array.isArray(recipe.streams)||recipe.streams.length>1_000_000)fail('recipe header');
 const max=SHAPE_REUSE_POLICY.maxVertices,counts=decodeWords(recipe.templateCounts,4,max),templates=decodeWords(recipe.templates,4,max*3),offsets=new Uint32Array(counts.length+1);let points=0;for(let i=0;i<counts.length;i++){integer(counts[i],1,SHAPE_REUSE_POLICY.maxComponentVertices,'template points');points+=counts[i]!;if(points>max)fail('dictionary point budget');offsets[i+1]=points;}if(points*3!==templates.length)fail('template extent');for(const value of templates)integer(value,0,0x3fffffff,'template coordinate');
 const output=new Map<number,Uint16Array|Uint32Array>();let total=0;
 for(const stream of recipe.streams){integer(stream.accessor,0,1_000_000,'accessor');if(output.has(stream.accessor))fail('duplicate accessor');const count=integer(stream.count,0,max,'count');total+=count;if(total>max)fail('total output budget');if(stream.codeWidth!==2&&stream.codeWidth!==4)fail('code width');
  const stride=recipe.axisScale?8:5,instances=decodeWords(stream.instances,4,count*stride),map=decodeWords(stream.map,4,count),residual=decodeWords(stream.residual,stream.codeWidth,count*3);if(instances.length%stride||map.length!==count||residual.length%3)fail('stream extent');
  let generated=0;for(let i=0;i<instances.length;i+=stride){const id=integer(instances[i],0,counts.length-1,'template reference');integer(instances[i+1],0,47,'orientation');generated+=counts[id]!;if(generated>count)fail('generated point budget');}
  const prediction=new Uint32Array(generated*3);let at=0;
  for(let i=0;i<instances.length;i+=stride){const id=instances[i]!,orientation=instances[i+1]!,p=permutations[orientation>>>3]!,sign=orientation&7;for(let v=offsets[id]!;v<offsets[id+1]!;v++){for(let k=0;k<3;k++){const axis=p[k]!,scale=recipe.axisScale?integer(instances[i+5+axis],1,0x3fffffff,'axis scale'):1,origin=integer(instances[i+2+axis],0,0x3fffffff,'origin'),q=origin+(sign&(1<<k)?-1:1)*templates[v*3+k]!*scale;prediction[at*3+axis]=integer(q,0,stream.codeWidth===2?65535:0x3fffffff,'generated coordinate');}at++;}}
  const array=stream.codeWidth===2?new Uint16Array(count*3):new Uint32Array(count*3);let literal=0;
  for(let v=0;v<count;v++){const ref=integer(map[v],0,generated,'point reference');if(ref)array.set(prediction.subarray((ref-1)*3,ref*3),v*3);else{if(literal+3>residual.length)fail('truncated residual');array.set(residual.subarray(literal,literal+3),v*3);literal+=3;}}
  if(literal!==residual.length)fail('trailing residual');output.set(stream.accessor,array);
 }
 return output;
}
