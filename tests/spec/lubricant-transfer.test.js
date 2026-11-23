// lubricant-line.factory.json, the can transfer (row former) and the line from station 1 to station 2
// (Phase 5 step 9b part 2) against the recorded reference factory: the transfer step for step, the
// layout of the reference factory (ports meeting, station 2 shifted across the flow), the cans
// pushed into two lanes, and every case of a 27-case run packed when the reference packed it.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { Line } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import factory from '../../spec/examples/lubricant-line.factory.json';
import reference from '../../benchmarks/expected/lubricant-line-reference-timing.json';

const materials = createMaterials();
const DT = 0.02;
const TRANSFER_CYCLE = [
  ['Single-file transfer to row former', 4.833333], ['Pusher A forming lane 1', 0.7], ['Pusher retracting', 0.45],
  ['Indexing second pair', 1.833333], ['Pusher B forming lane 2', 0.7], ['Pusher retracting', 0.45],
  ['Two lanes formed', 0.2], ['Feeding Station 2 infeed', 4.183333], ['Transfer belt stopping', 0.5],
];

/** The line (or one station of it, stand-alone) played as the twin plays it, every step recorded. */
function play({ only = null } = {}) {
  const expanded = expandFactory(registry, factory);
  const data = only ? { ...expanded.line, stations: expanded.line.stations.filter((s) => s.id === only), edges: [] } : expanded.line;
  const line = new Line({ registry, line: data, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
  const clock = { t: 0 };
  const steps = {};
  for (const s of line.stations) {
    steps[s.id] = [];
    const before = s.cycle.sequencer.onStepStart;
    s.cycle.sequencer.onStepStart = (st) => { before?.(st); steps[s.id].push({ t: clock.t, state: st.state, label: st.label, duration: st.duration }); };
  }
  line.start();
  const runTo = (t) => { while (clock.t < t - 1e-9) { line.update(DT); clock.t += DT; } };
  return { line, steps, clock, runTo, station: (id) => line.byId.get(id) };
}
const world = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

describe('lubricant-line.factory.json · can transfer and the line to station 2', () => {
  beforeAll(() => preloadComponentAssets(registry)); // station 3's robot model
  it('plans the reference transfer cycle (13.85 s) and stands the stations as the reference factory', () => {
    const check = checkFactory(registry, factory);
    expect(check.errors).toEqual([]);
    expect(check.timing.stations.find((s) => s.id === 'canTransfer').cycleTime).toBeCloseTo(13.85, 6);
    // both joins to station 2 are direct: the only transfer conveyor is station 2 → 3
    expect(check.timing.transfers.map((t) => t.from)).toEqual(['packing.output']);
    const at = check.timing.layout.stations;
    // Reference FactoryLayout: the transfer belt centre 10.45 m after station 1's origin, station 2
    // 16.2 m after it and 0.75 m towards −Z (its can infeed on station 1's centre line).
    expect(at.canTransfer.x - at.filling.x).toBeCloseTo(10.45, 9);
    expect(at.packing.x - at.filling.x).toBeCloseTo(16.2, 9);
    expect(at.packing.z - at.filling.z).toBeCloseTo(-0.75, 9);
    expect(at.canTransfer.z).toBe(0);
  });

  it('stand-alone, it forms a batch into two lanes exactly as the recorded transfer', () => {
    const { steps, runTo, station, line } = play({ only: 'canTransfer' });
    runTo(14.0);
    const ours = steps.canTransfer.filter((s) => s.duration > 0).slice(0, 9).map((s) => [s.label, +s.duration.toFixed(6)]);
    expect(ours).toEqual(TRANSFER_CYCLE);
    const eq = station('canTransfer').equipment;
    expect(eq.standaloneInfeed.root.visible).toBe(true);
    line.dispose();
  });

  it('pushes the leading pair into the rear lane and the trailing pair into the front lane; pushers retract', () => {
    const { runTo, station, line } = play({ only: 'canTransfer' });
    const st = station('canTransfer');
    runTo(8.9); // stand-alone from t 0: pusher B pushed (7.82 → 8.52), now retracting
    const batch = st.cycle.unit;
    const local = (m) => st.root.worldToLocal(world(m.root));
    const z = batch.members.map((m) => +local(m).z.toFixed(6));
    expect(z).toEqual([0.13, 0.13, -0.13, -0.13]); // members 3, 4 (leading) rear, 1, 2 front
    const x = batch.members.map((m) => +local(m).x.toFixed(6));
    expect(x[3] - x[2]).toBeCloseTo(0.4, 6); // pairs keep station 1's pitch
    expect(x[1] - x[0]).toBeCloseTo(0.4, 6);
    expect(x[3] - x[1]).toBeCloseTo(0.8, 6); // the rear pair one index ahead until the feed lines them up
    runTo(9.5);
    expect(st.equipment.pusherA.state.face).toBeCloseTo(0.25, 9);
    expect(st.equipment.pusherB.state.face).toBeCloseTo(0.25, 9);
    line.dispose();
  });

  it('in the line: hoods instead of closed tunnels, no stand-alone infeed, the batch handed over where it stands', () => {
    const { runTo, station, line } = play();
    const s1 = station('filling').equipment;
    const t = station('canTransfer').equipment;
    const s2 = station('packing').equipment;
    expect([s1.outfeedTunnel.root.visible, s1.outfeedHood.root.visible]).toEqual([false, true]);
    expect([s2.canTunnel.root.visible, s2.canHood.root.visible]).toEqual([false, true]);
    expect(t.standaloneInfeed.root.visible).toBe(false);
    // The ports meet: station 1's hand-over place is the transfer's input, the transfer's output station 2's input.
    const port = (id, name) => station(id).root.localToWorld(station(id).cycle.portInStation(name));
    expect(port('filling', 'output').distanceTo(port('canTransfer', 'input'))).toBeLessThan(1e-9);
    expect(port('canTransfer', 'output').distanceTo(port('packing', 'input'))).toBeLessThan(1e-9);
    runTo(64.5); // the first batch fed into station 2's infeed (59.46 → 63.64), taken in after "Line empty"
    expect(station('packing').cycle.unit?.isBatch).toBe(true);
    line.dispose();
  });

  it('27 batches through the transfer step for step, and every case packed when the reference packed it', () => {
    const { line, steps, clock, station } = play();
    const s2 = station('packing').cycle;
    const packed = [];
    let done = 0;
    while (packed.length < 27 && clock.t < 1000) {
      line.update(DT);
      clock.t += DT;
      if (s2.status.completed > done) { done = s2.status.completed; packed.push(clock.t); }
    }
    const refPacked = reference.line.events.filter((e) => /packed/.test(e.event)).map((e) => e.t);
    expect(packed).toHaveLength(27);
    expect(station('filling').cycle.status.completed).toBe(27); // 108 cans: the preloaded batch counts too
    expect(line.released).toBe(27);
    packed.forEach((t, i) => expect(Math.abs(t - refPacked[i]), `case ${i + 1}`).toBeLessThan(0.05));
    // The transfer's own steps (waits left out: ours re-check under other names), start times too.
    const ours = steps.canTransfer.filter((s) => s.state === 'TRANSFER' && s.duration > 0);
    const theirs = reference.line.steps.canTransfer.filter((s) => s.state === 'TRANSFER' && s.label !== 'Waiting for Station 2 infeed');
    expect(ours.length).toBeGreaterThanOrEqual(27 * 9);
    for (let i = 0; i < 27 * 9; i += 1) {
      expect(`${ours[i].label}|${ours[i].duration.toFixed(6)}`, `step ${i}`).toBe(`${theirs[i].label}|${theirs[i].duration.toFixed(6)}`);
      expect(Math.abs(ours[i].t - theirs[i].t), `step ${i} ${ours[i].label}`).toBeLessThan(0.05);
    }
    expect(steps.packing.filter((s) => /arriving/.test(s.label)).every((s) => Math.abs(s.duration - 5.85) < 1e-9)).toBe(true);
    // Stations 1 and 2 in the line, step for step (their waits and holds left out: the reference
    // names them differently), up to the end of our run.
    const working = (list, waits) => list.filter((s) => s.duration > 0 && !waits.includes(s.state));
    for (const [id, ref] of [['filling', 's1'], ['packing', 's2']]) {
      const a = working(steps[id], ['WAITING', 'HOLDING']);
      const b = working(reference.line.steps[ref], ['IDLE']).filter((s) => !/^Waiting/.test(s.label));
      const n = a.filter((s) => s.t < clock.t - 40).length; // all but the last moments (the run ends there)
      expect(n, `${id}: steps compared`).toBeGreaterThan(300);
      for (let i = 0; i < n; i += 1) {
        expect(`${a[i].label}|${a[i].duration.toFixed(6)}`, `${id} step ${i}`).toBe(`${b[i].label}|${b[i].duration.toFixed(6)}`);
        expect(Math.abs(a[i].t - b[i].t), `${id} step ${i} ${a[i].label}`).toBeLessThan(0.05);
      }
    }
    line.dispose();
  }, 60000);
});
