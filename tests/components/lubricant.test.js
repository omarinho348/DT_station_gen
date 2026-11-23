// Phase 5 lubricant machines: filler, capper and conveyor tunnel (ported from the reference
// station-1 FillingMachine.js, CappingMachine.js and OilConveyor.js), checked against the reference
// numbers and against the jerry can and belt conveyor they work with.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { createMaterials } from '../../lib/core/materials.js';

const materials = createMaterials();
const BELT = 0.86; // the reference oil station's belt height
const ctx = { materials, beltHeight: BELT };
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const boxOf = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o); }; // parents moved by motions too
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const named = (root, name) => { const out = []; root.traverse((o) => { if (o.name === name) out.push(o); }); return out; };

describe('filler', () => {
  it('matches the reference: tips 1.463 m raised / 1.213 m lowered, cabinet at 2.05 m, posts at ±0.95 m, 4 heads at 0.4 m', () => {
    const f = registry.buildComponent('filler', {}, ctx);
    const head = f.root.getObjectByName('Filling head');
    close(head.position.y, 1.463);
    f.set('headTravel', 1);
    close(head.position.y, 1.213);
    close(boxOf(f.root.getObjectByName('Cabinet housing')).min.y, 2.05, 1e-6);
    close(f.root.getObjectByName('Post 4').position.x, 0.95);
    expect(named(f.root, 'Valve body').map((v) => Number(worldOf(v).x.toFixed(6)))).toEqual([-0.6, -0.2, 0.2, 0.6]);
    expect(Object.keys(f.ports)).toEqual(['work', 'head1', 'head2', 'head3', 'head4']);
    expect(f.ports.head1).toMatchObject({ position: [-0.6, BELT, 0], carries: 'unit' });
    expect(f.ports.work.carries).toBe('batch');
    f.dispose();
  });

  it('lowered nozzles reach 45 mm into the neck of a jerry can whose neck is under a head port', () => {
    const f = registry.buildComponent('filler', {}, ctx);
    const can = registry.buildProduct('jerryCan', {}, { materials });
    f.set('headTravel', 1);
    const tipY = f.root.getObjectByName('Filling head').position.y;
    close(BELT + can.ref('neckTop').y - tipY, 0.045);
    f.dispose();
    can.dispose();
  });

  it('jets run from the tips down to jetEnd with a splash; nothing when jetEnd ≤ jetStart', () => {
    const f = registry.buildComponent('filler', {}, ctx);
    const stream = named(f.root, 'Oil stream')[0];
    const splash = named(f.root, 'Oil splash')[0];
    expect(stream.visible).toBe(false);
    f.set('jetEnd', 0.3);
    expect(stream.visible).toBe(true);
    close(stream.scale.y, 0.3);
    close(splash.position.y, -0.298);
    f.set('jetStart', 0.2); // the valves closed: the last oil falls
    close(stream.position.y, -0.2);
    close(stream.scale.y, 0.1, 1e-9);
    f.set('jetStart', 0.3);
    expect(stream.visible).toBe(false);
    expect(splash.visible).toBe(false);
    f.dispose();
  });

  it('roof beacon: off / run / wait / alarm light green / amber / red', () => {
    const f = registry.buildComponent('filler', {}, ctx);
    const lamp = (c) => f.root.getObjectByName(`Lamp ${c}`).material.emissiveIntensity > 0;
    expect(['green', 'amber', 'red'].map(lamp)).toEqual([false, false, false]);
    f.set('beacon', 'run');
    expect(['green', 'amber', 'red'].map(lamp)).toEqual([true, false, false]);
    f.set('beacon', 'alarm');
    expect(['green', 'amber', 'red'].map(lamp)).toEqual([false, false, true]);
    f.dispose();
  });

  it('a long stroke raises the cabinet so the raised head fits; the reference defaults keep 2.05 m', () => {
    const f = registry.buildComponent('filler', { tipHeight: 0.45, stroke: 0.35 }, ctx);
    close(boxOf(f.root.getObjectByName('Cabinet housing')).min.y, BELT + 0.45 + 0.35 + 0.57, 1e-6);
    // Guide shafts still reach the bushings with the head lowered.
    f.set('headTravel', 1);
    const shaftTop = boxOf(named(f.root, 'Guide shaft')[0]).max.y;
    expect(shaftTop).toBeGreaterThan(boxOf(named(f.root, 'Linear bushing')[0]).min.y);
    f.dispose();
  });

  it('hose anchors: the product inlet rides on the head, the bulkheads stay', () => {
    const f = registry.buildComponent('filler', {}, ctx);
    const inlet0 = worldOf(f.anchor('productInlet')).y;
    const bulk0 = worldOf(f.anchor('productBulkhead')).y;
    f.set('headTravel', 1);
    close(inlet0 - worldOf(f.anchor('productInlet')).y, 0.25);
    close(worldOf(f.anchor('productBulkhead')).y, bulk0);
    f.dispose();
  });

  it('one head and eight heads build with the manifold spanning the nozzles', () => {
    for (const heads of [1, 8]) {
      const f = registry.buildComponent('filler', { heads, pitch: 0.2 }, ctx);
      const manifold = boxOf(f.root.getObjectByName('Product manifold'));
      for (const v of named(f.root, 'Valve body')) {
        const x = worldOf(v).x;
        expect(x).toBeGreaterThan(manifold.min.x);
        expect(x).toBeLessThan(manifold.max.x);
      }
      expect(named(f.root, 'Valve body')).toHaveLength(heads);
      f.dispose();
    }
  });
});

describe('capper', () => {
  it('matches the reference: head 1.508 m raised, caps at the cap seat 1.248 m lowered, cabinet at 2.05 m, posts at ±0.85 m', () => {
    const c = registry.buildComponent('capper', {}, ctx);
    const head = c.root.getObjectByName('Capping head');
    close(head.position.y, BELT + 0.388 + 0.26);
    c.set('headTravel', 1);
    close(head.position.y, 1.248);
    close(boxOf(c.root.getObjectByName('Cabinet housing')).min.y, 2.05, 1e-6);
    close(c.root.getObjectByName('Post 4').position.x, 0.85);
    // Lift cylinders in the gaps next to the outer spindles (±0.4 m for spindles at ±0.2 / ±0.6).
    expect(named(c.root, 'Cylinder barrel').map((b) => Number(worldOf(b).x.toFixed(6)))).toEqual([-0.4, 0.4]);
    c.dispose();
  });

  it('lowered, each chuck cap sits exactly on the cap seat of a jerry can under its head port', () => {
    const c = registry.buildComponent('capper', {}, ctx);
    const can = registry.buildProduct('jerryCan', {}, { materials });
    can.root.position.set(c.ports.head2.position[0] - can.params.neckOffsetX, BELT, 0);
    c.set('headTravel', 1);
    const chuckCap = c.root.getObjectByName('Chuck 2').getObjectByName('Cap');
    const seat = can.ref('capSeat').add(can.root.position);
    close(worldOf(chuckCap).distanceTo(seat), 0, 1e-9);
    // Same cap as the can's own: same size.
    const own = can.root.getObjectByName('Cap');
    own.visible = true;
    const a = boxOf(chuckCap).getSize(new THREE.Vector3());
    const b = boxOf(own).getSize(new THREE.Vector3());
    close(a.distanceTo(b), 0, 1e-6);
    c.dispose();
    can.dispose();
  });

  it('spins the chucks, hands caps over (empty) and feeds fresh ones down the sleeve', () => {
    const c = registry.buildComponent('capper', {}, ctx);
    const chuck = c.root.getObjectByName('Chuck 1');
    const cap = chuck.getObjectByName('Cap');
    c.set('spin', 0.25);
    close(chuck.rotation.y, Math.PI / 2);
    c.set('caps', 'empty');
    expect(cap.visible).toBe(false);
    c.set('caps', 'loaded');
    c.set('capFeed', 0);
    close(cap.position.y, 0.06);
    c.set('capFeed', 1);
    close(cap.position.y, 0);
    c.dispose();
  });

  it('cap feeder: 18 caps in the bowl, chute landing on the back of the cabinet', () => {
    const c = registry.buildComponent('capper', {}, ctx);
    expect(c.root.getObjectByName('Cap feeder').children.filter((o) => /^Bowl cap/.test(o.name))).toHaveLength(18);
    const cabinet = boxOf(c.root.getObjectByName('Cabinet housing'));
    const chute = named(c.root, 'Chute rail').map(boxOf).reduce((a, b) => a.union(b));
    expect(chute.max.z).toBeGreaterThan(cabinet.min.z); // the chute enters the back of the cabinet
    expect(chute.max.z).toBeLessThan(cabinet.min.z + 0.05);
    expect(chute.max.y).toBeGreaterThan(cabinet.min.y);
    c.dispose();
  });

  it('with one or two spindles the lift cylinders go outside them', () => {
    for (const heads of [1, 2]) {
      const c = registry.buildComponent('capper', { heads }, ctx);
      const spindles = named(c.root, 'Servo motor').map((s) => Math.abs(worldOf(s).x));
      const lifts = named(c.root, 'Cylinder barrel').map((b) => Math.abs(worldOf(b).x));
      expect(Math.min(...lifts)).toBeGreaterThan(Math.max(...spindles) + 0.08);
      c.dispose();
    }
  });
});

describe('conveyorTunnel', () => {
  it('is open at one end (port there) and closed at the other', () => {
    const t = registry.buildComponent('conveyorTunnel', { length: 1.9, open: '+X' }, ctx);
    expect(t.ports.opening).toMatchObject({ position: [0.95, BELT, 0], direction: 'out' });
    expect(t.root.getObjectByName('End wall').position.x).toBeLessThan(0);
    const back = registry.buildComponent('conveyorTunnel', { open: '-X' }, ctx);
    expect(back.ports.opening.direction).toBe('in');
    expect(back.root.getObjectByName('End wall').position.x).toBeGreaterThan(0);
    t.dispose();
    back.dispose();
  });

  it('fits over the tail end of a belt conveyor of the same width: no part touches the conveyor, units pass under the roof', () => {
    const conveyor = registry.buildComponent('beltConveyor', { length: 4, drive: false }, ctx);
    const tunnel = registry.buildComponent('conveyorTunnel', { length: 1.9, open: '+X' }, ctx);
    tunnel.root.position.x = -2 + 0.95 - 0.05; // closed end 5 cm before the conveyor's tail, as the reference infeed
    const meshBoxes = (root) => { const out = []; root.updateMatrixWorld(true); root.traverse((o) => { if (o.isMesh) out.push({ name: o.name, box: new THREE.Box3().setFromObject(o) }); }); return out; };
    const conveyorParts = meshBoxes(conveyor.root);
    const clashes = [];
    for (const t of meshBoxes(tunnel.root)) {
      if (t.name === 'Interior lining') continue; // an inside-out box: its bounds enclose the belt by design
      for (const c of conveyorParts) if (t.box.intersectsBox(c.box)) clashes.push(`${t.name} × ${c.name}`);
    }
    expect([...new Set(clashes)]).toEqual([]);
    const can = registry.buildProduct('jerryCan', {}, { materials });
    can.setStage('capped');
    expect(boxOf(tunnel.root.getObjectByName('Roof')).min.y).toBeGreaterThan(BELT + boxOf(can.root).max.y);
    conveyor.dispose();
    tunnel.dispose();
    can.dispose();
  });
});

describe('filler hoses', () => {
  it('product and air hoses run from the cabinet bulkheads to the manifold and follow the head', () => {
    const f = registry.buildComponent('filler', {}, ctx);
    const hose = f.root.getObjectByName('Product hose');
    const air = f.root.getObjectByName('Pneumatic line');
    const ends = (h, from, to) => {
      const b = boxOf(h).expandByScalar(1e-6);
      return b.containsPoint(worldOf(f.anchor(from))) && b.containsPoint(worldOf(f.anchor(to)));
    };
    expect(ends(hose, 'productBulkhead', 'productInlet')).toBe(true);
    expect(ends(air, 'airBulkhead', 'airInlet')).toBe(true);
    const raisedBottom = boxOf(hose).min.y;
    f.set('headTravel', 1);
    expect(ends(hose, 'productBulkhead', 'productInlet')).toBe(true);
    expect(ends(air, 'airBulkhead', 'airInlet')).toBe(true);
    close(raisedBottom - boxOf(hose).min.y, 0.25, 0.05); // the low point drops with the head
    f.dispose();
  });
});

describe('supplyTank', () => {
  it('matches the reference: shell 0.55–1.85 m, outlet at 0.39 m, pump 0.975 m along +X, suction valve between them', () => {
    const t = registry.buildComponent('supplyTank', {}, ctx);
    const shell = boxOf(t.root.getObjectByName('Tank shell'));
    close(shell.min.y, 0.55, 1e-6);
    close(shell.max.y, 1.85, 1e-6);
    close(boxOf(t.root.getObjectByName('Outlet cone')).min.y, 0.39, 1e-6);
    close(t.root.getObjectByName('Transfer pump').position.x, 0.975);
    close(t.root.getObjectByName('Suction valve').position.x, (0 + 0.855) / 2);
    expect(worldOf(t.anchor('discharge')).toArray()).toEqual([0.975, 1.5, 0]);
    t.dispose();
  });

  it('level motion fills the sight glass; the level transmitter stands on the dished head', () => {
    const t = registry.buildComponent('supplyTank', {}, ctx);
    t.set('level', 0.5);
    close(t.root.getObjectByName('Sight liquid').scale.y, 0.5 * (1.3 - 0.2));
    const tx = t.root.getObjectByName('Level transmitter');
    const at = worldOf(tx);
    t.root.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(new THREE.Vector3(at.x, 5, at.z), new THREE.Vector3(0, -1, 0)).intersectObject(t.root.getObjectByName('Dished head'))[0];
    const foot = boxOf(tx.getObjectByName('Process connection')).min.y;
    expect(hit.point.y - foot).toBeGreaterThan(0); // sunk into the head, not above it
    expect(hit.point.y - foot).toBeLessThan(0.01);
    t.dispose();
  });

  it('refuses a pump inside the tank', () => {
    expect(() => registry.buildComponent('supplyTank', { radius: 0.6, pumpOffset: 0.7 }, ctx)).toThrow(/pumpOffset/);
  });
});

describe('photoEye', () => {
  it('stands on the side frames of a belt conveyor, its beam across a jerry can on the belt', () => {
    const conveyor = registry.buildComponent('beltConveyor', {}, ctx);
    const eye = registry.buildComponent('photoEye', { span: 0.34 + 0.06 }, ctx);
    const frames = ['Side frame front', 'Side frame rear'].map((n) => boxOf(conveyor.root.getObjectByName(n)));
    eye.root.position.y = frames[0].max.y; // mount 'surface': y = 0 is the frame top
    const rods = named(eye.root, 'Mounting rod').map(boxOf);
    for (const rod of rods) {
      const frame = frames.find((fr) => rod.getCenter(new THREE.Vector3()).z > fr.min.z && rod.getCenter(new THREE.Vector3()).z < fr.max.z);
      expect(frame).toBeDefined();
      close(rod.min.y, frame.max.y, 1e-6);
    }
    const beamY = worldOf(eye.root.getObjectByName('Sensor head')).y;
    close(beamY, BELT + 0.2, 1e-9);
    const can = registry.buildProduct('jerryCan', {}, { materials });
    expect(beamY - BELT).toBeLessThan(boxOf(can.root.getObjectByName('Can body')).max.y);
    conveyor.dispose();
    eye.dispose();
    can.dispose();
  });

  it('LED amber while clear, green while blocked (one material, recoloured)', () => {
    const eye = registry.buildComponent('photoEye', {}, ctx);
    const led = eye.root.getObjectByName('Status LED').material;
    expect(led.emissive.getHex()).toBe(0xf2a516);
    eye.set('beam', 'blocked');
    expect(eye.root.getObjectByName('Status LED').material).toBe(led);
    expect(led.emissive.getHex()).toBe(0x39d353);
    expect(led.emissiveIntensity).toBeGreaterThan(1);
    eye.set('beam', 'clear');
    expect(led.emissive.getHex()).toBe(0xf2a516);
    eye.dispose();
  });
});
