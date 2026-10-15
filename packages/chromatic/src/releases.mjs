import {sha256} from './library.mjs';
export function releaseVariants(release,site){
 const title=release.title||`${site.toUpperCase()}.EXE`;
 const standard={...release,title,edition:'Standard',previewImage:release.previewImage||release.cover||'',description:release.description||'Game Boy Color homebrew by '+(release.creator||'Ravonus')};
 const result=[standard];
 if(release.rtcRomUrl&&release.rtcRomSha256&&release.rtcRomBytes)result.push({...standard,title:title+' · RTC',edition:'Hardware clock',romUrl:release.rtcRomUrl,romSha256:release.rtcRomSha256,romBytes:release.rtcRomBytes,previewImage:release.rtcPreviewImage||standard.previewImage,description:'Hardware-clock edition for an MBC3 cartridge with RTC. Uses the same game content as the standard edition.'});
 return result;
}

export function annotationForRelease(release){return {title:release.title||'',author:release.creator||'',version:release.revisionLabel||release.snapshotDate||'',description:release.description||'',website:release.github||'',license:release.license||'',previewImage:release.previewImage?new URL(release.previewImage,globalThis.location?.href||'https://egress.onkeel.io/').href:''};}
export async function recognizeRelease(bytes,releases){for(const release of releases)if(bytes.length>=release.romBytes&&await sha256(bytes.subarray(0,release.romBytes))===release.romSha256)return release;return null;}
