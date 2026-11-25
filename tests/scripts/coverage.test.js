// The process-coverage table (scripts/coverage-lib.js, Phase 12 step 1): every catalog component and op
// mapped to DIN 8580 / DIN 8593 / VDI 2860, and benchmarks/coverage.md current.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/ops/index.js';
import { checkCoverageMap, coverageTable } from '../../scripts/coverage-lib.js';
import { registryView } from '../../scripts/coverage.mjs';

const map = JSON.parse(readFileSync('benchmarks/coverage.map.json', 'utf8'));

describe('process coverage', () => {
  it('every catalog component and op is mapped, with known codes only', () => {
    expect(checkCoverageMap(map, registryView(registry))).toEqual([]);
  });

  it('refuses an unmapped entry, a stale one and an unknown code', () => {
    const reg = { components: [{ type: 'a', category: 'machine' }, { type: 'b', category: 'tool' }], ops: [{ op: 'x', basic: true }] };
    const bad = { standards: map.standards, components: { a: ['DIN 8580:9'], c: [] }, ops: {} };
    expect(checkCoverageMap(bad, reg)).toEqual([
      'component "b" is in the catalog but not in the map',
      'component "a": unknown code "DIN 8580:9"',
      'component "c" is in the map but not in the catalog',
      'op "x" is in the catalog but not in the map',
    ]);
  });

  it('levels: named beats basic beats none; benchmarks/coverage.md is current (npm run coverage)', () => {
    const { rows, markdown } = coverageTable(map, registryView(registry));
    const level = (std, code) => rows.find((r) => r.standard === std && r.code === code).level;
    expect(level('DIN 8593', '4.2')).toBe('named'); // filler, fill
    expect(level('DIN 8593', '4.6')).toBe('basic'); // only the laser head
    expect(level('DIN 8593', '4.7')).toBe('none'); // soldering
    expect(level('VDI 2860', 'check')).toBe('named');
    expect(readFileSync('benchmarks/coverage.md', 'utf8')).toBe(markdown);
  });
});
