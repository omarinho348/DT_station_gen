// Basic axes and tools (lib/basics/axes, lib/basics/tools; Phase 6 step 2): the mounting
// conventions composites (step 4) will rely on, and what each motion does.
//   axes:  origin = mounting face; standing ones rise from it, hung ones hang below; mount points Y up
//   tools: origin = tool point; mounting face on top, at the footprint height
import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';

const materials = createMaterials();
afterAll(() => disposeMaterials(materials));
const build = (type, params = {}) => registry.buildComponent(type, params, { materials });
const at = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const up = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3(0, 1, 0).transformDirection(o.matrixWorld); };
const xDir = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3(1, 0, 0).transformDirection(o.matrixWorld); };
const bounds = (inst) => {
  const b = new THREE.Box3();
  inst.root.updateMatrixWorld(true);
  inst.root.traverse((o) => { if (o.isMesh && o.visible) b.expandByObject(o); });
  return b;
};
const near = (v, arr, d = 1e-9) => expect(v.distanceTo(new THREE.Vector3(...arr))).toBeLessThan(d);

describe('basic axes', () => {
  it('are registered as axes', () => {
    expect(registry.components().filter((d) => d.category === 'axis').map((d) => d.type).sort())
      .toEqual(['linearAxis', 'rotaryAxis', 'verticalAxis']);
  });

  it('linear axis: the carriage mount rides on top and follows `travel`; hung, it rides underneath, still Y up, motor still on +X', () => {
    const standing = build('linearAxis', { stroke: 0.8, section: 0.08 });
    near(at(standing.anchor('carriage')), [0, 0.12, 0]);
    standing.set('travel', 0.4);
    near(at(standing.anchor('carriage')), [0.4, 0.12, 0]);
    expect(bounds(standing).min.y).toBeCloseTo(0, 6);

    const hung = build('linearAxis', { stroke: 0.8, section: 0.08, hang: true });
    hung.set('travel', -0.3);
    near(at(hung.anchor('carriage')), [-0.3, -0.12, 0]);
    near(up(hung.anchor('carriage')), [0, 1, 0]);
    expect(bounds(hung).max.y).toBeLessThanOrEqual(1e-6); // all below the mounting face
    const motor = new THREE.Box3().setFromObject(hung.root.getObjectByName('Drive motor'));
    expect(motor.min.x).toBeGreaterThan(0.4);
  });

  it('vertical axis: the ram mount comes down by `extend` below the body', () => {
    const a = build('verticalAxis', { stroke: 0.3, bodyLength: 0.5 });
    near(at(a.anchor('ram')), [0, -0.52, 0]);
    a.set('extend', 0.3);
    near(at(a.anchor('ram')), [0, -0.82, 0]);
    expect(() => build('verticalAxis', { stroke: 0.5, bodyLength: 0.5 })).toThrow(/stroke/);
  });

  it('rotary axis: positive angle turns counter-clockwise seen from above, standing or hung', () => {
    for (const hang of [false, true]) {
      const a = build('rotaryAxis', { hang });
      const flange = a.anchor('flange');
      near(up(flange), [0, 1, 0]);
      expect(at(flange).y * (hang ? -1 : 1)).toBeCloseTo(0.12, 9);
      a.set('angle', Math.PI / 2);
      near(xDir(flange), [0, 0, -1]); // +X turns to −Z: counter-clockwise from +Y
    }
  });
});

describe('basic tools', () => {
  const NEW = ['dispenseNozzle', 'labelHead', 'laserHead', 'machiningSpindle', 'pressRam', 'visionCamera'];

  it('are registered as tools, with the gripper, vacuum pad and screwdriver from before', () => {
    const tools = registry.components().filter((d) => d.category === 'tool').map((d) => d.type);
    expect(tools).toEqual(expect.arrayContaining([...NEW, 'fingerGripper', 'vacuumPad', 'screwdriver']));
    expect(NEW.every((t) => registry.getComponent(t).mount === 'tool')).toBe(true);
  });

  for (const type of [...NEW, 'fingerGripper', 'vacuumPad']) {
    it(`${type}: mounting face on top at the footprint height, tool point at the origin`, () => {
      const t = build(type);
      expect(bounds(t).max.y).toBeCloseTo(t.footprint.height, 6);
      expect(bounds(t).min.y).toBeGreaterThanOrEqual(t.footprint.bottom - 1e-6);
    });
  }

  it('nozzle: the stream reaches `jetLength × flow` below the tip', () => {
    const n = build('dispenseNozzle', { jetLength: 0.2 });
    expect(n.root.getObjectByName('Stream').visible).toBe(false);
    n.set('flow', 0.5);
    n.root.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(n.root.getObjectByName('Stream')).min.y).toBeCloseTo(-0.1, 6);
  });

  it('press: the face mount comes down by `extend`', () => {
    const p = build('pressRam', { stroke: 0.08 });
    near(at(p.anchor('face')), [0, 0, 0]);
    p.set('extend', 0.08);
    near(at(p.anchor('face')), [0, -0.08, 0]);
  });

  it('label head: tamp brings the pad and its label down; the label shows when loaded', () => {
    const h = build('labelHead', { stroke: 0.1 });
    h.set('label', 'loaded');
    h.set('tamp', 0.1);
    near(at(h.anchor('pad')), [0, -0.1, 0]);
    expect(h.root.getObjectByName('Label on pad').visible).toBe(true);
    h.set('label', 'none');
    expect(h.root.getObjectByName('Label on pad').visible).toBe(false);
  });

  it('camera and laser: lit / firing they reach their working distance / focus', () => {
    const c = build('visionCamera', { workingDistance: 0.4 });
    c.set('light', 'on');
    expect(new THREE.Box3().setFromObject(c.root.getObjectByName('Sight line')).min.y).toBeCloseTo(-0.4, 6);
    const l = build('laserHead', { focusDistance: 0.12 });
    expect(l.root.getObjectByName('Beam').visible).toBe(false);
    l.set('beam', 1);
    expect(new THREE.Box3().setFromObject(l.root.getObjectByName('Beam')).min.y).toBeCloseTo(-0.12, 6);
  });

  it('spindle: `spin` turns the cutter and collet, not the motor', () => {
    const s = build('machiningSpindle');
    const turning = s.root.getObjectByName('Turning');
    s.set('spin', 1);
    expect(turning.rotation.y).toBe(1);
    expect(s.root.getObjectByName('Spindle motor').parent).not.toBe(turning);
  });
});
