import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { z } from 'zod';
import { registry } from '../../lib/components/index.js';
import { createRegistry } from '../../lib/registry.js';
import { createMaterials } from '../../lib/core/materials.js';
import { boundsOf } from '../helpers/componentChecks.js';

const materials = createMaterials();
const build = (type, params = {}) => registry.buildComponent(type, params, { materials });
const named = (inst, name) => {
  const out = [];
  inst.root.traverse((o) => o.name === name && out.push(o));
  return out;
};

describe('floorSlab', () => {
  it('is a 2 cm coating flush with the floor, 4.7 × 3.6 m by default', () => {
    const s = build('floorSlab');
    const b = boundsOf(s.root);
    expect(b.max.y).toBeCloseTo(0.001, 6); // markings 1 mm above
    expect(b.min.y).toBeCloseTo(-0.02, 6);
    expect(b.max.x - b.min.x).toBeCloseTo(4.7, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(3.6, 6);
    expect(registry.getComponent('floorSlab').sinks).toBe(0.02);
  });

  it('has four boundary lines and a walkway line 1.0 m in front of the centre', () => {
    const marks = named(build('floorSlab'), 'Floor marking');
    expect(marks).toHaveLength(5);
    expect(marks[4].position.z).toBeCloseTo(3.6 * (0.78 - 0.5), 9);
    expect(marks[4].position.z).toBeCloseTo(1.0, 1);
  });

  it('keeps the walkway inside the boundary lines at every allowed setting', () => {
    for (const depth of [2, 10]) {
      for (const walkway of [0.55, 0.9]) {
        const z = named(build('floorSlab', { depth, walkway }), 'Floor marking')[4].position.z;
        expect(Math.abs(z)).toBeLessThan(depth / 2 - 0.15);
      }
    }
  });
});

describe('guardFence', () => {
  it('uses the same panel count as the reference (3 panels for a 4.7 m slab)', () => {
    expect(named(build('guardFence'), 'Fence top rail')).toHaveLength(3);
    expect(named(build('guardFence', { length: 1 }), 'Fence top rail')).toHaveLength(2);
  });

  it('stands its posts on feet that rest on the floor', () => {
    const f = build('guardFence');
    const foot = f.root.getObjectByName('Fence foot 1');
    const post = f.root.getObjectByName('Fence post 1');
    expect(boundsOf(foot).min.y).toBeCloseTo(0, 6);
    expect(boundsOf(post).min.y).toBeCloseTo(boundsOf(foot).max.y, 6);
  });

  it('gives each panel its own mesh texture repeat', () => {
    const [a, b] = named(build('guardFence'), 'Mesh panel 1').concat(named(build('guardFence', { length: 8 }), 'Mesh panel 1'));
    expect(a.material).not.toBe(materials.fence);
    expect(a.material.map.repeat.x).not.toBe(b.material.map.repeat.x);
  });
});

describe('stationSign', () => {
  it('puts the panel at the given height on two posts that reach it', () => {
    const s = build('stationSign', { height: 3.5, width: 2.4 });
    const panel = s.root.getObjectByName('Sign panel');
    expect(panel.position.y).toBe(3.5);
    const posts = named(s, 'Sign post');
    expect(posts[0].position.x).toBeCloseTo(-1.1, 9);
    expect(posts[1].position.x).toBeCloseTo(1.1, 9);
    expect(boundsOf(posts[0]).max.y).toBeCloseTo(3.5 - 0.23, 6);
  });

  it('validates code, title and colour', () => {
    expect(() => build('stationSign', { code: 'ST10X' })).toThrow(/code/);
    expect(() => build('stationSign', { color: 'blue' })).toThrow(/color/);
    expect(build('stationSign', { code: 'ST4', title: 'Bed levelling' }).params.title).toBe('Bed levelling');
  });
});

describe('hmi', () => {
  it('faces the walkway (+Z) with its enclosure tilted back', () => {
    const h = build('hmi');
    const enc = h.root.getObjectByName('HMIEnclosure');
    expect(enc.rotation.x).toBeCloseTo(-0.32, 9);
    const screen = h.root.getObjectByName('HMI screen');
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(screen.getWorldQuaternion(new THREE.Quaternion()));
    expect(normal.z).toBeGreaterThan(0.9);
    expect(normal.y).toBeGreaterThan(0.2); // looks slightly up at the operator
  });

  it('accepts generic status data and fills defaults', () => {
    const h = build('hmi');
    expect(() => h.show('screen', { title: 'ST2 · Gantry', state: 'FRAMING' })).not.toThrow();
    expect(() => h.show('screen', { title: 'x', state: 'RUN', rows: Array(7).fill(['a', 'b']) })).toThrow(/rows/);
    expect(() => h.show('screen', { title: 'x', state: 'RUN', bar: { fraction: 2, label: '' } })).toThrow(/fraction/);
  });

  it('column meets the enclosure at every height', () => {
    for (const height of [0.9, 1.5]) {
      const h = build('hmi', { height });
      const col = boundsOf(h.root.getObjectByName('Pedestal column'));
      const enc = boundsOf(h.root.getObjectByName('Enclosure'));
      expect(col.max.y).toBeGreaterThanOrEqual(enc.min.y);
    }
  });
});

describe('workTable', () => {
  it('has its top at the given height, a work port there, and the chosen finish', () => {
    const t = build('workTable', { height: 0.95, top: 'frameDark' });
    expect(boundsOf(t.root).max.y).toBeCloseTo(0.95, 6);
    expect(t.ports.top.position).toEqual([0, 0.95, 0]);
    expect(t.root.getObjectByName('Table top').material).toBe(materials.frameDark);
  });
});

describe('registry: displays and sinks', () => {
  const base = {
    type: 'screenBox',
    category: 'station',
    summary: 'A box with a screen, for the registry tests.',
    params: z.object({}),
    footprint: () => ({ x: [-0.5, 0.5], z: [-0.5, 0.5], height: 1 }),
    mount: 'floor',
  };

  it('requires build() to provide exactly the declared displays', () => {
    const r = createRegistry();
    r.defineComponent({
      ...base,
      displays: { screen: { schema: z.object({ text: z.string() }), sample: { text: 'hi' } } },
      build: () => ({ root: new THREE.Group(), motions: {} }),
    });
    expect(() => r.buildComponent('screenBox')).toThrow(/displays mismatch \(missing: screen/);
  });

  it('shows the sample at build time and validates later data', () => {
    const r = createRegistry();
    const shown = [];
    r.defineComponent({
      ...base,
      displays: { screen: { schema: z.object({ text: z.string().max(5) }), sample: { text: 'hi' } } },
      build: () => ({ root: new THREE.Group(), motions: {}, displays: { screen: (d) => shown.push(d.text) } }),
    });
    const inst = r.buildComponent('screenBox');
    expect(shown).toEqual(['hi']);
    inst.show('screen', { text: 'ok' });
    expect(shown).toEqual(['hi', 'ok']);
    expect(() => inst.show('screen', { text: 'too long' })).toThrow(/screenBox".screen display/);
    expect(() => inst.show('nope', {})).toThrow(/no display "nope"/);
  });

  it('limits sinks to 5 cm', () => {
    const r = createRegistry();
    expect(() => r.defineComponent({ ...base, sinks: 0.2, build: () => ({ root: new THREE.Group() }) })).toThrow(/sinks/);
  });
});
