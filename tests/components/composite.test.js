// Composite equipment (lib/basics/composite.js, Phase 6 step 4): a machine put together from basic
// blocks in factory.json, played, planned and compiled like any catalog machine.
import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { compileFactory } from '../../compiler/emit.js';
import { Line } from '../../lib/line/index.js';

const materials = createMaterials();
afterAll(() => disposeMaterials(materials));
const H = 0.86;
const build = (params = {}) => registry.buildComponent('composite', params, { materials, beltHeight: H });
const at = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

/** A doser over a belt: portal across the flow, hung axis across it, vertical slide, nozzle. */
const DOSER = {
  parts: [
    { id: 'frame', type: 'portalFrame', params: { span: 0.8, height: 1.5 } },
    { id: 'cross', type: 'linearAxis', params: { stroke: 0.5, hang: true }, on: 'frame.beam', rotationY: Math.PI / 2 },
    { id: 'lift', type: 'verticalAxis', params: { stroke: 0.25, bodyLength: 0.35 }, on: 'cross.carriage' },
    { id: 'nozzle', type: 'dispenseNozzle', params: { jetLength: 0.15 }, on: 'lift.ram' },
  ],
  motions: { travel: 'cross.travel', lower: 'lift.extend', flow: 'nozzle.flow' },
  anchors: { tool: 'nozzle' },
};

describe('composite equipment', () => {
  it('offers its parts\' motions and mount points by part name; a short motion name replaces the part name', () => {
    const spec = registry.componentSpec('composite', DOSER, { beltHeight: H });
    expect(Object.keys(spec.motions).sort()).toEqual(['flow', 'lower', 'travel']);
    expect(spec.motions.lower).toEqual(registry.componentSpec('verticalAxis', DOSER.parts[2].params).motions.extend);
    const plain = registry.componentSpec('composite', { ...DOSER, motions: {} }, { beltHeight: H });
    expect(Object.keys(plain.motions).sort()).toEqual(['crossTravel', 'liftExtend', 'nozzleFlow']);
    expect(spec.anchors).toEqual(expect.arrayContaining(['frame', 'frameBeam', 'crossCarriage', 'liftRam', 'nozzle', 'tool']));
  });

  it('mounts each part on its mount point: a tool hangs by its mounting face; motions move what hangs below', () => {
    const d = build(DOSER);
    const nozzleHeight = registry.componentSpec('dispenseNozzle', { jetLength: 0.15 }).footprint.height;
    // The nozzle's mounting face is on the ram's mount point, its tool point that far below.
    expect(at(d.anchor('tool')).distanceTo(at(d.anchor('liftRam')).sub(new THREE.Vector3(0, nozzleHeight, 0)))).toBeLessThan(1e-9);
    // Beam underside 1.5 − hung axis 0.12 − slide (0.35 + 0.02) − nozzle.
    expect(at(d.anchor('tool')).y).toBeCloseTo(1.5 - 0.12 - 0.37 - nozzleHeight, 9);
    const home = at(d.anchor('tool'));
    d.set('lower', 0.2);
    expect(at(d.anchor('tool')).y).toBeCloseTo(home.y - 0.2, 9);
    d.set('travel', 0.25); // the axis is turned a quarter: its +X runs along −Z, across the belt
    const moved = at(d.anchor('tool'));
    expect(moved.z).toBeCloseTo(home.z - 0.25, 9);
    expect(moved.x).toBeCloseTo(home.x, 9);
    d.set('flow', 1); // an alias drives the part's own motion
    expect(d.root.getObjectByName('Stream').visible).toBe(true);
  });

  it('measures its footprint over the motions\' whole ranges', () => {
    const fp = registry.componentSpec('composite', DOSER, { beltHeight: H }).footprint;
    const d = build(DOSER);
    for (const [travel, lower] of [[-0.25, 0], [0.25, 0.25], [0, 0.25]]) {
      d.set('travel', travel);
      d.set('lower', lower);
      d.set('flow', 1);
      d.root.updateMatrixWorld(true);
      const b = new THREE.Box3();
      d.root.traverse((o) => { if (o.isMesh && o.visible) b.expandByObject(o); });
      expect(b.min.z).toBeGreaterThanOrEqual(fp.z[0]);
      expect(b.max.z).toBeLessThanOrEqual(fp.z[1]);
      expect(b.min.y).toBeGreaterThanOrEqual(fp.bottom);
      expect(b.max.y).toBeLessThanOrEqual(fp.height);
    }
  });

  it('refuses a bad parts list with a message that names the part', () => {
    const bad = (change) => () => registry.componentSpec('composite', change(structuredClone(DOSER)));
    expect(bad((d) => { d.parts[0].type = 'warpDrive'; return d; })).toThrow(/part "frame": unknown component type "warpDrive"/);
    expect(bad((d) => { d.parts[2].on = 'nozzle.tip'; return d; })).toThrow(/part "lift": on "nozzle.tip": no earlier part "nozzle"/);
    expect(bad((d) => { d.parts[2].on = 'cross.flange'; return d; })).toThrow(/"cross" \(linearAxis\) has no mount point "flange" \(mount points: carriage\)/);
    expect(bad((d) => { d.parts[3].id = 'lift'; return d; })).toThrow(/part id "lift" is used twice/);
    expect(bad((d) => { d.parts.push({ id: 'inner', type: 'composite' }); return d; })).toThrow(/cannot contain a composite/);
    expect(bad((d) => { d.motions.lower = 'lift.spin'; return d; })).toThrow(/motion alias "lower": "lift" \(verticalAxis\) has no motion "spin"/);
    expect(bad((d) => { d.motions.dose = 'nozzle.flow'; return d; })).toThrow(/motion "nozzle.flow" has two short names/);
    expect(bad((d) => { d.motions = { crossTravel: 'lift.extend' }; return d; })).toThrow(/motion "crossTravel" is offered twice/);
    expect(bad((d) => { d.parts[1].params.stroke = 99; return d; })).toThrow(/part "cross":.*stroke/);
  });

  describe('in a factory', () => {
    const factory = {
      version: 1,
      line: { id: 'doseDemo', title: 'Dosing demo', runSize: 3, conventions: { beltHeight: H } },
      product: { kind: 'catalog', type: 'jerryCan', params: { height: 0.33 } },
      stations: [{
        id: 'dose',
        title: 'Dosing',
        conveyor: 'belt',
        inputStage: 'empty',
        ports: { input: { machine: 'belt', port: 'input' }, output: { machine: 'belt', port: 'output' } },
        equipment: [
          { id: 'belt', type: 'beltConveyor', params: { length: 2.4 } },
          { id: 'doser', type: 'composite', params: DOSER },
        ],
        intake: [{ op: 'transfer', conveyor: 'belt', to: { machine: 'belt', port: 'input', offset: [1.2, 0, 0] }, label: 'Can to the doser' }],
        process: [
          { op: 'move', machine: 'doser', to: { lower: 0.2 }, seconds: 1.0, label: 'Nozzle down' },
          { op: 'move', machine: 'doser', to: { flow: 1 }, seconds: 0.3, label: 'Valve open' },
          { op: 'wait', seconds: 2.0, label: 'Dosing' },
          { op: 'move', machine: 'doser', to: { flow: 0 }, seconds: 0.3, label: 'Valve closed' },
          { op: 'move', machine: 'doser', to: { lower: 0 }, seconds: 1.0, label: 'Nozzle up' },
        ],
        output: [{ op: 'transfer', conveyor: 'belt', to: 'output', label: 'Can out' }],
        feed: { fromLift: false },
      }],
      graph: { edges: [] },
    };

    it('passes the full check; the timing table counts the composite\'s moves', () => {
      const result = checkFactory(registry, factory);
      expect(result.errors).toEqual([]);
      const row = result.timing.stations.find((s) => s.id === 'dose');
      expect(row.process).toBeCloseTo(4.6, 9);
    });

    it('compiles to a readable build call with its parts', () => {
      const file = compileFactory(registry, factory).files.find((f) => f.name === 'dose.js').content;
      expect(file).toMatch(/registry\.buildComponent\('composite', \{/);
      expect(file).toMatch(/type: 'portalFrame'/);
      expect(file).toMatch(/on: 'lift\.ram'/);
    });

    it('plays: the nozzle comes down over the can and doses, three cans through', () => {
      const expanded = expandFactory(registry, factory);
      const line = new Line({ registry, line: expanded.line, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
      const doser = line.byId.get('dose').cycle.equipment.doser;
      const home = at(doser.anchor('tool')).y;
      line.start();
      let deepest = 0;
      let dosed = 0;
      for (let t = 0; t < 60 && line.state !== 'FINISHED'; t += 0.05) {
        line.update(0.05);
        deepest = Math.max(deepest, home - at(doser.anchor('tool')).y);
        if (doser.root.getObjectByName('Stream').visible) dosed += 0.05;
      }
      expect(line.state).toBe('FINISHED');
      expect(deepest).toBeCloseTo(0.2, 6);
      expect(dosed).toBeGreaterThan(3 * 2); // three cans, about 2.3 s of flow each
      expect(at(doser.anchor('tool')).y).toBeCloseTo(home, 9);
    });
  });
});
