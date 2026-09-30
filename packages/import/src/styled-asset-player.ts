/** Trusted host adapter for complete glTF scenes. Three r180 owns glTF skinning,
 * materials and animation; KEEL owns the validated recipe, native replay and
 * threshold maps. This is deliberately a tooling subpath, not an on-chain module. */
import { SCREENS } from '@keel-engine/core';
import { importStyledAsset, validateStyledAssetStyle } from './styled-asset.ts';
import type { ImportedStyledAsset, StyledAssetStyle } from './styled-asset.ts';

export const STYLED_PIXEL_FRAGMENT = `
uniform sampler2D sceneTexture;
uniform sampler2D thresholdTexture;
uniform vec2 lowSize;
uniform vec2 tileSize;
uniform float levels;
uniform float ditherStrength;
varying vec2 vUv;
void main(){
  gl_FragColor=texture2D(sceneTexture,vUv);
  gl_FragColor.rgb=gl_FragColor.a>0.0?gl_FragColor.rgb/gl_FragColor.a:vec3(0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 scaled=clamp(gl_FragColor.rgb,0.0,1.0)*(levels-1.0);
  vec2 pixel=min(lowSize-1.0,floor(vUv*lowSize));
  pixel.y=lowSize.y-1.0-pixel.y;
  float threshold=texture2D(thresholdTexture,(mod(pixel,tileSize)+0.5)/tileSize).r;
  vec3 chosen=ditherStrength<0.5?floor(scaled+0.5):(floor(scaled)+(vec3(1.0)-step(fract(scaled),vec3(threshold))));
  gl_FragColor.rgb=(min(vec3(levels-1.0),chosen)/(levels-1.0))*gl_FragColor.a;
}`;

/** CPU reference at logical low-resolution pixel coordinates, straight sRGB.
 * Alpha is unchanged. Rasterization/tone mapping happen before this operation. */
export function styledPixel(rgba: readonly number[], x: number, y: number, input: StyledAssetStyle): [number, number, number, number] {
  const style = validateStyledAssetStyle(input);
  if (rgba.length !== 4 || !rgba.every(n => Number.isFinite(n) && n >= 0 && n <= 1) || !Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Invalid pixel');
  if (style.kind === 'original' || style.kind === 'voxel') return [...rgba] as [number, number, number, number];
  const mod = (n: number) => ((Math.floor(n) % 192) + 192) % 192;
  const threshold = Math.fround(SCREENS[style.screen].at(mod(x), mod(y))), levels = style.toneLevels - 1;
  const rgb = rgba.slice(0, 3).map(v => { const q = v * levels, lo = Math.floor(q); return Math.min(levels, style.kind === 'pixel' ? Math.floor(q + .5) : lo + Number(q - lo > threshold)) / levels; });
  return [rgb[0]!, rgb[1]!, rgb[2]!, rgba[3]!];
}

export interface StyledPlayerHost {
  THREE: any;
  GLTFLoader: any;
  renderer: any;
  asset: ImportedStyledAsset | Uint8Array;
  /** Optional host scene with lights. Otherwise a new scene and neutral lights are created. */
  scene?: any;
  dracoDecoder?: any;
}
export async function createStyledAssetPlayer(host: StyledPlayerHost) {
  const { THREE, renderer } = host;
  if (String(THREE?.REVISION) !== '180') throw new TypeError('KEEL styled player requires Three.js 0.180.0');
  if (!renderer || typeof renderer.render !== 'function') throw new TypeError('A Three renderer is required');
  const asset = host.asset instanceof Uint8Array ? await importStyledAsset(host.asset, { dracoDecoder: host.dracoDecoder }) : host.asset;
  if (asset?.format !== 'KEEL-IMPORTED-STYLED-ASSET' || !(asset.glb instanceof Uint8Array)) throw new TypeError('Use importStyledAsset before playback');
  let style = validateStyledAssetStyle(asset.style);
  const loader = typeof host.GLTFLoader === 'function' ? new host.GLTFLoader() : host.GLTFLoader;
  if (!loader || typeof loader.parseAsync !== 'function') throw new TypeError('Three r180 GLTFLoader is required');
  const gltf = await loader.parseAsync(new Uint8Array(asset.glb).buffer, '');
  const model = gltf.scene, clips = gltf.animations ?? [];
  if (asset.animation.mode === 'static-pose' && clips.length) throw new TypeError('Static voxel geometry cannot contain clips');
  const scene = host.scene ?? new THREE.Scene(); scene.add(model);
  const lights: any[] = [];
  if (!host.scene) {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x444444, 2), sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 5, 4); scene.add(ambient, sun); lights.push(ambient, sun);
  }
  const mixer = new THREE.AnimationMixer(model);
  let action: any = null;
  const play = (clip: number | string = 0) => {
    const selected = typeof clip === 'string' ? clips.find((c: any) => c.name === clip) : clips[clip];
    if (!selected) { if (!clips.length && clip === 0) return null; throw new RangeError('Unknown animation clip'); }
    if (action) action.stop(); action = mixer.clipAction(selected); action.reset().play(); return action;
  };
  if (clips.length) play(0);
  const floating = renderer.extensions?.has('EXT_color_buffer_float') || renderer.extensions?.has('EXT_color_buffer_half_float');
  const target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: floating ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true });
  target.texture.generateMipmaps = false;
  const uniforms = { sceneTexture: { value: target.texture }, thresholdTexture: { value: null as any }, lowSize: { value: new THREE.Vector2(1, 1) }, tileSize: { value: new THREE.Vector2(192, 192) }, levels: { value: style.toneLevels }, ditherStrength: { value: style.kind === 'dither' ? 1 : 0 } };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}', fragmentShader: STYLED_PIXEL_FRAGMENT, depthTest: false, depthWrite: false, toneMapped: true });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material), postScene = new THREE.Scene(), postCamera = new THREE.Camera(); postScene.add(plane);
  let texture: any = null, disposed = false;
  const setStyle = (input: StyledAssetStyle) => {
    const next = validateStyledAssetStyle(input);
    if ((next.kind === 'voxel') !== (asset.style.kind === 'voxel')) throw new TypeError('Changing voxel topology requires importing a new asset');
    const data = new Float32Array(192 * 192);
    for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) data[y * 192 + x] = SCREENS[next.screen].at(x, y);
    texture?.dispose(); texture = new THREE.DataTexture(data, 192, 192, THREE.RedFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.needsUpdate = true;
    uniforms.thresholdTexture.value = texture; uniforms.levels.value = next.toneLevels; uniforms.ditherStrength.value = next.kind === 'dither' ? 1 : 0; style = next;
  };
  setStyle(style);
  const seek = (seconds: number) => { if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Animation time must be nonnegative'); mixer.setTime(seconds); model.updateMatrixWorld(true); };
  const render = (camera: any, frame: { width: number; height: number; time?: number; delta?: number }) => {
    if (disposed) throw new Error('Styled player was disposed');
    for (const n of [frame.width, frame.height]) if (!Number.isInteger(n) || n < 1 || n > 16384) throw new RangeError('Invalid viewport');
    if (frame.time !== undefined) seek(frame.time);
    else if (frame.delta !== undefined) { if (!Number.isFinite(frame.delta) || frame.delta < 0) throw new RangeError('Invalid animation delta'); mixer.update(frame.delta); }
    if (style.kind === 'original' || style.kind === 'voxel') { renderer.render(scene, camera); return; }
    const w = Math.max(1, Math.floor(frame.width / style.pixelSize)), h = Math.max(1, Math.floor(frame.height / style.pixelSize));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    uniforms.lowSize.value.set(w, h);
    const previous = renderer.getRenderTarget();
    try { renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(previous); renderer.render(postScene, postCamera); }
    finally { renderer.setRenderTarget(previous); }
  };
  const dispose = () => {
    if (disposed) return; disposed = true; mixer.stopAllAction(); mixer.uncacheRoot(model); scene.remove(model);
    for (const light of lights) { scene.remove(light); light.dispose?.(); }
    model.traverse((object: any) => { object.geometry?.dispose(); const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []; for (const m of materials) { for (const v of Object.values(m) as any[]) if (v?.isTexture) v.dispose(); m.dispose(); } });
    target.dispose(); texture?.dispose(); plane.geometry.dispose(); material.dispose();
  };
  return { asset, scene, model, clips, mixer, play, seek, setStyle, render, dispose, uniforms, get style() { return { ...style }; }, bounds: new THREE.Box3().setFromObject(model) };
}
