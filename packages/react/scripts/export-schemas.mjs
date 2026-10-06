import {mkdir,writeFile} from 'node:fs/promises';
import {TOOL_SCHEMAS} from '../src/mcp.mjs';
await mkdir(new URL('../schemas/',import.meta.url),{recursive:true});
await writeFile(new URL('../schemas/tools.json',import.meta.url),JSON.stringify(TOOL_SCHEMAS,null,2)+'\n');
