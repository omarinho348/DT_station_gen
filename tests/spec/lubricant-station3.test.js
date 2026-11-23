// lubricant-line.factory.json, station 3 (palletizing with the ABB IRB 6760) and the case transfer from
// station 2 (Phase 5 step 9c part 1) against the recorded reference factory: the layout, the robot's
// pick and place, all 27 cases of a run set on the pallet when the reference set them there, and the
// outbound (part 2): the worker takes the full pallet to the wrapper, the wrap, the line's end.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { Line } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import factory from '../../spec/examples/lubricant-line.factory.json';
import reference from '../../benchmarks/expected/lubricant-line-reference-timing.json';

const materials = createMaterials();
const DT = 0.02;
const OUTBOUND_STATES = ['WORKER_SPAWN', 'WORKER_APPROACH', 'JACK_INSERT', 'JACK_LIFT', 'TRANSPORT_PALLET', 'PLACE_IN_WRAP', 'JACK_LOWER', 'JACK_RELEASE', 'WORKER_WITHDRAW', 'JACK_STOW', 'WRAPPING'];
const ROBOT_STATES = ['BOX_AT_PICKUP', 'APPROACH_BOX', 'LOWER_TO_BOX', 'GRIPPING', 'LIFT', 'MOVE_TO_STACK', 'LOWER_TO_STACK', 'RELEASING', 'VERIFY_PLACEMENT', 'RETRACT', 'RETURN_HOME', 'SPAWN_BOX'];

beforeAll(() => preloadComponentAssets(registry));

function play({ only = null } = {}) {
  const expanded = expandFactory(registry, factory);
  const data = only ? { ...expanded.line, stations: expanded.line.stations.filter((s) => s.id === only), edges: [] } : expanded.line;
  const line = new Line({ registry, line: data, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
  const clock = { t: 0 };
  const steps = [];
  const st = line.byId.get('palletizing');
  const before = st.cycle.sequencer.onStepStart;
  st.cycle.sequencer.onStepStart = (s) => { before?.(s); steps.push({ t: clock.t, state: s.state, label: s.label, duration: s.duration }); };
  line.start();
  const runTo = (t) => { while (clock.t < t - 1e-9) { line.update(DT); clock.t += DT; } };
  return { line, st, steps, clock, runTo };
}
const world = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

describe('lubricant-line.factory.json · station 3 (palletizing) and the case transfer', () => {
  it('is valid; stands 11.21 m after station 2 and 0.75 m towards −Z, joined by a 3.21 m case transfer (5.85 s)', () => {
    const check = checkFactory(registry, factory);
    expect(check.errors).toEqual([]);
    const at = check.timing.layout.stations;
    expect(at.palletizing.x - at.packing.x).toBeCloseTo(11.21, 9); // reference FactoryLayout
    expect(at.palletizing.z - at.packing.z).toBeCloseTo(-0.75, 9);
    expect(check.timing.transfers).toEqual([{ from: 'packing.output', to: 'palletizing.input', distance: 3.21, duration: 5.85 }]);
    // case into the cell 1.83 + to the pick point 3.70 (0.7 m/s, no ramp) + 0.25 + the robot 10.86 + ready for the
    // next case 0.2: planned as the usual case (planAs), not the outbound that comes once per 27 cases
    expect(check.timing.stations.find((s) => s.id === 'palletizing').cycleTime).toBeCloseTo(1.833333 + 2.592 / 0.7 + 0.25 + 10.86 + 0.2, 5);
    expect(check.timing.bottleneck).toEqual({ kind: 'station', id: 'packing', time: 31.55 });
  });

  it('stand-alone: the robot lands on the case top, carries it and sets it exactly on its spot, then goes home', () => {
    const { st, runTo, line } = play({ only: 'palletizing' });
    const eq = st.equipment;
    runTo(5.9); // case at the pick point (1.83 + 3.70 s), stand-alone a closed carton
    const kase = st.cycle.unit;
    expect(kase.type).toBe('carton');
    expect(kase.root.getObjectByName('Tape clip trailing').visible).toBe(true);
    const pick = st.root.worldToLocal(world(kase.root));
    expect(pick.x).toBeCloseTo(0.192, 6);
    expect(pick.y).toBeCloseTo(0.82, 6);
    runTo(5.786 + 3.25 + 0.05); // gripped (approach 1.8 + lower 1.0 + grip 0.45)
    const tool = world(eq.robot.anchor('tool'));
    const top = kase.root.localToWorld(kase.ref('top'));
    expect(tool.distanceTo(top)).toBeLessThan(0.003); // within the IK's 2 mm (+ 1 mm gap)
    runTo(5.786 + 4.4); // lifted (lift ends 4.35 s after the pick point): carried high over the stack
    expect(world(kase.root).y).toBeGreaterThan(1.3);
    runTo(5.786 + 7.75); // released onto the first spot (release ends 7.7 s after the pick point)
    const placed = st.root.worldToLocal(world(kase.root));
    // first spot: the pallet's first column / row, on its top (0.144 m)
    expect([placed.x, placed.y, placed.z].map((v) => +v.toFixed(6))).toEqual([0.14 - 0.64, 0.144, 2.84 - 0.44]);
    expect(st.cycle.status.palletCount).toBe(1);
    runTo(5.786 + 10.86 + 0.3);
    expect([eq.robot.state.x, eq.robot.state.y, eq.robot.state.z].map((v) => +v.toFixed(6))).toEqual([2.2, 2.0, 0]);
    expect(st.cycle.status.completed).toBe(1);
    line.dispose();
  }, 30000);

  it('in the line: every case on the pallet when the reference set it there, the robot and the outbound step for step, the line ending with the reference', () => {
    const { line, st, steps, clock } = play();
    const placedAt = [];
    let n = 0;
    while (placedAt.length < 27 && clock.t < 1000) {
      line.update(DT);
      clock.t += DT;
      if ((st.cycle.status.palletCount ?? 0) > n) { n = st.cycle.status.palletCount; placedAt.push(clock.t); }
    }
    const end = clock.t + 4; // the last case's settle, retract and return home
    while (clock.t < end) { line.update(DT); clock.t += DT; }
    const ref = reference.line.events.filter((e) => /on the pallet/.test(e.event)).map((e) => e.t);
    expect(placedAt).toHaveLength(27);
    // 0.1 s: the reference station 3 ends every step on a whole frame (0.02 s; its 0.45 s grip
    // lasts 0.46 s), ours keeps the exact times; the difference stays bounded (no drift).
    const TOL = 0.1;
    placedAt.forEach((t, i) => expect(Math.abs(t - ref[i]), `case ${i + 1}`).toBeLessThan(TOL));
    // The robot's steps against the recording (its first SPAWN_BOX at t 0 has no counterpart:
    // ours waits for the first case without it; a duplicate entry per claw step in the recording).
    const ours = steps.filter((s) => ROBOT_STATES.includes(s.state) && s.duration > 0);
    const theirs = reference.line.steps.s3
      .filter((s, i, all) => ROBOT_STATES.includes(s.state) && s.duration > 0 && !(i > 0 && all[i - 1].state === s.state && all[i - 1].t === s.t))
      .slice(1);
    expect(theirs.length).toBe(27 * 12 - 1); // 27 cases × 12 steps, no SPAWN_BOX after the last
    expect(ours.length).toBeGreaterThanOrEqual(theirs.length);
    for (let i = 0; i < theirs.length; i += 1) {
      expect(ours[i].state, `step ${i}`).toBe(theirs[i].state);
      expect(Math.abs(ours[i].duration - theirs[i].duration), `step ${i} ${ours[i].state}`).toBeLessThan(1e-4);
      expect(Math.abs(ours[i].t - theirs[i].t), `step ${i} ${ours[i].state}`).toBeLessThan(TOL);
    }
    // The outbound after the 27th case, to the end of the line.
    while (line.state !== 'FINISHED' && clock.t < 1100) { line.update(DT); clock.t += DT; }
    expect(line.state).toBe('FINISHED');
    const outbound = steps.filter((s) => OUTBOUND_STATES.includes(s.state));
    const refOutbound = reference.line.steps.s3.filter((s) => OUTBOUND_STATES.includes(s.state));
    expect(outbound.map((s) => [s.state, +s.duration.toFixed(4)])).toEqual(refOutbound.map((s) => [s.state, s.duration]));
    outbound.forEach((s, i) => expect(Math.abs(s.t - refOutbound[i].t), s.state).toBeLessThan(TOL));
    const wrapEnd = (list) => list.at(-1).t + list.at(-1).duration;
    expect(Math.abs(wrapEnd(outbound) - wrapEnd(refOutbound))).toBeLessThan(TOL);
    expect(Math.abs(clock.t - reference.line.finished)).toBeLessThan(0.15); // + one hold re-check each
    // The pallet with all 27 cases on the wrapper deck, wrapped; the worker back out, forks down.
    const eq = st.equipment;
    expect(world(eq.pallet.root).distanceTo(world(eq.wrapper.anchor('deck')))).toBeLessThan(1e-9);
    expect(eq.pallet.root.children.filter((c) => c.name === 'Carton')).toHaveLength(27);
    expect(eq.wrapper.state.wrap).toBe(1);
    expect(eq.worker.state.forks).toBeCloseTo(0.045, 9);
    line.dispose();
  }, 240000);

  it('a reset puts the pallet back where it stood and frees what was on it', () => {
    const { line, st, runTo } = play({ only: 'palletizing' });
    runTo(30); // two cases stacked stand-alone
    expect(st.cycle.stackItems.pallet.length).toBeGreaterThan(0);
    const placed = st.equipment.pallet.root.position.clone();
    st.equipment.pallet.root.position.x += 3; // as if hauled away
    line.reset();
    expect(st.cycle.stackItems.pallet).toHaveLength(0);
    expect(st.equipment.pallet.root.position.toArray()).toEqual(placed.toArray());
    expect(st.root.children.filter((c) => c.name === 'Carton')).toHaveLength(0);
    line.dispose();
  }, 60000);
});
