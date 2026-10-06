/** Shared generative construction validator, including attachments and closed loops. */
import {specimenParts} from './primitive-patterns.ts';
import type {SpecimenProgram as ObjectProgram,SpecimenPart as Part,SpecimenV3 as V3,SpecimenMaterial as Material,SpecimenEmitter as Emitter,SpecimenDynamic as DynamicMatter,SpecimenAnimation as Animation,SpecimenPattern} from './specimen-types.ts';
const label = (v: unknown, max: number): string => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f]/.test(v)) throw new Error('invalid label'); return v.trim(); };
const number = (v: unknown, lo: number, hi: number): number => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error('program number outside bounds'); return v; };
const vec = (v: unknown, positive = false): V3 => { if (!Array.isArray(v) || v.length !== 3) throw new Error('expected a three-component vector'); return v.map(x => number(x, positive ? 0.015 : -2, 2)) as V3; };
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('expected object');return v as Record<string,unknown>;};
const list=(v:unknown,max:number):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw new Error('program list exceeds budget');return v;};
const integer=(v:unknown,lo:number,hi:number):number=>{const n=number(v,lo,hi);if(!Number.isInteger(n))throw new Error('integer required');return n;};
const choice=<T extends string>(v:unknown,choices:T[]):T=>{if(!choices.includes(v as T))throw new Error('unsupported material or emitter');return v as T;};
const jointName=(v:unknown):string=>{if(typeof v!=='string'||!/^[a-z][a-z0-9-]{0,23}$/.test(v))throw new Error('invalid joint name');return v;};
const vector=(v:unknown,lo:number,hi:number):V3=>{if(!Array.isArray(v)||v.length!==3)throw new Error('expected vector');return v.map(x=>number(x,lo,hi)) as V3;};
export function readSpecimen(raw: unknown): ObjectProgram {
  if (!raw || typeof raw !== 'object') throw new Error('missing object program');
  const o = raw as Record<string, unknown>;
  if (![1,2].includes(o.version as number) || !Array.isArray(o.parts) || !o.parts.length || o.parts.length > 24) throw new Error('unsupported program or part budget');
  const parts: Part[] = o.parts.map((rawPart: unknown) => {
    if (!rawPart || typeof rawPart !== 'object') throw new Error('invalid part');
    const p = rawPart as Record<string, unknown>;
    const tone=integer(p.tone??0,0,2),material=integer(p.material??0,0,3),joint=jointName(p.joint??'root');
    const detail={tone,material,joint};
    if (p.kind === 'capsule') return { kind: 'capsule', a: vec(p.a), b: vec(p.b), r: number(p.r, 0.015, 1.5),...detail };
    if (p.kind === 'box' || p.kind === 'wedge') return { kind: p.kind, c: vec(p.c), h: vec(p.h, true), yaw: number(p.yaw ?? 0, -6.284, 6.284), lo: number(p.lo ?? 0, 0, 1),...detail };
    throw new Error('unknown primitive');
  });
  const patterns:SpecimenPattern[]=list(o.patterns??[],4).map(raw=>{
   const p=record(raw),repeat=record(p.repeat),part=readSpecimen({version:1,hue:0,variation:0,parts:[p.part]}).parts[0]!;
   if(part.joint!=='root')throw new Error('patterns require a rigid root attachment; moving reflected joints are explicit');
   if(repeat.kind==='mirror')return {part,repeat:{kind:'mirror',axis:integer(repeat.axis,0,2) as 0|2}};
   if(repeat.kind==='line')return {part,repeat:{kind:'line',count:integer(repeat.count,1,12),step:vec(repeat.step)}};
   if(repeat.kind==='ring')return {part,repeat:{kind:'ring',count:integer(repeat.count,1,12),center:vec(repeat.center)}};
   throw new Error('unsupported primitive pattern');
  });
  const expanded=specimenParts({parts,patterns});
  // Reuse the geometry bounds on every expanded copy. Only this small recipe
  // is stored; the shared KEEL compiler reconstructs its repeated structure.
  for(const p of expanded){if(p.kind==='capsule'){vec(p.a);vec(p.b);}else{vec(p.c);vec(p.h,true);}}
  if(o.animation!==undefined&&!['still','fire','flow','float','sway','spark'].includes(String(o.animation)))throw new Error('unknown animation');
  const base={version:o.version as 1|2,hue:number(o.hue,0,360),variation:number(o.variation,0,o.version===2?.08:.16),...(o.displayScale!==undefined?{displayScale:number(o.displayScale,.84,1)}:{}),parts,...(patterns.length?{patterns}: {})};
  if(o.version===1)return {...base,...(o.animation?{animation:o.animation as Animation}:{})};
  const materials=list(o.materials,4).map(raw=>{const m=record(raw);return {finish:choice(m.finish,['matte','wood','leaf','water','glass','metal','glow','vapor']),screen:choice(m.screen??'bayer4',['bayer2','bayer4','hatch']),pattern:choice(m.pattern??'none',['none','grain','vein','crack'])} as Material;});
  if(!materials.length)throw new Error('material slot required');
  const names=new Set(['root']);
  const joints=list(o.joints??[],8).map(raw=>{const j=record(raw),name=jointName(j.name),parent=jointName(j.parent??'root');if(names.has(name)||!names.has(parent))throw new Error('joints require unique names and preceding parents');names.add(name);return {name,parent,pivot:vec(j.pivot)};});
  for(const part of expanded)if(!names.has(part.joint!)||part.material!>=materials.length)throw new Error('unknown joint or material on part');
  const m=record(o.motion),period=number(m.period,.8,3.2);
  if(Math.abs(period/.8-Math.round(period/.8))>1e-6)throw new Error('period must be .8, 1.6, 2.4 or 3.2 seconds');
  const used=new Set<string>();
  const tracks=list(m.tracks??[],8).map(raw=>{const t=record(raw),joint=jointName(t.joint);if(joint==='root'||!names.has(joint)||used.has(joint))throw new Error('track must target a unique attached joint');used.add(joint);
   const keys=list(t.keys,8).map(raw=>{const k=record(raw);return {at:number(k.at,0,1),rot:vector(k.rot??[0,0,0],-6.284,6.284),off:vector(k.off??[0,0,0],-.5,.5)};});
   if(keys.length<2||keys[0]!.at!==0||keys.at(-1)!.at!==1||keys.some((k,i)=>i>0&&k.at<=keys[i-1]!.at))throw new Error('ordered pose keys must span 0 to 1');
   // Rotations may differ by whole turns; translations must close exactly.
   if(keys[0]!.off.some((v,i)=>Math.abs(v-keys.at(-1)!.off[i]!)>1e-6)||keys[0]!.rot.some((v,i)=>{const turns=(keys.at(-1)!.rot[i]!-v)/(Math.PI*2);return Math.abs(turns-Math.round(turns))>1e-4;}))throw new Error('motion must form a closed loop');
   if(t.easing==='linear'){const first=keys[0]!,next=keys[1]!,last=keys.at(-1)!,previous=keys.at(-2)!;for(const vector of ['rot','off'] as const)if(first[vector].some((v,i)=>Math.abs((next[vector][i]!-v)/(next.at-first.at)-(last[vector][i]!-previous[vector][i]!)/(last.at-previous.at))>.02))throw new Error('linear loop must preserve its velocity at the join');}
   return {joint,keys,easing:choice(t.easing??'smooth',['linear','smooth'])};});
  const emitters=list(o.emitters??[],4).map(raw=>{const e=record(raw),joint=jointName(e.joint??'root');if(!names.has(joint))throw new Error('unknown emitter joint');return {kind:choice(e.kind,['ember','smoke','rain','splash','spark','dust','bubble']),joint,at:vec(e.at),velocity:vector(e.velocity??[0,0,0],-1.5,1.5),count:integer(e.count??1,1,3),spread:number(e.spread??.1,0,.4)} as Emitter;});
  const dynamics=list(o.dynamics??[],2).map(raw=>{const d=record(raw),joint=jointName(d.joint??'root'),material=integer(d.material??0,0,3);if(!names.has(joint)||material>=materials.length)throw new Error('unknown dynamic matter attachment or material');const flow=d.flow===undefined?undefined:choice(d.flow,['fall','viscous','molten','wave']),path=d.path===undefined?undefined:list(d.path,6).map(p=>vec(p));if(flow&&d.kind!=='liquid')throw new Error('flow requires liquid matter');if(path&&path.length<2)throw new Error('flow path needs 2..6 points');return {kind:choice(d.kind,['liquid','combustion','vapor']),joint,at:vec(d.at),size:number(d.size,.15,1),material,...(flow?{flow}:{}),...(path?{path}: {})} as DynamicMatter;});
  return {...base,materials,joints,dynamics,motion:{action:label(m.action,160),period,tracks},emitters};
}
