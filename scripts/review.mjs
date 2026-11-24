#!/usr/bin/env node
// The deterministic reviewer from the command line (agents/reviewer/deterministic.js): every check
// that can be done in code, run on factory.json files. Exit code 1 when any file has an error.
// Runs inside a Vite SSR module graph, as the compiler does (the catalog loads through
// import.meta.glob); nothing is served.
//
//   npm run review                                  -> every spec/examples/*.factory.json
//   npm run review -- path/to/x.factory.json [...]  -> only those
//   npm run review -- --json x.factory.json         -> the findings as JSON
//   npm run review -- --no-play                     -> skip playing the runs (about 30 s for the examples)
//   npm run review -- --no-compiled                 -> skip importing and building the compiled files
//   (from PowerShell, npm drops the options: run node scripts/review.mjs … instead)
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const play = !args.includes('--no-play');
const compiled = !args.includes('--no-compiled');
let inputs = args.filter((a) => !a.startsWith('--'));
if (!inputs.length) {
  inputs = readdirSync(join(ROOT, 'spec/examples')).filter((n) => n.endsWith('.factory.json')).map((n) => join('spec/examples', n));
}
const posix = (p) => p.replace(/\\/g, '/');

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  appType: 'custom',
  cacheDir: 'node_modules/.vite-compile',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, entries: [] },
});
let failed = 0;
const all = {};
try {
  const { registry } = await server.ssrLoadModule('/lib/components/index.js');
  const { preloadComponentAssets } = await server.ssrLoadModule('/lib/core/assets.js');
  await server.ssrLoadModule('/lib/products/index.js');
  await server.ssrLoadModule('/lib/ops/index.js');
  await preloadComponentAssets(registry); // the geometry check builds the line (GLB models included)
  const { reviewAll, formatFindings } = await server.ssrLoadModule('/agents/reviewer/deterministic.js');
  for (const input of inputs) {
    const path = resolve(ROOT, input);
    const source = posix(relative(ROOT, path));
    let result;
    try {
      result = await reviewAll(registry, JSON.parse(readFileSync(path, 'utf8')), {
        play, compiled, root: ROOT, source, importModule: (p) => server.ssrLoadModule(p),
      });
    } catch (error) {
      result = { ok: false, findings: [{ check: 'file', severity: 'error', path: '(file)', message: error.message }], counts: { error: 1, warning: 0, info: 0 } };
    }
    if (!result.ok) failed += 1;
    if (json) all[source] = { ok: result.ok, counts: result.counts, findings: result.findings };
    else console.log(formatFindings(result, { title: source }));
  }
} finally {
  await server.close();
}
if (json) console.log(JSON.stringify(all, null, 2));
process.exit(failed ? 1 : 0);
