// Generic machine (lib/basics/genericMachine.js) and the `operate` op (Phase 6 step 5): the
// placeholder that keeps a line running with the right size, ports and timing, and is reported.
import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { dryRun } from '../../lib/ops/OpCycle.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { compileFactory } from '../../compiler/emit.js';
import { Line } from '../../lib/line/index.js';

const materials = createMaterials();
afterAll(() => disposeMaterials(materials));
const H = 0.86;
const build = (params = {}) => registry.buildComponent('genericMachine', params, { materials, beltHeight: H });

describe('generic machine', () => {
  it('pass-through: ports at both ends and in the middle at belt height; the opening lets a unit through', () => {
    const g = build({ length: 1.6, depth: 1.2, carries: 'case' });
    expect(g.ports).toEqual({
      input: { position: [-0.8, H, 0], direction: 'in', carries: 'case' },
      work: { position: [0, H, 0], direction: 'work', carries: 'case' },
      output: { position: [0.8, H, 0], direction: 'out', carries: 'case' },
    });
    // Nothing stands in a 0.5 m wide, 0.4 m tall passage over the belt through the whole machine.
    g.root.updateMatrixWorld(true);
    const passage = new THREE.Box3(new THREE.Vector3(-0.85, H, -0.25), new THREE.Vector3(0.85, H + 0.4, 0.25));
    const blocking = [];
    g.root.traverse((o) => { if (o.isMesh && new THREE.Box3().setFromObject(o).intersectsBox(passage)) blocking.push(o.name); });
    expect(blocking).toEqual([]);
  });

  it('cabinet beside the line: one work port on its front face', () => {
    const g = build({ passThrough: false, depth: 0.8 });
    expect(Object.keys(g.ports)).toEqual(['work']);
    expect(g.ports.work.position).toEqual([0, H, 0.4]);
  });

  it('shows its state on the lamps and its progress on the bar', () => {
    const g = build({ length: 1.6 });
    const lamp = (k) => g.root.getObjectByName(`Lamp ${k}`).material;
    g.set('state', 'run');
    expect(lamp('run').emissiveIntensity).toBeGreaterThan(0);
    expect(lamp('alarm').emissiveIntensity).toBe(0);
    g.set('state', 'alarm');
    expect(lamp('alarm').emissiveIntensity).toBeGreaterThan(0);
    expect(lamp('run').emissiveIntensity).toBe(0);
    expect(g.root.getObjectByName('Progress bar').visible).toBe(false);
    g.set('progress', 0.5);
    g.root.updateMatrixWorld(true);
    const bar = new THREE.Box3().setFromObject(g.root.getObjectByName('Progress bar'));
    expect(bar.max.x - bar.min.x).toBeCloseTo(0.25, 6); // half of the 0.5 m bar
    expect(g.root.getObjectByName('Sign face front').material.name).toBe('placeholder sign');
  });
});

describe('operate op', () => {
  it('takes exactly its time, and needs a machine with state and progress', () => {
    const ok = dryRun(registry, [{ op: 'operate', machine: 'marker', seconds: 7 }], { equipment: { marker: { type: 'genericMachine' } } });
    expect(ok.duration).toBe(7);
    expect(ok.steps.map((s) => s.label)).toEqual(['marker working']);
    expect(() => dryRun(registry, [{ op: 'operate', machine: 'belt', seconds: 2 }], { equipment: { belt: { type: 'beltConveyor' } } }))
      .toThrow(/machine "belt" has no motion "state"/);
  });
});

describe('a line with a placeholder', () => {
  const factory = {
    version: 1,
    line: { id: 'markDemo', title: 'Marking demo', runSize: 3, conventions: { beltHeight: H } },
    product: { kind: 'catalog', type: 'jerryCan', params: { height: 0.33 } },
    stations: [{
      id: 'mark',
      title: 'Laser marking',
      conveyor: 'belt',
      inputStage: 'empty',
      ports: { input: { machine: 'belt', port: 'input' }, output: { machine: 'belt', port: 'output' } },
      equipment: [
        { id: 'belt', type: 'beltConveyor', params: { length: 2.6 } },
        { id: 'marker', type: 'genericMachine', params: { name: 'Laser marker', note: 'fiber laser, 20 W', length: 1.2, depth: 0.9 } },
      ],
      intake: [{ op: 'transfer', conveyor: 'belt', to: { machine: 'marker', port: 'work' }, label: 'Into the marker' }],
      process: [{ op: 'operate', machine: 'marker', seconds: 6, label: 'Marking' }],
      output: [{ op: 'transfer', conveyor: 'belt', to: 'output', label: 'Out' }],
      feed: { fromLift: false },
    }],
    graph: { edges: [] },
  };

  it('passes the check with the placeholder listed as a warning; its time is in the timing table', () => {
    const result = checkFactory(registry, factory);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{
      path: 'stations[0].equipment[1]',
      message: 'station "mark": "marker" is a placeholder for "Laser marker" (genericMachine); replace it with a catalog machine or a composite',
    }]);
    expect(result.timing.stations[0].process).toBe(6);
    expect(checkFactory(registry, { ...factory, stations: [] }).warnings).toEqual([]);
  });

  it('compiles and plays: the marker runs while each can stands in it, three cans through', () => {
    expect(compileFactory(registry, factory).files.find((f) => f.name === 'mark.js').content).toMatch(/registry\.buildComponent\('genericMachine'/);
    const expanded = expandFactory(registry, factory);
    const line = new Line({ registry, line: expanded.line, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
    const marker = line.byId.get('mark').cycle.equipment.marker;
    line.start();
    let running = 0;
    let peak = 0;
    for (let t = 0; t < 60 && line.state !== 'FINISHED'; t += 0.05) {
      line.update(0.05);
      if (marker.state.state === 'run') running += 0.05;
      peak = Math.max(peak, marker.state.progress);
    }
    expect(line.state).toBe('FINISHED');
    expect(running).toBeCloseTo(18, 0); // 3 × 6 s
    expect(peak).toBeGreaterThan(0.95);
    expect(marker.state.state).toBe('idle');
  });
});
