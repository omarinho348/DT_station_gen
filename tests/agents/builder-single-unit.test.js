// A Builder station serves one unit at a time: a machine made for batches (several heads) gets its
// `singleUnit` params in code (one head, centred), so the nozzle is over the bottle, not between
// nozzles over the belt (owner testing, 2026-11-25).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createBuilder } from '../../agents/builder/builder.js';
import { layoutSchema, machinesSchema, processSchema } from '../../agents/builder/schemas.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const job = {
  line: { id: 'oilLine', title: 'Olive oil', runSize: 3, conventions: { beltHeight: 0.86 }, transport: { type: 'beltConveyor', params: {} } },
  product: bottling.product,
  stations: [],
  plan: { id: 'filling', title: 'Filling', does: 'Fills each bottle', steps: ['in', 'fill', 'out'] },
};
const layout = {
  id: 'filling', title: 'Filling',
  equipment: [
    { id: 'belt', type: 'beltConveyor', why: 'carries the bottles', place: 'line', at: 'whole' },
    { id: 'filler', type: 'filler', why: 'fills them', place: 'overLine', at: 'work' },
  ],
  conveyor: 'belt',
  ops: ['fill'],
};

function scripted(answers) {
  const queue = { ...answers };
  return { call: async (req) => ({ output: queue[req.schemaName].shift(), cost: 0, source: 'mock', key: 'k' }) };
}

describe('one unit at a time', () => {
  it('a 4-head filler asked for becomes a 1-head filler, its nozzle over the work place; noted; the run plays', async () => {
    expect(registry.getComponent('filler').singleUnit).toEqual({ heads: 1 });
    const llm = scripted({
      stationLayout: [layoutSchema(registry, { product: 'parametric' }).encode(layout)],
      stationMachines: [machinesSchema(registry, layout.equipment).encode({ params: { belt: { length: 2.4 }, filler: { heads: 4 } } })],
      stationProcess: [processSchema(registry, { ops: ['fill'], machines: ['belt', 'filler'] }).encode({ process: [{ op: 'fill', machine: 'filler', units: 'Bottles', liquid: 'olive oil' }] })],
    });
    const r = await createBuilder({ registry, llm }).buildStation(job);
    expect(r.ok).toBe(true);
    const filler = r.station.equipment.find((e) => e.id === 'filler');
    expect(filler.params.heads).toBe(1);
    expect(r.notes.map((n) => n.message)).toContain('filler: heads 4 → 1 (this station serves one unit at a time)');
    // The single nozzle (head1) stands exactly over the belt's work place, where each bottle stops.
    const ctx = { beltHeight: 0.86 };
    const belt = r.station.equipment.find((e) => e.id === 'belt');
    const head = registry.componentSpec('filler', filler.params, ctx).ports.head1.position[0] + filler.position[0];
    const work = registry.componentSpec('beltConveyor', belt.params, ctx).ports.work?.position[0] ?? 0;
    expect(head).toBeCloseTo(work + belt.position[0], 6);
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 3: every unit left the line/);
  }, 60000);
});
