import type { GenerateOptions, GeneratorKind } from "./generate.ts";
import type { VoxelModel } from "./voxels.ts";

/** Private provenance, never an instruction supplied by an uploaded model. */
export interface GeneratorRecord { kind: GeneratorKind; seed: string; options: GenerateOptions; baseline: VoxelModel }
export const generatorRecords = new WeakMap<VoxelModel, GeneratorRecord>();
