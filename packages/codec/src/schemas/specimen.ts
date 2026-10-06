/** Compact generative construction, including its rig and matter sources.
 * Exact off-grid escapes keep existing floats and closed-loop endpoints lossless.
 * The cartridge stores compiled frames; it does not run a 3D renderer.
 * The default SPECIMEN_PROGRAM stays the older main layout in specimen-legacy.ts.
 * Native layouts add color and screen fields and have their own explicit aliases.
 *
 * Detail tiers: parts, patterns, tracks, emitters and dynamics may carry `detail` (0..2; absent is 0), and a program may hold
 * more of each than the cartridge's limits. Each of those lists is a grow(): a list the original layout holds (within its old
 * max, no `detail` on any entry) is written exactly as it always was, so a program without tiers packs to the same bits; any
 * other list takes the spare length code and the grown layout, where every entry carries an optional `detail`. */
import {array,enumOf,fixed,grow,named,optional,ref,string,struct,tuple,uint,union} from '../schema.ts';
const coord=fixed(-2,2,.001,{off:'exact'}),positive=fixed(.015,2,.001,{off:'exact'}),angle=fixed(-20,20,.001,{off:'exact'}),unit=fixed(0,1,.001,{off:'exact'});
const v3=tuple([coord,coord,coord]),h3=tuple([positive,positive,positive]),r3=tuple([angle,angle,angle]);
const joint=ref('specimen-joints'),attach={tone:optional(uint(2)),material:optional(uint(2)),joint:optional(joint)},tier={detail:optional(uint(2))};
const partOf=(d:typeof tier|{})=>union('kind',{
 box:struct({c:v3,h:h3,yaw:angle,lo:unit,...attach,...d}),wedge:struct({c:v3,h:h3,yaw:angle,lo:unit,...attach,...d}),capsule:struct({a:v3,b:v3,r:positive,...attach,...d})
});
const part=partOf({}),tieredPart=partOf(tier);
const repeat=union('kind',{mirror:struct({axis:enumOf([0,2])}),line:struct({count:uint(4),step:v3}),ring:struct({count:uint(4),center:v3})});
const keys=array(struct({at:unit,rot:r3,off:v3}),{max:8}),easing=optional(enumOf(['linear','smooth']));
const emitter={kind:enumOf(['ember','smoke','rain','splash','spark','dust','bubble']),joint,at:v3,velocity:v3,count:uint(2),spread:fixed(0,.4,.001,{off:'exact'})};
const dynamic={kind:enumOf(['liquid','combustion','vapor']),joint,at:v3,size:fixed(.15,1,.001,{off:'exact'}),material:uint(2),flow:optional(enumOf(['fall','viscous','molten','wave','pour','jet'])),path:optional(array(v3,{max:6}))};
const jointStruct=struct({name:joint,parent:joint,pivot:v3});
export const SPECIMEN_PROGRAM_NATIVE=named('keel/bake/specimen',struct({
 version:enumOf([1,2]),hue:fixed(0,360,.01,{off:'exact'}),variation:fixed(0,.16,.001,{off:'exact'}),displayScale:optional(fixed(.84,1,.01,{off:'exact'})),color:optional(struct({value:enumOf(['pale','light','mid','deep']),chroma:enumOf(['gray','muted','rich','vivid'])})),animation:optional(enumOf(['still','fire','flow','float','sway','spark'])),
 parts:grow(array(part,{max:24}),array(tieredPart,{max:64})),
 patterns:optional(grow(array(struct({part,repeat}),{max:4}),array(struct({part:tieredPart,repeat,...tier}),{max:8}))),
 materials:optional(array(struct({finish:enumOf(['matte','wood','leaf','water','glass','metal','glow','vapor']),screen:enumOf(['bayer2','bayer4','hatch','auto','stipple','bayer8','lines','diagonal','halftone','checker','weave']),pattern:enumOf(['none','grain','vein','crack'])}),{max:4})),
 joints:optional(grow(array(jointStruct,{max:8}),array(jointStruct,{max:16}))),
 motion:optional(struct({action:string({max:640}),period:enumOf([.8,1.6,2.4,3.2]),tracks:grow(array(struct({joint,keys,easing}),{max:8}),array(struct({joint,keys,easing,...tier}),{max:16}))})),
 emitters:optional(grow(array(struct(emitter),{max:4}),array(struct({...emitter,...tier}),{max:8}))),
 dynamics:optional(grow(array(struct(dynamic),{max:2}),array(struct({...dynamic,...tier}),{max:4})))
}),{doc:'Seeded primitive construction, repetitions, joints, closed motion and matter emitters, with optional detail tiers. Exact numeric escapes preserve existing artwork.'});


/** Native color/screen layout before detail tiers (historical schema c1f0c77f).
 * This is distinct from the older main layout without color and with three screens. */
export const SPECIMEN_PROGRAM_NATIVE_PRE_TIER=(()=>{
 const coord=fixed(-2,2,.001,{off:'exact'}),positive=fixed(.015,2,.001,{off:'exact'}),angle=fixed(-20,20,.001,{off:'exact'}),unit=fixed(0,1,.001,{off:'exact'});
 const v3=tuple([coord,coord,coord]),h3=tuple([positive,positive,positive]),r3=tuple([angle,angle,angle]);
 const joint=ref('specimen-joints'),detail={tone:optional(uint(2)),material:optional(uint(2)),joint:optional(joint)};
 const part=union('kind',{box:struct({c:v3,h:h3,yaw:angle,lo:unit,...detail}),wedge:struct({c:v3,h:h3,yaw:angle,lo:unit,...detail}),capsule:struct({a:v3,b:v3,r:positive,...detail})});
 return named('keel/bake/specimen',struct({
  version:enumOf([1,2]),hue:fixed(0,360,.01,{off:'exact'}),variation:fixed(0,.16,.001,{off:'exact'}),displayScale:optional(fixed(.84,1,.01,{off:'exact'})),color:optional(struct({value:enumOf(['pale','light','mid','deep']),chroma:enumOf(['gray','muted','rich','vivid'])})),animation:optional(enumOf(['still','fire','flow','float','sway','spark'])),
  parts:array(part,{max:24}),patterns:optional(array(struct({part,repeat:union('kind',{mirror:struct({axis:enumOf([0,2])}),line:struct({count:uint(4),step:v3}),ring:struct({count:uint(4),center:v3})})}),{max:4})),
  materials:optional(array(struct({finish:enumOf(['matte','wood','leaf','water','glass','metal','glow','vapor']),screen:enumOf(['bayer2','bayer4','hatch','auto','stipple','bayer8','lines','diagonal','halftone','checker','weave']),pattern:enumOf(['none','grain','vein','crack'])}),{max:4})),
  joints:optional(array(struct({name:joint,parent:joint,pivot:v3}),{max:8})),
  motion:optional(struct({action:string({max:640}),period:enumOf([.8,1.6,2.4,3.2]),tracks:array(struct({joint,keys:array(struct({at:unit,rot:r3,off:v3}),{max:8}),easing:optional(enumOf(['linear','smooth']))}),{max:8})})),
  emitters:optional(array(struct({kind:enumOf(['ember','smoke','rain','splash','spark','dust','bubble']),joint,at:v3,velocity:v3,count:uint(2),spread:fixed(0,.4,.001,{off:'exact'})}),{max:4})),
  dynamics:optional(array(struct({kind:enumOf(['liquid','combustion','vapor']),joint,at:v3,size:fixed(.15,1,.001,{off:'exact'}),material:uint(2),flow:optional(enumOf(['fall','viscous','molten','wave','pour','jet'])),path:optional(array(v3,{max:6}))}),{max:2}))
 }),{doc:'Seeded primitive construction, repetitions, joints, closed motion and matter emitters. Exact numeric escapes preserve existing artwork.'});
})();


/** Placement @2 builds on the native schema. All historical layouts stay registered by hash;
 * an old document is read with the schema named by its header, never a substituted layout. */
const specimenFields = SPECIMEN_PROGRAM_NATIVE.of;
if (specimenFields.kind !== 'struct') throw new Error('specimen program must be a struct');
export const SPECIMEN_PROGRAM_PLACEMENT = named('keel/bake/specimen', struct({
 ...Object.fromEntries(specimenFields.fields.map(f => [f.name, f.type])),
 displayLift: optional(fixed(0, .4, .001, {off: 'exact'})),
}), {version: 2, doc: 'Specimen construction with lossless display lift. Version 1 stays available for existing assets.'});

// Preserve the original main API and exact packed layout. Native authors select the explicit schemas above.
export {SPECIMEN_PROGRAM,SPECIMEN_PROGRAM as SPECIMEN_PROGRAM_LEGACY} from './specimen-legacy.ts';
