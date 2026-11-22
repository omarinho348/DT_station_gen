import { describe, it, expect } from 'vitest';
import { registry } from '../../lib/components/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';
import { boundsOf } from '../helpers/componentChecks.js';

const materials = createMaterials();
const build = (type, params = {}, ctx = {}) => registry.buildComponent(type, params, { materials, ...ctx });
const worldY = (o) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(o.position.clone()).y; };

describe('conventions', () => {
  it('match the reference printer line', () => {
    expect(CONVENTIONS).toMatchObject({
      beltHeight: 0.85,
      ports: { input: -1.6, work: 0, output: 1.6 },
      conveyor: { start: -2.2, end: 2.2, speed: 0.45, ramp: 0.35 },
      lift: { drop: 0.5, duration: 0.9 },
      transferLength: 1.2,
      slabHalfLength: 2.35,
      speeds: [1, 2, 10],
    });
  });
});

describe('palletConveyor', () => {
  it('defaults to the reference station conveyor: 4.4 m, belts at 0.85 m', () => {
    const c = build('palletConveyor');
    const b = boundsOf(c.root);
    expect(b.min.x).toBeCloseTo(-2.2, 6);
    expect(b.max.x).toBeCloseTo(2.2, 6);
    const belt = c.root.getObjectByName('Strand belt');
    expect(belt.position.y + 0.003).toBeCloseTo(0.85, 9);
  });

  it('has typed ports at the carrier-centre end positions (reference ±1.6) and at the work position, at belt height', () => {
    expect(build('palletConveyor').ports).toEqual({
      input: { position: [-1.6, 0.85, 0], direction: 'in', carries: 'pallet' },
      work: { position: [0, 0.85, 0], direction: 'work', carries: 'pallet' },
      output: { position: [1.6, 0.85, 0], direction: 'out', carries: 'pallet' },
    });
    expect(Object.keys(build('palletConveyor', { workStop: false }).ports)).toEqual(['input', 'output']);
    expect(build('palletConveyor', { length: 3, carrierLength: 0.6 }).ports.output.position[0]).toBeCloseTo(1.2, 12);
  });

  it('follows a different belt height from the line context', () => {
    const c = build('palletConveyor', {}, { beltHeight: 0.9 });
    expect(c.ports.work.position[1]).toBe(0.9);
    expect(c.footprint.height).toBeCloseTo(0.95, 9);
  });

  it('belt motion scrolls the belt texture and turns the pulleys', () => {
    const c = build('palletConveyor');
    const belt = c.root.getObjectByName('Strand belt');
    const pulley = c.root.getObjectByName('Pulley');
    c.set('belt', 0.25);
    expect(belt.material.map.offset.x).toBeCloseTo(-0.25, 9);
    expect(pulley.rotation.z).toBeCloseTo(-0.25 * 2 * 2 * Math.PI, 9);
    // Phase 1 and phase 0 look the same, so ops can wrap the phase as carriers travel.
    c.set('belt', 1);
    const at1 = pulley.rotation.z % (2 * Math.PI);
    expect(Math.abs(at1)).toBeLessThan(1e-9);
  });

  it('each conveyor scrolls its own belt (materials are not shared between conveyors)', () => {
    const a = build('palletConveyor');
    const b = build('palletConveyor');
    a.set('belt', 0.5);
    expect(b.root.getObjectByName('Strand belt').material.map.offset.x).toBe(-0);
    expect(materials.belt.map.offset.x).toBe(0);
  });

  it('stop pin rises 60 mm into the carrier path; locate plate rises 30 mm', () => {
    const c = build('palletConveyor');
    const pin = c.root.getObjectByName('Stop pin');
    const plate = c.root.getObjectByName('Lift plate');
    const [pin0, plate0] = [worldY(pin), worldY(plate)];
    c.set('stop', 1);
    c.set('locate', 1);
    expect(worldY(pin) - pin0).toBeCloseTo(0.06, 9);
    expect(worldY(plate) - plate0).toBeCloseTo(0.03, 9);
    expect(worldY(pin) + 0.03).toBeGreaterThan(0.85); // pin top above the belt: it blocks the carrier
  });

  it('places the stop just ahead of the carrier at the work position', () => {
    const c = build('palletConveyor', { carrierLength: 1.0, length: 3 });
    expect(c.root.getObjectByName('CarrierStop').position.x).toBeCloseTo(0.53, 9);
  });

  it('rejects a carrier too long for the conveyor, with a clear message', () => {
    expect(() => build('palletConveyor', { length: 1, carrierLength: 1.2 })).toThrow(/carrierLength must be at least 0.12 m shorter/);
    expect(() => build('palletConveyor', { length: 1, carrierLength: 1.2, workStop: false })).not.toThrow();
  });

  it('adds legs as the conveyor gets longer', () => {
    const legs = (length) => {
      let n = 0;
      build('palletConveyor', { length, workStop: false }).root.traverse((o) => o.name === 'Leg' && n++);
      return n;
    };
    expect(legs(0.8)).toBe(4);
    expect(legs(4.4)).toBe(10);
    expect(legs(12)).toBe(20);
  });
});

describe('liftUnit', () => {
  it('matches the reference frame: columns 1.32 m apart, header 0.15 m above the belt', () => {
    const l = build('liftUnit');
    const cols = [];
    l.root.traverse((o) => o.name === 'Lift column' && cols.push(o.position.x));
    expect([...new Set(cols)].sort()).toEqual([-0.66, 0.66]);
    expect(l.root.getObjectByName('Lift header').position.y).toBeCloseTo(1.0, 9);
  });

  it('carriage travels from belt height down to the return line', () => {
    const l = build('liftUnit');
    const sleeve = l.root.getObjectByName('Lift carriage');
    expect(sleeve.position.y).toBeCloseTo(0.85, 9); // starts up
    l.set('level', 0);
    expect(sleeve.position.y).toBeCloseTo(0.35, 9);
    expect(l.ports.bottom.position[1]).toBeCloseTo(0.35, 9);
  });
});
