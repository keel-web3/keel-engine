import fs from 'node:fs/promises';
import path from 'node:path';
/** Preserve licenses for dependencies actually included in a compiler bundle. */
export async function compilerNotices(metafile,root){
 const packages=new Map();
 for(const input of Object.keys(metafile.inputs)){
  const file=path.resolve(root,input);if(!file.includes(path.sep+'node_modules'+path.sep))continue;
  let directory=path.dirname(file);
  while(directory!==path.dirname(directory)){
   try{const p=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));if(p.name&&p.version){packages.set(p.name+'@'+p.version,{directory,info:p});break;}}catch{}
   directory=path.dirname(directory);
  }
 }
 const chunks=[];for(const[name,{directory,info}]of[...packages].sort(([a],[b])=>a.localeCompare(b))){chunks.push(name+' ('+(info.license??'see notices')+')');const files=(await fs.readdir(directory,{withFileTypes:true})).filter(e=>e.isFile()&&/^(licen[sc]e|notice|copying)(\.|$)/i.test(e.name));if(!files.length)throw Error('Missing bundled dependency license: '+name);for(const f of files.sort((a,b)=>a.name.localeCompare(b.name)))chunks.push(await fs.readFile(path.join(directory,f.name),'utf8'));}
 return chunks.join('\n\n--------------------\n\n')+'\n';
}
