import { FINISHES, LOOK_ROLES, PATTERNS, type RoleLook } from "@keel-engine/core";
import { PAINT_SCREENS, PAINT_SHEENS, WALL_DETAILS, type LayerPaint, type LookMesh, type SlotPaint } from "@keel-engine/bake";

/** Cosmetic rolled geometry only. Native center, radius, contacts and transport remain authoritative. */
export interface ArenaBodyVisual {
  readonly ownerId: number;
  readonly identity: string;
  readonly mesh: LookMesh;
  readonly paint: LayerPaint;
}
export interface AdmittedArenaBodyVisual extends ArenaBodyVisual { readonly meshId: string }
export const ARENA_BODY_VISUAL_REVISION = "pinball-body-visuals/2026-10-07.1";
const MAX_VERTICES = 6000, MAX_INDICES = 6000, MAX_PAINT_BYTES = 65536;
const fail = (message: string): never => { throw new Error(`Invalid pinball body visual: ${message}`); };
const number = (value: unknown, low: number, high: number, label: string, integer = false): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high || (integer && !Number.isInteger(value))) fail(label);
  return value as number;
};
function data(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("plain data record required");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) if (typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!)) fail("unknown field or accessor");
  for (const key of required) if (!Object.hasOwn(descriptors, key)) fail(`missing ${key}`);
  return value as Record<string, unknown>;
}
function array(value: unknown, min: number, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail("array bounds");
  const values = value as unknown[];
  const descriptors = Object.getOwnPropertyDescriptors(values);
  for (const key of Reflect.ownKeys(descriptors)) if (key !== "length" && (typeof key !== "string" || !/^\d+$/.test(key) || !("value" in descriptors[key]!))) fail("array accessor or extra field");
  for (let i = 0; i < values.length; i++) if (!Object.hasOwn(values, i)) fail("sparse array");
  return values;
}
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(label);
  return value as T;
}
function role(value: unknown): RoleLook {
  const r = data(value, ["hue", "chroma", "light", "span", "finish", "pattern"]);
  const p = data(r.pattern, ["kind", "freq", "angle", "width", "shift", "ink"]);
  return Object.freeze({hue:number(r.hue,0,360,"hue"),chroma:number(r.chroma,0,1,"chroma"),light:number(r.light,0,1,"light"),span:number(r.span,0,2,"span"),finish:choice(r.finish,FINISHES,"finish"),pattern:Object.freeze({kind:choice(p.kind,PATTERNS,"pattern"),freq:number(p.freq,1,15,"frequency",true),angle:number(p.angle,0,7,"angle",true),width:number(p.width,1,15,"pattern width",true),shift:number(p.shift,-8,7,"shift",true),ink:p.ink===null?null:choice(p.ink,LOOK_ROLES,"ink")})});
}
function boolean(value: unknown): boolean { if (typeof value !== "boolean") fail("boolean required"); return value as boolean; }
function paint(value: unknown): LayerPaint {
  let decalBytes = 0;
  const result = array(value,1,32).map((input): SlotPaint | null => {
    if (input === null) return null;
    const p = data(input,["look","ink","screen","dither","sheen","decal","space","mirror","detail"],["look","ink"]);
    const optional: {screen?: SlotPaint["screen"]; dither?: number; sheen?: SlotPaint["sheen"]; decal?: SlotPaint["decal"]; space?: "part"|"body"; mirror?: number; detail?: SlotPaint["detail"]} = {};
    if (p.screen !== undefined) optional.screen = choice(p.screen,PAINT_SCREENS,"screen");
    if (p.dither !== undefined) optional.dither = number(p.dither,0,2,"dither");
    if (p.sheen !== undefined) optional.sheen = choice(p.sheen,PAINT_SHEENS,"sheen");
    if (p.space !== undefined) optional.space = choice(p.space,["part","body"] as const,"paint space");
    if (p.mirror !== undefined) optional.mirror = number(p.mirror,0,1,"mirror");
    if (p.detail !== undefined) {
      if (p.detail === null) optional.detail = null;
      else { const d=data(p.detail,["material","grime","foot","edge","scale"],["material"]); optional.detail=Object.freeze({material:choice(d.material,WALL_DETAILS,"wall detail"),...(d.grime===undefined?{}:{grime:number(d.grime,0,1,"grime")}),...(d.foot===undefined?{}:{foot:number(d.foot,0,1,"foot")}),...(d.edge===undefined?{}:{edge:boolean(d.edge)}),...(d.scale===undefined?{}:{scale:number(d.scale,.5,4,"detail scale") as .5|1|2|4})}); if(d.scale!==undefined&&![.5,1,2,4].includes(d.scale as number))fail("detail scale"); }
    }
    if (p.decal !== undefined) {
      if (p.decal === null) optional.decal = null;
      else {
        const d=data(p.decal,["decal","rect","flipU","flipV","inks"],["decal","rect","inks"]), image=data(d.decal,["width","height","texels"]);
        const width=number(image.width,1,128,"decal width",true),height=number(image.height,1,128,"decal height",true);
        if(!(image.texels instanceof Uint8Array)||!(image.texels.buffer instanceof ArrayBuffer)||image.texels.length!==width*height*4)fail("decal texels");
        decalBytes+=(image.texels as Uint8Array).byteLength; if(decalBytes>MAX_PAINT_BYTES)fail("paint byte budget");
        const rect=array(d.rect,4,4).map(v=>number(v,0,1,"decal rect")) as [number,number,number,number];
        if(rect[0]>=rect[2]||rect[1]>=rect[3])fail("decal rect order");
        const inks=Object.freeze(array(d.inks,1,4).map(role));
        const texels=(image.texels as Uint8Array).slice();
        for(let i=0;i<texels.length;i+=4)if(texels[i]!>inks.length)fail("decal ink index");
        optional.decal=Object.freeze({decal:Object.freeze({width,height,texels}),rect:Object.freeze(rect),inks,...(d.flipU===undefined?{}:{flipU:boolean(d.flipU)}),...(d.flipV===undefined?{}:{flipV:boolean(d.flipV)})});
      }
    }
    return Object.freeze({look:role(p.look),ink:p.ink===null?null:role(p.ink),...optional});
  });
  if(new TextEncoder().encode(JSON.stringify(result,(_key,v)=>v instanceof Uint8Array?null:v)).length+decalBytes>MAX_PAINT_BYTES)fail("paint byte budget");
  return Object.freeze(result);
}
function mesh(value: unknown, paints: LayerPaint): LookMesh {
  const m=data(value,["positions","normals","attrs","bodies","indices","facade"],["positions","normals","attrs","bodies","indices"]);
  for(const key of ["positions","normals","attrs","bodies"])if(!(m[key] instanceof Float32Array)||!((m[key] as Float32Array).buffer instanceof ArrayBuffer))fail(key);
  if(!(m.indices instanceof Uint32Array)||!(m.indices.buffer instanceof ArrayBuffer))fail("indices");
  const positions=m.positions as Float32Array,normals=m.normals as Float32Array,attrs=m.attrs as Float32Array,bodies=m.bodies as Float32Array,indices=m.indices as Uint32Array,n=positions.length/3;
  if(!Number.isInteger(n)||n<4||n>MAX_VERTICES||normals.length!==n*3||attrs.length!==n*4||bodies.length!==n*3||indices.length<12||indices.length>MAX_INDICES||indices.length%3)fail("mesh buffer bounds");
  const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<n;i++) {
    let radius2=0,normal2=0;
    for(let axis=0;axis<3;axis++) {const p=number(positions[i*3+axis],-1.000001,1.000001,"position"),v=number(normals[i*3+axis],-1.00001,1.00001,"normal");radius2+=p*p;normal2+=v*v;mins[axis]=Math.min(mins[axis]!,p);maxs[axis]=Math.max(maxs[axis]!,p);number(bodies[i*3+axis],0,1,"body coordinate");}
    if(radius2>1.000002||Math.abs(normal2-1)>.0001)fail("unit body envelope or normal");
    const slot=number(attrs[i*4],0,31,"material slot",true); if(!paints[slot])fail("unpainted vertex slot");
    // Native wrap coordinates may repeat across a segmented rolled panel.
    number(attrs[i*4+1],0,16,"surface u");number(attrs[i*4+2],0,16,"surface v");number(attrs[i*4+3],0,65535,"part",true);
  }
  if(mins.some(v=>v>-.5)||maxs.some(v=>v<.5))fail("rolled shell must surround its native center");
  let visibleTriangles=0;
  for(let i=0;i<indices.length;i+=3) {
    const a=number(indices[i],0,n-1,"triangle index",true)*3,b=number(indices[i+1],0,n-1,"triangle index",true)*3,c=number(indices[i+2],0,n-1,"triangle index",true)*3;
    const ux=positions[b]!-positions[a]!,uy=positions[b+1]!-positions[a+1]!,uz=positions[b+2]!-positions[a+2]!,vx=positions[c]!-positions[a]!,vy=positions[c+1]!-positions[a+1]!,vz=positions[c+2]!-positions[a+2]!;
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
    if(x*x+y*y+z*z>1e-14)visibleTriangles++;
    if(x*positions[a]!+y*positions[a+1]!+z*positions[a+2]!<-.000001)fail("inward shell winding");
  }
  if(visibleTriangles<4)fail("empty shell topology");
  let facade:Float32Array|undefined;
  if(m.facade!==undefined){if(!(m.facade instanceof Float32Array)||!(m.facade.buffer instanceof ArrayBuffer)||m.facade.length!==n)fail("facade");facade=(m.facade as Float32Array).slice();for(const v of facade)number(v,-1,-1,"rolled facade");}
  return Object.freeze({positions:positions.slice(),normals:normals.slice(),attrs:attrs.slice(),bodies:bodies.slice(),indices:indices.slice(),...(facade?{facade}:{})});
}
/** Copies caller-owned buffers once; a renderer retains these privately for the view's lifetime. */
export function admitArenaBodyVisuals(value: readonly ArenaBodyVisual[] = []): readonly AdmittedArenaBodyVisual[] {
  const owners=new Set<number>();
  return Object.freeze(array(value,0,100).map(input=>{
    const v=data(input,["ownerId","identity","mesh","paint"]),ownerId=number(v.ownerId,0,65535,"owner",true);
    if(owners.has(ownerId))fail("duplicate owner");owners.add(ownerId);
    if(typeof v.identity!=="string"||!/^[-a-zA-Z0-9_.:/]{1,128}$/.test(v.identity))fail("identity");
    const identity=v.identity as string,p=paint(v.paint),m=mesh(v.mesh,p);
    return Object.freeze({ownerId,identity,mesh:m,paint:p,meshId:`body:owner/${ownerId}/${identity}`});
  }));
}
