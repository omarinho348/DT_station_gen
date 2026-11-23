#!/usr/bin/env node
// Visual acceptance tests: renders one of our compiled lines (generated/<line>/) and the hand-built
// REFERENCE line (app/dev/referenceLine.js for the printer line, Phase 4; referenceLubricant.js for
// the lubricant line, Phase 5; both from the read-only export in reference/_src) from the same
// cameras, at the same moments, under the same lights, and compares them pixel by pixel. Views and
// pages per line: scripts/visual-views.js.
//
//   npm run visual                                   -> the printer line, every view
//   npm run visual -- st3-262 line-wide-500          -> only the named views
//   npm run visual -- --line lubricant-line [views]  -> the lubricant line
//   (from PowerShell, npm drops the options: run node scripts/visual-compare.mjs --line … instead)
//
// Writes
//   tests/golden/lines/<line>/<view>.png            our render (golden)
//   tests/golden/lines/<line>/<view>.reference.png  the reference render
//   benchmarks/results/visual/<line>/<view>.diff.png  differing pixels in red
//   benchmarks/results/<line>-visual.json           numbers per view (read by the tests)
//
// One page load per source: the page is opened frozen at t = 0 and moved forward view by view
// with window.__twinView (TwinPage.js), so the views must be in time order.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startVite, screenshot } from './screenshot.js';
import { decodePng, encodePng, diffImages } from './png.js';
import { LINES } from './visual-views.js';

const SIZE = { width: 1600, height: 900 };
const TOLERANCE = 32; // a pixel differs when a colour channel is off by more than this (0–255)

const args = process.argv.slice(2);
const lineAt = args.indexOf('--line');
const LINE = lineAt >= 0 ? args[lineAt + 1] : 'printer-line';
const config = LINES[LINE];
if (!config) {
  console.error(`Unknown line "${LINE}". Lines: ${Object.keys(LINES).join(', ')}`);
  process.exit(1);
}
const VIEWS = config.views;
const SOURCES = {
  ours: { query: config.ours, file: (id) => join('tests', 'golden', 'lines', LINE, `${id}.png`) },
  reference: { query: config.reference, file: (id) => join('tests', 'golden', 'lines', LINE, `${id}.reference.png`) },
};

const only = args.filter((_, i) => lineAt < 0 || (i !== lineAt && i !== lineAt + 1));
const unknown = only.filter((id) => !VIEWS.some((v) => v.id === id));
if (unknown.length) {
  console.error(`Unknown view(s): ${unknown.join(', ')}
Views: ${VIEWS.map((v) => v.id).join(', ')}`);
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
  about: `Written by scripts/visual-compare.mjs (npm run visual${LINE === 'printer-line' ? '' : ` -- --line ${LINE}`}). Our compiled ${LINE} vs the reference, same camera, moment and lights. Do not edit by hand.`,
  size: SIZE,
  tolerance: TOLERANCE,
  views: ordered,
}, null, 2)}\n`);
console.log(`\nResults: ${resultsFile}; diff images: ${diffDir}`);
