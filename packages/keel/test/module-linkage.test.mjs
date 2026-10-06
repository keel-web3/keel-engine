import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {build,transform} from 'esbuild';
import ts from 'typescript';
import {runInNewContext} from 'node:vm';
import {MODULE_RUNTIME,packageModularOutputs,assertModuleRevision} from '../src/modular-resources.mjs';

test('publication units preserve factory IDs, live getters and isolated body revisions',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'keel-linkage-'));
  try {
    await writeFile(resolve(root,'counter.js'),'export let count=0;export function tick(){count++}');
    await writeFile(resolve(root,'color.js'),'export function color(){return "amber"}');
    await writeFile(resolve(root,'counter-api.js'),'export * from "./counter.js";');
    await writeFile(resolve(root,'color-api.js'),'export * from "./color.js";');
    await writeFile(resolve(root,'game.js'),'import {count,tick} from "./counter-api.js";import {color} from "./color-api.js";export function run(){tick();return [count,color()]}');
    const compile=async(grouped)=>{
      const entryPoints=Object.fromEntries(['game','counter','color','counter-api','color-api'].map(n=>[n,resolve(root,n+'.js')]));
      const result=await build({entryPoints,absWorkingDir:root,outdir:resolve(root,'dist'),bundle:true,splitting:true,format:'esm',write:false,metafile:true,target:'es2022'});
      return packageModularOutputs({result,transform,compact:async text=>(await transform(text,{minify:true,target:'es2022'})).code,typescript:ts,roots:{fixture:root},workingDir:root,
        entryIds:new Map(Object.entries(entryPoints).map(([name,path])=>[path,'fixture.'+name])),
        ...(grouped?{publicationGroupBy:r=>r.id.endsWith('-api')?'fixture.linkage':grouped==='bodies'&&!r.linkageOnly&&r.sources.every(s=>/\/(?:counter|color)\.js$/.test(s))?'fixture.logic':undefined}:{})});
    };
    const separate=await compile(false),one=await compile(true),bodyOne=await compile('bodies');
    assert.equal(one.length,separate.length-1);
    const linkage=one.find(r=>r.id==='fixture.linkage');
    assert.deepEqual(linkage.modules.map(m=>m.id),['fixture.color-api','fixture.counter-api']);
    assert.equal(bodyOne.length,one.length-1);
    const logic=bodyOne.find(r=>r.id==='fixture.logic');
    assert.equal(logic.modules.length,2);
    assert.deepEqual(logic.exports,[]);
    assert.equal(logic.linkageOnly,false);
    assert.ok(one.every(r=>r.dependencies.every(id=>one.some(target=>target.id===id))));
    await writeFile(resolve(root,'color.js'),'export function color(){return "cyan"}');
    const two=await compile(true),changed=assertModuleRevision(one,two);
    assert.equal(changed.length,1);
    assert.notEqual(changed[0],'fixture.linkage');
    const bodyTwo=await compile('bodies');
    assert.deepEqual(assertModuleRevision(bodyOne,bodyTwo),['fixture.logic']);
    assert.throws(()=>assertModuleRevision(bodyOne,bodyTwo.map(r=>r.id==='fixture.logic'?{...r,modules:r.modules.slice(1)}:r)),/Module interface changed/);
    for(const [resources,color]of[[separate,'amber'],[one,'amber'],[two,'cyan'],[bodyOne,'amber'],[bodyTwo,'cyan']]) {
      const context={};runInNewContext(MODULE_RUNTIME,context);
      for(const r of resources.slice().reverse())runInNewContext(r.bytes.toString(),context);
      const modules=context.__KEEL_STATIC_MODULES__,game=modules.require('fixture.game');
      assert.equal(modules.require('fixture.color-api').color(),color);
      assert.deepEqual(Array.from(game.run()),[1,color]);
      assert.equal(modules.require('fixture.counter-api').count,1);
      assert.deepEqual(Array.from(game.run()),[2,color]);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});
