#!/usr/bin/env node
// Writes agents/catalog.json from the registry (lib/catalog.js's catalogIndex): what the agents see
// of the library. A test fails when the file is out of date, or over ~4k tokens.
// The catalog loads through Vite (import.meta.glob), so this runs in a Vite SSR module graph.
//   npm run catalog
import { writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  appType: 'custom',
  cacheDir: 'node_modules/.vite-compile',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, entries: [] },
});
try {
  const { registry } = await server.ssrLoadModule('/lib/components/index.js');
  await server.ssrLoadModule('/lib/products/index.js');
  await server.ssrLoadModule('/lib/ops/index.js');
  const { catalogIndex, catalogTokens } = await server.ssrLoadModule('/lib/catalog.js');
  const catalog = catalogIndex(registry);
  const out = join(ROOT, 'agents', 'catalog.json');
  writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
  const count = Object.values(catalog.components).flat().length;
  console.log(`written agents/catalog.json: version ${catalog.version}, ${count} components, ${catalog.ops.length} ops, ${catalog.products.length} products, ${catalog.shells.length} shells, ≈${catalogTokens(catalog)} tokens`);
} finally {
  await server.close();
}
