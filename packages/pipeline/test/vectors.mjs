import { engineVectors } from "../../keel/src/vectors.ts";
export default await engineVectors(import.meta.url, [{
  name: "canonical pipeline options",
  run: ({ PIPELINE_SCHEMA, canonicalJson }) => [PIPELINE_SCHEMA, canonicalJson({ seed: "crucible", profile: { particles: 0, detail: 1 } })],
  expect: ["keel-pipeline@1", "{\"profile\":{\"detail\":1,\"particles\":0},\"seed\":\"crucible\"}"],
}]);
