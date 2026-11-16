// The §9 checks, run automatically for every registered component: a new component gets
// tested just by being added to lib/components/**.
import { describe, it, expect, afterAll } from 'vitest';
import { registry } from '../../lib/components/index.js';
import { paramSamples } from '../../lib/registry.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';
import {
  unnamedObjects, nonFiniteMeshes, footprintViolations, lowestPoint, floatingMeshes,
} from '../helpers/componentChecks.js';

const materials = createMaterials();
afterAll(() => disposeMaterials(materials));

const defs = registry.components();

it('has at least one component registered', () => {
  expect(defs.length).toBeGreaterThan(0);
});

for (const def of defs) {
  describe(`component ${def.type}`, () => {
    const samples = paramSamples(def.params);

    for (const [label, params] of Object.entries(samples)) {
      describe(`at ${label} params`, () => {
        const inst = registry.buildComponent(def.type, params, { materials });
        // Tools hang from a flange: connected to their top, and allowed below their origin.
        const anchor = def.mount === 'tool' ? 'top' : 'floor';
        const floorLimit = Math.min(-def.sinks, inst.footprint.bottom);

        it('builds with every object named and no NaN', () => {
          expect(unnamedObjects(inst.root)).toEqual([]);
          expect(nonFiniteMeshes(inst.root)).toEqual([]);
        });

        it('stays inside its footprint and above the floor', () => {
          expect(footprintViolations(inst.root, inst.footprint)).toEqual([]);
          expect(lowestPoint(inst.root)).toBeGreaterThanOrEqual(floorLimit - 1e-6);
        });

        it('has nothing floating', () => {
          expect(floatingMeshes(inst.root, { anchor })).toEqual([]);
        });

        it('shows its sample on every display, and rejects bad data', () => {
          for (const [name, spec] of Object.entries(def.displays)) {
            expect(() => inst.show(name, spec.sample)).not.toThrow();
            expect(() => inst.show(name, { nonsense: true })).toThrow(/display/);
          }
        });

        it('runs every motion through its whole range and stays valid', () => {
          for (const [name, spec] of Object.entries(inst.motions)) {
            const values = spec.range
              ? Array.from({ length: 11 }, (_, i) => spec.range[0] + ((spec.range[1] - spec.range[0]) * i) / 10)
              : spec.values;
            for (const value of values) {
              inst.set(name, value);
              expect(inst.state[name]).toBe(value);
              expect(nonFiniteMeshes(inst.root)).toEqual([]);
              expect(footprintViolations(inst.root, inst.footprint)).toEqual([]);
              expect(lowestPoint(inst.root)).toBeGreaterThanOrEqual(floorLimit - 1e-6);
              expect(floatingMeshes(inst.root, { anchor })).toEqual([]);
            }
          }
        });

        it('disposes cleanly', () => {
          expect(() => inst.dispose()).not.toThrow();
        });
      });
    }
  });
}
