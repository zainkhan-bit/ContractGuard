import { readFileSync } from 'node:fs';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  analyze,
  createBaseline,
  defaultBranch,
  didYouMean,
  loadConfiguration,
  validateSource,
  type CliOverrides,
} from '@contractguard/app';
import type { AnalysisResult, Classification, Diagnostic, ReportFormat, Severity } from '@contractguard/core';
import { explainRule, RULES } from '@contractguard/engine';
import { displayPath, renderConsole, renderJson, renderMarkdown, renderSarif } from '@contractguard/reporters';

/** Stable exit codes (§12.4). */
export const EXIT = { ok: 0, policyFailed: 1, input: 2, usage: 3, internal: 4, interrupted: 130 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface CliIo {
  readonly stdout: { write(text: string): unknown; readonly isTTY?: boolean; readonly columns?: number };
  readonly stderr: { write(text: string): unknown; readonly isTTY?: boolean };
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  /** Reads all of stdin (only called when a specifier is "-"). */
  readStdin(): Promise<string>;
  readonly signal?: AbortSignal;
  /** Today's date (YYYY-MM-DD). */
  readonly today: string;
}

interface Opt {
  readonly type: 'string' | 'boolean';
  readonly short?: string;
  readonly multiple?: boolean;
  readonly help: string;
  readonly arg?: string;
}

interface Command {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  readonly options: Readonly<Record<string, Opt>>;
  readonly minPositionals: number;
  readonly maxPositionals: number;
  run(values: Values, positionals: readonly string[], io: CliIo): Promise<ExitCode>;
}

type Values = Readonly<Record<string, string | boolean | readonly (string | boolean)[] | undefined>>;

const GLOBAL: Readonly<Record<string, Opt>> = {
  help: { type: 'boolean', short: 'h', help: 'Show help' },
  quiet: { type: 'boolean', short: 'q', help: 'Only print errors and machine output' },
  verbose: { type: 'boolean', short: 'v', help: 'Print more detail (all findings, warnings)' },
  debug: { type: 'boolean', help: 'Print stack traces for internal errors' },
  color: { type: 'boolean', help: 'Force coloured output' },
  'no-color': { type: 'boolean', help: 'Disable coloured output (also NO_COLOR)' },
};

const CONFIG_OPTS: Readonly<Record<string, Opt>> = {
  config: {
    type: 'string',
    short: 'c',
    arg: 'file',
    help: 'Configuration file (default: discover .contractguard.yaml)',
  },
  'no-config': { type: 'boolean', help: 'Do not read a configuration file' },
};

function version(): string {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
      .version;
  } catch {
    return '0.0.0';
  }
}

const list = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    : [];

class UsageError extends Error {}

function oneOf<T extends string>(name: string, value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    const s = typeof value === 'string' ? didYouMean(value, allowed) : undefined;
    throw new UsageError(
      `--${name} must be one of ${allowed.join(', ')}${s === undefined ? '' : ` (did you mean "${s}"?)`}`,
    );
  }
  return value as T;
}

const CLASSIFICATIONS: readonly Classification[] = [
  'breaking',
  'potentially-breaking',
  'undetermined',
  'non-breaking',
  'informational',
];
const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const FORMATS: readonly ReportFormat[] = ['console', 'markdown', 'json', 'sarif'];
const EXT: Readonly<Record<Exclude<ReportFormat, 'console'>, string>> = {
  markdown: 'md',
  json: 'json',
  sarif: 'sarif',
};

function useColor(values: Values, io: CliIo, ci: boolean, stream: { readonly isTTY?: boolean }): boolean {
  if (values['no-color'] === true) return false;
  if (values['color'] === true) return true;
  if (io.env['NO_COLOR'] !== undefined && io.env['NO_COLOR'] !== '') return false;
  if (io.env['FORCE_COLOR'] !== undefined && io.env['FORCE_COLOR'] !== '0') return true;
  return !ci && stream.isTTY === true;
}

function level(values: Values, io: CliIo): 'quiet' | 'normal' | 'verbose' | 'debug' {
  if (values['debug'] === true) return 'debug';
  if (values['quiet'] === true) return 'quiet';
  if (values['verbose'] === true) return 'verbose';
  const env = io.env['CONTRACTGUARD_LOG_LEVEL'];
  return env === 'quiet' || env === 'verbose' || env === 'debug' ? env : 'normal';
}

/** `file:line:col  severity  CODE  message (hint)` */
export function formatDiagnostic(d: Diagnostic, cwd: string): string {
  const where =
    d.location === undefined
      ? ''
      : `${displayPath(d.location.uri, `file://${cwd}`)}${d.location.range === undefined ? '' : `:${String(d.location.range.start.line)}:${String(d.location.range.start.column)}`}  `;
  return `${where}${d.severity}  ${d.code}  ${d.side === undefined ? '' : `[${d.side}] `}${d.message}${d.hint === undefined ? '' : ` (${d.hint})`}`;
}

function printDiagnostics(ds: readonly Diagnostic[], io: CliIo, lvl: string): void {
  for (const d of ds) {
    if (d.severity !== 'error' && lvl === 'quiet') continue;
    io.stderr.write(`${formatDiagnostic(d, io.cwd)}\n`);
  }
}

const exitForDiagnostics = (ds: readonly Diagnostic[]): ExitCode =>
  ds.some((d) => d.severity === 'error' && d.category === 'configuration') ? EXIT.usage : EXIT.input;

// ------------------------------------------------------------------ commands

const check: Command = {
  name: 'check',
  usage: 'contractguard check [base] [candidate] [options]',
  summary: 'Compare specifications and apply the compatibility policy',
  minPositionals: 0,
  maxPositionals: 2,
  options: {
    ...CONFIG_OPTS,
    spec: { type: 'string', multiple: true, arg: 'id', help: 'Only run the configured spec with this id (repeatable)' },
    perspective: { type: 'string', short: 'p', arg: 'id', help: 'Compatibility perspective (provider-backward)' },
    format: { type: 'string', short: 'f', arg: 'list', help: 'Report formats: console,markdown,json,sarif' },
    'output-dir': {
      type: 'string',
      short: 'o',
      arg: 'dir',
      help: 'Directory for report files (default .contractguard/reports)',
    },
    stdout: { type: 'string', arg: 'format', help: 'Print one machine format (json, sarif, markdown) to stdout' },
    'fail-on': { type: 'string', arg: 'list', help: 'Classifications that fail the policy (default breaking)' },
    'min-severity': { type: 'string', arg: 'sev', help: 'Findings below this severity never fail the policy' },
    undetermined: { type: 'string', arg: 'mode', help: 'fail | review | ignore (default review)' },
    'no-fail': { type: 'boolean', help: 'Exit 0 after a completed analysis even if the policy fails' },
    ci: { type: 'boolean', help: 'CI mode (default when CI=true): no colour, writes files, trust rules' },
    'allow-remote-references': { type: 'boolean', help: 'Trust references.allowRemote from the config in CI mode' },
    'allow-invalid-spec': { type: 'boolean', help: 'Continue past specification errors (run marked degraded)' },
    'group-by': { type: 'string', arg: 'cause|operation', help: 'Grouping for console and Markdown' },
    'include-equivalent': { type: 'boolean', help: 'Report equivalent representation changes' },
    'sarif-all': { type: 'boolean', help: 'Include non-breaking and informational findings in SARIF' },
    deterministic: { type: 'boolean', help: 'Omit timestamps (byte-stable reports)' },
  },
  async run(values, positionals, io) {
    if (positionals.length === 1)
      throw new UsageError('check needs both <base> and <candidate>, or none (use the configuration)');
    const lvl = level(values, io);
    const ci = values['ci'] === true || io.env['CI'] === 'true';
    const stdoutFormat = oneOf('stdout', values['stdout'], ['json', 'sarif', 'markdown'] as const);
    const formats =
      values['format'] === undefined
        ? undefined
        : list(values['format']).map((f) => oneOf('format', f, FORMATS) as ReportFormat);
    const failOn =
      values['fail-on'] === undefined
        ? undefined
        : list(values['fail-on']).map((c) => oneOf('fail-on', c, CLASSIFICATIONS) as Classification);
    const overrides: CliOverrides = {
      ...(typeof values['perspective'] === 'string' ? { perspective: values['perspective'] } : {}),
      ...(failOn === undefined ? {} : { failOn }),
      ...(values['min-severity'] === undefined
        ? {}
        : { minSeverity: oneOf('min-severity', values['min-severity'], SEVERITIES) as Severity }),
      ...(values['undetermined'] === undefined
        ? {}
        : {
            undetermined: oneOf('undetermined', values['undetermined'], ['fail', 'review', 'ignore'] as const) as
              'fail' | 'review' | 'ignore',
          }),
      ...(formats === undefined ? {} : { formats }),
      ...(typeof values['output-dir'] === 'string' ? { outputDir: resolve(io.cwd, values['output-dir']) } : {}),
      ...(values['group-by'] === undefined
        ? {}
        : { groupBy: oneOf('group-by', values['group-by'], ['cause', 'operation'] as const) as 'cause' | 'operation' }),
      ...(values['deterministic'] === true ? { deterministic: true } : {}),
      ...(values['include-equivalent'] === true ? { includeEquivalent: true } : {}),
      ...(values['allow-invalid-spec'] === true ? { allowInvalidSpec: true } : {}),
    };
    const adHoc =
      positionals.length === 2 ? { base: positionals[0] as string, candidate: positionals[1] as string } : undefined;
    const configPath =
      values['no-config'] === true
        ? false
        : typeof values['config'] === 'string'
          ? values['config']
          : io.env['CONTRACTGUARD_CONFIG'];
    const needsStdin = adHoc?.candidate === '-';
    const run = await analyze({
      cwd: io.cwd,
      ...(configPath === undefined || configPath === '' ? {} : { configPath }),
      ...(adHoc === undefined ? {} : { adHoc }),
      ...(Array.isArray(values['spec']) ? { specIds: values['spec'].map(String) } : {}),
      overrides,
      trust: { ci, allowRemoteReferences: values['allow-remote-references'] === true },
      today: io.today,
      toolVersion: version(),
      ...(needsStdin ? { stdinText: await io.readStdin() } : {}),
      ...(io.signal === undefined ? {} : { signal: io.signal }),
    });
    if (run.value === undefined) {
      printDiagnostics(run.diagnostics, io, lvl);
      return exitForDiagnostics(run.diagnostics);
    }
    printDiagnostics(run.diagnostics, io, lvl);
    if (io.signal?.aborted === true) return EXIT.interrupted;
    const { config, gitRoot, baseDir } = run.value.loaded;
    const srcRoot = `file://${gitRoot ?? baseDir}`;
    const results = run.value.results;
    const common = { groupBy: config.report.groupBy, deterministic: config.report.deterministic, srcRoot } as const;

    // Human output goes to stderr when stdout carries a machine format.
    const human = stdoutFormat === undefined ? io.stdout : io.stderr;
    if (lvl !== 'quiet' && config.report.formats.includes('console')) {
      const width = Math.max(60, Math.min(io.stdout.columns ?? 100, 140));
      human.write(
        renderConsole(results, { ...common, color: useColor(values, io, ci, human), width, verbose: lvl !== 'normal' }),
      );
    }
    const render = (format: Exclude<ReportFormat, 'console'>, rs: readonly AnalysisResult[]): string => {
      switch (format) {
        case 'json':
          return renderJson(rs, common);
        case 'markdown':
          return renderMarkdown(rs, common);
        case 'sarif':
          return renderSarif(rs, { ...common, rules: RULES, all: values['sarif-all'] === true });
      }
    };
    if (stdoutFormat !== undefined) io.stdout.write(render(stdoutFormat, results));
    const fileFormats = config.report.formats.filter((f): f is Exclude<ReportFormat, 'console'> => f !== 'console');
    if (fileFormats.length > 0) {
      await mkdir(config.report.outputDir, { recursive: true });
      for (const r of results) {
        for (const f of fileFormats)
          await writeFile(join(config.report.outputDir, `${r.specId}.${EXT[f]}`), render(f, [r]));
      }
      if (lvl !== 'quiet') {
        const names = results.map((r) => `${r.specId}.{${fileFormats.map((f) => EXT[f]).join(',')}}`).join(', ');
        io.stderr.write(`Reports: ${relative(io.cwd, config.report.outputDir) || '.'}/${names}\n`);
      }
    }
    switch (run.value.outcome) {
      case 'input-error':
        return EXIT.input;
      case 'policy-failed':
        return values['no-fail'] === true ? EXIT.ok : EXIT.policyFailed;
      case 'passed':
        return EXIT.ok;
    }
  },
};

const validate: Command = {
  name: 'validate',
  usage: 'contractguard validate <spec...> [options]',
  summary: 'Load, parse, resolve and validate specifications',
  minPositionals: 1,
  maxPositionals: Infinity,
  options: {
    ...CONFIG_OPTS,
    'allow-invalid-spec': {
      type: 'boolean',
      help: 'Report specification errors as warnings when the document still loads',
    },
  },
  async run(values, positionals, io) {
    const lvl = level(values, io);
    const configPath =
      values['no-config'] === true ? false : typeof values['config'] === 'string' ? values['config'] : undefined;
    const cfg = await loadConfiguration({
      cwd: io.cwd,
      ...(configPath === undefined ? {} : { configPath }),
      adHoc: { base: positionals[0] as string, candidate: positionals[0] as string },
      today: io.today,
      overrides: values['allow-invalid-spec'] === true ? { allowInvalidSpec: true } : {},
    });
    if (cfg.value === undefined) {
      printDiagnostics(cfg.diagnostics, io, lvl);
      return exitForDiagnostics(cfg.diagnostics);
    }
    const stdinText = positionals.includes('-') ? await io.readStdin() : undefined;
    let errors = 0;
    let warnings = 0;
    let usage = false;
    for (const p of positionals) {
      const r = await validateSource(p, {
        cwd: io.cwd,
        loaded: cfg.value,
        ...(stdinText === undefined ? {} : { stdinText }),
      });
      // With --allow-invalid-spec, specification errors in a document that still loaded are reported as warnings.
      const lenient = values['allow-invalid-spec'] === true && r.contract !== undefined;
      for (const raw of r.diagnostics) {
        const d =
          lenient && raw.severity === 'error' && raw.category === 'specification'
            ? { ...raw, severity: 'warning' as const }
            : raw;
        if (d.severity === 'error') errors++;
        else warnings++;
        if (d.category === 'configuration') usage = true;
        if (d.severity === 'error' || lvl !== 'quiet') io.stdout.write(`${formatDiagnostic(d, io.cwd)}\n`);
      }
      if (lvl !== 'quiet' && r.contract !== undefined) {
        io.stdout.write(
          `✓ ${p}: OpenAPI ${r.contract.spec.version}, ${String(r.contract.operations.size)} operations\n`,
        );
      }
    }
    if (lvl !== 'quiet')
      io.stdout.write(
        `${String(positionals.length)} checked · ${String(errors)} error(s) · ${String(warnings)} warning(s)\n`,
      );
    return usage ? EXIT.usage : errors > 0 ? EXIT.input : EXIT.ok;
  },
};

const explain: Command = {
  name: 'explain',
  usage: 'contractguard explain <rule-id> | --list',
  summary: 'Show rule documentation from the catalog',
  minPositionals: 0,
  maxPositionals: 1,
  options: { list: { type: 'boolean', help: 'List all rules' } },
  run(values, positionals, io) {
    if (values['list'] === true) {
      for (const r of RULES) io.stdout.write(`${r.id.padEnd(14)}${r.name}\n`);
      return Promise.resolve(EXIT.ok);
    }
    const id = positionals[0];
    if (id === undefined) throw new UsageError('explain needs a rule id (or --list)');
    const e = explainRule(id);
    if (e === undefined) {
      const s = didYouMean(
        id.toUpperCase(),
        RULES.map((r) => r.id),
      );
      throw new UsageError(`Unknown rule "${id}"${s === undefined ? '' : ` (did you mean ${s}?)`}`);
    }
    const lines = [
      `${e.id}  ${e.name}`,
      '',
      e.summary,
      '',
      `Why: ${e.rationale}`,
      `Area: ${e.area}${e.direction === undefined ? '' : ` (${e.direction} direction)`}`,
      `Detects: ${e.handles.join(', ')}`,
      `Severity: breaking ${e.severityProfile.breaking} · potentially breaking ${e.severityProfile.potentiallyBreaking} · undetermined ${e.severityProfile.undetermined}`,
      `Classification overridable: ${e.overridable.classification ? 'yes' : 'no'}`,
      ...(e.options.length === 0
        ? []
        : [
            '',
            'Options:',
            ...e.options.map((o) => `  ${o.name} (${o.type}, default ${String(o.default)}): ${o.description}`),
          ]),
      ...(e.limitations.length === 0 ? [] : ['', 'Limitations:', ...e.limitations.map((l) => `  - ${l}`)]),
      '',
      'Examples:',
      ...e.examples.map((x) => `  ${x.fires ? '✔' : '✘'} ${x.title}`),
      '',
    ];
    io.stdout.write(lines.join('\n'));
    return Promise.resolve(EXIT.ok);
  },
};

const baseline: Command = {
  name: 'baseline create',
  usage: 'contractguard baseline create <spec> -o <file>',
  summary: 'Bundle a specification into a snapshot for later comparison (snapshot:<file>)',
  minPositionals: 1,
  maxPositionals: 1,
  options: {
    ...CONFIG_OPTS,
    output: { type: 'string', short: 'o', arg: 'file', help: 'Snapshot file to write (required)' },
  },
  async run(values, positionals, io) {
    const lvl = level(values, io);
    const out = values['output'];
    if (typeof out !== 'string') throw new UsageError('baseline create needs -o <file>');
    const configPath =
      values['no-config'] === true ? false : typeof values['config'] === 'string' ? values['config'] : undefined;
    const spec = positionals[0] as string;
    const cfg = await loadConfiguration({
      cwd: io.cwd,
      ...(configPath === undefined ? {} : { configPath }),
      adHoc: { base: spec, candidate: spec },
      today: io.today,
    });
    if (cfg.value === undefined) {
      printDiagnostics(cfg.diagnostics, io, lvl);
      return exitForDiagnostics(cfg.diagnostics);
    }
    const r = await createBaseline(spec, {
      cwd: io.cwd,
      loaded: cfg.value,
      toolVersion: version(),
      ...(spec === '-' ? { stdinText: await io.readStdin() } : {}),
    });
    printDiagnostics(r.diagnostics, io, lvl);
    if (r.value === undefined) return exitForDiagnostics(r.diagnostics);
    const file = resolve(io.cwd, out);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(r.value, null, 2)}\n`);
    if (lvl !== 'quiet')
      io.stderr.write(
        `Snapshot written: ${relative(io.cwd, file)} (${String(r.value.documents.length)} document(s)); compare with snapshot:${relative(io.cwd, file)}\n`,
      );
    return EXIT.ok;
  },
};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.contractguard']);

async function findSpecs(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0 || out.length >= 20) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
      await findSpecs(join(dir, e.name), depth - 1, out);
    else if (e.isFile() && /^(openapi|swagger|api)\.(ya?ml|json)$/i.test(e.name)) out.push(join(dir, e.name));
  }
}

const init: Command = {
  name: 'init',
  usage: 'contractguard init [--force]',
  summary: 'Write a commented .contractguard.yaml for this repository',
  minPositionals: 0,
  maxPositionals: 0,
  options: { force: { type: 'boolean', help: 'Overwrite an existing configuration' } },
  async run(values, _positionals, io) {
    const target = join(io.cwd, '.contractguard.yaml');
    const existing = await access(target).then(
      () => true,
      () => false,
    );
    if (existing && values['force'] !== true)
      throw new UsageError('.contractguard.yaml already exists (use --force to overwrite)');
    const found: string[] = [];
    await findSpecs(io.cwd, 4, found);
    const branch = (await defaultBranch(io.cwd)) ?? 'origin/main';
    const specs = (found.length > 0 ? found : [join(io.cwd, 'openapi.yaml')]).map((f) => {
      const rel = relative(io.cwd, f).split('\\').join('/');
      const id = (
        rel
          .replace(/\.(ya?ml|json)$/i, '')
          .replace(/[^a-z0-9]+/gi, '-')
          .toLowerCase()
          .replace(/^-+|-+$/g, '') || 'api'
      ).slice(0, 63);
      return `  - id: ${id}\n    candidate: ${rel}\n    base: git:${branch}:${rel}\n`;
    });
    const text = `# ContractGuard configuration — https://github.com/zainkhan-bit/ContractGuard
# yaml-language-server: $schema=./node_modules/@contractguard/app/schemas/config.v1.json
version: 1

# Which specifications to compare. base/candidate accept a path, git:<ref>:<path>,
# snapshot:<file> or an https:// URL.
specs:
${specs.join('')}
# When does the check fail? Classifications: breaking, potentially-breaking,
# undetermined, non-breaking, informational.
policy:
  failOn: [breaking]
  minSeverity: low
  undetermined: review       # fail | review | ignore

# How strict is the analysis? (defaults shown)
analysis:
  constraintTightening: potentially-breaking   # | breaking
  responseEnumAdditions: potentially-breaking  # | non-breaking | breaking

# Silence or tune rules. Every ignore needs a reason; expiring ignores warn 30 days ahead.
rules:
  disable: []
  ignore: []
  #  - rule: CG-RES-001
  #    operation: "GET /users/{id}"
  #    reason: "Field moved to /users/{id}/contact; clients notified"
  #    expires: ${io.today}

report:
  formats: [console, markdown, json]
  outputDir: .contractguard/reports
`;
    await writeFile(target, text);
    io.stderr.write(
      `Wrote .contractguard.yaml (${String(specs.length)} spec(s)${found.length === 0 ? ', none detected: edit the paths' : ''}). Run: contractguard check\n`,
    );
    return EXIT.ok;
  },
};

const COMMANDS: readonly Command[] = [check, validate, explain, baseline, init];

// ------------------------------------------------------------------ help & dispatch

function optionHelp(options: Readonly<Record<string, Opt>>): string {
  return Object.entries(options)
    .map(([name, o]) => {
      const flag = `${o.short === undefined ? '    ' : `-${o.short}, `}--${name}${o.type === 'string' ? ` <${o.arg ?? 'value'}>` : ''}`;
      return `  ${flag.padEnd(34)}${o.help}`;
    })
    .join('\n');
}

export function mainHelp(): string {
  return `ContractGuard ${version()} — detect breaking changes between versions of an OpenAPI contract

Usage: contractguard <command> [options]

Commands:
${COMMANDS.map((c) => `  ${c.name.padEnd(18)}${c.summary}`).join('\n')}

Global options:
${optionHelp(GLOBAL)}
      --version                     Print the version

Exit codes: 0 passed · 1 policy failed · 2 invalid input · 3 usage/config error · 4 internal error · 130 interrupted
Run "contractguard <command> --help" for command options.
`;
}

function commandHelp(c: Command): string {
  return `${c.summary}

Usage: ${c.usage}

Options:
${optionHelp(c.options)}
${optionHelp(GLOBAL)}
`;
}

/** Runs the CLI and returns the exit code. Never throws. */
export async function run(argv: readonly string[], io: CliIo): Promise<ExitCode> {
  const debug = argv.includes('--debug');
  try {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
      io.stdout.write(mainHelp());
      return EXIT.ok;
    }
    if (argv[0] === '--version' || argv[0] === '-V') {
      io.stdout.write(`${version()}\n`);
      return EXIT.ok;
    }
    let command: Command | undefined;
    let rest: readonly string[];
    if (argv[0] === 'baseline') {
      if (argv[1] !== 'create')
        throw new UsageError(`Unknown baseline subcommand "${argv[1] ?? ''}" (expected: baseline create)`);
      command = baseline;
      rest = argv.slice(2);
    } else {
      command = COMMANDS.find((c) => c.name === argv[0]);
      rest = argv.slice(1);
    }
    if (command === undefined) {
      const s = didYouMean(
        argv[0] ?? '',
        COMMANDS.map((c) => c.name.split(' ')[0] as string),
      );
      throw new UsageError(
        `Unknown command "${argv[0] ?? ''}"${s === undefined ? '' : ` (did you mean "${s}"?)`}. Run contractguard --help`,
      );
    }
    const options = { ...command.options, ...GLOBAL };
    let parsed: { values: Values; positionals: string[] };
    try {
      parsed = parseArgs({ args: [...rest], options, allowPositionals: true, strict: true });
    } catch (error) {
      const message = (error as Error).message;
      const m = /'(-{1,2}[^']+)'/.exec(message);
      const unknown = m?.[1]?.replace(/^-+/, '') ?? '';
      const s = unknown === '' ? undefined : didYouMean(unknown, Object.keys(options));
      throw new UsageError(`${message.split('. ')[0] ?? message}${s === undefined ? '' : ` (did you mean --${s}?)`}`);
    }
    if (parsed.values['help'] === true) {
      io.stdout.write(commandHelp(command));
      return EXIT.ok;
    }
    if (parsed.positionals.length < command.minPositionals || parsed.positionals.length > command.maxPositionals) {
      throw new UsageError(`Wrong number of arguments. Usage: ${command.usage}`);
    }
    return await command.run(parsed.values, parsed.positionals, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`error: ${error.message}\n`);
      return EXIT.usage;
    }
    if (io.signal?.aborted === true) return EXIT.interrupted;
    io.stderr.write(`internal error: ${(error as Error).message}\n`);
    if (debug) io.stderr.write(`${(error as Error).stack ?? ''}\n`);
    else
      io.stderr.write(
        'Run with --debug for a stack trace, and please report it: https://github.com/zainkhan-bit/ContractGuard/issues\n',
      );
    return EXIT.internal;
  }
}

/* v8 ignore start -- process wiring; exercised by the subprocess tests in test/cli.test.ts */
/** Process entry point: wires real I/O, SIGINT → 130, and sets the exit code. */
export async function main(): Promise<void> {
  const controller = new AbortController();
  process.once('SIGINT', () => {
    controller.abort();
  });
  const code = await run(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: process.cwd(),
    signal: controller.signal,
    today: new Date().toISOString().slice(0, 10),
    async readStdin() {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    },
  });
  process.exitCode = controller.signal.aborted ? EXIT.interrupted : code;
}
/* v8 ignore stop */
