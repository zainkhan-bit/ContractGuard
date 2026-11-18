#!/usr/bin/env node
// Rebuilds a release from a clean checkout of a git ref and checks that the result is byte-identical to the
// published artifacts (§19 M9 acceptance: "a dry-run release from a tag reproduces the published artifacts").
//
//   node scripts/release-verify.mjs                 rebuild HEAD and compare with this working copy's packs
//   node scripts/release-verify.mjs --ref v1.0.0    rebuild the tag and compare with the tarballs on npm
//
// Exits 1 when any tarball differs.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const PACKAGES = ['core', 'openapi', 'engine', 'reporters', 'app', 'cli'];
const argv = process.argv.slice(2);
const refIndex = argv.indexOf('--ref');
const ref = refIndex === -1 ? 'HEAD' : argv[refIndex + 1];
const win = process.platform === 'win32';
const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: win, env: { ...process.env, CI: 'true' } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function packAll(repo, dest) {
  mkdirSync(dest, { recursive: true });
  const out = new Map();
  for (const p of PACKAGES) {
    const before = new Set(readdirSync(dest));
    sh('pnpm', ['pack', '--pack-destination', dest], join(repo, 'packages', p));
    const file = readdirSync(dest).find((f) => !before.has(f));
    const pkg = JSON.parse(readFileSync(join(repo, 'packages', p, 'package.json'), 'utf8'));
    out.set(pkg.name, { version: pkg.version, file: join(dest, file), sha256: sha(join(dest, file)) });
  }
  return out;
}

const work = mkdtempSync(join(tmpdir(), 'cg-verify-'));
try {
  const commit = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  console.log(`Rebuilding ${ref} (${commit.slice(0, 12)}) from a clean clone…`);
  const clone = join(work, 'clone');
  sh('git', ['clone', '--quiet', '--no-local', root, clone], root);
  sh('git', ['checkout', '--quiet', commit], clone);
  sh('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], clone);
  sh('pnpm', ['build'], clone);
  const rebuilt = packAll(clone, join(work, 'rebuilt'));

  let reference;
  if (refIndex === -1) {
    console.log('Comparing with packs of this working copy (run pnpm build first)…');
    reference = packAll(root, join(work, 'local'));
  } else {
    console.log('Comparing with the tarballs published on npm…');
    reference = new Map();
    const dl = join(work, 'npm');
    mkdirSync(dl);
    for (const [name, r] of rebuilt) {
      const file = sh('npm', ['pack', `${name}@${r.version}`, '--pack-destination', dl, '--silent'], dl)
        .trim()
        .split('\n')
        .pop();
      reference.set(name, { version: r.version, file: join(dl, file), sha256: sha(join(dl, file)) });
    }
  }

  let ok = true;
  for (const [name, r] of rebuilt) {
    const other = reference.get(name);
    const same = other?.sha256 === r.sha256;
    ok &&= same;
    console.log(
      `${same ? '✓' : '✗'} ${name}@${r.version}  ${r.sha256.slice(0, 16)}${same ? '' : ` ≠ ${other?.sha256.slice(0, 16) ?? 'missing'}`}`,
    );
  }
  if (!ok) {
    console.error('Release artifacts are not reproducible.');
    process.exitCode = 1;
  } else {
    console.log('All release artifacts are reproducible.');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
