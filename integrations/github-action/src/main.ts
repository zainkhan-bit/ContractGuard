import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { analyze, BASE_TOKEN, type AdHocSpec, type CliOverrides } from '@zainkhan-bit/contractguard-app';
import type { AnalysisResult, Classification, Diagnostic, Severity } from '@zainkhan-bit/contractguard-core';
import { RULES } from '@zainkhan-bit/contractguard-engine';
import { renderConsole, renderJson, renderMarkdown, renderSarif } from '@zainkhan-bit/contractguard-reporters';
import { diagnosticAnnotations, findingAnnotations } from './annotations.js';
import { commentBody, upsertComment, type CommentOutcome } from './comment.js';
import { readContext } from './context.js';
import { ensureBaseCommit } from './git.js';
import {
  appendSummary,
  command,
  getBooleanInput,
  getInput,
  getListInput,
  group,
  InputError,
  setOutputs,
  stopCommands,
  type RunnerIo,
} from './runner.js';

declare const __CONTRACTGUARD_VERSION__: string | undefined;

/** Replaced at bundle time with the package version. */
export const VERSION = typeof __CONTRACTGUARD_VERSION__ === 'string' ? __CONTRACTGUARD_VERSION__ : '0.0.0-dev';

export interface ActionDeps {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** YYYY-MM-DD; defaults to today (UTC). */
  readonly today?: string;
}

export type ActionResult = 'passed' | 'failed' | 'input-error';

export interface ActionRun {
  readonly result: ActionResult;
  readonly exitCode: 0 | 1;
  readonly comment?: CommentOutcome;
}

const CLASSIFICATIONS: readonly Classification[] = [
  'breaking',
  'potentially-breaking',
  'undetermined',
  'non-breaking',
  'informational',
];
const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T | undefined {
  if (value === '') return undefined;
  if (!allowed.includes(value as T))
    throw new InputError(`Input "${name}" must be one of ${allowed.join(', ')}, got "${value}"`);
  return value as T;
}

function overridesFrom(io: RunnerIo): CliOverrides {
  const failOn = getListInput(io, 'fail-on').map((c) => oneOf('fail-on', c, CLASSIFICATIONS) as Classification);
  const minSeverity = oneOf('min-severity', getInput(io, 'min-severity'), SEVERITIES);
  const undetermined = oneOf('undetermined', getInput(io, 'undetermined'), ['fail', 'review', 'ignore'] as const);
  return {
    ...(failOn.length === 0 ? {} : { failOn }),
    ...(minSeverity === undefined ? {} : { minSeverity }),
    ...(undetermined === undefined ? {} : { undetermined }),
    // Files are written by the Action itself (summary, SARIF, JSON); no console/markdown files in the workspace.
    formats: ['console'],
  };
}

function failMessage(results: readonly AnalysisResult[]): string {
  const gating = results.reduce((n, r) => n + r.policy.reasons.length, 0);
  const breaking = results.reduce((n, r) => n + r.summary.byClassification.breaking, 0);
  return gating === breaking
    ? `ContractGuard found ${String(breaking)} breaking change(s). See the annotations and the job summary.`
    : `ContractGuard: ${String(gating)} finding(s) fail the policy (${String(breaking)} breaking). See the job summary.`;
}

/** Runs the Action. Returns instead of exiting so tests can drive it with a fake runner. */
export async function run(io: RunnerIo, deps: ActionDeps = {}): Promise<ActionRun> {
  const log = (line: string): void => {
    io.write(`${line}\n`);
  };
  const fail = (message: string): void => {
    io.write(command('error', { title: 'ContractGuard' }, message));
  };

  let outputs: Record<string, string> = {
    result: 'input-error',
    breaking: '0',
    'potentially-breaking': '0',
    undetermined: '0',
    'non-breaking': '0',
    'report-json': '',
    fingerprints: '',
  };

  try {
    const ctx = await readContext(io, getInput(io, 'base-ref'));
    for (const w of ctx.warnings) io.write(command('warning', { title: 'ContractGuard' }, w));
    // Documents are keyed by their real path (8.3 short names expanded on Windows), so compare against the same.
    const workspace = await realpath(ctx.workspace).catch(() => ctx.workspace);
    const workdir = resolve(workspace, getInput(io, 'working-directory') || '.');
    const sarifInput = getInput(io, 'sarif-file');
    const wantSummary = getBooleanInput(io, 'summary', true);
    const wantAnnotations = getBooleanInput(io, 'annotations', true);
    const wantComment = getBooleanInput(io, 'comment', false);
    const overrides = overridesFrom(io);
    const specsInput = getListInput(io, 'specs');
    const configInput = getInput(io, 'config');

    const end = group(io, `Resolving base revision ${ctx.base}`);
    const baseSha = await ensureBaseCommit(ctx.base, workdir, log);
    log(`Base: ${baseSha} (${ctx.baseSource})`);
    end();

    const adHoc: AdHocSpec[] = specsInput.map((p) => ({ base: `${BASE_TOKEN}${p}`, candidate: p }));
    const run = await analyze({
      cwd: workdir,
      ...(configInput === '' ? {} : { configPath: resolve(workdir, configInput) }),
      ...(adHoc.length === 0 ? {} : { adHoc }),
      overrides,
      trust: { ci: true, allowRemoteReferences: getBooleanInput(io, 'allow-remote-references', false) },
      today: deps.today ?? new Date().toISOString().slice(0, 10),
      toolVersion: VERSION,
      baseRef: baseSha,
      newSpecs: 'pass',
    });

    if (run.value === undefined) {
      io.write(diagnosticAnnotations(run.diagnostics, workspace));
      fail(
        run.diagnostics.some((d) => d.code === 'CGD-CONFIG-014')
          ? 'No .contractguard.yaml found. Add one (npx @zainkhan-bit/contractguard init) or set the "specs" input.'
          : 'ContractGuard could not start: fix the configuration errors above.',
      );
      await setOutputs(io, outputs);
      return { result: 'input-error', exitCode: 1 };
    }
    const { results, unchanged, added } = run.value;
    const config = run.value.loaded.config;
    io.write(diagnosticAnnotations(run.diagnostics, workspace));

    // Console report in the log, with workflow commands disabled while user-controlled text is printed.
    const resume = stopCommands(io);
    for (const id of unchanged) log(`${id}: no API changes (the specification files are identical).`);
    for (const id of added) log(`${id}: new specification, nothing to compare yet.`);
    io.write(
      renderConsole(results, {
        groupBy: config.report.groupBy,
        deterministic: true,
        srcRoot: workspace,
        color: true,
        width: 120,
        verbose: true,
      }),
    );
    resume();

    const linkBase = ctx.repository === '' ? undefined : `${ctx.serverUrl}/${ctx.repository}/blob/${ctx.headSha}/`;
    const runUrl =
      io.env['GITHUB_RUN_ID'] === undefined
        ? undefined
        : `${ctx.serverUrl}/${ctx.repository}/actions/runs/${io.env['GITHUB_RUN_ID']}`;
    const firstSpec = config.specs[0];
    const reproduce =
      firstSpec === undefined
        ? undefined
        : `npx @zainkhan-bit/contractguard check ${firstSpec.base.replace(BASE_TOKEN, `git:${baseSha.slice(0, 12)}:`)} ${firstSpec.candidate}`;
    const markdown = (maxBytes: number): string =>
      renderMarkdown(results, {
        groupBy: config.report.groupBy,
        deterministic: true,
        srcRoot: workspace,
        ...(linkBase === undefined ? {} : { linkBase }),
        ...(reproduce === undefined ? {} : { reproduceCommand: reproduce }),
        maxBytes,
      });

    if (wantSummary) await appendSummary(io, markdown(1_000_000));
    if (wantAnnotations) io.write(findingAnnotations(results, workspace));
    for (const r of results) io.write(diagnosticAnnotations(r.diagnostics, workspace));

    // Report files.
    const reportDir = join(io.env['RUNNER_TEMP'] ?? join(workdir, '.contractguard'), 'contractguard');
    await mkdir(reportDir, { recursive: true });
    const jsonPath = join(reportDir, 'report.json');
    await writeFile(jsonPath, renderJson(results, { deterministic: false }));
    if (sarifInput !== '') {
      const sarifPath = isAbsolute(sarifInput) ? sarifInput : join(workdir, sarifInput);
      await mkdir(dirname(sarifPath), { recursive: true });
      await writeFile(
        sarifPath,
        renderSarif(results, {
          groupBy: config.report.groupBy,
          deterministic: true,
          srcRoot: workspace,
          rules: RULES,
        }),
      );
      log(`SARIF written to ${relative(workspace, sarifPath) || sarifPath}`);
    }

    let comment: CommentOutcome | undefined;
    if (wantComment) {
      if (ctx.prNumber === undefined) {
        log('comment: true has no effect outside pull_request events.');
      } else if (!ctx.canComment) {
        io.write(
          command(
            'notice',
            { title: 'ContractGuard' },
            'Pull requests from forks get a read-only token, so no PR comment was written. The job summary has the full report.',
          ),
        );
        comment = 'skipped-readonly';
      } else {
        const token = getInput(io, 'token');
        if (token === '') {
          log('comment: true needs the token input (default: github.token).');
          comment = 'skipped-readonly';
        } else {
          comment = await upsertComment(
            {
              apiUrl: ctx.apiUrl,
              repository: ctx.repository,
              token,
              ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
              ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
            },
            ctx.prNumber,
            commentBody(markdown(60_000), runUrl),
            (line) => {
              io.write(command('warning', { title: 'ContractGuard' }, line));
            },
          );
          log(`PR comment: ${comment}`);
        }
      }
    }

    const sum = (c: Classification): string => String(results.reduce((n, r) => n + r.summary.byClassification[c], 0));
    const result: ActionResult =
      run.value.outcome === 'input-error' ? 'input-error' : run.value.outcome === 'policy-failed' ? 'failed' : 'passed';
    outputs = {
      result,
      breaking: sum('breaking'),
      'potentially-breaking': sum('potentially-breaking'),
      undetermined: sum('undetermined'),
      'non-breaking': sum('non-breaking'),
      'report-json': jsonPath,
      fingerprints: results.flatMap((r) => r.policy.reasons.map((x) => x.fingerprint)).join(' '),
    };
    await setOutputs(io, outputs);

    if (result === 'input-error') fail('ContractGuard could not load a specification. See the errors above.');
    else if (result === 'failed') fail(failMessage(results));
    return { result, exitCode: result === 'passed' ? 0 : 1, ...(comment === undefined ? {} : { comment }) };
  } catch (error) {
    if (error instanceof InputError) fail(error.message);
    else
      fail(
        `Internal error: ${(error as Error).stack ?? String(error)}. Please report it at https://github.com/zainkhan-bit/ContractGuard/issues`,
      );
    await setOutputs(io, outputs).catch(() => undefined);
    return { result: 'input-error', exitCode: 1 };
  }
}

export type { Diagnostic };
