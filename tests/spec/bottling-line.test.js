// spec/examples/bottling-line.factory.json: Phase 6's closing test line, built only from the generic
// level. Machines are composites of basic blocks (doser, capper, vision) and placeholders (rework
// bench, case packer); graph shapes (parallel filling, a buffer, a reject branch); a parametric
// product with a deterministic quality verdict by serial. Checked, compiled, played.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { compileFactory } from '../../compiler/emit.js';
import { Line } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import factory from '../../spec/examples/bottling-line.factory.json';

const materials = createMaterials();
beforeAll(() => preloadComponentAssets(registry, null, [{ type: 'parametric' }]));

describe('bottling-line.factory.json (generic level only)', () => {
  it('uses no tuned catalog machine: composites and placeholders on catalog belts and a roller lane', () => {
    const types = new Set(factory.stations.flatMap((s) => s.equipment.map((e) => e.type)));
    expect([...types].sort()).toEqual(['beltConveyor', 'composite', 'genericMachine', 'rollerConveyor']);
    const parts = new Set(factory.stations.flatMap((s) => s.equipment.filter((e) => e.type === 'composite').flatMap((e) => e.params.parts.map((p) => p.type))));
    // Every part of every composite is a basic block (or the basic-level gripper).
    const basic = registry.components().filter((d) => ['frame', 'axis', 'tool'].includes(d.category)).map((d) => d.type);
    expect([...parts].every((t) => basic.includes(t))).toBe(true);
    expect(factory.product.kind).toBe('parametric');
  });

  it('checks: the two placeholders reported, the main path and side lane laid out, the takt from the shared filling or the slowest other station', () => {
    const check = checkFactory(registry, factory);
    expect(check.errors).toEqual([]);
    expect(check.warnings.map((w) => w.message)).toEqual([
      'station "rework": "machine" is a placeholder for "Rework bench" (genericMachine); replace it with a catalog machine or a composite',
      'station "pack": "machine" is a placeholder for "Case packer" (genericMachine); replace it with a catalog machine or a composite',
    ]);
    const t = check.timing;
    expect(t.layout.main).toEqual(['fill1', 'cap', 'inspect', 'pack']);
    expect(t.layout.order).toEqual(['fill1', 'fill2', 'cap', 'inspect', 'pack', 'rework']);
    expect(t.layout.stations.rework.z).toBeLessThan(t.layout.stations.inspect.z - 1); // behind, on the reject side
    const cycle = (id) => t.stations.find((s) => s.id === id).cycleTime;
    expect(t.takt).toBeCloseTo(Math.max(cycle('fill1') / 2, cycle('cap'), cycle('inspect'), cycle('pack')), 5);
    expect(t.takt).toBeLessThan(cycle('fill1')); // two fillers share the slowest work
  });

  it('the compiled files on disk are what the compiler writes now (otherwise: npm run compile)', () => {
    const { files } = compileFactory(registry, factory, { source: 'spec/examples/bottling-line.factory.json' });
    expect(files.map((f) => f.name).sort()).toEqual(['cap.js', 'fill1.js', 'fill2.js', 'inspect.js', 'line.js', 'pack.js', 'rework.js']);
    for (const f of files) expect(readFileSync(`generated/bottling-line/${f.name}`, 'utf8'), f.name).toBe(f.content);
  });

  it('plays a run of 10: both fillers share the work; every bottle filled and capped; serials 4 and 8 rejected to rework, the rest packed', () => {
    const { line: data, ctx, conventions } = expandFactory(registry, factory);
    const line = new Line({ registry, line: data, ctx: { ...ctx, materials }, conventions });
    const seen = Object.fromEntries(line.stations.map((s) => [s.id, []]));
    const state = new Map(); // what each bottle looked like when it reached packing / rework
    line.onUpdate = () => {
      for (const s of line.stations) {
        const u = s.cycle.unit;
        if (!u || seen[s.id].at(-1) === u) continue;
        seen[s.id].push(u);
        if (s.id === 'pack' || s.id === 'rework') state.set(u.params.serial, { level: u.api.level(), cap: u.root.getObjectByName('Cap').visible });
      }
    };
    line.start();
    for (let t = 0; t < 900 && line.state !== 'FINISHED'; t += 0.05) line.update(0.05);
    expect(line.state).toBe('FINISHED');
    expect(line.status).toMatchObject({ released: 10, exited: 10 });
    const serials = (id) => seen[id].map((u) => u.params.serial).sort((a, b) => a - b);
    expect(seen.fill1.length).toBe(5);
    expect(seen.fill2.length).toBe(5);
    expect(serials('rework')).toEqual([4, 8]);
    expect(serials('pack')).toEqual([1, 2, 3, 5, 6, 7, 9, 10]);
    for (const [serial, s] of state) {
      expect(s.level, `bottle ${serial}`).toBeCloseTo(0.85, 6);
      expect(s.cap, `bottle ${serial}`).toBe(true);
    }
    line.dispose();
  }, 120000);
});
