import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { boundsOf } from '../helpers/componentChecks.js';

const materials = createMaterials();
const build = (type, params = {}) => {
  const inst = registry.buildComponent(type, params, { materials });
  inst.root.updateMatrixWorld(true); // parts in nested groups are measured in the component frame
  return inst;
};
const all = (root, name) => {
  const out = [];
  root.traverse((o) => { if (o.name === name) out.push(o); });
  return out;
};

describe('tote', () => {
  it('has exactly the requested inside size and wall height', () => {
    const t = build('tote', { width: 0.24, depth: 0.15, height: 0.1 });
    const walls = all(t.root, 'Tote wall').map(boundsOf);
    const inner = (axis) => {
      const faces = walls.filter((b) => b.max[axis] - b.min[axis] < 0.01); // walls thin along this axis
      return Math.min(...faces.filter((b) => b.min[axis] > 0).map((b) => b.min[axis])) - Math.max(...faces.filter((b) => b.max[axis] < 0).map((b) => b.max[axis]));
    };
    expect(inner('x')).toBeCloseTo(0.24, 6);
    expect(inner('z')).toBeCloseTo(0.15, 6);
    expect(boundsOf(t.root).max.y).toBeCloseTo(0.1, 6);
  });

  it('rests on its underside, with the inside port on the inside floor', () => {
    const t = build('tote');
    expect(boundsOf(t.root).min.y).toBeCloseTo(0, 9);
    expect(t.ports.inside.position[1]).toBeCloseTo(boundsOf(t.root.getObjectByName('Tote floor')).max.y, 6);
    expect(t.ports.inside).toMatchObject({ direction: 'work', carries: 'unit' });
  });

  it('uses the shared colour material', () => {
    expect(build('tote').root.getObjectByName('Tote floor').material).toBe(materials.toteBlue);
    expect(build('tote', { color: 'binRed' }).root.getObjectByName('Tote wall').material).toBe(materials.binRed);
  });
});

describe('flowRack', () => {
  it('is 1.9 m tall with 3 levels of 5 bins at defaults (reference)', () => {
    const r = build('flowRack');
    expect(r.footprint.height).toBeCloseTo(1.9, 9);
    expect(all(r.root, 'Roller track')).toHaveLength(3);
    expect(all(r.root, 'Stock bin')).toHaveLength(15);
    expect(all(build('flowRack', { levels: 5, bins: 2 }).root, 'Stock bin')).toHaveLength(10);
  });

  it('slopes down to the pick face (+Z), so the bins roll towards the line', () => {
    const r = build('flowRack');
    r.root.updateMatrixWorld(true);
    const track = r.root.getObjectByName('Roller track');
    const front = track.localToWorld(new THREE.Vector3(0, 0, 0.35));
    const back = track.localToWorld(new THREE.Vector3(0, 0, -0.35));
    expect(front.y).toBeLessThan(back.y - 0.05);
  });

  it('rests each bin against the front stop and clear of the uprights', () => {
    const r = build('flowRack', { bins: 8, length: 0.8 });
    const uprights = all(r.root, 'Rack upright').map(boundsOf);
    for (const bin of all(r.root, 'Stock bin')) {
      const b = boundsOf(bin);
      for (const u of uprights) expect(b.intersectsBox(u)).toBe(false);
    }
    const shelf = r.root.getObjectByName('Shelf 1');
    const stop = shelf.getObjectByName('Front stop');
    const bin = shelf.getObjectByName('Stock bin');
    // In the shelf frame: the bin's front face touches the stop's back face.
    const localZ = (mesh, side) => {
      mesh.geometry.computeBoundingBox();
      return mesh.position.z + mesh.geometry.boundingBox[side].z;
    };
    expect(localZ(bin, 'max')).toBeCloseTo(localZ(stop, 'min'), 6);
  });

  it('cycles the bin colours in the reference order', () => {
    const r = build('flowRack');
    const first = r.root.getObjectByName('Shelf 1');
    const second = r.root.getObjectByName('Shelf 2');
    const colours = (shelf) => all(shelf, 'Stock bin').map((b) => b.material.name);
    expect(colours(first)).toEqual(['toteBlue', 'binYellow', 'binRed', 'binGreen', 'toteBlue']);
    expect(colours(second)[0]).toBe('binYellow');
  });
});

describe('pickToLight', () => {
  it('switches its own lamp only', () => {
    const a = build('pickToLight');
    const b = build('pickToLight');
    const lamp = (p) => p.root.getObjectByName('PTL lamp').material;
    expect(lamp(a)).not.toBe(lamp(b));
    a.set('lamp', 'on');
    expect(lamp(a).userData.on).toBe(true);
    expect(lamp(b).userData.on).toBe(false);
  });

  it('sits on its underside with the lamp on the +Z face', () => {
    const p = build('pickToLight', { color: 'amber' });
    expect(boundsOf(p.root).min.y).toBeCloseTo(0, 9);
    const housing = boundsOf(p.root.getObjectByName('PTL housing'));
    const lamp = boundsOf(p.root.getObjectByName('PTL lamp'));
    expect(lamp.max.z).toBeGreaterThan(housing.max.z);
  });
});

describe('partCradle', () => {
  it('has one port per lane, on top of the saddle bars (reference lanes)', () => {
    const c = build('partCradle');
    expect(Object.keys(c.ports)).toEqual(['lane1', 'lane2', 'lane3', 'lane4', 'lane5']);
    const bar = boundsOf(c.root.getObjectByName('Saddle bar'));
    expect(c.ports.lane3.position).toEqual([0, expect.closeTo(bar.max.y, 9), 0]);
    expect(c.ports.lane1.position[0]).toBe(-0.17);
  });

  it('puts a pair of lips around every lane on both bars', () => {
    const c = build('partCradle', { lanes: [-0.1, 0.1], laneWidth: 0.05 });
    const lips = all(c.root, 'Saddle lip').map(boundsOf);
    expect(lips).toHaveLength(2 * 2 * 2);
    const centres = [...new Set(lips.map((b) => Number(((b.min.x + b.max.x) / 2).toFixed(4))))].sort((a, b) => a - b);
    expect(centres).toEqual([-0.125, -0.075, 0.075, 0.125]);
  });

  it('rejects a lane off the bars, naming it', () => {
    expect(() => build('partCradle', { lanes: [0, 0.4] })).toThrow(/lanes\.1: lane at 0.4 m is off the saddle bars/);
  });
});

describe('partNest', () => {
  it('holds a stack between corner posts (bed nest, reference)', () => {
    const n = build('partNest');
    const posts = all(n.root, 'Nest corner post').map(boundsOf);
    expect(posts).toHaveLength(4);
    for (const b of posts) expect(b.max.y).toBeCloseTo(0.72 + 0.2, 6);
    expect(n.ports.seat.position[1]).toBeCloseTo(0.72, 9);
  });

  it('seats a single part on flat locators (frame nest, reference)', () => {
    const n = build('partNest', { length: 0.56, width: 0.5, guides: 'locators', guideX: 0.16, guideZ: 0.18 });
    const locators = all(n.root, 'Nest locator').map(boundsOf);
    expect(locators).toHaveLength(4);
    expect(all(n.root, 'Nest corner post')).toHaveLength(0);
    expect(n.ports.seat.position[1]).toBeCloseTo(locators[0].max.y, 6);
    expect(() => build('partNest', { guideX: 0.17 })).toThrow(/guides must stay on the stand top/);
  });
});

describe('keepOutRing', () => {
  it('is a full disc at defaults and a ring when the band is narrower', () => {
    const inner = (r) => r.root.getObjectByName('Keep-out ring').geometry.parameters.innerRadius;
    expect(inner(build('keepOutRing'))).toBe(0);
    expect(inner(build('keepOutRing', { radius: 1, band: 0.1 }))).toBeCloseTo(0.9, 9);
    expect(() => build('keepOutRing', { radius: 0.5, band: 0.6 })).toThrow(/band cannot be wider/);
  });

  it('lies flat on the floor', () => {
    const b = boundsOf(build('keepOutRing', { radius: 0.8 }).root);
    expect(b.max.y - b.min.y).toBeLessThan(1e-9);
    expect(b.max.x).toBeCloseTo(0.8, 6);
  });
});

describe('number-list params', () => {
  it('are described for the gallery and kept at their default in min / max samples', async () => {
    const { paramFields, paramSamples } = await import('../../lib/registry.js');
    const def = registry.getComponent('partCradle');
    expect(paramFields(def.params).find((f) => f.key === 'lanes')).toMatchObject({ kind: 'numberList', minItems: 1, maxItems: 10, min: -0.7, max: 0.7 });
    expect(paramSamples(def.params).max.lanes).toEqual([-0.17, -0.08, 0, 0.06, 0.15]);
  });
});

describe('vibratoryFeeder', () => {
  it('matches the reference screw presenter geometry at defaults (bench top = 0)', () => {
    const f = build('vibratoryFeeder');
    const bowl = boundsOf(f.root.getObjectByName('Feeder bowl'));
    expect(bowl.max.x).toBeCloseTo(0.13, 3);
    expect(bowl.max.y).toBeCloseTo(0.1, 6); // reference: bowl centre 0.85 on a 0.80 bench
    const hose = boundsOf(f.root.getObjectByName('Feed hose'));
    expect(hose.min.y).toBeCloseTo(0.1, 6);
    expect(hose.max.y).toBeCloseTo(1.3, 6); // reference: hose top 2.1 on a 0.80 bench
  });

  it('puts the outlet at the hose end, or at the escapement without a hose', () => {
    const f = build('vibratoryFeeder');
    expect(f.ports.outlet.position[1]).toBeCloseTo(1.3, 9);
    const bare = build('vibratoryFeeder', { hoseLength: 0 });
    expect(bare.root.getObjectByName('Feed hose')).toBeUndefined();
    const esc = boundsOf(bare.root.getObjectByName('Escapement'));
    expect(bare.ports.outlet.position[0]).toBeCloseTo(esc.max.x, 6);
  });

  it('scales with the bowl diameter', () => {
    const big = build('vibratoryFeeder', { bowlDiameter: 0.52, hoseLength: 0 });
    expect(boundsOf(big.root.getObjectByName('Feeder bowl')).max.y).toBeCloseTo(0.2, 6);
    expect(big.footprint.x[1]).toBeCloseTo(0.27, 6);
  });
});

describe('harnessBoard', () => {
  it('matches the reference board at defaults: 5 wires, top at 1.5 m, leaning back', () => {
    const h = build('harnessBoard');
    expect(all(h.root, 'Harness on board')).toHaveLength(5);
    expect(all(h.root, 'Board connector')).toHaveLength(10);
    const board = h.root.getObjectByName('Harness board');
    expect(boundsOf(board).max.y).toBeCloseTo(1.5, 2); // rounded corners sit a little lower
    const top = board.localToWorld(new THREE.Vector3(0, 0.4, 0));
    const bottom = board.localToWorld(new THREE.Vector3(0, -0.4, 0));
    expect(top.z).toBeLessThan(bottom.z); // top leans back, the face looks up to the operator
    expect(all(h.root, 'Harness on board').map((w) => w.material.name)).toEqual(['cableBlack', 'cableRed', 'cableBlue', 'cableYellow', 'cableWhite']);
  });

  it('holds every wire on forks touching the board (nothing floats in front of it)', () => {
    const h = build('harnessBoard', { wires: 3 });
    const forks = all(h.root, 'Harness fork').map(boundsOf);
    const wires = all(h.root, 'Harness on board').map(boundsOf);
    expect(forks).toHaveLength(9);
    for (const w of wires) expect(forks.some((f) => f.clone().expandByScalar(0.001).intersectsBox(w))).toBe(true);
    expect(() => build('harnessBoard', { boardHeight: 0.4, wires: 8 })).toThrow(/too many wires/);
  });
});

describe('testCabinet', () => {
  it('lights one status lamp per state (none when idle)', () => {
    const t = build('testCabinet');
    const on = () => ['Pass lamp', 'Fail lamp', 'Test lamp'].filter((n) => t.root.getObjectByName(n).material.userData.on);
    expect(on()).toEqual([]);
    t.set('status', 'testing');
    expect(on()).toEqual(['Test lamp']);
    t.set('status', 'fail');
    expect(on()).toEqual(['Fail lamp']);
    t.set('status', 'pass');
    expect(on()).toEqual(['Pass lamp']);
  });

  it('keeps the reference layout: lead port at 0.9 m on the front, display above the top', () => {
    const t = build('testCabinet');
    expect(t.ports.testLead.position).toEqual([0, 0.9, 0.2]);
    const display = boundsOf(t.root.getObjectByName('Tester display'));
    expect((display.min.y + display.max.y) / 2).toBeCloseTo(0.98, 6);
    expect(t.root.getObjectByName('Pass lamp').position.x).toBeCloseTo(-0.1, 9);
    expect(t.root.getObjectByName('Test lamp').position.x).toBeCloseTo(0.1, 9);
  });
});

describe('harnessBoard posts', () => {
  it('fit the board between them: no post passes through the panel', () => {
    const h = build('harnessBoard', { tilt: 0.4 });
    const panel = h.root.getObjectByName('Harness board');
    const posts = all(h.root, 'Board post').map(boundsOf);
    // Panel corners in the posts' frame stay between the posts' inner faces.
    const corners = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => panel.localToWorld(new THREE.Vector3(sx * (1.3 - 0.05) / 2, sy * 0.4, 0)));
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(posts[0].max.x - 1e-6);
      expect(c.x).toBeLessThanOrEqual(posts[1].min.x + 1e-6);
    }
  });
});
