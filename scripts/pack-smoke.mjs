#!/usr/bin/env node
// Packs every publishable package, installs the tarballs into an empty project and runs the published
// binary through npx, the way a user would. Run after `pnpm build`. Exits non-zero on any mismatch.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packages = ['core', 'openapi', 'engine', 'reporters', 'app', 'cli'];
const win = process.platform === 'win32';
const work = mkdtempSync(join(tmpdir(), 'cg-pack-'));
const tgz = join(work, 'tgz');
const proj = join(work, 'proj');
mkdirSync(tgz);
mkdirSync(proj);

const sh = (cmd, args, cwd, opts = {}) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: win, env: { ...process.env, NO_COLOR: '1', CI: '' }, ...opts });

function must(r, what) {
  if (r.status !== 0) {
    console.error(`✗ ${what} (exit ${String(r.status)})\n${r.stdout ?? ''}\n${r.stderr ?? ''}`);
    process.exit(1);
  }
  return r;
}

try {
  for (const p of packages)
    must(sh('pnpm', ['pack', '--pack-destination', tgz], join(root, 'packages', p)), `pack ${p}`);
  const tarballs = readdirSync(tgz).map((f) => join(tgz, f));
  writeFileSync(join(proj, 'package.json'), '{"name":"smoke","private":true}\n');
  must(sh('npm', ['install', '--no-audit', '--no-fund', ...tarballs], proj), 'npm install tarballs');

  const base = `openapi: 3.1.0
info: {title: Smoke, version: 1.0.0}
paths:
  /items/{id}:
    get:
      parameters:
        - {name: id, in: path, required: true, schema: {type: string}}
      responses:
        '200': {description: ok}
`;
  writeFileSync(join(proj, 'base.yaml'), base);
  writeFileSync(join(proj, 'same.yaml'), base);
  writeFileSync(join(proj, 'candidate.yaml'), base.replace('/items/{id}', '/things/{id}'));

  const npx = (...args) => sh('npx', ['--no-install', 'contractguard', ...args], proj);
  const expect = (r, code, what) => {
    if (r.status !== code) {
      console.error(`✗ ${what}: expected exit ${String(code)}, got ${String(r.status)}\n${r.stdout}\n${r.stderr}`);
      process.exit(1);
    }
    console.log(`✓ ${what}`);
  };

  expect(npx('--version'), 0, '--version');
  expect(npx('explain', 'CG-API-001'), 0, 'explain');
  expect(npx('validate', 'base.yaml', '--no-config'), 0, 'validate');
  expect(npx('check', 'base.yaml', 'same.yaml', '--no-config'), 0, 'check (compatible)');
  const breaking = npx('check', 'base.yaml', 'candidate.yaml', '--no-config', '--stdout', 'json');
  expect(breaking, 1, 'check (breaking)');
  JSON.parse(breaking.stdout);
  console.log('✓ --stdout json parses');
  expect(npx('check', 'base.yaml', 'missing.yaml', '--no-config'), 2, 'check (missing input)');
  expect(npx('check', '--bogus'), 3, 'unknown option');
  const schema = execFileSync(
    process.execPath,
    ['-e', "console.log(require.resolve('@contractguard/app/schemas/config.v1.json'))"],
    {
      cwd: proj,
      encoding: 'utf8',
    },
  );
  console.log(`✓ config schema exported: ${schema.trim()}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
