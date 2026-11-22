import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { parseFactory, factoryJsonSchema, FactoryError, FACTORY_VERSION } from '../../spec/factory.schema.js';
import { expandFactory, expandStation, checkFactory, mergeConventions } from '../../compiler/expand.js';
import { Line, LINE_STATES } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';
import { trapezoidDuration } from '../../lib/core/motion.js';

const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

const cell = (id, code, seconds, extra = {}) => ({
  id, code, title: `Cell ${code}`,
  shell: { type: 'assemblyCell', params: { code, title: `Cell ${code}` } },
  process: [{ op: 'wait', seconds, label: 'Working' }],
  ...extra,
});

/** A small, valid factory.json. */
function factory(overrides = {}) {
  return {
    version: 1,
    line: { id: 'demo', title: 'Demo line', runSize: 2 },
    product: { kind: 'catalog', type: 'printer' },
    stations: [cell('a', 'A1', 1), cell('b', 'B2', 2)],
    graph: { edges: [{ from: 'a.output', to: 'b.input', carries: 'pallet', transport: { type: 'palletConveyor', params: { workStop: false } } }] },
    ...overrides,
  };
}

describe('factory.json schema', () => {
  it('parses a minimal file and fills the defaults', () => {
    const f = parseFactory(factory());
    expect(f.line).toMatchObject({ units: 'm', flow: '+X', runSize: 2, speeds: [1, 2, 10], conventions: {} });
    expect(f.stations[0]).toMatchObject({ workState: 'WORKING', equipment: [], ports: {}, home: {}, status: {} });
    expect(f.graph.edges[0].transport.kind).toBe('conveyor');
    expect(FACTORY_VERSION).toBe(1);
  });

  it('reports every problem with its path in the file (shape first, then references inside the file)', () => {
    expect(() => parseFactory(factory({ version: 2 }))).toThrow(/^factory.json: version: /);
    const bad = factory({
      stations: [cell('a', 'A1', 1), { ...cell('a', 'A2', 1), equipment: [{ id: 'x', type: 'workTable' }, { id: 'x', type: 'workTable' }] }],
      graph: { edges: [{ from: 'a.output', to: 'zz.input', transport: { type: 'palletConveyor' } }] },
    });
    let error;
    try { parseFactory(bad); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(FactoryError);
    const paths = error.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['stations[1].id', 'stations[1].equipment[1].id', 'graph.edges[0].to']));
    expect(error.message).toMatch(/station id "a" is used twice/);
    expect(error.message).toMatch(/unknown station "zz"/);
    expect(() => parseFactory(factory({ product: { kind: 'glb', url: 'x.glb' } }))).toThrow(/product/);
    expect(() => parseFactory(factory({ stations: [{ id: 'a', title: 'x', process: [] }] }))).toThrow(/stations\[0\]\.conveyor: give a shell/);
    expect(() => parseFactory(factory({ graph: { edges: [{ from: 'a', to: 'b.input', transport: { type: 'x' } }] } }))).toThrow(/graph\.edges\[0\]\.from: use "station\.port"/);
  });

  it('spec/factory.schema.json is generated from the zod schema and up to date (npm run schema)', () => {
    const file = JSON.parse(readFileSync(new URL('../../spec/factory.schema.json', import.meta.url), 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(factoryJsonSchema())));
    expect(file.required).toEqual(['version', 'line', 'product', 'stations']);
    expect(Object.keys(file.properties.stations.items.properties)).toEqual(expect.arrayContaining(['shell', 'equipment', 'process', 'ports']));
  });
});

describe('shell presets', () => {
  it('the assembly cell places the reference shell (createStationShell + StationBase)', () => {
    const s = registry.expandShell('assemblyCell', { code: 'ST2', title: 'Frame Assembly', color: '#e0782a' });
    const at = Object.fromEntries(s.equipment.map((e) => [e.id, e]));
    expect(Object.keys(at)).toEqual(['slab', 'fence', 'line', 'liftIn', 'liftOut', 'sign', 'panel', 'beacon']);
    expect(at.slab.params).toMatchObject({ length: 4.7, depth: 3.1 });
    close(at.slab.position[2], 0.05);
    close(at.slab.params.walkway, (1.05 + 1.5) / 3.1);
    close(at.fence.position[2], -1.25); // minZ + 0.25
    expect(at.fence.params.length).toBeCloseTo(4.1, 12);
    expect(at.liftIn.position).toEqual([-1.6, 0, 0]);
    expect(at.liftOut.position).toEqual([1.6, 0, 0]);
    close(at.sign.position[2], -1.05); // minZ + 0.45
    expect(at.panel).toMatchObject({ position: [-1.55, 0, 0.95], rotationY: 0.3 });
    expect(at.beacon.position[0]).toBeCloseTo(1.95, 12);
    expect(s.station).toMatchObject({ conveyor: 'line', ports: { input: { standalone: ['liftIn'] } }, signals: { beacon: { machine: 'beacon' } } });
  });

  it('refuses unknown shells and bad params clearly', () => {
    expect(() => registry.expandShell('nope')).toThrow(/Unknown shell type "nope" \(shells: assemblyCell\)/);
    expect(() => registry.expandShell('assemblyCell', { code: 'TOOLONG', title: 'x' })).toThrow(/Invalid params for shell "assemblyCell": code/);
    expect(() => registry.expandShell('assemblyCell', { code: 'S', title: 'x', walkwayZ: 1.5 })).toThrow(/walkwayZ must be at least 0.2 m inside maxZ/);
  });
});

describe('expanding factory.json', () => {
  it('expands shells, merges the station\'s own ports and signals over the shell\'s', () => {
    const f = parseFactory(factory());
    const st = expandStation(registry, {
      ...f.stations[0],
      equipment: [{ id: 'robot', type: 'cartesianGantry', params: {}, position: [0, 0, 0], rotationY: 0 }],
      ports: { output: { standalone: [] } },
      signals: { display: { rows: [['Robot', 'robot']] } },
    });
    expect(st.conveyor).toBe('line');
    expect(st.equipment.map((e) => e.id)).toEqual(['slab', 'fence', 'line', 'liftIn', 'liftOut', 'sign', 'panel', 'beacon', 'robot']);
    expect(st.ports).toEqual({ input: { standalone: ['liftIn'] }, output: { standalone: [] } });
    expect(st.signals).toEqual({ beacon: { machine: 'beacon' }, display: { machine: 'panel', rows: [['Robot', 'robot']] } });
    expect(st.shell).toBeUndefined();
    expect(() => expandStation(registry, { ...f.stations[0], equipment: [{ id: 'line', type: 'workTable', params: {}, position: [0, 0, 0], rotationY: 0 }] }))
      .toThrow(/equipment id "line" is already used by the shell/);
  });

  it('merges convention overrides group by group', () => {
    const c = mergeConventions({ conveyor: { speed: 0.6 }, transferLength: 1.5 });
    expect(c.conveyor).toEqual({ ...CONVENTIONS.conveyor, speed: 0.6 });
    expect(c.lift).toEqual(CONVENTIONS.lift);
    expect(c.transferLength).toBe(1.5);
    expect(c.workStop).toBe(CONVENTIONS.workStop);
  });

  it('checkFactory plans every station and the layout without geometry', () => {
    const r = checkFactory(registry, factory());
    expect(r.ok).toBe(true);
    expect(r.timing.stations.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r.timing.bottleneck).toMatchObject({ kind: 'station', id: 'b' });
    close(r.timing.transfers[0].duration, trapezoidDuration(2.4, 0.45, 0.35), 1e-6);
  });

  it('checkFactory reports catalog problems with a path or a located message, never throws', () => {
    const r1 = checkFactory(registry, factory({ product: { kind: 'catalog', type: 'nope' } }));
    expect(r1).toMatchObject({ ok: false, errors: [{ path: 'product.type' }] });
    const r2 = checkFactory(registry, factory({ stations: [cell('a', 'A1', 1, { process: [{ op: 'fly' }] }), cell('b', 'B2', 1)] }));
    expect(r2.ok).toBe(false);
    expect(r2.errors[0].message).toMatch(/station "a" › process › op #1 \(fly\): unknown op "fly"/);
    const r3 = checkFactory(registry, factory({ stations: [cell('a', 'A1', 1, { shell: { type: 'nope', params: {} } }), cell('b', 'B2', 1)] }));
    expect(r3.errors[0]).toMatchObject({ path: 'stations › a.shell' });
    const r4 = checkFactory(registry, { version: 1 });
    expect(r4.ok).toBe(false);
    expect(r4.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['line', 'product', 'stations']));
  });

  it('convention overrides reach the layout, the timing and the built components', () => {
    const r = checkFactory(registry, factory({ line: { id: 'demo', title: 'Demo', runSize: 1, conventions: { transferLength: 2, conveyor: { speed: 0.9 }, beltHeight: 0.9 } } }));
    expect(r.ok).toBe(true);
    close(r.timing.transfers[0].distance, 2.4 + 0.8, 1e-6);
    close(r.timing.transfers[0].duration, trapezoidDuration(3.2, 0.9, 0.35), 1e-6);
    const { line, conventions, ctx } = r.expanded;
    const built = new Line({ registry, line, ctx: { ...ctx, materials }, conventions });
    expect(built.byId.get('a').equipment.line.ports.work.position[1]).toBe(0.9);
    built.dispose();
  });

  it('an expanded factory.json runs as a line to the end', () => {
    const { line, conventions, ctx } = expandFactory(registry, factory());
    const built = new Line({ registry, line, ctx: { ...ctx, materials }, conventions });
    const xs = built.stations.map((s) => s.root.position.x);
    close(xs[1] - xs[0], 5.6);
    built.start();
    for (let t = 0; t < 120 && built.state !== LINE_STATES.FINISHED; t += 0.05) built.update(0.05);
    expect(built.state).toBe(LINE_STATES.FINISHED);
    expect(built.status.exited).toBe(2);
    // The shell's middle lifts are hidden in the line, the end ones shown.
    expect(built.byId.get('a').equipment.liftOut.root.visible).toBe(false);
    expect(built.byId.get('b').equipment.liftOut.root.visible).toBe(true);
    built.dispose();
  });
});
