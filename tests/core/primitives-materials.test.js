import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  group, addMesh, box, roundedBox, roundedBoxGeometry, cylinder, cylinderGeometry, cylinderBetween, pipeRun, flange,
} from '../../lib/core/primitives.js';
import { createMaterials, disposeMaterials, createLampMaterial, setLamp } from '../../lib/core/materials.js';
import { seededRandom, drawBelt, drawWireMesh, canvasTexture } from '../../lib/core/textures.js';

const mat = new THREE.MeshStandardMaterial();
const sizeOf = (object) => new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
const finite = (geometry) => Array.from(geometry.attributes.position.array).every(Number.isFinite);

describe('primitives', () => {
  it('group and addMesh name, place and parent objects, with shadows on', () => {
    const root = group(null, 'root');
    const g = group(root, 'child', [1, 2, 3]);
    expect(g.parent).toBe(root);
    expect(g.position.toArray()).toEqual([1, 2, 3]);
    const mesh = addMesh(g, new THREE.BoxGeometry(1, 1, 1), mat, 'cube', [0, 0.5, 0]);
    expect(mesh).toMatchObject({ name: 'cube', castShadow: true, receiveShadow: true });
    expect(addMesh(g, new THREE.BoxGeometry(1, 1, 1), mat, 'glass', null, { castShadow: false }).castShadow).toBe(false);
  });

  it('box and roundedBox have the requested size', () => {
    const root = group(null, 'root');
    expect(sizeOf(box(root, [1, 2, 3], [0, 0, 0], mat, 'b')).toArray()).toEqual([1, 2, 3]);
    const size = sizeOf(roundedBox(root, [0.4, 0.2, 0.6], [0, 0, 0], mat, 'rb', 0.02));
    expect(size.x).toBeCloseTo(0.4, 5);
    expect(size.y).toBeCloseTo(0.2, 5);
    expect(size.z).toBeCloseTo(0.6, 5);
  });

  it('roundedBox clamps the radius so thin plates stay valid', () => {
    const thin = roundedBoxGeometry([1, 0.002, 1], 0.05);
    expect(finite(thin)).toBe(true);
    thin.computeBoundingBox();
    expect(thin.boundingBox.max.y - thin.boundingBox.min.y).toBeCloseTo(0.002, 6);
  });

  it('cylinders point along the requested axis', () => {
    const along = (axis) => {
      const g = cylinderGeometry(0.1, 2, { axis });
      g.computeBoundingBox();
      return g.boundingBox.getSize(new THREE.Vector3());
    };
    expect(along('y').y).toBeCloseTo(2, 6);
    expect(along('x').x).toBeCloseTo(2, 6);
    expect(along('z').z).toBeCloseTo(2, 6);
    const c = cylinder(group(null, 'r'), 0.1, 1, [0, 0.5, 0], mat, 'post');
    expect(c.name).toBe('post');
  });

  it('cylinderBetween spans exactly from one point to the other', () => {
    const root = group(null, 'root');
    const rod = cylinderBetween(root, [0, 0, 0], [3, 4, 0], 0.01, mat, 'rod');
    expect(rod.geometry.parameters.height).toBeCloseTo(5, 9);
    expect(rod.position.toArray()).toEqual([1.5, 2, 0]);
    const tip = new THREE.Vector3(0, 2.5, 0).applyQuaternion(rod.quaternion).add(rod.position);
    expect(tip.distanceTo(new THREE.Vector3(3, 4, 0))).toBeLessThan(1e-9);
  });

  it('pipeRun makes one segment per leg and one elbow per bend, all named', () => {
    const run = pipeRun(group(null, 'root'), [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]], 0.03, mat, 'pipe');
    expect(run.children.map((c) => c.name)).toEqual([
      'pipe segment 1', 'pipe segment 2', 'pipe segment 3', 'pipe elbow 1', 'pipe elbow 2',
    ]);
    expect(flange(run, 0.05, [0, 0, 0], mat, 'pipe flange', 'x').name).toBe('pipe flange');
  });
});

describe('materials', () => {
  it('builds headless, with every material named after its key', () => {
    const m = createMaterials();
    const keys = Object.keys(m);
    expect(keys.length).toBe(28);
    for (const key of keys) {
      expect(m[key].isMaterial).toBe(true);
      expect(m[key].name).toBe(key);
    }
    for (const key of ['stainless', 'frame', 'belt', 'guard', 'fence', 'floor', 'floorLine', 'rubber', 'emergency']) {
      expect(keys).toContain(key);
    }
    expect(m.belt.map.isTexture).toBe(true);
    expect(m.fence.alphaTest).toBe(0.5);
    expect(m.guard.transparent).toBe(true);
    disposeMaterials(m);
  });

  it('gives each call its own set (lines do not share state)', () => {
    const a = createMaterials();
    const b = createMaterials();
    expect(a.frame).not.toBe(b.frame);
  });

  it('lamps start off and switch on and off', () => {
    const lamp = createLampMaterial(0x2fbf4f);
    expect(lamp.emissiveIntensity).toBe(0);
    expect(lamp.userData.on).toBe(false);
    const dim = lamp.color.g;
    setLamp(lamp, true);
    expect(lamp.emissiveIntensity).toBe(1.6);
    expect(lamp.color.g).toBeGreaterThan(dim);
    setLamp(lamp, true, 3);
    expect(lamp.emissiveIntensity).toBe(3);
    setLamp(lamp, false);
    expect(lamp.emissiveIntensity).toBe(0);
    expect(lamp.color.g).toBeCloseTo(dim, 9);
  });
});

describe('textures', () => {
  // A stand-in for a 2D canvas context that records every draw call.
  function fakeContext() {
    const calls = [];
    return {
      calls,
      set fillStyle(v) { calls.push(`fill=${v}`); },
      fillRect: (...a) => calls.push(`rect ${a.join(',')}`),
      clearRect: (...a) => calls.push(`clear ${a.join(',')}`),
    };
  }

  it('seededRandom is repeatable and stays in [0, 1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    const seqA = Array.from({ length: 50 }, a);
    expect(Array.from({ length: 50 }, b)).toEqual(seqA);
    expect(Array.from({ length: 50 }, c)).not.toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('draws the same belt every time and never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random is not allowed');
    });
    try {
      const one = fakeContext();
      const two = fakeContext();
      drawBelt(one, 256, 64);
      drawBelt(two, 256, 64);
      expect(one.calls.length).toBeGreaterThan(2000);
      expect(two.calls).toEqual(one.calls);
      const mesh = fakeContext();
      drawWireMesh(mesh, 128, 128);
      expect(mesh.calls[0]).toBe('clear 0,0,128,128');
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to a 1×1 texture when there is no DOM', () => {
    const texture = canvasTexture(64, 64, () => { throw new Error('must not draw headless'); }, { fallback: [1, 2, 3, 255] });
    expect(texture.userData.headless).toBe(true);
    expect(Array.from(texture.image.data)).toEqual([1, 2, 3, 255]);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
