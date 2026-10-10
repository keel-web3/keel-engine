import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({id:'keel/pinball-room',version:'0.1.0',kind:'runtime',needs:['keel/runtime@^0.1','keel/codec@^0.1','keel/pinball-arena@^0.1'],title:'Shared pinball room protocol',description:'Bounded owner-admitted input and compact shared public frames; independent of host, rendering and cosmetics.'});
