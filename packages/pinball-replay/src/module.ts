import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({id:'keel/pinball-replay',version:'0.1.0',kind:'runtime',needs:['keel/runtime@^0.1','keel/codec@^0.1','keel/pinball-arena@^0.1'],title:'Deterministic pinball replay',description:'Bounded admitted-input and command tapes, exact authority identity, portable integrity checks and independent playback.'});
