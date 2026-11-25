// The two layout stops of the step 13.3 benchmark, repaired in code (Phase 13, step 4):
//   1. a station port (a reject port) naming something that is no port: checked at the layout phase,
//      repaired where the answer is clear (before: found only when the line played, and sent back to
//      the process phase, which can't change the layout: refused 5 times)
//   2. a station taking other goods than the previous one hands over (pallet carriers after loose
//      units): its conveyor is chosen in code (before: refused 5 times with the fix spelled out)
// The layouts are the model's own mistakes from the benchmark recordings (names kept).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createBuilder, phaseOf } from '../../agents/builder/builder.js';
import { layoutSchema, machinesSchema, processSchema } from '../../agents/builder/schemas.js';
import { stationRecipes, candidatesFor } from '../../lib/recipes.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const product = { ...bottling.product, params: { ...bottling.product.params, rejectEvery: 2 } };
const fill = bottling.stations.find((s) => s.id === 'fill'); // hands over loose units on a belt
const line = { id: 'repairLine', title: 'Repairs', runSize: 4, conventions: { beltHeight: 0.86 }, transport: { type: 'beltConveyor', params: {} } };
const job = (stations = []) => ({ line, product, stations, plan: { id: 'station', title: 'Station', does: 'x', steps: [] } });

/** A model answering from a script per schema name; spare copies so a refusal shows its reasons. */
function scripted(script) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  return {
    calls,
    call: async ({ schemaName, messages }) => {
      calls.push({ schemaName, messages });
      const next = queues[schemaName]?.length > 1 ? queues[schemaName].shift() : queues[schemaName]?.[0];
      if (!next) throw new Error(`no scripted answer for ${schemaName}`);
      return { output: next, cost: 0, source: 'mock', key: schemaName };
    },
  };
}

/** The answers for a layout (IR) and a process (IR); machines at their defaults. `final`: the equipment after repairs. */
function answers(layout, process, { final = layout.equipment, ops = layout.ops } = {}) {
  const all = final.map((e) => ({ ...e, params: {} }));
  const recipes = stationRecipes(registry, all, { productDef: registry.getProduct('parametric') }).map((r) => ({
    ...r, candidates: Object.fromEntries(Object.entries(r.def.stationArgs).map(([k, rule]) => [k, candidatesFor(registry, rule, all, {}, { exclude: r.machine })])),
  }));
  return {
    stationLayout: [layoutSchema(registry, { product: 'parametric' }).encode(layout)],
    stationMachines: [machinesSchema(registry, final).encode({ params: Object.fromEntries(final.map((e) => [e.id, {}])) })],
    stationProcess: [processSchema(registry, { ops, machines: final.map((e) => e.id), items: ['product'], recipes }).encode(process)],
  };
}

const belt = { id: 'weighConveyor', type: 'beltConveyor', why: 'carries', place: 'line', at: 'whole' };
const scanner = { id: 'weighVision', type: 'visionScanner', why: 'checks', place: 'overLine', at: 'work' };

describe('1. station ports repaired at the layout phase', () => {
  it('machine and port mixed up ("weighVision.rejectLane", the lane exists): the lane\'s output; noted; plays', async () => {
    const lane = { id: 'rejectLane', type: 'rollerConveyor', why: 'rejects', place: 'besideLine', at: 'work', turned: true };
    const layout = { id: 'checkWeigher', title: 'Check', equipment: [belt, scanner, lane], conveyor: 'weighConveyor', ports: [{ name: 'reject', machine: 'weighVision', port: 'rejectLane', direction: 'out' }], ops: [] };
    const llm = scripted(answers(layout, { process: [{ use: 'weighVision.inspect', rejectLane: 'rejectLane' }], inputStage: 'capped' }));
    const r = await createBuilder({ registry, llm }).buildStation(job());
    expect(r.attempts).toEqual([]);
    expect(r.station.ports.reject).toEqual({ machine: 'rejectLane', port: 'output', direction: 'out' });
    expect(r.notes.map((n) => n.message)).toContain('ports.reject: "weighVision.rejectLane" is no port of the station; "rejectLane.output" is used ("rejectLane" is a machine: its out port)');
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 4: every unit left the line/);
  }, 60000);

  it('a reject port on a side pusher and no lane at all (panel-cutting): a lane is added beside the line, turned; the inspection rejects down it', async () => {
    const pusher = { id: 'rejectSidePusher', type: 'sidePusher', why: 'pushes rejects off', place: 'besideLine', at: 'work', turned: true };
    const layout = { id: 'inspectDimensions', title: 'Inspect', equipment: [belt, scanner, pusher], conveyor: 'weighConveyor', ports: [{ name: 'reject', machine: 'rejectSidePusher', port: 'stop', direction: 'out' }], ops: [] };
    const lane = { id: 'rejectLane', type: 'beltConveyor', why: 'x', place: 'besideLine', at: 'work', turned: true };
    const llm = scripted(answers(layout, { process: [{ use: 'weighVision.inspect', rejectLane: 'rejectLane' }], inputStage: 'capped' }, { final: [...layout.equipment, lane] }));
    const r = await createBuilder({ registry, llm }).buildStation(job());
    expect(r.attempts).toEqual([]);
    expect(r.station.equipment.find((e) => e.id === 'rejectLane')).toMatchObject({ type: 'beltConveyor', rotationY: Math.PI / 2 });
    expect(r.station.ports.reject).toEqual({ machine: 'rejectLane', port: 'output', direction: 'out' });
    expect(r.notes.map((n) => n.message)).toContain('ports.reject: "rejectSidePusher.stop" is no port of the station; "rejectLane.output" is used (the station had no lane for it: a beltConveyor "rejectLane" is added beside the line, turned away from it)');
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 4: every unit left the line/);
  }, 60000);

  it('two lanes it could be: a layout refusal listing them (not a process one); the fixed answer passes', async () => {
    const a = { id: 'laneA', type: 'rollerConveyor', why: 'x', place: 'besideLine', at: 'input', turned: true };
    const b = { id: 'laneB', type: 'rollerConveyor', why: 'x', place: 'besideLine', at: 'output', turned: true };
    const bad = { id: 'check', title: 'Check', equipment: [belt, scanner, a, b], conveyor: 'weighConveyor', ports: [{ name: 'reject', machine: 'weighVision', port: 'out', direction: 'out' }], ops: ['wait'] };
    const good = { ...bad, ports: [{ name: 'reject', machine: 'laneB', port: 'output', direction: 'out' }] };
    const first = answers(bad, { process: [{ op: 'wait', seconds: 1 }] });
    const llm = scripted({ ...first, stationLayout: [first.stationLayout[0], answers(good, { process: [] }).stationLayout[0]] });
    const r = await createBuilder({ registry, llm, play: false }).buildStation(job());
    expect(r.ok).toBe(true);
    expect(r.attempts).toEqual([{ phase: 'layout', problems: ['ports.reject: "weighVision.out" is no port of the station (ports that way: laneA.output, laneB.output): name a port of one of the station\'s machines'] }]);
  }, 60000);

  it('a station-port finding reported at the station\'s path goes back to the layout phase', () => {
    expect(phaseOf({ check: 'play', path: 'stations[5]', message: 'station "checkWeigher": station "checkWeigher" port "reject": machine "weighVision" has no port "rejectLane" (ports: none)' }, 5)).toBe('layout');
    expect(phaseOf({ check: 'play', path: 'stations[0].process[1]', message: 'process › op #2 (accumulate): where is "product"?' }, 0)).toBe('process');
  });
});

describe('2. the conveyor takes what the previous station hands over', () => {
  it('the assembly cell (pallet carriers) after a station handing over loose units: the shell is left out, the station gets its own belt under the same id; noted; plays', async () => {
    const layout = { id: 'foldTo250x300', title: 'Fold', shell: { type: 'assemblyCell', params: { code: 'ST2', title: 'Folding' } }, equipment: [{ id: 'foldingMachine', type: 'genericMachine', why: 'folds', place: 'overLine', at: 'work' }], conveyor: 'line', ops: [] };
    const final = [{ id: 'line', type: 'beltConveyor', why: 'x', place: 'line', at: 'whole' }, ...layout.equipment];
    const llm = scripted(answers(layout, { process: [{ use: 'foldingMachine.work', seconds: 3, task: 'Folding' }], inputStage: 'filled' }, { final }));
    const r = await createBuilder({ registry, llm }).buildStation(job([fill]));
    expect(r.attempts).toEqual([]);
    expect(r.station.shell).toBeUndefined();
    expect(r.station.equipment.find((e) => e.id === 'line').type).toBe('beltConveyor');
    expect(r.notes.map((n) => n.message)).toContain('conveyor: "fill" hands over unit, but the assemblyCell shell\'s conveyor "line" (palletConveyor) takes pallet: the shell is left out and the station gets its own beltConveyor "line"');
    expect(r.factory.graph.edges[0].transport.type).toBe('beltConveyor');
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 4: every unit left the line/);
  }, 60000);

  it('its own pallet conveyor after loose units: it becomes a belt; plays', async () => {
    const layout = { id: 'inspectCavities', title: 'Inspect', equipment: [{ id: 'palletLine', type: 'palletConveyor', why: 'carries', place: 'line', at: 'whole' }, { id: 'visionInspectScanner', type: 'visionScanner', why: 'checks', place: 'overLine', at: 'work' }], conveyor: 'palletLine', ops: [] };
    const final = [{ ...layout.equipment[0], type: 'beltConveyor' }, layout.equipment[1]];
    const llm = scripted(answers(layout, { process: [{ use: 'visionInspectScanner.scan' }], inputStage: 'filled' }, { final }));
    const r = await createBuilder({ registry, llm }).buildStation(job([fill]));
    expect(r.attempts).toEqual([]);
    expect(r.station.equipment.find((e) => e.id === 'palletLine').type).toBe('beltConveyor');
    expect(r.notes.map((n) => n.message)).toContain('conveyor: "fill" hands over unit, but "palletLine" (palletConveyor) takes pallet: it is a beltConveyor now');
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 4: every unit left the line/);
  }, 60000);
});

describe('3. after a pallet station: line conveyors, never a lift (owner report: station 2 "no input port", a void between the stations)', () => {
  const box = { kind: 'parametric', params: { shape: 'box', length: 0.3, width: 0.2, height: 0.15 } };
  const cell = (id) => ({ id, title: id, shell: { type: 'assemblyCell', params: { code: 'S', title: id } }, equipment: [{ id: 'm', type: 'genericMachine', why: 'w', place: 'overLine', at: 'work' }], conveyor: 'line', ops: [] });
  const beltStation = (id) => ({ id, title: id, equipment: [{ id: 'belt', type: 'beltConveyor', why: 'b', place: 'line', at: 'whole' }, { id: 'm', type: 'genericMachine', why: 'w', place: 'overLine', at: 'work' }], conveyor: 'belt', ops: [] });
  const build = async (layouts) => {
    const stations = [];
    let last = null;
    for (const layout of layouts) {
      const llm = scripted(answers(layout, { process: [{ use: 'm.work', seconds: 3 }] }));
      last = await createBuilder({ registry, llm }).buildStation({ line, product: box, stations, plan: { id: layout.id, title: layout.id, does: 'x', steps: [] } });
      if (!last.ok) throw new Error(JSON.stringify(last.attempts.map((a) => a.problems)));
      stations.push(last.station);
    }
    return last;
  };

  it('a belt station after an assembly cell: its belt becomes a pallet conveyor (it has an input port); the transfer is a pallet conveyor too; plays', async () => {
    const r = await build([cell('first'), beltStation('second')]);
    expect(r.attempts).toEqual([]);
    expect(r.station.equipment.find((e) => e.id === 'belt').type).toBe('palletConveyor');
    expect(r.notes.map((n) => n.message)).toContain('conveyor: "first" hands over pallet, but "belt" (beltConveyor) takes unit: it is a palletConveyor now');
    expect(r.factory.graph.edges).toEqual([{ from: 'first.output', to: 'second.input', transport: { kind: 'conveyor', type: 'palletConveyor', params: { carrierLength: 1.2, workStop: false } } }]);
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 4: every unit left the line/);
  }, 120000);

  it('two assembly cells: the transfer is a pallet conveyor with their carriers, no work stop, its length left to the gap', async () => {
    const r = await build([cell('first'), cell('second')]);
    expect(r.factory.graph.edges[0].transport).toEqual({ kind: 'conveyor', type: 'palletConveyor', params: { carrierLength: 1.2, workStop: false } });
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 4: every unit left the line/);
  }, 120000);

  it('the reviewer refuses a transfer that can\'t fill the gap (a lift: no input / output, no length)', async () => {
    const r = await build([cell('first'), cell('second')]);
    const factory = structuredClone(r.factory);
    factory.graph.edges[0].transport = { kind: 'conveyor', type: 'liftUnit', params: {} };
    const { review } = await import('../../agents/reviewer/deterministic.js');
    const found = review(registry, factory, { play: false }).findings.find((f) => f.path === 'graph.edges[0].transport.type');
    expect(found).toMatchObject({ severity: 'error', message: 'transport "liftUnit" can\'t fill the gap between the stations: a transfer needs input and output ports and a length (it has ports top, bottom, no length)' });
  }, 120000);
});
