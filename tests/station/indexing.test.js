// Indexing stations (lib/station/indexing.js, IndexingCycle.js): batches at positions along one
// conveyor, moved together. Checked against the recorded reference filling line (station 1): with
// the reference's step times (fill and cap stand-ins as waits), the machine cycles and every step
// must come out as recorded.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { IndexingCycle, planStation, parseStation, StationError } from '../../lib/station/index.js';
import { createMaterials } from '../../lib/core/materials.js';

const materials = createMaterials();
const ref = JSON.parse(readFileSync('benchmarks/expected/lubricant-line-reference-timing.json', 'utf8'));
const W = (state, label, seconds) => ({ op: 'wait', state, label, seconds });

// The reference filling line (OilFillingDefinition.js + FactoryLayout.js): belts, filler and capper
// centred on the can necks, 6 positions 1.6 m apart.
const EQUIPMENT = [
  { id: 'main', type: 'beltConveyor', params: { length: 8.4, guideGap: 0.22 }, at: [-0.1, 0, 0] },
  { id: 'outfeed', type: 'beltConveyor', params: { length: 4.74, guideGap: 0.22 }, at: [6.53, 0, 0] },
  { id: 'filler', type: 'filler', params: {}, at: [0.075, 0, 0] },
  { id: 'capper', type: 'capper', params: {}, at: [3.275, 0, 0] },
];
const INDEXING = {
  members: 4,
  pitch: 0.4,
  positions: [['spawn', -3.2], ['staging', -1.6], ['filling', 0], ['buffer', 1.6], ['capping', 3.2], ['outfeed', 4.8]].map(([name, x]) => ({ name, x })),
  enter: 'spawn',
  exit: 'outfeed',
  preload: ['staging'], // the reference starts with a batch waiting at staging
  index: [W('TRANSPORTING', 'Conveyor starting', 0.35), { op: 'indexBatches', state: 'TRANSPORTING', label: 'Indexing conveyor', seconds: 2.4, conveyors: ['main', 'outfeed'] }, W('TRANSPORTING', 'Conveyor stopped', 0.3)],
  exitOps: [W('OUTPUT', 'Outfeed starting', 0.3), { op: 'dischargeBatch', state: 'OUTPUT', label: 'Discharging finished cans', seconds: 2.8, distance: 3.2, conveyors: ['outfeed'] }],
  work: [
    { at: 'filling', ops: [['Cans in position', 0.4], ['Filling head descending', 1.5], ['Nozzles engaged', 0.3], ['Valves opening', 0.35], ['Dispensing oil', 5], ['Valves closing', 0.35], ['Drip settle', 0.3], ['Filling head retracting', 1.4], ['Fill complete', 0.3]].map(([l, s]) => W('FILLING', l, s)) },
    { at: 'capping', ops: [['Cans in position', 0.4], ['Capping head descending', 1.3], ['Caps engaging threads', 0.15], ['Tightening caps', 1.2], ['Torque reached', 0.25], ['Capping head retracting', 1.3], ['Feeding new caps', 0.7]].map(([l, s]) => W('CAPPING', l, s)) },
  ],
};
const STATION = { id: 'fill', title: 'Filling & capping', conveyor: 'main', ports: { output: { machine: 'outfeed' } }, indexing: INDEXING };

function build(station = STATION) {
  const root = new THREE.Group();
  const equipment = {};
  for (const e of EQUIPMENT) {
    const inst = registry.buildComponent(e.type, e.params, { materials, beltHeight: 0.86 });
    inst.root.position.set(...e.at);
    root.add(inst.root);
    equipment[e.id] = inst;
  }
  const product = { type: 'jerryCan', params: { height: 0.33 } };
  return { root, equipment, cycle: new IndexingCycle({ registry, station, equipment, root, product, ctx: { materials } }) };
}

function run(cycle, until) {
  const steps = [];
  const clock = { t: 0 };
  const before = cycle.sequencer.onStepStart;
  cycle.sequencer.onStepStart = (s) => { before?.(s); steps.push({ t: clock.t, state: s.state, label: s.label, duration: s.duration }); };
  cycle.start();
  while (!until() && clock.t < 2000) { cycle.update(0.02); clock.t += 0.02; }
  return { steps, t: clock.t };
}

describe('indexing station: data', () => {
  it('validates positions (known, evenly spaced, in flow order) and phases', () => {
    const bad = (indexing, re) => expect(() => parseStation({ ...STATION, indexing: { ...INDEXING, ...indexing } })).toThrow(re);
    bad({ enter: 'nowhere' }, /enter: unknown position "nowhere"/);
    bad({ positions: INDEXING.positions.map((p, i) => (i === 3 ? { ...p, x: 1.7 } : p)) }, /evenly spaced/);
    bad({ positions: [...INDEXING.positions].reverse() }, /along \+X/);
    bad({ order: ['exit', 'filling'] }, /must include "index"/);
    bad({ work: [{ at: 'oven', ops: [W('X', 'x', 1)] }] }, /unknown position "oven"/);
  });

  it('plans one full machine cycle: index 3.05 + exit 3.1 + filling 9.9 + capping 5.3 = 21.35 s (the reference steady state)', () => {
    const { equipment } = build();
    const plan = planStation(registry, STATION, { equipment, product: 'jerryCan' });
    expect(plan.indexing.phases.map((p) => [p.name, Number(p.duration.toFixed(6))])).toEqual([['index', 3.05], ['exit', 3.1], ['filling', 9.9], ['capping', 5.3]]);
    expect(plan.cycleTime).toBeCloseTo(21.35, 9);
    expect(plan.intake.duration).toBeCloseTo(3.05, 9); // timing tables read intake / process / output
    expect(plan.output.duration).toBeCloseTo(3.1, 9);
  });

  it('the batch ops only play in an indexing station: elsewhere the station stops in ALARM, saying why', async () => {
    const { StationCycle } = await import('../../lib/station/index.js');
    const root = new THREE.Group();
    const conveyor = registry.buildComponent('palletConveyor', {}, { materials });
    root.add(conveyor.root);
    const station = { id: 'single', title: 'Single unit', conveyor: 'line', process: [{ op: 'indexBatches', seconds: 1, conveyors: ['line'] }] };
    // A dry plan only adds up durations, so it accepts the op…
    expect(planStation(registry, station, { equipment: { line: conveyor }, product: 'jerryCan' }).process.duration).toBe(1);
    // …but playing it in a single-unit station is refused when its step is planned.
    const cycle = new StationCycle({ registry, station, equipment: { line: conveyor }, root, product: { type: 'jerryCan', params: {} }, ctx: { materials } });
    cycle.start();
    for (let t = 0; t < 30 && cycle.status.state !== 'ALARM'; t += 0.05) cycle.update(0.05);
    expect(cycle.status.state).toBe('ALARM');
    expect(cycle.error.message).toMatch(/indexBatches only works in an indexing station/);
  });
});

describe('indexing station: in factory.json', () => {
  const factory = {
    version: 1,
    line: { id: 'fillDemo', title: 'Filling demo', runSize: 4, conventions: { beltHeight: 0.86 } },
    product: { kind: 'catalog', type: 'jerryCan', params: { height: 0.33 } },
    stations: [{ ...STATION, equipment: EQUIPMENT.map((e) => ({ id: e.id, type: e.type, params: e.params, position: e.at })) }],
  };

  it('passes the full check, with the machine cycle as the station time in the timing table', async () => {
    const { checkFactory } = await import('../../compiler/expand.js');
    const result = checkFactory(registry, factory);
    expect(result.errors).toEqual([]);
    const row = result.timing.stations.find((st) => st.id === 'fill');
    expect(row.cycleTime).toBeCloseTo(21.35, 6);
  });

  it('compiles: the station file carries the indexing block', async () => {
    const { compileFactory } = await import('../../compiler/emit.js');
    const text = compileFactory(registry, factory).files.find((f) => f.name === 'fill.js').content;
    expect(text).toMatch(/indexing: \{/);
    expect(text).toMatch(/op: 'indexBatches'/);
    expect(text).toMatch(/preload: \['staging'\]/);
  });
});

describe('indexing station: playing (reference station 1 pattern)', () => {
  it('runs the reference machine cycles step for step: 8 batches out at 199.76 s', () => {
    const { cycle } = build();
    const { steps, t } = run(cycle, () => cycle.status.completed >= 8);
    const ours = steps.map((s) => `${s.state}|${s.label}|${s.duration.toFixed(6)}`);
    const theirs = ref.stations.s1.steps.slice(0, ours.length).map((s) => `${s.state}|${s.label}|${s.duration.toFixed(6)}`);
    const first = ours.findIndex((o, i) => o !== theirs[i]);
    if (first >= 0) throw new Error(`first difference at step ${first}: ours ${JSON.stringify(steps.slice(Math.max(0, first - 2), first + 3).map((x) => [Number(x.t.toFixed(2)), x.label]))} reference ${JSON.stringify(ref.stations.s1.steps.slice(Math.max(0, first - 2), first + 3).map((x) => [x.t, x.label]))}`);
    expect(ours).toEqual(theirs);
    expect(Math.abs(t - ref.stations.s1.finished)).toBeLessThan(0.05);
    // Start times agree within the 0.02 s recording step all the way through.
    steps.forEach((s, i) => expect(Math.abs(s.t - ref.stations.s1.steps[i].t), `${i} ${s.label}`).toBeLessThan(0.05));
  });

  it('moves the batches one position per index; four cans each at 0.4 m pitch; the discharged batch leaves', () => {
    const { cycle } = build();
    const b1 = cycle.batchAt('staging'); // preloaded
    expect(b1.members).toHaveLength(4);
    cycle.start();
    const after = (seconds) => { for (let t = 0; t < seconds; t += 0.02) cycle.update(0.02); };
    after(3.1); // first index done: the preloaded batch at filling, a new one at staging
    expect(cycle.batchAt('filling')).toBe(b1);
    expect(b1.root.position.x).toBeCloseTo(0, 6);
    expect(b1.members.map((m) => Number(m.root.position.x.toFixed(6)))).toEqual([-0.6, -0.2, 0.2, 0.6]);
    expect(cycle.batchAt('staging')).toBeTruthy();
    expect(cycle.status.batchesOnLine).toBe(2);
    after(50.2 - 3.1); // the reference discharges batch 1 from 47.5 to 50.3 s
    expect(cycle.status.completed).toBe(0);
    after(0.3);
    expect(cycle.status.completed).toBe(1);
    expect(b1.root.parent).toBeNull(); // retired stand-alone
    expect(cycle.batchAt('capping')).toBeTruthy();
  });

  it('holds while downstream is busy, and indexes no further while the last position is occupied', () => {
    const { cycle } = build();
    let busy = true;
    cycle.ports.output.ready = () => !busy;
    const got = [];
    cycle.ports.output.put = (b) => got.push(b);
    cycle.start();
    for (let t = 0; t < 120; t += 0.02) cycle.update(0.02);
    expect(got).toHaveLength(0);
    expect(cycle.status.state).toBe('HOLDING');
    expect(cycle.batchAt('outfeed')).toBeTruthy();
    busy = false;
    for (let t = 0; t < 4; t += 0.02) cycle.update(0.02);
    expect(got).toHaveLength(1);
    expect(got[0].isBatch).toBe(true);
  });

  it('batch stages, features and routines act on every member (a fill on the batch fills all four cans)', () => {
    const { cycle } = build();
    const batch = cycle.createIncoming();
    expect(batch.stages).toEqual(['empty', 'filled', 'capped']);
    const fill = batch.routine('fill', {});
    fill.start();
    fill.update(1, 0);
    fill.end();
    expect(batch.members.every((m) => m.api.level() > 0.8)).toBe(true);
    batch.setFeature('cap', 'on');
    expect(batch.members.every((m) => m.root.getObjectByName('Cap').visible)).toBe(true);
    const neck = batch.ref('neckTop');
    expect(neck.x).toBeCloseTo(-0.6 + batch.members[0].ref('neckTop').x, 9); // first member's, in the batch frame
    batch.dispose();
  });

  it('is played by Line for a station with indexing data', async () => {
    const { Line } = await import('../../lib/line/index.js');
    const line = new Line({
      registry,
      line: { id: 'idx', title: 'Indexing', runSize: 2, product: { type: 'jerryCan', params: { height: 0.33 } }, stations: [{ ...STATION, equipment: EQUIPMENT.map((e) => ({ id: e.id, type: e.type, params: e.params, position: e.at })) }], edges: [] },
      ctx: { materials, beltHeight: 0.86 },
    });
    expect(line.stations[0].cycle).toBeInstanceOf(IndexingCycle);
    line.dispose();
  });

  it('errors clearly for unknown phase names in data', () => {
    expect(() => parseStation({ ...STATION, indexing: { ...INDEXING, order: ['index', 'oven'] } })).toThrow(StationError);
  });
});
