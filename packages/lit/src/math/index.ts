// The maths: r180's math/ classes (MIT, see packages/lit/NOTICE).

export { mathUtils } from "./mathUtils.ts";
export { Vector2 } from "./Vector2.ts";
export type { Vector2Like } from "./Vector2.ts";
export { Vector3 } from "./Vector3.ts";
export type { Vector3Like, ProjectionCamera, SphericalLike, CylindricalLike, RgbLike } from "./Vector3.ts";
export { Vector4 } from "./Vector4.ts";
export type { Vector4Like } from "./Vector4.ts";
export { Matrix3 } from "./Matrix3.ts";
export type { Matrix3Elements } from "./Matrix3.ts";
export { Matrix4 } from "./Matrix4.ts";
export type { Matrix4Elements } from "./Matrix4.ts";
export { Quaternion } from "./Quaternion.ts";
export type { QuaternionLike } from "./Quaternion.ts";
export { Euler } from "./Euler.ts";
export { Color } from "./Color.ts";
export type { ColorRepresentation, HSL, RGB } from "./Color.ts";
export { colorManagement, srgbToLinear, linearToSrgb } from "./ColorManagement.ts";
export type { ColorSpaceDefinition, ColorTransfer, ConvertibleColor } from "./ColorManagement.ts";
export { Box3 } from "./Box3.ts";
export type { BoundsGeometry, BoundsSource, TriangleLike } from "./Box3.ts";
export { Sphere } from "./Sphere.ts";
export { Plane } from "./Plane.ts";
export type { LineLike } from "./Plane.ts";
export { Frustum } from "./Frustum.ts";
export type { CullGeometry, CullObject, CullSprite, FrustumPlanes } from "./Frustum.ts";
export { Ray } from "./Ray.ts";
export type { AttributeLike, ColorSpace, CoordinateSystem, EulerOrder, NumberArray } from "./types.ts";
