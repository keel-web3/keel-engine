/** Shared generative construction validator, including attachments and closed loops. */
import {specimenParts,expandPrimitivePattern} from './primitive-patterns.ts';
import type {SpecimenProgram as ObjectProgram,SpecimenPart as Part,SpecimenV3 as V3,SpecimenMaterial as Material,SpecimenEmitter as Emitter,SpecimenDynamic as DynamicMatter,SpecimenAnimation as Animation,SpecimenPattern,SpecimenDetail as Detail} from './specimen-types.ts';
const label = (v: unknown, max: number): string => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f]/.test(v)) throw new Error('invalid label'); return v.trim(); };
const number = (v: unknown, lo: number, hi: number): number => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error('program number outside bounds'); return v; };
const vec = (v: unknown, positive = false): V3 => { if (!Array.isArray(v) || v.length !== 3) throw new Error('expected a three-component vector'); return v.map(x => number(x, positive ? 0.015 : -2, 2)) as V3; };
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('expected object');return v as Record<string,unknown>;};
const list=(v:unknown,max:number):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw new Error('program list exceeds budget');return v;};
const integer=(v:unknown,lo:number,hi:number):number=>{const n=number(v,lo,hi);if(!Number.isInteger(n))throw new Error('integer required');return n;};
const choice=<T extends string>(v:unknown,choices:T[]):T=>{if(!choices.includes(v as T))throw new Error('unsupported material or emitter');return v as T;};
const jointName=(v:unknown):string=>{if(typeof v!=='string'||!/^[a-z][a-z0-9-]{0,23}$/.test(v))throw new Error('invalid joint name');return v;};
const vector=(v:unknown,lo:number,hi:number):V3=>{if(!Array.isArray(v)||v.length!==3)throw new Error('expected vector');return v.map(x=>number(x,lo,hi)) as V3;};
/** An entry's detail tier, 0..2; kept only when above 0, so a program without tiers reads back without them. */
const tierOf=(v:unknown):{detail?:Detail}=>{const d=integer(v??0,0,2) as Detail;return d?{detail:d}:{};};
/** An entry the detail-0 object draws: no tier, or 0 (a tier that isn't one is refused where the entry is read). */
const atZero=(e:unknown):boolean=>((e as {detail?:unknown}|null|undefined)?.detail??0)===0;
const patternAtZero=(e:unknown):boolean=>atZero(e)&&atZero((e as {part?:unknown}|null|undefined)?.part);
/** The detail-0 object keeps the cartridge's limits: at most `max` of a list's untiered entries. */
const level0=(v:unknown[],max:number,at=atZero):unknown[]=>{if(v.filter(at).length>max)throw new Error('program list exceeds budget');return v;};
const entries=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
function readPart(rawPart: unknown): Part {
  if (!rawPart || typeof rawPart !== 'object') throw new Error('invalid part');
  const p = rawPart as Record<string, unknown>;
  const tone=integer(p.tone??0,0,2),material=integer(p.material??0,0,3),joint=jointName(p.joint??'root');
  const attach={tone,material,joint,...tierOf(p.detail)};
  if (p.kind === 'capsule') return { kind: 'capsule', a: vec(p.a), b: vec(p.b), r: number(p.r, 0.015, 1.5),...attach };
  if (p.kind === 'box' || p.kind === 'wedge') return { kind: p.kind, c: vec(p.c), h: vec(p.h, true), yaw: number(p.yaw ?? 0, -6.284, 6.284), lo: number(p.lo ?? 0, 0, 1),...attach };
  throw new Error('unknown primitive');
}
/** Reads and normalises a program. Two budgets: the detail-0 object (the entries without a tier, or at 0) keeps the cartridge's
 * limits -- 24 parts and expanded parts, 4 patterns, 8 tracks, 4 emitters, 2 dynamics, and 8 joints unless some entry has a
 * tier above 0 -- so a program without tiers reads exactly as it always did; the whole program has 64 parts and expanded
 * parts, 8 patterns, 16 joints and tracks, 8 emitters and 4 dynamics. Every level must stand alone: detail 0 needs a part. */
export function readSpecimen(raw: unknown): ObjectProgram {
  if (!raw || typeof raw !== 'object') throw new Error('missing object program');
  const o = raw as Record<string, unknown>;
  if (![1,2].includes(o.version as number) || !Array.isArray(o.parts) || !o.parts.length || o.parts.length > 64 || o.parts.filter(atZero).length > 24) throw new Error('unsupported program or part budget');
  const parts: Part[] = o.parts.map(readPart);
  const patterns:SpecimenPattern[]=level0(list(o.patterns??[],8),4,patternAtZero).map(raw=>{
   const p=record(raw),repeat=record(p.repeat),part=readPart(p.part);
   if(part.joint!=='root')throw new Error('patterns require a rigid root attachment; moving reflected joints are explicit');
   const detail=tierOf(p.detail);
   if(repeat.kind==='mirror')return {part,repeat:{kind:'mirror',axis:integer(repeat.axis,0,2) as 0|2},...detail};
   if(repeat.kind==='line')return {part,repeat:{kind:'line',count:integer(repeat.count,1,12),step:vec(repeat.step)},...detail};
   if(repeat.kind==='ring')return {part,repeat:{kind:'ring',count:integer(repeat.count,1,12),center:vec(repeat.center)},...detail};
   throw new Error('unsupported primitive pattern');
  });
  const zero=[...parts.filter(p=>!p.detail),...patterns.filter(p=>!p.detail&&!p.part.detail).flatMap(expandPrimitivePattern)];
  if(!zero.length)throw new Error('detail 0 needs a part');
  if(zero.length>24)throw new Error('expanded specimen part budget 1..24');
  const expanded=specimenParts({parts,patterns});
  // Reuse the geometry bounds on every expanded copy. Only this small recipe
  // is stored; the shared KEEL compiler reconstructs its repeated structure.
  for(const p of expanded){if(p.kind==='capsule'){vec(p.a);vec(p.b);}else{vec(p.c);vec(p.h,true);}}
  if(o.animation!==undefined&&!['still','fire','flow','float','sway','spark'].includes(String(o.animation)))throw new Error('unknown animation');
  const color=o.color===undefined?undefined:(()=>{const c=record(o.color);return {value:choice(c.value,['pale','light','mid','deep']),chroma:choice(c.chroma,['gray','muted','rich','vivid'])};})();
  const base={version:o.version as 1|2,hue:number(o.hue,0,360),variation:number(o.variation,0,o.version===2?.08:.16),...(o.displayScale!==undefined?{displayScale:number(o.displayScale,.84,1)}:{}),...(o.displayLift!==undefined?{displayLift:number(o.displayLift,0,.4)}:{}),...(color?{color}:{}),parts,...(patterns.length?{patterns}: {})};
  if(o.version===1)return {...base,...(o.animation?{animation:o.animation as Animation}:{})};
  const materials=list(o.materials,4).map(raw=>{const m=record(raw);return {finish:choice(m.finish,['matte','wood','leaf','water','glass','metal','glow','vapor']),screen:choice(m.screen??'auto',['bayer2','bayer4','hatch','auto','stipple','bayer8','lines','diagonal','halftone','checker','weave']),pattern:choice(m.pattern??'none',['none','grain','vein','crack'])} as Material;});
  if(!materials.length)throw new Error('material slot required');
  const names=new Set(['root']);
  // Joints belong to every level: 8, as on the cartridge, unless some entry has a tier above 0.
  const motion=o.motion as {tracks?:unknown}|null|undefined;
  const tiered=[...o.parts,...entries(o.patterns),...entries(o.patterns).map(p=>(p as {part?:unknown}|null|undefined)?.part),...entries(typeof motion==='object'?motion?.tracks:undefined),...entries(o.emitters),...entries(o.dynamics)].some(e=>!atZero(e));
  const joints=list(o.joints??[],tiered?16:8).map(raw=>{const j=record(raw),name=jointName(j.name),parent=jointName(j.parent??'root');if(names.has(name)||!names.has(parent))throw new Error('joints require unique names and preceding parents');names.add(name);return {name,parent,pivot:vec(j.pivot)};});
  for(const part of expanded)if(!names.has(part.joint!)||part.material!>=materials.length)throw new Error('unknown joint or material on part');
  const m=record(o.motion),period=number(m.period,.8,3.2);
  if(Math.abs(period/.8-Math.round(period/.8))>1e-6)throw new Error('period must be .8, 1.6, 2.4 or 3.2 seconds');
  const used=new Set<string>();
  const tracks=level0(list(m.tracks??[],16),8).map(raw=>{const t=record(raw),joint=jointName(t.joint);if(joint==='root'||!names.has(joint)||used.has(joint))throw new Error('track must target a unique attached joint');used.add(joint);
   const keys=list(t.keys,8).map(raw=>{const k=record(raw);return {at:number(k.at,0,1),rot:vector(k.rot??[0,0,0],-12.567,12.567),off:vector(k.off??[0,0,0],-.5,.5)};});
   if(keys.length<2||keys[0]!.at!==0||keys.at(-1)!.at!==1||keys.some((k,i)=>i>0&&k.at<=keys[i-1]!.at))throw new Error('ordered pose keys must span 0 to 1');
   // Rotations may differ by whole turns; translations must close exactly.
   if(keys[0]!.off.some((v,i)=>Math.abs(v-keys.at(-1)!.off[i]!)>1e-6)||keys[0]!.rot.some((v,i)=>{const turns=(keys.at(-1)!.rot[i]!-v)/(Math.PI*2);return Math.abs(turns-Math.round(turns))>1e-4;}))throw new Error('motion must form a closed loop');
   if(t.easing==='linear'){const first=keys[0]!,next=keys[1]!,last=keys.at(-1)!,previous=keys.at(-2)!;for(const vector of ['rot','off'] as const)if(first[vector].some((v,i)=>Math.abs((next[vector][i]!-v)/(next.at-first.at)-(last[vector][i]!-previous[vector][i]!)/(last.at-previous.at))>.02))throw new Error('linear loop must preserve its velocity at the join');}
   const detail=tierOf(t.detail);
   return {joint,keys,easing:choice(t.easing??'smooth',['linear','smooth']),...detail};});
  const emitters=level0(list(o.emitters??[],8),4).map(raw=>{const e=record(raw),joint=jointName(e.joint??'root');if(!names.has(joint))throw new Error('unknown emitter joint');return {kind:choice(e.kind,['ember','smoke','rain','splash','spark','dust','bubble']),joint,at:vec(e.at),velocity:vector(e.velocity??[0,0,0],-1.5,1.5),count:integer(e.count??1,1,3),spread:number(e.spread??.1,0,.4),...tierOf(e.detail)} as Emitter;});
  const dynamics=level0(list(o.dynamics??[],4),2).map(raw=>{const d=record(raw),joint=jointName(d.joint??'root'),material=integer(d.material??0,0,3);if(!names.has(joint)||material>=materials.length)throw new Error('unknown dynamic matter attachment or material');const flow=d.flow===undefined?undefined:choice(d.flow,['fall','pour','jet','viscous','molten','wave']),path=d.path===undefined?undefined:list(d.path,6).map(p=>vec(p));if(flow&&d.kind!=='liquid')throw new Error('flow requires liquid matter');if(path&&path.length<2)throw new Error('flow path needs 2..6 points');return {kind:choice(d.kind,['liquid','combustion','vapor']),joint,at:vec(d.at),size:number(d.size,.15,1),material,...(flow?{flow}:{}),...(path?{path}: {}),...tierOf(d.detail)} as DynamicMatter;});
  return {...base,materials,joints,dynamics,motion:{action:label(m.action,160),period,tracks},emitters};
}
