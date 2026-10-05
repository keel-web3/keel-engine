import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {keelPlugin} from '../src/mcp.mjs';
test('React plugin exposes four object schemas, exact canonical theme, plans and additive scaffold',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'keel-react-mcp-'));try{
 const workspace={root,async resolveOutputDirectory(value){const out=path.resolve(root,value);if(!out.startsWith(root+path.sep))throw new Error('outside workspace');await mkdir(out,{recursive:true});return out;}};
 const call=(name,input)=>keelPlugin.tools.find(x=>x.descriptor.name===name).run({workspace},input);
 assert.equal(keelPlugin.tools.length,4);for(const tool of keelPlugin.tools)assert.equal(tool.descriptor.inputSchema.type,'object');
 const theme=await call('keel-react-theme',{recipe:{seed:'same',culture:'arcane'}});assert.equal(theme.theme.recipe.seed,'same');assert.match(theme.css,/--keel-ink/);
 const plan=await call('keel-react-plan',{brief:'A room around a project cartridge',recipe:{seed:'same',culture:'arcane'},assets:[{id:'font',kind:'font',path:'own.ttf'}]});assert.equal(plan.theme.key,theme.key);assert.ok(plan.modules.some(x=>x.id==='keel/render'));
 const result=await call('keel-react-scaffold',{outDir:'app',recipe:{seed:'same',culture:'arcane'}});const source=await readFile(result.files[0],'utf8');assert.match(source,/@keel-engine\/react/);assert.match(source,/seed: "same"/);assert.match(source,/setWorld/);
 await assert.rejects(call('keel-react-scaffold',{outDir:'app'}),/overwrite/);assert.equal(await readFile(result.files[0],'utf8'),source);
 await assert.rejects(call('keel-react-theme',{extra:true}),/Unknown/);await assert.rejects(call('keel-react-scaffold',{outDir:'../outside'}),/outside/);
 }finally{await rm(root,{recursive:true,force:true});}
});
