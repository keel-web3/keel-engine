// @keel-engine/camera: camera rigs (orbit, chase, first, frame, rail, fixed),
// blends between them, shake, a landing's nod, the fov kick, arm collision
// against the physics' solids, and saved state. Names as in the proof of
// concept's src/camera/camera.js.

export {
  SKIN, alongPath, armPath, boundsOf, chaseRig, clearance, createCamera, dirOf, fillForTarget, firstRig, fixedRig, fovForTarget, frameRig, frameView, normalAt,
  orbitRig, railRig, sphereCast, subjectOf,
} from "./camera.ts";
export type {
  ArmPath, Blend, BodyLike, Bounds6, BuiltinMode, Camera, CameraLike, CameraMode, CameraOptions, CameraState, CameraWorld, ChaseOptions, ChaseRig, ChaseState,
  FirstOptions, FirstRig, FirstState, FixedOptions, FrameOptions, FrameRig, FrameState, FrameViewOptions, FrameViewResult, LookInput, OrbitOptions, OrbitRig,
  OrbitState, RailKey, RailOptions, RailRig, RailState, Rig, RigView, Rigs, ShakeOptions, Subject, View,
} from "./camera.ts";
// Car cameras: chase (lagging through corners, pulling back with speed), hood and bumper.
export { BONNET_LEAST, BONNET_MOST, bonnetCrest, createCarCamera, createCrest, mirrorShot } from "./car.ts";
export type { CarCamera, CarCameraMode, CarCameraOptions, CarLens, CarPose, CarShot, CrestBuilder, CrestMesh } from "./car.ts";
