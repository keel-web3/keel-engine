/** Portable, fixed-resolution orthographic sprite baking of normalized meshes.
 * Base-color/vertex-color plus optional flat diffuse light, with alpha and UV
 * transforms. This is intentionally not a full PBR or GPU-equivalent renderer. */
import type { NormalizedAsset } from './asset-normalize-v3.ts';
import { evaluateGeometryPoses } from './optimization/geometry-pose.ts';
import { decodeTexturePixels } from './optimization/textures.ts';
import { readTextureTransform } from './texture-transform.ts';

type V = [number, number, number];
export interface SpriteRasterOptions {
  resolution: 32 | 64 | 128 | 256;
  clipIndex: number | null;
  fps: number;
  directions: 1 | 4 | 8;
  azimuth?: number;
  elevation?: number;
  shading?: 'unlit' | 'diffuse';
  onProgress?: (event: { stage: string; done: number; total: number }) => void;
}
interface Pixels { width: number; height: number; data: Uint8Array }
interface Attribute { values: Float64Array; width: number }
interface Texture { pixels: Pixels; uv: Attribute; sampler: any; transform: ReturnType<typeof readTextureTransform> | null }
interface Draw { flipped: boolean; positions: Float32Array; order: Uint32Array; material: any; color: Attribute | null; texture: Texture | null; emissive: Texture | null }
const WIDTHS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: ArrayLike<number>, b: ArrayLike<number>): V => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: V, b: V): V => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (v: V): V => { const n = Math.hypot(...v) || 1; return v.map(x => x/n) as V; };
const linear = (v: number) => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4;
const srgb = (v: number) => v <= .0031308 ? 12.92*v : 1.055*Math.max(0,v)**(1/2.4)-.055;
function attribute(asset: NormalizedAsset, id: number | undefined): Attribute | null {
  if (id === undefined) return null; const a = asset.accessors[id]; if (!a) throw Error('Sprite attribute is missing');
  const width = WIDTHS[a.type]; if (!width) throw Error('Unsupported sprite attribute');
  const values = Float64Array.from(a.array);
  if (a.normalized) for (let i=0;i<values.length;i++) { const v=values[i]!; values[i]=a.componentType===5120?Math.max(-1,v/127):a.componentType===5121?v/255:a.componentType===5122?Math.max(-1,v/32767):v/65535; }
  return { values, width };
}
const wrap = (x:number,n:number,mode:number) => mode===33071?Math.max(0,Math.min(n-1,x)):mode===33648?((x%(2*n)+2*n)%(2*n)<n?(x%(2*n)+2*n)%(2*n):2*n-(x%(2*n)+2*n)%(2*n)-1):(x%n+n)%n;
function sample(texture: Texture | null, u:number, v:number): number[] {
  if (!texture) return [1,1,1,1];
  const {pixels:p,sampler,transform:t}=texture;
  if(t){const x=u*t.scale[0],y=v*t.scale[1],c=Math.cos(t.rotation),s=Math.sin(t.rotation);u=t.offset[0]+c*x-s*y;v=t.offset[1]+s*x+c*y;}
  const nearest=sampler.magFilter===9728,x=u*p.width-.5,y=v*p.height-.5,ix=nearest?Math.floor(u*p.width):Math.floor(x),iy=nearest?Math.floor(v*p.height):Math.floor(y),fx=x-Math.floor(x),fy=y-Math.floor(y),out=[0,0,0,0];
  for(let dy=0;dy<(nearest?1:2);dy++)for(let dx=0;dx<(nearest?1:2);dx++){const at=(wrap(iy+dy,p.height,sampler.wrapT)*p.width+wrap(ix+dx,p.width,sampler.wrapS))*4,w=nearest?1:(dx?fx:1-fx)*(dy?fy:1-fy);for(let c=0;c<4;c++){const value=p.data[at+c]!/255;out[c]!+=(c<3?linear(value):value)*w;}}
  return out;
}
function raster(draws: Draw[], size:number, center:V, radius:number, azimuth:number, elevation:number, shading:string, work:{pixels:number}): Uint8Array {
  const outward:V=[Math.cos(elevation)*Math.sin(azimuth),Math.sin(elevation),Math.cos(elevation)*Math.cos(azimuth)],right=unit(cross([0,1,0],outward)),up=cross(outward,right),scale=(size-4)/(2*radius);
  const depth=new Float64Array(size*size).fill(Infinity),color=new Float64Array(size*size*4),light=unit([-.45,.8,.5]);
  const triangles: {d:Draw;p:Float64Array;a:number;b:number;c:number;z:number;serial:number}[]=[];
  let serial=0;
  for(const d of draws){const p=new Float64Array(d.positions.length);for(let i=0;i<d.positions.length;i+=3){const v=sub(d.positions.subarray(i,i+3),center);p.set([size/2+dot(v,right)*scale,size/2-dot(v,up)*scale,-dot(v,outward)],i);}for(let i=0;i<d.order.length;i+=3){const a=d.order[i]!,b=d.order[i+1]!,c=d.order[i+2]!;triangles.push({d,p,a,b,c,z:(p[a*3+2]!+p[b*3+2]!+p[c*3+2]!)/3,serial:serial++});}}
  // Opaque depth first; then a deterministic back-to-front painter order for blends.
  triangles.sort((a,b)=>Number(a.d.material.alphaMode==='BLEND')-Number(b.d.material.alphaMode==='BLEND')||(a.d.material.alphaMode==='BLEND'?b.z-a.z:0)||a.serial-b.serial);
  let framePixels=0;
  for(const {d,p,a,b,c}of triangles){const ax=p[a*3]!,ay=p[a*3+1]!,bx=p[b*3]!,by=p[b*3+1]!,cx=p[c*3]!,cy=p[c*3+1]!,area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(!area||(!d.material.doubleSided&&(d.flipped?area<=0:area>=0)))continue;
    const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(size-1,Math.ceil(Math.max(ax,bx,cx))),y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(size-1,Math.ceil(Math.max(ay,by,cy))),base=d.material.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1],emission=d.material.emissiveFactor??[0,0,0],alphaMode=d.material.alphaMode??'OPAQUE';
    const attempted=Math.max(0,x1-x0+1)*Math.max(0,y1-y0+1);framePixels+=attempted;work.pixels+=attempted;if(framePixels>20000000||work.pixels>160000000)throw Error('Raster fragment budget exceeded; lower resolution or frames');
    let n=unit(cross(sub(d.positions.subarray(b*3,b*3+3),d.positions.subarray(a*3,a*3+3)),sub(d.positions.subarray(c*3,c*3+3),d.positions.subarray(a*3,a*3+3))));if(d.flipped)n=n.map(x=>-x)as V;if(d.material.doubleSided&&dot(n,outward)<0)n=n.map(x=>-x)as V;
    const shade=shading==='unlit'||d.material.extensions?.KHR_materials_unlit?1:.35+.65*Math.max(0,dot(n,light));
    const topLeft=(x:number,y:number,xx:number,yy:number)=>{if(area<0){[x,xx]=[xx,x];[y,yy]=[yy,y];}return yy>y||(yy===y&&xx<x);};
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const px=x+.5,py=y+.5,wa=((bx-px)*(cy-py)-(by-py)*(cx-px))/area,wb=((cx-px)*(ay-py)-(cy-py)*(ax-px))/area,wc=1-wa-wb;if(wa<0||wb<0||wc<0||wa===0&&!topLeft(bx,by,cx,cy)||wb===0&&!topLeft(cx,cy,ax,ay)||wc===0&&!topLeft(ax,ay,bx,by))continue;
      const z=wa*p[a*3+2]!+wb*p[b*3+2]!+wc*p[c*3+2]!,i=y*size+x;if(z>depth[i]!)continue;
      const value=(at:Attribute|null,k:number,fallback=1)=>at&&k<at.width?at.values[a*at.width+k]!*wa+at.values[b*at.width+k]!*wb+at.values[c*at.width+k]!*wc:fallback;
      const tex=sample(d.texture,value(d.texture?.uv??null,0,0),value(d.texture?.uv??null,1,0)),em=sample(d.emissive,value(d.emissive?.uv??null,0,0),value(d.emissive?.uv??null,1,0)),alpha=base[3]*tex[3]!*value(d.color,3);
      if(alphaMode==='MASK'&&alpha<(d.material.alphaCutoff??.5))continue;const opacity=alphaMode==='BLEND'?Math.max(0,Math.min(1,alpha)):1;
      for(let k=0;k<3;k++){const source=Math.max(0,base[k]*tex[k]!*value(d.color,k)*shade+emission[k]*em[k]!);color[i*4+k]=source*opacity+color[i*4+k]!*(1-opacity);}color[i*4+3]=opacity+color[i*4+3]!*(1-opacity);if(alphaMode!=='BLEND')depth[i]=z;
    }
  }
  const rgba=new Uint8Array(size*size*4);for(let i=0;i<size*size;i++){const alpha=color[i*4+3]!;rgba[i*4+3]=Math.round(alpha*255);if(alpha>0)for(let c=0;c<3;c++)rgba[i*4+c]=Math.max(0,Math.min(255,Math.round(srgb(color[i*4+c]!/alpha)*255)));}return rgba;
}

// glTF/Three reverse front-face winding for a reflected owner world transform.
// Rotation/translation do not change its determinant sign; sample only scales.
function reflectionSampler(asset:NormalizedAsset,clip:any) {
  const nodes=asset.json.nodes??[];if(nodes.length>100000)throw Error('Raster node budget exceeded');
  const parent=new Int32Array(nodes.length).fill(-1),base=new Int8Array(nodes.length);
  for(let i=0;i<nodes.length;i++){const n=nodes[i],m=n.matrix,s=n.scale??[1,1,1],det=m?m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]):s[0]*s[1]*s[2];base[i]=Math.sign(det);for(const child of n.children??[])parent[child]=i;}
  const channels=(clip?.channels??[]).filter((c:any)=>c.target.path==='scale'),cache=new Map<number|null,Int8Array>();
  return(node:number,time:number|null):boolean=>{
    if(!cache.has(time)){
      if((cache.size+1)*nodes.length>10000000)throw Error('Raster transform work budget exceeded');
      const local=new Int8Array(base),world=new Int8Array(nodes.length).fill(2);
      for(const channel of channels)if(time!==null){const sampler=clip.samplers[channel.sampler],times=asset.accessors[sampler.input]!.array,values=asset.accessors[sampler.output]!.array,cubic=sampler.interpolation==='CUBICSPLINE',stride=cubic?9:3;let lo=0;while(lo+1<times.length&&times[lo+1]!<=time)lo++;let hi=Math.min(times.length-1,lo+1);if(time<times[0]!)lo=hi=0;const dt=times[hi]!-times[lo]!,t=dt?Math.max(0,Math.min(1,(time-times[lo]!)/dt)):0;let det=1;for(let k=0;k<3;k++){const a=values[lo*stride+(cubic?3:0)+k]!,b=values[hi*stride+(cubic?3:0)+k]!;det*=sampler.interpolation==='STEP'||lo===hi?a:cubic?(2*t*t*t-3*t*t+1)*a+(t*t*t-2*t*t+t)*dt*values[lo*stride+6+k]!+(-2*t*t*t+3*t*t)*b+(t*t*t-t*t)*dt*values[hi*stride+k]!:a+(b-a)*t;}local[channel.target.node]=Math.sign(det);}
      for(let i=0;i<nodes.length;i++)if(world[i]===2){const stack:number[]=[];let n=i;while(n>=0&&world[n]===2){if(stack.length>=nodes.length)throw Error('Cyclic raster transform graph');stack.push(n);n=parent[n]!;}for(let k=stack.length-1;k>=0;k--){const id=stack[k]!,p=parent[id]!;world[id]=local[id]!*(p<0?1:world[p]!);}}
      cache.set(time,world);
    }
    return cache.get(time)![node]===-1;
  };
}

export function renderSpriteFrames(asset:NormalizedAsset, options:SpriteRasterOptions) {
  const start=performance.now(),size=options.resolution;
  if(![32,64,128,256].includes(size)||![1,4,8].includes(options.directions)||!Number.isInteger(options.fps)||options.fps<1||options.fps>24)throw Error('Invalid raster resolution/FPS/direction settings');
  const azimuth=options.azimuth??.65,elevation=options.elevation??.25,shading=options.shading??'diffuse';if(!Number.isFinite(azimuth)||!Number.isFinite(elevation)||Math.abs(elevation)>1.45||!['unlit','diffuse'].includes(shading))throw Error('Invalid raster camera/shading');
  const clip=options.clipIndex===null?null:asset.json.animations?.[options.clipIndex];if(options.clipIndex!==null&&(!Number.isInteger(options.clipIndex)||!clip))throw Error('Select an available animation clip or rest pose');
  let from=Infinity,to=-Infinity;for(const s of clip?.samplers??[]){const times=asset.accessors[s.input]?.array;if(!times?.length)throw Error('Missing raster animation times');from=Math.min(from,times[0]!);to=Math.max(to,times[times.length-1]!);}if(!clip){from=0;to=0;}
  const duration=Math.max(0,to-from),frameCount=clip?Math.max(1,Math.ceil(duration*options.fps)):1,total=frameCount*options.directions;
  if(total>256||total*size*size>16777216)throw Error('Raster frame/pixel budget exceeded; lower FPS, resolution or directions');
  const isReflected=reflectionSampler(asset,clip);
  const poseAsset={...asset,json:{...asset.json,animations:clip?[clip]:[]}},images=new Map<number,Pixels>(),groups:Draw[][]=Array.from({length:frameCount},()=>[]),min:V=[Infinity,Infinity,Infinity],max:V=[-Infinity,-Infinity,-Infinity];let sourceTriangles=0,posedVertices=0,allocatedPoseVertices=0,decodedImagePixels=0,instancedTriangles=0;
  const selected=new Set<number>();const visit=(n:number)=>{if(selected.has(n))return;selected.add(n);for(const child of asset.json.nodes?.[n]?.children??[])visit(child);};for(const n of asset.json.scenes?.[asset.json.scene??0]?.nodes??[])visit(n);
  for(let mi=0;mi<(asset.json.meshes??[]).length;mi++)if([...selected].some(n=>asset.json.nodes[n]?.mesh===mi))for(const primitive of asset.json.meshes[mi].primitives){if((primitive.mode??4)!==4)throw Error('Raster sprites currently require TRIANGLES');
    const position=asset.accessors[primitive.attributes.POSITION]!;
    allocatedPoseVertices+=position.count*Math.max(1,(asset.json.nodes??[]).filter((n:any)=>n.mesh===mi).length)*(clip?frameCount+2:1);if(allocatedPoseVertices>24000000)throw Error('Raster pose allocation budget exceeded; lower FPS');
    const order=primitive.indices===undefined?Uint32Array.from({length:position.count},(_,i)=>i):Uint32Array.from(asset.accessors[primitive.indices]!.array);sourceTriangles+=order.length/3;instancedTriangles+=order.length/3*[...selected].filter(n=>asset.json.nodes[n]?.mesh===mi).length;if(instancedTriangles>250000||instancedTriangles*total>20000000||sourceTriangles>250000||order.length%3)throw Error('Raster triangle budget exceeded');
    const material=asset.json.materials?.[primitive.material]??{},texture=(info:any):Texture|null=>{if(!info)return null;const source=asset.json.textures?.[info.index],transform=info.extensions?.KHR_texture_transform?readTextureTransform(info.extensions.KHR_texture_transform):null,uv=attribute(asset,primitive.attributes[`TEXCOORD_${transform?.texCoord??info.texCoord??0}`]);if(!source||!uv)throw Error('Raster color texture lacks a supported UV/image');if(!images.has(source.source)){const im=asset.images[source.source];if(!im)throw Error('Raster source image missing');const decoded=decodeTexturePixels(im);decodedImagePixels+=decoded.width*decoded.height;if(decodedImagePixels>33554432)throw Error('Raster texture memory budget exceeded');images.set(source.source,decoded);}return{pixels:images.get(source.source)!,uv,sampler:asset.json.samplers?.[source.sampler]??{},transform};};
    const common={order,material,color:attribute(asset,primitive.attributes.COLOR_0),texture:texture(material.pbrMetallicRoughness?.baseColorTexture),emissive:texture(material.emissiveTexture)};
    const poses=evaluateGeometryPoses(poseAsset,mi,primitive,{samplesPerClip:Math.max(2,frameCount+1)}).filter(p=>p.animation===(clip?0:null)&&(p.node!==null&&selected.has(p.node)));
    const times=[...new Set(poses.map(p=>p.time))].slice(0,frameCount);
    for(let fi=0;fi<frameCount;fi++)for(const pose of poses.filter(p=>p.time===times[fi])){posedVertices+=pose.positions.length/3;if(posedVertices>24000000)throw Error('Raster posed-vertex budget exceeded; choose fewer frames');groups[fi]!.push({...common,flipped:isReflected(pose.node!,pose.time),positions:pose.positions});for(const v of order)for(let k=0;k<3;k++){min[k]=Math.min(min[k]!,pose.positions[v*3+k]!);max[k]=Math.max(max[k]!,pose.positions[v*3+k]!);}}
  }
  if(!groups.every(g=>g.length)||!min.every(Number.isFinite))throw Error('No renderable source geometry in selected scene/clip');
  const center=min.map((v,k)=>(v+max[k]!)/2)as V,radius=Math.max(Math.hypot(...sub(max,min))/2,1e-9),frames:Uint8Array[]=[],work={pixels:0};
  for(let direction=0;direction<options.directions;direction++)for(let frame=0;frame<frameCount;frame++){options.onProgress?.({stage:'raster-frames',done:frames.length,total});frames.push(raster(groups[frame]!,size,center,radius,azimuth+direction*Math.PI*2/options.directions,elevation,shading,work));}
  return{width:size,height:size,frames,animation:{name:clip?.name??(clip?'Clip '+options.clipIndex:'Rest pose'),sourceClip:options.clipIndex,start:from,duration,frameCount,fps:duration?frameCount/duration:options.fps,directions:options.directions,order:'direction-major' as const},bounds:{center,radius},report:{renderer:'keel-import-cpu-orthographic-base-color-v1',sourceTriangles,instancedTriangles,posedVertices,fragmentAttempts:work.pixels,frames:total,resolution:size,alpha:'transparent background; core glTF opaque/mask/blend',shading,warnings:['This CPU style uses base/emissive color, vertex color and flat diffuse lighting. It does not reproduce complete PBR, normal maps, reflections, shadows or GPU output.','Animation is sampled into a fixed set of 2D views; arbitrary 3D camera and relighting are discarded.','Blended triangles use deterministic centroid sorting; intersecting transparent surfaces can differ from GPU output.'],ms:performance.now()-start}};
}
