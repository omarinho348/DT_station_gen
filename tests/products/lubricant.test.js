// Phase 5 lubricant pieces: the belt conveyor and the jerry-can product (ported from the reference
// station-1 OilConveyor.js and JerryCan.js).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { canDimensions, disposeJerryCanMaterials } from '../../lib/products/jerryCan/index.js';
import { nonFiniteMeshes, floatingMeshes, lowestPoint } from '../helpers/componentChecks.js';

const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const boxOf = (o) => new THREE.Box3().setFromObject(o);
const ctx = { materials, beltHeight: 0.86 };

describe('beltConveyor', () => {
  it('has its belt top at the belt height and ports at both ends', () => {
    const c = registry.buildComponent('beltConveyor', { length: 8.4 }, ctx);
    close(boxOf(c.root.getObjectByName('Belt carry side')).max.y, 0.86);
    expect(c.ports.input).toMatchObject({ position: [-4.2, 0.86, 0], direction: 'in', carries: 'unit' });
    expect(c.ports.output).toMatchObject({ position: [4.2, 0.86, 0], direction: 'out', carries: 'unit' });
    const batch = registry.buildComponent('beltConveyor', { carries: 'batch' }, ctx);
    expect(batch.ports.output.carries).toBe('batch');
    c.dispose();
    batch.dispose();
  });

  it('keeps the reference counts of legs and return rollers (8.4 m main conveyor: 7 and 9)', () => {
    const c = registry.buildComponent('beltConveyor', { length: 8.4 }, ctx);
    const names = [];
    c.root.traverse((o) => names.push(o.name));
    expect(names.filter((n) => /^Leg \d+$/.test(n))).toHaveLength(7 * 2);
    expect(names.filter((n) => /^Return roller \d+$/.test(n))).toHaveLength(9);
    c.dispose();
  });

  it('side guides leave the clear gap between their rails; a gap wider than the belt is refused', () => {
    const c = registry.buildComponent('beltConveyor', { beltWidth: 0.34, guideGap: 0.22 }, ctx);
    const rails = [];
    c.root.traverse((o) => { if (o.name === 'Guide rail 1') rails.push(boxOf(o)); });
    expect(rails).toHaveLength(2);
    const [rear, front] = rails.sort((a, b) => a.min.z - b.min.z);
    close(front.min.z - rear.max.z, 0.22, 1e-6);
    const bare = registry.buildComponent('beltConveyor', { guides: false, drive: false }, ctx);
    expect(bare.root.getObjectByName('Side guides')).toBeUndefined();
    expect(bare.root.getObjectByName('Gear motor')).toBeUndefined();
    expect(() => registry.buildComponent('beltConveyor', { beltWidth: 0.2, guideGap: 0.3 }, ctx)).toThrow(/guideGap/);
    c.dispose();
    bare.dispose();
  });

  it('belt motion scrolls the texture; drums and rollers make whole turns per tile, so it wraps', () => {
    const c = registry.buildComponent('beltConveyor', {}, ctx);
    const belt = c.root.getObjectByName('Belt carry side').material;
    expect(belt).not.toBe(materials.belt); // own material: each section scrolls on its own
    c.set('belt', 0.25);
    close(belt.map.offset.x, -0.25);
    const drum = c.root.getObjectByName('Head drum');
    const roller = c.root.getObjectByName('Return roller 1');
    c.set('belt', 0);
    const [d0, r0] = [drum.rotation.z, roller.rotation.z];
    c.set('belt', 1);
    const turns = (a, b) => (b - a) / (2 * Math.PI);
    close(turns(d0, drum.rotation.z) % 1, 0, 1e-9);
    close(turns(r0, roller.rotation.z) % 1, 0, 1e-9);
    c.dispose();
  });

  it('builds the same under a moved parent (station-local)', () => {
    const a = registry.buildComponent('beltConveyor', {}, ctx);
    const b = registry.buildComponent('beltConveyor', {}, ctx);
    const parent = new THREE.Group();
    parent.position.set(7, 0, -3);
    parent.add(b.root);
    parent.updateMatrixWorld(true);
    const ba = boxOf(a.root);
    const bb = boxOf(b.root).translate(new THREE.Vector3(-7, 0, 3));
    close(ba.min.distanceTo(bb.min), 0, 1e-9);
    close(ba.max.distanceTo(bb.max), 0, 1e-9);
    a.dispose();
    b.dispose();
  });
});

describe('jerryCan product', () => {
  it('starts empty and uncapped, with the reference refs (neck rim 0.398 m, cap seat 0.388 m, handle grip)', () => {
    const can = registry.buildProduct('jerryCan', {}, { materials });
    expect(can.stage).toBe('empty');
    expect(can.root.getObjectByName('Oil volume').visible).toBe(false);
    expect(can.root.getObjectByName('Cap').visible).toBe(false);
    const v = (r) => can.ref(r).toArray().map((x) => Number(x.toFixed(6)));
    expect(v('neckTop')).toEqual([0.075, 0.398, 0]);
    expect(v('capSeat')).toEqual([0.075, 0.388, 0]);
    expect(v('grasp')).toEqual([-0.054, 0.412, 0]); // the reference 'Handle grip' position
    close(lowestPoint(can.root), 0, 1e-6); // geometry is float32
    can.dispose();
  });

  it('stages: filled to the fill level, then capped with the cap on its seat', () => {
    const can = registry.buildProduct('jerryCan', { fillLevel: 0.9 }, { materials });
    const oil = can.root.getObjectByName('Oil volume');
    const inner = canDimensions(can.params).innerHeight;
    can.setStage('filled');
    expect(oil.visible).toBe(true);
    close(oil.scale.y, 0.9 * inner);
    close(can.api.surfaceY(), 0.012 + 0.9 * inner);
    expect(can.root.getObjectByName('Cap').visible).toBe(false);
    can.setStage('capped');
    const cap = can.root.getObjectByName('Cap');
    expect(cap.visible).toBe(true);
    close(cap.position.distanceTo(can.ref('capSeat')), 0);
    can.setStage('empty');
    expect(oil.visible).toBe(false);
    can.dispose();
  });

  it('fill routine raises the level from where it is; the cap feature screws the cap on', () => {
    const can = registry.buildProduct('jerryCan', {}, { materials });
    const run = can.routine('fill');
    run.start();
    run.update(0.5);
    close(can.api.level(), 0.45);
    run.end();
    close(can.api.level(), 0.9);
    const top = can.routine('fill', { to: 1 });
    top.start();
    top.update(0.5);
    close(can.api.level(), 0.95);
    expect(() => can.routine('fill', { to: 2 })).toThrow(/routine "fill"/);
    can.setFeature('cap', 'on');
    expect(can.root.getObjectByName('Cap').visible).toBe(true);
    can.dispose();
  });

  it('builds at the smallest and largest sizes: no NaN, resting on its base, nothing floating', () => {
    const sizes = [
      {},
      { length: 0.2, width: 0.12, height: 0.2, cornerRadius: 0.02, neckOffsetX: 0.05, neckRadius: 0.012, capRadius: 0.016 },
      { length: 0.45, width: 0.3, height: 0.55, cornerRadius: 0.06, neckOffsetX: 0.13, neckRadius: 0.04, neckHeight: 0.06, capRadius: 0.05, capHeight: 0.05 },
    ];
    for (const params of sizes) {
      const can = registry.buildProduct('jerryCan', params, { materials });
      can.setStage('capped');
      expect(nonFiniteMeshes(can.root)).toEqual([]);
      close(lowestPoint(can.root), 0, 1e-6); // geometry is float32
      expect(floatingMeshes(can.root)).toEqual([]);
      // Handle and neck stand on the body's top.
      const top = can.params.height;
      expect(boxOf(can.root.getObjectByName('Handle')).min.y).toBeLessThan(top);
      expect(boxOf(can.root.getObjectByName('Neck')).min.y).toBeLessThan(top);
      can.dispose();
    }
  });

  it('refuses shapes that cannot be made', () => {
    const bad = (params, re) => expect(() => registry.buildProduct('jerryCan', params, { materials })).toThrow(re);
    bad({ capRadius: 0.02 }, /capRadius/); // smaller than the neck
    bad({ neckOffsetX: 0.13 }, /neckOffsetX/); // off the flat top
    bad({ neckOffsetX: 0.02 }, /neckOffsetX/); // into the handle grip
    bad({ look: 'pink' }, /look/);
  });

  it('cans with the same look and label share their finishes; another label gets its own', () => {
    const shared = createMaterials();
    const a = registry.buildProduct('jerryCan', {}, { materials: shared });
    const b = registry.buildProduct('jerryCan', {}, { materials: shared });
    const c = registry.buildProduct('jerryCan', { grade: '10W-30', look: 'yellow' }, { materials: shared });
    const label = (can) => can.root.getObjectByName('Label front').material;
    expect(label(a)).toBe(label(b));
    expect(label(c)).not.toBe(label(a));
    expect(a.root.getObjectByName('Can body').material.transparent).toBe(true);
    expect(c.root.getObjectByName('Can body').material.transparent).toBe(false);
    // Disposing a can leaves the shared finishes; disposing the set frees them.
    let freed = 0;
    label(a).addEventListener('dispose', () => { freed += 1; });
    a.dispose();
    expect(freed).toBe(0);
    disposeJerryCanMaterials(shared);
    expect(freed).toBe(1);
    b.dispose();
    c.dispose();
  });
});
