// The KEEL build for engine modules and games (see README): workspace discovery,
// bundling a package into a KEEL browser module, and a game's local document.
export { ENGINE_PREFIX, ENGINE_ROOT, GROUPS, SDK_PREFIX, SDK_ROOT, moduleForImport, readProject, readWorkspace, schemasOf, withSchemas } from "./workspace.ts";
// The engine as KEEL verified modules (the SDK's `keel module` pipeline).
export { ENGINE_REPOSITORY, LINK_SCHEMA, MODULE_ENTRY, RUNTIME_ENTRY, engineModuleFiles, entryFor, linkRecord, linkedSpecifiers, pipelineManifest, pipelineName } from "./link.ts";
export type { LinkRecord, ModuleFiles } from "./link.ts";
export { buildVerifiedModule, dependencyOrder, localEngineModules, prepareModule, readVerifiedModule, staleFiles, testVerifiedModule, verifyFromGitHub, writeModuleFiles } from "./pipeline.ts";
export type { BuildOptions, GitHubVerification, ModuleTest, PrepareOptions, PreparedModule, VerifiedModule } from "./pipeline.ts";
export { ENGINE_CATALOG_FILE, ENGINE_CATALOG_SCHEMA, buildCatalog, catalogEntry, catalogText, writeCatalog } from "./catalog.ts";
export type { EngineCatalog, EngineCatalogEntry, EngineDeployment, IndexOptions } from "./catalog.ts";
export { publishPlan, publishPlanText } from "./plan.ts";
export type { ModulePublication, PublishPlan } from "./plan.ts";
export * from "./resolver.ts";
export type { WorkspaceModule } from "./workspace.ts";
export { bundleModule } from "./bundle.ts";
export type { BundledModule, BundleOptions } from "./bundle.ts";
export { buildGameDocument, closureOf, keelAudioScripts, resolveModules } from "./document.ts";
export type { DocumentOptions, GameDocument, ModuleReport, PageScript } from "./document.ts";
export { run as runCli } from "./cli.ts";
