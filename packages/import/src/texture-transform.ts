/** KHR_texture_transform is per textureInfo, not per texture or image.
 * https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_texture_transform
 */
export const TEXTURE_TRANSFORM = 'KHR_texture_transform';
export const TEXTURE_INFO_PATH = /^\/materials\/\d+\/(?:pbrMetallicRoughness\/(?:baseColorTexture|metallicRoughnessTexture)|normalTexture|occlusionTexture|emissiveTexture)$/;
export interface TextureTransform {
  readonly offset: readonly [number, number];
  readonly rotation: number;
  readonly scale: readonly [number, number];
  readonly texCoord?: number;
}
type Fail = (message: string) => never;
const failTransform: Fail = message => { throw new Error(message); };
export function readTextureTransform(value: any, fail: Fail = failTransform): TextureTransform {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(`invalid ${TEXTURE_TRANSFORM} object`);
  const pair = (key: string, fallback: readonly [number, number]): readonly [number, number] => {
    const p = value[key];
    if (p === undefined) return fallback;
    if (!Array.isArray(p) || p.length !== 2 || !p.every(v => typeof v === 'number' && Number.isFinite(v))) return fail(`invalid ${TEXTURE_TRANSFORM} ${key}`);
    return [p[0], p[1]];
  };
  const rotation = value.rotation ?? 0;
  if (typeof rotation !== 'number' || !Number.isFinite(rotation) || value.rotation === null) fail(`invalid ${TEXTURE_TRANSFORM} rotation`);
  if (value.texCoord !== undefined && (!Number.isSafeInteger(value.texCoord) || value.texCoord < 0)) fail(`invalid ${TEXTURE_TRANSFORM} texCoord`);
  if (value.extensions !== undefined && (!value.extensions || typeof value.extensions !== 'object' || Array.isArray(value.extensions) || Object.keys(value.extensions).length)) fail(`unsupported nested ${TEXTURE_TRANSFORM} extensions`);
  return { offset: pair('offset', [0, 0]), rotation, scale: pair('scale', [1, 1]), ...(value.texCoord === undefined ? {} : { texCoord: value.texCoord }) };
}
export function materialTextureInfos(material: any): any[] {
  return [material?.pbrMetallicRoughness?.baseColorTexture, material?.pbrMetallicRoughness?.metallicRoughnessTexture, material?.normalTexture, material?.occlusionTexture, material?.emissiveTexture].filter(info => info !== undefined);
}
