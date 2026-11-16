// Epoxy floor slab of a station cell with safety-yellow boundary and walkway markings.
// Ported from the floor part of the reference StationBase.js (the fence is its own component).
// The slab top is flush with the hall floor (y = 0) like a floor coating; the floor material's
// polygon offset keeps it from z-fighting with the hall floor.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh } from '../../core/primitives.js';

const THICKNESS = 0.02;
const INSET = 0.15;

defineComponent({
  type: 'floorSlab',
  category: 'station',
  summary: 'Epoxy floor slab for a station cell with yellow boundary lines and an operator walkway line.',
  params: z.object({
    length: z.number().min(1).max(20).default(4.7).describe('Length along X (m)'),
    depth: z.number().min(2).max(10).default(3.6).describe('Depth along Z (m)'),
    // Position across the depth (0 = back edge, 1 = front edge), so every allowed value stays
    // inside the boundary lines. Default puts it 1.0 m in front of the slab centre.
    walkway: z.number().min(0.55).max(0.9).default(0.78).describe('Walkway line across the depth (0 back … 1 front)'),
  }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-p.depth / 2, p.depth / 2], height: 0.002 }),
  mount: 'floor',
  sinks: THICKNESS,
  build({ params, materials }) {
    const { length, depth, walkway } = params;
    const walkwayZ = depth * (walkway - 0.5);
    const root = group(null, 'floorSlab');
    const slab = addMesh(root, new THREE.BoxGeometry(length, THICKNESS, depth), materials.floor, 'Floor slab', [0, -THICKNESS / 2, 0], { castShadow: false });
    slab.receiveShadow = true;

    // Markings 1 mm above the slab; the floorLine material's polygon offset wins the depth test.
    const line = (len, thickness, x, z, alongZ = false) => {
      const mesh = addMesh(root, new THREE.PlaneGeometry(alongZ ? thickness : len, alongZ ? len : thickness), materials.floorLine, 'Floor marking', [x, 0.001, z], { castShadow: false });
      mesh.rotation.x = -Math.PI / 2;
    };
    line(length - INSET * 2, 0.07, 0, -depth / 2 + INSET);
    line(length - INSET * 2, 0.07, 0, depth / 2 - INSET);
    line(depth - INSET * 2, 0.07, -length / 2 + INSET, 0, true);
    line(depth - INSET * 2, 0.07, length / 2 - INSET, 0, true);
    line(length - INSET * 4, 0.05, 0, walkwayZ); // operator walkway edge in front of the line
    return { root, motions: {} };
  },
});
