#!/usr/bin/env node
// Writes benchmarks/coverage.md from benchmarks/coverage.map.json and the registry (Claude.md §10).
// Fails when a catalog entry is unmapped or the map names something the catalog hasn't got.
//
//   node scripts/coverage.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { checkCoverageMap, coverageTable } from './coverage-lib.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The registry as the coverage table needs it (basic ops: the files in lib/ops/basic/). */
export function registryView(registry, root = ROOT) {
  const basic = new Set(readdirSync(join(root, 'lib', 'ops', 'basic')).filter((n) => n.endsWith('.js')).map((n) => n.replace(/\.js$/, '')));
  return {
    components: registry.components().map((d) => ({ type: d.type, category: d.category })),
    ops: registry.ops().map((d) => ({ op: d.op, basic: basic.has(d.op) })),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createServer({
    root: ROOT, logLevel: 'error', appType: 'custom', cacheDir: 'node_modules/.vite-compile',
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] },
  });
  try {
    const { registry } = await server.ssrLoadModule('/lib/components/index.js');
    await server.ssrLoadModule('/lib/ops/index.js');
    const map = JSON.parse(readFileSync(join(ROOT, 'benchmarks', 'coverage.map.json'), 'utf8'));
    const reg = registryView(registry);
    const problems = checkCoverageMap(map, reg);
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exitCode = 1;
    } else {
      const { rows, markdown } = coverageTable(map, reg);
      writeFileSync(join(ROOT, 'benchmarks', 'coverage.md'), markdown);
      console.log(`benchmarks/coverage.md: ${rows.filter((r) => r.level === 'named').length} named, ${rows.filter((r) => r.level === 'basic').length} basic only, ${rows.filter((r) => r.level === 'none').length} none (of ${rows.length})`);
    }
  } finally {
    await server.close();
  }
}
