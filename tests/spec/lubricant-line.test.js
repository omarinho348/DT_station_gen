// lubricant-line.factory.json against the recorded reference (Phase 5 step 9): station 1 (filling &
// capping, an indexing station) step for step, and what it does to the cans, the machines, the
// photo-eyes and the tank while it plays.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { Line } from '../../lib/line/index.js';
import { IndexingCycle } from '../../lib/station/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import factory from '../../spec/examples/lubricant-line.factory.json';
import reference from '../../benchmarks/expected/lubricant-line-reference-timing.json';

const materials = createMaterials();
const DT = 0.02;

/** Station 1 played through Line, as the twin plays it; every step recorded with its start time. */
function playStation1() {
  const expanded = expandFactory(registry, factory);
  const line = new Line({ registry, line: expanded.line, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
  const station = line.byId.get('filling');
  const steps = [];
  const clock = { t: 0 };
  const before = station.cycle.sequencer.onStepStart;
  station.cycle.sequencer.onStepStart = (s) => { before?.(s); steps.push({ t: clock.t, state: s.state, label: s.label, duration: s.duration }); };
  line.start();
  const runTo = (t) => { while (clock.t < t - 1e-9) { line.update(DT); clock.t += DT; } };
  return { line, station, steps, clock, runTo, eq: station.equipment, cycle: station.cycle };
}
const worldY = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y; };

describe('lubricant-line.factory.json · station 1 (filling & capping)', () => {
  it('is a valid factory.json; station 1 plans the reference machine cycle, 21.35 s', () => {
    const check = checkFactory(registry, factory);
    expect(check.errors).toEqual([]);
    const s1 = check.timing.stations.find((s) => s.id === 'filling');
    expect(s1.cycleTime).toBeCloseTo(21.35, 6);
  });

  it('matches the reference station 1 step for step with the real fill and cap ops: 8 batches out at 199.76 s', () => {
    const { cycle, steps, clock, line } = playStation1();
    while (cycle.status.completed < 8 && clock.t < 400) { line.update(DT); clock.t += DT; }
    const key = (s) => `${s.state}|${s.label}|${s.duration.toFixed(6)}`;
    const ours = steps.map(key);
    const theirs = reference.stations.s1.steps.slice(0, ours.length).map(key);
    const first = ours.findIndex((o, i) => o !== theirs[i]);
    expect(first, first >= 0 ? `first difference at step ${first}: ${ours[first]} vs ${theirs[first]}` : '').toBe(-1);
    expect(ours).toHaveLength(reference.stations.s1.steps.length);
    expect(Math.abs(clock.t - reference.stations.s1.finished)).toBeLessThan(0.05);
    steps.forEach((s, i) => expect(Math.abs(s.t - reference.stations.s1.steps[i].t), s.label).toBeLessThan(0.05));
    line.dispose();
  });

  it('fills: head down 45 mm into the necks, jets landing on the rising oil surface, cans at the fill level, head up', () => {
    const { cycle, eq, runTo, line } = playStation1();
    expect(cycle).toBeInstanceOf(IndexingCycle);
    runTo(8.0); // dispensing the first batch (5.6 → 10.6 s)
    const batch = cycle.batchAt('filling');
    const can = batch.members[0];
    const tipY = worldY(eq.filler.anchor('tip'));
    expect(worldY(can.root) + can.ref('neckTop').y - tipY).toBeCloseTo(0.045, 4);
    const surfaceY = worldY(can.root) + can.ref('liquidSurface').y;
    expect(eq.filler.state.jetEnd).toBeCloseTo(tipY - surfaceY, 3); // the jet ends on the surface
    const level = can.api.level();
    expect(level).toBeGreaterThan(0.2);
    expect(level).toBeLessThan(0.9);
    expect(batch.members.every((m) => Math.abs(m.api.level() - level) < 1e-9)).toBe(true); // all four alike
    runTo(13.0); // "Fill complete" ends at 12.94 s
    expect(batch.members.every((m) => Math.abs(m.api.level() - 0.9) < 1e-9 && m.stage === 'filled')).toBe(true);
    expect(eq.filler.state.headTravel).toBe(0);
    expect(eq.filler.state.jetEnd).toBe(0);
    line.dispose();
  });

  it('caps: chucks turn the caps down onto the necks, the cans carry their own caps, fresh caps are fed', () => {
    const { cycle, eq, runTo, line } = playStation1();
    runTo(41.5); // tightening the first batch (40.7 → 41.9 s)
    const batch = cycle.batchAt('capping');
    expect(batch.members.every((m) => m.stage === 'filled')).toBe(true);
    expect(eq.capper.state.headTravel).toBeGreaterThan(0.95);
    expect(eq.capper.state.caps).toBe('loaded');
    runTo(42.2); // torque reached: handed over
    expect(batch.members.every((m) => m.stage === 'capped' && m.root.getObjectByName('Cap').visible)).toBe(true);
    expect(eq.capper.state.caps).toBe('empty');
    runTo(44.2); // fresh caps fed, head up
    expect(eq.capper.state.caps).toBe('loaded');
    expect(eq.capper.state.capFeed).toBe(1);
    expect(eq.capper.state.headTravel).toBe(0);
    line.dispose();
  });

  it('photo-eyes see the batches standing at them; the tank level drops with each fill', () => {
    const { eq, runTo, line } = playStation1();
    expect(eq.supply.state.level).toBeCloseTo(0.88, 9); // home
    runTo(3.2); // after the first index: batches at staging and filling
    expect(eq.eyeInfeed.state.beam).toBe('blocked');
    expect(eq.eyeFilling.state.beam).toBe('blocked');
    expect(eq.eyeCapping.state.beam).toBe('clear');
    runTo(13.0); // first fill done
    expect(eq.supply.state.level).toBeCloseTo(0.84, 9);
    runTo(39); // batch 1 at the capper
    expect(eq.eyeCapping.state.beam).toBe('blocked');
    line.dispose();
  });

  it('the compiled files play the same as the IR', async () => {
    const mod = await import('../../generated/lubricant-line/line.js');
    const compiled = mod.createLine({ materials });
    const ir = playStation1();
    compiled.start();
    for (let t = 0; t < 60; t += DT) { compiled.update(DT); ir.line.update(DT); }
    const a = compiled.byId.get('filling').cycle.status;
    const b = ir.cycle.status;
    expect([a.state, a.step, a.completed, a.cycles]).toEqual([b.state, b.step, b.completed, b.cycles]);
    compiled.dispose();
    ir.line.dispose();
  });
});
