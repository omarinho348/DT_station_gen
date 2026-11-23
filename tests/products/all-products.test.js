// The generic checks, run for every registered product (as tests/components/all-components.test.js
// for components): a new product is tested just by being added to lib/products/**.
// At default params: every stage builds with every object named and no NaN, of a sensible size
// (products ride at belt height, so parts may reach below their origin: a work carrier's skirt);
// every ref is a finite point; every feature value can be set; it disposes cleanly.
import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { unnamedObjects, nonFiniteMeshes } from '../helpers/componentChecks.js';

const materials = createMaterials();
afterAll(() => disposeMaterials(materials));
await preloadComponentAssets(registry);

const defs = registry.products();

it('has products registered, including the parametric and GLB ones', () => {
  expect(defs.map((d) => d.type)).toEqual(expect.arrayContaining(['parametric', 'model']));
});

for (const def of defs) {
  describe(`product ${def.type}`, () => {
    const unit = registry.buildProduct(def.type, {}, { materials });

    for (const stage of def.stages) {
      it(`stage ${stage}: every object named, no NaN, a sensible size; refs finite`, () => {
        unit.setStage(stage);
        expect(unnamedObjects(unit.root)).toEqual([]);
        expect(nonFiniteMeshes(unit.root)).toEqual([]);
        unit.root.updateMatrixWorld(true);
        const box = new THREE.Box3();
        unit.root.traverse((o) => { if (o.isMesh && o.visible) box.expandByObject(o); });
        expect(box.isEmpty()).toBe(false);
        expect(box.getSize(new THREE.Vector3()).length()).toBeLessThan(3);
        for (const ref of def.refs) {
          const v = unit.ref(ref);
          expect([v.x, v.y, v.z].every(Number.isFinite), `${ref}`).toBe(true);
        }
      });
    }

    it('takes every feature value', () => {
      for (const [name, spec] of Object.entries(def.features)) {
        for (const value of spec.values) expect(() => unit.setFeature(name, value)).not.toThrow();
      }
    });

    it('disposes cleanly', () => {
      expect(() => unit.dispose()).not.toThrow();
    });
  });
}
