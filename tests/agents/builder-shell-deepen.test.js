// A machine hitting the shell's rear fence (the capper's feeder column in the apple-juice run, 2026-11-25):
// the model only gives hints and can't move the fence, so it was refused 3 times. Now the shell is made
// deeper in code (its `deepen`), the fence moves back, and the layout passes first time.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createBuilder } from '../../agents/builder/builder.js';
import { layoutSchema, machinesSchema } from '../../agents/builder/schemas.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const line = { id: 'deepenLine', title: 'Deepen', runSize: 4, transport: { type: 'palletConveyor', params: {} } };
const job = { line, product: bottling.product, stations: [], plan: { id: 'capping', title: 'Screw on cap', does: 'caps', steps: [] } };

function scripted(script) {
  return { call: async ({ schemaName }) => ({ output: script[schemaName], cost: 0, source: 'mock', key: schemaName }) };
}

describe('shell deepened where a machine hits its rear furniture', () => {
  it('assemblyCell with a capper over the line: no fence clash, no refusals, noted', async () => {
    const capper = { id: 'capper', type: 'capper', why: 'caps', place: 'overLine', at: 'work' };
    const layout = { id: 'capping', title: 'Screw on cap', shell: { type: 'assemblyCell', params: { code: 'ST2', title: 'Screw on cap' } }, equipment: [capper], conveyor: 'line', ports: [], ops: [] };
    const llm = scripted({
      stationLayout: layoutSchema(registry, { product: 'parametric' }).encode(layout),
      stationMachines: machinesSchema(registry, [capper]).encode({ params: { capper: { pitch: 0.4, capRadius: 0.027 } } }),
    });
    const builder = createBuilder({ registry, llm });
    const build = builder.newBuild();
    const r = await builder.advance(job, build, { stopAfter: 'machines' });
    expect(r.attempts).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.findings.filter((f) => f.check === 'geometry')).toEqual([]);
    expect(r.notes.map((n) => n.message)).toContain(`shell: "capper" hit the shell's "fence" (65 mm); the cell is 12 cm deeper at the rear`);
    expect(r.station.shell.params.minZ).toBe(-1.62);
  }, 60000);
});
