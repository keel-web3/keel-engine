import {normalizeAnnotation} from './metadata.mjs';
import {inspectRom} from './cartridge.mjs';
const DATABASE = 'keel-chromatic-library-v1';
export async function sha256(bytes) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');}
function request(req) {return new Promise((resolve, reject) => {req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);});}
async function database() {
  const req = indexedDB.open(DATABASE, 1);
  req.onupgradeneeded = () => {req.result.createObjectStore('entries', {keyPath: 'sha256'}); req.result.createObjectStore('bytes');};
  const db = await request(req); db.onversionchange = () => db.close(); return db;
}
async function transact(stores, mode, run) {
  const db = await database();
  try {return await new Promise((resolve, reject) => {const tx = db.transaction(stores, mode); let result; tx.oncomplete = () => resolve(result); tx.onabort = tx.onerror = () => reject(tx.error || new Error('Local storage transaction failed.')); result = run(tx);});} finally {db.close();}
}
async function root() {if (!navigator.storage?.getDirectory) return null; return (await navigator.storage.getDirectory()).getDirectoryHandle('chromatic-blobs', {create: true});}
export async function listEntries() {
  const db = await database(); try {const entries = await request(db.transaction('entries').objectStore('entries').getAll()); return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));} finally {db.close();}
}
export async function getBytes(entry) {
  let bytes;
  if (entry.storage === 'opfs') {const dir = await root(); if (!dir) throw new Error('This browser cannot open the stored file.'); bytes = new Uint8Array(await (await (await dir.getFileHandle(entry.sha256)).getFile()).arrayBuffer());}
  else {const db = await database(); try {bytes = await request(db.transaction('bytes').objectStore('bytes').get(entry.sha256));} finally {db.close();}}
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.bytes || await sha256(bytes) !== entry.sha256) throw new Error('The stored file did not verify. Do not use it for restoration.');
  return bytes;
}
export async function saveEntry(bytes, {name, kind, verification = 'file-hash', group = null, tags = '', source = 'local-file', annotation} = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 64 * 1048576) throw new Error('Choose a nonempty file of at most 64 MiB.');
  if (!['rom', 'sav'].includes(kind)) throw new Error('Choose a Game Boy ROM or save file.');
  const metadata = kind === 'rom' ? inspectRom(bytes) : null;
  if (source !== 'cartridge-backup' && metadata && (!metadata.headerChecksumValid || metadata.oversized || !metadata.declaredBytes)) throw new Error('The ROM header or declared size is invalid. The file was not imported.');
  const hash = await sha256(bytes), existing = (await listEntries()).find(e => e.sha256 === hash);
  if (existing) {
    await getBytes(existing);
    let result=existing;
    if(group){result={...result,backupGroups:[...new Set([...(result.backupGroups||[]),...(result.group?[result.group]:[]),group])]};await transact(['entries'],'readwrite',tx=>tx.objectStore('entries').put(result));}
    if(annotation){const current=normalizeAnnotation(result.annotation),provided=normalizeAnnotation(annotation);for(const key of Object.keys(current))if(!current[key])current[key]=provided[key];return editEntry(result,result.source==='site-release'?name||result.name:result.name,result.tags,current);}
    return result;
  }
  const entry = {sha256: hash, name: String(name || metadata?.title || 'Local file').slice(0, 120), kind, bytes: bytes.byteLength, metadata, verification, group, backupGroups:group?[group]:[], tags: String(tags).slice(0, 240), source, createdAt: new Date().toISOString(), storage: 'indexeddb',...(annotation?{annotation:normalizeAnnotation(annotation)}:{})};
  let dir = null;
  if (bytes.byteLength >= 4 * 1048576) {
    dir = await root();
    if (dir) {try {const handle = await dir.getFileHandle(hash, {create: true}); const stream = await handle.createWritable(); try {await stream.write(bytes); await stream.close();} catch (e) {await stream.abort().catch(() => {}); throw e;} entry.storage = 'opfs'; await getBytes(entry);} catch (e) {await dir.removeEntry(hash).catch(() => {}); throw e;}}
  }
  try {
    await transact(['entries', 'bytes'], 'readwrite', tx => {if (entry.storage === 'indexeddb') tx.objectStore('bytes').put(bytes, hash); tx.objectStore('entries').put(entry);});
    await getBytes(entry); return entry;
  } catch (e) {await deleteEntry(entry).catch(() => {}); throw e;}
}
export async function editEntry(entry, name, tags, annotation=entry.annotation) {
  const updated = {...entry, name: String(name).trim().slice(0, 120) || entry.name, tags: String(tags).slice(0, 240),annotation:normalizeAnnotation(annotation)};
  await transact(['entries'], 'readwrite', tx => tx.objectStore('entries').put(updated)); return updated;
}
export async function deleteEntry(entry) {
  await transact(['entries', 'bytes'], 'readwrite', tx => {tx.objectStore('entries').delete(entry.sha256); tx.objectStore('bytes').delete(entry.sha256);});
  if (entry.storage === 'opfs') {const dir = await root(); await dir?.removeEntry(entry.sha256).catch(() => {});}
}
export async function downloadEntry(entry) {
  const bytes = await getBytes(entry), url = URL.createObjectURL(new Blob([bytes], {type: 'application/octet-stream'}));
  const a = document.createElement('a'); a.href = url; a.download = entry.name.replace(/[^a-z0-9._ -]/gi, '_') + (entry.kind === 'rom' ? '.gbc' : '.sav'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function importRelease(release) {
  const url = new URL(release.romUrl, location.href); if (url.origin !== location.origin) throw new Error('The release ROM must come from this site.');
  const response = await fetch(url); if (!response.ok) throw new Error('The release ROM could not be downloaded.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== release.romBytes || await sha256(bytes) !== release.romSha256) throw new Error('The download does not match the published release hash.');
  return saveEntry(bytes, {kind: 'rom', name: release.title || 'Current site release', source: 'site-release',annotation:{title:release.title||'',author:release.creator||'',version:release.revisionLabel||release.snapshotDate||'',description:release.description||'',website:release.github||'',license:release.license||'',previewImage:release.previewImage?new URL(release.previewImage,location.href).href:''}});
}
