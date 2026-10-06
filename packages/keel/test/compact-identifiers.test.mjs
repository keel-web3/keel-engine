import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createSharedIdentifierMangler} from '../src/compact-identifiers.mjs';
const require=createRequire(new URL('../../../../keel-sdk/packages/builder/package.json',import.meta.url));
const {minify}=require('terser');

test('shared private names are deterministic and collision-free across digit boundaries',()=>{
 const a=createSharedIdentifierMangler(),b=createSharedIdentifierMangler();
 const names=Array.from({length:10000},(_,i)=>a.get(i));
 assert.equal(new Set(names).size,names.length);
 for(const [i,name]of names.entries()){assert.match(name,/^[a-zA-Z$_][a-zA-Z$_0-9]*$/);assert.equal(name,b.get(i));}
 for(const invalid of [-1,.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>a.get(invalid),RangeError);
});

test('compiler resolves lexical names while preserving public properties, getters and literals',async()=>{
 const source=`globalThis.fixture=(()=>{let privateCount=0;const privateText="privateCount must remain a literal";return {get score(){return privateCount},label:privateText,next(input){let privateCount=input+1;return ()=>privateCount},tick(){return ++privateCount}}})();`;
 const result=await minify(source,{compress:false,mangle:{nth_identifier:createSharedIdentifierMangler()},format:{comments:false}});
 assert.ok(result.code);
 const context={};runInNewContext(result.code,context);const fixture=context.fixture;
 assert.equal(fixture.label,'privateCount must remain a literal');
 assert.deepEqual(Object.keys(fixture),['score','label','next','tick']);
 assert.equal(fixture.score,0);assert.equal(fixture.next(40)(),41);assert.equal(fixture.tick(),1);assert.equal(fixture.score,1);
});
