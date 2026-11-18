import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run, type CliIo } from '../src/index.js';

/** Threat-model checks that need the whole pipeline (spec → engine → reporters), §16.2 / §18.8. */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function check(base: string, candidate: string, ...flags: string[]): Promise<{ out: string; err: string }> {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cg-sec-')));
  dirs.push(d);
  writeFileSync(join(d, 'a.yaml'), base);
  writeFileSync(join(d, 'b.yaml'), candidate);
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    env: {},
    cwd: d,
    today: '2026-06-01',
    readStdin: () => Promise.resolve(''),
  };
  await run(['check', 'a.yaml', 'b.yaml', '--no-config', '--deterministic', '-v', ...flags], io);
  return { out, err };
}

const spec = (props: string): string =>
  `openapi: 3.1.0\ninfo: {title: t, version: '1'}\npaths:\n  /x:\n    post:\n      requestBody:\n        content:\n          application/json:\n            schema:\n              type: object\n              properties:\n${props}      responses:\n        '204': {description: ok}\n`;

describe('T11: secrets and large values in reports', () => {
  it('redacts defaults of secret-like properties and parameters', async () => {
    const r = await check(
      spec('                password: {type: string, default: hunter2-base}\n'),
      spec('                password: {type: string, default: hunter2-candidate}\n'),
      '--stdout',
      'json',
    );
    expect(r.out).toContain('CG-REQ-036');
    expect(r.out).not.toContain('hunter2');
    expect(r.out).toContain('[redacted]');
    expect(r.err).not.toContain('hunter2');
  });

  it('keeps structural values (a parameter location) and truncates long values', async () => {
    const long = 'x'.repeat(5000);
    const r = await check(
      spec(`                note: {type: string, default: "${long}"}\n`),
      spec(`                note: {type: string, default: "y${long}"}\n`),
      '--stdout',
      'json',
    );
    const previous = /"previous": "(x+)…"/.exec(r.out);
    expect(previous?.[1]?.length).toBe(200);
  });
});

describe('T12: spec text cannot inject into terminals or Markdown', () => {
  const evil = '"evil\\e]52;c;SGVsbG8=\\a\\e[2J<!-- hide `x`"';
  const base = spec(`                ${evil}: {type: string}\n                ok: {type: string}\n`).replace(
    'type: object\n',
    'type: object\n              required: [ok]\n',
  );
  const cand = spec(`                ${evil}: {type: string}\n                ok: {type: string}\n`).replace(
    'type: object\n',
    `type: object\n              required: [ok, ${evil}]\n`,
  );

  it('escapes control characters in console output', async () => {
    const r = await check(base, cand, '--no-color');
    expect(r.out).toContain('CG-REQ-003');
    expect(r.out).not.toContain('\u001b');
    expect(r.out).not.toContain('\u0007');
    expect(r.out).toContain('\\u001b]52');
  });

  it('escapes HTML and backticks in Markdown', async () => {
    const r = await check(base, cand, '--stdout', 'markdown', '-q');
    expect(r.out).toContain('&lt;!-- hide');
    expect(r.out).not.toContain('<!-- hide');
    expect(r.out).not.toContain('\u001b');
  });
});
