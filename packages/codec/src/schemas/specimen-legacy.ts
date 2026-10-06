/** Compact generative construction, including its rig and matter sources.
 * Exact off-grid escapes keep existing floats and closed-loop endpoints lossless.
 * The cartridge stores compiled frames; it does not run a 3D renderer. */
import {array,enumOf,fixed,named,optional,ref,string,struct,tuple,uint,union} from '../schema.ts';
const coord=fixed(-2,2,.001,{off:'exact'}),positive=fixed(.015,2,.001,{off:'exact'}),angle=fixed(-20,20,.001,{off:'exact'}),unit=fixed(0,1,.001,{off:'exact'});
const v3=tuple([coord,coord,coord]),h3=tuple([positive,positive,positive]),r3=tuple([angle,angle,angle]);
const joint=ref('specimen-joints'),detail={tone:optional(uint(2)),material:optional(uint(2)),joint:optional(joint)};
const part=union('kind',{
 box:struct({c:v3,h:h3,yaw:angle,lo:unit,...detail}),wedge:struct({c:v3,h:h3,yaw:angle,lo:unit,...detail}),capsule:struct({a:v3,b:v3,r:positive,...detail})
});
export const SPECIMEN_PROGRAM=named('keel/bake/specimen',struct({
 version:enumOf([1,2]),hue:fixed(0,360,.01,{off:'exact'}),variation:fixed(0,.16,.001,{off:'exact'}),displayScale:optional(fixed(.84,1,.01,{off:'exact'})),animation:optional(enumOf(['still','fire','flow','float','sway','spark'])),
 parts:array(part,{max:24}),patterns:optional(array(struct({part,repeat:union('kind',{mirror:struct({axis:enumOf([0,2])}),line:struct({count:uint(4),step:v3}),ring:struct({count:uint(4),center:v3})})}),{max:4})),
 materials:optional(array(struct({finish:enumOf(['matte','wood','leaf','water','glass','metal','glow','vapor']),screen:enumOf(['bayer2','bayer4','hatch']),pattern:enumOf(['none','grain','vein','crack'])}),{max:4})),
 joints:optional(array(struct({name:joint,parent:joint,pivot:v3}),{max:8})),
 motion:optional(struct({action:string({max:640}),period:enumOf([.8,1.6,2.4,3.2]),tracks:array(struct({joint,keys:array(struct({at:unit,rot:r3,off:v3}),{max:8}),easing:optional(enumOf(['linear','smooth']))}),{max:8})})),
 emitters:optional(array(struct({kind:enumOf(['ember','smoke','rain','splash','spark','dust','bubble']),joint,at:v3,velocity:v3,count:uint(2),spread:fixed(0,.4,.001,{off:'exact'})}),{max:4})),
 dynamics:optional(array(struct({kind:enumOf(['liquid','combustion','vapor']),joint,at:v3,size:fixed(.15,1,.001,{off:'exact'}),material:uint(2),flow:optional(enumOf(['fall','viscous','molten','wave'])),path:optional(array(v3,{max:6}))}),{max:2}))
}),{doc:'Seeded primitive construction, repetitions, joints, closed motion and matter emitters. Exact numeric escapes preserve existing artwork.'});
