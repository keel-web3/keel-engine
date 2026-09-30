/** Lazily loads the pinned, locally distributed shared Draco runtime. No source
 * model contains executable code or remote decoder URLs. */
let pending:Promise<any>|undefined;
export function sharedDracoDecoder():Promise<any>{
 return pending??=(async()=>{
  const moduleURL=new URL('./draco-factory.mjs',import.meta.url).href;
  const {default:create}=await import(moduleURL);
  const wasmURL=new URL('./draco_decoder_gltf.wasm',import.meta.url);
  let wasmBinary:Uint8Array;
  if((globalThis as any).process?.versions?.node){const moduleName='node:fs/promises',fs=await import(moduleName);wasmBinary=new Uint8Array(await fs.readFile(wasmURL));}
  else{const response=await fetch(wasmURL);if(!response.ok)throw Error('Shared Draco WASM unavailable');wasmBinary=new Uint8Array(await response.arrayBuffer());}
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(wasmBinary)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!=='712db3449ae2041d6e8a224c395bda6cedb49e51322fae38b7db9beb8b381889')throw Error('Shared Draco WASM version mismatch');
  return create({wasmBinary});
 })().catch(error=>{pending=undefined;throw error});
}
