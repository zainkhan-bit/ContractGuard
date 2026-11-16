export {
  adHocSpecId,
  CONFIG_FILE_NAMES,
  discoverConfig,
  findGitRoot,
  loadConfiguration,
  type CliOverrides,
  type ConfigRequest,
  type LoadedConfiguration,
  type Trust,
} from './config/load.js';
export {
  CONFIG_KEYS,
  configJsonSchema,
  parseConfigFile,
  parseSize,
  type ConfigFile,
  type ConfigIssue,
} from './config/schema.js';
export { didYouMean, editDistance } from './text.js';
export { analyze, type AnalysisRequest, type AnalysisRun, type ExitOutcome } from './analyze.js';
export { defaultBranch, gitUri, GitSourceLoader, resolveGitSource, type ResolvedGitSource } from './sources/git.js';
export { openSource, STDIN_URI, type OpenedSource } from './sources/open.js';
export {
  buildSnapshot,
  openSnapshot,
  SNAPSHOT_FORMAT,
  type OpenedSnapshot,
  type Snapshot,
} from './sources/snapshot.js';
export { describeSpecifier, isSafeGitRef, parseSourceSpecifier, type SourceSpecifier } from './sources/specifier.js';
export { createBaseline, validateSource, type SourceOptions, type ValidatedSpec } from './usecases.js';
