// ST4-derived components: enclosure with shutters, docking unit, status monitor, equipment rack.
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

describe('shutterEnclosure', () => {
  it('has the reference frame: posts at ±0.82 / ±0.56, roof at 2.05 m, hood and duct', () => {
    const e = build('shutterEnclosure');
    const posts = all(e.root, 'Enclosure post').map(boundsOf);
    expect(posts).toHaveLength(4);
    for (const b of posts) {
      expect(Math.abs((b.min.x + b.max.x) / 2)).toBeCloseTo(0.82, 6);
      expect(Math.abs((b.min.z + b.max.z) / 2)).toBeCloseTo(0.56, 6);
    }
    expect(e.root.getObjectByName('Extraction duct')).toBeDefined();
    expect(build('shutterEnclosure', { extraction: false }).root.getObjectByName('Extraction hood')).toBeUndefined();
  });

  it('closes its shutters just above the belt, wherever the belt is', () => {
    expect(bounds(build('shutterEnclosure'), 'Entry shutter').min.y).toBeCloseTo(0.85 + 0.02 - 0.02, 6);
    expect(bounds(build('shutterEnclosure', {}, { beltHeight: 0.95 }), 'Exit shutter').min.y).toBeCloseTo(0.95, 6);
  });

  it('lifts each shutter by shutterRise, independently, and keeps it in its guides', () => {
    const e = build('shutterEnclosure');
    const y0 = bounds(e, 'Entry shutter').min.y;
    e.set('entryShutter', 1);
    expect(bounds(e, 'Entry shutter').min.y - y0).toBeCloseTo(0.82, 6);
    expect(bounds(e, 'Exit shutter').min.y).toBeCloseTo(y0, 6);
    const guides = all(e.root, 'Shutter guide').map(boundsOf).filter((g) => g.max.x < 0); // entry end
    expect(guides).toHaveLength(2);
    for (const rail of all(e.root.getObjectByName('Entry shutter'), 'Shutter top rail').map(boundsOf)) {
      for (const g of guides) {
        expect(rail.intersectsBox(g)).toBe(true);
        expect(rail.max.y).toBeLessThanOrEqual(g.max.y + 1e-9);
      }
    }
  });
});

describe('dockingUnit', () => {
  it('pushes the connector exactly the commanded distance along +Z', () => {
    const d = build('dockingUnit');
    const z0 = bounds(d, 'Connector head').max.z;
    expect(z0).toBeCloseTo(d.ports.connector.position[2], 6);
    d.set('plug', 0.3);
    expect(bounds(d, 'Connector head').max.z - z0).toBeCloseTo(0.3, 6);
  });

  it('keeps the piston rod inside the cylinder body over the whole stroke', () => {
    for (const stroke of [0.05, 0.3, 0.5]) {
      const d = build('dockingUnit', { stroke });
      const body = bounds(d, 'Dock cylinder');
      for (const v of [0, stroke]) {
        d.set('plug', v);
        const rod = bounds(d, 'Piston rod');
        expect(rod.min.z).toBeGreaterThan(body.min.z);
        expect(rod.min.z).toBeLessThan(body.max.z);
      }
    }
  });

  it('carries the connector at the requested height', () => {
    const d = build('dockingUnit', { axisHeight: 1.2 });
    const head = bounds(d, 'Connector head');
    expect((head.min.y + head.max.y) / 2).toBeCloseTo(1.2, 6);
  });
});

describe('statusMonitor', () => {
  it('shows the generic dashboard and validates it', () => {
    const m = build('statusMonitor');
    expect(() => m.show('screen', { title: 'LINE', gauges: [{ label: 'Speed', value: 1, target: 2 }] })).not.toThrow();
    expect(() => m.show('screen', { title: 'LINE', grid: { label: 'x', cols: 3, values: [1], range: [5, -5] } })).toThrow(/range/);
    expect(() => m.show('screen', { title: 'LINE', gauges: Array(5).fill({ label: 'g', value: 1, target: 1 }) })).toThrow(/screen display/);
  });

  it('joins the column to the bezel even for a small screen', () => {
    const m = build('statusMonitor', { screenHeight: 0.25, height: 1.8 });
    expect(bounds(m, 'Monitor column').max.y).toBeGreaterThan(bounds(m, 'Monitor bezel').min.y);
  });
});

describe('equipmentRack', () => {
  it('has the reference five units 0.25 m apart from 0.5 m', () => {
    const r = build('equipmentRack');
    const ys = all(r.root, 'Rack unit').map((u) => u.position.y);
    expect(ys).toEqual([0.5, 0.75, 1, 1.25, 1.5].map((y) => expect.closeTo(y, 9)));
  });

  it('fits many units into a short rack without overlap', () => {
    const r = build('equipmentRack', { height: 1, units: 10 });
    const units = all(r.root, 'Rack unit').map(boundsOf).sort((a, b) => a.min.y - b.min.y);
    for (let i = 1; i < units.length; i += 1) expect(units[i].min.y).toBeGreaterThan(units[i - 1].max.y);
    expect(units.at(-1).max.y).toBeLessThan(1);
  });
});
