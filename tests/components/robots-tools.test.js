import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { lerpPose, angleDelta } from '../../lib/core/motion.js';
import { boundsOf } from '../helpers/componentChecks.js';
import { scaraReach } from '../../lib/components/robots/scara.js';

const materials = createMaterials();
const build = (type, params = {}) => registry.buildComponent(type, params, { materials });
const world = (o) => o.getWorldPosition(new THREE.Vector3());
const update = (inst) => inst.root.updateMatrixWorld(true);

describe('fingerGripper', () => {
  it('opens to exactly the commanded gap between the finger faces', () => {
    const g = build('fingerGripper');
    for (const gap of [0, 0.05, 0.2]) {
      g.set('grip', gap);
      update(g);
      const faces = ['Finger front', 'Finger rear'].map((n) => boundsOf(g.root.getObjectByName(n).getObjectByName('Finger')));
      expect(faces[0].min.z - faces[1].max.z).toBeCloseTo(gap, 9);
    }
  });

  it('has its tool point (origin) at the fingertips', () => {
    const g = build('fingerGripper');
    const tips = boundsOf(g.root.getObjectByName('Finger front').getObjectByName('Finger'));
    expect(tips.min.y).toBeCloseTo(0, 6);
  });

  it('lights the grip LED while holding', () => {
    const g = build('fingerGripper');
    const led = g.root.getObjectByName('Grip LED').material;
    g.set('holding', 'on');
    expect(led.userData.on).toBe(true);
    g.set('holding', 'off');
    expect(led.userData.on).toBe(false);
  });

  it('declares its grip range from maxGap', () => {
    expect(build('fingerGripper', { maxGap: 0.1 }).motions.grip).toEqual({ range: [0, 0.1], default: 0.1 });
  });
});

describe('screwdriver', () => {
  it('drives the bit 50 mm down and shows the fed screw', () => {
    const s = build('screwdriver');
    const bit = s.root.getObjectByName('Bit');
    const y0 = world(bit).y;
    s.set('driver', 1);
    update(s);
    expect(y0 - world(bit).y).toBeCloseTo(0.05, 9);
    expect(s.root.getObjectByName('Fed screw').visible).toBe(false);
    s.set('screw', 'fed');
    expect(s.root.getObjectByName('Fed screw').visible).toBe(true);
  });

  it('spins the bit through one hex flat (60°) over the spin range', () => {
    const s = build('screwdriver');
    s.set('driverSpin', 1);
    expect(s.root.getObjectByName('Bit').rotation.y).toBeCloseTo(Math.PI / 3, 9);
  });
});

describe('cartesianGantry', () => {
  const toolPoint = (g) => {
    update(g);
    return world(g.root.getObjectByName('Tool'));
  };

  it('puts the tool point exactly where x, y, z say, at any wrist angle', () => {
    const g = build('cartesianGantry');
    for (const [x, y, z, yaw] of [[0, 1.6, 0, 0], [0.6, 0.85, -0.4, 1.2], [-0.6, 2.3, 0.4, -3]]) {
      g.set('x', x);
      g.set('y', y);
      g.set('z', z);
      g.set('yaw', yaw);
      expect(toolPoint(g).distanceTo(new THREE.Vector3(x, y, z))).toBeLessThan(1e-9);
    }
  });

  it('keeps the ram in the carriage at the lowest tool point', () => {
    const g = build('cartesianGantry', { minToolY: 0.5 });
    g.set('y', 0.5);
    update(g);
    const ram = boundsOf(g.root.getObjectByName('Ram'));
    const carriage = boundsOf(g.root.getObjectByName('Carriage'));
    expect(ram.max.y).toBeGreaterThan(carriage.min.y);
  });

  it('derives its travel ranges from the frame size', () => {
    const m = build('cartesianGantry', { spanX: 2, spanZ: 1, beamY: 2.8, minToolY: 1 }).motions;
    expect(m.x.range).toEqual([-1, 1]);
    expect(m.z.range).toEqual([-0.5, 0.5]);
    expect(m.y.range[0]).toBe(1);
    expect(m.y.range[1]).toBeCloseTo(2.7, 9);
    expect(m.y.default).toBeCloseTo(2.0, 9);
  });

  it('only has screwdriver motions when it carries one', () => {
    expect(Object.keys(build('cartesianGantry').motions)).not.toContain('driver');
    const s = build('cartesianGantry', { screwdriver: true });
    expect(Object.keys(s.motions)).toEqual(expect.arrayContaining(['driver', 'driverSpin', 'screw']));
  });

  it('turns the screwdriver around the tool point with the wrist', () => {
    const g = build('cartesianGantry', { screwdriver: true });
    g.set('yaw', Math.PI);
    const bit = world(g.root.getObjectByName('Bit'));
    const tool = toolPoint(g);
    expect(bit.x - tool.x).toBeCloseTo(-0.13, 9); // offset 0.13 m along +X turned to −X
    expect(bit.z - tool.z).toBeCloseTo(0, 9);
  });

  it('builds the reference ST2 gantry and reaches its home pose', () => {
    // FrameAssemblyDefinition: x ±0.75, z ±0.45, beamY 2.3, maxGap 0.26, screwdriver; home (0, 1.75, 0).
    const g = build('cartesianGantry', { spanX: 1.5, spanZ: 0.9, beamY: 2.3, maxGap: 0.26, screwdriver: true });
    expect(g.motions.x.range).toEqual([-0.75, 0.75]);
    expect(g.motions.z.range).toEqual([-0.45, 0.45]);
    g.set('y', 1.75);
    expect(toolPoint(g).distanceTo(new THREE.Vector3(0, 1.75, 0))).toBeLessThan(1e-9);
  });

  it('builds the reference ST3 gantry (blue, 0.22 m gripper, screwdriver) and reaches its home pose', () => {
    const g = build('cartesianGantry', { spanX: 1.5, spanZ: 0.9, beamY: 2.3, maxGap: 0.22, frameColor: 'machineBlue', screwdriver: true });
    expect(g.motions.grip.range).toEqual([0, 0.22]);
    g.set('y', 1.75);
    expect(toolPoint(g).distanceTo(new THREE.Vector3(0, 1.75, 0))).toBeLessThan(1e-9);
  });

  it('uses the chosen frame colour and rejects a tool range too close to the beam', () => {
    const g = build('cartesianGantry', { frameColor: 'machineBlue' });
    expect(g.root.getObjectByName('Bridge beam').material).toBe(materials.machineBlue);
    expect(() => build('cartesianGantry', { beamY: 1.6, minToolY: 1.2 })).toThrow(/minToolY must be at least 0.6 m below beamY/);
  });
});

describe('scara', () => {
  const toolPoint = (r) => {
    update(r);
    return world(r.root.getObjectByName('Tool'));
  };
  const pose = (r, { x, y, z, yaw = 0 }) => {
    r.set('x', x);
    r.set('z', z);
    if (y !== undefined) r.set('y', y);
    r.set('yaw', yaw);
  };
  const toolHeading = (r) => {
    update(r);
    const dir = new THREE.Vector3(1, 0, 0).transformDirection(r.root.getObjectByName('Tool').matrixWorld);
    return Math.atan2(-dir.z, dir.x);
  };

  it('puts the tool point exactly where x, y, z say, anywhere in its reach', () => {
    const r = build('scara');
    const { y } = r.motions;
    for (const [x, ty, z, yaw] of [[0.8, y.default, 0, 0], [0.3, y.range[0], -0.5, 1.2], [-0.7, y.range[1], 0.4, -3], [0, 1.0, 1.0, 2]]) {
      pose(r, { x, y: ty, z, yaw });
      expect(toolPoint(r).distanceTo(new THREE.Vector3(x, ty, z))).toBeLessThan(1e-9);
    }
  });

  it('holds the commanded tool heading whatever the arm pose', () => {
    const r = build('scara');
    for (const [x, z, yaw] of [[0.8, 0, 0], [0, -0.9, 0.7], [-0.5, 0.5, -2.5], [0.4, 0.4, Math.PI]]) {
      pose(r, { x, z, yaw });
      expect(angleDelta(toolHeading(r), yaw)).toBeCloseTo(0, 9);
    }
  });

  it('clamps an out-of-reach target to the nearest point on the same heading', () => {
    const r = build('scara');
    const { min, max } = scaraReach(r.params);
    pose(r, { x: 1.0, z: -1.0 }); // corner of the motion square, beyond reach
    let p = toolPoint(r);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(max, 6);
    expect(Math.atan2(-p.z, p.x)).toBeCloseTo(Math.PI / 4, 9);
    pose(r, { x: 0, z: 0.05 }); // inside the column
    p = toolPoint(r);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(min, 6);
    expect(Math.atan2(-p.z, p.x)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('keeps the tool clear of the column at its inner reach, and folds right-handed', () => {
    const r = build('scara');
    const { min } = scaraReach(r.params);
    expect(min).toBeGreaterThan(0.12 + 0.05); // column radius + clearance
    pose(r, { x: min, z: 0, y: r.motions.y.range[0] });
    update(r);
    const gripper = boundsOf(r.root.getObjectByName('Gripper'));
    expect(gripper.min.x).toBeGreaterThan(0.12); // column radius
    expect(r.root.getObjectByName('J2').rotation.y).toBeGreaterThan(0);
    expect(r.root.getObjectByName('J2').rotation.y).toBeLessThan((150 * Math.PI) / 180); // J2 fold limit
  });

  it('keeps the spline in the quill head over the whole stroke', () => {
    for (const params of [{}, { stroke: 0.15 }, { stroke: 0.5, armHeight: 2 }]) {
      const r = build('scara', params);
      for (const y of r.motions.y.range) {
        r.set('y', y);
        update(r);
        const spline = boundsOf(r.root.getObjectByName('Ball screw spline'));
        const head = boundsOf(r.root.getObjectByName('Quill head'));
        expect(spline.max.y).toBeGreaterThan(head.min.y);
        expect(spline.min.y).toBeLessThanOrEqual(head.min.y + 1e-6); // flange never enters the head
      }
    }
  });

  it('derives its ranges from the links, arm height and stroke (reference default inside)', () => {
    const m = build('scara').motions;
    expect(m.x.range[1]).toBeCloseTo(1.05, 3);
    expect(m.x.default).toBeCloseTo(0.8, 9); // reference start pose
    expect(m.y.range[1] - m.y.range[0]).toBeCloseTo(0.4, 9);
    expect(m.y.range[0]).toBeLessThanOrEqual(1.1); // reference start height
    expect(m.y.range[1]).toBeGreaterThanOrEqual(1.1);
    // Reference ST1 robot: armHeight 1.3, home y 1.12.
    const st1 = build('scara', { armHeight: 1.3 }).motions.y;
    expect(st1.range[1]).toBeGreaterThanOrEqual(1.12 - 1e-9);
    const tall = build('scara', { armHeight: 1.8, stroke: 0.2 }).motions.y;
    expect(tall.range[0]).toBeCloseTo(m.y.range[0] + 0.35 + 0.2, 9); // higher arm, shorter quill
  });

  it('carries the screwdriver with the same motions as the gantry', () => {
    expect(Object.keys(build('scara').motions)).not.toContain('driver');
    const r = build('scara', { screwdriver: true });
    expect(Object.keys(r.motions)).toEqual(expect.arrayContaining(['driver', 'driverSpin', 'screw']));
    pose(r, { x: 0, z: -0.8, yaw: Math.PI / 2 });
    update(r);
    const bit = world(r.root.getObjectByName('Bit'));
    const tool = toolPoint(r);
    expect(bit.z - tool.z).toBeCloseTo(-0.13, 9); // +X offset turned to −Z by yaw π/2
    expect(bit.x - tool.x).toBeCloseTo(0, 9);
  });
});

describe('pose interpolation', () => {
  it('turns the short way round', () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
    const mid = lerpPose({ x: 0, y: 0, z: 0, yaw: 3 }, { x: 1, y: 2, z: -2, yaw: -3 }, 0.5);
    expect(mid).toMatchObject({ x: 0.5, y: 1, z: -1 });
    expect(Math.abs(mid.yaw)).toBeGreaterThan(3); // passes through ±π, not through 0
  });
});
