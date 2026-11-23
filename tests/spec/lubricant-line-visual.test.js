// The visual half of Phase 5's lubricant-line comparison (as tests/spec/printer-line-visual.test.js
// for the printer line). Rendering needs Chrome, so it runs outside Vitest
// (node scripts/visual-compare.mjs --line lubricant-line); this test checks what that run recorded,
// and that the shift standing our line in the reference factory's frame is our layout's.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, diffImages } from '../../scripts/png.js';
import { LINES, LUBRICANT_SHIFT } from '../../scripts/visual-views.js';
import { VIEW_LIMITS } from '../../benchmarks/expected/lubricant-line-visual-limits.js';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import * as THREE from 'three';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { Line } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import factory from '../../spec/examples/lubricant-line.factory.json';

const results = JSON.parse(readFileSync('benchmarks/results/lubricant-line-visual.json', 'utf8'));
const dir = join('tests', 'golden', 'lines', 'lubricant-line');

describe('lubricant line looks like the reference factory (recorded by visual-compare --line lubricant-line)', () => {
  it('our line is shifted so its palletizing station stands at the reference origin (its station 3)', () => {
    const at = checkFactory(registry, factory).timing.layout.stations.palletizing;
    expect(LUBRICANT_SHIFT[0]).toBeCloseTo(-at.x, 9);
    expect(LUBRICANT_SHIFT[2]).toBeCloseTo(-at.z, 9);
    expect(at.rotationY).toBe(0);
    expect(LINES['lubricant-line'].ours).toContain(`shift=${LUBRICANT_SHIFT.join(',')}`);
  });

  it('rule 4: shifted by that much, our line plays exactly the same (status, and every unit in its station frame)', async () => {
    await preloadComponentAssets(registry);
    const materials = createMaterials();
    const expanded = expandFactory(registry, factory);
    const make = (shift) => {
      const line = new Line({ registry, line: expanded.line, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
      line.root.position.fromArray(shift);
      line.root.updateMatrixWorld(true);
      line.start();
      return line;
    };
    const plain = make([0, 0, 0]);
    const shifted = make(LUBRICANT_SHIFT);
    const units = (line) => line.stations.flatMap((st) => {
      const u = st.cycle.unit;
      if (!u) return [];
      u.root.updateWorldMatrix(true, false);
      return [st.id, ...line.root.worldToLocal(new THREE.Vector3().setFromMatrixPosition(u.root.matrixWorld)).toArray().map((v) => v.toFixed(6))];
    });
    for (let t = 0; t < 140; t += 0.05) {
      plain.update(0.05);
      shifted.update(0.05);
      if (Math.round(t * 20) % 200 === 0) {
        expect(JSON.stringify(shifted.status)).toBe(JSON.stringify(plain.status));
        expect(units(shifted)).toEqual(units(plain));
      }
    }
    expect(plain.status.released).toBeGreaterThan(4);
  }, 120000);

  it('has a result for every view with a limit, rendered at 1600×900, in time order', () => {
    expect(Object.keys(results.views).sort()).toEqual(Object.keys(VIEW_LIMITS).sort());
    expect(LINES['lubricant-line'].views.map((v) => v.id).sort()).toEqual(Object.keys(VIEW_LIMITS).sort());
    const times = LINES['lubricant-line'].views.map((v) => v.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(results.size).toEqual({ width: 1600, height: 900 });
  });

  for (const [id, limit] of Object.entries(VIEW_LIMITS)) {
    it(`${id}: at most ${(limit * 100).toFixed(1)} % of pixels differ`, () => {
      const r = results.views[id];
      expect(r.differing).toBeLessThanOrEqual(limit);
      const ours = join(dir, `${id}.png`);
      const ref = join(dir, `${id}.reference.png`);
      expect(existsSync(ours) && existsSync(ref)).toBe(true);
      const d = diffImages(decodePng(readFileSync(ours)), decodePng(readFileSync(ref)), { tolerance: results.tolerance });
      expect(d.differing).toBeCloseTo(r.differing, 4);
    });
  }
});
