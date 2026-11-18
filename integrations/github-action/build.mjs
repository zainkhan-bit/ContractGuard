// Bundles the Action into dist/index.js (one ESM file, node24) plus dist/licenses.txt for bundled packages.
// Deterministic: CI rebuilds and fails when dist/ changes (§13.6 packaging).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rolldown } from 'rolldown';

const here = import.meta.dirname;
const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;

const bundle = await rolldown({
  input: join(here, 'src/index.ts'),
  platform: 'node',
  tsconfig: join(here, 'tsconfig.json'),
  transform: { define: { __CONTRACTGUARD_VERSION__: JSON.stringify(version) } },
  // Workspace packages resolve to their built dist/ through package exports.
});
const { output } = await bundle.write({
  file: join(here, 'dist/index.js'),
  format: 'esm',
  minify: true,
  sourcemap: false,
  comments: { legal: false },
  codeSplitting: false,
  banner: '// ContractGuard GitHub Action (bundled). Source: https://github.com/zainkhan-bit/ContractGuard\n',
});
await bundle.close();

// Collect the packages that ended up in the bundle and their licenses.
const modules = output.flatMap((chunk) => (chunk.type === 'chunk' ? Object.keys(chunk.modules) : []));
const packages = new Map();
for (const id of modules) {
  const m = /^(.*[\\/]node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+))[\\/]/.exec(id);
  if (m === null) continue;
  const dir = m[1];
  if (packages.has(dir)) continue;
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (pkg.name.startsWith('@contractguard/')) continue;
    let text = '';
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE']) {
      try {
        text = readFileSync(join(dir, name), 'utf8').trim();
        break;
      } catch {
        // try the next spelling
      }
    }
    packages.set(dir, { name: pkg.name, version: pkg.version, license: pkg.license ?? 'UNKNOWN', text });
  } catch {
    // not a package root
  }
}
const sorted = [...packages.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const licenses = sorted
  .map(
    (p) =>
      `${p.name}@${p.version}\n${p.license}\n${p.text === '' ? '(license text not included in the package)' : p.text}`,
  )
  .join('\n\n-----\n\n');
writeFileSync(join(here, 'dist/licenses.txt'), `${licenses}\n`);
const bytes = readFileSync(join(here, 'dist/index.js')).length;
console.log(
  `dist/index.js ${(bytes / 1024).toFixed(0)} KiB, ${String(sorted.length)} bundled packages: ${sorted.map((p) => `${p.name} (${p.license})`).join(', ')}`,
);
void dirname;
