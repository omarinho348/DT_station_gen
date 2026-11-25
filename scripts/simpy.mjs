#!/usr/bin/env node
// The SimPy model of a line from the command line (Phase 11): writes simpy/<folder>/model.py, runs it
// with Python and prints the KPIs next to the 3D twin's own timing estimate.
//
//   node scripts/simpy.mjs                              every spec/examples/*.factory.json
//   node scripts/simpy.mjs path/to/x.factory.json       those
//   node scripts/simpy.mjs --line <id>                  lines/<id>/factory.json
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let inputs = args.includes('--line') ? [join('lines', args[args.indexOf('--line') + 1], 'factory.json')] : args.filter((a) => a.endsWith('.json'));
if (!inputs.length) inputs = readdirSync(join(ROOT, 'spec/examples')).filter((n) => n.endsWith('.factory.json')).map((n) => join('spec/examples', n));

const server = await createServer({
  root: ROOT, logLevel: 'error', appType: 'custom', cacheDir: 'node_modules/.vite-compile',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, entries: [] },
});
let failed = 0;
try {
  const { registry } = await server.ssrLoadModule('/lib/components/index.js');
  await server.ssrLoadModule('/lib/products/index.js');
  await server.ssrLoadModule('/lib/ops/index.js');
  const { preloadComponentAssets } = await server.ssrLoadModule('/lib/core/assets.js');
  await preloadComponentAssets(registry);
  const { writeModel, runModel } = await server.ssrLoadModule('/server/simpyRun.js');
  for (const input of inputs) {
    const path = resolve(ROOT, input);
    const factory = JSON.parse(readFileSync(path, 'utf8'));
    try {
      const { dir, data } = writeModel({ root: ROOT, registry, factory, source: relative(ROOT, path).replace(/\\/g, '/') });
      const r = await runModel(dir);
      const k = r.kpis;
      console.log(`\n${data.title} (${relative(ROOT, dir).replace(/\\/g, '/')}/): ${k.finished ? 'finished' : 'NOT finished'} in ${r.seconds.toFixed(1)} s, ${r.trace.length} events`);
      console.log(`  run of ${k.runSize}: makespan ${k.makespan.toFixed(1)} s (twin estimate ${data.planned.runTime.toFixed(1)} s) · out ${k.unitsOut}, good ${k.goodUnits}, rejects ${k.rejects.count}`);
      console.log(`  throughput ${k.steadyPerHour?.toFixed(1) ?? "-"}/h once full (${k.throughputPerHour.toFixed(1)}/h over the run) · takt achieved ${k.taktAchieved?.toFixed(2) ?? '-'} s (planned ${k.taktPlanned.toFixed(2)} s, bottleneck ${k.bottleneckPlanned.kind} ${k.bottleneckPlanned.id})`);
      console.log(`  lead time ${k.leadTime?.mean.toFixed(1) ?? '-'} s (min ${k.leadTime?.min.toFixed(1) ?? '-'}, max ${k.leadTime?.max.toFixed(1) ?? '-'}) · WIP mean ${k.wip.mean.toFixed(2)}, max ${k.wip.max}`);
      console.log(`  utilisation ${Object.entries(k.utilisation).map(([s, u]) => `${s} ${Math.round(u * 100)}%`).join(', ')}`);
      if (!k.finished) failed += 1;
    } catch (error) {
      failed += 1;
      console.log(`\n${input}: ${error.message}`);
    }
  }
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
