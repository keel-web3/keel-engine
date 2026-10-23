import {defineManifest} from '@keel-engine/runtime';
export const manifest=defineManifest({
  id:'packs/pinball-biomes',version:'0.1.0',kind:'pack',
  needs:['keel/runtime@^0.1','keel/core@^0.1'],
  provides:['pinball/biome-recipes@1.0.0'],
  title:'Pinball biomes',
  description:'Optional deterministic nightshift, cyberpunk, vaporwave, gold, and nature scene grammars; cosmetic data only.',
});
