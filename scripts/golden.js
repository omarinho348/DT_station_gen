#!/usr/bin/env node
// Golden screenshots: one PNG per registered component at default parameters (Claude.md §9),
// written to tests/golden/components/<type>.png. Uses the gallery's UI-free golden mode.
//
//   npm run golden                 -> every component
//   npm run golden -- stackLight   -> only the named ones
//
// Generic: the list comes from the registry, so new components are picked up automatically.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startVite, screenshot } from './screenshot.js';

const only = process.argv.slice(2);
const vite = await startVite();
let failed = 0;
try {
  const { registry } = await vite.server.ssrLoadModule('/lib/components/index.js');
  const types = registry.components().map((d) => d.type).filter((t) => !only.length || only.includes(t));
  const unknown = only.filter((t) => !types.includes(t));
  if (unknown.length) throw new Error(`Unknown component(s): ${unknown.join(', ')}`);

  const dir = join('tests', 'golden', 'components');
  await mkdir(dir, { recursive: true });
  for (const type of types) {
    const started = Date.now();
    try {
      const { out, logs } = await screenshot({
        url: `${vite.base}/#/gallery/${type}?golden=1`,
        out: join(dir, `${type}.png`),
        width: 1200,
        height: 900,
        ready: 'window.__appReady === true',
        settle: 3,
        timeout: 90000,
      });
      for (const l of logs.filter((l) => !l.includes('favicon'))) console.warn(`  ${l}`);
      console.log(`✓ ${type}  (${((Date.now() - started) / 1000).toFixed(0)} s)  ${out}`);
    } catch (e) {
      failed += 1;
      console.error(`✗ ${type}: ${e.message}`);
    }
  }
  console.log(`\n${types.length - failed}/${types.length} golden screenshots written to ${dir}`);
} finally {
  await vite.server.close();
}
process.exit(failed ? 1 : 0);
