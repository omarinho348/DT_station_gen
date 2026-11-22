// Top packing foam: a foam slab laid over the packed product, optionally carrying an accessory box
// (cables, tools, manual). From the reference ST6 createFoam. Origin at the centre of its underside.
import * as THREE from 'three';
import { z } from 'zod';
import { defineProduct } from '../../registry.js';

defineProduct({
  type: 'packingFoam',
  summary: 'Top packing foam slab with an optional accessory box on it, laid into a carton over the product.',
  params: z.object({
    length: z.number().min(0.1).max(1.5).default(0.57).describe('Length along X (m)'),
    width: z.number().min(0.1).max(1.2).default(0.51).describe('Width along Z (m)'),
    thickness: z.number().min(0.01).max(0.2).default(0.05).describe('Thickness (m)'),
    accessoryBox: z.boolean().default(true).describe('Accessory box on top'),
  }),
  stages: ['ready'],
  refs: ['grasp'],
  build({ params }) {
    const { length, width, thickness, accessoryBox } = params;
    const own = [];
    const mesh = (parent, size, color, name, position) => {
      const geometry = new THREE.BoxGeometry(...size);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      material.name = `${name} material`;
      own.push(geometry, material);
      const m = new THREE.Mesh(geometry, material);
      m.name = name;
      m.position.set(...position);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    const root = new THREE.Group();
    root.name = 'Packing foam';
    mesh(root, [length, thickness, width], 0xe9e6dc, 'Foam slab', [0, thickness / 2, 0]);
    if (accessoryBox) mesh(root, [0.2, 0.03, 0.14], 0xb8793c, 'Accessory box', [Math.min(0.12, length / 2 - 0.1), thickness + 0.015, Math.min(0.1, width / 2 - 0.07)]);
    return {
      root,
      setStage() {},
      refs: { grasp: () => new THREE.Vector3(0, thickness - 0.02, 0) },
      dispose() {
        root.removeFromParent();
        own.forEach((o) => o.dispose());
      },
    };
  },
});
