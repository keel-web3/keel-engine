import { engineVectors } from "../../keel/src/vectors.ts";
export default await engineVectors(import.meta.url, [{
  name: "age and device quality intersect",
  run: ({ AGE_SCHEMA, DEVICE_SCHEMA, resolveTarget }) => {
    const quality = { detail: 0, meshDetail: "low", views: 4, phases: 4, variants: 1, particles: 0 };
    return resolveTarget({ schema: AGE_SCHEMA, id: "early", name: "Early", quality, renderers: ["frames", "program"], surfaces: 1, stereo: false, input: [] },
      { schema: DEVICE_SCHEMA, id: "phone", quality: { ...quality, detail: 2, meshDetail: "high", particles: 100 }, renderers: ["program"], surfaces: 1, stereo: false, input: ["touch"], budget: { objectBytes: 1024, bundleBytes: 4096 } });
  },
  expect: { schema: "keel-target-plan@1", age: "early", device: "phone", renderer: "program", quality: { detail: 0, meshDetail: "low", views: 4, phases: 4, variants: 1, particles: 0 }, surfaces: 1, stereo: false, budget: { objectBytes: 1024, bundleBytes: 4096 }, reduced: [] },
}]);
