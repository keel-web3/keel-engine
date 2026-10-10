import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arenaSceneForRegion,assertArenaFieldScenes,createArenaMatch,validateArenaWorld,type ArenaSceneGenome,type ArenaField} from '../src/index.ts';
import {field,worldFrom,player,shotRouteWorld} from './fixtures.ts';
const scene=(id:string):ArenaSceneGenome=>({schema:'keel-pinball-scene@1',blueprintId:id,blueprintRevision:'1',cabinetFamily:id,cabinetSeed:'0x'+'1'.repeat(64),seed:'0x'+'2'.repeat(64),stage:0,biome:{forge:1,neon:0,garden:0,glacier:0,ruins:0},props:[],material:{tones:{}},print:{spacing:240,primitives:[]},lighting:{semantic:id,fixtureAssetIds:[],tintRoles:['core','trim'],gain:1},motion:{windGain:0,windRate:1,blinkPeriodMs:2400,blinkDepth:0},growth:{kind:'none',density:0},ambient:{semantic:id,tempo:90,scale:'minor',voices:[]}});

test('regional and stacked scene overrides resolve without insertion-order ambiguity',()=>{
 const base=scene('default'),start=scene('start'),upper=scene('upper'),a=field({scene:base,sceneRegions:[{regionId:'start',scene:start},{regionId:'start',layer:1,scene:upper}]});
 validateArenaWorld(worldFrom([a]));assert.equal(arenaSceneForRegion(a,'start',0),start);assert.equal(arenaSceneForRegion(a,'start',1),upper);assert.equal(arenaSceneForRegion(a,'arrival',1),base);
 const reversed={...a,sceneRegions:[...a.sceneRegions!].reverse()};assert.equal(arenaSceneForRegion(reversed,'start',1),upper);
});

test('mixed scene metadata preserves complete authority frames and refuses cross-world restoration',()=>{
 const original=shotRouteWorld(),bound=worldFrom(original.arenas.map(a=>({...a,scene:scene('default'),sceneRegions:[{regionId:'start',scene:scene('neon')},{regionId:'arrival',layer:1,scene:scene('canopy')}]})));
 assert.notEqual(bound.sha256,original.sha256);
 for(const mode of ['battle','expedition'] as const){
  const options={players:[player(0,0),player(1,1)],mode,maxTicks:1000,stormDelayTicks:60,stormDurationTicks:200},plain=createArenaMatch(original,options),mixed=createArenaMatch(bound,options);
  for(let tick=0;tick<=300;tick++){assert.deepEqual(mixed.readFrame(),plain.readFrame());const input=[0,1].map(ownerId=>({ownerId,bits:tick===0?4:0}));plain.step(input);mixed.step(input);}
  assert.equal(mixed.readFrame().tick,301);assert.equal(mixed.readFrame().phase,'playing');
  const before=mixed.snapshot();assert.throws(()=>mixed.restore(plain.snapshot()),/identity/);assert.deepEqual(mixed.snapshot(),before);
 }
});

test('regional bindings reject missing or ambiguous physical regions, duplicate layers and non-JSON data',()=>{
 const cases:unknown[]=[null,{},Array.from({length:17},()=>({regionId:'start',scene:scene('x')})),[{regionId:'absent',scene:scene('x')}],[{regionId:'start',layer:4,scene:scene('x')}],[{regionId:'start',layer:.5,scene:scene('x')}],[{regionId:'start',scene:scene('x')},{regionId:'start',scene:scene('y')}],[{regionId:'start',scene:scene('x'),bounds:[0,0,1,1]}],[{regionId:'start',scene:{...scene('x'),callback:()=>0}}]];
 for(const bindings of cases)assert.throws(()=>assertArenaFieldScenes({...field(),sceneRegions:bindings} as ArenaField));
 const a=field();assert.throws(()=>assertArenaFieldScenes({...a,regions:[...a.regions,a.regions[0]!],sceneRegions:[{regionId:'start',scene:scene('x')}]}),/binding/);
});

test('scene envelope is bounded across all regional recipes, not independently per record',()=>{
 const expanded=scene('expanded') as ArenaSceneGenome&{padding:string[]};expanded.padding=Array.from({length:80},()=>'.'.repeat(400));
 assert.throws(()=>assertArenaFieldScenes(field({scene:expanded,sceneRegions:[{regionId:'start',scene:expanded},{regionId:'arrival',scene:expanded}]})),/byte cap/);
 assertArenaFieldScenes(field({scene:scene('default')}));assertArenaFieldScenes(field());
});

test('art mounting binds an existing surface on its chunk layer and preserves native route frames',()=>{
 const plain=shotRouteWorld(),a=plain.arenas[0]!,item={id:'raised-lamp',assetId:'fixture/lamp',seed:'0x01',x:700,y:240,z:100,yaw:0,scale:1,anchorSurfaceId:'bridge'},chunk={id:'raised-detail',bounds:[650,110,750,290] as const,layer:1,height:100,biome:a.regions[0]!.biome,seed:'0x01',instances:[item]},bound=worldFrom([{...a,chunks:[chunk]}]);validateArenaWorld(bound);
 for(const anchorSurfaceId of ['missing','ground-under-ramp',null,17])assert.throws(()=>validateArenaWorld(worldFrom([{...a,chunks:[{...chunk,instances:[{...item,anchorSurfaceId}]}]}] as never)),/mounting/);
 assert.throws(()=>validateArenaWorld(worldFrom([{...a,chunks:[{...chunk,layer:0}]}])),/mounting/);
 const options={players:[player()],mode:'expedition' as const,maxTicks:1000},one=createArenaMatch(plain,options),two=createArenaMatch(bound,options);
 for(let tick=1;tick<=90;tick++){const inputs=[{ownerId:0,bits:tick===1?4:0}];assert.deepEqual(two.step(inputs),one.step(inputs));}
});

test('whole-field print identity is bounded, optional and neutral through real layered play',()=>{
 const original=shotRouteWorld(),s={...scene('field-art'),print:{spacing:240,layout:'field' as const,semantic:'canopy-veins',primitives:[{a:[-.4,-.3] as const,b:[.4,.3] as const,width:.006,role:'bark' as const}]}};
 assertArenaFieldScenes(field({scene:scene('legacy')}));assertArenaFieldScenes(field({scene:{...s,print:{...s.print,layout:'grid'}}}));
 const printed=worldFrom(original.arenas.map(a=>({...a,scene:s})));
 for(const mode of ['battle','expedition'] as const){const options={players:[player(0,0),player(1,1)],mode,maxTicks:1000,stormDelayTicks:1000},one=createArenaMatch(original,options),two=createArenaMatch(printed,options);for(let tick=1;tick<=120;tick++)assert.deepEqual(two.step([{ownerId:0,bits:tick===1?4:0},{ownerId:1,bits:tick===1?4:0}]),one.step([{ownerId:0,bits:tick===1?4:0},{ownerId:1,bits:tick===1?4:0}]));}
 for(const extra of [{layout:'city'},{layout:null},{layout:1},{semantic:''},{semantic:'.'.repeat(121)},{semantic:3},{semantic:null}])assert.throws(()=>assertArenaFieldScenes(field({scene:{...s,print:{...s.print,...extra}} as never})),/print presentation/);
});
