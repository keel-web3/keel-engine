// keel/lit's public API: r180's scene core under KEEL's names (MIT, see NOTICE).
//
// The classes keep r180's `is*` flags as own `true` properties, because the
// renderer (and r180's own maths, e.g. Box3.expandByObject) branch on them.
// Where KEEL renames a class, it carries both r180's flag and one in KEEL's
// name, side by side:
//
//   Node        isObject3D + isNode             Stage            isScene + isStage
//   Mesh        isMesh                          Instances        isMesh + isInstancedMesh + isInstances
//   Billboard   isSprite + isBillboard          Group            isGroup
//   Camera      isCamera                        PerspectiveCamera isCamera + isPerspectiveCamera
//   OrthoCamera isCamera + isOrthographicCamera + isOrthoCamera
//   Light       isLight                         AmbientLight     isLight + isAmbientLight
//   SunLight    isLight + isDirectionalLight + isSunLight
//   SkyLight    isLight + isHemisphereLight + isSkyLight
//   SunShadow   isDirectionalLightShadow + isSunShadow
//   Geometry    isBufferGeometry + isGeometry   Attribute        isBufferAttribute + isAttribute
//   InstanceAttribute  isBufferAttribute + isAttribute + isInstancedBufferAttribute + isInstanceAttribute
//   Material    isMaterial                      LitMaterial      isMeshStandardMaterial + isLitMaterial
//   ToonMaterial isMeshToonMaterial + isToonMaterial   FlatMaterial  isMeshBasicMaterial + isFlatMaterial
//   BillboardMaterial isSpriteMaterial + isBillboardMaterial
//   CustomMaterial    isShaderMaterial + isCustomMaterial
//   DepthMaterial     isMeshDepthMaterial + isDepthMaterial
//   DistanceMaterial  isMeshDistanceMaterial + isDistanceMaterial
//   Texture isTexture, DataTexture isDataTexture, CanvasTexture isCanvasTexture, DepthTexture isDepthTexture
//   RenderTarget isRenderTarget + isWebGLRenderTarget   Fog isFog, FogExp2 isFogExp2, Source isSource
//
// `type` strings are KEEL's names: "Node", "Group", "Stage", "Mesh",
// "Instances", "Billboard", "Camera", "PerspectiveCamera", "OrthoCamera",
// "Light", "AmbientLight", "SunLight", "SkyLight", "Geometry", "Material",
// "LitMaterial", "ToonMaterial", "FlatMaterial", "BillboardMaterial",
// "CustomMaterial", "DepthMaterial", "DistanceMaterial". (r180's program
// library is keyed by material type: MeshStandardMaterial -> physical is
// LitMaterial -> "lit" here, and so on.)

export * from "./math/index.ts";

export * from "./constants.ts";

// ---- core
export { Emitter } from "./core/Emitter.ts";
export type { EmitterEvent, Listener } from "./core/Emitter.ts";
export { Layers } from "./core/Layers.ts";
export { Attribute, InstanceAttribute } from "./core/Attribute.ts";
export type { AttributeArray, UpdateRange } from "./core/Attribute.ts";
export { Geometry } from "./core/Geometry.ts";
export type { GeometryGroup, DrawRange } from "./core/Geometry.ts";
export { Node } from "./core/Node.ts";
export type { DrawGroup } from "./core/Node.ts";

// ---- geometry
export * from "./geometry/index.ts";

// ---- scene
export { Group } from "./scene/Group.ts";
export { Stage } from "./scene/Stage.ts";
export { Fog, FogExp2 } from "./scene/Fog.ts";
export { Mesh } from "./scene/Mesh.ts";
export { Instances } from "./scene/Instances.ts";
export { Billboard } from "./scene/Billboard.ts";
export { Camera } from "./scene/Camera.ts";
export type { CameraView } from "./scene/Camera.ts";
export { PerspectiveCamera } from "./scene/PerspectiveCamera.ts";
export { OrthoCamera } from "./scene/OrthoCamera.ts";
export { Light, AmbientLight, SkyLight } from "./scene/Light.ts";
export { SunLight } from "./scene/SunLight.ts";
export { LightShadow, SunShadow } from "./scene/LightShadow.ts";
export type { ShadowCaster } from "./scene/LightShadow.ts";

// ---- materials
export { Material } from "./material/Material.ts";
export type { CompileShader, MaterialParameters } from "./material/Material.ts";
export { LitMaterial } from "./material/LitMaterial.ts";
export { ToonMaterial } from "./material/ToonMaterial.ts";
export { FlatMaterial } from "./material/FlatMaterial.ts";
export { BillboardMaterial } from "./material/BillboardMaterial.ts";
export { CustomMaterial } from "./material/CustomMaterial.ts";
export type { ShaderExtensions, UniformsGroupLike } from "./material/CustomMaterial.ts";
export { DepthMaterial } from "./material/DepthMaterial.ts";
export { DistanceMaterial } from "./material/DistanceMaterial.ts";

// ---- textures
export { Source } from "./texture/Source.ts";
export type { DataImage, SizeImage, TextureImage } from "./texture/Source.ts";
export { Texture } from "./texture/Texture.ts";
export { DataTexture } from "./texture/DataTexture.ts";
export { CanvasTexture } from "./texture/CanvasTexture.ts";
export { DepthTexture } from "./texture/DepthTexture.ts";
export { RenderTarget } from "./texture/RenderTarget.ts";
export type { RenderTargetOptions } from "./texture/RenderTarget.ts";

// ---- the renderer
export { createLitRenderer } from "./gl/renderer.ts";
export type { LitRenderer, LitRendererOptions } from "./gl/renderer.ts";
