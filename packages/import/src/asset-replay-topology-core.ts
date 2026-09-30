import{unpackAsset}from'./asset-binary-v3.ts';import{buildAsset as buildCore}from'./asset-replay-visual-core.ts';import{restoreTopologyPredictions}from'./optimization/topology-replay.ts';
export async function buildAsset(recipe:any){return buildCore(await restoreTopologyPredictions(recipe));}
export async function buildFromPackage(data:Uint8Array){return buildAsset(unpackAsset(data));}
export async function decodePackage(data:Uint8Array){const b=await buildFromPackage(data);return{entry:'asset.glb',files:[{name:'asset.glb',data:b.glb}],nativeScene:b.scene,representation:'native-code'};}
