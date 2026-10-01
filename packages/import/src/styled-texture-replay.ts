/** Lossy color textures reconstructed from compact palette/pattern recipes.
 * The superseded image data is absent from the native recipe. */
import { packAsset, unpackAsset } from './asset-binary-v3.ts';
import { buildFromPackage as replayNative } from './asset-replay-v6.ts';
import { encodePng } from './png.ts';
import { replayStylizedTexture } from './styled-texture-codec.ts';

export const STYLIZED_TEXTURE_FORMAT = 'KEEL-STYLIZED-TEXTURES-V1';
export function nativeTextureTables(recipe: any): { body: any; wrappers: any[] } {
  let body = recipe; const wrappers: any[] = [];
  for (let depth = 0; depth < 8; depth++) {
    if (body?.format === 'KEEL-NATIVE-V5' || body?.format === 'KEEL-NATIVE-V6') { wrappers.push(body); body = body.base; }
    else if (body?.format === 'KEEL-MIXED-PRIMITIVES-V1') body = body.base;
    else if (body?.format === 'KEEL-RAW-TRANSFORM-TRANSPORT-V1') body = body.recipe;
    else break;
  }
  if (body?.format !== 'KEEL-NATIVE-V4' || !Array.isArray(body.native?.base?.images) || !Array.isArray(body.native?.images)) throw Error('Unsupported styled native image layout');
  return { body, wrappers };
}
export function removeStyledSourceImage(recipe: any, image: number): void {
  const { body, wrappers } = nativeTextureTables(recipe);
  if (!Number.isSafeInteger(image) || image < 0 || image >= body.native.base.images.length) throw Error('Invalid styled image owner');
  body.native.base.images[image] = { mimeType: 'image/png', data: null };
  body.native.images = body.native.images.filter((x: any) => x.image !== image);
  for (const wrapper of wrappers) wrapper.images = wrapper.images.filter((x: any) => x.image !== image);
}
export async function replayStyledTexturePackage(bytes: Uint8Array, options: { dracoDecoder?: any } = {}) {
  const recipe = unpackAsset(bytes);
  if (recipe?.format !== STYLIZED_TEXTURE_FORMAT) return replayNative(bytes, options);
  if (recipe.version !== 1 || recipe.mode !== 'stylized-lossy' || !Array.isArray(recipe.images) || recipe.images.length > 4096) throw Error('Invalid stylized texture package');
  const base = structuredClone(recipe.base), { body, wrappers } = nativeTextureTables(base), images = body.native.base.images, seen = new Set<number>();
  let pixels = 0;
  for (const item of recipe.images) {
    const id = item?.image, r = item?.recipe;
    if (!Number.isSafeInteger(id) || id < 0 || id >= images.length || seen.has(id) || images[id]?.mimeType !== 'image/png' || images[id]?.data !== null || body.native.images.some((x: any) => x.image === id) || wrappers.some(w => w.images.some((x: any) => x.image === id))) throw Error('Invalid or overlapping stylized texture owner');
    seen.add(id);
    if (!Number.isSafeInteger(r?.width) || !Number.isSafeInteger(r?.height) || r.width < 1 || r.height < 1 || r.width > 512 || r.height > 512 || (pixels += r.width * r.height) > 16 * 1024 * 1024) throw Error('Stylized texture pixel budget exceeded');
  }
  for (const item of recipe.images) {
    const pixels = replayStylizedTexture(item.recipe);
    const data = encodePng({ width: pixels.width, height: pixels.height, data: pixels.rgba });
    images[item.image] = { mimeType: 'image/png', data: { codec: 'raw', parameters: { version: 1 }, sourceLength: data.length, data } };
  }
  return replayNative(packAsset(base), options);
}
