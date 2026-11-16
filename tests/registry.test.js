import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { z } from 'zod';
import { createRegistry, paramFields, paramSamples, RegistryError } from '../lib/registry.js';
import { registry } from '../lib/components/index.js';
import { createMaterials } from '../lib/core/materials.js';
import { floatingMeshes, footprintViolations } from './helpers/componentChecks.js';

const box = (name, y = 0.5) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  m.name = name;
  m.position.y = y;
  return m;
};

function sampleDef(overrides = {}) {
  return {
    type: 'testBlock',
    category: 'fixture',
    summary: 'A test block used only by the registry tests.',
    params: z.object({ size: z.number().min(0.5).max(2).default(1), lid: z.boolean().default(false) }),
    footprint: (p) => ({ x: [-p.size / 2, p.size / 2], z: [-p.size / 2, p.size / 2], height: p.size }),
    mount: 'floor',
    motions: { open: { range: [0, 1] }, light: { values: ['off', 'on'] } },
    build({ params }) {
      const root = new THREE.Group();
      const body = box('Body', params.size / 2);
      body.scale.setScalar(params.size);
      root.add(body);
      let open = 0;
      return { root, motions: { open: (v) => (open = v), light: () => {} }, get open() { return open; } };
    },
    ...overrides,
  };
}

describe('registry: definitions', () => {
  it('accepts a valid component and fills defaults', () => {
    const r = createRegistry();
    const def = r.defineComponent(sampleDef());
    expect(def.ops).toEqual([]);
    expect(def.ports).toEqual({});
    expect(r.components().map((d) => d.type)).toEqual(['testBlock']);
  });

  it('rejects bad definitions with a clear message', () => {
    const r = createRegistry();
    expect(() => r.defineComponent(sampleDef({ type: 'Bad Name' }))).toThrow(/camelCase/);
    expect(() => r.defineComponent(sampleDef({ category: 'spaceship' }))).toThrow(RegistryError);
    expect(() => r.defineComponent(sampleDef({ params: { size: 1 } }))).toThrow(/z\.object/);
    expect(() => r.defineComponent(sampleDef({ build: 'nope' }))).toThrow(/build must be a function/);
    expect(() => r.defineComponent(sampleDef({ motions: { open: { range: [0, 1], speed: 2 } } }))).toThrow(RegistryError);
  });

  it('rejects duplicates', () => {
    const r = createRegistry();
    r.defineComponent(sampleDef());
    expect(() => r.defineComponent(sampleDef())).toThrow(/Duplicate component "testBlock"/);
  });

  it('validates ops and products too', () => {
    const r = createRegistry();
    r.defineOp({ op: 'wait', summary: 'Wait for a fixed time.', args: z.object({ seconds: z.number() }), duration: (a) => a.seconds, expand() {} });
    expect(r.getOp('wait').needs).toEqual({});
    expect(() => r.defineOp({ op: 'x', summary: 'short', args: z.object({}), duration() {}, expand() {} })).toThrow(RegistryError);
    r.defineProduct({ type: 'cube', summary: 'A plain cube product for tests.', params: z.object({}), stages: ['raw', 'done'], build() {} });
    expect(r.getProduct('cube').refs).toEqual([]);
  });
});

describe('registry: building', () => {
  it('validates params, applies defaults and starts motions at their defaults', () => {
    const r = createRegistry();
    r.defineComponent(sampleDef());
    const inst = r.buildComponent('testBlock');
    expect(inst.params).toEqual({ size: 1, lid: false });
    expect(inst.state).toEqual({ open: 0, light: 'off' });
    expect(inst.root.name).toBe('testBlock');
    expect(inst.root.userData.component).toBe('testBlock');
    expect(() => r.buildComponent('testBlock', { size: 9 })).toThrow(/Invalid params for "testBlock"/);
    expect(() => r.buildComponent('nope')).toThrow(/Unknown component type "nope"/);
  });

  it('checks motion values', () => {
    const r = createRegistry();
    r.defineComponent(sampleDef());
    const inst = r.buildComponent('testBlock');
    inst.set('open', 0.5);
    expect(inst.state.open).toBe(0.5);
    expect(() => inst.set('open', 1.5)).toThrow(/\[0, 1\]/);
    expect(() => inst.set('light', 'blink')).toThrow(/off \| on/);
    expect(() => inst.set('spin', 1)).toThrow(/no motion "spin"/);
  });

  it('catches build() returning motions that do not match the declaration', () => {
    const r = createRegistry();
    r.defineComponent(sampleDef({ build: () => ({ root: new THREE.Group(), motions: { open() {}, extra() {} } }) }));
    expect(() => r.buildComponent('testBlock')).toThrow(/missing: light; undeclared: extra/);
  });

  it('dispose frees own materials but keeps shared ones', () => {
    const r = createRegistry();
    const materials = createMaterials();
    let own;
    r.defineComponent(sampleDef({
      motions: {},
      build: ({ materials: m }) => {
        const root = new THREE.Group();
        own = new THREE.MeshBasicMaterial();
        const a = box('Shared'); a.material = m.frame;
        const b = box('Own'); b.material = own;
        root.add(a, b);
        return { root, motions: {} };
      },
    }));
    const inst = r.buildComponent('testBlock', {}, { materials });
    let disposed = [];
    own.addEventListener('dispose', () => disposed.push('own'));
    materials.frame.addEventListener('dispose', () => disposed.push('shared'));
    inst.dispose();
    expect(disposed).toEqual(['own']);
  });
});

describe('param introspection', () => {
  const schema = z.object({
    heads: z.number().int().min(1).max(8).default(4).describe('Filling heads'),
    speed: z.number().min(0.1).max(2).default(0.5),
    guard: z.boolean().default(true),
    side: z.enum(['left', 'right']).default('left'),
  });

  it('lists fields with kind, range, step and label', () => {
    expect(paramFields(schema)).toEqual([
      { key: 'heads', label: 'Filling heads', default: 4, kind: 'integer', min: 1, max: 8, step: 1 },
      { key: 'speed', label: 'speed', default: 0.5, kind: 'number', min: 0.1, max: 2, step: 0.02 },
      { key: 'guard', label: 'guard', default: true, kind: 'boolean' },
      { key: 'side', label: 'side', default: 'left', kind: 'enum', options: ['left', 'right'] },
    ]);
  });

  it('gives default / min / max samples', () => {
    expect(paramSamples(schema)).toEqual({
      default: { heads: 4, speed: 0.5, guard: true, side: 'left' },
      min: { heads: 1, speed: 0.1, guard: true, side: 'left' },
      max: { heads: 8, speed: 2, guard: false, side: 'right' },
    });
  });
});

describe('component checks catch real mistakes', () => {
  it('floatingMeshes finds a part hanging in the air', () => {
    const root = new THREE.Group();
    root.add(box('Grounded', 0.5), box('Stacked', 1.5), box('Floating', 3.2));
    expect(floatingMeshes(root)).toEqual(['Floating']);
  });

  it('footprintViolations finds a part outside the footprint', () => {
    const root = new THREE.Group();
    const b = box('Wide');
    b.position.x = 1;
    root.add(b);
    expect(footprintViolations(root, { x: [-0.5, 0.5], z: [-0.5, 0.5], height: 1 })).toEqual(['max.x 1.5000 > 0.5']);
  });
});

describe('stackLight', () => {
  const materials = createMaterials();
  const lampsOn = (inst) => {
    const on = [];
    inst.root.traverse((o) => o.name.startsWith('Lamp ') && o.material.userData.on && on.push(o.name.slice(5)));
    return on;
  };

  it('lights exactly the lamp for each mode', () => {
    const inst = registry.buildComponent('stackLight', {}, { materials });
    expect(lampsOn(inst)).toEqual([]);
    inst.set('mode', 'run');
    expect(lampsOn(inst)).toEqual(['green']);
    inst.set('mode', 'wait');
    expect(lampsOn(inst)).toEqual(['amber']);
    inst.set('mode', 'alarm');
    expect(lampsOn(inst)).toEqual(['red']);
    inst.set('mode', 'off');
    expect(lampsOn(inst)).toEqual([]);
  });

  it('matches the reference geometry at default height', () => {
    const inst = registry.buildComponent('stackLight', {}, { materials });
    const byName = Object.fromEntries(inst.root.children.map((c) => [c.name, c]));
    expect(byName['Lamp red'].position.y).toBeCloseTo(2.06, 9);
    expect(byName['Lamp green'].position.y).toBeCloseTo(2.1 - 0.04 - 2 * 0.085, 9);
    expect(byName.Buzzer.position.y).toBeCloseTo(1.8, 9);
    expect(byName.Cap.position.y).toBeCloseTo(2.106, 9);
  });

  it('needs its core tube: without it (as in the reference) the lamps float', () => {
    const inst = registry.buildComponent('stackLight', {}, { materials });
    expect(floatingMeshes(inst.root)).toEqual([]);
    inst.root.getObjectByName('Core').removeFromParent();
    expect(floatingMeshes(inst.root)).toEqual(['Lamp red', 'Lamp amber', 'Lamp green', 'Cap']);
  });

  it('can be built without a buzzer', () => {
    const inst = registry.buildComponent('stackLight', { buzzer: false }, { materials });
    expect(inst.root.getObjectByName('Buzzer')).toBeUndefined();
  });
});
