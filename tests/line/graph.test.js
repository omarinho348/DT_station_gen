// Line graph shapes (Phase 6 step 6): parallel copies, reject branches to a station of their own,
// merges (fan-in), feeders, and buffers (transfers holding several units). Layout first (pure), then
// the line playing each shape, then the dry timing.
import { describe, it, expect } from 'vitest';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { Line, LINE_STATES, layoutLine } from '../../lib/line/index.js';
import { lineTiming } from '../../compiler/timing.js';
import { createMaterials } from '../../lib/core/materials.js';
import { station, wait, TRANSFER } from '../helpers/lineFixtures.js';

const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const REF = { start: -2.2, end: 2.2 };
const DEPTH = [-1, 1];
const TL = 1.2;

// ---- Layout --------------------------------------------------------------------------------------

describe('layout of graph shapes', () => {
  it('parallel copies stand side by side across Z, centred where one station would; transfers to them run at an angle', () => {
    const l = layoutLine({
      stations: [
        { id: 'a', extent: REF, depth: DEPTH },
        { id: 'b1', extent: REF, depth: DEPTH, group: 'b' },
        { id: 'b2', extent: REF, depth: DEPTH, group: 'b' },
        { id: 'c', extent: REF, depth: DEPTH },
      ],
      edges: [
        { from: 'a.output', to: 'b1.input' }, { from: 'a.output', to: 'b2.input' },
        { from: 'b1.output', to: 'c.input' }, { from: 'b2.output', to: 'c.input' },
      ],
    });
    expect(l.main).toEqual(['a', 'b1', 'c']);
    expect(l.order).toEqual(['a', 'b1', 'b2', 'c']);
    close(l.stations.b1.x, l.stations.b2.x);
    close(l.stations.b1.x - l.stations.a.x, 5.6); // the chain spacing, as for one station
    close(l.stations.b1.z, -1.6); // ±(depth 2 + gap 1.2) / 2
    close(l.stations.b2.z, 1.6);
    close(l.stations.a.z, 0);
    close(l.stations.c.z, 0);
    expect(l.transfers).toHaveLength(4);
    const toB1 = l.transfers.find((t) => t.edge === 0);
    expect(toB1.inLine).toBe(false);
    close(toB1.angle, Math.atan2(-1.6, 1.2));
    close(toB1.length, Math.hypot(1.2, 1.6));
  });

  it('a reject branch stands in a side lane, its input at the reject port\'s X, one transfer length clear across Z', () => {
    const l = layoutLine({
      stations: [
        { id: 'a', extent: REF, depth: [-1.4, 1], ports: { output: { x: 1.6, z: 0 }, reject: { x: 0.3, z: -1.29 } } },
        { id: 'b', extent: REF, depth: DEPTH },
        { id: 'r', extent: { start: -1, end: 1 }, depth: [-0.6, 0.6], ports: { input: { x: -1, z: 0 } } },
      ],
      edges: [{ from: 'a.output', to: 'b.input' }, { from: 'a.reject', to: 'r.input' }],
    });
    expect(l.main).toEqual(['a', 'b']);
    close(l.stations.r.x - 1, l.stations.a.x + 0.3); // joined ports at the same X
    close(l.stations.r.z, -1.4 - TL - 0.6); // on the reject port's side (−Z)
    const branch = l.transfers.find((t) => t.edge === 1);
    expect(branch.inLine).toBe(false);
    close(branch.startZ, -1.29);
    close(branch.endZ, l.stations.r.z);
    close(Math.abs(branch.angle), Math.PI / 2); // straight across the flow
    close(l.length, 5.6 + 4.4); // the line length is the main path's
  });

  it('a feeder merging into a station stands in a side lane, one transfer length upstream; two side stations at one place take two lanes', () => {
    const l = layoutLine({
      stations: [
        { id: 'a', extent: REF, depth: DEPTH },
        { id: 'b', extent: REF, depth: DEPTH, ports: { input: { x: -1.6, z: 0 } } },
        { id: 'f', extent: REF, depth: DEPTH, ports: { output: { x: 1.6, z: 0 } } },
        { id: 'g', extent: REF, depth: DEPTH, ports: { output: { x: 1.6, z: 0 } } },
      ],
      edges: [{ from: 'a.output', to: 'b.input' }, { from: 'f.output', to: 'b.input' }, { from: 'g.output', to: 'b.input' }],
    });
    close(l.stations.f.x + 1.6, l.stations.b.x - 1.6 - TL); // its output one transfer length upstream of the input
    close(l.stations.f.z, -1 - TL - 1);
    close(l.stations.g.z, l.stations.f.z - (2 + TL)); // the next lane out
  });

  it('a plain chain is laid out exactly as before (every transfer in line, angle 0)', () => {
    const l = layoutLine({ stations: ['a', 'b', 'c'].map((id) => ({ id, extent: REF })), edges: [{ from: 'a.output', to: 'b.input' }, { from: 'b.output', to: 'c.input' }] });
    expect(l.transfers.map((t) => [t.inLine, t.angle, t.edge])).toEqual([[true, 0, 0], [true, 0, 1]]);
    close(l.stations.a.x, -5.6);
    expect(l.order).toEqual(l.main);
  });
});

// ---- Playing ---------------------------------------------------------------------------------------

const make = (data, facts) => new Line({ registry, line: data, ctx: { materials }, facts });
const runToEnd = (line, limit = 400, dt = 0.05) => {
  let t = 0;
  for (; t < limit && line.state !== LINE_STATES.FINISHED; t += dt) line.update(dt);
  return t;
};
const watch = (line) => {
  const seen = Object.fromEntries(line.stations.map((s) => [s.id, []]));
  line.onUpdate = () => { for (const s of line.stations) if (s.cycle.unit && seen[s.id].at(-1) !== s.cycle.unit) seen[s.id].push(s.cycle.unit); };
  return seen;
};
const serials = (list) => list.map((u) => u.params.serial);

const copy = (id, code, process, of) => ({ ...station(id, code, process), copyOf: of });
const edge = (from, to, extra = {}) => ({ from, to, transport: { ...TRANSFER, ...extra } });

describe('playing graph shapes', () => {
  it('parallel copies share a slow station\'s work and shorten the run', () => {
    const chain = make({
      id: 'one', title: 'One slow station', runSize: 6, product: { type: 'printer' },
      stations: [station('a', 'A', wait(1)), station('b', 'B', wait(20)), station('c', 'C', wait(1))],
      edges: [edge('a.output', 'b.input'), edge('b.output', 'c.input')],
    });
    chain.start();
    const alone = runToEnd(chain);

    const line = make({
      id: 'two', title: 'Two copies', runSize: 6, product: { type: 'printer' },
      stations: [station('a', 'A', wait(1)), copy('b1', 'B1', wait(20), 'b'), copy('b2', 'B2', wait(20), 'b'), station('c', 'C', wait(1))],
      edges: [edge('a.output', 'b1.input'), edge('a.output', 'b2.input'), edge('b1.output', 'c.input'), edge('b2.output', 'c.input')],
    });
    const seen = watch(line);
    line.start();
    const shared = runToEnd(line);
    expect(line.state).toBe(LINE_STATES.FINISHED);
    expect(line.status).toMatchObject({ released: 6, exited: 6 });
    expect(seen.b1).toHaveLength(3); // taking turns
    expect(seen.b2).toHaveLength(3);
    expect(serials(seen.c).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shared).toBeLessThan(alone * 0.7);
    // The copies stand across Z, the transfers to them at an angle.
    expect(line.byId.get('b1').root.position.z).toBeLessThan(0);
    expect(line.byId.get('b2').root.position.z).toBeGreaterThan(0);
    expect(Math.abs(line.transfers[0].conveyor.root.rotation.y)).toBeGreaterThan(0.1);
    chain.dispose();
    line.dispose();
  });

  it('a reject branch sends rejected units to a rework station of their own; good ones go on', () => {
    const inspect = {
      ...station('a', 'A', [
        { op: 'wait', seconds: 1, label: 'Inspecting' },
        { op: 'decide', on: 'verdict', cases: { pass: [], reject: [{ op: 'transfer', conveyor: 'line', from: { machine: 'line', port: 'work' }, to: { machine: 'rejectLane', port: 'input' }, label: 'To the reject lane' }] } },
      ]),
      ports: { input: { standalone: ['liftIn'] }, output: { standalone: ['liftOut'] }, reject: { machine: 'rejectLane', port: 'input', direction: 'out' } },
    };
    inspect.equipment = [...inspect.equipment, { id: 'rejectLane', type: 'palletConveyor', params: { length: 1.82, workStop: false }, position: [0, 0, -1.29], rotationY: Math.PI / 2 }];
    const line = make({
      id: 'rej', title: 'Reject branch', runSize: 4, product: { type: 'printer' },
      stations: [inspect, station('b', 'B', wait(1)), station('r', 'R', wait(2))],
      edges: [edge('a.output', 'b.input'), edge('a.reject', 'r.input')],
    }, (unit) => ({ verdict: unit.params.serial % 2 === 0 ? 'reject' : 'pass' }));
    const seen = watch(line);
    line.start();
    runToEnd(line);
    expect(line.state).toBe(LINE_STATES.FINISHED);
    expect(serials(seen.b)).toEqual([1, 3]);
    expect(serials(seen.r)).toEqual([2, 4]);
    expect(line.status.exited).toBe(4);
    // The rework station stands in a side lane on the reject side.
    expect(line.byId.get('r').root.position.z).toBeLessThan(line.byId.get('a').root.position.z - 1);
    line.dispose();
  });

  it('a merge: two sources feed one station, the run released through both, serials unique across them', () => {
    const line = make({
      id: 'merge', title: 'Merge', runSize: 4, product: { type: 'printer' },
      stations: [station('s1', 'S1', wait(1)), station('s2', 'S2', wait(1.5)), station('m', 'M', wait(2))],
      edges: [edge('s1.output', 'm.input'), edge('s2.output', 'm.input')],
    });
    const seen = watch(line);
    line.start();
    runToEnd(line);
    expect(line.state).toBe(LINE_STATES.FINISHED);
    expect(line.status).toMatchObject({ released: 4, exited: 4 });
    expect(seen.s1.length + seen.s2.length).toBe(4);
    expect(seen.s1.length).toBeGreaterThan(0);
    expect(seen.s2.length).toBeGreaterThan(0);
    expect(seen.m).toHaveLength(4);
    expect(serials(seen.m).sort()).toEqual([1, 2, 3, 4]); // one numbering across both sources
    line.dispose();
  });

  it('a buffer holds several units queued a pitch apart, so a fast station upstream is freed sooner', () => {
    const data = (capacity) => ({
      id: `buf${capacity}`, title: 'Buffer', runSize: 5, product: { type: 'printer' },
      stations: [station('a', 'A', wait(1)), station('b', 'B', wait(20))],
      edges: [edge('a.output', 'b.input', capacity > 1 ? { capacity } : {})],
    });
    const lastRelease = (capacity) => {
      const line = make(data(capacity));
      line.start();
      let peak = 0;
      let at = null;
      let gap = Infinity;
      for (let t = 0; t < 300 && line.state !== LINE_STATES.FINISHED; t += 0.05) {
        line.update(0.05);
        const tr = line.transfers[0];
        peak = Math.max(peak, capacity > 1 ? tr.queue.length : tr.unit ? 1 : 0);
        if (capacity > 1 && tr.queue.length >= 2 && tr.queue.every((q) => q.elapsed >= q.duration)) {
          gap = Math.min(gap, tr.queue[0].unit.root.position.distanceTo(tr.queue[1].unit.root.position));
        }
        if (at === null && line.byId.get('a').cycle.status.completed >= 5) at = t;
      }
      expect(line.state).toBe(LINE_STATES.FINISHED);
      line.dispose();
      return { at, peak, gap, pitch: capacity > 1 ? line.transfers[0].pitch : null };
    };
    const plain = lastRelease(1);
    const buffered = lastRelease(3);
    expect(plain.peak).toBe(1);
    expect(buffered.peak).toBe(3);
    close(buffered.gap, buffered.pitch, 1e-6); // queued units rest a pitch apart
    expect(buffered.at).toBeLessThan(plain.at - 5); // station A done with its five units well before
  });
});

// ---- Dry timing ------------------------------------------------------------------------------------

describe('timing of graph shapes', () => {
  it('parallel copies divide their station\'s time for the takt; side stations don\'t set it', () => {
    const t = lineTiming(registry, {
      id: 'two', title: 'Two copies', runSize: 6, product: { type: 'printer' },
      stations: [station('a', 'A', wait(1)), copy('b1', 'B1', wait(20), 'b'), copy('b2', 'B2', wait(20), 'b'), station('c', 'C', wait(1)), station('r', 'R', wait(30))],
      edges: [edge('a.output', 'b1.input'), edge('a.output', 'b2.input'), edge('b1.output', 'c.input'), edge('b2.output', 'c.input'), edge('c.output', 'r.input')],
    });
    // c.output feeds r: r is then the main path's last place (its output port), so it does count…
    expect(t.layout.main).toEqual(['a', 'b1', 'c', 'r']);
    expect(t.bottleneck).toMatchObject({ kind: 'station', id: 'r' });
    // …whereas a slow feeder off the main path (merging into c) doesn't.
    const reworked = lineTiming(registry, {
      id: 'two', title: 'Two copies', runSize: 6, product: { type: 'printer' },
      stations: [station('a', 'A', wait(1)), copy('b1', 'B1', wait(20), 'b'), copy('b2', 'B2', wait(20), 'b'), station('c', 'C', wait(1)), station('f', 'F', wait(30))],
      edges: [edge('a.output', 'b1.input'), edge('a.output', 'b2.input'), edge('b1.output', 'c.input'), edge('b2.output', 'c.input'), edge('f.output', 'c.input')],
    });
    const b = reworked.stations.find((s) => s.id === 'b1').cycleTime;
    expect(reworked.bottleneck).toMatchObject({ kind: 'station', id: 'b1', copies: 2 });
    close(reworked.bottleneck.time, Math.round((b / 2) * 1e6) / 1e6, 1e-6);
    expect(reworked.layout.main).toEqual(['a', 'b1', 'c']);
    expect(reworked.stations.map((s) => s.id)).toEqual(['a', 'b1', 'b2', 'c', 'f']);
  });
});

// ---- In factory.json: parallel and capacity --------------------------------------------------------

describe('graph shapes in factory.json', () => {
  it('parallel: n becomes n copies with every edge repeated; capacity makes a buffer; checked, compiled and played', async () => {
    const { readFileSync } = await import('node:fs');
    const { checkFactory, expandFactory } = await import('../../compiler/expand.js');
    const { compileFactory } = await import('../../compiler/emit.js');
    const { preloadComponentAssets } = await import('../../lib/core/assets.js');
    await preloadComponentAssets(registry);
    const factory = JSON.parse(readFileSync('app/dev/lines/graph-shapes.json', 'utf8')).factory;
    const check = checkFactory(registry, factory);
    expect(check.errors).toEqual([]);
    expect(check.warnings.map((w) => w.path)).toEqual(['stations[3].equipment[1]']); // the placeholder marker
    const { line } = check.expanded;
    expect(line.stations.map((s) => [s.id, s.copyOf ?? null])).toEqual([['loadA', null], ['loadB', null], ['dose1', 'dose'], ['dose2', 'dose'], ['mark', null]]);
    expect(line.edges.map((e) => `${e.from}>${e.to}${e.transport.capacity ? `x${e.transport.capacity}` : ''}`)).toEqual([
      'loadA.output>dose1.inputx3', 'loadA.output>dose2.inputx3',
      'loadB.output>dose1.input', 'loadB.output>dose2.input',
      'dose1.output>mark.input', 'dose2.output>mark.input',
    ]);
    expect(check.timing.layout.main).toEqual(['loadA', 'dose1', 'mark']);
    // The two copies share the doser's time: the takt is the slowest of the shared doser and the rest.
    const cycle = (id) => check.timing.stations.find((x) => x.id === id).cycleTime;
    expect(check.timing.takt).toBeLessThan(cycle('dose1'));
    expect(check.timing.takt).toBeCloseTo(Math.max(cycle('dose1') / 2, cycle('loadA'), cycle('mark')), 5);
    const files = compileFactory(registry, factory).files.map((f) => f.name).sort();
    expect(files).toEqual(['dose1.js', 'dose2.js', 'line.js', 'loadA.js', 'loadB.js', 'mark.js']);
    const playing = new Line({ registry, line: expandFactory(registry, factory).line, ctx: { ...check.expanded.ctx, materials }, conventions: check.expanded.conventions });
    const seen = watch(playing);
    playing.start();
    runToEnd(playing, 600);
    expect(playing.state).toBe(LINE_STATES.FINISHED);
    expect(playing.status).toMatchObject({ released: 8, exited: 8 });
    expect(seen.dose1.length + seen.dose2.length).toBe(8);
    expect(seen.loadA.length + seen.loadB.length).toBe(8);
    expect(() => expandFactory(registry, { ...factory, stations: [...factory.stations, { ...factory.stations[0], id: 'dose1' }] })).toThrow(/parallel copy id "dose1" is already a station id/);
    playing.dispose();
  }, 60000);
});
