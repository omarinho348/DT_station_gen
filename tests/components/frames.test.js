// Basic frames (lib/basics/frames, Phase 6 step 1): the mount points are where parts will be hung
// (composites, step 4), they move with the frame's motion, and the ports are where units go.
import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';

const materials = createMaterials();
afterAll(() => disposeMaterials(materials));
const build = (type, params = {}, ctx = {}) => registry.buildComponent(type, params, { materials, ...ctx });
const at = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const mesh = (inst, name) => inst.root.getObjectByName(name);
const box = (o) => new THREE.Box3().setFromObject(o);

describe('basic frames', () => {
  it('are registered as frames, with mount points as anchors', () => {
    const frames = registry.components().filter((d) => d.category === 'frame').map((d) => d.type).sort();
    expect(frames).toEqual(['cantileverFrame', 'columnFrame', 'enclosureFrame', 'portalFrame', 'tableFrame', 'turntableFrame']);
  });

  it('portal: posts outside the clear width, the beam mount under the beam, the top mount on it', () => {
    const f = build('portalFrame', { span: 1.0, height: 1.5, section: 0.1 });
    expect(box(mesh(f, 'Post left')).max.z).toBeCloseTo(-0.5, 6);
    expect(box(mesh(f, 'Post right')).min.z).toBeCloseTo(0.5, 6);
    expect(at(f.anchor('beam')).toArray()).toEqual([0, 1.5, 0]);
    expect(box(mesh(f, 'Cross beam')).min.y).toBeCloseTo(1.5, 6);
    expect(at(f.anchor('beamTop')).y).toBeCloseTo(1.6, 9);
  });

  it('column: top mount on the cap, side mount on the +Z face at its height', () => {
    const f = build('columnFrame', { height: 1.4, section: 0.12, mountHeight: 1.0 });
    expect(at(f.anchor('top')).y).toBeCloseTo(box(f.root).max.y, 9);
    expect(at(f.anchor('side')).toArray().map((v) => +v.toFixed(9))).toEqual([0, 1, 0.06]);
    expect(() => build('columnFrame', { height: 1.0, mountHeight: 1.2 })).toThrow(/mountHeight/);
  });

  it('cantilever: the tip mount `reach` in front of the column, under the arm', () => {
    const f = build('cantileverFrame', { reach: 0.9, height: 1.4, section: 0.1 });
    expect(at(f.anchor('tip')).toArray()).toEqual([0, 1.4, 0]);
    const col = box(mesh(f, 'Column'));
    expect((col.min.z + col.max.z) / 2).toBeCloseTo(-0.9, 6);
    const arm = box(mesh(f, 'Arm'));
    expect(arm.min.y).toBeCloseTo(1.4, 6);
    expect(arm.max.z).toBeGreaterThanOrEqual(0.05 - 1e-9); // reaches past the tip mount
  });

  it('table: the work port and mount on the surface', () => {
    const f = build('tableFrame', { length: 1.0, depth: 0.6, height: 0.9 });
    expect(f.ports.surface.position).toEqual([0, 0.9, 0]);
    expect(at(f.anchor('top')).y).toBeCloseTo(0.9, 9);
    expect(box(mesh(f, 'Table top')).max.y).toBeCloseTo(0.9, 6);
  });

  it('turntable: nests evenly round the axis, turning with the plate; nest 1 at the load port at angle 0', () => {
    const f = build('turntableFrame', { radius: 0.6, nests: 4, nestRadius: 0.45, height: 0.86 });
    const load = new THREE.Vector3(...f.ports.load.position);
    expect(at(f.anchor('nest1')).distanceTo(load)).toBeLessThan(1e-9);
    expect(at(f.anchor('nest2')).toArray().map((v) => +v.toFixed(6))).toEqual([0, 0.87, -0.45]); // counter-clockwise from above
    f.set('angle', Math.PI / 2); // a quarter turn counter-clockwise: nest 4 comes to the load place
    expect(at(f.anchor('nest4')).distanceTo(load)).toBeLessThan(1e-9);
    expect(at(f.anchor('nest1')).toArray().map((v) => +v.toFixed(6))).toEqual([0, 0.87, -0.45]);
    expect(box(mesh(f, 'Plate')).max.y).toBeCloseTo(0.86, 6);
    expect(() => build('turntableFrame', { radius: 0.4, nestRadius: 0.35 })).toThrow(/inside the plate edge/);
  });

  it('enclosure: openings at both ends at belt height, wide and tall enough for what passes; roof mount inside', () => {
    const f = build('enclosureFrame', { length: 1.4, depth: 1.0, height: 2.0, openingWidth: 0.5, openingTop: 1.3 }, { beltHeight: 0.86 });
    expect(f.ports.input.position).toEqual([-0.7, 0.86, 0]);
    expect(f.ports.output.position).toEqual([0.7, 0.86, 0]);
    // Nothing of the enclosure stands in the pass-through (|z| < 0.25, y < 1.3) at either end.
    const passage = new THREE.Box3(new THREE.Vector3(-0.75, 0, -0.249), new THREE.Vector3(0.75, 1.299, 0.249));
    const blocking = [];
    f.root.traverse((o) => { if (o.isMesh && box(o).intersectsBox(passage)) blocking.push(o.name); });
    expect(blocking).toEqual([]);
    expect(at(f.anchor('roof')).y).toBeCloseTo(1.96, 9);
    expect(() => build('enclosureFrame', { depth: 0.6, openingWidth: 0.5 })).toThrow(/2.5 cm of wall/);
  });
});
