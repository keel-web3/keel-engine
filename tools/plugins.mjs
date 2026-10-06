#!/usr/bin/env node
import {installPlugin,removePlugin,readRegistry,defaultRegistry} from '../packages/plugins/src/registry.mjs';
const args=process.argv.slice(2),i=args.indexOf('--config');let config=defaultRegistry();
if(i>=0){if(!args[i+1])throw new Error('--config requires a path');config=args[i+1];args.splice(i,2);}
try {
 const [action,value,...extra]=args;if(extra.length)throw new Error('Too many arguments.');
 if(action==='install'&&value)console.log(JSON.stringify(await installPlugin(value,config),null,2));
 else if(action==='remove'&&value)console.log(JSON.stringify(await removePlugin(value,config),null,2));
 else if(action==='list'&&!value)console.log(JSON.stringify(await readRegistry(config),null,2));
 else throw new Error('Usage: node tools/plugins.mjs install <plugin-dir> | remove <id> | list [--config <registry>]');
}catch(error){console.error(error.message);process.exitCode=1;}
