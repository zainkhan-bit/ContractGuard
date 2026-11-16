import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT, mainHelp, run, type CliIo } from '../src/index.js';

const BIN = fileURLToPath(new URL('../bin/contractguard.js', import.meta.url));
const TODAY = '2026-06-01';
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function write(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
}

const git = (dir: string, ...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

const SPEC = (breaking: boolean): string => `openapi: 3.1.0
info: {title: Pets, version: 1.0.0}
paths:
  /pets:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
${breaking ? '              required: [age]\n' : ''}              properties:
                age: {type: integer}
      responses:
        '201': {description: created}
`;

/** A repository whose HEAD has the compatible spec; the working tree optionally carries a breaking change. */
function project(breaking = true): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cg-cli-')));
  dirs.push(d);
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'config', 'user.email', 't@example.com');
  git(d, 'config', 'user.name', 'T');
  git(d, 'config', 'commit.gpgsign', 'false');
  write(d, { 'openapi.yaml': SPEC(false) });
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'base');
  if (breaking) write(d, { 'openapi.yaml': SPEC(true) });
  return d;
}

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
  stdin = '',
): Promise<Captured> {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: { write: (t: string) => (stdout += t) },
    stderr: { write: (t: string) => (stderr += t) },
    env,
    cwd,
    today: TODAY,
    readStdin: () => Promise.resolve(stdin),
  };
  const code = await run(args, io);
  return { code, stdout, stderr };
}

const ADHOC = ['check', 'git:HEAD:openapi.yaml', 'openapi.yaml', '--no-config', '--deterministic'];

describe('global', () => {
  it('help and version', async () => {
    const d = project();
    const h = await cli([], d);
    expect(h.code).toBe(EXIT.ok);
    expect(h.stdout).toBe(mainHelp());
    expect(h.stdout).toContain('Exit codes');
    expect((await cli(['--version'], d)).stdout).toMatch(/^\d+\.\d+\.\d+/);
    const ch = await cli(['check', '--help'], d);
    expect(ch.stdout).toContain('--fail-on');
  });

  it('unknown command and option → 3 with a suggestion', async () => {
    const d = project();
    const c = await cli(['chek'], d);
    expect(c.code).toBe(EXIT.usage);
    expect(c.stderr).toContain('did you mean "check"');
    const o = await cli(['check', '--fial-on', 'breaking'], d);
    expect(o.code).toBe(EXIT.usage);
    expect(o.stderr).toContain('--fail-on');
    expect((await cli(['check', '--format', 'xml'], d)).code).toBe(EXIT.usage);
    expect((await cli(['check', 'only-one.yaml'], d)).code).toBe(EXIT.usage);
    expect((await cli(['baseline', 'remove'], d)).code).toBe(EXIT.usage);
  });
});

describe('check', () => {
  it('breaking change → 1; --no-fail → 0; compatible → 0', async () => {
    const d = project();
    const r = await cli([...ADHOC, '--no-color'], d);
    expect(r.code).toBe(EXIT.policyFailed);
    expect(r.stdout).toContain('CG-REQ-003');
    expect(r.stdout).not.toContain('\u001b[');
    expect((await cli([...ADHOC, '--no-fail', '-q'], d)).code).toBe(EXIT.ok);
    expect((await cli([...ADHOC, '-q'], project(false))).code).toBe(EXIT.ok);
  });

  it('--fail-on and --min-severity change the gate', async () => {
    const d = project();
    expect((await cli([...ADHOC, '-q', '--fail-on', 'informational'], d)).code).toBe(EXIT.ok);
    expect((await cli([...ADHOC, '-q', '--min-severity', 'critical'], d)).code).toBe(EXIT.ok);
  });

  it('--stdout json is pure JSON; human output goes to stderr', async () => {
    const d = project();
    const r = await cli([...ADHOC, '--stdout', 'json'], d);
    expect(r.code).toBe(EXIT.policyFailed);
    const parsed = JSON.parse(r.stdout) as { specId: string; findings: unknown[] }[];
    expect(parsed[0]?.findings.length).toBeGreaterThan(0);
    expect(r.stderr).toContain('CG-REQ-003');
    const sarif = JSON.parse((await cli([...ADHOC, '--stdout', 'sarif', '-q'], d)).stdout) as { version: string };
    expect(sarif.version).toBe('2.1.0');
    expect((await cli([...ADHOC, '--stdout', 'markdown', '-q'], d)).stdout).toContain('## ContractGuard');
  });

  it('writes report files to --output-dir', async () => {
    const d = project();
    const r = await cli([...ADHOC, '-f', 'console,markdown,json,sarif', '-o', 'out'], d);
    expect(r.code).toBe(EXIT.policyFailed);
    for (const ext of ['md', 'json', 'sarif']) expect(existsSync(join(d, 'out', `openapi.${ext}`))).toBe(true);
    expect(r.stderr).toContain('Reports: out/');
  });

  it('colour: NO_COLOR wins, FORCE_COLOR and --color enable it', async () => {
    const d = project();
    expect((await cli(ADHOC, d, { NO_COLOR: '1', FORCE_COLOR: '1' })).stdout).not.toContain('\u001b[');
    expect((await cli(ADHOC, d, { FORCE_COLOR: '1' })).stdout).toContain('\u001b[');
    expect((await cli([...ADHOC, '--color'], d)).stdout).toContain('\u001b[');
  });

  it('input errors → 2; invalid specifiers → 3', async () => {
    const d = project();
    expect((await cli(['check', 'git:nope:openapi.yaml', 'openapi.yaml', '--no-config', '-q'], d)).code).toBe(
      EXIT.input,
    );
    write(d, { 'bad.yaml': 'openapi: 3.1.0\ninfo: {title: t}\npaths: {}\n' });
    expect((await cli(['check', 'openapi.yaml', 'bad.yaml', '--no-config', '-q'], d)).code).toBe(EXIT.input);
    const t10 = await cli(['check', 'git:--upload-pack=touch x:openapi.yaml', 'openapi.yaml', '--no-config'], d);
    expect(t10.code).toBe(EXIT.usage);
    expect(existsSync(join(d, 'x'))).toBe(false);
  });

  it('configuration errors → 3 with file:line:col', async () => {
    const d = project();
    write(d, {
      '.contractguard.yaml':
        'version: 1\nspecs:\n  - {id: api, base: "git:HEAD:openapi.yaml", candidate: openapi.yaml}\npolcy: {}\n',
    });
    const r = await cli(['check'], d);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toMatch(/\.contractguard\.yaml:4:1 {2}error {2}CGD-CONFIG-003/);
  });

  it('discovers the configuration from a nested directory', async () => {
    const d = project();
    write(d, {
      '.contractguard.yaml':
        'version: 1\nspecs:\n  - {id: api, base: "git:HEAD:openapi.yaml", candidate: openapi.yaml}\nreport: {formats: [console]}\n',
      'src/deep/.keep': '',
    });
    const r = await cli(['check', '-q'], join(d, 'src', 'deep'));
    expect(r.code).toBe(EXIT.policyFailed);
    expect((await cli(['check', '-q', '--spec', 'nope'], d)).code).toBe(EXIT.usage);
  });

  it('reads the candidate from stdin', async () => {
    const d = project(false);
    expect((await cli(['check', 'git:HEAD:openapi.yaml', '-', '--no-config', '-q'], d, {}, SPEC(true))).code).toBe(
      EXIT.policyFailed,
    );
  });
});

describe('validate, explain, baseline, init', () => {
  it('validate', async () => {
    const d = project();
    const ok = await cli(['validate', 'openapi.yaml', 'git:HEAD:openapi.yaml', '--no-config'], d);
    expect(ok.code).toBe(EXIT.ok);
    expect(ok.stdout).toContain('2 checked · 0 error(s)');
    write(d, { 'bad.yaml': 'openapi: 3.1.0\npaths: {}\n' });
    const bad = await cli(['validate', 'bad.yaml', '--no-config'], d);
    expect(bad.code).toBe(EXIT.input);
    expect(bad.stdout).toMatch(/bad\.yaml:\d+:\d+ {2}error/);
    expect((await cli(['validate', 'git:-x:a.yaml', '--no-config'], d)).code).toBe(EXIT.usage);
    expect((await cli(['validate'], d)).code).toBe(EXIT.usage);
  });

  it('explain', async () => {
    const d = project();
    const e = await cli(['explain', 'CG-REQ-001'], d);
    expect(e.code).toBe(EXIT.ok);
    expect(e.stdout).toContain('Examples:');
    expect((await cli(['explain', '--list'], d)).stdout.trim().split('\n')).toHaveLength(83);
    const u = await cli(['explain', 'cg-req-01'], d);
    expect(u.code).toBe(EXIT.usage);
    expect(u.stderr).toContain('did you mean');
    expect((await cli(['explain'], d)).code).toBe(EXIT.usage);
  });

  it('baseline create, then compare against the snapshot', async () => {
    const d = project();
    const b = await cli(['baseline', 'create', 'git:HEAD:openapi.yaml', '-o', 'snap/base.json', '--no-config'], d);
    expect(b.code).toBe(EXIT.ok);
    const snap = JSON.parse(readFileSync(join(d, 'snap', 'base.json'), 'utf8')) as { format: string };
    expect(snap.format).toBe('contractguard-snapshot');
    expect((await cli(['check', 'snapshot:snap/base.json', 'openapi.yaml', '--no-config', '-q'], d)).code).toBe(
      EXIT.policyFailed,
    );
    expect((await cli(['baseline', 'create', 'openapi.yaml', '--no-config'], d)).code).toBe(EXIT.usage);
    expect((await cli(['baseline', 'create', 'missing.yaml', '-o', 'x.json', '--no-config', '-q'], d)).code).toBe(
      EXIT.input,
    );
  });

  it('init writes a working configuration and refuses to overwrite', async () => {
    const d = project();
    const i = await cli(['init'], d);
    expect(i.code).toBe(EXIT.ok);
    const text = readFileSync(join(d, '.contractguard.yaml'), 'utf8');
    expect(text).toContain('base: git:main:openapi.yaml');
    expect((await cli(['init'], d)).code).toBe(EXIT.usage);
    expect((await cli(['init', '--force'], d)).code).toBe(EXIT.ok);
    expect((await cli(['check', '-q'], d)).code).toBe(EXIT.policyFailed);
  });
});

describe('subprocess', () => {
  const node = process.execPath;

  it('the bin runs, exits with the right code and keeps stdout pure', () => {
    const d = project();
    const r = spawnSync(node, [BIN, ...ADHOC, '--stdout', 'json'], {
      cwd: d,
      encoding: 'utf8',
      env: { ...process.env, CI: '', NO_COLOR: '1' },
    });
    expect(r.status).toBe(EXIT.policyFailed);
    expect(() => JSON.parse(r.stdout) as unknown).not.toThrow();
    const v = spawnSync(node, [BIN, '--version'], { encoding: 'utf8' });
    expect(v.status).toBe(0);
  });

  it('CI=true writes JSON reports by default', () => {
    const d = project();
    const r = spawnSync(node, [BIN, ...ADHOC], { cwd: d, encoding: 'utf8', env: { ...process.env, CI: 'true' } });
    expect(r.status).toBe(EXIT.policyFailed);
    expect(r.stdout).not.toContain('\u001b[');
    expect(existsSync(join(d, '.contractguard', 'reports', 'openapi.json'))).toBe(true);
  });

  it('reads stdin', () => {
    const d = project(false);
    const r = spawnSync(node, [BIN, 'check', 'git:HEAD:openapi.yaml', '-', '--no-config', '-q'], {
      cwd: d,
      input: SPEC(true),
      encoding: 'utf8',
    });
    expect(r.status).toBe(EXIT.policyFailed);
  });

  it.skipIf(process.platform === 'win32')('SIGINT → 130', async () => {
    const d = project(false);
    // Waiting on stdin keeps the process alive until the signal arrives.
    const child = spawn(node, [BIN, 'check', 'git:HEAD:openapi.yaml', '-', '--no-config', '-q'], {
      cwd: d,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await new Promise((r) => setTimeout(r, 400));
    child.kill('SIGINT');
    child.stdin.end(SPEC(false));
    const code = await new Promise<number | null>((r) =>
      child.on('exit', (c) => {
        r(c);
      }),
    );
    expect(code).toBe(EXIT.interrupted);
  });
});
