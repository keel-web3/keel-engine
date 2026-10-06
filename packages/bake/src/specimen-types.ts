/** A bounded, seeded construction recipe. Names and descriptions are metadata;
 * geometry, attachments and explicit matter actions determine the actual object. */
export type SpecimenV3=[number,number,number];
export type SpecimenPart=({kind:'box'|'wedge';c:SpecimenV3;h:SpecimenV3;yaw:number;lo:number}|{kind:'capsule';a:SpecimenV3;b:SpecimenV3;r:number})&{tone?:number;joint?:string;material?:number};
export type SpecimenPattern={part:SpecimenPart;repeat:({kind:'mirror';axis:0|2}|{kind:'line';count:number;step:SpecimenV3}|{kind:'ring';count:number;center:SpecimenV3})};
export type SpecimenAnimation='still'|'fire'|'flow'|'float'|'sway'|'spark';
export type SpecimenFinish='matte'|'wood'|'leaf'|'water'|'glass'|'metal'|'glow'|'vapor';
export interface SpecimenMaterial {finish:SpecimenFinish;screen:'bayer2'|'bayer4'|'hatch';pattern:'none'|'grain'|'vein'|'crack'}
export interface SpecimenJoint {name:string;parent:string;pivot:SpecimenV3}
export interface SpecimenPoseKey {at:number;rot:SpecimenV3;off:SpecimenV3}
export interface SpecimenTrack {joint:string;keys:SpecimenPoseKey[];easing?:'linear'|'smooth'}
export interface SpecimenEmitter {kind:'ember'|'smoke'|'rain'|'splash'|'spark'|'dust'|'bubble';joint:string;at:SpecimenV3;velocity:SpecimenV3;count:number;spread:number}
export interface SpecimenDynamic {kind:'liquid'|'combustion'|'vapor';joint:string;at:SpecimenV3;size:number;material:number;flow?:'fall'|'viscous'|'molten'|'wave';path?:SpecimenV3[]}
export interface SpecimenProgram {version:1|2;hue:number;variation:number;displayScale?:number;animation?:SpecimenAnimation;parts:SpecimenPart[];patterns?:SpecimenPattern[];materials?:SpecimenMaterial[];joints?:SpecimenJoint[];motion?:{action:string;period:number;tracks:SpecimenTrack[]};emitters?:SpecimenEmitter[];dynamics?:SpecimenDynamic[]}
export const SPECIMEN_MOTION_FRAMES=16;
