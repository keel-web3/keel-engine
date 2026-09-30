import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function buildNativeV3(out){
 await fs.mkdir(out,{recursive:true});const options={bundle:true,platform:'browser',format:'esm',minify:true,charset:'utf8',legalComments:'eof'};
 await build({...options,entryPoints:[path.join(root,'packages/import/src/asset-compiler-v3.ts')],outfile:path.join(out,'index.mjs')});
 await build({...options,stdin:{contents:"export {buildAsset,buildFromPackage,COMPILER_VERSION} from './packages/import/src/asset-compiler-v3.ts';",resolveDir:root},outfile:path.join(out,'asset-decoder.mjs')});
 for(const[source,name]of[[path.join(root,'LICENSE'),'KEEL-LICENSE.txt'],[path.join(root,'packages/import/node_modules/fflate/LICENSE'),'FFLATE-LICENSE.txt'],[path.join(root,'LICENSE-DRACO-APACHE-2.0.txt'),'DRACO-APACHE-2.0-LICENSE.txt']])await fs.copyFile(source,path.join(out,name));
 return{compilerBytes:(await fs.stat(path.join(out,'index.mjs'))).size,decoderBytes:(await fs.stat(path.join(out,'asset-decoder.mjs'))).size};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await buildNativeV3(process.argv[2]??'native-v3-dist')));
