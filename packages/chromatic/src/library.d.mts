import {inspectRom} from './cartridge.mjs';
export interface LibraryEntry {sha256:string;name:string;kind:'rom'|'sav';bytes:number;metadata:ReturnType<typeof inspectRom>|null;verification:string;group:string|null;tags:string;source:string;createdAt:string;storage:string}
export function sha256(bytes:Uint8Array):Promise<string>;
export function listEntries():Promise<LibraryEntry[]>;
export function getBytes(entry:LibraryEntry):Promise<Uint8Array>;
export function saveEntry(bytes:Uint8Array,options:{name:string;kind:'rom'|'sav';verification?:string;group?:string;tags?:string;source?:string}):Promise<LibraryEntry>;
export function editEntry(entry:LibraryEntry,name:string,tags:string):Promise<LibraryEntry>;
export function deleteEntry(entry:LibraryEntry):Promise<void>;
export function downloadEntry(entry:LibraryEntry):Promise<void>;
export function importRelease(release:{romUrl:string;romBytes:number;romSha256:string}):Promise<LibraryEntry>;
