import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { reviewApi } from './server/reviewApi.js';
import { llmApi } from './server/llmApi.js';
import { builderApi } from './server/builderApi.js';

// Dev only: the reference lubricant factory (app/dev/referenceLubricant.js) loads its stretch
// wrapper from a STEP file through occt-import-js, which this project does not carry. Its import of
// AssetWrapMachine.js is pointed at our stand-in (our procedural wrapper, the same in both renders).
const WRAP_STUB = fileURLToPath(new URL('./app/dev/referenceWrapStub.js', import.meta.url));
const referenceStubs = {
  name: 'reference-stubs',
  enforce: 'pre',
  resolveId(id, importer, options) {
    // Browser only: scripts/reference-timing-lubricant.mjs (SSR) brings its own timing stub.
    if (options?.ssr) return null;
    if (id.endsWith('/AssetWrapMachine.js') && importer?.replace(/\\/g, '/').includes('/reference/_src/')) return WRAP_STUB;
    return null;
  },
};

export default defineConfig({
  // Dev server only: /api/review (the deterministic reviewer), /api/llm/status (budget, key, models),
  // /api/builder (the Builder, one approval gate at a time).
  plugins: [referenceStubs, reviewApi(), llmApi(), builderApi()],
  server: {
    port: 5173,
    strictPort: true,
    // Builder drafts are written while the page shows an older one: each revision has its own folder
    // (new URLs, loaded by dynamic import), so the watcher has nothing to reload there. The ledger,
    // cache and session in .agent-cache/ are no app code either.
    watch: { ignored: ['**/generated/_draft/**', '**/.agent-cache/**'] },
  },
  // Dependencies declared up front, so Vite never discovers them mid-load and re-optimises (which
  // cancels the page load). The reference line (app/dev/referenceLine.js, dev only) imports
  // three's add-ons by their old 'three/examples/jsm/…' names.
  optimizeDeps: {
    include: [
      // three and the glTF loader (lib/core/assets.js) pre-bundled together, so the loader uses the
      // same three instance as everything else (otherwise: "Multiple instances of Three.js").
      'three',
      'three/addons/loaders/GLTFLoader.js',
      'three/examples/jsm/environments/RoomEnvironment.js',
      'three/examples/jsm/geometries/RoundedBoxGeometry.js',
    ],
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
