/** FNV-1a over UTF-16 code units. This preserves existing KEEL seeds, including surrogate pairs. */
export function fnv1a32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** The same bits interpreted as a signed integer, for existing city seed contracts. */
export const fnv1a32Signed = (text: string): number => fnv1a32(text) | 0;
/** Vehicle trait hashing: FNV-1a over seed|tag followed by the existing avalanche. */
export function seedTagHash(seed: string, tag: string): number {
  let h = fnv1a32(seed + "|" + tag);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
