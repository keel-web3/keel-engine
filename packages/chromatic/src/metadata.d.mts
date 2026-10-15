import type {LibraryEntry} from './library.mjs';
export function normalizeAnnotation(value?:unknown):NonNullable<LibraryEntry['annotation']>;
export function parseMetadata(text:string,sha256:string):NonNullable<LibraryEntry['annotation']>;
export function downloadMetadata(entry:LibraryEntry):void;
