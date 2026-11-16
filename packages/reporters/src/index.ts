export { renderConsole, wrap, type ConsoleOptions } from './console.js';
export { renderJson, REPORT_SCHEMA_ID } from './json.js';
export { GITHUB_SUMMARY_LIMIT, renderMarkdown, type MarkdownOptions } from './markdown.js';
export { renderSarif, SARIF_SCHEMA, type SarifOptions } from './sarif.js';
export {
  affectedText,
  displayPath,
  groupFindings,
  locationLink,
  locationText,
  summaryLine,
  toJsonText,
  verdictText,
  type FindingGroup,
  type RenderOptions,
} from './shared.js';
