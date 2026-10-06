import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {build,transform} from 'esbuild';
import ts from 'typescript';
import {runInNewContext} from 'node:vm';
import {MODULE_RUNTIME,createStaticModuleRuntime,shareCommonJsHelpers,packageModularOutputs,assertModuleRevision,collectModuleOutputs} from '../src/modular-resources.mjs';
const compact=async text=>(await transform(text,{minify:true,target:'es2022'})).code;
async function compiled(root,sharedHelpers=false) {
  const result=await build({entryPoints:{'game':resolve(root,'game.js'),'style':resolve(root,'style.js'),'counter':resolve(root,'counter.js')},
    absWorkingDir:root,outdir:resolve(root,'dist'),entryNames:'[name]',chunkNames:'chunk-[hash]',bundle:true,splitting:true,format:'esm',write:false,metafile:true,target:'es2022'});
  return packageModularOutputs({result,transform,compact,sharedHelpers,typescript:ts,roots:{fixture:root},workingDir:root,
    entryIds:new Map(['game','style','counter'].map(name=>[resolve(root,`${name}.js`),`fixture.${name}`]))});
}
test('a body-only style revision changes one stable handle and reuses all other resources',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'keel-module-revision-'));
  try {
    await writeFile(resolve(root,'counter.js'),'export let count=0;export function tick(){count++}');
    await writeFile(resolve(root,'style.js'),'export function color(){return "amber"}');
    await writeFile(resolve(root,'game.js'),'import {count,tick} from "./counter.js";import {color} from "./style.js";export function run(){tick();return [count,color()]}');
    const one=await compiled(root);
    await writeFile(resolve(root,'style.js'),'export function color(){return "cyan"}');
    const two=await compiled(root),changed=assertModuleRevision(one,two);
    assert.equal(changed.length,1);
    assert.equal(two.find(r=>r.id===changed[0]).sources.some(s=>s.endsWith('/style.js')),true);
    for(const [resources,color]of[[one,'amber'],[two,'cyan']]) {
      const context={};runInNewContext(MODULE_RUNTIME,context);
      for(const r of resources.slice().reverse())runInNewContext(r.bytes.toString(),context);
      const game=context.__KEEL_STATIC_MODULES__.require('fixture.game');
      assert.deepEqual(Array.from(game.run()),[1,color]);
      assert.deepEqual(Array.from(game.run()),[2,color]);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
test('factory registry rejects duplicate and missing handles',()=>{
  const context={};runInNewContext(MODULE_RUNTIME,context);
  const m=context.__KEEL_STATIC_MODULES__;m.define('one',()=>{});
  assert.throws(()=>m.define('one',()=>{}),/Duplicate/);
  assert.throws(()=>m.require('absent'),/Missing verified/);
});
test('compatibility changes require explicit migration',()=>{
  const one=[{id:'game',exports:['main'],dependencies:[],sha256:'one'}];
  assert.throws(()=>assertModuleRevision(one,[{...one[0],id:'another'}]),/handles changed/);
  assert.throws(()=>assertModuleRevision(one,[{...one[0],exports:['other']}]),/interface changed/);
});

test('deep and cyclic module walks remain linear and avoid recursion limits',()=>{
 const outputs=new Map(),root='/fixture',n=20000;for(let i=0;i<n;i++)outputs.set(root+'/'+i,{imports:[{path:String((i+1)%n)}]});
 const reachable=collectModuleOutputs(outputs,[root+'/0'],root);assert.equal(reachable.size,n);assert.deepEqual([...reachable].slice(0,3),['/fixture/0','/fixture/1','/fixture/2']);
 outputs.set(root+'/orphan',{imports:[]});assert.equal(collectModuleOutputs(outputs,[root+'/0'],root).size,n);
 assert.throws(()=>collectModuleOutputs(outputs,[root+'/missing'],root),/Missing output/);
});

test('shared compiler helpers retain live getters, namespace imports and default exports',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'keel-shared-helpers-'));
 try{
  await writeFile(resolve(root,'counter.js'),'export let count=0;export default function tick(){count++}');
  await writeFile(resolve(root,'style.js'),'export const tint="cyan";');
  await writeFile(resolve(root,'game.js'),'import tick,*as state from "./counter.js";import {tint} from "./style.js";export function run(){tick();return [state.count,tint]}');
  const plain=await compiled(root),shared=await compiled(root,true);assert.deepEqual(plain.map(r=>[r.id,r.exports,r.dependencies]),shared.map(r=>[r.id,r.exports,r.dependencies]));
  assert.ok(shared.some(r=>r.bytes.toString().includes('.__defProp')));
  assert.ok(shared.reduce((n,r)=>n+r.bytes.length,0)<plain.reduce((n,r)=>n+r.bytes.length,0));
  for(const [resources,enabled]of[[plain,false],[shared,true]]){const context={};runInNewContext(createStaticModuleRuntime('__KEEL_STATIC_MODULES__',{sharedHelpers:enabled}),context);for(const r of resources.slice().reverse())runInNewContext(r.bytes.toString(),context);const game=context.__KEEL_STATIC_MODULES__.require('fixture.game');assert.deepEqual(Array.from(game.run()),[1,'cyan']);assert.deepEqual(Array.from(game.run()),[2,'cyan']);}
 }finally{await rm(root,{recursive:true,force:true})}
 assert.equal(shareCommonJsHelpers('var __defProp=custom.define; exportValue(__defProp)',ts),null);
});
