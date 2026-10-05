import {readFile,writeFile,mkdir,realpath,rename,open,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
export const defaultRegistry=()=>resolve(process.env.KEEL_MCP_PLUGIN_CONFIG??join(homedir(),'.keel','plugins.json'));
export async function readRegistry(file=defaultRegistry()) {
 let bytes;try {bytes=await readFile(file);}catch(error){if(error.code==='ENOENT')return {schema:'keel-plugins@1',plugins:[]};throw error;}
 if(bytes.length>65536)throw new RangeError('Plugin registry exceeds 64 KiB.');
 const value=JSON.parse(bytes);if(value.schema!=='keel-plugins@1'||!Array.isArray(value.plugins)||value.plugins.length>64)throw new TypeError('Invalid plugin registry.');
 const ids=new Set();for(const plugin of value.plugins){if(!plugin||typeof plugin.id!=='string'||typeof plugin.entry!=='string'||!isAbsolute(plugin.entry)||ids.has(plugin.id)||(plugin.enabled!==undefined&&typeof plugin.enabled!=='boolean'))throw new TypeError('Invalid registry plugin.');ids.add(plugin.id);}
 return value;
}
export async function inspectPlugin(directory) {
 const root=await realpath(resolve(directory)),bytes=await readFile(join(root,'keel.plugin.json'));
 if(bytes.length>16384)throw new RangeError('Plugin manifest exceeds 16 KiB.');
 const m=JSON.parse(bytes);
 if(m.schema!=='keel-plugin@1'||typeof m.id!=='string'||!/^[a-z0-9][a-z0-9./-]{0,127}$/.test(m.id)||typeof m.version!=='string'||!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version)||typeof m.entry!=='string'||isAbsolute(m.entry)||!Array.isArray(m.capabilities)||!m.capabilities.includes('mcp'))throw new TypeError('Invalid KEEL plugin manifest.');
 const entry=await realpath(resolve(root,m.entry)),rel=relative(root,entry);
 if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw new TypeError('Plugin entry escapes its package.');
 return {id:m.id,version:m.version,entry,enabled:true};
}
async function mutate(file,update) {
 file=resolve(file);await mkdir(dirname(file),{recursive:true});
 // Exclusive lock prevents parallel installers from losing each other's entries. Never delete a foreign lock.
 const lock=file+'.lock',fd=await open(lock,'wx',0o600),scratch=file+'.'+randomUUID()+'.tmp';
 try {const config=await readRegistry(file);await update(config);await writeFile(scratch,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(scratch,file);return config;}
 finally {await fd.close();await unlink(lock);await unlink(scratch).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export async function installPlugin(directory,file=defaultRegistry()) {
 const plugin=await inspectPlugin(directory);
 const config=await mutate(file,config=>{const index=config.plugins.findIndex(x=>x.id===plugin.id);if(index>=0)config.plugins[index]=plugin;else {if(config.plugins.length>=64)throw new RangeError('Plugin registry full.');config.plugins.push(plugin);}});
 return {registryPath:resolve(file),plugin,plugins:config.plugins,restartRequired:true};
}
export async function removePlugin(id,file=defaultRegistry()) {const config=await mutate(file,config=>{config.plugins=config.plugins.filter(x=>x.id!==id);});return {registryPath:resolve(file),plugins:config.plugins,restartRequired:true};}
