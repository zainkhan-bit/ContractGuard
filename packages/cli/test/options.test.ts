import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT, formatDiagnostic, run, type CliIo } from '../src/index.js';
import { diagnostic, documentUri, type JsonPointer } from '@contractguard/core';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SPEC = (v: number): string => `openapi: 3.1.0
info: {title: Pets, version: 1.0.0}
paths:
  /pets:
    get:
      parameters:
        - {name: limit, in: query, schema: {type: integer, maximum: ${String(v)}}}
${v === 50 ? '' : '        - {name: q, in: query, required: true, schema: {type: string}}\n'}      responses:
        '200': {description: ok}
`;

function project(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cg-opt-')));
  dirs.push(d);
  const files = { 'openapi.yaml': SPEC(50) };
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), text);
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e', '-c', 'commit.gpgsign=false', 'add', '-A'], {
    cwd: d,
  });
  execFileSync(
    'git',
    ['-c', 'user.name=T', '-c', 'user.email=t@e', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'b'],
    { cwd: d },
  );
  writeFileSync(join(d, 'openapi.yaml'), SPEC(10));
  return d;
}

async function cli(
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: { write: (t: string) => (out += t), columns: 200 },
    stderr: { write: (t: string) => (err += t) },
    env,
    cwd,
    today: '2026-06-01',
    readStdin: () => Promise.resolve(''),
    ...(signal === undefined ? {} : { signal }),
  };
  return { code: await run(args, io), out, err };
}

const A = ['check', 'git:HEAD:openapi.yaml', 'openapi.yaml', '--no-config', '--deterministic'];

describe('check options', () => {
  it('accepts every policy and report flag', async () => {
    const d = project();
    const r = await cli(
      [
        ...A,
        '--perspective',
        'provider-backward',
        '--fail-on',
        'breaking,potentially-breaking',
        '--undetermined',
        'fail',
        '--group-by',
        'operation',
        '--include-equivalent',
        '--sarif-all',
        '--stdout',
        'sarif',
        '-v',
      ],
      d,
    );
    expect(r.code).toBe(EXIT.policyFailed);
    expect(r.err).toContain('GET /pets');
    expect((JSON.parse(r.out) as { runs: unknown[] }).runs).toHaveLength(1);
  });

  it('rejects bad enum values with a suggestion', async () => {
    const d = project();
    for (const args of [
      ['--undetermined', 'fial'],
      ['--group-by', 'operations'],
      ['--min-severity', 'hgh'],
      ['--fail-on', 'braking'],
      ['--stdout', 'console'],
      ['--perspective', 'consumer-forward'],
    ]) {
      const r = await cli([...A, ...args], d);
      expect(r.code, args.join(' ')).toBe(EXIT.usage);
    }
    expect((await cli([...A, '--undetermined', 'fial'], d)).err).toContain('did you mean "fail"');
  });

  it('log level from CONTRACTGUARD_LOG_LEVEL and --quiet', async () => {
    const d = project();
    expect((await cli(A, d, { CONTRACTGUARD_LOG_LEVEL: 'quiet' })).out).toBe('');
    expect((await cli(A, d, { CONTRACTGUARD_LOG_LEVEL: 'verbose' })).out).toContain('CG-REQ');
    expect((await cli(A, d, { CONTRACTGUARD_LOG_LEVEL: 'nonsense' })).out).toContain('Summary');
  });

  it('CONTRACTGUARD_CONFIG names the configuration file', async () => {
    const d = project();
    writeFileSync(
      join(d, 'cg.yaml'),
      'version: 1\nspecs:\n  - {id: x, base: "git:HEAD:openapi.yaml", candidate: openapi.yaml}\nreport: {formats: [console]}\n',
    );
    const r = await cli(['check', '-q'], d, { CONTRACTGUARD_CONFIG: 'cg.yaml' });
    expect(r.code).toBe(EXIT.policyFailed);
    expect((await cli(['check', '-q', '--config', 'missing.yaml'], d)).code).toBe(EXIT.usage);
  });

  it('an already-aborted signal → 130', async () => {
    const d = project();
    expect((await cli(A, d, {}, AbortSignal.abort())).code).toBe(EXIT.interrupted);
  });

  it('--allow-invalid-spec continues past specification errors', async () => {
    const d = project();
    writeFileSync(join(d, 'bad.yaml'), SPEC(10).replace('info: {title: Pets, version: 1.0.0}', 'info: {title: Pets}'));
    expect((await cli(['check', 'openapi.yaml', 'bad.yaml', '--no-config', '-q'], d)).code).toBe(EXIT.input);
    const ok = await cli(['check', 'openapi.yaml', 'bad.yaml', '--no-config', '-q', '--allow-invalid-spec'], d);
    expect(ok.code).not.toBe(EXIT.input);
    const v = await cli(['validate', 'bad.yaml', '--no-config', '--allow-invalid-spec'], d);
    expect(v.code).toBe(EXIT.ok);
    expect(v.out).toContain('warning');
  });

  it('validate and baseline honour --config errors', async () => {
    const d = project();
    writeFileSync(join(d, 'broken.yaml'), 'version: 7\n');
    expect((await cli(['validate', 'openapi.yaml', '--config', 'broken.yaml'], d)).code).toBe(EXIT.usage);
    expect((await cli(['baseline', 'create', 'openapi.yaml', '-o', 's.json', '--config', 'broken.yaml'], d)).code).toBe(
      EXIT.usage,
    );
    expect((await cli(['validate', 'openapi.yaml', '-q', '--config', 'broken.yaml'], d)).out).toBe('');
  });

  it('too many positionals', async () => {
    expect((await cli(['check', 'a', 'b', 'c'], project())).code).toBe(EXIT.usage);
    expect((await cli(['init', 'x'], project())).code).toBe(EXIT.usage);
  });
});

describe('formatDiagnostic', () => {
  it('prints location, side and hint', () => {
    const d = diagnostic('CGD-FS-001', 'File not found', {
      hint: 'check the path',
      location: { uri: documentUri('file:///w/api/openapi.yaml'), pointer: '#/paths' as JsonPointer },
    });
    expect(formatDiagnostic({ ...d, side: 'base' }, '/w')).toBe(
      'api/openapi.yaml  error  CGD-FS-001  [base] File not found (check the path)',
    );
    expect(formatDiagnostic(diagnostic('CGD-FS-001', 'x'), '/w')).toBe('error  CGD-FS-001  x');
  });
});
