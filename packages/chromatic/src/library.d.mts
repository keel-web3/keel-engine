import {inspectRom} from './cartridge.mjs';
export interface LibraryEntry {sha256:string;name:string;kind:'rom'|'sav';bytes:number;metadata:ReturnType<typeof inspectRom>|null;verification:string;group:string|null;backupGroups?:string[];tags:string;source:string;createdAt:string;storage:string;annotation?:{title:string;author:string;version:string;description:string;website:string;license:string;previewImage:string}}
export function sha256(bytes:Uint8Array):Promise<string>;
export function listEntries():Promise<LibraryEntry[]>;
export function getBytes(entry:LibraryEntry):Promise<Uint8Array>;
export function saveEntry(bytes:Uint8Array,options:{name:string;kind:'rom'|'sav';verification?:string;group?:string;tags?:string;source?:string;annotation?:LibraryEntry['annotation']}):Promise<LibraryEntry>;
export function editEntry(entry:LibraryEntry,name:string,tags:string,annotation?:LibraryEntry['annotation']):Promise<LibraryEntry>;
export function deleteEntry(entry:LibraryEntry):Promise<void>;
export function downloadEntry(entry:LibraryEntry):Promise<void>;
export function importRelease(release:{romUrl:string;romBytes:number;romSha256:string;title?:string;creator?:string;revisionLabel?:string;snapshotDate?:string;description?:string;github?:string;license?:string;previewImage?:string}):Promise<LibraryEntry>;
