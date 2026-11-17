// ST5-derived components: vision scanner, label applicator, roller conveyor, cross transfer,
// plus the scaled station sign and the dashboard checklist.
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

describe('visionScanner', () => {
  it('moves the arch exactly along X, parked at the entry end by default', () => {
    const s = build('visionScanner');
    expect(s.state.x).toBeCloseTo(-1.2, 9);
    s.set('x', 0.75); // reference scan end
    const beam = bounds(s, 'Arch beam');
    expect((beam.min.x + beam.max.x) / 2).toBeCloseTo(0.75, 6);
  });

  it('lights its own bars and laser, independently of other scanners', () => {
    const a = build('visionScanner');
    const b = build('visionScanner');
    const lightOf = (s) => s.root.getObjectByName('Top light bar').material;
    expect(lightOf(a)).not.toBe(lightOf(b));
    a.set('scan', 'on');
    expect(lightOf(a).emissiveIntensity).toBeCloseTo(2.2, 9);
    expect(lightOf(b).emissiveIntensity).toBeCloseTo(0.15, 9);
    expect(a.root.getObjectByName('Laser sheet').material.opacity).toBeCloseTo(0.28, 9);
  });

  it('runs the laser sheet from the emitter down to just above the belt', () => {
    const s = build('visionScanner', {}, { beltHeight: 0.95 });
    const sheet = bounds(s, 'Laser sheet');
    expect(sheet.min.y).toBeCloseTo(0.975, 6);
    expect(sheet.max.y).toBeCloseTo(bounds(s, 'Laser emitter').min.y, 3);
  });

  it('hangs the top light bar against the beam and rejects an arch wider than the posts', () => {
    const s = build('visionScanner');
    expect(bounds(s, 'Top light bar').max.y).toBeCloseTo(bounds(s, 'Arch beam').min.y, 3);
    expect(() => build('visionScanner', { width: 1.0, archWidth: 0.9 })).toThrow(/fit between the posts/);
  });
});

describe('labelApplicator', () => {
  it('moves the pad exactly the commanded distance along −Z, from the pad port', () => {
    const l = build('labelApplicator');
    expect(bounds(l, 'Tamp pad').min.z).toBeCloseTo(l.ports.pad.position[2], 6);
    l.set('tamp', 0.25);
    expect(bounds(l, 'Tamp pad').min.z).toBeCloseTo(l.ports.pad.position[2] - 0.25, 6);
  });

  it('keeps the tamp rod inside its cylinder over the whole stroke', () => {
    for (const stroke of [0.1, 0.6]) {
      const l = build('labelApplicator', { stroke });
      const body = bounds(l, 'Tamp cylinder');
      for (const v of [0, stroke]) {
        l.set('tamp', v);
        const rod = bounds(l, 'Tamp rod');
        expect(rod.max.z).toBeGreaterThan(body.min.z);
        expect(rod.max.z).toBeLessThanOrEqual(body.max.z + 1e-6);
      }
    }
  });
});

describe('rollerConveyor', () => {
  it('has the reference reject lane: 1.82 m, rollers every 0.1 m, tops at belt height', () => {
    const r = build('rollerConveyor');
    const rollers = all(r.root, 'Roller');
    expect(rollers).toHaveLength(18);
    for (const roller of rollers.map(boundsOf)) expect(roller.max.y).toBeCloseTo(0.85, 6);
    expect(r.ports.input.position).toEqual([-0.91, 0.85, 0]);
    expect(r.ports.output.direction).toBe('out');
  });

  it('turns every roller with the rollers motion, and drops the extras when asked', () => {
    const r = build('rollerConveyor', { endStop: false, bayMarking: false, color: 'machineGrey' });
    expect(r.root.getObjectByName('End stop')).toBeUndefined();
    expect(r.root.getObjectByName('Bay marking')).toBeUndefined();
    r.set('rollers', 0.25);
    for (const roller of all(r.root, 'Roller')) expect(roller.rotation.z).toBeCloseTo(-Math.PI / 2, 9);
    expect(r.root.getObjectByName('Lane side frame').material).toBe(materials.machineGrey);
  });
});

describe('crossTransfer', () => {
  it('keeps the wheels below the belt when lowered and lifts them above it by rise', () => {
    const c = build('crossTransfer');
    const top = () => {
      c.root.updateMatrixWorld(true);
      return Math.max(...all(c.root, 'Cross transfer wheel').map((w) => boundsOf(w).max.y));
    };
    expect(top()).toBeLessThan(0.85);
    c.set('raise', 1);
    expect(top()).toBeCloseTo(0.85 - 0.012 + 0.03, 6);
    expect(top()).toBeGreaterThan(0.85);
  });

  it('keeps the lift rod in its cylinder at both ends of the lift', () => {
    const c = build('crossTransfer', { rise: 0.06 });
    const body = bounds(c, 'Lift cylinder');
    for (const v of [0, 1]) {
      c.set('raise', v);
      expect(bounds(c, 'Lift rod').min.y).toBeLessThanOrEqual(body.max.y + 1e-6);
    }
  });
});

describe('stationSign scale', () => {
  it('draws the reference reject-bay sign: the 2.2 m sign at half size', () => {
    const s = build('stationSign', { code: '✕', title: 'Reject bay', color: '#c8231d', height: 2.2, scale: 0.5 });
    expect(s.footprint.height).toBeCloseTo(0.5 * (2.2 + 0.23), 9);
    const panel = bounds(s, 'Sign panel');
    expect((panel.min.y + panel.max.y) / 2).toBeCloseTo(1.1, 6);
  });
});

describe('statusMonitor checklist', () => {
  it('accepts the reference ST5 vision screen and rejects a bad check state', () => {
    const m = build('statusMonitor', { screenWidth: 0.8, screenHeight: 0.45 });
    expect(() => m.show('screen', {
      title: 'VISION · SN 0001',
      step: 'Pass 1',
      checks: [{ label: 'Fasteners present', value: '22/22', state: 'pass' }, { label: 'Test cube 40 mm · bed flatness', state: 'pending' }],
      verdict: 'REJECT',
    })).not.toThrow();
    expect(() => m.show('screen', { title: 'x', checks: [{ label: 'a', state: 'maybe' }] })).toThrow(/screen display/);
  });
});
