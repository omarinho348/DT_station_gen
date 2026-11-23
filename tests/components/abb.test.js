// The optional ABB IRB 6760 (Phase 5 step 7d): reference model + rig + generic IK, driven through
// the same tool interface as the procedural palletizer.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { z } from 'zod';
import { registry } from '../../lib/components/index.js';
import { createRegistry, RegistryError } from '../../lib/registry.js';
import { createMaterials } from '../../lib/core/materials.js';
import { preloadComponentAssets, isAssetLoaded } from '../../lib/core/assets.js';
import { ABB_IRB6760_RIG } from '../../lib/components/robots/abb/abbIrb6760Rig.js';

const materials = createMaterials();
const ctx = { materials, beltHeight: 0.82 };
await preloadComponentAssets(registry);
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const go = (r, t) => { for (const k of ['x', 'y', 'z', 'yaw']) r.set(k, t[k]); };
const TOL = 0.002; // m: the IK stops within 0.2 mm × the model size (≈ 1 mm here)

describe('abbIrb6760', () => {
  it('loads the reference model and rig: six axes with the reference limits, a balancer that follows axis 2', () => {
    expect(isAssetLoaded('abbIrb6760.glb')).toBe(true);
    const limits = ABB_IRB6760_RIG.joints.filter((j) => /^axis\d$/.test(j.id)).map((j) => [j.min, j.max]);
    expect(limits).toEqual([[-170, 170], [-65, 85], [-180, 70], [-300, 300], [-130, 130], [-360, 360]]);
    const r = registry.buildComponent('abbIrb6760', {}, ctx);
    for (const n of ['Link1', 'Link2', 'Link3', 'Link6', 'LinkD1', 'LinkD2']) expect(r.root.getObjectByName(n)).toBeDefined();
    expect(r.anchors).toEqual(['tool']);
    r.dispose();
  });

  it('puts the vacuum pad on reachable targets, pointing straight down, with the commanded yaw', () => {
    const r = registry.buildComponent('abbIrb6760', {}, ctx);
    const tool = r.anchor('tool');
    for (const t of [
      { x: 1.8, y: 1.2, z: 0, yaw: 0 },
      { x: 1.6, y: 0.82 + 0.42, z: 0, yaw: Math.PI / 2 }, // pick from a 0.82 m conveyor
      { x: 0.6, y: 0.6, z: -2.2, yaw: -0.5 },
      { x: -1.0, y: 1.8, z: 1.6, yaw: 2.5 },
    ]) {
      go(r, t);
      expect(r.root.userData.lastSolve.reached, JSON.stringify(t)).toBe(true);
      expect(worldOf(tool).distanceTo(new THREE.Vector3(t.x, t.y, t.z))).toBeLessThan(TOL);
      const q = tool.getWorldQuaternion(new THREE.Quaternion());
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).y).toBeGreaterThan(Math.cos(1 * Math.PI / 180)); // within 1°
      const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const yaw = Math.atan2(-x.z, x.x);
      expect(Math.abs(Math.atan2(Math.sin(yaw - t.yaw), Math.cos(yaw - t.yaw)))).toBeLessThan(1 * Math.PI / 180);
    }
    r.dispose();
  });

  it('reaches every cell of a reference 3 × 3 × 3 pallet pattern 2 m beside it', () => {
    const r = registry.buildComponent('abbIrb6760', {}, ctx);
    const misses = [];
    for (let layer = 0; layer < 3; layer += 1) for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) {
      const t = { x: (col - 1) * 0.64, y: 0.144 + (layer + 1) * 0.42, z: -2.0 + (row - 1) * 0.44, yaw: 0 };
      go(r, t);
      if (!r.root.userData.lastSolve.reached || worldOf(r.anchor('tool')).distanceTo(new THREE.Vector3(t.x, t.y, t.z)) > TOL) misses.push(t);
    }
    expect(misses).toEqual([]);
    r.dispose();
  });

  it('out of reach: stays finite and says so', () => {
    const r = registry.buildComponent('abbIrb6760', {}, ctx);
    go(r, { x: 3.0, y: 0.2, z: 3.0, yaw: 0 });
    expect(r.root.userData.lastSolve.reached).toBe(false);
    const at = worldOf(r.anchor('tool'));
    expect([at.x, at.y, at.z].every(Number.isFinite)).toBe(true);
    r.dispose();
  });

  it('two robots share the cached model; disposing one leaves the other\'s geometry and materials alone', () => {
    const a = registry.buildComponent('abbIrb6760', {}, ctx);
    const b = registry.buildComponent('abbIrb6760', {}, ctx);
    const meshA = a.root.getObjectByName('Link2').getObjectByProperty('isMesh', true);
    const meshB = b.root.getObjectByName('Link2').getObjectByProperty('isMesh', true);
    expect(meshA.geometry).toBe(meshB.geometry);
    let freed = 0;
    meshB.geometry.addEventListener('dispose', () => { freed += 1; });
    [meshB.material].flat()[0].addEventListener('dispose', () => { freed += 1; });
    a.dispose();
    expect(freed).toBe(0);
    b.dispose();
  });

  it('a component whose model is not loaded refuses to build, saying what to do', () => {
    const r = createRegistry();
    r.defineComponent({
      type: 'modelThing', category: 'machine', summary: 'Test component built from a model file.', params: z.object({}),
      footprint: () => ({ x: [0, 1], z: [0, 1], height: 1 }), mount: 'floor', assets: ['notThere.glb'],
      build: () => ({ root: new THREE.Group(), motions: {} }),
    });
    expect(() => r.buildComponent('modelThing', {}, { materials })).toThrow(RegistryError);
    expect(() => r.buildComponent('modelThing', {}, { materials })).toThrow(/needs its model loaded first \(notThere\.glb\).*preloadComponentAssets/);
  });
});
