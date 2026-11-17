// Keep-out marking painted on the floor around a robot base: a ring (or a full disc when the
// band is as wide as the radius). From the reference KittingEquipment.js "Robot keep-out ring".
// Origin at its centre on the floor.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group } from '../../core/primitives.js';

const PAINT_Y = 0.001; // just above the floor; the floor-line material's polygon offset wins the depth test

defineComponent({
  type: 'keepOutRing',
  category: 'station',
  summary: 'Keep-out marking painted on the floor around a robot: a ring, or a full disc.',
  params: z.object({
    radius: z.number().min(0.15).max(3).default(0.2).describe('Outer radius (m)'),
    band: z.number().min(0.02).max(3).default(0.2).describe('Band width (m); = radius for a full disc'),
  }).refine((p) => p.band <= p.radius + 1e-9, { message: 'band cannot be wider than the radius', path: ['band'] }),
  footprint: (p) => ({ x: [-p.radius, p.radius], z: [-p.radius, p.radius], height: 0.002 }),
  mount: 'floor',
  build({ params, materials }) {
    const root = group(null, 'keepOutRing');
    const inner = Math.max(0, params.radius - params.band);
    const geometry = new THREE.RingGeometry(inner, params.radius, 64, 1);
    geometry.rotateX(-Math.PI / 2); // face up
    const ring = new THREE.Mesh(geometry, materials.floorLine);
    ring.name = 'Keep-out ring';
    ring.position.y = PAINT_Y;
    ring.receiveShadow = true;
    root.add(ring);
    return { root, motions: {} };
  },
});
