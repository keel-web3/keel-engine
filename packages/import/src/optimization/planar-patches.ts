/** Bounded, exact-field planar remeshing experiment. No visibility assumption.
 * Patches replace contiguous source triangle runs at the same draw-order slot.
 * Only single-loop convex disks with exact coplanarity/affine render fields and
 * constant normal/tangent/skin fields qualify. BigInt predicates operate on the
 * exact dyadic values of Float32 inputs, without an epsilon or quantization.
 */
import type {NativeArray, NormalizedAccessor, NormalizedAsset} from '../asset-normalize-v3.ts';

const WIDTH:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
export const PLANAR_PATCH_BUDGET=Object.freeze({maxTriangles:500_000,maxPairChecks:500_000,maxPatchTriangles:8192,maxBoundary:512,maxCandidates:100_000});
const raw=(a:NativeArray)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const abs=(v:bigint)=>v<0n?-v:v;
type Field={id:number;name:string;width:number;a:NormalizedAccessor;constant:boolean;values:bigint[];bytes:Uint8Array;stride:number};
type Triangle={v:number[];axes:number[];normal:bigint[];area:bigint;valid:boolean};
export interface PlanarPatch {mesh:number;primitive:number;startTriangle:number;sourceTriangles:number;outputTriangles:number;sourceBoundary:number[];outputBoundary:number[];sourceVertices:number[];fieldProof:{plane:'exact dyadic';affine:string[];constant:string[];scalarIdentities:number};}
export interface PlanarMetric {mesh:number;primitive:number;applied:boolean;reason:string;sourceTriangles:number;outputTriangles:number;sourceVertices:number;outputVertices:number;adjacentPairs:number;compatiblePairs:number;contiguousCandidates:number;patches:number;rejected:Record<string,number>;}

/** Float32 number as an integer with common denominator 2^149. */
function floatIntegers(array:NativeArray):bigint[]{
 if(!(array instanceof Float32Array))return Array.from(array,v=>BigInt(v));
 const bits=new Uint32Array(array.buffer,array.byteOffset,array.length);
 return Array.from(bits,b=>{const e=(b>>>23)&255,m=b&0x7fffff;if(e===255)throw Error('nonfinite field');const n=e===0?BigInt(m):BigInt(m|0x800000)<<BigInt(e-1);return b>>>31?-n:n;});
}
function values(a:NormalizedAccessor):bigint[]{
 const out=floatIntegers(a.array);
 // Signed normalized integers clamp their most negative value to -1. The
 // common remaining denominator cancels in every affine identity.
 if(a.normalized&&(a.componentType===5120||a.componentType===5122)){const min=a.componentType===5120?-127n:-32767n;for(let i=0;i<out.length;i++)if(out[i]!<min)out[i]=min;}
 return out;
}
function opaque(json:any):boolean{
 if((json.extensionsUsed??[]).length||(json.extensionsRequired??[]).length)return true;
 const walk=(x:any,path:string):boolean=>!!x&&typeof x==='object'&&Object.entries(x).some(([k,v])=>{
  if(k==='extensions'&&Object.keys(v as object).length)return true;
  if(k==='extras'){if(path==='asset'&&v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).every(([n,w])=>['author','license','source','title','copyright'].includes(n)&&typeof w==='string'))return false;return true;}
  return walk(v,path?path+'.'+k:k);
 });return walk(json,'');
}
function refOwners(json:any){
 const out=new Map<number,Set<string>>(),put=(id:number,owner:string)=>{if(!out.has(id))out.set(id,new Set());out.get(id)!.add(owner);};
 for(let m=0;m<(json.meshes??[]).length;m++)for(let p=0;p<json.meshes[m].primitives.length;p++){const v=json.meshes[m].primitives[p],owner=m+'/'+p;if(v.indices!==undefined)put(v.indices,owner);for(const g of[v.attributes,...v.targets??[]])for(const id of Object.values(g))put(id as number,owner);}
 for(const s of json.skins??[])if(s.inverseBindMatrices!==undefined)put(s.inverseBindMatrices,'protected');
 for(const c of json.animations??[])for(const s of c.samplers??[]){put(s.input,'protected');put(s.output,'protected');}return out;
}
function orient(p:bigint[],a:number,b:number,c:number,axes:number[]){const x=axes[0]!,y=axes[1]!;return(p[b*3+x]!-p[a*3+x]!)*(p[c*3+y]!-p[a*3+y]!)-(p[b*3+y]!-p[a*3+y]!)*(p[c*3+x]!-p[a*3+x]!);}
function triangle(p:bigint[],v:number[]):Triangle{
 const d=v.slice(1).map(i=>[0,1,2].map(k=>p[i*3+k]!-p[v[0]!*3+k]!)),u=d[0]!,w=d[1]!,normal=[u[1]!*w[2]!-u[2]!*w[1]!,u[2]!*w[0]!-u[0]!*w[2]!,u[0]!*w[1]!-u[1]!*w[0]!];
 let drop=0;for(let k=1;k<3;k++)if(abs(normal[k]!)>abs(normal[drop]!))drop=k;
 const axes=[0,1,2].filter(k=>k!==drop),area=orient(p,v[0]!,v[1]!,v[2]!,axes);return{v,axes,normal,area,valid:area!==0n};
}
function sameRow(f:Field,a:number,b:number){for(let k=0;k<f.stride;k++)if(f.bytes[a*f.stride+k]!==f.bytes[b*f.stride+k])return false;return true;}
function fieldProof(p:bigint[],base:Triangle,vertex:number,fields:Field[]):number{
 const [a,b,c]=base.v as[number,number,number],d=base.area,wb=orient(p,a,vertex,c,base.axes),wc=orient(p,a,b,vertex,base.axes);let checks=0;
 for(const f of fields){if(f.constant){if(!sameRow(f,a,vertex))return-1;checks+=f.width;continue;}for(let k=0;k<f.width;k++){const av=f.values[a*f.width+k]!;if(d*(f.values[vertex*f.width+k]!-av)!==wb*(f.values[b*f.width+k]!-av)+wc*(f.values[c*f.width+k]!-av))return-1;checks++;}}
 return checks;
}
function metadata(a:NormalizedAccessor,prior:any,isIndex=false){const out={...prior,type:a.type,count:a.count,componentType:a.componentType};delete out.bufferView;delete out.byteOffset;delete out.sparse;if(a.normalized)out.normalized=true;else delete out.normalized;
 // Convexity and affine fields preserve actual extrema. Keep any supplied
 // conservative min/max unchanged as well, including source quantization bounds.
 if(isIndex&&(prior?.min||prior?.max)){let min=Infinity,max=-Infinity;for(const v of a.array){min=Math.min(min,v);max=Math.max(max,v);}if(prior.min)out.min=[min];if(prior.max)out.max=[max];}return out;}

export function optimizePlanarPatches(asset:NormalizedAsset){
 const normalized:NormalizedAsset={...asset,json:structuredClone(asset.json),accessors:asset.accessors.slice(),validation:structuredClone(asset.validation)},metrics:PlanarMetric[]=[],patches:PlanarPatch[]=[],owners=refOwners(asset.json),blocked=opaque(asset.json);
 let pairBudget=PLANAR_PATCH_BUDGET.maxPairChecks,candidateBudget=PLANAR_PATCH_BUDGET.maxCandidates;
 for(let mesh=0;mesh<(asset.json.meshes??[]).length;mesh++)for(let primitive=0;primitive<asset.json.meshes[mesh].primitives.length;primitive++){
  const source=asset.json.meshes[mesh].primitives[primitive],position=asset.accessors[source.attributes?.POSITION],count=position?.count??0,metric:PlanarMetric={mesh,primitive,applied:false,reason:'',sourceTriangles:0,outputTriangles:0,sourceVertices:count,outputVertices:count,adjacentPairs:0,compatiblePairs:0,contiguousCandidates:0,patches:0,rejected:{}};metrics.push(metric);
  metric.sourceTriangles=metric.outputTriangles=(source.mode??4)===4?(source.indices===undefined?count:asset.accessors[source.indices]?.count??0)/3:0;
  const reject=(reason:string)=>{metric.rejected[reason]=(metric.rejected[reason]??0)+1;};
  try{
   if(blocked)throw Error('opaque metadata or extensions retained');
   if((source.mode??4)!==4||!position||position.type!=='VEC3'||position.componentType!==5126||position.normalized)throw Error('unsupported geometry retained');
   const material=asset.json.materials?.[source.material]??{};if((material.alphaMode??'OPAQUE')!=='OPAQUE')throw Error('transparency and alpha masking retained');
   if(material.normalTexture&&source.attributes.TANGENT===undefined)throw Error('implicit normal-map tangents retained');
   const ia=source.indices===undefined?undefined:asset.accessors[source.indices];if(ia&&(ia.type!=='SCALAR'||ia.normalized||![5121,5123,5125].includes(ia.componentType)))throw Error('invalid indices retained');
   const indices=ia?Array.from(ia.array):Array.from({length:count},(_,i)=>i);if(indices.length%3||indices.some(v=>v<0||v>=count))throw Error('invalid indices retained');
   const nt=indices.length/3;metric.sourceTriangles=metric.outputTriangles=nt;if(nt>PLANAR_PATCH_BUDGET.maxTriangles)throw Error('triangle work budget exceeded');
   if(new Set(indices).size!==count)throw Error('unreferenced vertices retained for bounds');
   const fields:Field[]=[],ids=new Set<number>();
   for(let g=0;g<1+(source.targets?.length??0);g++)for(const[name,id]of Object.entries(g?source.targets[g-1]:source.attributes)as[string,number][]){
    const a=asset.accessors[id],w=a&&WIDTH[a.type];if(!a||!w||a.count!==count||a.array.length!==count*w)throw Error('invalid attribute retained');
    if((owners.get(id)?.size??0)!==1||owners.get(id)?.has('protected'))throw Error('cross-draw or protected accessor aliases retained');
    const constant=g>0?['NORMAL','TANGENT'].includes(name):/^(NORMAL|TANGENT|JOINTS_\d+|WEIGHTS_\d+)$/.test(name),affine=g>0?name==='POSITION':name==='POSITION'||/^(TEXCOORD_\d+|COLOR_\d+)$/.test(name);
    if(!constant&&!affine)throw Error('unknown rendering field retained');
    fields.push({id,name:(g?'morph'+(g-1)+'.':'')+name,width:w,a,constant,values:values(a),bytes:raw(a.array),stride:w*a.array.BYTES_PER_ELEMENT});ids.add(id);
   }
   if(ia&&((owners.get(source.indices)?.size??0)!==1||ids.has(source.indices)))throw Error('shared index accessor retained');
   const p=fields.find(f=>f.name==='POSITION')!.values,triangles:Triangle[]=[],edgeMap=new Map<string,Array<{t:number;a:number;b:number}>>(),parent=Array.from({length:nt},(_,i)=>i);
   const find=(i:number):number=>{while(parent[i]!==i){parent[i]=parent[parent[i]!]!;i=parent[i]!;}return i;};
   for(let t=0;t<nt;t++){const tri=triangle(p,indices.slice(t*3,t*3+3));if(tri.valid)tri.valid=fields.filter(f=>f.constant).every(f=>sameRow(f,tri.v[0]!,tri.v[1]!)&&sameRow(f,tri.v[0]!,tri.v[2]!));triangles.push(tri);for(let k=0;k<3;k++){const a=tri.v[k]!,b=tri.v[(k+1)%3]!,key=a<b?a+','+b:b+','+a;let edges=edgeMap.get(key);if(!edges)edgeMap.set(key,edges=[]);edges.push({t,a,b});}}
   for(const edges of edgeMap.values()){
    if(edges.length!==2)continue;const a=edges[0]!,b=edges[1]!;metric.adjacentPairs++;if(a.a!==b.b||a.b!==b.a||!triangles[a.t]!.valid||!triangles[b.t]!.valid)continue;if(--pairBudget<0)throw Error('adjacent proof budget exceeded');
    const ta=triangles[a.t]!,tb=triangles[b.t]!;if(ta.normal.reduce((s,n,k)=>s+n*tb.normal[k]!,0n)<=0n)continue;
    if(tb.v.every(v=>fieldProof(p,ta,v,fields)>=0)){parent[find(b.t)]=find(a.t);metric.compatiblePairs++;}
   }
   const groups=parent.map((_,i)=>find(i)),local:PlanarPatch[]=[],replacement=new Map<number,number[]>();
   for(let start=0;start<nt;){let end=start+1;while(end<nt&&groups[end]===groups[start])end++;const length=end-start;
    if(length<2){start=end;continue;}metric.contiguousCandidates++;if(--candidateBudget<0)throw Error('candidate work budget exceeded');
    try{
     if(length>PLANAR_PATCH_BUDGET.maxPatchTriangles)throw Error('patch triangle budget');
     const base=triangles[start]!,vertices=new Set<number>(),edges=new Map<string,{a:number;b:number;n:number}>();let area=0n,scalarIdentities=0;
     for(let t=start;t<end;t++){const tri=triangles[t]!;if(!tri.valid)throw Error('degenerate or nonconstant fields');const ar=orient(p,tri.v[0]!,tri.v[1]!,tri.v[2]!,base.axes);if(ar*base.area<=0n)throw Error('mixed orientation');area+=ar;for(let k=0;k<3;k++){const a=tri.v[k]!,b=tri.v[(k+1)%3]!,key=a<b?a+','+b:b+','+a;vertices.add(a);const old=edges.get(key);if(old){if(old.n!==1||old.a!==b||old.b!==a)throw Error('nonmanifold or overlapping topology');old.n=2;}else edges.set(key,{a,b,n:1});}}
     for(const v of vertices){const checks=fieldProof(p,base,v,fields);if(checks<0)throw Error('whole-patch affine field proof');scalarIdentities+=checks;}
     const border=[...edges.values()].filter(e=>e.n===1);if(border.length<3||border.length>PLANAR_PATCH_BUDGET.maxBoundary)throw Error('boundary work budget');
     const next=new Map<number,number>(),incoming=new Set<number>();for(const{a,b}of border){if(next.has(a)||incoming.has(b))throw Error('branched boundary');next.set(a,b);incoming.add(b);}
     const boundary:number[]=[],first=border[0]!.a;let v=first;do{if(boundary.includes(v)||!next.has(v))throw Error('invalid boundary');boundary.push(v);v=next.get(v)!;}while(v!==first);if(boundary.length!==border.length)throw Error('holes or disconnected components');
     // The oriented triangle 2-chain cancels to this one simple convex loop.
     // Equal positive orientation and a convex loop prove unit surface coverage.
     const sign=base.area>0n?1n:-1n;let polygonArea=0n;
     for(let i=0;i<boundary.length;i++){const a=boundary[i]!,b=boundary[(i+1)%boundary.length]!;for(const c of boundary)if(orient(p,a,b,c,base.axes)*sign<0n)throw Error('nonconvex boundary');polygonArea+=orient(p,first,a,b,base.axes);}
     if(polygonArea!==area)throw Error('surface area identity');
     let changed=true;while(changed&&boundary.length>3){changed=false;for(let i=0;i<boundary.length;i++){if(orient(p,boundary[(i+boundary.length-1)%boundary.length]!,boundary[i]!,boundary[(i+1)%boundary.length]!,base.axes)===0n){boundary.splice(i,1);changed=true;break;}}}
     if(boundary.length-2>=length)throw Error('no triangle reduction');
     const fill:number[]=[];for(let i=1;i<boundary.length-1;i++){if(orient(p,boundary[0]!,boundary[i]!,boundary[i+1]!,base.axes)*sign<=0n)throw Error('degenerate fill');fill.push(boundary[0]!,boundary[i]!,boundary[i+1]!);}replacement.set(start,fill);
     local.push({mesh,primitive,startTriangle:start,sourceTriangles:length,outputTriangles:boundary.length-2,sourceBoundary:boundary,outputBoundary:[],sourceVertices:[...vertices],fieldProof:{plane:'exact dyadic',affine:fields.filter(f=>!f.constant).map(f=>f.name),constant:fields.filter(f=>f.constant).map(f=>f.name),scalarIdentities}});
    }catch(error){reject(error instanceof Error?error.message:String(error));}start=end;
   }
   if(!local.length){metric.reason='no eligible reducing convex contiguous patch';continue;}
   const output:number[]=[];for(let t=0;t<nt;){const fill=replacement.get(t);if(fill){output.push(...fill);t+=local.find(x=>x.startTriangle===t)!.sourceTriangles;}else{output.push(...indices.slice(t*3,t*3+3));t++;}}
   const used=new Set(output),retained=Array.from({length:count},(_,i)=>i).filter(i=>used.has(i)),remap=new Map(retained.map((v,i)=>[v,i]));
   // Every surviving record is copied byte-for-byte, with accessor identities
   // and intra-primitive aliases preserved. Cross-draw aliases were excluded.
   for(const id of ids){const a=asset.accessors[id]!,w=WIDTH[a.type]!,stride=w*a.array.BYTES_PER_ELEMENT,bytes=raw(a.array),array=new(a.array.constructor as{new(n:number):NativeArray})(retained.length*w),dest=raw(array);for(let i=0;i<retained.length;i++)dest.set(bytes.subarray(retained[i]!*stride,(retained[i]!+1)*stride),i*stride);normalized.accessors[id]={...a,count:retained.length,array};normalized.json.accessors[id]=metadata(normalized.accessors[id]!,asset.json.accessors?.[id]);}
   const array:NativeArray=retained.length<=256?Uint8Array.from(output,v=>remap.get(v)!):retained.length<=65536?Uint16Array.from(output,v=>remap.get(v)!):Uint32Array.from(output,v=>remap.get(v)!);
   const indexId=source.indices??normalized.accessors.length,index:NormalizedAccessor={sourceIndex:ia?.sourceIndex??-1,type:'SCALAR',componentType:array.BYTES_PER_ELEMENT===1?5121:array.BYTES_PER_ELEMENT===2?5123:5125,normalized:false,count:array.length,array};normalized.accessors[indexId]=index;normalized.json.accessors[indexId]=metadata(index,asset.json.accessors?.[source.indices],true);normalized.json.meshes[mesh].primitives[primitive].indices=indexId;
   for(const patch of local)patch.outputBoundary=patch.sourceBoundary.map(v=>remap.get(v)!);patches.push(...local);metric.applied=true;metric.reason='exact affine fields over a convex disk, contiguous draw-order replacement';metric.outputTriangles=output.length/3;metric.outputVertices=retained.length;metric.patches=local.length;
  }catch(error){metric.reason=error instanceof Error?error.message:String(error);}
 }
 normalized.validation.accessorCount=normalized.accessors.length;normalized.validation.decodedBytes=normalized.accessors.reduce((n,a)=>n+a.array.byteLength,0)+normalized.images.reduce((n,a)=>n+a.data.length,0);
 return{normalized,report:{version:'keel-planar-patches-0.1.0',candidateCount:1,budget:PLANAR_PATCH_BUDGET,changedPrimitives:metrics.filter(m=>m.applied).length,patchCount:patches.length,sourceTriangles:metrics.reduce((n,m)=>n+m.sourceTriangles,0),outputTriangles:metrics.reduce((n,m)=>n+m.outputTriangles,0),sourceVertices:metrics.reduce((n,m)=>n+m.sourceVertices,0),outputVertices:metrics.reduce((n,m)=>n+m.outputVertices,0),metrics,patches,contract:'Exact real-valued standard glTF fields and oriented surface coverage under affine morphing and constant patch skin weights/joints; contiguous opaque triangle groups only. Surviving records, rig, clips, materials, images and accessor aliases are preserved. Floating-point rasterization can round differently after retriangulation; finite CPU evidence is not GPU or universal pixel proof.'}};
}
