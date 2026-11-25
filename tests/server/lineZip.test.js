// The zip download (server/lineZip.js, /api/lines/<id>/zip; Phase 11): factory.json, history, compiled
// files, the SimPy model, the SDD documents, a README; deterministic for a fixed time.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { compileFactory, lineFolder } from '../../compiler/emit.js';
import { writeCompiled } from '../../compiler/write.js';
import { projectLineStore } from '../../server/lineStore.js';
import { lineZip } from '../../server/lineZip.js';
import { writeModel } from '../../server/simpyRun.js';
import { createLinesService } from '../../server/linesApi.js';
import { createEditor } from '../../agents/editor/editor.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const time = new Date('2026-11-24T12:00:00Z');

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'zip-'));
  mkdirSync(join(root, 'spec', 'examples'), { recursive: true });
  copyFileSync('spec/examples/bottling-line.factory.json', join(root, 'spec', 'examples', 'bottling-line.factory.json'));
  const store = projectLineStore({ root, registry, parseFactory, compileFactory, writeCompiled });
  store.create('juice', bottling, { by: 'owner', message: 'copied' });
  return { root, store };
}

describe('the zip download', () => {
  it('holds the line\'s factory.json, history, compiled files, SimPy model, SDD documents and a README; deterministic', () => {
    const { root, store } = setup();
    writeModel({ root, registry, factory: store.load('juice').factory });
    mkdirSync(join(root, 'sdd', 'juice'), { recursive: true });
    writeFileSync(join(root, 'sdd', 'juice', 'plan.md'), '# Plan\n');
    writeFileSync(join(root, 'simpy', 'FORMAT.md'), '# SimPy output format\n');
    const z = lineZip({ root, id: 'juice', folder: lineFolder('juice'), history: store.history('juice'), time });
    const files = unzipSync(z.bytes);
    expect(Object.keys(files).sort()).toEqual([
      'juice/README.md', 'juice/factory.json',
      'juice/generated/cap.js', 'juice/generated/fill1.js', 'juice/generated/fill2.js', 'juice/generated/inspect.js',
      'juice/generated/line.js', 'juice/generated/pack.js', 'juice/generated/rework.js',
      'juice/history.json', 'juice/sdd/plan.md', 'juice/simpy/FORMAT.md', 'juice/simpy/model.py',
    ]);
    expect(JSON.parse(strFromU8(files['juice/factory.json']))).toEqual(store.load('juice').factory);
    expect(JSON.parse(strFromU8(files['juice/history.json']))[0]).toMatchObject({ version: 1, by: 'owner' });
    expect(strFromU8(files['juice/README.md'])).toContain('the single source of truth');
    expect(lineZip({ root, id: 'juice', folder: 'juice', history: store.history('juice'), time }).bytes).toEqual(z.bytes);
    expect(() => lineZip({ root, id: 'nowhere', folder: 'x' })).toThrow(/no line "nowhere"/);
  }, 60000);

  it('GET /api/lines/<id>/zip answers the zip as an attachment', async () => {
    const { root, store } = setup();
    const svc = createLinesService({ root, llm: () => null, load: async () => ({ registry, createEditor, lineStore: store, lineFolder }) });
    const r = await svc.handle({ method: 'GET', path: '/juice/zip' });
    expect(r).toMatchObject({ status: 200, type: 'application/zip', filename: 'juice.zip' });
    expect(Object.keys(unzipSync(r.binary))).toContain('juice/factory.json');
    expect((await svc.handle({ method: 'POST', path: '/juice/zip' })).status).toBe(405);
  }, 60000);
});
