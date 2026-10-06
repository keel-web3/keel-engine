/** Identity of the effective Node worker, including its runtime import closure.
 * Tree shaking omits unused pure exports (such as a bank packer) while retaining
 * transitive rendering/codec dependencies and module side effects. */
import {build,version} from 'esbuild';
import {createHash} from 'node:crypto';
export async function sourceKey(entry) {
 const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',target:'es2022',minify:true,treeShaking:true,logLevel:'silent'});
 return createHash('sha256').update('keel-worker-v1\0'+version+'\0').update(result.outputFiles[0].contents).digest('hex');
}
