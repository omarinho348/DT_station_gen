// The line store (server/lineStore.js, Phase 10 step 1): lines/<id>/factory.json with a version per
// change, compiled to generated/<folder>/ (only changed files rewritten), undo as a new version.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { compileFactory } from '../../compiler/emit.js';
import { writeCompiled } from '../../compiler/write.js';
import { createLineStore, projectLineStore, LineStoreError } from '../../server/lineStore.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'lines-'));
  mkdirSync(join(root, 'spec', 'examples'), { recursive: true });
  copyFileSync('spec/examples/bottling-line.factory.json', join(root, 'spec', 'examples', 'bottling-line.factory.json'));
  return root;
}
let clock = 0;
const now = () => `2026-11-24T00:00:${String(clock++ % 60).padStart(2, '0')}Z`;

describe('the line store', () => {
  it('create → save → undo → undo again: versions, patches, the current factory.json, compiled files', () => {
    const root = tempRoot();
    const store = projectLineStore({ root, registry, parseFactory, compileFactory, writeCompiled, now });
    const created = store.create('juice', bottling, { by: 'owner', message: 'from the bottling example' });
    expect(created).toMatchObject({ version: 1, patch: [] });
    expect(created.compiled.folder).toBe('juice');
    expect(existsSync(join(root, 'generated', 'juice', 'line.js'))).toBe(true);
    expect(store.load('juice').factory.line.id).toBe('juice');
    expect(store.list()).toEqual([{ id: 'juice', title: bottling.line.title, version: 1, stations: 5 }]);

    const edited = structuredClone(store.load('juice').factory);
    edited.line.runSize = 12;
    edited.stations[1].title = 'Screw capping';
    const v2 = store.save('juice', edited, { by: 'editor', message: 'longer run, renamed capping', request: 'run 12, call capping Screw capping' });
    expect(v2.version).toBe(2);
    expect(v2.patch).toEqual([{ op: 'replace', path: '/line/runSize', value: 12 }, { op: 'replace', path: '/stations/1/title', value: 'Screw capping' }]);
    // Only the files whose text changed are written.
    expect(v2.compiled.written.sort()).toEqual(['cap.js', 'line.js']);
    expect(v2.compiled.unchanged.length).toBeGreaterThan(2);

    const u = store.undo('juice');
    expect(u.version).toBe(3);
    expect(store.load('juice').factory.line.runSize).toBe(bottling.line.runSize);
    expect(store.undo('juice').version).toBe(4); // the undo undone: back to version 2's content
    expect(store.load('juice').factory.line.runSize).toBe(12);
    const h = store.history('juice');
    expect(h.map((x) => [x.version, x.by, x.ops])).toEqual([[4, 'undo', 2], [3, 'undo', 2], [2, 'editor', 2], [1, 'owner', 0]]);
    expect(h[2]).toMatchObject({ message: 'longer run, renamed capping', request: 'run 12, call capping Screw capping' });
    expect(store.version('juice', 1).line.runSize).toBe(bottling.line.runSize);
  }, 60000);

  it('refuses: an example\'s id, a changed id, an invalid factory, no change, nothing to undo, a bad id', () => {
    const root = tempRoot();
    const store = projectLineStore({ root, registry, parseFactory, compileFactory, writeCompiled, now });
    expect(() => store.create('bottlingLine', bottling, { by: 'owner', message: 'x' })).toThrow(/is an example line's id/);
    store.create('juice', bottling, { by: 'owner', message: 'x' });
    expect(() => store.create('juice', bottling, { by: 'owner', message: 'x' })).toThrow(/already a line "juice"/);
    expect(() => store.save('juice', { ...bottling, line: { ...bottling.line, id: 'other' } }, { by: 'x', message: 'x' })).toThrow(/cannot change/);
    expect(() => store.save('juice', { ...store.load('juice').factory, stations: 'no' }, { by: 'x', message: 'x' })).toThrow();
    expect(() => store.save('juice', store.load('juice').factory, { by: 'x', message: 'x' })).toThrow(/nothing changed/);
    expect(() => store.undo('juice')).toThrow(/nothing to undo/);
    expect(() => store.load('Bad id')).toThrow(LineStoreError);
    expect(() => store.load('nowhere')).toThrow(/no line "nowhere"/);
    expect(store.history('juice')).toHaveLength(1); // nothing written by a refusal
  }, 60000);

  it('without a compiler it only keeps versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'lines-'));
    const store = createLineStore({ root, validate: () => true, now });
    const r = store.create('plain', bottling, { by: 'owner', message: 'x' });
    expect(r.compiled).toBe(null);
    expect(() => store.recompile('plain')).toThrow(/no compiler/);
  });
});
