import test from 'node:test';import assert from 'node:assert/strict';
import {createKeelStore,createFrameLoop,integerFit} from '../src/lifecycle.mjs';
import {recipeTheme,themeTokens} from '../src/design.ts';
import {themeOf} from '@keel-engine/ui';
test('React theme is exactly canonical keel/ui and deterministic tokens preserve ramps',()=>{
 const theme=recipeTheme({seed:'test',culture:'industrial',pins:{motion:'none'}});
 assert.deepEqual(theme,themeOf(theme.recipe));assert.deepEqual(themeTokens(theme,3),themeTokens(recipeTheme({seed:'test',culture:'industrial',pins:{motion:'none'}}),3));
 assert.equal(themeTokens(theme,3)['--keel-px'],'3px');assert.throws(()=>themeTokens(theme,1.5),/integer/);assert.throws(()=>recipeTheme({culture:'fake'}),/culture/);
});
test('store has stable hydration snapshot and unsubscribes; clock pauses, seeks and cleans pending frames',()=>{
 const initial=Object.freeze({tick:0}),store=createKeelStore(initial);let calls=0;const off=store.subscribe(()=>calls++);store.setSnapshot(initial);assert.equal(calls,0);store.setSnapshot({tick:1});assert.equal(calls,1);assert.equal(store.getServerSnapshot(),initial);off();store.setSnapshot({tick:2});assert.equal(calls,1);
 const pending=new Map(),drawn=[];let id=0;const loop=createFrameLoop({fps:30,draw:t=>drawn.push(t),schedule:f=>{pending.set(++id,f);return id;},cancel:id=>pending.delete(id)});
 loop.seek(6);assert.equal(drawn[0].seconds,.2);loop.start();assert.equal(pending.size,1);loop.dispose();assert.equal(pending.size,0);assert.throws(()=>loop.seek(1),/disposed/);assert.deepEqual(integerFit(160,144,640,480),{scale:3,width:480,height:432,overflow:false});
});
