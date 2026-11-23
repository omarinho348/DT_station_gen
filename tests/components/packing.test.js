// Phase 5 case-packing machines (reference station-2): the packing gantry and the case closer,
// checked against the reference numbers and against the jerry can and carton they handle.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { createMaterials } from '../../lib/core/materials.js';

const materials = createMaterials();
const BELT = 0.86;
const ctx = { materials, beltHeight: BELT };
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const boxOf = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); };
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const meshes = (root) => { const out = []; root.updateMatrixWorld(true); root.traverse((o) => { if (o.isMesh && o.visible) out.push(o); }); return out; };
// The reference station-2 case and can: a 0.62 × 0.42 × 0.42 case, cans 0.33 m tall.
const CASE = { length: 0.62, width: 0.42, height: 0.42, foam: 0 };
const CAN = { height: 0.33 };

describe('packingGantry', () => {
  it('matches the reference: beams at 2.45 m on columns at x ±0.26 / z ±1.65, grippers 2 × 2 at x ±0.14', () => {
    const g = registry.buildComponent('packingGantry', {}, ctx);
    close(boxOf(g.root.getObjectByName('Z beam right')).getCenter(new THREE.Vector3()).y, 2.45, 1e-6);
    const columns = [];
    g.root.traverse((o) => { if (o.name === 'Column') columns.push(o.position.toArray().filter((_, i) => i !== 1)); });
    expect(columns.map(([x, zz]) => [Math.abs(x), Math.abs(zz)])).toEqual(Array(4).fill([0.26, 1.65]));
    expect(g.anchors).toEqual(['grip1', 'grip2', 'grip3', 'grip4']);
    g.set('pitch', 0.26);
    const at = (i) => worldOf(g.anchor(`grip${i}`)).toArray().map((n) => Number(n.toFixed(6)));
    expect([at(1), at(2), at(3), at(4)].map(([x, , zz]) => [x, zz])).toEqual([[-0.14, -0.13], [0.14, -0.13], [-0.14, 0.13], [0.14, 0.13]]);
    g.set('pitch', 0.2); // case spacing: rows at the reference case layout z ±0.1
    expect([at(1)[2], at(3)[2]]).toEqual([-0.1, 0.1]);
    g.dispose();
  });

  it('reaches both conveyors (z ±0.75) and both heights the reference uses (pick 1.242 m, travel 1.942 m)', () => {
    const g = registry.buildComponent('packingGantry', {}, ctx);
    const can = registry.buildProduct('jerryCan', CAN, { materials });
    const pick = BELT + can.ref('grasp').y;
    close(pick, 1.242, 1e-9);
    const { z: zr, y: yr } = g.motions;
    for (const zz of [-0.75, 0.75]) expect(zz >= zr.range[0] && zz <= zr.range[1]).toBe(true);
    for (const y of [pick, pick + 0.7]) expect(y >= yr.range[0] && y <= yr.range[1]).toBe(true);
    g.dispose();
    can.dispose();
  });

  it('closed fingers hook under a jerry-can handle: plates clear of the grip, lips under it', () => {
    const g = registry.buildComponent('packingGantry', {}, ctx);
    const can = registry.buildProduct('jerryCan', CAN, { materials });
    // Can at the reference input stop under gripper 1.
    g.set('z', 0.75);
    g.set('pitch', 0.26);
    const grasp0 = can.ref('grasp');
    g.set('y', BELT + grasp0.y);
    const tcp = worldOf(g.anchor('grip1'));
    can.root.position.copy(tcp).sub(grasp0);
    g.set('grip', 0.047);
    const grip = boxOf(can.root.getObjectByName('Handle grip'));
    const unit = g.anchor('grip1');
    const plates = []; const lips = [];
    unit.traverse((o) => { if (o.name === 'Finger plate') plates.push(boxOf(o)); if (o.name === 'Finger lip') lips.push(boxOf(o)); });
    for (const p of plates) expect(p.min.z >= grip.max.z - 1e-6 || p.max.z <= grip.min.z + 1e-6).toBe(true); // clear of the grip faces
    for (const l of lips) {
      expect(l.max.y).toBeLessThan(grip.min.y); // under the grip
      expect(l.max.z > grip.min.z && l.min.z < grip.max.z).toBe(true); // reaching in under it
    }
    g.set('grip', 0.09); // open: the lips clear the grip, so it can be lowered onto the handle
    lips.length = 0;
    unit.traverse((o) => { if (o.name === 'Finger lip') lips.push(boxOf(o)); });
    for (const l of lips) expect(l.min.z >= grip.max.z || l.max.z <= grip.min.z).toBe(true);
    g.dispose();
    can.dispose();
  });

  it('one row of four grippers, and the beacon modes', () => {
    const g = registry.buildComponent('packingGantry', { rows: 1, columns: 4, columnPitch: 0.3 }, ctx);
    expect(g.anchors).toHaveLength(4);
    expect(new Set(g.anchors.map((a) => worldOf(g.anchor(a)).z.toFixed(6)))).toEqual(new Set(['0.000000']));
    const lamp = g.root.getObjectByName('Beacon lamp').material;
    g.set('beacon', 'run');
    expect(lamp.emissive.getHex()).toBe(0x2ecc59);
    g.set('beacon', 'alarm');
    expect(lamp.emissive.getHex()).toBe(0xe23a2e);
    g.dispose();
  });
});

describe('caseCloser', () => {
  it('matches the reference: beam 0.62 m over the case top, columns at z ±0.6, folder cylinders at ±0.47, plate 0.58 × 0.36', () => {
    const c = registry.buildComponent('caseCloser', {}, ctx);
    const top = BELT + 0.42;
    close(c.root.getObjectByName('Closer beam').position.y, top + 0.62);
    const cols = [];
    c.root.traverse((o) => { if (o.name === 'Closer column') cols.push(o.position.z); });
    expect(cols).toEqual([-0.6, 0.6]);
    const cyl = [];
    c.root.traverse((o) => { if (o.name === 'Folder cylinder') cyl.push(Number(o.position.z.toFixed(6))); });
    expect(cyl).toEqual([-0.47, 0.47]);
    const plate = boxOf(c.root.getObjectByName('Press plate')).getSize(new THREE.Vector3());
    close(plate.x, 0.58, 1e-6);
    close(plate.z, 0.36, 1e-6);
    expect(c.ports.work).toMatchObject({ position: [0, BELT, 0], carries: 'case' });
    c.dispose();
  });

  it('parked, an erected case with open flaps passes underneath without touching any tool', () => {
    const c = registry.buildComponent('caseCloser', {}, ctx);
    const carton = registry.buildProduct('carton', CASE, { materials });
    carton.root.position.y = BELT;
    const tools = meshes(c.root).filter((m) => /Tucker roller|Folder roller|Press|Tucker rod|Folder rod/.test(m.name)).map(boxOf);
    const flaps = meshes(carton.root).map(boxOf);
    const clashes = tools.filter((t) => flaps.some((f) => t.intersectsBox(f)));
    expect(clashes).toHaveLength(0);
    c.dispose();
    carton.dispose();
  });

  it('tools move as the reference: tuckers beyond / over the end walls, folders at the side walls, plate onto the top', () => {
    const c = registry.buildComponent('caseCloser', {}, ctx);
    const top = BELT + 0.42;
    const tucker = c.root.getObjectByName('Tucker leading');
    close(tucker.position.x, 0.31 + 0.12); // parked 12 cm beyond the end wall
    c.set('tuckerOut', -0.1);
    c.set('tuckerUp', 0.15);
    close(tucker.position.x, 0.31 - 0.1); // 10 cm in over the case
    close(worldOf(tucker.getObjectByName('Tucker bar')).y, top - 0.01 + 0.15);
    c.set('folderOut', -0.1);
    close(c.root.getObjectByName('Side folder front').position.z, 0.21 - 0.1);
    c.set('plateUp', 0);
    close(boxOf(c.root.getObjectByName('Press pad')).min.y, top - 0.005, 1e-6); // pad on the closed top
    c.dispose();
  });
});

describe('carton as the reference station-2 case', () => {
  it('holds four 0.33 m jerry cans in the reference 2 × 2 layout, inside the walls and under the flap hinges', () => {
    const carton = registry.buildProduct('carton', CASE, { materials });
    const inner = { x: 0.31 - 0.006, z: 0.21 - 0.006, y: carton.ref('bottom').y };
    for (const x of [-0.14, 0.14]) for (const zz of [-0.1, 0.1]) {
      const can = registry.buildProduct('jerryCan', CAN, { materials });
      can.setStage('capped');
      can.root.position.set(x, inner.y, zz);
      const b = boxOf(can.root);
      expect(b.min.x).toBeGreaterThanOrEqual(-inner.x - 1e-6);
      expect(b.max.x).toBeLessThanOrEqual(inner.x + 1e-6);
      expect(b.min.z).toBeGreaterThanOrEqual(-inner.z - 1e-6);
      expect(b.max.z).toBeLessThanOrEqual(inner.z + 1e-6);
      expect(b.max.y).toBeLessThan(0.42 - 0.01); // under the closed flaps
      can.dispose();
    }
    carton.dispose();
  });
});

describe('case-packing conveyor fixtures (reference 0.52 m belts)', () => {
  const BELT_WIDTH = 0.52;
  const SPAN = BELT_WIDTH + 0.06; // a beltConveyor's side-frame spacing
  const conveyor = (params = {}) => registry.buildComponent('beltConveyor', { length: 4.75, beltWidth: BELT_WIDTH, guideGap: 0.46, ...params }, ctx);
  const frameTop = (c) => boxOf(c.root.getObjectByName('Side frame front')).max.y;
  const intersects = (a, b) => a.intersectsBox(b);

  it('lane divider: bridges stand on the frames; two cans in the reference lanes (z ±0.13) clear the blade and the guides', () => {
    const c = conveyor();
    const d = registry.buildComponent('laneDivider', { length: 2.66, span: SPAN }, ctx);
    d.root.position.y = frameTop(c);
    const frames = ['Side frame front', 'Side frame rear'].map((n) => boxOf(c.root.getObjectByName(n)));
    meshes(d.root).filter((m) => m.name === 'Bridge post').forEach((post) => {
      const b = boxOf(post);
      close(b.min.y, frames[0].max.y, 1e-6);
      expect(frames.some((f) => b.getCenter(new THREE.Vector3()).z > f.min.z && b.getCenter(new THREE.Vector3()).z < f.max.z)).toBe(true);
    });
    const blade = boxOf(d.root.getObjectByName('Divider blade'));
    expect(blade.min.y).toBeGreaterThan(BELT); // clear of the belt
    const rails = meshes(c.root).filter((m) => /Guide rail/.test(m.name)).map(boxOf);
    for (const laneZ of [-0.13, 0.13]) {
      const can = registry.buildProduct('jerryCan', CAN, { materials });
      can.root.position.set(0, BELT, laneZ);
      const body = boxOf(can.root.getObjectByName('Can body'));
      expect(intersects(body, blade)).toBe(false);
      expect(rails.some((r) => intersects(body, r))).toBe(false);
      can.dispose();
    }
    c.dispose();
    d.dispose();
  });

  it('end stop: a can whose leading face is on the stop face touches only the bumper face', () => {
    const c = conveyor();
    const s = registry.buildComponent('beltEndStop', { span: SPAN }, ctx);
    s.root.position.set(0.28, frameTop(c), 0); // across the whole belt, both lanes
    const stopFace = worldOf(s.root).x;
    const bumper = boxOf(s.root.getObjectByName('Stop bumper'));
    close(bumper.min.x, stopFace, 1e-9);
    const can = registry.buildProduct('jerryCan', CAN, { materials });
    can.root.position.set(stopFace - 0.14, BELT, 0.13); // can length 0.28: leading face on the stop
    const body = boxOf(can.root.getObjectByName('Can body'));
    close(body.max.x, stopFace, 1e-6);
    expect(body.max.y).toBeGreaterThan(bumper.min.y); // the bumper is at the can's height
    expect(worldOf(s.root).y + s.ports.stop.position[1]).toBeCloseTo(BELT, 9);
    c.dispose();
    s.dispose();
    can.dispose();
  });

  it('swing stop on the rear frame: closed, its blade blocks the case path; open, a case passes', () => {
    const c = conveyor();
    const s = registry.buildComponent('swingStop', { reach: SPAN / 2 + 0.03 }, ctx);
    s.root.position.set(0.31, frameTop(c), -SPAN / 2); // stop face at the case's leading face
    const carton = registry.buildProduct('carton', CASE, { materials });
    carton.root.position.set(0.31 + 0.31 + 0.05, BELT, 0); // a case just downstream of the stop face
    const caseBox = boxOf(carton.root.getObjectByName('Case body'));
    const blade = () => boxOf(s.root.getObjectByName('Stop blade'));
    // Closed: the blade reaches across into the case's path (z band), at its height.
    expect(blade().max.z).toBeGreaterThan(caseBox.min.z);
    expect(blade().min.y).toBeLessThan(caseBox.max.y);
    s.set('open', 1);
    // Open: the blade lies along the rear frame, outside the case's z band.
    expect(blade().max.z).toBeLessThan(caseBox.min.z);
    c.dispose();
    s.dispose();
    carton.dispose();
  });

  it('inline taper: a closed reference case passes between the columns, wipe rollers just on its top; feed turns roll and rollers', () => {
    const t = registry.buildComponent('inlineTaper', { caseHeight: 0.42, beltWidth: BELT_WIDTH }, ctx);
    const carton = registry.buildProduct('carton', CASE, { materials });
    carton.routine('foldMinor').update(1);
    carton.routine('foldMajor').update(1);
    carton.root.position.y = BELT;
    const caseBox = boxOf(carton.root);
    for (const col of meshes(t.root).filter((m) => m.name === 'Taper column')) expect(intersects(boxOf(col), caseBox)).toBe(false);
    const roller = boxOf(t.root.getObjectByName('Wipe roller 1'));
    expect(roller.min.y - caseBox.max.y).toBeGreaterThan(0);
    expect(roller.min.y - caseBox.max.y).toBeLessThan(0.005);
    t.set('feed', 0.5); // half a roll turn: π·0.09 m of tape
    close(t.root.getObjectByName('Tape roll').rotation.z, -Math.PI);
    close(t.root.getObjectByName('Wipe roller 1').rotation.z, -(Math.PI * 0.09) / 0.028);
    t.dispose();
    carton.dispose();
  });
});
