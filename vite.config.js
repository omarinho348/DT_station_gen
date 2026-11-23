import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
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
