// Host-only immutable resource packaging. Group selection and encoding belong to the target.
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const MAX_BYTES=32*1024*1024;

/** Bounded exact resource packing; no runtime, chain binding, or mutable logical handles. */
export async function packResourceContainers({resources,groupBy,compress,decompress,maxContainers=128}) {
 if(!Array.isArray(resources)||!resources.length||resources.length>128||typeof groupBy!=='function'||typeof compress!=='function'||typeof decompress!=='function'||!Number.isSafeInteger(maxContainers)||maxContainers<1||maxContainers>128)throw TypeError('Invalid resource container configuration');
 const groups=new Map(),ids=new Set();let total=0;
 for(const resource of resources){
  if(!/^[a-z][a-z0-9.-]*$/.test(resource.id)||ids.has(resource.id)||!['creator','shared'].includes(resource.scope)||!(resource.bytes instanceof Uint8Array)||!resource.bytes.length)throw TypeError('Invalid resource identity, scope or bytes');
  total+=resource.bytes.length;if(total>MAX_BYTES)throw RangeError('Resource graph exceeds the decoded byte bound');ids.add(resource.id);
  const id=groupBy(resource);if(!/^[a-z][a-z0-9.-]*$/.test(id))throw TypeError('Invalid container group ID');
  let group=groups.get(id);if(!group){if(groups.size>=maxContainers)throw RangeError('Container count exceeds the target bound');groups.set(id,group={id,scope:resource.scope,resources:[]});}
  if(group.scope!==resource.scope)throw TypeError('Container mixes shared and creator ownership');
  group.resources.push(resource);
 }
 const result=[];
 for(const group of [...groups.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
  const source=new Uint8Array(group.resources.reduce((size,resource)=>size+resource.bytes.length,0));
  const members=[];let offset=0;
  for(const resource of group.resources){source.set(resource.bytes,offset);members.push({id:resource.id,offset,length:resource.bytes.length,sha256:digest(resource.bytes)});offset+=resource.bytes.length;}
  const encoded=await compress(new Uint8Array(source));if(!(encoded instanceof Uint8Array)||!encoded.length||encoded.length>4*1024*1024)throw RangeError('Invalid packed container byte length');
  const stored=new Uint8Array(encoded);
  const decoded=await decompress(new Uint8Array(stored),source.length);if(!(decoded instanceof Uint8Array)||!same(source,decoded))throw Error('Container codec does not replay exact source bytes');
  result.push({id:group.id,scope:group.scope,source,stored,members,decodedBytes:source.length,decodedSha256:digest(source),storedBytes:stored.length,storedSha256:digest(stored)});
 }
 return result;
}

/** Reject a stale or altered persisted pack before a target binds it to a chain. */
export function verifyResourceContainer({source,stored,record}) {
 if(!record||!Array.isArray(record.members)||!record.members.length||record.members.length>128||!(source instanceof Uint8Array)||!source.length||source.length>MAX_BYTES||!(stored instanceof Uint8Array)||!stored.length||stored.length>4*1024*1024||source.length!==record.decodedBytes||stored.length!==record.storedBytes||digest(source)!==record.decodedSha256||digest(stored)!==record.storedSha256)throw Error('Container differs from its exact byte manifest');
 let end=0;const ids=new Set();
 for(const member of record.members){
  if(!/^[a-z][a-z0-9.-]*$/.test(member.id)||ids.has(member.id)||member.offset!==end||!Number.isSafeInteger(member.length)||member.length<1||member.length>source.length-end||digest(source.subarray(end,end+member.length))!==member.sha256)throw Error('Container member range or SHA256 differs');
  end+=member.length;ids.add(member.id);
 }
 if(end!==source.length)throw Error('Container members do not cover its exact source');
}

/** First publication can share a dictionary without coupling subsequent patches.
 * Reused member references retain their original immutable container and range.
 * Changed members become independently addressable containers by default. */
export async function packResourceRevision({resources,previousContainers,compress,decompress}) {
 if(!Array.isArray(previousContainers)||!previousContainers.length)throw TypeError('Previous committed containers are required');
 const previous=new Map();
 for(const container of previousContainers){
  if(!/^[a-z][a-z0-9.-]*$/.test(container.id)||!['shared','creator'].includes(container.scope)||!Array.isArray(container.members)||!Number.isSafeInteger(container.decodedBytes)||container.decodedBytes<1||container.decodedBytes>MAX_BYTES||!/^[a-f0-9]{64}$/.test(container.decodedSha256)||!/^[a-f0-9]{64}$/.test(container.storedSha256))throw TypeError('Invalid previous container commitment');
  let end=0;for(const member of container.members){
   if(!/^[a-z][a-z0-9.-]*$/.test(member.id)||previous.has(member.id)||member.offset!==end||!Number.isSafeInteger(member.length)||member.length<1||member.length>container.decodedBytes-end||!/^[a-f0-9]{64}$/.test(member.sha256))throw TypeError('Invalid previous member commitment');
   previous.set(member.id,{scope:container.scope,containerId:container.id,...member});end+=member.length;
  }if(end!==container.decodedBytes)throw TypeError('Previous members do not cover the container');
 }
 if(!Array.isArray(resources)||!resources.length||resources.length>128)throw TypeError('Invalid revised resource graph');
 const reused=[],changed=[],ids=new Set();let total=0;
 for(const resource of resources){
  if(!/^[a-z][a-z0-9.-]*$/.test(resource.id)||ids.has(resource.id)||!['shared','creator'].includes(resource.scope)||!(resource.bytes instanceof Uint8Array)||!resource.bytes.length)throw TypeError('Invalid revised resource');ids.add(resource.id);
  total+=resource.bytes.length;if(total>MAX_BYTES)throw RangeError("Revised graph exceeds the decoded byte bound");
  const old=previous.get(resource.id),sha256=digest(resource.bytes);if(old&&old.scope!==resource.scope)throw Error("Resource ownership changed: "+resource.id);
  if(old&&old.length===resource.bytes.length&&old.sha256===sha256)reused.push(old);else changed.push(resource);
 }
 return{reused,containers:changed.length?await packResourceContainers({resources:changed,groupBy:r=>r.id,compress,decompress}):[],removed:[...previous.keys()].filter(id=>!ids.has(id))};
}
