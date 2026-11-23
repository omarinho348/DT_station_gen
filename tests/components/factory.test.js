// Phase 5 factory pieces (reference factory/SupplyRack.js and TransferLines.js): rack, instanced
// supply stock, area sign, row-former pusher, single-file guides, the case source's rear port.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { createInstancedStock } from '../../lib/core/instancedStock.js';

const materials = createMaterials();
const BELT = 0.86;
const ctx = { materials, beltHeight: BELT };
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const boxOf = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); };
const named = (root, re) => { const out = []; root.traverse((o) => { if (o.isMesh && re.test(o.name)) out.push(o); }); return out; };
const CAN = { height: 0.33 }; // the reference packable can

describe('palletRack and instanced supply stock', () => {
  it('is the reference can rack: decks at 0.14 / 0.74 / 1.34 m, uprights 1.95 m, a port per deck', () => {
    const r = registry.buildComponent('palletRack', {}, ctx);
    expect(Object.values(r.ports).map((p) => Number(p.position[1].toFixed(6)))).toEqual([0.14, 0.74, 1.34]);
    close(boxOf(named(r.root, /^Upright$/)[0]).max.y, 1.95, 1e-6);
    for (let i = 1; i <= 3; i += 1) close(boxOf(r.root.getObjectByName(`Wire deck ${i}`)).max.y, r.ports[`deck${i}`].position[1], 1e-6);
    r.dispose();
  });

  it('holds the reference 108 empty cans (6 × 6 per deck) as instanced stock, inside the rack and under each next deck', () => {
    const r = registry.buildComponent('palletRack', {}, ctx);
    const can = registry.buildProduct('jerryCan', CAN, { materials });
    const decks = Object.values(r.ports).map((p) => p.position[1]);
    const slots = decks.flatMap((y) => Array.from({ length: 36 }, (_, i) => new THREE.Matrix4().makeTranslation(((i % 6) - 2.5) * 0.3, y, (Math.floor(i / 6) - 2.5) * 0.205)));
    const stock = createInstancedStock({ name: 'Empty cans', template: can.root, slots });
    expect(stock.capacity).toBe(108);
    const rackBox = boxOf(r.root);
    const canBox = boxOf(can.root);
    for (const slot of slots) {
      const b = canBox.clone().applyMatrix4(slot);
      expect(rackBox.containsBox(b)).toBe(true);
      const above = decks.find((y) => y > b.min.y + 0.01);
      if (above) expect(b.max.y).toBeLessThan(above - 0.02); // clears the deck above
    }
    const body = stock.root.children.find((m) => /Can body/.test(m.name));
    expect(body.isInstancedMesh).toBe(true);
    expect(stock.root.children.length).toBeLessThan(20); // one draw call per can part, not per can
    for (let i = 0; i < 5; i += 1) stock.take();
    expect(stock.remaining).toBe(103);
    expect(body.count).toBe(103);
    stock.refill();
    expect(body.count).toBe(108);
    expect(() => createInstancedStock({ name: 'x', template: new THREE.Group(), slots })).toThrow(/no visible meshes/);
    stock.dispose();
    can.dispose();
    r.dispose();
  });
});

describe('sidePusher and guideRails on a 0.52 m transfer belt (reference)', () => {
  const conveyor = () => registry.buildComponent('beltConveyor', { length: 3.0, beltWidth: 0.52, guideGap: 0.46 }, ctx);

  it('a can in single file passes between the guide rails; the posts stand on the frames', () => {
    const c = conveyor();
    const g = registry.buildComponent('guideRails', { span: 0.58 }, ctx);
    g.root.position.y = boxOf(c.root.getObjectByName('Side frame front')).max.y;
    const can = registry.buildProduct('jerryCan', CAN, { materials });
    can.root.position.y = BELT;
    const body = boxOf(can.root.getObjectByName('Can body'));
    const rails = named(g.root, /Single-file rail/).map(boxOf);
    expect(rails.filter((r) => r.intersectsBox(body))).toHaveLength(0);
    const inner = Math.min(...rails.map((r) => Math.min(Math.abs(r.min.z), Math.abs(r.max.z))));
    close(inner - body.max.z, 0.005, 1e-3); // 5 mm each side
    const frameTop = boxOf(c.root.getObjectByName('Side frame front')).max.y;
    for (const post of named(g.root, /Rail post/)) close(boxOf(post).min.y, frameTop, 1e-6);
    c.dispose();
    g.dispose();
    can.dispose();
  });

  it('retracted the plate clears the belt guides; pushed, it shifts a can from the centre line into the reference lane (z −0.13); the rod stays in its cylinder', () => {
    const c = conveyor();
    const p = registry.buildComponent('sidePusher', {}, ctx);
    const plate = () => boxOf(p.root.getObjectByName('Plate pad'));
    const rails = named(c.root, /Guide rail|Guide post/).map(boxOf);
    expect(rails.filter((r) => r.intersectsBox(plate()))).toHaveLength(0);
    const canHalfWidth = 0.19 / 2;
    const face = -0.13 + canHalfWidth; // the can's +Z face in the lane
    p.set('face', face);
    close(plate().min.z, face, 1e-3);
    const rodEnd = boxOf(p.root.getObjectByName('Piston rod')).max.z;
    const barrel = boxOf(p.root.getObjectByName('Cylinder barrel'));
    expect(rodEnd).toBeGreaterThan(barrel.min.z);
    expect(plate().min.y).toBeGreaterThan(BELT + 0.15); // above the guide rails
    c.dispose();
    p.dispose();
  });
});

describe('signBoard and the case source rear port', () => {
  it('the sign reads from both sides (two faces back to back on the post)', () => {
    const s = registry.buildComponent('signBoard', { title: 'DISPATCH' }, ctx);
    const n = (name) => new THREE.Vector3(0, 0, 1).applyQuaternion(s.root.getObjectByName(name).getWorldQuaternion(new THREE.Quaternion()));
    close(n('Sign board front').z, 1, 1e-9);
    close(n('Sign board back').z, -1, 1e-9);
    s.dispose();
  });

  it('a case on a transfer belt enters the source through its rear port: the port is at the belt and fits the case', () => {
    const src = registry.buildComponent('caseSource', { rearPort: true }, { ...ctx, beltHeight: 0.82 });
    expect(src.ports.input).toMatchObject({ position: [-1.55, 0.82, 0], direction: 'in', carries: 'case' });
    const opening = boxOf(src.root.getObjectByName('Port opening'));
    const caseBox = new THREE.Box3(new THREE.Vector3(-1.56, 0.82, -0.21), new THREE.Vector3(-1.5, 0.82 + 0.42, 0.21));
    expect(opening.min.y).toBeLessThanOrEqual(caseBox.min.y);
    expect(opening.max.y).toBeGreaterThanOrEqual(caseBox.max.y);
    expect(opening.min.z).toBeLessThanOrEqual(caseBox.min.z);
    const trims = named(src.root, /Port trim|Curtain strip/).map(boxOf);
    expect(trims.filter((t) => t.intersectsBox(caseBox) && t.min.y < caseBox.max.y - 0.05)).toHaveLength(0); // only the curtain tips brush its top
    src.dispose();
  });
});
