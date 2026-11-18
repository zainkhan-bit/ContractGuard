import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';

/**
 * The GitHub Actions runner protocol (no @actions/core dependency): inputs come from `INPUT_*` variables, outputs and
 * the job summary go to the files named by `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY`, and annotations, groups and
 * failures are workflow commands on stdout.
 */
export interface RunnerIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** stdout of the step (workflow commands and log lines). */
  write(text: string): void;
}

/** `INPUT_<NAME>`: upper-cased, spaces become underscores, hyphens are kept. */
export function getInput(io: RunnerIo, name: string): string {
  return (io.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
}

export function getBooleanInput(io: RunnerIo, name: string, fallback: boolean): boolean {
  const v = getInput(io, name).toLowerCase();
  if (v === '') return fallback;
  if (['true', 'yes', 'on', '1'].includes(v)) return true;
  if (['false', 'no', 'off', '0'].includes(v)) return false;
  throw new InputError(`Input "${name}" must be true or false, got "${v}"`);
}

/** Newline- or comma-separated list input; blank lines and `#` comments are ignored. */
export function getListInput(io: RunnerIo, name: string): string[] {
  return getInput(io, name)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('#'));
}

export class InputError extends Error {}

/** Escaping for the message part of a workflow command. */
export function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escaping for a workflow command property value. */
export function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export interface AnnotationProps {
  readonly title?: string;
  readonly file?: string;
  readonly line?: number;
  readonly col?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

export function command(name: string, props: AnnotationProps, message: string): string {
  const entries = Object.entries(props).filter(([, v]) => v !== undefined) as [string, string | number][];
  const p = entries.map(([k, v]) => `${k}=${escapeProperty(String(v))}`).join(',');
  return `::${name}${p === '' ? '' : ` ${p}`}::${escapeData(message)}\n`;
}

/**
 * Prevents text we print (spec content, finding messages) from being interpreted as workflow commands for the rest
 * of the step. The token is random per run, so content cannot guess it to re-enable commands.
 */
export function stopCommands(io: RunnerIo): () => void {
  const token = randomUUID();
  io.write(`::stop-commands::${token}\n`);
  return () => {
    io.write(`::${token}::\n`);
  };
}

async function appendEnvFile(io: RunnerIo, variable: string, text: string): Promise<boolean> {
  const file = io.env[variable];
  if (file === undefined || file === '') return false;
  await appendFile(file, text, 'utf8');
  return true;
}

/** Writes outputs with the multi-line heredoc syntax; the delimiter is random and checked against the value. */
export async function setOutputs(io: RunnerIo, outputs: Readonly<Record<string, string>>): Promise<void> {
  let text = '';
  for (const [name, value] of Object.entries(outputs)) {
    let delimiter = `ghadelimiter_${randomUUID()}`;
    while (value.includes(delimiter)) delimiter = `ghadelimiter_${randomUUID()}`;
    text += `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  }
  if (!(await appendEnvFile(io, 'GITHUB_OUTPUT', text))) {
    // Outside a runner (local testing): log them instead.
    for (const [name, value] of Object.entries(outputs)) io.write(`output ${name}=${value}\n`);
  }
}

export async function appendSummary(io: RunnerIo, markdown: string): Promise<boolean> {
  return appendEnvFile(io, 'GITHUB_STEP_SUMMARY', markdown.endsWith('\n') ? markdown : `${markdown}\n`);
}

export function group(io: RunnerIo, title: string): () => void {
  io.write(`::group::${escapeData(title)}\n`);
  return () => {
    io.write('::endgroup::\n');
  };
}
