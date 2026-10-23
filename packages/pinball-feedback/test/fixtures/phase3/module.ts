import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({id:'keel/pinball-feedback',version:'0.1.0',kind:'runtime',needs:['keel/runtime@^0.1','keel/pinball-arena@^0.1','keel/audio@^0.1'],title:'Pinball mechanism feedback',description:'Bounded seeded mechanism poses, particles, lamp pulses and sound cues from admitted pinball state and events.'});
