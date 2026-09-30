#!/usr/bin/env node
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath,pathToFileURL}from'node:url';import{build}from'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function buildNativeCompiler(out='native-asset-compiler-dist'){
 await fs.mkdir(out,{recursive:true});const common={bundle:true,platform:'browser',format:'esm',minify:true,charset:'utf8',legalComments:'eof'};
 await build({...common,entryPoints:[path.join(root,'packages/import/src/asset-compiler-v2.ts')],outfile:path.join(out,'index.mjs')});
 await build({...common,stdin:{contents:"export {decodePackage,buildNativeAsset,COMPILER_VERSION} from './packages/import/src/asset-compiler-v2.ts';",resolveDir:root,sourcefile:'native-asset-decoder-entry.mjs'},outfile:path.join(out,'asset-decoder.mjs')});
 await fs.copyFile(path.join(root,'LICENSE'),path.join(out,'KEEL-LICENSE.txt'));await fs.copyFile(path.join(root,'packages/import/node_modules/fflate/LICENSE'),path.join(out,'FFLATE-LICENSE.txt'));
 return{compilerBytes:(await fs.stat(path.join(out,'index.mjs'))).size,decoderBytes:(await fs.stat(path.join(out,'asset-decoder.mjs'))).size};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await buildNativeCompiler(process.argv[2])));
