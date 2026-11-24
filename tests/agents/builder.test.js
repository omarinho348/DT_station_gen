// The Builder (agents/builder/builder.js, Phase 8 step 4) against a scripted model: answers made with
// the schemas' own encode() from the bottling line's capping station, so they are exactly what a
// strict-mode model answers. No network; the real LLM layer is used once, in mock mode.
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createBuilder, phaseOf } from '../../agents/builder/builder.js';
import { layoutSchema, machinesSchema, processSchema } from '../../agents/builder/schemas.js';
import { createLlm, LlmError } from '../../agents/llm.js';
import { catalogIndex } from '../../lib/catalog.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const fill = bottling.stations.find((s) => s.id === 'fill');
const cap = bottling.stations.find((s) => s.id === 'cap');
const job = {
  line: { id: bottling.line.id, title: bottling.line.title, runSize: 4, conventions: bottling.line.conventions, transport: { type: 'beltConveyor', params: {} } },
  product: bottling.product,
  stations: [fill],
  plan: { title: 'Capping', does: 'Screws a cap onto each filled bottle', steps: ['bottle in', 'cap set on and turned', 'bottle out'] },
};

// The capping station as the three answers.
const layoutIr = {
  id: 'cap', code: 'C', title: 'Capping',
  equipment: [
    { id: 'belt', type: 'beltConveyor', why: 'carries the bottles', place: 'line', at: 'whole' },
    { id: 'capper', type: 'composite', why: 'sets and turns the cap', place: 'overLine', at: 'work' },
  ],
  conveyor: 'belt',
  ops: [...new Set([...cap.intake, ...cap.process, ...cap.output].map((o) => o.op))],
};
const machinesIr = { params: Object.fromEntries(cap.equipment.map((e) => [e.id, e.params])) };
const processIr = { intake: cap.intake, process: cap.process, output: cap.output, inputStage: cap.inputStage };
const answers = {
  layout: (ir = layoutIr) => layoutSchema(registry).encode(ir),
  machines: (ir = machinesIr) => machinesSchema(registry, layoutIr.equipment).encode(ir),
  process: (ir = processIr) => processSchema(registry, { ops: layoutIr.ops, machines: ['belt', 'capper'] }).encode(ir),
};

/** A model that answers from a script, per schema name, and records what it was asked. */
function scripted(script) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  return {
    calls,
    call: async ({ agent, schemaName, schema, messages }) => {
      calls.push({ agent, schemaName, schema, messages });
      const next = queues[schemaName]?.shift();
      if (!next) throw new Error(`no scripted answer for ${schemaName}`);
      return { output: next, cost: 0.001, source: 'mock', key: schemaName };
    },
  };
}

describe('the Builder', () => {
  it('builds the capping station in three calls: the station the hand-written line has, reviewed, the run played', async () => {
    const llm = scripted({ stationLayout: [answers.layout()], stationMachines: [answers.machines()], stationProcess: [answers.process()] });
    const r = await createBuilder({ registry, llm }).buildStation(job);
    expect(r.ok).toBe(true);
    expect(llm.calls.map((c) => c.schemaName)).toEqual(['stationLayout', 'stationMachines', 'stationProcess']);
    expect(r.attempts).toEqual([]);
    expect(r.cost).toBeCloseTo(0.003, 9);
    // The station: the hand-written one's machines, params, places and process.
    expect(r.station.equipment.map((e) => [e.id, e.type, e.position])).toEqual([['belt', 'beltConveyor', [0, 0, 0]], ['capper', 'composite', [0, 0, 0]]]);
    for (const e of r.station.equipment) expect(e.params).toEqual(cap.equipment.find((x) => x.id === e.id).params);
    expect(r.station).toMatchObject({ id: 'cap', code: 'C', title: 'Capping', conveyor: 'belt', inputStage: 'filled', intake: cap.intake, process: cap.process, output: cap.output, feed: { fromLift: false } });
    expect(r.factory.graph.edges).toEqual([{ from: 'fill.output', to: 'cap.input', transport: { kind: 'conveyor', type: 'beltConveyor', params: {} } }]);
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 4: every unit left the line/);
  }, 60000);

  it('prompts: the same stable start every call (instructions, then the catalog), the phase\'s own part after it', async () => {
    const llm = scripted({ stationLayout: [answers.layout()], stationMachines: [answers.machines()], stationProcess: [answers.process()] });
    const builder = createBuilder({ registry, llm, play: false });
    await builder.buildStation(job);
    const systems = new Set(llm.calls.map((c) => c.messages[0].content));
    expect(systems.size).toBe(1);
    expect(builder.system).toMatch(/^You are the Builder/);
    expect(builder.system).toContain(`CATALOG\n{"version":"${catalogIndex(registry).version}"`);
    const [layout, machines, process] = llm.calls.map((c) => c.messages[1].content);
    expect(layout).toMatch(/^PHASE layout\n/);
    expect(layout).toContain('Screws a cap onto each filled bottle');
    expect(machines).toMatch(/^PHASE machines/);
    expect(machines).toContain('DETAIL'); // the chosen types' params and ranges
    expect(process).toMatch(/^PHASE process/);
    expect(process).toContain('"ops":{"');
    for (const c of llm.calls) expect(c.agent).toBe('builder');
  });

  it('a param out of range: refused in code, sent back to the machines phase with the reason, fixed', async () => {
    const bad = structuredClone(machinesIr);
    bad.params.belt.length = 99;
    const llm = scripted({ stationLayout: [answers.layout()], stationMachines: [answers.machines(bad), answers.machines()], stationProcess: [answers.process()] });
    const r = await createBuilder({ registry, llm, play: false }).buildStation(job);
    expect(r.ok).toBe(true);
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].phase).toBe('machines');
    expect(r.attempts[0].problems[0]).toMatch(/^equipment\[0\]\.params \(belt\): .*length/);
    const retry = llm.calls.filter((c) => c.schemaName === 'stationMachines')[1].messages[1].content;
    expect(retry).toMatch(/FEEDBACK\nYour machines answer was refused\. Fix these and keep the rest:\n- equipment\[0\]\.params \(belt\)/);
    expect(llm.calls.map((c) => c.schemaName)).toEqual(['stationLayout', 'stationMachines', 'stationMachines', 'stationProcess']);
  });

  it('a reviewer finding goes back to the phase its path names: a motion out of range → the process phase', async () => {
    const bad = structuredClone(processIr);
    const move = bad.process.find((o) => o.to && typeof Object.values(o.to)[0] === 'number');
    const motion = Object.keys(move.to)[0];
    move.to[motion] = 99;
    const llm = scripted({ stationLayout: [answers.layout()], stationMachines: [answers.machines()], stationProcess: [answers.process(bad), answers.process()] });
    const r = await createBuilder({ registry, llm, play: false }).buildStation(job);
    expect(r.ok).toBe(true);
    expect(r.attempts.map((a) => a.phase)).toEqual(['process']);
    expect(r.attempts[0].findings[0]).toMatchObject({ check: 'ops', severity: 'error' });
    expect(r.attempts[0].problems[0]).toMatch(/^stations\[1\]\.process\[\d+\]: station "cap": .*must stay in/);
    expect(llm.calls.map((c) => c.schemaName)).toEqual(['stationLayout', 'stationMachines', 'stationProcess', 'stationProcess']);
  });

  it('a hint the placer cannot place goes back to the layout phase', async () => {
    const bad = structuredClone(layoutIr);
    bad.equipment[1] = { ...bad.equipment[1], place: 'onTop', on: 'nowhere' };
    const llm = scripted({ stationLayout: [answers.layout(bad), answers.layout()], stationMachines: [answers.machines(), answers.machines()], stationProcess: [answers.process()] });
    const r = await createBuilder({ registry, llm, play: false }).buildStation(job);
    expect(r.ok).toBe(true);
    expect(r.attempts[0]).toMatchObject({ phase: 'layout', problems: [expect.stringMatching(/^placement: "capper": "nowhere" is not placed/)] });
  });

  it('still wrong after two retries: handed back (ok false) with the findings, no more calls', async () => {
    const bad = structuredClone(machinesIr);
    bad.params.belt.length = 99;
    const llm = scripted({ stationLayout: [answers.layout()], stationMachines: [answers.machines(bad), answers.machines(bad), answers.machines(bad)], stationProcess: [] });
    const r = await createBuilder({ registry, llm, play: false }).buildStation(job);
    expect(r.ok).toBe(false);
    expect(r.attempts.map((a) => a.phase)).toEqual(['machines', 'machines', 'machines']);
    expect(llm.calls).toHaveLength(4);
    expect(r.station.id).toBe('cap'); // what there is, for the owner to see
  });

  it('phaseOf: geometry and machines to layout, params to machines, the rest to process', () => {
    expect(phaseOf({ check: 'geometry', path: 'stations[1].equipment[0]' }, 1)).toBe('layout');
    expect(phaseOf({ check: 'catalog', path: 'stations[1].equipment[1].params' }, 1)).toBe('machines');
    expect(phaseOf({ check: 'catalog', path: 'stations[1].equipment[1].type' }, 1)).toBe('layout');
    expect(phaseOf({ check: 'ops', path: 'stations[1].process[2]' }, 1)).toBe('process');
    expect(phaseOf({ check: 'graph', path: '(line)' }, 1)).toBe('process');
  });

  it('with the real LLM layer in mock mode and nothing recorded: the mock error reaches the caller (it needs the owner, not a retry)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'builder-'));
    const llm = createLlm({ env: { LLM_MODE: 'mock' }, root });
    const e = await createBuilder({ registry, llm }).buildStation(job).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.code).toBe('mock');
  });

  it('writes a draft: factory.json and its compiled files under generated/_draft/<line>/', async () => {
    const llm = scripted({ stationLayout: [answers.layout()], stationMachines: [answers.machines()], stationProcess: [answers.process()] });
    const root = mkdtempSync(join(tmpdir(), 'builder-draft-'));
    const builder = createBuilder({ registry, llm, root, play: false });
    const r = await builder.buildStation(job);
    const d = builder.writeDraft(r.factory);
    expect(d.dir.replace(/\\/g, '/')).toMatch(/generated\/_draft\/bottling-line$/);
    expect(d.files.sort()).toEqual(['cap.js', 'factory.json', 'fill1.js', 'fill2.js', 'line.js']); // fill runs as two parallel copies
    for (const f of d.files) expect(existsSync(join(d.dir, f))).toBe(true);
    expect(readFileSync(join(d.dir, 'line.js'), 'utf8')).toContain("from '../../../lib/components/index.js'");
    expect(JSON.parse(readFileSync(join(d.dir, 'factory.json'), 'utf8'))).toEqual(r.factory);
  });
});
