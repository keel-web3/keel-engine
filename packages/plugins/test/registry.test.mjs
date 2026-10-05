import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {installPlugin,removePlugin,inspectPlugin,readRegistry} from '../src/registry.mjs';
test('install/remove is idempotent and preserves other entries; traversal and symlink escapes rejected',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'keel-registry-'));try{
 const dir=path.join(root,'plugin');await mkdir(dir);await writeFile(path.join(dir,'entry.mjs'),'export const keelPlugin={};');
 const manifest={schema:'keel-plugin@1',id:'test/plugin',version:'1.0.0',entry:'entry.mjs',capabilities:['mcp']};await writeFile(path.join(dir,'keel.plugin.json'),JSON.stringify(manifest));
 const config=path.join(root,'registry.json');await installPlugin(dir,config);await installPlugin(dir,config);assert.equal((await readRegistry(config)).plugins.length,1);
 await removePlugin('test/plugin',config);assert.equal((await readRegistry(config)).plugins.length,0);
 await writeFile(path.join(root,'outside.mjs'),'');await symlink(path.join(root,'outside.mjs'),path.join(dir,'escape.mjs'));
 await writeFile(path.join(dir,'keel.plugin.json'),JSON.stringify({...manifest,entry:'escape.mjs'}));await assert.rejects(inspectPlugin(dir),/escapes/);
 }finally{await rm(root,{recursive:true,force:true});}
});
