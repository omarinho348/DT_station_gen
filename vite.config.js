import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  // The reference line (app/dev/referenceLine.js, dev only) imports three's add-ons by their
  // old 'three/examples/jsm/…' names. Declaring them up front stops Vite from discovering them
  // mid-load and re-optimising (which cancels the page load).
  optimizeDeps: {
    include: [
      'three/examples/jsm/environments/RoomEnvironment.js',
      'three/examples/jsm/geometries/RoundedBoxGeometry.js',
    ],
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
