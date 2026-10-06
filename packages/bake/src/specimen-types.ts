/** A bounded, seeded construction recipe. Names and descriptions are metadata;
 * geometry, attachments and explicit matter actions determine the actual object. */
export type SpecimenV3=[number,number,number];
/** Detail tier of an entry (absent is 0). A rendition draws the entries of tier <= its level: 0 the cartridge, 1 phones, the
 * browser and handhelds, 2 desktops. Joints and materials belong to every tier. See specimen-detail.ts. */
export type SpecimenDetail=0|1|2;
export const SPECIMEN_DETAIL_MAX:SpecimenDetail=2;
export type SpecimenPart=({kind:'box'|'wedge';c:SpecimenV3;h:SpecimenV3;yaw:number;lo:number}|{kind:'capsule';a:SpecimenV3;b:SpecimenV3;r:number})&{tone?:number;joint?:string;material?:number;detail?:SpecimenDetail};
export type SpecimenPattern={part:SpecimenPart;repeat:({kind:'mirror';axis:0|2}|{kind:'line';count:number;step:SpecimenV3}|{kind:'ring';count:number;center:SpecimenV3});detail?:SpecimenDetail};
export type SpecimenAnimation='still'|'fire'|'flow'|'float'|'sway'|'spark';
export type SpecimenFinish='matte'|'wood'|'leaf'|'water'|'glass'|'metal'|'glow'|'vapor';
/** Material screen: 'auto' lets the renderer pick by finish (stipple-led); the rest are explicit KEEL screens, appended
 * after the original three so packed programs stay readable. */
export type SpecimenScreen='bayer2'|'bayer4'|'hatch'|'auto'|'stipple'|'bayer8'|'lines'|'diagonal'|'halftone'|'checker'|'weave';
export interface SpecimenMaterial {finish:SpecimenFinish;screen:SpecimenScreen;pattern:'none'|'grain'|'vein'|'crack'}
export interface SpecimenJoint {name:string;parent:string;pivot:SpecimenV3}
export interface SpecimenPoseKey {at:number;rot:SpecimenV3;off:SpecimenV3}
export interface SpecimenTrack {joint:string;keys:SpecimenPoseKey[];easing?:'linear'|'smooth';detail?:SpecimenDetail}
export interface SpecimenEmitter {kind:'ember'|'smoke'|'rain'|'splash'|'spark'|'dust'|'bubble';joint:string;at:SpecimenV3;velocity:SpecimenV3;count:number;spread:number;detail?:SpecimenDetail}
export interface SpecimenDynamic {kind:'liquid'|'combustion'|'vapor';joint:string;at:SpecimenV3;size:number;material:number;flow?:'fall'|'pour'|'jet'|'viscous'|'molten'|'wave';path?:SpecimenV3[];detail?:SpecimenDetail}
/** Palette band for the object's dominant material: lightness and saturation of its base colour. */
export interface SpecimenColor {value:'pale'|'light'|'mid'|'deep';chroma:'gray'|'muted'|'rich'|'vivid'}
export interface SpecimenProgram {version:1|2;hue:number;variation:number;displayScale?:number;/** Floats this share of the sprite above the ground line (0..0.4); the cast shadow stays on the ground. */displayLift?:number;color?:SpecimenColor;animation?:SpecimenAnimation;parts:SpecimenPart[];patterns?:SpecimenPattern[];materials?:SpecimenMaterial[];joints?:SpecimenJoint[];motion?:{action:string;period:number;tracks:SpecimenTrack[]};emitters?:SpecimenEmitter[];dynamics?:SpecimenDynamic[]}
export const SPECIMEN_MOTION_FRAMES=16;
