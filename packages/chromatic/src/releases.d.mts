export interface PublishedRelease {romUrl:string;romBytes:number;romSha256:string;title?:string;creator?:string;revisionLabel?:string;snapshotDate?:string;description?:string;github?:string;license?:string;previewImage?:string;cover?:string|null;rtcRomUrl?:string;rtcRomSha256?:string;rtcRomBytes?:number;rtcPreviewImage?:string}
export function releaseVariants(release:PublishedRelease,site:string):(PublishedRelease&{title:string;edition:string;previewImage:string;description:string})[];

export function annotationForRelease(release:PublishedRelease):NonNullable<import('./library.mjs').LibraryEntry['annotation']>;
export function recognizeRelease(bytes:Uint8Array,releases:PublishedRelease[]):Promise<PublishedRelease|null>;
