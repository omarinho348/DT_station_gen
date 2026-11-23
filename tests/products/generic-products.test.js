// Products not in the catalog (Phase 6 step 7): the parametric product (shape and size) and the GLB
// product (the owner's model with a marked grasp point), on their own and carried by a line.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';
import { preloadComponentAssets, loadAsset } from '../../lib/core/assets.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { Line } from '../../lib/line/index.js';

const materials = createMaterials();
afterAll(() => disposeMaterials(materials));
beforeAll(() => preloadComponentAssets(registry));
const make = (type, params = {}) => registry.buildProduct(type, params, { materials });
const shown = (u, name) => u.root.getObjectByName(name).visible;
const bounds = (u) => {
  u.root.updateMatrixWorld(true);
  const b = new THREE.Box3();
  u.root.traverse((o) => { if (o.isMesh && o.visible) b.expandByObject(o); });
  return b;
};

describe('parametric product', () => {
  it('builds every shape to its size, standing on its base', () => {
    for (const [shape, l, w, h] of [['box', 0.3, 0.2, 0.15], ['cylinder', 0.1, 0.1, 0.12], ['bottle', 0.07, 0.07, 0.28], ['tray', 0.4, 0.3, 0.05]]) {
      const u = make('parametric', { shape, length: l, width: w, height: h, finish: 'plastic' });
      const b = bounds(u);
      expect(b.min.y, shape).toBeCloseTo(0, 6);
      expect(b.max.y, shape).toBeCloseTo(h, 6);
      expect(b.max.x - b.min.x, shape).toBeCloseTo(shape === 'box' || shape === 'tray' ? l : Math.min(l, w), 2);
      u.dispose();
    }
  });

  it('stages in line order, each including the ones before: processed colour, liquid, cap, label; no recolour unless asked', () => {
    const plain = make('parametric', { color: '#ffffff' });
    plain.setStage('labelled');
    expect(plain.root.getObjectByName('Body').material.color.getHex()).toBe(0xffffff);
    plain.dispose();
    const u = make('parametric', { shape: 'bottle', color: '#ffffff', processedColor: '#000000', fillLevel: 0.5 });
    const body = u.root.getObjectByName('Body').material;
    expect(body.color.getHex()).toBe(0xffffff);
    expect(shown(u, 'Liquid')).toBe(false);
    u.setStage('processed');
    expect(body.color.getHex()).toBe(0x000000);
    u.setStage('filled');
    expect(u.api.level()).toBe(0.5);
    expect(shown(u, 'Cap')).toBe(false);
    u.setStage('capped');
    expect(shown(u, 'Cap')).toBe(true);
    expect(shown(u, 'Label')).toBe(false);
    u.setStage('labelled');
    expect(shown(u, 'Label')).toBe(true);
    expect(u.ref('top').y).toBeGreaterThan(0.25); // the cap is on top now
    u.dispose();
  });

  it('works with the generic ops\' product roles: the fill routine raises the live liquid surface; cap and label features', () => {
    const u = make('parametric', { shape: 'bottle', height: 0.25 });
    const fill = u.routine('fill', { to: 0.8 });
    fill.start?.();
    const low = u.ref('liquidSurface').y;
    fill.update(0.5);
    const mid = u.ref('liquidSurface').y;
    fill.end();
    expect(mid).toBeGreaterThan(low);
    expect(u.ref('liquidSurface').y).toBeGreaterThan(mid);
    expect(u.api.level()).toBe(0.8);
    u.setFeature('cap', 'on');
    expect(shown(u, 'Cap')).toBe(true);
    const label = u.routine('label', {});
    label.update(0.5);
    expect(u.api.label()).toBe(0.5);
    // Wrapped round the bottle: half the arc drawn, all of it once labelled.
    const band = u.root.getObjectByName('Label').geometry;
    expect(band.drawRange.count).toBe(band.index.count / 2);
    label.end();
    expect(band.drawRange.count).toBe(band.index.count);
    u.dispose();
  });
});

describe('GLB product', () => {
  it('rests the owner\'s model on its base, centred; the grasp point is the one marked (default: the middle of its top)', () => {
    const u = make('model');
    const b = bounds(u);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(0.41, 3); // the sample crate's lid (0.40 + 0.01)
    expect(u.ref('grasp').toArray()).toEqual([0, u.api.size().y, 0]);
    const marked = make('model', { grasp: [0.05, 0.2, 0] });
    expect(marked.ref('grasp').toArray()).toEqual([0.05, 0.2, 0]);
    const turned = make('model', { turn: Math.PI / 2, scale: 2 });
    const tb = bounds(turned);
    expect(tb.max.z - tb.min.z).toBeCloseTo(0.82, 3); // turned a quarter and doubled
    [u, marked, turned].forEach((x) => x.dispose());
  });

  it('tints its own copies of the model\'s materials when processed; the cached model and other units keep theirs', () => {
    const a = make('model', { processedTint: '#ff0000' });
    const b = make('model');
    const colour = (u) => { let m = null; u.root.traverse((o) => { if (!m && o.isMesh && /crate.body/i.test(o.name)) m = o; }); return m.material.color.getHex(); };
    const before = colour(b);
    a.setStage('processed');
    expect(colour(a)).not.toBe(before);
    expect(colour(b)).toBe(before);
    a.setStage('labelled');
    expect(shown(a, 'Label')).toBe(true);
    a.dispose();
    expect(colour(b)).toBe(before);
    b.dispose();
  });

  it('refuses to build before its file is loaded, saying how to load it', () => {
    expect(() => make('model', { file: 'notLoadedYet.glb' })).toThrow(/needs its model loaded first \(notLoadedYet\.glb\)/);
  });
});

describe('in factory.json', () => {
  const station = {
    id: 'dose', title: 'Dosing', conveyor: 'belt', inputStage: 'raw',
    ports: { input: { machine: 'belt', port: 'input' }, output: { machine: 'belt', port: 'output' } },
    equipment: [{ id: 'belt', type: 'beltConveyor', params: { length: 2.4 } }],
    intake: [{ op: 'transfer', conveyor: 'belt', to: { machine: 'belt', port: 'input', offset: [1.2, 0, 0] } }],
    process: [
      { op: 'runRoutine', routine: 'fill', seconds: 3, label: 'Filling' },
      { op: 'runRoutine', routine: 'label', seconds: 1, label: 'Labelling' },
    ],
    output: [{ op: 'transfer', conveyor: 'belt', to: 'output' }],
    feed: { fromLift: false },
  };
  const factory = (product) => ({ version: 1, line: { id: 'demo', title: 'Demo', runSize: 2, conventions: { beltHeight: 0.86 } }, product, stations: [station], graph: { edges: [] } });

  it('a parametric product: checked, and filled and labelled by plain routine steps as it plays', () => {
    const f = factory({ kind: 'parametric', params: { shape: 'bottle', height: 0.25, labelText: 'JUICE' } });
    expect(checkFactory(registry, f).errors).toEqual([]);
    const { line: data, ctx, conventions } = expandFactory(registry, f);
    expect(data.product).toEqual({ type: 'parametric', params: { shape: 'bottle', height: 0.25, labelText: 'JUICE' } });
    const line = new Line({ registry, line: data, ctx: { ...ctx, materials }, conventions });
    const st = line.byId.get('dose');
    line.start();
    let filled = 0;
    let labelled = 0;
    for (let t = 0; t < 60 && line.state !== 'FINISHED'; t += 0.05) {
      line.update(0.05);
      if (st.cycle.unit) { filled = Math.max(filled, st.cycle.unit.api.level()); labelled = Math.max(labelled, st.cycle.unit.api.label()); }
    }
    expect(line.state).toBe('FINISHED');
    expect(filled).toBeCloseTo(0.85, 6);
    expect(labelled).toBe(1);
    line.dispose();
  });

  it('the owner\'s GLB: checked with its file; a bad param is reported at product.params', async () => {
    await loadAsset('sampleCrate.glb');
    const ok = factory({ kind: 'glb', file: 'sampleCrate.glb', params: { grasp: [0, 0.25, 0] } });
    const check = checkFactory(registry, { ...ok, stations: [{ ...station, process: [{ op: 'runRoutine', routine: 'label', seconds: 1 }] }] });
    expect(check.errors).toEqual([]);
    expect(check.expanded.line.product).toEqual({ type: 'model', params: { grasp: [0, 0.25, 0], file: 'sampleCrate.glb' } });
    const bad = checkFactory(registry, factory({ kind: 'glb', file: 'sampleCrate.glb', params: { scale: -1 } }));
    expect(bad.errors.map((e) => e.path)).toEqual(['product.params.scale']);
    // A GLB product has no fill routine: the dry plan says so.
    const noFill = checkFactory(registry, ok);
    expect(noFill.errors[0].message).toMatch(/fill/);
  });
});
