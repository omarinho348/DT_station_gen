// The reviewer's compiled-files check (agents/reviewer/compiled.js, Phase 7 step 4): the compiled
// files are written, imported and built headless, and must build the same line as the IR.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { reviewAll } from '../../agents/reviewer/deterministic.js';
import { reviewCompiled, firstDifference, REVIEW_DIR } from '../../agents/reviewer/compiled.js';

await preloadComponentAssets(registry);

const root = resolve('.');
const load = (name) => JSON.parse(readFileSync(`spec/examples/${name}.factory.json`, 'utf8'));
const of = (r, check) => r.findings.filter((f) => f.check === check);
const quick = { geometry: false, play: false, root };
const leftovers = () => (existsSync(REVIEW_DIR) ? readdirSync(REVIEW_DIR) : []);

describe('compiled files', () => {
  it('each example line: its files import, build headless and are the line its factory.json describes; the files on disk are current', async () => {
    for (const name of ['bottling-line', 'lubricant-line', 'printer-line']) {
      const r = await reviewAll(registry, load(name), { ...quick, source: `spec/examples/${name}.factory.json` });
      const c = of(r, 'compiled');
      expect(c, name).toHaveLength(1);
      expect(c[0]).toMatchObject({ severity: 'info', path: '(compile)' });
      expect(c[0].message).toMatch(/^\d+ compiled files import and build headless, the same line as factory\.json \(\d+ named objects\)$/);
    }
    expect(leftovers()).toEqual([]); // the temporary folders are removed
  }, 120000);

  it('files on disk the factory.json no longer compiles to: a warning naming them (npm run compile)', async () => {
    const f = load('bottling-line');
    f.stations[1].title = 'Capping (new)';
    const c = await reviewCompiled(registry, f, { root, source: 'spec/examples/bottling-line.factory.json' });
    expect(c[0]).toMatchObject({ severity: 'warning', path: '(compile)', hint: 'npm run compile' });
    expect(c[0].message).toBe('generated/bottling-line/ is not what this factory.json compiles to now (cap.js, line.js)'); // line.js lists the titles in its header
    expect(c[1].severity).toBe('info'); // the new files themselves are fine
  });

  it('files that do not import, or a line that does not build from them: errors', async () => {
    const f = load('bottling-line');
    const noImport = await reviewCompiled(registry, f, { root, importModule: async () => { throw new Error('Unexpected token'); } });
    expect(noImport).toEqual([expect.objectContaining({ severity: 'error', message: 'the compiled files do not import: Unexpected token' })]);
    const noBuild = await reviewCompiled(registry, f, { root, importModule: async () => ({ createLine: () => { throw new Error('station "cap": no machines'); } }) });
    expect(noBuild).toEqual([expect.objectContaining({ severity: 'error', message: 'the compiled line does not build headless: station "cap": no machines' })]);
    expect(leftovers()).toEqual([]);
  });

  it('a compiled line that differs from the IR: an error saying where (here: a station moved in the built line)', async () => {
    const f = load('bottling-line');
    const c = await reviewCompiled(registry, f, {
      root,
      importModule: async (p) => {
        const mod = await import(/* @vite-ignore */ p);
        return { createLine: (o) => { const line = mod.createLine(o); line.stations[2].root.position.x += 0.5; return line; } };
      },
    });
    expect(c).toHaveLength(1);
    expect(c[0].severity).toBe('error');
    expect(c[0].message).toMatch(/^the compiled line is not the line factory\.json describes: scene object #\d+: C Capping\|1\|[-\d.]+,0,0 vs C Capping\|1\|[-\d.]+,0,0$/);
  });

  it('a factory.json the data checks refuse is not compiled (reviewAll stops at the data findings)', async () => {
    const f = load('bottling-line');
    f.graph.edges[1].from = 'cap.side';
    const r = await reviewAll(registry, f, quick);
    expect(r.ok).toBe(false);
    expect(of(r, 'compiled')).toEqual([]);
  });

  it('firstDifference names the first differing path', () => {
    expect(firstDifference({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(null);
    expect(firstDifference({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] })).toBe('b.1: 2 vs 3');
    expect(firstDifference({ a: { x: 1 } }, { a: {} })).toBe('a.x: 1 vs undefined');
  });
});
