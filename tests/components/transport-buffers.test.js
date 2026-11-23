// Basic transport and buffers (lib/basics/transport, lib/basics/buffers; Phase 6 step 3): ports
// where units go, what each motion does, and that the existing transfer op drives them.
import { describe, it, expect, afterAll } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/ops/index.js';
import { dryRun } from '../../lib/ops/OpCycle.js';
import { trapezoidDuration } from '../../lib/core/motion.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';

const materials = createMaterials();
afterAll(() => disposeMaterials(materials));
const H = 0.86;
const build = (type, params = {}) => registry.buildComponent(type, params, { materials, beltHeight: H });
const topOf = (o) => { o.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(o).max.y; };
const port = (inst, name) => new THREE.Vector3(...inst.ports[name].position);

describe('basic transport and buffers', () => {
  it('are registered as transport / buffer', () => {
    const of = (cat) => registry.components().filter((d) => d.category === cat).map((d) => d.type).sort();
    expect(of('transport')).toEqual(['agvCart', 'gravityChute', 'turntableTransfer']);
    expect(of('buffer')).toEqual(['accumulationTable', 'bufferLane', 'flowRack']); // flowRack: Phase 2
  });

  it('gravity chute: input `drop` above the output at belt height; roller tops on the slope', () => {
    const c = build('gravityChute', { length: 1.5, drop: 0.3 });
    expect(c.ports.input.position).toEqual([-0.75, H + 0.3, 0]);
    expect(c.ports.output.position).toEqual([0.75, H, 0]);
    expect(() => build('gravityChute', { length: 1.0, drop: 0.5 })).toThrow(/too steep/);
    // Every roller top lies on the line from input to output (within the roller's own rounding).
    c.root.updateMatrixWorld(true);
    const rollers = [];
    c.root.traverse((o) => { if (o.name === 'Chute roller') rollers.push(o); });
    for (const r of rollers) {
      const centre = new THREE.Vector3().setFromMatrixPosition(r.matrixWorld);
      const surface = H + 0.15 - (centre.x * 0.3) / 1.5;
      expect(centre.y + 0.022).toBeCloseTo(surface, 2);
    }
  });

  it('turntable transfer: a quarter turn brings the section outfeed to the rear port, minus a quarter to the front', () => {
    const t = build('turntableTransfer', { length: 0.7 });
    const outfeed = () => {
      const section = t.root.getObjectByName('Roller section');
      section.updateWorldMatrix(true, false);
      return new THREE.Vector3(0.35, 0, 0).applyMatrix4(section.matrixWorld);
    };
    expect(outfeed().distanceTo(port(t, 'output'))).toBeLessThan(1e-9);
    t.set('turn', Math.PI / 2);
    expect(outfeed().distanceTo(port(t, 'toRear'))).toBeLessThan(1e-9);
    t.set('turn', -Math.PI / 2);
    expect(outfeed().distanceTo(port(t, 'toFront'))).toBeLessThan(1e-9);
    expect(topOf(t.root)).toBeCloseTo(H, 6);
  });

  it('AGV: roller deck at belt height between its two ends; status light colours', () => {
    const a = build('agvCart', { length: 1.0 });
    expect(a.ports.deck.position).toEqual([0, H, 0]);
    expect(topOf(a.root.getObjectByName('Roller deck'))).toBeLessThanOrEqual(H + 1e-6);
    const lamp = a.root.getObjectByName('Status light').material;
    a.set('light', 'wait');
    expect(lamp.emissive.getHex()).toBe(0xf0b429);
    expect(lamp.emissiveIntensity).toBeGreaterThan(0);
    a.set('light', 'off');
    expect(lamp.emissiveIntensity).toBe(0);
  });

  it('accumulation table: disc at belt height, openings in the rail at both ports', () => {
    const t = build('accumulationTable', { radius: 0.6, openingWidth: 0.3 });
    expect(topOf(t.root.getObjectByName('Disc'))).toBeCloseTo(H, 6);
    // Nothing of the rail within 0.15 m either side of the input and output.
    const blocking = [];
    t.root.updateMatrixWorld(true);
    for (const name of ['input', 'output']) {
      const p = port(t, name);
      const passage = new THREE.Box3(new THREE.Vector3(p.x - 0.1, H, -0.149), new THREE.Vector3(p.x + 0.1, H + 0.2, 0.149));
      t.root.traverse((o) => { if (o.isMesh && /Guard rail|Rail post/.test(o.name) && new THREE.Box3().setFromObject(o).intersectsBox(passage)) blocking.push(`${name}: ${o.name}`); });
    }
    expect(blocking).toEqual([]);
    expect(t.motions.spin.travel).toBeCloseTo(2 * Math.PI * 0.45, 9);
  });

  it('buffer lane: a work port per slot, a stop per slot that rises above the rollers or drops below', () => {
    const b = build('bufferLane', { slots: 4, pitch: 0.5 });
    expect(Object.keys(b.ports)).toEqual(['input', 'output', 'slot1', 'slot2', 'slot3', 'slot4']);
    expect(b.ports.slot1.position[0]).toBeCloseTo(-0.75, 9);
    expect(b.ports.slot4.position[0]).toBeCloseTo(0.75, 9);
    const block = b.root.getObjectByName('Stop block 2');
    expect(topOf(block)).toBeCloseTo(H + 0.04, 6);
    b.set('stop2', 'down');
    expect(topOf(block)).toBeCloseTo(H - 0.03, 6);
    // Stop 2 stands just inside slot 2's downstream end, between slot 2 and slot 3.
    const x = new THREE.Box3().setFromObject(block).getCenter(new THREE.Vector3()).x;
    expect(x).toBeGreaterThan(b.ports.slot2.position[0]);
    expect(x).toBeLessThan(b.ports.slot3.position[0]);
  });

  it('the transfer op drives them: a unit conveyed from the lane input to slot 2 and down the chute', () => {
    const { speed, ramp } = CONVENTIONS.conveyor;
    const lane = dryRun(registry, [{ op: 'transfer', conveyor: 'lane', to: { machine: 'lane', port: 'slot2' } }], {
      equipment: { lane: { type: 'bufferLane', params: { slots: 4, pitch: 0.5 } } },
      at: { product: { machine: 'lane', port: 'input' } },
    });
    expect(lane.duration).toBeCloseTo(trapezoidDuration(0.75, speed, ramp), 9);
    const chute = dryRun(registry, [{ op: 'transfer', conveyor: 'chute', to: { machine: 'chute', port: 'output' } }], {
      equipment: { chute: { type: 'gravityChute', params: { length: 1.2, drop: 0.3 } } },
      at: { product: { machine: 'chute', port: 'input' } },
    });
    expect(chute.duration).toBeGreaterThan(0);
  });
});
