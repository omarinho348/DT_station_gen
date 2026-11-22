#!/usr/bin/env node
// Compiles factory.json files into readable Three.js files under generated/<line>/ (one file per
// station plus line.js). The library loads its catalog through Vite (import.meta.glob), so the
// compiler runs inside a Vite SSR module graph; nothing is served.
//
//   npm run compile                                   -> every spec/examples/*.factory.json
//   npm run compile -- path/to/x.factory.json [...]   -> only those
//   npm run compile -- --draft x.factory.json         -> generated/_draft/<line>/ (previews)
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const draft = args.includes('--draft');
let inputs = args.filter((a) => !a.startsWith('--'));
if (!inputs.length) {
  inputs = readdirSync(join(ROOT, 'spec/examples')).filter((n) => n.endsWith('.factory.json')).map((n) => join('spec/examples', n));
}
const outRoot = join(ROOT, 'generated', ...(draft ? ['_draft'] : []));
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
try {
  const { registry } = await server.ssrLoadModule('/lib/components/index.js');
  await server.ssrLoadModule('/lib/products/index.js');
  await server.ssrLoadModule('/lib/ops/index.js');
  const { compileFactory } = await server.ssrLoadModule('/compiler/emit.js');
  const { writeCompiled } = await server.ssrLoadModule('/compiler/write.js');
  for (const input of inputs) {
    const path = resolve(ROOT, input);
    const source = posix(relative(ROOT, path));
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      // lib/ as seen from generated/<line>/ (one level deeper for drafts).
      const libPath = posix(relative(join(outRoot, 'line'), join(ROOT, 'lib')));
      const compiled = compileFactory(registry, data, { source, libPath });
      const r = writeCompiled(compiled, outRoot);
      console.log(`${source} → ${posix(relative(ROOT, r.dir))}/: ${compiled.files.length} files (written ${r.written.length}, unchanged ${r.unchanged.length}, removed ${r.removed.length}); takt ${compiled.timing.takt.toFixed(2)} s`);
    } catch (error) {
      failed += 1;
      console.error(`${source}: ${error.message}`);
    }
  }
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
