// Supply stock (lib/station/supplySpec.js, played by StationCycle): instanced items on a machine's
// decks, drawn one by one as a station brings units in or makes items. Phase 5 step 9d: the
// lubricant line's jerry-can and carton racks (the reference factory's supply racks).
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { Line } from '../../lib/line/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { Supplies, supplySlots, supplyProblems } from '../../lib/station/supplySpec.js';
import factory from '../../spec/examples/lubricant-line.factory.json';

const materials = createMaterials();
const DT = 0.02;
beforeAll(() => preloadComponentAssets(registry));

const station = (id) => factory.stations.find((s) => s.id === id);

function play() {
  const expanded = expandFactory(registry, factory);
  const line = new Line({ registry, line: expanded.line, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
  const clock = { t: 0 };
  line.start();
  const runTo = (t) => { while (clock.t < t - 1e-9) { line.update(DT); clock.t += DT; } };
  return { line, runTo, supply: (st, name) => line.byId.get(st).cycle.supplies.find((s) => s.name === name).stock };
}

describe('supply stock', () => {
  it('slots: deck by deck, layer, row, column, from each deck port', () => {
    const [s] = Object.values(Supplies.parse({ a: { machine: 'rack', decks: ['d1', 'd2'], columns: [-0.5, 0.5], rows: [0], layers: 2, layerHeight: 0.4, draws: 'units' } }));
    const decks = { d1: [0, 0.1, 0], d2: [0, 1.1, 0] };
    const slots = supplySlots(s, (d) => decks[d]);
    expect(slots.map((x) => x.position)).toEqual([
      [-0.5, 0.1, 0], [0.5, 0.1, 0], [-0.5, 0.5, 0], [0.5, 0.5, 0],
      [-0.5, 1.1, 0], [0.5, 1.1, 0], [-0.5, 1.5, 0], [0.5, 1.5, 0],
    ]);
  });

  it('problems: unknown machine or deck port', () => {
    const machines = { rack: { ports: { deck1: {} } } };
    expect(supplyProblems({ a: { machine: 'nope', decks: ['deck1'] } }, machines)).toEqual(['supply "a": unknown machine "nope"']);
    expect(supplyProblems({ a: { machine: 'rack', decks: ['deck1', 'deck9'] } }, machines)[0]).toMatch(/no port "deck9"/);
    const bad = structuredClone(factory);
    bad.stations.find((s) => s.id === 'filling').supplies.cans.decks.push('deck7');
    expect(checkFactory(registry, bad).errors.map((e) => e.message).join(' ')).toMatch(/supply "cans".*no port "deck7"/);
  });

  it('lubricant line: the reference racks, 108 jerry cans (3 decks × 6 × 6) and 32 cartons (2 decks × 2 layers × 2 × 4), on the rack decks', () => {
    const { line, supply } = play();
    const cans = supply('filling', 'cans');
    const cases = supply('packing', 'cases');
    expect(cans.capacity).toBe(108);
    expect(cases.capacity).toBe(32);
    // Station 1 starts with a batch preloaded at staging, taken from the rack.
    expect(cans.remaining).toBe(104);
    expect(cases.remaining).toBe(32);
    // The stock stands under its rack, on the decks (reference deck tops 0.14 / 0.74 / 1.34 m).
    const rack = line.byId.get('filling').cycle.equipment.canRack;
    expect(cans.root.parent).toBe(rack.root);
    const box = new THREE.Box3().setFromObject(cans.root);
    const local = box.clone().applyMatrix4(rack.root.matrixWorld.clone().invert());
    expect(local.min.y).toBeCloseTo(0.14, 2);
    expect(local.max.x).toBeLessThan(1.95 / 2);
    expect(local.max.z).toBeLessThan(1.35 / 2);
    // Instanced: a rack of 108 cans in a few draw calls.
    expect(cans.root.children.length).toBeLessThan(20);
    expect(cans.root.children.every((m) => m.isInstancedMesh)).toBe(true);
  });

  it('drawn as the line releases batches and station 2 erects cases; empty after the run as in the reference; a reset refills', () => {
    const { line, runTo, supply } = play();
    const cans = supply('filling', 'cans');
    const cases = supply('packing', 'cases');
    for (const t of [30, 120, 300]) {
      runTo(t);
      expect(cans.remaining).toBe(108 - 4 * line.released);
    }
    // Every case made so far was drawn: those packed plus the one in the erector / being packed.
    expect(32 - cases.remaining).toBeGreaterThanOrEqual(1);
    runTo(970);
    expect(line.state).toBe('FINISHED');
    expect(cans.remaining).toBe(0); // 27 batches of 4 = the rack's 108
    expect(cases.remaining).toBe(32 - 27);
    line.reset();
    expect(cans.remaining).toBe(104); // the preloaded batch again
    expect(cases.remaining).toBe(32);
  }, 180000);

  it('compiled station files carry the supplies', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('generated/lubricant-line/filling.js', 'utf8')).toMatch(/supplies:/);
    expect(readFileSync('generated/lubricant-line/packing.js', 'utf8')).toMatch(/draws: \{ made: 'case' \}/);
    expect(station('packing').supplies.cases.turn).toBeCloseTo(Math.PI / 2, 12);
  });
});
