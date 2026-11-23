import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { Line, LINE_STATES, layoutLine, flowOrder, LayoutError, LineError } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { trapezoidDuration } from '../../lib/core/motion.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';
import { station, wait, lineData } from '../helpers/lineFixtures.js';

const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

// ---- Layout --------------------------------------------------------------------------------------

const REF = { start: -2.2, end: 2.2 }; // reference station conveyor
const chain = (n) => Array.from({ length: n - 1 }, (_, i) => ({ from: `s${i + 1}.output`, to: `s${i + 2}.input` }));
const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, extent: REF }));

describe('layout', () => {
  it('places the six printer stations exactly as the reference PrinterLineLayout', () => {
    const pitch = 4.4 + 1.2;
    const l = layoutLine({ stations: ids(6), edges: chain(6) });
    expect(l.order).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    l.order.forEach((id, i) => close(l.stations[id].x, (i - 2.5) * pitch));
    l.transfers.forEach((t, i) => {
      const x = (i - 2.5) * pitch;
      close(t.start, x + 2.2);
      close(t.end, x + pitch - 2.2);
      close(t.length, 1.2);
    });
    close(l.length, 6 * 4.4 + 5 * 1.2);
  });

  it('follows the edges, not the list order, and keeps the gap for stations of different lengths', () => {
    const stations = [{ id: 'c', extent: { start: -1, end: 3 } }, { id: 'a', extent: REF }, { id: 'b', extent: { start: -0.5, end: 0.5 } }];
    const l = layoutLine({ stations, edges: [{ from: 'b.output', to: 'c.input' }, { from: 'a.output', to: 'b.input' }], transferLength: 0.8 });
    expect(l.order).toEqual(['a', 'b', 'c']);
    l.transfers.forEach((t) => close(t.length, 0.8));
    close(l.stations.a.x + l.stations.c.x, 0); // centred
  });

  it('refuses graphs it cannot lay out, with clear messages (branches are laid out: tests/line/graph.test.js)', () => {
    expect(flowOrder(['a', 'b', 'c'], [{ from: 'a.output', to: 'b.input' }, { from: 'a.reject', to: 'c.input' }])).toEqual(['a', 'b']);
    expect(() => flowOrder(['a', 'b'], [{ from: 'a.output', to: 'b.input' }, { from: 'b.output', to: 'a.input' }])).toThrow(/loop/);
    expect(() => flowOrder(['a', 'b', 'c'], [{ from: 'a.output', to: 'b.input' }, { from: 'b.reject', to: 'c.input' }, { from: 'c.output', to: 'a.input' }])).toThrow(/rework lane cannot feed back upstream/);
    expect(() => flowOrder(['a', 'b', 'c'], [{ from: 'a.output', to: 'b.input' }])).toThrow(/2 separate parts/);
    expect(() => flowOrder(['a'], [{ from: 'a.output', to: 'x.input' }])).toThrow(/unknown station "x"/);
    expect(() => flowOrder(['a'], [{ from: 'a.output', to: 'a.input' }])).toThrow(/cannot feed itself/);
    expect(() => flowOrder(['a'], [{ from: 'a', to: 'a.input' }])).toThrow(LayoutError);
    expect(() => layoutLine({ stations: [{ id: 'a', extent: { start: 1, end: 0 } }], edges: [] })).toThrow(/must run along \+X/);
  });
});

// ---- Line ----------------------------------------------------------------------------------------

const make = (data = lineData()) => new Line({ registry, line: data, ctx: { materials } });
const advance = (line, seconds, dt = 1 / 20) => { for (let t = 0; t < seconds; t += dt) line.update(dt); };

/** Which unit each station took, in order. */
function watchUnits(line) {
  const seen = Object.fromEntries(line.stations.map((s) => [s.id, []]));
  line.onUpdate = () => {
    for (const s of line.stations) if (s.cycle.unit && seen[s.id].at(-1) !== s.cycle.unit) seen[s.id].push(s.cycle.unit);
  };
  return seen;
}

describe('line', () => {
  it('places stations by the layout and fills each gap with a transfer conveyor', () => {
    const line = make();
    const xs = line.stations.map((s) => s.root.position.x);
    close(xs[1] - xs[0], 5.6);
    close(xs[0] + xs[2], 0);
    expect(line.transfers).toHaveLength(2);
    line.transfers.forEach((t) => {
      close(t.conveyor.params.length, 1.2);
      expect(t.conveyor.params.workStop).toBe(false);
      close(t.distance, 5.6 - 3.2); // output port → next input port, as in the reference
      close(t.duration, trapezoidDuration(2.4, 0.45, 0.35));
    });
    // Return-line lifts only at the line's two ends.
    const visible = (s, id) => line.byId.get(s).equipment[id].root.visible;
    expect([visible('a', 'liftIn'), visible('a', 'liftOut'), visible('b', 'liftIn'), visible('b', 'liftOut'), visible('c', 'liftIn'), visible('c', 'liftOut')])
      .toEqual([true, false, false, false, false, true]);
    line.dispose();
  });

  it('runs a whole run: same units from first to last station, in order, then finishes', () => {
    const line = make();
    const seen = watchUnits(line);
    line.start();
    advance(line, 80);
    expect(line.state).toBe(LINE_STATES.FINISHED);
    expect(line.status).toMatchObject({ released: 3, exited: 3, inProcess: 0 });
    expect(seen.a).toHaveLength(3);
    expect(seen.b).toEqual(seen.a);
    expect(seen.c).toEqual(seen.a);
    expect(seen.a.map((u) => u.params.serial)).toEqual([1, 2, 3]);
    expect(line.stations.every((s) => !s.cycle.running && s.cycle.error === null)).toBe(true);
    expect(line.byId.get('a').cycle.status.step).toBe('Run complete · all carriers released');
    line.dispose();
  });

  it('carries each unit over the transfer to exactly the next input port, belts scrolling', () => {
    const line = make();
    line.start();
    const t = line.transfers[0];
    for (let i = 0; i < 2000 && !t.unit; i += 1) line.update(0.02);
    const unit = t.unit;
    // put on the transfer at the upstream output port (it may already have moved within that frame)
    const along = new THREE.Line3(t.fromPos, t.toPos).closestPointToPointParameter(unit.root.position, false);
    expect(unit.root.position.distanceTo(t.fromPos)).toBeLessThan(0.005);
    expect(along).toBeGreaterThanOrEqual(0);
    const belt0 = t.conveyor.state.belt;
    line.update(1);
    expect(t.conveyor.state.belt).not.toBe(belt0);
    for (let i = 0; i < 400 && !t.staged; i += 1) line.update(0.02);
    const b = line.byId.get('b');
    const inputWorld = b.equipment.line.root.localToWorld(new THREE.Vector3(-1.6, CONVENTIONS.beltHeight, 0));
    // staged at b's input port, or b already took it from there
    if (t.unit) expect(worldOf(unit.root).distanceTo(inputWorld)).toBeLessThan(1e-6);
    advance(line, 0.5);
    expect(b.cycle.unit).toBe(unit);
    expect(unit.root.parent).toBe(b.root);
    line.dispose();
  });

  it('back-pressure: upstream holds (amber) while the transfer is occupied', () => {
    const line = make(lineData({ stations: [station('a', 'A1', wait(0.5)), station('b', 'B2', wait(30)), station('c', 'C3', wait(0.5))] }));
    line.start();
    advance(line, 40);
    const a = line.byId.get('a');
    expect(a.cycle.status.state).toBe('HOLDING');
    expect(a.equipment.beacon.state.mode).toBe('wait');
    expect(line.status.transfers[0]).toMatch(/waiting$/);
    expect(line.byId.get('c').cycle.status).toMatchObject({ state: 'WAITING', step: 'Waiting for B2' });
    line.dispose();
  });

  it('plays at 10× the same as at 1×', () => {
    const slow = make();
    const fast = make();
    fast.setSpeed(10);
    slow.start();
    fast.start();
    advance(slow, 80);
    advance(fast, 8, 1 / 200);
    expect(fast.state).toBe(LINE_STATES.FINISHED);
    expect(fast.status.exited).toBe(slow.status.exited);
    slow.dispose();
    fast.dispose();
  });

  it('reset clears units on transfers and stations; the next run starts at serial 1', () => {
    const line = make();
    const seen = watchUnits(line);
    line.start();
    for (let i = 0; i < 2000 && !line.transfers[0].unit; i += 1) line.update(0.02);
    const onTransfer = line.transfers[0].unit;
    line.reset();
    expect(onTransfer.root.parent).toBeNull();
    expect(line.status).toMatchObject({ state: 'IDLE', released: 0, exited: 0, transfers: ['empty', 'empty'] });
    line.start();
    advance(line, 1);
    expect(seen.a.at(-1).params.serial).toBe(1);
    line.dispose();
  });

  it('dry timing per station, per transfer, and the bottleneck', () => {
    const line = make();
    const { stations, transfers, bottleneck } = line.timing;
    const port = 0.3 + trapezoidDuration(1.6, 0.45, 0.35) + 0.4 + 0.35 + trapezoidDuration(1.6, 0.45, 0.35);
    close(stations.a.cycleTime, port + 1);
    close(stations.b.cycleTime, port + 1.5);
    expect(bottleneck.station).toBe('b');
    expect(transfers.map((t) => t.from)).toEqual(['a.output', 'b.output']);
    line.dispose();
  });

  it('refuses lines it cannot build, naming the edge or station', () => {
    const base = lineData();
    const rollers = station('c', 'C3', wait(1), { conveyor: 'rollerConveyor' });
    expect(() => make({ ...base, stations: [base.stations[0], base.stations[1], rollers] })).toThrow(/edge b.output → c.input: "output" carries pallet but "input" takes unit/);
    expect(() => make({ ...base, edges: [{ ...base.edges[0], carries: 'case' }, base.edges[1]] })).toThrow(/the edge says case but the ports carry pallet/);
    expect(() => make({ ...base, edges: [{ ...base.edges[0], from: 'a.side' }, base.edges[1]] })).toThrow(/station "a" has no port "side"/);
    expect(() => make({ ...base, edges: [{ ...base.edges[0], transport: { type: 'nope' } }, base.edges[1]] })).toThrow(/unknown transport type "nope"/);
    expect(() => make({ ...base, edges: [base.edges[0]] })).toThrow(/2 separate parts/);
    expect(() => make({ ...base, stations: [base.stations[0], base.stations[0], base.stations[2]] })).toThrow(/station id "a" is used twice/);
    const turned = station('a', 'A1', wait(1));
    turned.equipment[0].rotationY = 0.5;
    expect(() => make({ ...base, stations: [turned, base.stations[1], base.stations[2]] })).toThrow(/must run along the station's \+X/);
    expect(() => make({ ...base, runSize: 0 })).toThrow(LineError);
  });
});

describe('dev line files (app/dev/lines)', () => {
  it('every dev line builds and moves its first unit into the second station (one-station lines: through the station)', async () => {
    const { createLineDemo, lineNames } = await import('../../app/dev/lineDemo.js');
    await preloadComponentAssets(registry); // the lubricant line's robot model
    expect(lineNames().length).toBeGreaterThan(0);
    for (const name of lineNames()) {
      const demo = createLineDemo({ line: name });
      const [first, second] = demo.line.layout.order.map((id) => demo.line.byId.get(id));
      // An indexing station needs one machine cycle per position a batch travels.
      const cycles = first.cycle.station.indexing ? first.cycle.station.indexing.positions.length + 1 : 1;
      if (second) {
        demo.skip(first.cycle.timing.cycleTime * cycles + demo.line.transfers[0].duration + CONVENTIONS.lift.duration + 1);
        expect(demo.line.stations.every((s) => s.cycle.error === null), name).toBe(true);
        expect(second.cycle.status.unit, name).not.toBe('—');
      } else {
        demo.skip(first.cycle.timing.cycleTime * cycles + 1);
        expect(first.cycle.error, name).toBe(null);
        expect(demo.line.status.exited, name).toBeGreaterThan(0);
      }
      demo.dispose();
    }
  }, 60000);
});
