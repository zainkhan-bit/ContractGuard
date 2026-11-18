#!/usr/bin/env node
// Fails when a production dependency of a published package (transitively) is not under an allowed license
// (§20.1, §16.2 T14). Uses `pnpm licenses list`, which reads the installed packages (no network).
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);
const out = execFileSync('pnpm', ['--filter', './packages/*', 'licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const byLicense = JSON.parse(out);
let bad = 0;
let total = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  for (const p of packages) {
    total++;
    if (p.name.startsWith('@zainkhan-bit/contractguard-')) continue;
    if (!ALLOWED.has(license)) {
      bad++;
      console.error(`✗ ${p.name}: ${license}`);
    }
  }
}
if (bad > 0) {
  console.error(
    `${String(bad)} production dependencies have licenses outside the allowlist (${[...ALLOWED].join(', ')}).`,
  );
  process.exit(1);
}
console.log(
  `✓ ${String(total)} production dependencies, all under ${[...new Set(Object.keys(byLicense))].join(', ')}.`,
);
