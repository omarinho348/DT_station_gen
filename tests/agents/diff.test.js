// JSON diffs as RFC 6902 patches (agents/diff.js, step 8.5): the approval panel's change list, and later
// the Editor's patches.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { diffJson, applyPatch, labelPath, describeDiff, jsonEqual, parsePointer, valueAt, PatchError } from '../../agents/diff.js';

const load = (name) => JSON.parse(readFileSync(`spec/examples/${name}.factory.json`, 'utf8'));

describe('diffJson / applyPatch', () => {
  it('equal documents: no ops; key order does not matter', () => {
    expect(diffJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toEqual([]);
    expect(jsonEqual({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
  });

  it('add, remove, replace on objects and arrays, in an order that applies', () => {
    const a = { x: 1, gone: true, list: [1, 2, 3, 4], nested: { k: 'v' } };
    const b = { x: 2, list: [1, 9], nested: { k: 'v', extra: [1] }, fresh: null };
    const ops = diffJson(a, b);
    expect(ops).toEqual([
      { op: 'remove', path: '/gone' },
      { op: 'replace', path: '/x', value: 2 },
      { op: 'replace', path: '/list/1', value: 9 },
      { op: 'remove', path: '/list/3' },
      { op: 'remove', path: '/list/2' },
      { op: 'add', path: '/nested/extra', value: [1] },
      { op: 'add', path: '/fresh', value: null },
    ]);
    expect(applyPatch(a, ops)).toEqual(b);
    expect(a.list).toEqual([1, 2, 3, 4]); // the input is not changed
  });

  it('keys with / and ~ are escaped (RFC 6901)', () => {
    const ops = diffJson({}, { 'a/b': 1, 'c~d': 2 });
    expect(ops.map((o) => o.path)).toEqual(['/a~1b', '/c~0d']);
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    expect(applyPatch({}, ops)).toEqual({ 'a/b': 1, 'c~d': 2 });
  });

  it('round trip between the example lines: every diff applies to give exactly the other line', () => {
    const lines = ['printer-line', 'lubricant-line', 'bottling-line'].map(load);
    for (const a of lines) for (const b of lines) expect(applyPatch(a, diffJson(a, b))).toEqual(b);
  });

  it('applyPatch: test, "-" (append), whole-document replace, and clear errors', () => {
    expect(applyPatch([1], [{ op: 'add', path: '/-', value: 2 }])).toEqual([1, 2]);
    expect(applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 1 }, { op: 'replace', path: '', value: { b: 2 } }])).toEqual({ b: 2 });
    expect(() => applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 2 }])).toThrow(PatchError);
    expect(() => applyPatch({ a: 1 }, [{ op: 'remove', path: '/b' }])).toThrow(/no "\/b"/);
    expect(() => applyPatch({ a: [1] }, [{ op: 'replace', path: '/a/3', value: 0 }])).toThrow(/index 3 is outside/);
    expect(() => applyPatch({}, [{ op: 'replace', path: '/x/y', value: 0 }])).toThrow(/missing parent/);
    expect(() => applyPatch({ a: 1 }, [{ op: 'move', path: '/a' }])).toThrow(/unsupported op "move"/);
  });
});

describe('labels for people', () => {
  it('array items by their id', () => {
    const f = load('bottling-line');
    expect(labelPath(f, '/stations/1/equipment/0/params/length')).toBe('stations › cap › equipment › belt › params › length');
    expect(labelPath(f, '/graph/edges/0/from')).toBe('graph › edges › [0] › from');
    expect(labelPath(f, '')).toBe('(whole document)');
    expect(valueAt(f, '/stations/1/id')).toBe('cap');
  });

  it('describeDiff: the label from the document the item is in, the old value for replace and remove', () => {
    const before = load('bottling-line');
    const after = structuredClone(before);
    after.stations[1].equipment[0].params.length = 3;
    after.stations.pop();
    const d = describeDiff(before, after);
    expect(d).toEqual([
      expect.objectContaining({ op: 'replace', label: 'stations › cap › equipment › belt › params › length', value: 3, from: before.stations[1].equipment[0].params.length }),
      expect.objectContaining({ op: 'remove', label: 'stations › pack', from: before.stations.at(-1) }),
    ]);
  });
});
