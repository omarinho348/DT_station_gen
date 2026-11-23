#!/usr/bin/env node
// Phase 4 visual acceptance test: renders the compiled printer line (generated/printer-line/) and
// the hand-built REFERENCE line (app/dev/referenceLine.js, from the read-only export in
// reference/_src) from the same cameras, at the same moments, under the same lights, and compares
// them pixel by pixel.
//
//   npm run visual                 -> every view
//   npm run visual -- st3-262 line-wide-500   -> only the named views
//
// Writes
//   tests/golden/lines/printer-line/<view>.png            our render (golden)
//   tests/golden/lines/printer-line/<view>.reference.png  the reference render
//   benchmarks/results/visual/printer-line/<view>.diff.png  differing pixels in red
//   benchmarks/results/printer-line-visual.json           numbers per view (read by the tests)
//
// One page load per source: the page is opened frozen at t = 0 and moved forward view by view
// with window.__twinView (TwinPage.js), so the views must be in time order.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVite, screenshot } from './screenshot.js';
import { decodePng, encodePng, diffImages } from './png.js';

const LINE = 'printer-line';
const SIZE = { width: 1600, height: 900 };
const TOLERANCE = 32; // a pixel differs when a colour channel is off by more than this (0–255)

// Station x along the line (lib/line/layout.js; the same pitch as the reference PrinterLineLayout).
const STATION_X = { st1: -14, st2: -8.4, st3: -2.8, st4: 2.8, st5: 8.4, st6: 14 };
// Close-up of one station: the station demo's camera, moved to the station.
const closeUp = (x) => [x + 4.6, 3.3, 5.6, x, 1.0, -0.2];
const LINE_CAM = [0.5, 9.5, 15.5, 0, 0.9, -0.3];
const WIDE_CAM = [0, 15, 24, 0, 0.6, -0.3];

/** Views in time order. Moments are mid-run, when most stations are busy. */
export const VIEWS = [
  { id: 'line-wide-0', t: 0, cam: WIDE_CAM, note: 'empty line before the first unit' },
  ...Object.entries(STATION_X).map(([st, x]) => ({ id: `${st}-262`, t: 262.3, cam: closeUp(x) })),
  { id: 'line-262', t: 262.3, cam: LINE_CAM },
  ...Object.entries(STATION_X).map(([st, x]) => ({ id: `${st}-430`, t: 430, cam: closeUp(x) })),
  { id: 'line-wide-500', t: 500, cam: WIDE_CAM },
  { id: 'st6-760', t: 760, cam: closeUp(STATION_X.st6), note: 'six cartons on the dispatch pallet' },
  { id: 'line-760', t: 760, cam: LINE_CAM },
];

const SOURCES = {
  ours: { query: `line=${LINE}`, file: (id) => join('tests', 'golden', 'lines', LINE, `${id}.png`) },
  reference: { query: 'demo=reference', file: (id) => join('tests', 'golden', 'lines', LINE, `${id}.reference.png`) },
};

const only = process.argv.slice(2);
const unknown = only.filter((id) => !VIEWS.some((v) => v.id === id));
if (unknown.length) {
  console.error(`Unknown view(s): ${unknown.join(', ')}\nViews: ${VIEWS.map((v) => v.id).join(', ')}`);
  process.exit(1);
}
const views = VIEWS.filter((v) => !only.length || only.includes(v.id));

const vite = await startVite();
try {
  for (const [name, source] of Object.entries(SOURCES)) {
    const started = Date.now();
    const { logs } = await screenshot({
      url: `${vite.base}/#/twin?${source.query}&t=0&golden=1`,
      ...SIZE,
      ready: 'window.__appReady === true && typeof window.__twinView === "function"',
      settle: 3,
      timeout: 300000,
      shots: views.map((v) => ({ expr: `window.__twinView(${JSON.stringify({ t: v.t, cam: v.cam })})`, out: source.file(v.id) })),
    });
    for (const l of logs.filter((l) => !l.includes('favicon'))) console.warn(`  ${l}`);
    console.log(`✓ ${name}: ${views.length} views (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
} finally {
  await vite.server.close();
}

// ---- Compare ------------------------------------------------------------------------------------
const resultsFile = join('benchmarks', 'results', `${LINE}-visual.json`);
let previous = {};
try {
  previous = JSON.parse(await readFile(resultsFile, 'utf8')).views ?? {};
} catch { /* first run */ }
const results = { ...previous };
const diffDir = join('benchmarks', 'results', 'visual', LINE);
await mkdir(diffDir, { recursive: true });
for (const v of views) {
  const ours = decodePng(await readFile(SOURCES.ours.file(v.id)));
  const ref = decodePng(await readFile(SOURCES.reference.file(v.id)));
  const { differing, meanDiff, image } = diffImages(ours, ref, { tolerance: TOLERANCE });
  await writeFile(join(diffDir, `${v.id}.diff.png`), encodePng(image));
  results[v.id] = { t: v.t, cam: v.cam, differing: Number(differing.toFixed(5)), meanDiff: Number(meanDiff.toFixed(3)) };
  console.log(`${v.id.padEnd(14)} t ${String(v.t).padStart(6)}  differing ${(differing * 100).toFixed(2).padStart(6)} %  mean |Δ| ${meanDiff.toFixed(2)}`);
}
const ordered = Object.fromEntries(VIEWS.filter((v) => results[v.id]).map((v) => [v.id, results[v.id]]));
await writeFile(resultsFile, `${JSON.stringify({
  about: 'Written by scripts/visual-compare.mjs (npm run visual). Our compiled printer line vs the reference line, same camera, moment and lights. Do not edit by hand.',
  size: SIZE,
  tolerance: TOLERANCE,
  views: ordered,
}, null, 2)}\n`);
console.log(`\nResults: ${resultsFile}; diff images: ${diffDir}`);
