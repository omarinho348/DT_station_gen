// ST6-derived: case erector, case taper, bay marking, plus ST6's gantry, carton line and labeller
// built from the reference PackagingDefinition.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { boundsOf } from '../helpers/componentChecks.js';

const materials = createMaterials();
const build = (type, params = {}, ctx = {}) => {
  const inst = registry.buildComponent(type, params, { materials, ...ctx });
  inst.root.updateMatrixWorld(true);
  return inst;
};
const bounds = (inst, name) => {
  inst.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(inst.root.getObjectByName(name), true);
};
const all = (root, name) => {
  const out = [];
  root.traverse((o) => { if (o.name === name) out.push(o); });
  return out;
};

describe('ST6 reference equipment from existing components', () => {
  it('builds the long-stroke packaging gantry and reaches its home pose', () => {
    // gantry: x [-0.7, 0.7], z [-2.45, 0.1], beamY 2.7, maxGap 0.64, fingerLength 0.2, minToolY 0.62.
    // Centred component, so the IR places it at z = -1.175; home (0, 2.05, -0.6) → local z 0.575.
    const g = build('cartesianGantry', { spanX: 1.4, spanZ: 2.55, beamY: 2.7, maxGap: 0.64, fingerLength: 0.2, minToolY: 0.62 });
    expect(g.motions.z.range).toEqual([-1.275, 1.275]);
    expect(g.motions.grip.range).toEqual([0, 0.64]);
    g.set('y', 2.05);
    g.set('z', 0.575);
    g.root.updateMatrixWorld(true);
    const tool = g.root.getObjectByName('Tool').getWorldPosition(new THREE.Vector3());
    expect(tool.distanceTo(new THREE.Vector3(0, 2.05, 0.575))).toBeLessThan(1e-9);
  });

  it('builds the carton line as a roller conveyor at its own 0.55 m belt height', () => {
    // cartonLine: start -2.3, end 0.5, beltHeight 0.55; frames ±0.34, rollers every 0.11 m.
    const c = build('rollerConveyor', { length: 2.8, width: 0.68, rollerPitch: 0.11, color: 'machineBlue', endStop: false, bayMarking: false }, { beltHeight: 0.55 });
    const rollers = all(c.root, 'Roller').map(boundsOf);
    expect(rollers).toHaveLength(25);
    for (const r of rollers) expect(r.max.y).toBeCloseTo(0.55, 6);
  });

  it('builds the carton labeller with the large tamp pad', () => {
    const l = build('labelApplicator', { applyHeight: 0.55 + 0.62 * 0.55, padWidth: 0.16 });
    const pad = bounds(l, 'Tamp pad');
    expect(pad.max.x - pad.min.x).toBeCloseTo(0.16, 3);
    expect(pad.max.y - pad.min.y).toBeCloseTo(0.1, 3);
  });
});

describe('caseErector', () => {
  it('stands the housing on legs and keeps the blank magazine beside it', () => {
    const e = build('caseErector');
    expect(bounds(e, 'Erector housing').min.y).toBeCloseTo(0.25, 6);
    expect(all(e.root, 'Flat carton blank')).toHaveLength(8);
    const magazine = bounds(e, 'Blank magazine');
    expect(magazine.max.z).toBeLessThan(bounds(e, 'Erector housing').min.z);
    expect(all(build('caseErector', { blanks: 0 }).root, 'Flat carton blank')).toHaveLength(0);
  });

  it('hands cases out of its +X face at the carton line height', () => {
    const e = build('caseErector', {}, { beltHeight: 0.55 });
    expect(e.ports.output).toEqual({ position: [0.4, 0.55, 0], direction: 'out', carries: 'case' });
  });
});

describe('caseTaper', () => {
  const wipeBottom = (t) => bounds(t, 'Wipe roller').min.y;

  it('lowers the wipe roller exactly onto the carton top, and parks it a stroke above', () => {
    const t = build('caseTaper');
    expect(wipeBottom(t)).toBeCloseTo(1.17 + 0.13, 3); // 14-sided roller, turned: within 1 mm
    t.set('lower', 1);
    expect(wipeBottom(t)).toBeCloseTo(1.17, 3);
    const long = build('caseTaper', { stroke: 0.3, topHeight: 0.8 });
    long.set('lower', 1);
    expect(wipeBottom(long)).toBeCloseTo(0.8, 3);
  });

  it('parks the head at +0.68 m (reference) and keeps the head on its slide and the arm on the beam', () => {
    const t = build('caseTaper');
    expect(t.state.x).toBeCloseTo(0.68, 9);
    for (const [x, lower] of [[0.68, 0], [-0.68, 1], [0, 0.5]]) {
      t.set('x', x);
      t.set('lower', lower);
      expect(bounds(t, 'Tape head').intersectsBox(bounds(t, 'Head slide'))).toBe(true);
      expect(bounds(t, 'Head arm').intersectsBox(bounds(t, 'Taper beam'))).toBe(true);
    }
  });

  it('keeps the raised head under the arm for any stroke', () => {
    for (const stroke of [0.05, 0.13, 0.3]) {
      const t = build('caseTaper', { stroke });
      expect(bounds(t, 'Tape head').max.y).toBeLessThanOrEqual(bounds(t, 'Head arm').min.y + 0.016);
    }
  });
});

describe('bayMarking', () => {
  it('paints the reference dispatch bay (pallet + 0.3 m) in green', () => {
    const b = build('bayMarking');
    const box = bounds(b, 'Bay marking');
    expect(box.max.x - box.min.x).toBeCloseTo(1.55, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(1.45, 6);
    expect(b.root.getObjectByName('Bay marking').material.color.getHex()).toBe(0x2f9a4a);
  });
});
