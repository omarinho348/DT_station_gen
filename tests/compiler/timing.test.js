import { describe, it, expect } from 'vitest';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { Line, LINE_STATES } from '../../lib/line/index.js';
import {
  lineTiming, stationTable, compareStation, compareTiming, referenceTakt, formatTimingTable, STANDALONE_STEPS,
} from '../../compiler/timing.js';
import { createMaterials } from '../../lib/core/materials.js';
import { trapezoidDuration } from '../../lib/core/motion.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';
import { station, wait, lineData } from '../helpers/lineFixtures.js';
import reference from '../../benchmarks/expected/printer-line-reference-timing.json';

const materials = createMaterials();
const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const TRAVEL = trapezoidDuration(1.6, 0.45, 0.35);
const PORT_STEPS = 0.3 + TRAVEL + 0.4 + 0.35 + TRAVEL; // default intake + output

describe('line timing from data', () => {
  it('needs no geometry and equals the timing of the built line', () => {
    const data = lineData();
    const dry = lineTiming(registry, data);
    const line = new Line({ registry, line: data, ctx: { materials } });
    const built = line.timing;
    for (const s of dry.stations) close(s.cycleTime, built.stations[s.id].cycleTime);
    dry.transfers.forEach((t, i) => {
      close(t.distance, built.transfers[i].distance);
      close(t.duration, built.transfers[i].duration);
    });
    expect(dry.bottleneck).toEqual({ kind: 'station', id: built.bottleneck.station, time: dry.takt });
    line.dispose();
  });

  it('lists every step with its start time and phase; the rows add up to the cycle', () => {
    const t = lineTiming(registry, lineData());
    const b = t.stations.find((s) => s.id === 'b');
    expect(b.rows.map((r) => r.phase)).toEqual(['intake', 'intake', 'intake', 'process', 'process', 'output', 'output']);
    expect(b.rows.map((r) => r.label)).toEqual([
      'Stop raised · carrier indexing', 'Carrier transport to work position', 'Lift & locate carrier',
      'Working', 'Process complete', 'Releasing carrier', 'Transport to output port',
    ]);
    b.rows.slice(1).forEach((r, i) => close(r.t, b.rows[i].t + b.rows[i].duration));
    close(b.rows.reduce((sum, r) => sum + r.duration, 0), b.cycleTime);
    close(b.intake, 0.3 + TRAVEL + 0.4);
    close(b.process, 1.5);
    close(b.output, 0.35 + TRAVEL);
    expect(b.steps).toBe(7);
    expect(stationTable({ intake: { steps: [] }, process: { steps: [{ state: 'X', label: 'a', duration: 2 }] }, output: { steps: [] } }))
      .toEqual([{ t: 0, phase: 'process', state: 'X', label: 'a', duration: 2 }]);
  });

  it('takt is the slowest station (or transfer); lead and run times follow from it', () => {
    const t = lineTiming(registry, lineData());
    expect(t.stations.map((s) => s.id)).toEqual(['a', 'b', 'c']); // flow order
    close(t.takt, PORT_STEPS + 1.5);
    expect(t.bottleneck).toMatchObject({ kind: 'station', id: 'b' });
    const transfer = trapezoidDuration(2.4, 0.45, 0.35);
    close(t.leadTime, 0.9 + (3 * PORT_STEPS + 1 + 1.5 + 1) + 2 * transfer + 0.9);
    close(t.runTime, t.leadTime + 2 * t.takt);
    // Long transfers make the transfer the bottleneck.
    const far = lineTiming(registry, lineData({ transferLength: 10 }));
    expect(far.bottleneck.kind).toBe('transfer');
    close(far.takt, trapezoidDuration(10 + 1.2, 0.45, 0.35));
  });

  it('a played run finishes no earlier than the estimate and at most one hold per hand-over later', () => {
    const data = lineData();
    const estimate = lineTiming(registry, data);
    const line = new Line({ registry, line: data, ctx: { materials } });
    let t = 0;
    line.start();
    while (line.state !== LINE_STATES.FINISHED && t < 200) { line.update(0.01); t += 0.01; }
    expect(line.state).toBe(LINE_STATES.FINISHED);
    const handOvers = data.runSize * (data.stations.length + 1);
    expect(t).toBeGreaterThanOrEqual(estimate.runTime - 0.02);
    expect(t).toBeLessThanOrEqual(estimate.runTime + handOvers * CONVENTIONS.holdSeconds + 0.02);
    line.dispose();
  });

  it('formats a markdown table with the takt and the bottleneck', () => {
    const t = lineTiming(registry, lineData());
    const md = formatTimingTable(t);
    expect(md).toMatch(/^\| Station \| Intake s/);
    expect(md).toContain('| B2 Station B2 | 4.61 | 1.50 | 4.26 | 10.36 | 7 |');
    expect(md).toContain('| Transfer a.output → b.input | | | | 5.68 | |');
    expect(md).toContain('- Takt: **10.36 s** (bottleneck: station b)');
  });
});

describe('comparing with a reference recording', () => {
  const step = (label, duration, state = 'W') => ({ state, label, duration });

  it('aligns steps: one missing step is reported once, not as a shift', () => {
    const ref = [step('Carrier rising from return line', 0.9), step('a', 1), step('b', 2), step('c', 3), step('Carrier lowering to return line', 0.9)];
    expect(compareStation([step('a', 1), step('b', 2), step('c', 3)], ref)).toMatchObject({ ok: true, delta: 0, matched: 3 });
    const missing = compareStation([step('a', 1), step('c', 3)], ref);
    expect(missing.mismatches).toEqual([{ ours: null, reference: step('b', 2), reason: 'missing step' }]);
    expect(missing.delta).toBe(-2);
    const changed = compareStation([step('a', 1), step('b', 2.5), step('x', 1), step('c', 3, 'V')], ref);
    expect(changed.mismatches.map((m) => m.reason)).toEqual(['duration', 'extra step', 'state']);
  });

  it('the recording exists and covers all six reference stations and the line run', () => {
    expect(Object.keys(reference.stations)).toEqual(['st1', 'st2', 'st3', 'st4', 'st5', 'st6']);
    for (const s of Object.values(reference.stations)) {
      expect(s.units).toHaveLength(reference.conventions.runSize);
      close(s.unitTime, s.unitSteps.reduce((sum, x) => sum + x.duration, 0), 1e-4);
    }
    expect(reference.line.exits).toHaveLength(reference.conventions.runSize);
  });

  it('our default intake and output are exactly the reference ones (every station without shutters)', () => {
    const ours = lineTiming(registry, lineData()).stations[0].rows;
    const intake = ours.filter((r) => r.phase === 'intake');
    const output = ours.filter((r) => r.phase === 'output');
    for (const id of ['st1', 'st2', 'st3', 'st5', 'st6']) {
      const ref = reference.stations[id].unitSteps.filter((x) => !STANDALONE_STEPS.includes(x.label));
      const refOutput = ref.slice(ref.findIndex((x) => x.label === 'Process complete') + 1);
      expect(compareStation(intake, ref.slice(0, 3)).ok, `${id} intake`).toBe(true);
      expect(compareStation(output, refOutput).ok, `${id} output`).toBe(true);
    }
  });

  it('transfers take exactly the reference time', () => {
    const t = lineTiming(registry, lineData());
    const c = compareTiming(t, reference, { map: {} });
    expect(c.transfers.every((x) => x.ok)).toBe(true);
    close(t.transfers[0].duration, reference.line.transferDuration, 1e-5);
    expect(c.stations.every((s) => s.ok === null)).toBe(true); // nothing mapped: listed, not failed
  });

  it('the takt model holds on the reference line itself: units leave one bottleneck cycle apart', () => {
    const takt = referenceTakt(reference);
    expect(takt.id).toBe('st3');
    // Steady-state gaps between units leaving through the same exit (dispatch).
    const dispatched = reference.line.exits.filter((e) => e.exit === 'dispatched').map((e) => e.t);
    const gaps = dispatched.slice(1).map((t, i) => t - dispatched[i]).sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    expect(Math.abs(median - takt.cycle)).toBeLessThan(0.3);
  });
});
