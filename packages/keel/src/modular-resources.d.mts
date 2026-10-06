import type {BuildResult, TransformOptions, TransformResult} from 'esbuild';
import type ts from 'typescript';

/** Build tools only. Factories execute once after all verified registrations. */
export function createStaticModuleRuntime(namespace?: string, options?: {sharedHelpers?: boolean}): string;
export const MODULE_RUNTIME: string;
export interface StaticModuleResource {
  id: string;
  path: string;
  bytes: Buffer;
  dependencies: string[];
  sources: string[];
  exports: string[];
  sha256: string;
  linkageOnly?: boolean;
  modules?: {id: string; exports: string[]}[];
}
export interface ModularOutputOptions {
  result: BuildResult;
  transform: (source: string, options: TransformOptions) => Promise<TransformResult>;
  compact: (source: string) => Promise<string>;
  typescript: typeof ts;
  roots: Record<string, string>;
  workingDir: string;
  entryIds: Map<string, string>;
  rootEntryIds?: string[];
  boundaryIds?: Map<string, string>;
  namespace?: string;
  modulePrefix?: string;
  sharedHelpers?: boolean;
 publicationGroupBy?: (resource: StaticModuleResource) => string | null | undefined;
}
export function packageModularOutputs(options: ModularOutputOptions): Promise<StaticModuleResource[]>;
export function assertModuleRevision(previous: Pick<StaticModuleResource, 'id' | 'exports' | 'dependencies' | 'sha256' | 'modules'>[], next: Pick<StaticModuleResource, 'id' | 'exports' | 'dependencies' | 'sha256' | 'modules'>[]): string[];

export function groupModuleResources(resources: StaticModuleResource[], groupBy: NonNullable<ModularOutputOptions["publicationGroupBy"]>): StaticModuleResource[];

export function collectModuleOutputs(outputs: Map<string, {imports: {path: string; external?: boolean}[]}>, roots: string[], workingDir: string): Set<string>;

export function shareCommonJsHelpers(source: string, typescript: unknown): {parameter:string;code:string}|null;
