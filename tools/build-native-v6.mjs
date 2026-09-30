import fs from'node:fs/promises';import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{build}from'esbuild';
import {compilerNotices} from './compiler-notices.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function buildNativeV6(out='native-v6-dist'){
 await fs.mkdir(out,{recursive:true});const opts={absWorkingDir:root,bundle:true,platform:'browser',format:'esm',minify:true,charset:'utf8',legalComments:'eof',external:['node:fs/promises']};
 const compiler=await build({...opts,metafile:true,entryPoints:[path.join(root,'packages/import/src/asset-compiler-v6.ts')],inject:[path.join(root,'packages/import/src/optimization/browser-buffer.ts')],outfile:path.join(out,'index.mjs')});
 await build({...opts,entryPoints:[path.join(root,'packages/import/src/asset-replay-v6.ts')],outfile:path.join(out,'asset-decoder.mjs')});
 const original=await fs.readFile(path.join(root,'node_modules/draco3dgltf/draco_decoder_gltf_nodejs.js'),'utf8');
 await fs.writeFile(path.join(out,'draco-factory.mjs'),'// Official draco3dgltf 1.5.7, portable ESM adapter; WASM supplied explicitly.\nconst process=undefined;const __filename=undefined;\n'+original+'\nexport default DracoDecoderModule;\n');
 await fs.copyFile(path.join(root,'node_modules/draco3dgltf/draco_decoder_gltf.wasm'),path.join(out,'draco_decoder_gltf.wasm'));
 for(const[from,name]of[['LICENSE','LICENSE-KEEL.txt'],['packages/import/node_modules/fflate/LICENSE','LICENSE-fflate.txt'],['LICENSE-DRACO-APACHE-2.0.txt','LICENSE-Draco-Apache-2.0.txt'],['packages/import/node_modules/meshoptimizer/LICENSE.md','LICENSE-meshoptimizer.txt']])await fs.copyFile(path.join(root,from),path.join(out,name));
 await fs.writeFile(path.join(out,'COMPILER-THIRD-PARTY-NOTICES.txt'),await compilerNotices(compiler.metafile,root));
 return{compilerBytes:(await fs.stat(path.join(out,'index.mjs'))).size,decoderBytes:(await fs.stat(path.join(out,'asset-decoder.mjs'))).size};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)console.log(await buildNativeV6(process.argv[2]));
