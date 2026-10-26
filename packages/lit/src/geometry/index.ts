// The geometry: r180's generators, shapes, curves and triangulation (MIT, see packages/lit/NOTICE).

// ---- generators (functions returning a Geometry; r180's parameters in r180's order)
export { generated } from "./generated.ts";
export type { Generated } from "./generated.ts";
export { box } from "./box.ts";
export type { BoxParameters } from "./box.ts";
export { cylinder, cone } from "./cylinder.ts";
export type { CylinderParameters, ConeParameters } from "./cylinder.ts";
export { sphere } from "./sphere.ts";
export type { SphereParameters } from "./sphere.ts";
export { polyhedron, icosahedron, octahedron, dodecahedron, tetrahedron } from "./polyhedron.ts";
export type { PolyhedronParameters, PlatonicParameters } from "./polyhedron.ts";
export { plane } from "./plane.ts";
export type { PlaneParameters } from "./plane.ts";
export { ring } from "./ring.ts";
export type { RingParameters } from "./ring.ts";
export { torus } from "./torus.ts";
export type { TorusParameters } from "./torus.ts";
export { tube } from "./tube.ts";
export type { TubeParameters, TubeGeometry } from "./tube.ts";
export { lathe } from "./lathe.ts";
export type { LatheParameters } from "./lathe.ts";
export { extrude, worldUVGenerator } from "./extrude.ts";
export type { ExtrudeOptions, ExtrudeParameters, UVGenerator } from "./extrude.ts";
export { shape } from "./shapeGeometry.ts";
export type { ShapeParameters } from "./shapeGeometry.ts";

// ---- curves, paths and shapes
export { Curve } from "./Curve.ts";
export type { CurveVector, FrenetFrames } from "./Curve.ts";
export { CurvePath } from "./CurvePath.ts";
export { Path } from "./Path.ts";
export { Shape } from "./Shape.ts";
export { LineCurve } from "./LineCurve.ts";
export { LineCurve3 } from "./LineCurve3.ts";
export { QuadraticBezierCurve } from "./QuadraticBezierCurve.ts";
export { QuadraticBezierCurve3 } from "./QuadraticBezierCurve3.ts";
export { CubicBezierCurve } from "./CubicBezierCurve.ts";
export { CubicBezierCurve3 } from "./CubicBezierCurve3.ts";
export { EllipseCurve } from "./EllipseCurve.ts";
export { ArcCurve } from "./ArcCurve.ts";
export { SplineCurve } from "./SplineCurve.ts";
export { CatmullRomCurve3 } from "./CatmullRomCurve3.ts";
export type { CatmullRomCurveType } from "./CatmullRomCurve3.ts";
export * as interpolations from "./Interpolations.ts";

// ---- triangulation
export { shapeUtils } from "./shapeUtils.ts";
export { earcut, earcutDeviation, Earcut } from "./earcut.ts";
