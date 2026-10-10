import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPinballBiome,PINBALL_BIOME_THEMES,PINBALL_BIOME_CAPS} from '../src/index.ts';
const input={seed:'emberline.canopy.v1',width:600,height:1000};
test('a theme/seed reproduces exact recipe bytes, while seed and grammar affect ornaments',()=>{
  for(const theme of PINBALL_BIOME_THEMES){const a=createPinballBiome({...input,theme});assert.equal(JSON.stringify(a),JSON.stringify(createPinballBiome({...input,theme})));assert.notDeepEqual(a.ornaments,createPinballBiome({...input,theme,seed:'another.seed'}).ornaments);}
  const signatures=PINBALL_BIOME_THEMES.map(theme=>JSON.stringify(createPinballBiome({...input,theme}).ornaments));assert.equal(new Set(signatures).size,5);
  assert.ok(createPinballBiome({...input,theme:'nature'}).ornaments.some(o=>o.kind==='leaf'));
  assert.ok(createPinballBiome({...input,theme:'vaporwave'}).ornaments.some(o=>o.kind==='sun'));
  assert.ok(createPinballBiome({...input,theme:'gold'}).ornaments.some(o=>o.kind==='gem'));
});
test('quality reduces count without changing IDs or rerolling retained ornaments',()=>{
  for(const theme of PINBALL_BIOME_THEMES){const high=createPinballBiome({...input,theme,density:'high'});for(const density of ['low','medium','high'] as const){const recipe=createPinballBiome({...input,theme,density});assert.equal(recipe.ornaments.length,PINBALL_BIOME_CAPS[density]);assert.deepEqual(recipe.ornaments,high.ornaments.slice(0,PINBALL_BIOME_CAPS[density]));assert.equal(new Set(recipe.ornaments.map(o=>o.id)).size,recipe.ornaments.length);}}
});
test('bounded seed batch stays finite, in bounds, and clear of the lower central landing',()=>{
  for(const theme of PINBALL_BIOME_THEMES)for(let seed=0;seed<50;seed++){
    const recipe=createPinballBiome({theme,seed,width:600,height:1000,density:'high'});
    for(const o of recipe.ornaments){for(const value of [o.x,o.y,o.size,o.rotation,o.phase,o.variant])assert.ok(Number.isFinite(value));assert.ok(o.x>=0&&o.x<=600);assert.ok(o.y>=0&&o.y<=1000);assert.ok(o.size>0&&o.size<=210);assert.ok(Number.isInteger(o.variant)&&o.variant>=0&&o.variant<=3);if(o.y+o.size/2>=700)assert.ok(o.x+o.size/2<=114||o.x-o.size/2>=486,`${theme}/${seed}/${o.id}`);}
  }
});
test('recipe, palette, ornament list and objects are immutable',()=>{
  const recipe=createPinballBiome({...input,theme:'nature'});assert.ok(Object.isFrozen(recipe));assert.ok(Object.isFrozen(recipe.palette));assert.ok(Object.isFrozen(recipe.ornaments));assert.ok(recipe.ornaments.every(Object.isFrozen));assert.throws(()=>{(recipe.ornaments[0] as any).x=300;},TypeError);assert.throws(()=>{(recipe.palette as any).ball='#000';},TypeError);
});
test('unbounded or malformed authoring inputs fail before allocation',()=>{
  for(const change of [{seed:NaN},{seed:-1},{seed:1e300},{seed:''},{seed:'a'.repeat(161)},{width:Infinity},{height:0},{density:'ultra'},{theme:'unknown'}])assert.throws(()=>createPinballBiome({...input,theme:'nature',...change} as any));
});
