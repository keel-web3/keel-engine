/** Hash-pinned, bounded streaming fetch. Cache hits are re-hashed before use. */
export async function verifiedDownload(url,{sha256,size,maxBytes=size,onProgress=()=>{},signal,fetchImpl=fetch,cacheStorage=globalThis.caches}={}){
 if(!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('A pinned hash and bounded download size are required.');
 const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const key=new URL(url);key.searchParams.set('keel-sha256',sha256);let cache;
 try{cache=await cacheStorage?.open('keel-chromatic-verified-v1');const hit=await cache?.match(key.href);if(hit){const bytes=new Uint8Array(await hit.arrayBuffer());if(bytes.length<=maxBytes&&(!size||bytes.length===size)&&await digest(bytes)===sha256){onProgress({received:bytes.length,total:bytes.length,cached:true});return bytes;}await cache.delete(key.href);}}catch{cache=undefined;}
 const response=await fetchImpl(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:signal??AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Download failed. Nothing on the device was changed.');
 const declared=Number(response.headers?.get('content-length'));if(declared>maxBytes)throw new Error('Download exceeds the expected size.');
 const chunks=[];let length=0;const reader=response.body?.getReader();
 if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>maxBytes)throw new Error('Download exceeds the expected size.');chunks.push(value);onProgress({received:length,total:size||declared||null,cached:false});}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}}
 else{const bytes=new Uint8Array(await response.arrayBuffer());length=bytes.length;if(length>maxBytes)throw new Error('Download exceeds the expected size.');chunks.push(bytes);}
 if(size&&length!==size)throw new Error('Download size did not match the pinned release.');const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}chunks.length=0;
 if(await digest(bytes)!==sha256)throw new Error('Download SHA-256 did not match. Nothing on the device was changed.');
 try{await cache?.put(key.href,new Response(bytes,{headers:{'Content-Type':'application/octet-stream'}}));}catch{/* Storage pressure must not invalidate verified bytes. */}
 onProgress({received:length,total:length,cached:false});return bytes;
}
