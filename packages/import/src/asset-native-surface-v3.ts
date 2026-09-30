/** Binary-capable v3 replay adapter; v2 remains frozen. Native surface IR: exact coordinates and ordered topology, never a GLB byte recipe.
 * All inference is deterministic and asset-independent; residuals always compete by cost.
 */
import { meshData } from './write.ts';
import type { MeshData } from './write.ts';
import { encodeBuffer, decodeBuffer } from './asset-buffer-codec.ts';
export const NATIVE_SURFACE_VERSION = 2;
const LIMIT = 64 * 1024 * 1024;
const INFERENCE_VERTICES = 262144, INFERENCE_TRIANGLES = 262144;
const text = new TextEncoder();
type Indices = Uint8Array | Uint16Array | Uint32Array;
type Wire = { codec: string; parameters: Record<string, number>; sourceLength: number; data: string | Uint8Array };
type PositionRecipe = { kind: 'residual'; buffer: Wire } | { kind: 'affine' | 'grid'; start: number[]; u: number[]; v?: number[]; columns?: number } | { kind: 'mirror'; axis: number; canonical: Wire; codes: Wire; canonicalCount: number };
type TopologyRecipe = { kind: 'unindexed' } | { kind: 'residual'; buffer: Wire } | { kind: 'operations'; program: Wire; mirror?: Wire };
export interface SurfaceRecipe { version: 2; vertexCount: number; mode: number; indexType: 0 | 5121 | 5123 | 5125; indexCount: number; positions: PositionRecipe; topology: TopologyRecipe }
export interface SurfaceInput { positions: Float32Array; indices: Indices | null; mode?: number }
export interface SurfaceReplay { mesh: MeshData; positions: Float32Array; indices: Indices | null; mode: number }
export interface SurfaceMetrics { recipeBytes: number; residualRecipeBytes: number; positionOperation: string; topologyOperation: string; explicitResidualTriangles: number; filledContourTriangles: number; stripTriangles: number; mirroredTriangles: number; affineGeneratedVertices: number; mirrorGeneratedVertices: number; exactPositions: true; exactIndexOrder: true; decoderCost: string }
function integer(value: unknown, min: number, max: number, label: string): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Native surface: invalid ${label}`); return value; }
function size(x: unknown): number { return text.encode(JSON.stringify(x)).length; }
function b64(bytes: Uint8Array): string { let s = ''; for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384)); return btoa(s); }
function unb64(s: string | Uint8Array): Uint8Array { if (s instanceof Uint8Array) { if(s.length>LIMIT*2)throw new Error('Native surface: payload limit');return s; } if (typeof s !== 'string' || s.length > LIMIT * 3 || s.length%4 || /[^A-Za-z0-9+/=]/.test(s)) throw new Error('Native surface: invalid payload'); const pad=s.endsWith('==')?2:s.endsWith('=')?1:0, at=s.indexOf('=');if(at!==-1&&at!==s.length-pad)throw new Error('Native surface: invalid padding'); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function wire(bytes: Uint8Array, stride: number, componentBytes: number): Wire { const e = encodeBuffer(bytes, { stride, componentBytes }); return { codec: e.codec, parameters: e.parameters, sourceLength: e.sourceLength, data: b64(e.data) }; }
function unwire(w: Wire, expected?: number): Uint8Array { if (!w || typeof w !== 'object' || (expected !== undefined && w.sourceLength !== expected)) throw new Error('Native surface: invalid buffer extent'); integer(w.sourceLength, 0, LIMIT * 2, 'payload length'); return decodeBuffer({ ...w, data: unb64(w.data) }, LIMIT * 2); }
function wordsBytes(words: ArrayLike<number>, width = 4): Uint8Array { const out = new Uint8Array(words.length * width), d = new DataView(out.buffer); for (let i = 0; i < words.length; i++) { if (width === 1) out[i] = words[i]!; else if (width === 2) d.setUint16(i * 2, words[i]!, true); else d.setUint32(i * 4, words[i]!, true); } return out; }
function bytesWords(bytes: Uint8Array, width = 4): Uint32Array { if (bytes.length % width) throw new Error('Native surface: invalid word bytes'); const out = new Uint32Array(bytes.length / width), d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); for (let i = 0; i < out.length; i++) out[i] = width === 1 ? bytes[i]! : width === 2 ? d.getUint16(i * 2, true) : d.getUint32(i * 4, true); return out; }
function floatWords(a: Float32Array): Uint32Array { return new Uint32Array(a.buffer, a.byteOffset, a.length); }
function floatsFromWords(a: ArrayLike<number>): Float32Array { const result = new Float32Array(a.length); new Uint32Array(result.buffer).set(a); return result; }
function equalWords(a: ArrayLike<number>, b: ArrayLike<number>): boolean { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function buildAffine(count: number, p: Extract<PositionRecipe, {kind:'affine'|'grid'}>): Float32Array {
  if (!Array.isArray(p.start) || !Array.isArray(p.u) || p.start.length !== 3 || p.u.length !== 3 || p.start.some(x => !Number.isInteger(x) || x < 0 || x > 0xffffffff) || p.u.some(x => !Number.isInteger(x) || x < 0 || x > 0xffffffff)) throw new Error('Native surface: invalid affine words');
  if (p.kind === 'grid' && (!Array.isArray(p.v) || p.v.length !== 3 || p.v.some(x => !Number.isInteger(x) || x < 0 || x > 0xffffffff))) throw new Error('Native surface: invalid grid words');
  const start = floatsFromWords(p.start), u = floatsFromWords(p.u), v = p.kind === 'grid' ? floatsFromWords(p.v!) : new Float32Array(3);
  if (v.length !== 3 || [...start,...u,...v].some(x => !Number.isFinite(x))) throw new Error('Native surface: nonfinite affine parameters');
  const columns = p.kind === 'grid' ? integer(p.columns, 2, count, 'grid columns') : count;
  if (p.kind === 'grid' && count % columns) throw new Error('Native surface: invalid grid extent');
  const out = new Float32Array(count * 3); if (count) new Uint32Array(out.buffer).set(p.start, 0);
  for (let i = 1; i < count; i++) for (let k = 0; k < 3; k++) out[3 * i + k] = Math.fround(start[k]! + u[k]! * (i % columns) + v[k]! * Math.floor(i / columns));
  return out;
}
function positionCandidates(positions: Float32Array): Array<{recipe: PositionRecipe; generated: number}> {
  const words = floatWords(positions), count = positions.length / 3;
  const results: Array<{recipe: PositionRecipe; generated: number}> = [{ recipe: { kind: 'residual', buffer: wire(wordsBytes(words), 12, 4) }, generated: 0 }];
  if (count < 2 || count > INFERENCE_VERTICES || positions.some(x => !Number.isFinite(x))) return results;
  const start = Array.from(words.subarray(0, 3)), u = new Float32Array([0,1,2].map(k => Math.fround(positions[3+k]! - positions[k]!)));
  const affine: PositionRecipe = { kind: 'affine', start, u: Array.from(floatWords(u)) };
  if (equalWords(floatWords(buildAffine(count, affine)), words)) results.push({ recipe: affine, generated: count - 1 });
  const widths: number[] = []; for (let i = 2; i * i <= count; i++) if (count % i === 0) { widths.push(i); if (i !== count / i) widths.push(count / i); }
  widths.sort((a,b)=>a-b);
  for (const columns of widths) {
    const v = new Float32Array([0,1,2].map(k => Math.fround(positions[columns*3+k]! - positions[k]!)));
    const grid: PositionRecipe = { kind: 'grid', start, u: Array.from(floatWords(u)), v: Array.from(floatWords(v)), columns };
    if (![...u,...v].every(Number.isFinite)) continue;
    if (equalWords(floatWords(buildAffine(count, grid)), words)) results.push({ recipe: grid, generated: count - 1 });
  }
  for (let axis = 0; axis < 3; axis++) {
    const table = new Map<string, number>(), canonical: number[] = [], codes = new Uint32Array(count), signs: number[] = []; let generated = 0;
    for (let i = 0; i < count; i++) {
      const row = Array.from(words.subarray(i*3,i*3+3)), sign = row[axis]! >>> 31; row[axis] = row[axis]! & 0x7fffffff;
      const key = row.join(','); let id = table.get(key);
      if (id === undefined) { id = table.size; table.set(key,id); canonical.push(...row); signs.push(0); }
      if (row[axis] !== 0 && (signs[id]! & (sign ? 1 : 2))) generated++;
      signs[id] = signs[id]! | (sign ? 2 : 1); codes[i] = id * 2 + sign;
    }
    if (generated) results.push({ recipe: { kind:'mirror', axis, canonicalCount: table.size, canonical: wire(wordsBytes(canonical),12,4), codes: wire(wordsBytes(codes),4,4) }, generated });
  }
  return results;
}
function restorePositions(p: PositionRecipe, count: number): Float32Array {
  if (p.kind === 'residual') return floatsFromWords(bytesWords(unwire(p.buffer, count * 12)));
  if (p.kind === 'affine' || p.kind === 'grid') return buildAffine(count,p);
  if (p.kind !== 'mirror') throw new Error('Native surface: unknown position operation');
  const axis = integer(p.axis,0,2,'mirror axis'), n = integer(p.canonicalCount,1,count,'canonical count');
  const canonical = bytesWords(unwire(p.canonical,n*12)), codes = bytesWords(unwire(p.codes,count*4)), words = new Uint32Array(count*3);
  for (let i=0;i<count;i++) { const code=codes[i]!, id=Math.floor(code/2); if(id>=n) throw new Error('Native surface: mirror reference out of range'); words.set(canonical.subarray(id*3,id*3+3),i*3); words[i*3+axis] = words[i*3+axis]! ^ ((code&1)?0x80000000:0); }
  return floatsFromWords(words);
}
const PERMUTATIONS = [[0,2,1],[2,1,0],[1,0,2],[0,1,2],[1,2,0],[2,0,1]];
interface OpCounts { explicitResidualTriangles:number; filledContourTriangles:number; stripTriangles:number; mirroredTriangles:number }
function coplanar(vertices: number[], p: Float32Array): boolean {
  const a=vertices[0]!*3,b=vertices[1]!*3,c=vertices[2]!*3, u=[0,1,2].map(k=>p[b+k]!-p[a+k]!),v=[0,1,2].map(k=>p[c+k]!-p[a+k]!);
  const normal=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
  if(normal.every(x=>x===0)) return false;
  return vertices.every(i=>normal.reduce((s,n,k)=>s+n*(p[i*3+k]!-p[a+k]!),0)===0);
}
function mirroredFaces(positions:Float32Array, indices:Indices, axis:number): {links:Map<number,{source:number;permutation:number}>; mapping:Map<number,number>} {
  const words=floatWords(positions), keyVertex=(id:number,flip=false)=>{ const a=Array.from(words.subarray(id*3,id*3+3)); if(flip) a[axis]=a[axis]!^0x80000000; return a.map(x=>(x&0x7fffffff)===0?0:x>>>0).join(','); };
  const keyFace=(i:number,flip=false)=>[0,1,2].map(k=>keyVertex(indices[i*3+k]!,flip)).sort().join(';'), faces=new Map<string,number[]>(), mapping=new Map<number,number>(),links=new Map<number,{source:number;permutation:number}>();
  for(let i=0;i<indices.length/3;i++) {const key=keyFace(i),a=faces.get(key)??[];a.push(i);faces.set(key,a);}
  for(let i=0;i<indices.length/3;i++) {
    const found=faces.get(keyFace(i,true)); if(found?.length!==1||found[0]!>=i) continue; const source=found[0]!, local=new Map<number,number>(); let valid=true;
    for(let k=0;k<3;k++){const a=indices[source*3+k]!, target=[0,1,2].map(t=>indices[i*3+t]!).filter(b=>keyVertex(b)===keyVertex(a,true));if(target.length!==1){valid=false;break}const b=target[0]!;if((mapping.has(a)&&mapping.get(a)!==b)||(mapping.has(b)&&mapping.get(b)!==a)){valid=false;break}local.set(a,b);local.set(b,a);}
    if(!valid)continue; const permutation=PERMUTATIONS.findIndex(order=>order.every((k,j)=>local.get(indices[source*3+k]!)===indices[i*3+j])); if(permutation<0)continue;
    for(const[a,b]of local)mapping.set(a,b);links.set(i,{source,permutation});
  }
  return{links,mapping};
}
function operations(positions:Float32Array, indices:Indices, symmetry?:ReturnType<typeof mirroredFaces>): {recipe:TopologyRecipe;counts:OpCounts} {
  const triangles=indices.length/3, program:number[]=[], usedMirror=new Map<number,number>(), counts:OpCounts={explicitResidualTriangles:0,filledContourTriangles:0,stripTriangles:0,mirroredTriangles:0}; let triangle=0,literal=-1;
  const flush=()=>{if(literal>=0){const n=triangle-literal;program.push(0,n);for(let i=literal*3;i<triangle*3;i++)program.push(indices[i]!);counts.explicitResidualTriangles+=n;literal=-1;}};
  while(triangle<triangles){
    const first=Array.from(indices.subarray(triangle*3,triangle*3+3));let fan=[...first],strip=[...first];
    for(let t=triangle+1;t<triangles;t++){if(indices[t*3]!==fan[0]||indices[t*3+1]!==fan[fan.length-1])break;fan.push(indices[t*3+2]!);}
    for(let t=triangle+1;t<triangles;t++){const k=strip.length, a=k%2?strip[k-1]:strip[k-2],b=k%2?strip[k-2]:strip[k-1];if(indices[t*3]!==a||indices[t*3+1]!==b)break;strip.push(indices[t*3+2]!);}
    const link=symmetry?.links.get(triangle);let mirrored=link?1:0;if(link)while(triangle+mirrored<triangles){const next=symmetry!.links.get(triangle+mirrored);if(!next||next.source!==link.source+mirrored||next.permutation!==link.permutation||next.source>=triangle)break;mirrored++;}
    const fanCount=fan.length-2,stripCount=strip.length-2,fanSaving=2*fanCount-4,stripSaving=2*stripCount-4,mirrorSaving=3*mirrored-4;
    if(mirrored>=2&&mirrorSaving>Math.max(fanSaving,stripSaving)){flush();program.push(3,mirrored,link!.source,link!.permutation);for(let t=0;t<mirrored;t++)for(let k=0;k<3;k++){const a=indices[(link!.source+t)*3+k]!,b=symmetry!.mapping.get(a)!;usedMirror.set(a,b);usedMirror.set(b,a);}counts.mirroredTriangles+=mirrored;triangle+=mirrored;}
    else if(fanCount>=2&&fanSaving>=stripSaving){flush();const planar=coplanar(fan,positions);program.push(planar?4:1,fanCount,...fan);if(planar)counts.filledContourTriangles+=fanCount;else counts.explicitResidualTriangles+=fanCount;triangle+=fanCount;}
    else if(stripCount>=2){flush();program.push(2,stripCount,...strip);counts.stripTriangles+=stripCount;triangle+=stripCount;}
    else{if(literal<0)literal=triangle;triangle++;}
  }
  flush();const recipe:TopologyRecipe={kind:'operations',program:wire(wordsBytes(program),4,4)};
  if(usedMirror.size){const pairs=[...usedMirror].filter(([a,b])=>a<=b).sort((a,b)=>a[0]-b[0]);recipe.mirror=wire(wordsBytes(pairs.flat()),8,4);}
  return{recipe,counts};
}
function restoreIndices(r:SurfaceRecipe): Indices|null {
  if(r.indexType===0){if(r.topology.kind!=='unindexed'||r.indexCount!==0)throw new Error('Native surface: invalid unindexed topology');return null;}
  const width=r.indexType===5121?1:r.indexType===5123?2:4; let words:Uint32Array;
  if(r.topology.kind==='residual') words=bytesWords(unwire(r.topology.buffer,r.indexCount*width),width);
  else if(r.topology.kind==='operations'){
    if(r.mode!==4||r.indexCount%3)throw new Error('Native surface: invalid triangle operations');
    const program=bytesWords(unwire(r.topology.program)),mapping=new Map<number,number>();if(r.topology.mirror){const pairs=bytesWords(unwire(r.topology.mirror));if(pairs.length%2)throw new Error('Native surface: invalid mirror pairs');for(let i=0;i<pairs.length;i+=2){const a=integer(pairs[i],0,r.vertexCount-1,'mirror vertex'),b=integer(pairs[i+1],0,r.vertexCount-1,'mirror vertex');if((mapping.has(a)&&mapping.get(a)!==b)||(mapping.has(b)&&mapping.get(b)!==a))throw new Error('Native surface: conflicting mirror map');mapping.set(a,b);mapping.set(b,a);}}
    words=new Uint32Array(r.indexCount);let cursor=0,out=0;while(cursor<program.length){if(cursor+2>program.length)throw new Error('Native surface: truncated operation');const op=program[cursor++]!,n=integer(program[cursor++],1,(r.indexCount-out)/3,'operation count');
      if(op===0){if(cursor+3*n>program.length)throw new Error('Native surface: truncated residual');words.set(program.subarray(cursor,cursor+3*n),out);cursor+=3*n;out+=3*n;}
      else if(op===1||op===2||op===4){if(cursor+n+2>program.length)throw new Error('Native surface: truncated contour');for(let i=0;i<n;i++){const k=i+2;words[out++]=op===2?(k%2?program[cursor+k-1]!:program[cursor+k-2]!):program[cursor]!;words[out++]=op===2?(k%2?program[cursor+k-2]!:program[cursor+k-1]!):program[cursor+i+1]!;words[out++]=program[cursor+i+2]!;}cursor+=n+2;}
      else if(op===3){if(cursor+2>program.length)throw new Error('Native surface: truncated mirrored run');const source=integer(program[cursor++],0,out/3-1,'mirror triangle'),permutation=integer(program[cursor++],0,5,'mirror permutation');if((source+n)*3>out)throw new Error('Native surface: forward mirror reference');for(let i=0;i<n;i++)for(const k of PERMUTATIONS[permutation]!){const v=mapping.get(words[(source+i)*3+k]!);if(v===undefined)throw new Error('Native surface: missing mirror vertex');words[out++]=v;}}
      else throw new Error('Native surface: unknown topology operation');
    }if(out!==r.indexCount)throw new Error('Native surface: incomplete topology');
  }else throw new Error('Native surface: invalid indexed topology');
  const max=width===1?255:width===2?65535:0xffffffff;for(const index of words)if(index>=r.vertexCount||index>max)throw new Error('Native surface: index out of range');
  return width===1?new Uint8Array(words):width===2?new Uint16Array(words):words;
}
export function replaySurface(recipe:SurfaceRecipe, suppliedPositions?:Float32Array): SurfaceReplay {
  if(!recipe||recipe.version!==NATIVE_SURFACE_VERSION)throw new Error('Native surface: unsupported version');integer(recipe.vertexCount,0,LIMIT/12,'vertex count');integer(recipe.indexCount,0,LIMIT/4,'index count');integer(recipe.mode,0,6,'primitive mode');if(![0,5121,5123,5125].includes(recipe.indexType))throw new Error('Native surface: invalid index type');
  if(suppliedPositions&&(!(suppliedPositions instanceof Float32Array)||suppliedPositions.length!==recipe.vertexCount*3))throw new Error('Native surface: supplied coordinate extent');
  const positions=suppliedPositions??restorePositions(recipe.positions,recipe.vertexCount),indices=restoreIndices(recipe),mesh=meshData();mesh.positions=Array.from(positions);mesh.indices=indices?Array.from(indices):Array.from({length:recipe.vertexCount},(_,i)=>i);
  return{mesh,positions,indices,mode:recipe.mode};
}
export function compileSurface(input:SurfaceInput): {recipe:SurfaceRecipe;metrics:SurfaceMetrics} {
  if(!(input.positions instanceof Float32Array)||input.positions.length%3||input.positions.byteLength>LIMIT)throw new Error('Native surface: invalid positions');
  if(input.indices!==null&&!(input.indices instanceof Uint8Array)&&!(input.indices instanceof Uint16Array)&&!(input.indices instanceof Uint32Array))throw new Error('Native surface: invalid indices');
  const count=input.positions.length/3,mode=integer(input.mode??4,0,6,'mode'),indexType=input.indices===null?0:input.indices instanceof Uint8Array?5121:input.indices instanceof Uint16Array?5123:5125,width=indexType===5121?1:indexType===5123?2:4;
  if(input.indices&&input.indices.byteLength>LIMIT)throw new Error('Native surface: indices exceed limit');for(const i of input.indices??[])if(i>=count)throw new Error('Native surface: index out of range');
  const positions=positionCandidates(input.positions),baseTopology:TopologyRecipe=input.indices===null?{kind:'unindexed'}:{kind:'residual',buffer:wire(wordsBytes(input.indices,width),width,width)};
  const recipe:SurfaceRecipe={version:2,vertexCount:count,mode,indexType,indexCount:input.indices?.length??0,positions:positions[0]!.recipe,topology:baseTopology};const residualRecipeBytes=size(recipe);
  let chosenPosition=positions[0]!;for(const p of positions)if(size(p.recipe)<size(chosenPosition.recipe))chosenPosition=p;recipe.positions=chosenPosition.recipe;
  let counts:OpCounts={explicitResidualTriangles:mode===4?Math.floor((input.indices?.length??count)/3):0,filledContourTriangles:0,stripTriangles:0,mirroredTriangles:0};
  if(mode===4&&input.indices&&input.indices.length%3===0&&input.indices.length/3<=INFERENCE_TRIANGLES){const candidates=[operations(input.positions,input.indices)];if(input.positions.every(Number.isFinite))for(let axis=0;axis<3;axis++)candidates.push(operations(input.positions,input.indices,mirroredFaces(input.positions,input.indices,axis)));for(const c of candidates)if(size(c.recipe)<size(recipe.topology)){recipe.topology=c.recipe;counts=c.counts;}}
  const replay=replaySurface(recipe);if(!equalWords(floatWords(input.positions),floatWords(replay.positions))||((input.indices===null)!==(replay.indices===null))||(input.indices&&replay.indices&&!equalWords(input.indices,replay.indices)))throw new Error('Native surface: internal exactness validation failed');
  return{recipe,metrics:{recipeBytes:size(recipe),residualRecipeBytes,positionOperation:recipe.positions.kind,topologyOperation:recipe.topology.kind,...counts,affineGeneratedVertices:recipe.positions.kind==='affine'||recipe.positions.kind==='grid'?chosenPosition.generated:0,mirrorGeneratedVertices:recipe.positions.kind==='mirror'?chosenPosition.generated:0,exactPositions:true,exactIndexOrder:true,decoderCost:'Shared native surface + buffer decoder is fixed and counted once by the outer package compiler'}};
}
