// lubricant-line.factory.json, station 2 (case packing) against the recorded reference (Phase 5
// step 9b): stand-alone step for step, and what it does while it plays: cans accumulated in two
// lanes against the end stop, the case at the swing stop, the gantry's pick with pitch change into
// the case, the closer folding and pressing the flaps, the case taped as it passes the head and
// leaving as the unit (with the four cans in it).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { Line } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import factory from '../../spec/examples/lubricant-line.factory.json';
import reference from '../../benchmarks/expected/lubricant-line-reference-timing.json';

const materials = createMaterials();
const DT = 0.02;

/** Station 2 stand-alone through Line, as the twin plays it; every step recorded with its start time. */
function playStation2() {
  const expanded = expandFactory(registry, factory);
  const data = { ...expanded.line, stations: expanded.line.stations.filter((s) => s.id === 'packing'), edges: [] };
  const line = new Line({ registry, line: data, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
  const station = line.byId.get('packing');
  const steps = [];
  const clock = { t: 0 };
  const before = station.cycle.sequencer.onStepStart;
  station.cycle.sequencer.onStepStart = (s) => { before?.(s); steps.push({ t: clock.t, state: s.state, label: s.label, duration: s.duration }); };
  line.start();
  const runTo = (t) => { while (clock.t < t - 1e-9) { line.update(DT); clock.t += DT; } };
  return { line, station, steps, clock, runTo, eq: station.equipment, cycle: station.cycle };
}

const world = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
/** Station-frame position of an object. */
const local = (station, o) => station.root.worldToLocal(world(o));

describe('lubricant-line.factory.json · station 2 (case packing)', () => {
  it('is valid; station 2 plans the reference cycle, 31.55 s per case', () => {
    const check = checkFactory(registry, factory);
    expect(check.errors).toEqual([]);
    const s2 = check.timing.stations.find((s) => s.id === 'packing');
    expect(s2.cycleTime).toBeCloseTo(31.55, 6);
  });

  it('matches the reference station 2 step for step: 6 cases out at 189.10 s', () => {
    const { cycle, steps, clock, line } = playStation2();
    while (cycle.status.completed < 6 && clock.t < 300) { line.update(DT); clock.t += DT; }
    // Our zero-time steps (the case appearing, the unit swap, "Process complete") have no
    // counterpart in the recording; every timed step does.
    const timed = steps.filter((s) => s.duration > 0);
    const key = (s) => `${s.state}|${s.label}|${s.duration.toFixed(6)}`;
    const ours = timed.map(key);
    const theirs = reference.stations.s2.steps.map(key);
    const first = ours.findIndex((o, i) => o !== theirs[i]);
    expect(first, first >= 0 ? `first difference at step ${first}: ${ours[first]} vs ${theirs[first]}` : '').toBe(-1);
    expect(ours).toHaveLength(theirs.length);
    expect(Math.abs(clock.t - reference.stations.s2.finished)).toBeLessThan(0.05);
    timed.forEach((s, i) => expect(Math.abs(s.t - reference.stations.s2.steps[i].t), s.label).toBeLessThan(0.05));
    line.dispose();
  });

  it('accumulates the cans in two lanes against the end stop and the case at the swing stop', () => {
    const { station, cycle, eq, runTo, line } = playStation2();
    runTo(3.0); // arriving
    expect(eq.boxStop.state.open).toBe(0); // swung back across the belt in the first 0.5 s
    runTo(7.0); // "Cans in 2×2 position"
    const batch = cycle.unit;
    const at = batch.members.map((m) => local(station, m.root));
    // members 1, 2 in the front lane, 3, 4 in the rear (the row former's order), trailing then
    // leading: touching (0.28 m) against the stop face at x 0.28
    [[-0.14, 0.88], [0.14, 0.88], [-0.14, 0.62], [0.14, 0.62]].forEach(([x, z], i) => {
      expect(at[i].x).toBeCloseTo(x, 6);
      expect(at[i].z).toBeCloseTo(z, 6);
      expect(at[i].y).toBeCloseTo(0.86, 6);
    });
    expect(batch.members.every((m) => m.stage === 'capped')).toBe(true);
    const box = station.root.children.find((c) => c.name === 'Carton');
    expect(local(station, box).toArray().map((v) => +v.toFixed(6))).toEqual([0, 0.86, -0.75]);
    expect(eq.eyeCans.state.beam).toBe('blocked');
    expect(eq.eyeCase.state.beam).toBe('blocked');
    expect(eq.eyeTaper.state.beam).toBe('clear');
    line.dispose();
  });

  it('the gantry picks the four cans by their handles and sets them into the case at case spacing', () => {
    const { station, cycle, eq, runTo, line } = playStation2();
    runTo(8.6); // grippers closed (8.14 → 8.54)
    expect(eq.gantry.state.pitch).toBeCloseTo(0.26, 6); // lane spacing
    expect(eq.gantry.state.grip).toBeCloseTo(0.047, 6);
    runTo(9.6); // lifting
    const batch = cycle.unit;
    const grips = ['grip3', 'grip4', 'grip1', 'grip2']; // grippers: rear row first, each along +X
    batch.members.forEach((m, i) => {
      // every can hangs in its own gripper, by its handle
      const grip = world(eq.gantry.anchor(grips[i]));
      const handle = m.root.localToWorld(m.ref('grasp'));
      expect(grip.distanceTo(handle)).toBeLessThan(1e-6);
    });
    runTo(12.0); // travel done (9.74 → 11.94)
    expect(eq.gantry.state.pitch).toBeCloseTo(0.2, 6); // case spacing
    expect(eq.gantry.state.z).toBeCloseTo(-0.75, 6);
    runTo(14.0); // released into the case
    const box = station.root.children.find((c) => c.name === 'Carton');
    const inside = box.children.filter((c) => batch.members.some((m) => m.root === c));
    expect(inside).toHaveLength(4);
    [[-0.14, 0.1], [0.14, 0.1], [-0.14, -0.1], [0.14, -0.1]].forEach(([x, z], i) => {
      expect(batch.members[i].root.position.toArray().map((v) => +v.toFixed(6))).toEqual([x, 0.006, z]);
    });
    expect(cycle.status.cansInBox).toBe(4);
    runTo(16.7); // back on the pick side
    expect(eq.gantry.state.z).toBeCloseTo(0.75, 6);
    expect(eq.gantry.state.pitch).toBeCloseTo(0.26, 6);
    line.dispose();
  });

  it('the case becomes the unit, is closed by the closer, taped passing the head and leaves with the cans', () => {
    const { station, cycle, eq, runTo, line } = playStation2();
    runTo(17.0);
    const box = cycle.unit;
    expect(box.type).toBe('carton');
    const flap = (name) => box.root.getObjectByName(name);
    expect(Math.abs(flap('Minor flap leading').rotation.z)).toBeGreaterThan(1.8); // open (110°)
    runTo(20.0); // indexed to the closer
    expect(local(station, box.root).x).toBeCloseTo(1.35, 6);
    runTo(21.3); // end flaps folded by the tuckers: leaning in over the case
    const minor = Math.abs(flap('Minor flap leading').rotation.z);
    expect(minor).toBeLessThan(Math.PI / 2);
    expect(Math.abs(flap('Major flap front').rotation.x)).toBeGreaterThan(1.8); // side flaps still open
    runTo(23.5); // side flaps folded
    expect(Math.abs(flap('Major flap front').rotation.x)).toBeLessThan(Math.PI / 2);
    runTo(25.15); // pressed shut, tools parked
    for (const name of ['Minor flap leading', 'Minor flap trailing']) expect(flap(name).rotation.z).toBeCloseTo(0, 9);
    for (const name of ['Major flap front', 'Major flap rear']) expect(flap(name).rotation.x).toBeCloseTo(0, 9);
    expect([eq.closer.state.tuckerOut, eq.closer.state.tuckerUp, eq.closer.state.folderOut, eq.closer.state.plateUp]).toEqual([0.12, 0.27, 0.12, 0.3]);
    const tape = box.root.getObjectByName('Tape');
    expect(tape.visible).toBe(false);
    runTo(26.9); // half-way under the taping head (case centre ≈ x 2.3): taped from the leading edge back
    expect(tape.visible).toBe(true);
    expect(box.root.getObjectByName('Tape clip trailing').visible).toBe(false);
    expect(eq.taper.state.feed).not.toBe(0); // the tape roll turns
    const leaving = [];
    const put = cycle.ports.output.put;
    cycle.ports.output.put = (unit) => {
      leaving.push({ unit, cans: unit.root.children.filter((c) => c.name === 'JerryCan').length, taped: unit.root.getObjectByName('Tape clip trailing').visible, x: local(station, unit.root).x });
      put(unit);
    };
    runTo(31.4);
    expect(leaving).toHaveLength(1);
    expect(leaving[0].unit).toBe(box);
    expect(leaving[0].taped).toBe(true);
    expect(leaving[0].cans).toBe(4);
    expect(leaving[0].x).toBeCloseTo(4.8, 6); // the output port, inside the output tunnel
    expect(cycle.status.completed).toBe(1);
    line.dispose();
  });

  it('dry plan and run agree; the output port carries cases, the input batches', () => {
    const { cycle, line } = playStation2();
    expect(cycle.ports.input.carries).toBe('batch');
    expect(cycle.ports.output.carries).toBe('case');
    expect(cycle.timing.cycleTime).toBeCloseTo(31.55, 6);
    line.dispose();
  });
});
