// The recorded reference lubricant timing (scripts/reference-timing-lubricant.mjs), the target of
// Phase 5 step 9: present, complete, and showing the indexing pattern station 1 is built on.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ref = JSON.parse(readFileSync('benchmarks/expected/lubricant-line-reference-timing.json', 'utf8'));

describe('reference lubricant timing (recorded)', () => {
  it('has station 1 and 2 stand-alone runs and the whole factory to a 27-case pallet', () => {
    expect(ref.stations.s1.finished).toBeCloseTo(199.76, 6);
    expect(ref.stations.s2.finished).toBeCloseTo(189.1, 6);
    expect(ref.line.finished).toBeCloseTo(1010.52, 6);
    expect(ref.line.status.palletBoxes).toBe(27);
    expect(ref.line.events.filter((e) => /packed/.test(e.event))).toHaveLength(27);
    for (const k of ['s1', 's2', 's3', 'canTransfer']) expect(ref.line.steps[k].length).toBeGreaterThan(50);
  });

  it('station 1 is an indexing line: each machine cycle indexes, then outputs, fills and caps the batches present', () => {
    const steps = ref.stations.s1.steps;
    const phase = (s) => ({ TRANSPORTING: 'index', OUTPUT: 'output', FILLING: 'fill', CAPPING: 'cap' }[s.state]);
    const cycles = [];
    for (const s of steps) {
      if (s.label === 'Conveyor starting') cycles.push([]);
      const p = phase(s);
      if (p && cycles.length && cycles.at(-1).at(-1) !== p) cycles.at(-1).push(p);
    }
    expect(cycles.slice(0, 5).map((c) => c.join(' '))).toEqual([
      'index fill', // batch 1 at the filler
      'index fill', // batch 1 in the buffer, batch 2 at the filler
      'index fill cap', // batch 1 at the capper
      'index output fill cap', // batch 1 out
      'index output fill cap', // steady state
    ]);
    const sum = (state) => steps.slice(0, 64).filter((s) => s.state === state && s.t >= 44.1 && s.t < 65.5).reduce((a, s) => a + s.duration, 0);
    expect(sum('TRANSPORTING')).toBeCloseTo(3.05, 6);
    expect(sum('OUTPUT')).toBeCloseTo(3.1, 6);
    expect(sum('FILLING')).toBeCloseTo(9.9, 6); // steady cycle 3.05 + 3.1 + 9.9 + 5.3 = 21.35 s per batch
    expect(sum('CAPPING')).toBeCloseTo(5.3, 6);
  });
});
