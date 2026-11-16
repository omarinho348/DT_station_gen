import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { lerpPose, angleDelta } from '../../lib/core/motion.js';
import { boundsOf } from '../helpers/componentChecks.js';

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

  it('uses the chosen frame colour and rejects a tool range too close to the beam', () => {
    const g = build('cartesianGantry', { frameColor: 'machineBlue' });
    expect(g.root.getObjectByName('Bridge beam').material).toBe(materials.machineBlue);
    expect(() => build('cartesianGantry', { beamY: 1.6, minToolY: 1.2 })).toThrow(/minToolY must be at least 0.6 m below beamY/);
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
