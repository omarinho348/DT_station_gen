import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { z } from 'zod';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { OpCycle, OpError, dryRun } from '../../lib/ops/index.js';
import { PICK_TIMING } from '../../lib/ops/sequences.js';
import { createRegistry } from '../../lib/registry.js';
import { StepSequencer } from '../../lib/core/StepSequencer.js';
import { createMaterials } from '../../lib/core/materials.js';

const materials = createMaterials();
const worldPos = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const worldQuat = (o) => o.getWorldQuaternion(new THREE.Quaternion());

// ST2's gantry (reference FRAME_DEFINITION) and its timing.
const ST2_GANTRY = { spanX: 1.5, spanZ: 0.9, beamY: 2.3, maxGap: 0.26, screwdriver: true };
const ST2_TIMING = { approach: 0.6, descend: 0.35, grip: 0.2, lift: 0.35, transfer: 0.8, place: 0.5, release: 0.2 };
const install = (part, extra = {}) => ({ op: 'installPart', machine: 'gantry', part, gap: 0.047, openGap: 0.26, timing: ST2_TIMING, clearance: 0.12, ...extra });

/** An ST2-like cell, rotated and moved off the origin: a located printer under the gantry. */
function cell({ productAt = [0, 0.88, 0], stage = 'kitted', gantry = ST2_GANTRY } = {}) {
  const root = new THREE.Group();
  root.position.set(-3, 0, 4);
  root.rotation.y = -0.6;
  const robot = registry.buildComponent('cartesianGantry', gantry, { materials });
  root.add(robot.root);
  const product = registry.buildProduct('printer', { serial: 7 }, { materials });
  product.setStage(stage);
  product.root.position.fromArray(productAt);
  root.add(product.root);
  const sequencer = new StepSequencer();
  const cycle = new OpCycle({ registry, sequencer, equipment: { gantry: robot }, product, workState: 'FRAME_ASSEMBLY' });
  return { root, robot, product, sequencer, cycle };
}

const advanceTo = (c, t) => c.sequencer.advance(t);
const runAll = (c) => c.sequencer.advance(c.cycle.time + 1);

/** Part transform in its assembled pose, world frame. */
function asmWorld(c, part) {
  c.product.root.updateWorldMatrix(true, false);
  return c.product.root.matrixWorld.clone().multiply(c.product.assembly.pose(part, 'asm'));
}

function expectAtPose(object, matrix, eps = 1e-6) {
  const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3();
  matrix.decompose(p, q, s);
  expect(worldPos(object).distanceTo(p)).toBeLessThan(eps);
  expect(worldQuat(object).angleTo(q)).toBeLessThan(eps);
}

describe('named ops: registry', () => {
  it('defines pickPlace, installPart and driveScrew, all timed by their steps', () => {
    for (const op of ['pickPlace', 'installPart', 'driveScrew']) {
      expect(registry.getOp(op)).not.toBe(null);
      expect(registry.getOp(op).duration).toBeUndefined();
    }
  });

  it('products with parts must provide the assembly interface', () => {
    const r = createRegistry();
    r.defineProduct({
      type: 'kit', summary: 'A test product with one part.', params: z.object({}), stages: ['raw'], parts: ['Lid'],
      build: () => ({ root: new THREE.Group(), setStage() {}, refs: {} }),
    });
    expect(() => r.buildProduct('kit')).toThrow(/has parts, so build\(\) must return assembly \{ origin, grip, pose/);
  });

  it('the printer assembly interface agrees with its own parts', () => {
    const product = registry.buildProduct('printer', {}, { materials });
    const asm = product.assembly;
    product.setStage('kitted');
    const part = asm.object('Motor_Z');
    product.root.updateWorldMatrix(true, true);
    const local = product.root.matrixWorld.clone().invert().multiply(part.matrixWorld);
    const expected = asm.pose('Motor_Z', 'kit');
    expect(new THREE.Vector3().setFromMatrixPosition(local).distanceTo(new THREE.Vector3().setFromMatrixPosition(expected))).toBeLessThan(1e-9);
    expect(asm.screws('Motor_Z')).toEqual(['Motor_Z:0', 'Motor_Z:1']);
    product.dispose();
  });
});

describe('installPart', () => {
  it('queues the reference step sequence with the reference labels and times', () => {
    const c = cell();
    c.cycle.expand([install('Motor_Z', { name: 'Z motor', clearAbove: 0.22 })]);
    expect(c.cycle.steps.map((s) => s.label)).toEqual([
      'Gripper clearing up', 'Moving to Z motor', 'Descending to Z motor', 'Gripping Z motor', 'Lifting Z motor',
      'Transferring Z motor', 'Placing Z motor', 'Releasing Z motor',
    ]);
    expect(c.cycle.steps.map((s) => s.duration)).toEqual([0.2, 0.6, 0.35, 0.2, 0.35, 0.8, 0.5, 0.2]);
    expect(c.cycle.steps.every((s) => s.state === 'FRAME_ASSEMBLY')).toBe(true);
  });

  it('carries the part from its kit pose into exactly its assembled pose', () => {
    const c = cell();
    const part = c.product.assembly.object('Motor_Z');
    c.cycle.expand([install('Motor_Z', { clearAbove: 0.22 })]);
    // Grasped: the tool point is at the kit grasp point, the part has not moved.
    part.updateWorldMatrix(true, false);
    const kitPose = part.matrixWorld.clone();
    advanceTo(c, 0.2 + 0.6 + 0.35 + 0.2);
    expectAtPose(part, kitPose, 1e-9);
    const grasp = c.product.assembly.grip('Motor_Z', 'kit').point;
    expect(worldPos(c.robot.anchor('tool')).distanceTo(c.product.root.localToWorld(grasp.clone()))).toBeLessThan(1e-9);
    expect(c.robot.state.grip).toBeCloseTo(0.047, 12);
    expect(c.robot.state.holding).toBe('on');
    // Placed (before release snaps it): already exactly in the assembled pose.
    advanceTo(c, 0.35 + 0.8 + 0.5);
    expectAtPose(part, asmWorld(c, 'Motor_Z'));
    runAll(c);
    expect(c.product.api.printer.parts.Motor_Z.mode).toBe('asm');
    expect(c.robot.state.holding).toBe('off');
    expect(c.robot.state.grip).toBe(0.26);
    expectAtPose(part, asmWorld(c, 'Motor_Z'));
  });

  it('re-orients a part picked lying and installs it upright', () => {
    const c = cell();
    const part = c.product.assembly.object('Upright_L');
    c.cycle.expand([install('Upright_L', { gap: 0.045, clearAbove: 0.53 })]);
    advanceTo(c, 0.2 + 0.6 + 0.35 + 0.2 + 0.35 + 0.8 + 0.5);
    expectAtPose(part, asmWorld(c, 'Upright_L'));
    // the kit pose was lying (swung a quarter turn), so it really turned on the way
    expect(c.product.assembly.pose('Upright_L', 'kit').equals(c.product.assembly.pose('Upright_L', 'asm'))).toBe(false);
  });

  it('threads a part in (turns while placed) and slides parts in along `insert`', () => {
    const lead = cell();
    lead.cycle.expand([install('LeadScrew', { gap: 0.012, clearAbove: 0.62, spinTurns: 5 })]);
    lead.sequencer.advance(0.2 + 0.6 + 0.35 + 0.2 + 0.35 + 0.8 + 0.25);
    const half = worldQuat(lead.product.assembly.object('LeadScrew')).clone();
    lead.sequencer.advance(0.25);
    expectAtPose(lead.product.assembly.object('LeadScrew'), asmWorld(lead, 'LeadScrew'), 1e-5);
    expect(half.angleTo(worldQuat(lead.product.assembly.object('LeadScrew')))).toBeGreaterThan(0.1);

    const slid = cell();
    slid.cycle.expand([install('Motor_Y', { clearAbove: 0.22, insert: [0, 0, 0.08] })]);
    expect(slid.cycle.steps.map((s) => s.label).slice(6, 8)).toEqual(['Lowering Motor_Y', 'Sliding Motor_Y into place']);
    slid.sequencer.advance(0.2 + 0.6 + 0.35 + 0.2 + 0.35 + 0.8 + 0.5);
    // lowered in front of the seat, 8 cm along +Z of the product
    const seat = asmWorld(slid, 'Motor_Y');
    const front = seat.clone().premultiply(new THREE.Matrix4().makeTranslation(...new THREE.Vector3(0, 0, 0.08).applyQuaternion(worldQuat(slid.product.root)).toArray()));
    expectAtPose(slid.product.assembly.object('Motor_Y'), front);
    slid.sequencer.advance(0.5);
    expectAtPose(slid.product.assembly.object('Motor_Y'), seat);
  });

  it('installs the whole ST2 part list in order without leaving the gantry range', () => {
    const c = cell();
    const clearAbove = { Motor_Z: 0.22, Motor_Y: 0.22, Bed: 0.3, Upright_L: 0.53, Upright_R: 0.53, XGantry: 0.56, LeadScrew: 0.62, TopBar: 0.55 };
    const grip = { Bed: 0.24, XGantry: 0.025, TopBar: 0.025, Upright_L: 0.045, Upright_R: 0.045, LeadScrew: 0.012 };
    const parts = Object.keys(clearAbove);
    c.cycle.expand(parts.map((part) => install(part, { clearAbove: clearAbove[part], gap: grip[part] ?? 0.047, spinTurns: part === 'LeadScrew' ? 5 : 0 })));
    runAll(c);
    for (const part of parts) expectAtPose(c.product.assembly.object(part), asmWorld(c, part), 1e-5);
  });

  it('rejects unknown parts and missing tool features, before anything runs', () => {
    expect(() => cell().cycle.expand([install('Wheel')])).toThrow(/op #1 \(installPart\): the product has no part "Wheel"/);
    expect(() => cell().cycle.expand([install('Motor_Z', { gap: 0.5 })])).toThrow(/grip must stay in \[0, 0\.26\], got 0\.5/);
    const bare = new OpCycle({ registry, sequencer: new StepSequencer(), equipment: { gantry: registry.buildComponent('cartesianGantry', {}, { materials }) }, product: { root: new THREE.Group() } });
    expect(() => bare.expand([install('Motor_Z')])).toThrow(/no parts to assemble/);
  });

  it('a seat out of reach stops with a clear message when its step starts', () => {
    const c = cell({ productAt: [3, 0.88, 0] });
    c.cycle.expand([install('Motor_Z')]);
    expect(() => runAll(c)).toThrow(/step "Moving to Motor_Z": machine "gantry" cannot reach x = /);
  });
});

describe('driveScrew', () => {
  it('drives a screw: bit tip exactly on the seat, screw head shown, reference times', () => {
    const c = cell();
    c.cycle.expand([install('Motor_Z', { clearAbove: 0.22 })]);
    runAll(c);
    const before = c.cycle.time;
    c.cycle.expand([{ op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z:0', name: 'Z motor 1' }]);
    expect(c.cycle.steps.slice(-4).map((s) => [s.label, s.duration])).toEqual([
      ['Screw fed · Z motor 1', 0.35], ['Screwdriver down · Z motor 1', 0.18 + 0.12], ['Driving screw · Z motor 1', 0.4], ['Torque OK · Z motor 1', 0.15],
    ]);
    const head = c.product.api.printer.parts.Motor_Z.object.userData.screws[0];
    expect(head.visible).toBe(false);
    c.sequencer.advance(0.1);
    expect(c.robot.state.screw).toBe('fed');
    c.sequencer.advance(0.35 + 0.3 + 0.4 - 0.1);
    const seat = c.product.root.localToWorld(c.product.assembly.screwSeat('Motor_Z:0'));
    expect(worldPos(c.robot.anchor('bit')).distanceTo(seat)).toBeLessThan(1e-9);
    expect(c.robot.state.driver).toBeCloseTo(1, 9);
    expect(c.robot.state.screw).toBe('hidden');
    expect(head.visible).toBe(true);
    // wrist turned round only for screws on the +X side of the gantry (Motor_Z is on the left: not turned)
    expect(c.robot.root.worldToLocal(seat.clone()).x < 0 ? 0 : Math.PI).toBe(c.robot.state.yaw);
    c.sequencer.advance(1);
    expect(c.robot.state.driver).toBe(0);
    expect(c.cycle.time - before).toBeCloseTo(1.2, 12);
  });

  it('turns the wrist round for screws beyond centerX, and the bit still lands on the seat', () => {
    const c = cell();
    c.cycle.expand([install('Motor_Z', { clearAbove: 0.22 }), { op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z:0', centerX: -0.6 }]);
    c.sequencer.advance(3.2 + 0.35 + 0.3 + 0.4 - 1e-6);
    expect(c.robot.state.yaw).toBe(Math.PI);
    const seat = c.product.root.localToWorld(c.product.assembly.screwSeat('Motor_Z:0'));
    expect(worldPos(c.robot.anchor('bit')).distanceTo(seat)).toBeLessThan(1e-5);
  });

  it('never dips while travelling, and rejects bad screws and missing tools', () => {
    const c = cell();
    c.cycle.expand([install('Motor_Z', { clearAbove: 0.22 }), { op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z:1' }]);
    c.sequencer.advance(3.2);
    const startY = c.robot.state.y;
    let lowest = Infinity;
    for (let i = 0; i < 35; i += 1) { c.sequencer.advance(0.01); lowest = Math.min(lowest, c.robot.state.y); }
    expect(lowest).toBeGreaterThanOrEqual(Math.min(startY, c.robot.state.y) - 1e-9);
    expect(() => cell().cycle.expand([{ op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z' }])).toThrow(/a screw id "Part:index"/);
    expect(() => cell().cycle.expand([{ op: 'driveScrew', machine: 'gantry', screw: 'Gear:0' }])).toThrow(/no part "Gear"/);
    expect(() => cell({ gantry: { ...ST2_GANTRY, screwdriver: false } }).cycle.expand([{ op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z:0' }]))
      .toThrow(/no anchor "bit" \(anchors: tool\)/);
  });
});

describe('pickPlace', () => {
  it('moves an item from a machine port onto the product, which then carries it', () => {
    const c = cell();
    const bin = registry.buildComponent('tote', {}, { materials });
    bin.root.position.set(0.5, 1.0, -0.35);
    bin.root.updateMatrix();
    c.root.add(bin.root);
    c.cycle.equipment.bin = bin;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05));
    box.position.copy(new THREE.Vector3(...bin.ports.inside.position).add(new THREE.Vector3(0, 0.025, 0))).applyMatrix4(bin.root.matrix);
    c.root.add(box);
    c.cycle.items = { box };
    c.cycle.expand([{
      op: 'pickPlace', machine: 'gantry', item: 'box', gap: 0.05, openGap: 0.2,
      from: { machine: 'bin', port: 'inside', offset: [0, 0.025, 0] },
      to: { item: 'product', ref: 'trayCentre', offset: [0, 0.06, 0], yaw: 0.4 },
      onto: 'product', timing: PICK_TIMING,
    }]);
    expect(c.cycle.steps).toHaveLength(8);
    runAll(c);
    expect(box.parent).toBe(c.product.root);
    const target = c.product.root.localToWorld(c.product.ref('trayCentre').add(new THREE.Vector3(0, 0.06, 0)));
    expect(worldPos(box).distanceTo(target)).toBeLessThan(1e-9);
    expect(c.cycle.locationOf('box')).toEqual({ on: 'product' });
  });

  it('checks ports, refs and items up front', () => {
    const base = { op: 'pickPlace', machine: 'gantry', item: 'product', gap: 0.05, openGap: 0.2 };
    expect(() => cell().cycle.expand([{ ...base, from: { machine: 'gantry', port: 'x' }, to: { item: 'product', ref: 'trayCentre' } }])).toThrow(/no port "x"/);
    expect(() => cell().cycle.expand([{ ...base, from: { item: 'product', ref: 'lid' }, to: { item: 'product', ref: 'trayCentre' } }])).toThrow(/from: the product has no ref "lid" \(refs: printerOrigin, trayCentre, dockPort\)/);
  });
});

describe('named ops in dry runs', () => {
  const program = [
    { op: 'move', machine: 'gantry', to: { x: 0, y: 1.75, z: 0, yaw: 0 }, seconds: 0.7 },
    install('Motor_Z', { name: 'Z motor', clearAbove: 0.22 }),
    { op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z:0' },
    { op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z:1' },
    install('LeadScrew', { gap: 0.012, clearAbove: 0.62, spinTurns: 5 }),
    { op: 'rotate', machine: 'gantry', motion: 'driverSpin', turns: 2, seconds: 0.3 },
    { op: 'move', machine: 'gantry', to: { x: 0, y: 1.75, z: 0, yaw: 0 }, seconds: 0.7 },
  ];

  it('give the same steps as the twin plays, from the catalog alone', () => {
    const c = cell();
    c.cycle.expand(program);
    const dry = dryRun(registry, program, { equipment: { gantry: { type: 'cartesianGantry', params: ST2_GANTRY } }, product: 'printer', workState: 'FRAME_ASSEMBLY' });
    expect(dry.steps).toEqual(c.cycle.steps);
    expect(dry.duration).toBeCloseTo(0.7 + 3.2 + 1.2 + 1.2 + 3.2 + 0.3 + 0.7, 9);
    runAll(c);
    expectAtPose(c.product.assembly.object('LeadScrew'), asmWorld(c, 'LeadScrew'), 1e-5);
    expect(c.robot.state).toMatchObject({ x: 0, y: 1.75, z: 0, yaw: 0 });
  });

  it('check names without building anything', () => {
    const equipment = { gantry: { type: 'cartesianGantry', params: ST2_GANTRY } };
    expect(() => dryRun(registry, [install('Wheel')], { equipment, product: 'printer' })).toThrow(/no part "Wheel"/);
    expect(() => dryRun(registry, [install('Motor_Z')], { equipment })).toThrow(/no parts to assemble/);
    expect(() => dryRun(registry, [install('Motor_Z')], { equipment, product: 'rocket' })).toThrow(OpError);
    expect(() => dryRun(registry, [{ op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z:0' }], { equipment: { gantry: { type: 'cartesianGantry' } }, product: 'printer' }))
      .toThrow(/no anchor "bit"/);
  });

  it('a relative move right after a named op needs a known start, a speed-based one is planned at its worst case', () => {
    const equipment = { gantry: { type: 'cartesianGantry', params: ST2_GANTRY } };
    expect(() => dryRun(registry, [install('Motor_Z'), { op: 'move', machine: 'gantry', by: { x: 0.1 }, seconds: 1 }], { equipment, product: 'printer' }))
      .toThrow(/needs a known start/);
    const worst = dryRun(registry, [install('Motor_Z'), { op: 'move', machine: 'gantry', to: { x: 0 }, speed: 0.5 }], { equipment, product: 'printer' });
    expect(worst.steps.at(-1).duration).toBeCloseTo(1.5 / 0.5, 12);
  });
});

describe('rotate by whole turns', () => {
  it('uses the motion angle; axes without one are refused', () => {
    const c = cell();
    c.cycle.expand([{ op: 'rotate', machine: 'gantry', motion: 'driverSpin', turns: 1.5, seconds: 0.3 }]);
    expect(c.cycle.planned('gantry', 'driverSpin')).toBeCloseTo(0, 9); // 9 hex flats → same look
    expect(() => cell().cycle.expand([{ op: 'rotate', machine: 'gantry', motion: 'x', turns: 1, seconds: 1 }])).toThrow(/declares no angle/);
  });
});
