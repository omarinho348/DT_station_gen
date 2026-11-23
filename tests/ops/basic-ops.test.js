import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { z } from 'zod';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { OpCycle, OpError, UNKNOWN, dryRun, wrapDelta, wrapValue } from '../../lib/ops/index.js';
import { createRegistry, RegistryError } from '../../lib/registry.js';
import { StepSequencer } from '../../lib/core/StepSequencer.js';
import { createMaterials } from '../../lib/core/materials.js';
import { smoother, trapezoidDuration, trapezoidTravel } from '../../lib/core/motion.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';

await preloadComponentAssets(registry); // every component is built below, the ABB model included

const BASIC = ['move', 'rotate', 'grip', 'release', 'toolOn', 'transform', 'transfer', 'wait', 'decide'];
const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };

/** A small test cell: a gantry over a pallet conveyor (moved off the origin), a carrier and a part. */
function cycle({ product = null, facts = {} } = {}) {
  const root = new THREE.Group();
  root.position.set(5, 0, -2); // nothing may depend on world coordinates
  root.rotation.y = 0.3;
  const robot = registry.buildComponent('cartesianGantry', { screwdriver: true }, { materials });
  const line = registry.buildComponent('palletConveyor', {}, { materials });
  line.root.position.set(0.4, 0, 0.1);
  root.add(robot.root, line.root);
  const carrier = new THREE.Group(); // origin at its underside, like every product
  carrier.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3)));
  root.add(carrier);
  const part = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06));
  part.position.set(0.3, 1.0, -0.2);
  root.add(part);
  const sequencer = new StepSequencer();
  const cycle = new OpCycle({
    registry, sequencer, equipment: { robot, line }, product: product ?? { root: carrier }, items: { part }, facts, workState: 'ASSEMBLING',
  });
  return { root, robot, line, carrier, part, sequencer, cycle };
}

const runAll = (c) => c.sequencer.advance(c.cycle.time + 1);

describe('basic ops: registry', () => {
  it('defines the nine basic ops, each with args and a summary', () => {
    const ops = registry.ops().map((d) => d.op);
    for (const op of BASIC) expect(ops).toContain(op);
    for (const op of BASIC) expect(registry.getOp(op).summary.length).toBeGreaterThan(20);
  });

  it('periodic helpers wrap and take the short way', () => {
    close(wrapValue(1.25, [0, 1]), 0.25);
    close(wrapValue(-0.25, [0, 1]), 0.75);
    expect(wrapValue(1, [0, 1])).toBe(1); // in-range values stay exact
    close(wrapDelta(3, -3, [-Math.PI, Math.PI]), 2 * Math.PI - 6);
    close(wrapDelta(0.9, 0.1, [0, 1]), 0.2);
  });
});

describe('move and rotate', () => {
  it('moves several axes together with the quintic ease and ends exactly on target', () => {
    const c = cycle();
    const from = { ...c.robot.state };
    c.cycle.expand([{ op: 'move', machine: 'robot', to: { x: 0.4, z: -0.2 }, seconds: 1.2 }]);
    expect(c.cycle.steps).toEqual([{ state: 'ASSEMBLING', label: 'Moving robot', duration: 1.2 }]);
    c.sequencer.advance(0.3);
    close(c.robot.state.x, from.x + 0.4 * smoother(0.25));
    close(c.robot.state.z, from.z - 0.2 * smoother(0.25));
    runAll(c);
    expect(c.robot.state.x).toBe(0.4);
    expect(c.robot.state.z).toBe(-0.2);
    expect(c.robot.state.y).toBe(from.y);
  });

  it('takes its duration from a speed, and a trapezoid adds the ramp', () => {
    const c = cycle();
    const y0 = c.robot.state.y;
    c.cycle.expand([
      { op: 'move', machine: 'robot', to: { x: 0.5, z: 0.2 }, speed: 0.25 },
      { op: 'move', machine: 'robot', to: { x: -0.5 }, speed: 0.5, profile: 'trapezoid', ramp: 0.4 },
      { op: 'move', machine: 'robot', to: { y: y0 - 0.3 }, speed: 0.6, profile: 'linear' },
    ]);
    const durations = c.cycle.steps.map((s) => s.duration);
    [2, 1 / 0.5 + 0.4, 0.5].forEach((d, i) => close(durations[i], d, 1e-12));
    c.sequencer.advance(2 + 0.7);
    close(c.robot.state.x, 0.5 - trapezoidTravel(0.7, 1, 0.5, 0.4));
    c.sequencer.advance(2.4 - 0.7 + 0.25);
    close(c.robot.state.y, y0 - 0.15);
  });

  it('turns a periodic axis the short way round', () => {
    const c = cycle();
    c.cycle.expand([
      { op: 'rotate', machine: 'robot', motion: 'yaw', to: 3, seconds: 0.5 },
      { op: 'rotate', machine: 'robot', motion: 'yaw', to: -3, speed: 1 },
    ]);
    close(c.cycle.steps[1].duration, 2 * Math.PI - 6); // through ±π, not through 0
    c.sequencer.advance(0.5 + c.cycle.steps[1].duration / 2);
    expect(Math.abs(c.robot.state.yaw)).toBeGreaterThan(3);
    runAll(c);
    expect(c.robot.state.yaw).toBe(-3);
  });

  it('rotates by many turns on a periodic axis and wraps', () => {
    const c = cycle();
    c.cycle.expand([{ op: 'rotate', machine: 'robot', motion: 'driverSpin', by: 6.25, seconds: 0.4 }]);
    expect(c.cycle.planned('robot', 'driverSpin')).toBeCloseTo(0.25, 9);
    c.sequencer.advance(0.2);
    expect(c.robot.state.driverSpin).toBeGreaterThanOrEqual(0);
    expect(c.robot.state.driverSpin).toBeLessThanOrEqual(1);
    runAll(c);
    close(c.robot.state.driverSpin, 0.25);
  });

  it('a move combines absolute and relative targets in one step (bit runs down while it turns)', () => {
    const c = cycle();
    c.cycle.expand([{ op: 'move', machine: 'robot', to: { driver: 1 }, by: { driverSpin: 8 }, seconds: 0.4 }]);
    c.sequencer.advance(0.2);
    close(c.robot.state.driver, 0.5);
    runAll(c);
    expect(c.robot.state.driver).toBe(1);
  });

  it('rejects bad moves with a clear, located message', () => {
    const bad = (ops, pattern) => expect(() => cycle().cycle.expand(ops)).toThrow(pattern);
    bad([{ op: 'move', machine: 'crane', to: { x: 0 }, seconds: 1 }], /op #1 \(move\): unknown machine "crane" \(machines: robot, line\)/);
    bad([{ op: 'wait', seconds: 1 }, { op: 'move', machine: 'robot', to: { q: 0 }, seconds: 1 }], /op #2 \(move\): machine "robot" has no motion "q"/);
    bad([{ op: 'move', machine: 'robot', to: { x: 9 }, seconds: 1 }], /robot"\.x must stay in \[-0\.6, 0\.6\], got 9/);
    bad([{ op: 'move', machine: 'robot', to: { holding: 1 }, seconds: 1 }], /is a switch \(off \| on\); use toolOn/);
    bad([{ op: 'move', machine: 'robot', to: { x: 0 }, seconds: 1, speed: 2 }], /give either seconds or speed/);
    bad([{ op: 'move', machine: 'robot', to: { x: 0 }, seconds: 1, profile: 'trapezoid' }], /trapezoid profile needs a speed/);
    bad([{ op: 'move', machine: 'robot', seconds: 1 }], /nothing to move/);
    bad([{ op: 'move', machine: 'robot', by: { x: 0.5 }, seconds: 1 }, { op: 'move', machine: 'robot', by: { x: 0.5 }, seconds: 1 }], /op #2.*must stay in/);
    bad([{ op: 'rotate', machine: 'robot', motion: 'yaw', seconds: 1 }], /give one of to, by or turns/);
    bad([{ op: 'weld', machine: 'robot' }], /op #1 \(weld\): unknown op "weld" \(ops: .*move/);
    bad([{ machine: 'robot' }], /missing "op"/);
    expect(() => cycle().cycle.expand([{ op: 'wait', seconds: -1 }])).toThrow(OpError);
  });
});

describe('grip and release', () => {
  it('carries an item exactly with the tool point and leaves it where it was put', () => {
    const c = cycle();
    const at = c.part.position;
    c.cycle.expand([
      { op: 'move', machine: 'robot', to: { x: at.x, y: at.y, z: at.z }, seconds: 1 },
      { op: 'grip', machine: 'robot', item: 'part', to: 0.06 },
      { op: 'move', machine: 'robot', to: { x: -0.4, y: 1.5, z: 0.3, yaw: 1.2 }, seconds: 1.5 },
    ]);
    c.sequencer.advance(1.3);
    expect(c.robot.state.grip).toBe(0.06);
    expect(c.robot.state.holding).toBe('on');
    const tool = c.robot.anchor('tool');
    for (let i = 0; i < 3; i += 1) {
      c.sequencer.advance(0.4);
      expect(worldOf(c.part).distanceTo(worldOf(tool))).toBeLessThan(1e-9);
    }
    // the part turns with the wrist
    const turned = new THREE.Quaternion();
    c.part.getWorldQuaternion(turned);
    const toolTurn = new THREE.Quaternion();
    tool.getWorldQuaternion(toolTurn);
    expect(turned.angleTo(toolTurn)).toBeLessThan(1e-6);

    runAll(c);
    const placed = worldOf(c.part).clone();
    c.cycle.expand([
      { op: 'release', machine: 'robot', to: 0.2 },
      { op: 'move', machine: 'robot', to: { x: 0.5, y: 1.7 }, seconds: 1 },
    ]);
    runAll(c);
    expect(c.robot.state.holding).toBe('off');
    expect(c.robot.state.grip).toBe(0.2);
    expect(worldOf(c.part).distanceTo(placed)).toBeLessThan(1e-9);
  });

  it('a locating plate is a grip too: the carrier rises onto the pins and comes back down', () => {
    const c = cycle();
    c.carrier.position.set(0.4, 0.85, 0.1); // on the belt at the work port
    c.cycle.expand([
      { op: 'grip', machine: 'line', item: 'product', motion: 'locate', to: 1, anchor: 'carrier', seconds: 0.4 },
    ]);
    runAll(c);
    close(c.carrier.position.y, 0.88);
    c.cycle.expand([{ op: 'release', machine: 'line', item: 'product', motion: 'locate', to: 0, seconds: 0.35 }]);
    runAll(c);
    close(c.carrier.position.y, 0.85);
  });

  it('a part released onto the carrier travels with it', () => {
    const c = cycle();
    c.carrier.position.set(0.4 - 1.6, 0.85, 0.1); // at the input port
    c.cycle.locate('product', { machine: 'line', port: 'input' });
    const at = c.part.position;
    c.cycle.expand([
      { op: 'move', machine: 'robot', to: { x: at.x, y: at.y, z: at.z }, seconds: 1 },
      { op: 'grip', machine: 'robot', item: 'part', to: 0.06 },
      { op: 'release', machine: 'robot', item: 'part', to: 0.2, onto: 'product' },
      { op: 'transfer', conveyor: 'line', to: 'output' },
    ]);
    runAll(c);
    expect(c.part.parent).toBe(c.carrier);
    const offset = worldOf(c.part).sub(worldOf(c.carrier));
    expect(offset.length()).toBeGreaterThan(0.1);
    expect(worldOf(c.carrier).distanceTo(c.line.root.localToWorld(new THREE.Vector3(1.6, 0.85, 0)))).toBeLessThan(1e-9);
    expect(() => cycle().cycle.expand([{ op: 'release', machine: 'robot', to: 0.2, onto: 'product' }])).toThrow(/"onto" needs the "item"/);
  });

  it('rejects unknown items and anchors', () => {
    expect(() => cycle().cycle.expand([{ op: 'grip', machine: 'robot', item: 'bolt', to: 0.05 }])).toThrow(/unknown item "bolt"/);
    expect(() => cycle().cycle.expand([{ op: 'grip', machine: 'line', item: 'part', motion: 'locate', to: 1 }])).toThrow(/no anchor "tool" \(anchors: carrier\)/);
  });
});

describe('toolOn, wait, transform', () => {
  it('switches a value for a time, then another', () => {
    const c = cycle();
    c.cycle.expand([
      { op: 'toolOn', machine: 'robot', motion: 'screw', value: 'fed', then: 'hidden', seconds: 0.5 },
      { op: 'wait', seconds: 2, label: 'Curing' },
    ]);
    expect(c.cycle.steps.map((s) => [s.label, s.duration])).toEqual([['robot screw fed', 0.5], ['Curing', 2]]);
    expect(c.cycle.planned('robot', 'screw')).toBe('hidden');
    c.sequencer.advance(0.25);
    expect(c.robot.state.screw).toBe('fed');
    c.sequencer.advance(0.5);
    expect(c.robot.state.screw).toBe('hidden');
    expect(() => cycle().cycle.expand([{ op: 'toolOn', machine: 'robot', motion: 'screw', value: 'on' }])).toThrow(/takes hidden \| fed, got "on"/);
  });

  it('changes the product stage at the end (or start) of its step', () => {
    const product = registry.buildProduct('printer', { serial: 3 }, { materials });
    const c = cycle({ product });
    c.cycle.expand([
      { op: 'transform', stage: 'framed', seconds: 1 },
      { op: 'transform', stage: 'wired', at: 'start', seconds: 1 },
    ]);
    c.sequencer.advance(0.5);
    expect(product.stage).toBe(product.stages[0]);
    c.sequencer.advance(0.75);
    expect(product.stage).toBe('wired');
    expect(() => cycle({ product }).cycle.expand([{ op: 'transform', stage: 'melted' }])).toThrow(/no stage "melted"/);
    expect(() => cycle().cycle.expand([{ op: 'transform', item: 'part', stage: 'x' }])).toThrow(/not a product with stages/);
    product.dispose();
  });
});

describe('transfer', () => {
  it('conveys the product between ports with the line trapezoid, belts scrolling with it', () => {
    const c = cycle();
    const len = c.line.params.length;
    c.cycle.locate('product', { machine: 'line', port: 'input' });
    c.cycle.expand([{ op: 'transfer', conveyor: 'line', to: 'work' }]);
    expect(c.cycle.steps[0].duration).toBe(trapezoidDuration((len - c.line.params.carrierLength) / 2, 0.45, 0.35));
    expect(c.cycle.planned('line', 'belt')).toBeCloseTo(wrapValue(((len - c.line.params.carrierLength) / 2) / 0.5, [0, 1]), 9);
    c.sequencer.advance(1);
    const workWorld = c.line.root.localToWorld(new THREE.Vector3(0, 0.85, 0));
    expect(worldOf(c.carrier).distanceTo(workWorld)).toBeGreaterThan(0.1);
    runAll(c);
    expect(worldOf(c.carrier).distanceTo(workWorld)).toBeLessThan(1e-9);
    close(c.line.state.belt, wrapValue(((len - c.line.params.carrierLength) / 2) / 0.5, [0, 1]), 1e-9);
    // where it is now is known: the next transfer needs no "from"
    c.cycle.expand([{ op: 'transfer', conveyor: 'line', to: 'output' }]);
    runAll(c);
    expect(worldOf(c.carrier).distanceTo(c.line.root.localToWorld(new THREE.Vector3((len - c.line.params.carrierLength) / 2, 0.85, 0)))).toBeLessThan(1e-9);
  });

  it('needs to know where the item starts', () => {
    expect(() => cycle().cycle.expand([{ op: 'transfer', conveyor: 'line', to: 'work' }])).toThrow(/where is "product"\?.*give "from"/);
    expect(() => cycle().cycle.expand([{ op: 'transfer', conveyor: 'line', from: 'input', to: 'dock' }])).toThrow(/no port "dock" \(ports: input, work, output\)/);
  });
});

describe('decide', () => {
  const ops = [{
    op: 'decide', on: 'quality',
    cases: {
      pass: [{ op: 'move', machine: 'robot', to: { x: 0.5 }, seconds: 1 }],
      fail: [{ op: 'move', machine: 'robot', to: { x: -0.5 }, seconds: 2 }, { op: 'wait', seconds: 1 }],
    },
  }];

  it('plays the branch matching the fact', () => {
    const pass = cycle({ facts: { quality: () => 'pass' } });
    pass.cycle.expand(ops);
    expect(pass.cycle.time).toBe(1);
    runAll(pass);
    expect(pass.robot.state.x).toBe(0.5);
    const fail = cycle({ facts: { quality: 'fail' } });
    fail.cycle.expand(ops);
    expect(fail.cycle.time).toBe(3);
  });

  it('checks every branch, whatever the fact', () => {
    const broken = [{ op: 'decide', on: 'quality', cases: { pass: [{ op: 'wait', seconds: 1 }], fail: [{ op: 'move', machine: 'robot', to: { x: 7 }, seconds: 1 }] } }];
    expect(() => cycle({ facts: { quality: 'pass' } }).cycle.expand(broken)).toThrow(/op #1 \(decide\) › case "fail" › op #1 \(move\): .*must stay in/);
    expect(() => cycle({ facts: { quality: 'meh' } }).cycle.expand(ops)).toThrow(/no case for quality = "meh"/);
    expect(() => cycle().cycle.expand(ops)).toThrow(/unknown fact "quality"/);
    const withOtherwise = [{ ...ops[0], otherwise: [{ op: 'wait', seconds: 4 }] }];
    const c = cycle({ facts: { quality: 'meh' } });
    c.cycle.expand(withOtherwise);
    expect(c.cycle.time).toBe(4);
  });

  it('dry runs take the longest branch; disagreeing motions become UNKNOWN (worst case after)', () => {
    const { duration, steps, cycle: dry } = dryRun(registry, [
      ...ops,
      { op: 'move', machine: 'robot', to: { x: 0 }, speed: 0.5 },
    ], { equipment: { robot: { type: 'cartesianGantry', params: { screwdriver: true } } } });
    expect(steps[0].branches).toEqual({ pass: 1, fail: 3 });
    expect(dry.planned('robot', 'x')).toBe(0);
    expect(steps[1].duration).toBe(1.2 / 0.5); // from UNKNOWN: the whole x range
    expect(duration).toBe(3 + 2.4);
    const agree = dryRun(registry, [{ op: 'decide', on: 'q', cases: { a: [{ op: 'move', machine: 'robot', to: { x: 0.1 }, seconds: 1 }], b: [{ op: 'move', machine: 'robot', to: { x: 0.1 }, seconds: 2 }] } }],
      { equipment: { robot: { type: 'cartesianGantry' } } });
    expect(agree.cycle.planned('robot', 'x')).toBe(0.1);
    const unknown = dryRun(registry, [{ op: 'decide', on: 'q', cases: { a: [{ op: 'move', machine: 'robot', to: { x: 0.1 }, seconds: 1 }], b: [{ op: 'wait', seconds: 1 }] } }],
      { equipment: { robot: { type: 'cartesianGantry' } } });
    expect(unknown.cycle.planned('robot', 'x')).toBe(UNKNOWN);
  });
});

describe('dry runs', () => {
  const program = [
    { op: 'transfer', conveyor: 'line', from: 'input', to: 'work' },
    { op: 'grip', machine: 'line', item: 'product', motion: 'locate', to: 1, anchor: 'carrier', seconds: 0.4 },
    { op: 'move', machine: 'robot', to: { x: 0.3, y: 1.0, z: -0.2 }, speed: 0.8 },
    { op: 'grip', machine: 'robot', item: 'part', to: 0.06 },
    { op: 'move', machine: 'robot', by: { y: 0.4 }, seconds: 0.5 },
    { op: 'rotate', machine: 'robot', motion: 'yaw', to: 3, speed: 2 },
    { op: 'move', machine: 'robot', to: { x: 0.4, y: 1.0, z: 0.1, yaw: -3 }, speed: 0.8, profile: 'trapezoid' },
    { op: 'release', machine: 'robot', to: 0.2 },
    { op: 'toolOn', machine: 'robot', motion: 'screw', value: 'fed', then: 'hidden', seconds: 0.3 },
    { op: 'release', machine: 'line', item: 'product', motion: 'locate', to: 0, seconds: 0.35 },
    { op: 'transfer', conveyor: 'line', to: 'output' },
  ];

  it('give exactly the steps and durations the twin plays', () => {
    const c = cycle();
    c.cycle.expand(program);
    const dry = dryRun(registry, program, {
      equipment: { robot: { type: 'cartesianGantry', params: { screwdriver: true } }, line: { type: 'palletConveyor' } },
      items: ['part'],
      workState: 'ASSEMBLING',
    });
    expect(dry.steps).toEqual(c.cycle.steps);
    expect(dry.duration).toBeCloseTo(c.cycle.time, 12);
    runAll(c);
    expect(c.sequencer.active).toBe(null);
    expect(c.sequencer.steps).toEqual([]);
  });

  it('build no geometry and still check names', () => {
    expect(() => dryRun(registry, program, { equipment: { robot: { type: 'cartesianGantry' }, line: { type: 'palletConveyor' } }, items: ['part'] }))
      .toThrow(/op #9 \(toolOn\): machine "robot" has no motion "screw"/);
    expect(() => dryRun(registry, program, { equipment: { robot: { type: 'cartesianGantry', params: { screwdriver: true } }, line: { type: 'palletConveyor' } }, items: [] }))
      .toThrow(/op #4 \(grip\): unknown item "part"/);
  });
});

describe('registry: anchors, periodic motions, specs', () => {
  const def = (extra = {}) => ({
    type: 'slide', category: 'machine', summary: 'A test slide with a carriage anchor.',
    params: z.object({ withPlate: z.boolean().default(true) }),
    footprint: () => ({ x: [-1, 1], z: [-1, 1], height: 1 }),
    mount: 'floor',
    motions: { x: { range: [0, 1] }, phase: { range: [0, 1], wrap: true, travel: 0.3 } },
    anchors: (p) => (p.withPlate ? ['plate'] : []),
    build({ params }) {
      const root = new THREE.Group();
      const plate = new THREE.Group();
      root.add(plate);
      return { root, motions: { x: (v) => { plate.position.x = v; }, phase: () => {} }, anchors: params.withPlate ? { plate } : {} };
    },
    ...extra,
  });

  it('declares anchors per params and hands them out', () => {
    const r = createRegistry();
    r.defineComponent(def());
    const inst = r.buildComponent('slide');
    expect(inst.anchors).toEqual(['plate']);
    expect(inst.anchor('plate').isObject3D).toBe(true);
    expect(() => inst.anchor('arm')).toThrow(/has no anchor "arm"/);
    expect(r.buildComponent('slide', { withPlate: false }).anchors).toEqual([]);
  });

  it('rejects anchors that build() does not provide (or provides undeclared)', () => {
    const r = createRegistry();
    r.defineComponent(def({ anchors: ['plate', 'arm'] }));
    expect(() => r.buildComponent('slide')).toThrow(/anchors mismatch \(missing: arm/);
    const r2 = createRegistry();
    r2.defineComponent(def({ anchors: [] }));
    expect(() => r2.buildComponent('slide')).toThrow(/undeclared: plate/);
  });

  it('accepts wrap and travel on range motions only, travel positive', () => {
    const r = createRegistry();
    expect(() => r.defineComponent(def({ motions: { x: { range: [0, 1], travel: -1 } } }))).toThrow(RegistryError);
    expect(() => r.defineComponent(def({ type: 'slideB', motions: { s: { values: ['a', 'b'], wrap: true } } }))).toThrow(RegistryError);
  });

  it('componentSpec gives the same motions, ports and anchors as a built instance', () => {
    for (const d of registry.components()) {
      const spec = registry.componentSpec(d.type);
      const inst = registry.buildComponent(d.type, {}, { materials });
      expect(spec.motions).toEqual(inst.motions);
      expect(spec.ports).toEqual(inst.ports);
      expect(spec.anchors).toEqual(inst.anchors);
      inst.dispose();
    }
  });

  it('robot tool anchors sit exactly at the commanded tool point', () => {
    for (const type of ['cartesianGantry', 'scara']) {
      const robot = registry.buildComponent(type, {}, { materials });
      const target = type === 'scara' ? { x: 0.5, y: 1.0, z: 0.4 } : { x: 0.3, y: 1.2, z: -0.25 };
      for (const [k, v] of Object.entries(target)) robot.set(k, v);
      robot.set('yaw', 0.7);
      expect(worldOf(robot.anchor('tool')).distanceTo(new THREE.Vector3(target.x, target.y, target.z))).toBeLessThan(1e-9);
      robot.dispose();
    }
  });
});


describe('ops demo scenes (#/twin?demo=ops&scene=…)', () => {
  it('every scene dry-runs and plays two full units headless, without errors', async () => {
    const { createDemo, sceneNames, sceneTiming } = await import('../../app/dev/opsDemo.js');
    const { default: basic } = await import('../../app/dev/ops-scenes/basic.json');
    expect(sceneNames()).toEqual(expect.arrayContaining(['basic', 'assembly']));
    expect(sceneTiming(basic).steps.length).toBe(basic.process.length);
    for (const name of sceneNames()) {
      const demo = createDemo({ scene: name });
      expect(demo.timing.duration).toBeGreaterThan(5);
      expect(() => demo.skip(demo.timing.duration * 2 + 1)).not.toThrow();
      demo.dispose();
    }
  });
});
