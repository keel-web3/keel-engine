import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {readFileSync} from 'node:fs';import {dirname,resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';
import {bundleModule,closureOf,engineModuleFiles,linkRecord,readWorkspace,resolveModules} from '@keel-engine/keel';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=resolve(dir,'../..');
const workspace=await readWorkspace(root),mod=workspace.find(m=>m.manifest.id==='packs/pinball-biomes')!;
test('standard KEEL entry/link files are current and reach only declared optional modules',async()=>{
 assert.ok(mod);const link=await linkRecord(mod,workspace);assert.deepEqual(link.imports,{'@keel-engine/core/rng':'keel/core','@keel-engine/runtime':'keel/runtime'});
 for(const [name,contents] of Object.entries(engineModuleFiles(mod,link,'packs/pinball-biomes')))assert.equal(readFileSync(join(dir,name),'utf8'),contents,name);
});
test('optional pack starts through the real KEEL registry and exports working recipes',async()=>{
 const closure=closureOf(mod.manifest.id,workspace),resolution=resolveModules(closure.map(m=>m.manifest));assert.ok(resolution.ok,JSON.stringify(resolution.problems));
 const page:Record<string,unknown>={console,TextEncoder,TextDecoder,atob,btoa};page.globalThis=page;vm.createContext(page);
 for(const id of resolution.order)vm.runInContext((await bundleModule(closure.find(m=>m.manifest.id===id)!,workspace)).code,page);
 const engine=page.KEEL_ENGINE as {start():Promise<unknown>;get(id:string):Record<string,any>};await engine.start();
 const recipe=engine.get('packs/pinball-biomes').createPinballBiome({theme:'nature',seed:'vm-canopy',width:600,height:1000,density:'low'});assert.equal(recipe.schema,'keel-pinball-biome@1');assert.equal(recipe.ornaments.length,12);assert.ok(recipe.ornaments.some((o:any)=>o.kind==='leaf'));
});
