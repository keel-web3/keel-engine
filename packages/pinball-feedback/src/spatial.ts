import {distanceGain} from '@keel-engine/audio';
import type {ArenaBallFrame} from '@keel-engine/pinball-arena';
import type {PinballFeedbackSound} from './index.ts';

export interface PinballFeedbackMix {
 readonly gain:number;
 readonly pan:number;
 readonly priority:number;
 readonly owned:boolean;
}

/** Local mechanical cues remain audible when a later action in the same tick
 * has transferred the listener to another arena. Ambient cues use the actual
 * three-dimensional native distance and cannot cross an arena boundary. */
export function pinballFeedbackMix(cue:PinballFeedbackSound,focus:ArenaBallFrame,ownerId:number):PinballFeedbackMix|null {
 const owned=cue.ownerId===ownerId;
 if(!owned&&cue.arenaId!==focus.arenaId)return null;
 const gain=cue.gain*(owned?.75:distanceGain(Math.hypot(cue.x-focus.x,cue.y-focus.y,cue.elevation-focus.elevation),{near:100,far:1400})*.32);
 if(gain<=0)return null;
 return Object.freeze({gain,pan:cue.arenaId===focus.arenaId?Math.max(-.8,Math.min(.8,(cue.x-focus.x)/600)):0,priority:owned?Math.min(8,cue.priority+4):cue.priority,owned});
}
