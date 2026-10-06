/** What each stored form is written as now, and the older forms still read. */
export const STORE_FORMAT = Object.freeze({
  voxels: "keel/builder/voxels@1",
  voxelsText: "KC1",
  ops: "keel/builder/ops@1",
  data: "keel/builder/data@1",
  reads: Object.freeze(["KV1", "J1"] as const),
} as const);

