#!/usr/bin/env node
// Fetches the corpus: a blobless partial clone per source, then only the blobs of the spec versions in use,
// in batches (one round trip per batch instead of one per file).
//   node scripts/corpus/fetch.mjs [--cache corpus/.cache] [--only id,id]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const cache = resolve(root, opt('--cache', 'corpus/.cache'));
const only = opt('--only', '')?.split(',').filter(Boolean) ?? [];
const { sources } = JSON.parse(readFileSync(join(root, 'corpus/sources.json'), 'utf8'));
mkdirSync(cache, { recursive: true });

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

for (const s of sources) {
  if (only.length > 0 && !only.includes(s.id)) continue;
  const dir = join(cache, s.id);
  if (!existsSync(dir)) {
    console.log(`${s.id}: cloning ${s.repo}`);
    const r = spawnSync(
      'git',
      [
        'clone',
        '--quiet',
        '--filter=blob:none',
        '--no-checkout',
        '--depth=1000',
        `https://github.com/${s.repo}.git`,
        dir,
      ],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) {
      console.error(`${s.id}: clone failed, skipped`);
      continue;
    }
  }
  const scope = s.scope ?? s.path;
  const commits = git(dir, 'log', '--format=%H', `-n${String(s.pairs + 1)}`, 'HEAD', '--', scope)
    .split('\n')
    .filter(Boolean);
  // Blobs needed: the root document (or every file under scope) at each commit.
  const oids = new Set();
  for (const c of commits) {
    const list = git(dir, 'ls-tree', '-r', c, '--', scope);
    for (const line of list.split('\n').filter(Boolean)) oids.add(line.split(/\s+/)[2]);
  }
  // GIT_NO_LAZY_FETCH: only test for presence; a lazy fetch here would download blobs one by one.
  const present = spawnSync('git', ['cat-file', '--batch-check'], {
    cwd: dir,
    input: [...oids].join('\n'),
    encoding: 'utf8',
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    maxBuffer: 1 << 26,
  });
  const missing = present.stdout
    .split('\n')
    .filter((l) => l.endsWith(' missing'))
    .map((l) => l.split(' ')[0]);
  for (let i = 0; i < missing.length; i += 250) {
    const batch = missing.slice(i, i + 250);
    const r = spawnSync(
      'git',
      [
        '-c',
        'fetch.negotiationAlgorithm=noop',
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        '--filter=blob:none',
        'origin',
        ...batch,
      ],
      { cwd: dir, stdio: 'inherit' },
    );
    if (r.status !== 0)
      console.error(`${s.id}: fetching ${String(batch.length)} blobs failed; they are fetched lazily instead`);
  }
  writeFileSync(join(dir, '.corpus-commits.json'), `${JSON.stringify({ path: s.path, scope, commits }, null, 2)}\n`);
  console.log(
    `${s.id}: ${String(commits.length)} versions, ${String(oids.size)} blobs (${String(missing.length)} fetched)`,
  );
}
