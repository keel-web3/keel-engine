import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readWorkspace,linkRecord,engineModuleFiles} from '@keel-engine/keel';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=resolve(dir,'../..');
const workspace=await readWorkspace(root),mod=workspace.find(m=>m.manifest.id==='packs/pinball-biomes');
if(!mod)throw new Error('Biome module not discovered');
const link=await linkRecord(mod,workspace);
for(const [name,content] of Object.entries(engineModuleFiles(mod,link,'packs/pinball-biomes'))){const path=join(dir,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,content);}
console.log(JSON.stringify({id:mod.manifest.id,imports:link.imports}));
