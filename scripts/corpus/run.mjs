#!/usr/bin/env node
// Runs the real-world corpus (§2.9, §18): for every consecutive version pair of every source
//   1. ContractGuard (library, git sources: relative $refs resolve inside each commit)
//   2. self-comparison check(A, A) on two independent loads → must yield no non-informational finding
//   3. oasdiff `breaking` (JSON), when an oasdiff binary is given
// and compares the two tools per operation. Writes pairs.jsonl and summary.json to the output directory.
//
//   node scripts/corpus/run.mjs --oasdiff /path/to/oasdiff [--cache corpus/.cache] [--out corpus/results/<date>]
//                               [--only id,id] [--jobs 2]
// Run `pnpm build` and scripts/corpus/fetch.mjs first.
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const cache = resolve(root, opt('--cache', 'corpus/.cache'));
const oasdiff = opt('--oasdiff', '');
const only = (opt('--only', '') ?? '').split(',').filter(Boolean);
const jobs = Number(opt('--jobs', '2'));
const today = new Date().toISOString().slice(0, 10);
const out = resolve(root, opt('--out', `corpus/results/${today}`));
mkdirSync(out, { recursive: true });

const dist = (p) => join(root, 'packages', p, 'dist', 'index.js');
const app = await import(dist('app'));
const engine = await import(dist('engine'));
const openapi = await import(dist('openapi'));
const core = await import(dist('core'));

const { sources } = JSON.parse(readFileSync(join(root, 'corpus/sources.json'), 'utf8'));
const LIMITS = {
  ...core.DEFAULT_LIMITS,
  maxDocumentBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxDocuments: 10_000,
};

const opKey = (method, path) =>
  method === undefined || path === undefined ? '(global)' : `${method.toUpperCase()} ${path}`;

/** Loads a git-sourced contract (used for the self-comparison). */
async function loadGit(dir, commit, path) {
  const spec = app.parseSourceSpecifier(`git:${commit}:${path}`, dir).value;
  const opened = await app.openSource(spec);
  if (opened.value === undefined) return undefined;
  const r = await openapi.loadContract(opened.value.rootUri, {
    loader: opened.value.loader,
    policy: {
      root: dir,
      allowRemote: false,
      allowedHosts: [],
      allowedSchemes: ['https'],
      fetchTimeoutMs: 1000,
      maxRemoteBytes: 1,
    },
    limits: LIMITS,
    allowInvalidSpec: true,
    validator: false,
  });
  return r.value?.contract;
}

function run(cmd, args, timeoutMs) {
  return new Promise((done) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1 << 28, encoding: 'utf8' }, (error, stdout, stderr) => {
      done({ code: error === null ? 0 : (error.code ?? 1), killed: error?.killed === true, stdout, stderr });
    });
  });
}

/** Writes one version of the spec to disk for oasdiff (the whole scope directory for split specifications). */
function materialize(dir, commit, source, into) {
  mkdirSync(into, { recursive: true });
  if (source.scope === undefined) {
    const file = join(into, source.path.split('/').pop());
    writeFileSync(file, execFileSync('git', ['show', `${commit}:${source.path}`], { cwd: dir, maxBuffer: 1 << 28 }));
    return file;
  }
  const tar = execFileSync('git', ['archive', '--format=tar', commit, '--', source.scope], {
    cwd: dir,
    maxBuffer: 1 << 30,
  });
  execFileSync('tar', ['-x', '-C', into], { input: tar });
  return join(into, source.path);
}

async function pair(source, dir, base, cand) {
  const rec = { source: source.id, base, candidate: cand };
  // ContractGuard
  const t0 = performance.now();
  const memBefore = process.memoryUsage().rss;
  const r = await app.analyze({
    cwd: dir,
    configPath: false,
    adHoc: { base: `git:${base}:${source.path}`, candidate: `git:${cand}:${source.path}` },
    overrides: { deterministic: true, formats: ['console'] },
    today,
    toolVersion: 'corpus',
  });
  rec.cgMs = Math.round(performance.now() - t0);
  rec.cgRssMb = Math.round(Math.max(process.memoryUsage().rss, memBefore) / 1024 / 1024);
  const result = r.value?.results[0];
  rec.cgStatus = result?.status ?? 'config-error';
  rec.cgDiagnostics = [
    ...new Set((result?.diagnostics ?? r.diagnostics).filter((d) => d.severity === 'error').map((d) => d.code)),
  ];
  rec.cgFindings = (result?.findings ?? [])
    .filter((f) => f.status === 'active')
    .map((f) => ({
      rule: f.ruleId,
      cls: f.classification,
      sev: f.severity,
      op: opKey(f.subject.method, f.subject.path),
      msg: f.message.slice(0, 300),
    }));
  // Self-comparison on two independent loads of the candidate.
  const [a, b] = [await loadGit(dir, cand, source.path), await loadGit(dir, cand, source.path)];
  rec.selfNonInformational =
    a === undefined || b === undefined
      ? null
      : engine
          .checkCompatibility(a, b)
          .findings.filter((f) => f.classification !== 'informational')
          .map((f) => `${f.ruleId} ${f.message.slice(0, 120)}`);
  // oasdiff
  if (oasdiff !== '') {
    const tmp = mkdtempSync(join(tmpdir(), 'cg-corpus-'));
    try {
      const bf = materialize(dir, base, source, join(tmp, 'base'));
      const cf = materialize(dir, cand, source, join(tmp, 'cand'));
      const t1 = performance.now();
      const o = await run(oasdiff, ['breaking', bf, cf, '-f', 'json'], 300_000);
      rec.oaMs = Math.round(performance.now() - t1);
      if (o.code === 0 || o.code === 1) {
        let list = [];
        try {
          list = JSON.parse(o.stdout || '[]') ?? [];
        } catch {
          rec.oaError = 'unparseable output';
        }
        rec.oaFindings = list.map((x) => ({
          id: x.id,
          level: x.level,
          op: opKey(x.operation, x.path),
          text: String(x.text ?? '').slice(0, 300),
        }));
      } else {
        rec.oaError = (o.killed ? 'timeout' : (o.stderr.trim().split('\n').pop() ?? `exit ${String(o.code)}`)).slice(
          0,
          300,
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  // Operation-level comparison of breaking verdicts.
  if (rec.oaFindings !== undefined && rec.cgStatus !== 'input-error') {
    const cgOps = new Set(rec.cgFindings.filter((f) => f.cls === 'breaking').map((f) => f.op));
    const oaOps = new Set(rec.oaFindings.filter((f) => f.level === 3).map((f) => f.op));
    rec.onlyCg = [...cgOps].filter((o) => !oaOps.has(o)).sort();
    rec.onlyOasdiff = [...oaOps].filter((o) => !cgOps.has(o)).sort();
    rec.both = [...cgOps].filter((o) => oaOps.has(o)).sort();
  }
  return rec;
}

async function runSource(source) {
  const dir = join(cache, source.id);
  const meta = join(dir, '.corpus-commits.json');
  if (!existsSync(meta)) {
    console.error(`${source.id}: not fetched (run scripts/corpus/fetch.mjs)`);
    return;
  }
  const { commits } = JSON.parse(readFileSync(meta, 'utf8'));
  for (let i = commits.length - 1; i > 0; i--) {
    const rec = await pair(source, dir, commits[i], commits[i - 1]);
    appendFileSync(join(out, 'pairs.jsonl'), `${JSON.stringify(rec)}\n`);
    const cgB = rec.cgFindings.filter((f) => f.cls === 'breaking').length;
    const oaB = rec.oaFindings?.filter((f) => f.level === 3).length ?? '-';
    console.log(
      `${source.id} ${rec.base.slice(0, 7)}→${rec.candidate.slice(0, 7)} cg=${rec.cgStatus}/${String(cgB)} (${String(rec.cgMs)}ms) oasdiff=${rec.oaError ?? String(oaB)} self=${rec.selfNonInformational === null ? 'n/a' : String(rec.selfNonInformational.length)}`,
    );
  }
}

// Sources run in parallel worker processes (one per job); this process coordinates.
if (process.env.CG_CORPUS_WORKER !== undefined) {
  await runSource(sources.find((s) => s.id === process.env.CG_CORPUS_WORKER));
} else {
  if (!argv.includes('--append')) writeFileSync(join(out, 'pairs.jsonl'), '');
  const queue = sources.filter((s) => only.length === 0 || only.includes(s.id));
  const self = new URL(import.meta.url).pathname;
  // Workers are this script with CG_CORPUS_WORKER set (via env inheritance below).
  const runWorker = (s) =>
    new Promise((done) => {
      const child = execFile(
        process.execPath,
        ['--max-old-space-size=3072', self, ...argv],
        { env: { ...process.env, CG_CORPUS_WORKER: s.id }, maxBuffer: 1 << 28 },
        () => done(),
      );
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    });
  const pool = Array.from({ length: Math.max(1, jobs) }, async () => {
    for (let s = queue.shift(); s !== undefined; s = queue.shift()) await runWorker(s);
  });
  await Promise.all(pool);
  console.log(`Done: ${out}/pairs.jsonl. Summarize with scripts/corpus/report.mjs ${out}`);
}
