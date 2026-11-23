// Station connections: pipes and hoses between machine anchors (lib/station/connections.js), from
// factory.json through the dry check, the station runtime and the compiler. The example is the
// reference oil station's product riser: supply pump discharge → filler rear inlet.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { StationCycle } from '../../lib/station/index.js';
import { pipeRoute } from '../../lib/station/connections.js';
import { createMaterials } from '../../lib/core/materials.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { compileFactory } from '../../compiler/emit.js';
import { writeCompiled } from '../../compiler/write.js';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const arr = (points) => points.map((p) => p.toArray().map((n) => Number(n.toFixed(6))));

// The reference oil station's supply side (OilFillingStation.js): tank at (−1.3, −1.5), filler
// centred on the can necks at x 0.075; the pump stands under the filler's rear inlet.
const EQUIPMENT = [
  { id: 'belt', type: 'beltConveyor', params: { length: 8.4 }, position: [-0.1, 0, 0] },
  { id: 'filler', type: 'filler', params: {}, position: [0.075, 0, 0] },
  { id: 'supply', type: 'supplyTank', params: { pumpOffset: 0.975 }, position: [-1.3, 0, -1.5] },
];
const RISER = { id: 'riser', from: 'supply.discharge', to: 'filler.rearInlet' };
const stationData = (connections) => ({
  id: 'fill', title: 'Filling', conveyor: 'belt', process: [{ op: 'wait', seconds: 1 }], connections,
});

function buildStation(connections, { rootAt = [0, 0, 0] } = {}) {
  const root = new THREE.Group();
  root.position.set(...rootAt);
  const equipment = {};
  for (const e of EQUIPMENT) {
    const inst = registry.buildComponent(e.type, e.params, { materials, beltHeight: 0.86 });
    inst.root.position.set(...e.position);
    root.add(inst.root);
    equipment[e.id] = inst;
  }
  const cycle = new StationCycle({ registry, station: stationData(connections), equipment, root, ctx: { materials } });
  return { root, equipment, cycle };
}

const factory = (connections) => ({
  version: 1,
  line: { id: 'oilDemo', title: 'Oil demo', runSize: 2, conventions: { beltHeight: 0.86 } },
  product: { kind: 'catalog', type: 'jerryCan', params: {} },
  stations: [{ ...stationData(connections), equipment: EQUIPMENT }],
});

describe('pipe routes', () => {
  it("'up' rises to the end height, then runs along X, then Z; 'across' runs first, then rises", () => {
    const a = v(0, 1, 0);
    const b = v(2, 3, -1);
    expect(arr(pipeRoute(a, b, 'up'))).toEqual([[0, 1, 0], [0, 3, 0], [2, 3, 0], [2, 3, -1]]);
    expect(arr(pipeRoute(a, b, 'across'))).toEqual([[0, 1, 0], [2, 1, 0], [2, 1, -1], [2, 3, -1]]);
  });

  it('drops repeated corners and corners where the run goes straight on', () => {
    // The reference riser: same x at both ends, so up then along Z only.
    expect(arr(pipeRoute(v(-0.325, 1.5, -1.5), v(-0.325, 2.21, -0.56), 'up'))).toEqual([[-0.325, 1.5, -1.5], [-0.325, 2.21, -1.5], [-0.325, 2.21, -0.56]]);
    expect(arr(pipeRoute(v(0, 1, 0), v(0, 2, 0), 'across'))).toEqual([[0, 1, 0], [0, 2, 0]]);
  });
});

describe('connections in factory.json', () => {
  it('defaults: a pipe, route up, flanged', () => {
    const f = parseFactory(factory([RISER]));
    expect(f.stations[0].connections[0]).toMatchObject({ kind: 'pipe', route: 'up', flanges: true });
  });

  it('refuses bad ends and repeated ids with paths', () => {
    expect(() => parseFactory(factory([{ ...RISER, from: 'supply' }]))).toThrow(/stations\[0\]\.connections\[0\]\.from/);
    expect(() => parseFactory(factory([RISER, RISER]))).toThrow(/connections\[1\]\.id.*used twice/);
    expect(() => parseFactory(factory([{ ...RISER, material: 'gold' }]))).toThrow(/material/);
  });

  it('the dry check finds unknown machines and anchors before anything is built', () => {
    const bad = checkFactory(registry, factory([{ ...RISER, to: 'filler.rearInlett' }]));
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].message).toMatch(/connection "riser" to: machine "filler" has no anchor "rearInlett" \(anchors: tip, productInlet, airInlet, productBulkhead, airBulkhead, rearInlet\)/);
    const unknown = checkFactory(registry, factory([{ ...RISER, from: 'tank.discharge' }]));
    expect(unknown.errors[0].message).toMatch(/unknown machine "tank"/);
    expect(checkFactory(registry, factory([RISER])).ok).toBe(true);
  });

  it('stations without connections expand without the field (compiled files unchanged)', () => {
    expect('connections' in expandFactory(registry, factory([])).line.stations[0]).toBe(false);
    expect(expandFactory(registry, factory([RISER])).line.stations[0].connections).toHaveLength(1);
  });
});

describe('connections in a playing station', () => {
  it('draws the reference riser: up from the pump discharge to the inlet height, then along Z to the rear inlet, flanged', () => {
    const { root, cycle } = buildStation([RISER]);
    const run = root.getObjectByName('Connection riser');
    expect(run.parent.name).toBe('Connections');
    const segments = run.children.filter((o) => /segment/.test(o.name));
    const elbows = run.children.filter((o) => /elbow/.test(o.name));
    expect(segments).toHaveLength(2);
    expect(elbows).toHaveLength(1);
    // Ends: the pump discharge stub top (−0.325, 1.5, −1.5) and the rear inlet (−0.325, 2.21, −0.56).
    expect(arr([elbows[0].position])).toEqual([[-0.325, 0.86 + 1.19 + 0.16, -1.5]]);
    const flanges = run.children.filter((o) => /flange/.test(o.name));
    expect(arr(flanges.map((f) => f.position))).toEqual([[-0.325, 1.52, -1.5], [-0.325, 2.21, -0.58]]);
    cycle.dispose();
    expect(root.getObjectByName('Connections')).toBeUndefined();
  });

  it('is drawn in the station frame: a moved station root changes nothing inside it', () => {
    const a = buildStation([RISER]);
    const b = buildStation([RISER], { rootAt: [12, 0, -4] });
    const pos = (s) => s.root.getObjectByName('Connection riser').children.map((o) => o.position.toArray().map((n) => n.toFixed(9)));
    expect(pos(b)).toEqual(pos(a));
    a.cycle.dispose();
    b.cycle.dispose();
  });

  it('a hose to a moving anchor follows it when the station refreshes', () => {
    const hose = { id: 'feed', from: 'supply.discharge', to: 'filler.productInlet', kind: 'hose', sag: [0, -0.2, 0] };
    const { root, equipment, cycle } = buildStation([hose]);
    const box = () => new THREE.Box3().setFromObject(root.getObjectByName('Connection feed'));
    const before = box();
    expect(root.getObjectByName('Connection feed').material).toBe(materials.hose);
    equipment.filler.set('headTravel', 1);
    cycle.refresh(false);
    const after = box();
    expect(after.max.y).toBeLessThan(before.max.y - 0.2); // the head end dropped 0.25 m
    cycle.dispose();
  });

  it('a station refuses connections to anchors its machines do not have', () => {
    expect(() => buildStation([{ ...RISER, to: 'belt.rearInlet' }])).toThrow(/machine "belt" has no anchor "rearInlet" \(anchors: none\)/);
  });
});

describe('connections in compiled files', () => {
  it('are written into the station file, and the compiled line draws them', async () => {
    const compiled = compileFactory(registry, factory([RISER]), { libPath: '../../../lib' });
    const text = compiled.files.find((f) => f.name === 'fill.js').content;
    expect(text).toMatch(/connections: \[/);
    expect(text).toMatch(/from: 'supply\.discharge'/);
    expect(text).toMatch(/to: 'filler\.rearInlet'/);
    // Play it: written to the git-ignored draft folder, imported, built.
    const { dir } = writeCompiled(compiled, join('generated', '_draft'));
    const mod = await import(/* @vite-ignore */ pathToFileURL(resolve(dir, 'line.js')).href);
    const line = mod.createLine({ materials });
    const riser = line.root.getObjectByName('Connection riser');
    expect(riser).toBeDefined();
    expect(riser.children.filter((o) => /segment/.test(o.name))).toHaveLength(2);
    line.dispose();
  });
});
