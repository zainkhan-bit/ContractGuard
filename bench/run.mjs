#!/usr/bin/env node
// Benchmarks (§16.5, NFR-03): a synthetic API of 1,000 operations and 2,000 component schemas (~5 MB YAML, and the
// same as JSON), compared in a fresh process through the CLI. Reports wall time and peak RSS per scenario.
//   node bench/run.mjs [--runs 3] [--json bench/results.json]
// Run `pnpm build` first.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const runs = Number(argv.includes('--runs') ? argv[argv.indexOf('--runs') + 1] : '3');
const jsonOut = argv.includes('--json') ? resolve(argv[argv.indexOf('--json') + 1]) : undefined;

/** A deterministic synthetic API. `variant` applies a few changes of each kind. */
/**
 * A deterministic synthetic API. `variant` applies a few changes of each kind. With `chain`, every schema
 * references the next one (one 2,000-schema cycle: a pathological graph for the budget scenario); otherwise
 * references form short chains of five, as in real APIs.
 */
function api(ops, schemas, variant, chain = false) {
  const doc = {
    openapi: '3.1.0',
    info: { title: 'Bench', version: variant ? '2.0.0' : '1.0.0' },
    paths: {},
    components: { schemas: {} },
  };
  for (let i = 0; i < schemas; i++) {
    const props = {};
    for (let p = 0; p < 12; p++) {
      props[`field_${String(p)}`] =
        p % 4 === 0
          ? { type: 'string', maxLength: 255, description: `Field ${String(p)} of schema ${String(i)}. `.repeat(3) }
          : p % 4 === 1
            ? { type: 'integer', minimum: 0, maximum: variant && i % 97 === 0 ? 500 : 1000 }
            : p % 4 === 2
              ? chain || i % 5 !== 4
                ? { $ref: `#/components/schemas/S${String((i + 1) % schemas)}` }
                : { type: 'string', format: 'uuid' }
              : {
                  type: 'array',
                  items: { type: 'string', enum: ['a', 'b', 'c', ...(variant && i % 89 === 0 ? ['d'] : [])] },
                };
    }
    if (variant && i % 113 === 0) delete props.field_0;
    doc.components.schemas[`S${String(i)}`] = {
      type: 'object',
      required: ['field_0', 'field_1'],
      properties: props,
      description: `Schema ${String(i)}`,
    };
  }
  for (let i = 0; i < ops; i++) {
    const path = `/resources${String(Math.floor(i / 4))}/{id}/items${String(i % 4)}`;
    doc.paths[path] = {
      get: {
        operationId: `op${String(i)}`,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: variant && i % 211 === 0, schema: { type: 'integer', maximum: 100 } },
        ],
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: `#/components/schemas/S${String((i * 2) % schemas)}` } } },
          },
          404: { description: 'not found' },
        },
      },
    };
  }
  return doc;
}

function toYaml(v, indent = '') {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const next = `${indent}  `;
  if (Array.isArray(v))
    return v.length === 0 ? '[]' : v.map((x) => `\n${indent}- ${toYaml(x, next).replace(/^\n\s*/, '')}`).join('');
  const keys = Object.keys(v);
  if (keys.length === 0) return '{}';
  return keys
    .map(
      (k) =>
        `\n${indent}${JSON.stringify(k)}: ${typeof v[k] === 'object' && v[k] !== null ? toYaml(v[k], next) : toYaml(v[k])}`,
    )
    .join('');
}

const work = mkdtempSync(join(tmpdir(), 'cg-bench-'));
const results = [];
try {
  const base = api(1000, 2000, false);
  const cand = api(1000, 2000, true);
  writeFileSync(join(work, 'base.yaml'), `${toYaml(base).trimStart()}\n`);
  writeFileSync(join(work, 'cand.yaml'), `${toYaml(cand).trimStart()}\n`);
  writeFileSync(join(work, 'base.json'), JSON.stringify(base, null, 2));
  writeFileSync(join(work, 'cand.json'), JSON.stringify(cand, null, 2));
  writeFileSync(join(work, 'chain-base.json'), JSON.stringify(api(1000, 2000, false, true)));
  writeFileSync(join(work, 'chain-cand.json'), JSON.stringify(api(1000, 2000, true, true)));
  const cli = join(root, 'packages/cli/dist/index.js');
  // Measures one CLI run in a fresh process: wall time and the process's own peak RSS.
  const probe = `const t=performance.now();const {run}=await import(${JSON.stringify(cli)});let o='';const code=await run(process.argv.slice(1),{stdout:{write:(s)=>{o+=s}},stderr:{write:()=>{}},env:{},cwd:${JSON.stringify(work)},today:'2026-01-01',readStdin:async()=>''});const r=o===''?undefined:JSON.parse(o)[0];console.log(JSON.stringify({code,ms:Math.round(performance.now()-t),rssMb:Math.round(process.resourceUsage().maxRSS/1024),undetermined:r?.summary.byClassification.undetermined??0}))`;
  const scenarios = [
    ['YAML, ~5 MB per side', 'base.yaml', 'cand.yaml'],
    ['JSON, same API', 'base.json', 'cand.json'],
    ['YAML, self-comparison', 'base.yaml', 'base.yaml'],
    ['Pathological 2,000-ref cycle', 'chain-base.json', 'chain-cand.json'],
  ];
  const size = (f) =>
    (
      execFileSync('wc', ['-c', join(work, f)], { encoding: 'utf8' })
        .trim()
        .split(/\s+/)[0] /
      1024 /
      1024
    ).toFixed(1);
  for (const [name, a, b] of scenarios) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const out = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', probe, 'check', a, b, '--no-config', '-q', '--stdout', 'json', '-f', 'json'],
        { encoding: 'utf8', maxBuffer: 1 << 28 },
      );
      samples.push(JSON.parse(out.trim().split('\n').pop()));
    }
    const ms = samples.map((s) => s.ms).sort((x, y) => x - y);
    const r = {
      scenario: name,
      sizeMb: Number(size(a)),
      medianMs: ms[Math.floor(ms.length / 2)],
      maxRssMb: Math.max(...samples.map((s) => s.rssMb)),
      exit: samples[0].code,
      undetermined: samples[0].undetermined,
    };
    results.push(r);
    console.log(
      `${name.padEnd(26)} ${String(r.sizeMb).padStart(5)} MB  median ${String(r.medianMs).padStart(6)} ms  peak RSS ${String(r.maxRssMb).padStart(5)} MB  exit ${String(r.exit)}  undetermined ${String(r.undetermined)}`,
    );
  }
} finally {
  if (process.env.CG_BENCH_KEEP === undefined) rmSync(work, { recursive: true, force: true });
  else console.log(`kept ${work}`);
}
if (jsonOut !== undefined)
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2)}\n`,
  );
