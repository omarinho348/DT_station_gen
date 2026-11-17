#!/usr/bin/env node
// Golden screenshots: one PNG per registered component at default parameters (Claude.md §9),
// written to tests/golden/components/<type>.png, and one per product stage, written to
// tests/golden/products/<type>-<stage>.png. Uses the gallery's UI-free golden mode.
//
//   npm run golden                 -> every component and product
//   npm run golden -- stackLight   -> only the named ones
//
// Generic: the lists come from the registry, so new components / products are picked up automatically.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startVite, screenshot } from './screenshot.js';

const only = process.argv.slice(2);
const vite = await startVite();
let failed = 0;
let total = 0;
try {
  const { registry } = await vite.server.ssrLoadModule('/lib/components/index.js');
  await vite.server.ssrLoadModule('/lib/products/index.js');
  const wanted = (t) => !only.length || only.includes(t);
  const shots = [
    ...registry.components().filter((d) => wanted(d.type)).map((d) => ({ type: d.type, name: d.type, dir: 'components', query: '' })),
    ...registry.products().filter((d) => wanted(d.type)).flatMap((d) => d.stages.map((stage) => ({ type: d.type, name: `${d.type}-${stage}`, dir: 'products', query: `&stage=${stage}` }))),
  ];
  const known = [...registry.components(), ...registry.products()].map((d) => d.type);
  const unknown = only.filter((t) => !known.includes(t));
  if (unknown.length) throw new Error(`Unknown component / product type(s): ${unknown.join(', ')}`);
  total = shots.length;

  for (const shot of shots) {
    const dir = join('tests', 'golden', shot.dir);
    await mkdir(dir, { recursive: true });
    const started = Date.now();
    try {
      const { out, logs } = await screenshot({
        url: `${vite.base}/#/gallery/${shot.type}?golden=1${shot.query}`,
        out: join(dir, `${shot.name}.png`),
        width: 1200,
        height: 900,
        ready: 'window.__appReady === true',
        settle: 3,
        timeout: 90000,
      });
      for (const l of logs.filter((l) => !l.includes('favicon'))) console.warn(`  ${l}`);
      console.log(`✓ ${shot.name}  (${((Date.now() - started) / 1000).toFixed(0)} s)  ${out}`);
    } catch (e) {
      failed += 1;
      console.error(`✗ ${shot.name}: ${e.message}`);
    }
  }
  console.log(`\n${total - failed}/${total} golden screenshots written to tests/golden`);
} finally {
  await vite.server.close();
}
process.exit(failed ? 1 : 0);
