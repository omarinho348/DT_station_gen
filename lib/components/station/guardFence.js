// Machine guard fence: yellow posts with wire-mesh panels and rails, running along X.
// Ported from the fence part of the reference StationBase.js.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, roundedBox } from '../../core/primitives.js';

const FOOT = 0.012;
const MESH_TILE = 0.4;

defineComponent({
  type: 'guardFence',
  category: 'station',
  summary: 'Safety guard fence: yellow posts and rails with wire-mesh panels, running along X.',
  params: z.object({
    length: z.number().min(1).max(20).default(4.1).describe('Length along X (m)'),
    height: z.number().min(1.2).max(2.6).default(2.0).describe('Height (m)'),
    panelWidth: z.number().min(0.8).max(2.4).default(1.6).describe('Target panel width (m)'),
  }),
  footprint: (p) => ({ x: [-p.length / 2 - 0.07, p.length / 2 + 0.07], z: [-0.07, 0.07], height: p.height + 0.02 }),
  mount: 'floor',
  build({ params, materials }) {
    const { length, height } = params;
    const root = group(null, 'guardFence');
    // Same panel count as the reference for a slab of (length + 0.6) m.
    const panelCount = Math.max(2, Math.round((length + 0.6) / params.panelWidth));
    const panelWidth = length / panelCount;
    for (let index = 0; index <= panelCount; index += 1) {
      const x = -length / 2 + index * panelWidth;
      // Feet on the floor, posts on the feet. The reference had the feet 20 mm up (on top of a
      // slab thickness, but the slab top is flush with the floor), so the whole fence floated.
      roundedBox(root, [0.06, height, 0.06], [x, height / 2 + FOOT, 0], materials.safetyYellow, `Fence post ${index + 1}`, 0.008);
      roundedBox(root, [0.14, FOOT, 0.14], [x, FOOT / 2, 0], materials.safetyYellow, `Fence foot ${index + 1}`, 0.004);
      if (index === panelCount) continue;
      const panelMaterial = materials.fence.clone();
      panelMaterial.map = materials.fence.map.clone();
      // The mesh texture has 8 wires per tile; one tile per 0.4 m gives a 50 mm grid like real
      // fencing. The reference's 0.05 m tile put wires 6 mm apart, which blurs away to nothing.
      panelMaterial.map.repeat.set(panelWidth / MESH_TILE, (height - 0.25) / MESH_TILE);
      panelMaterial.map.needsUpdate = true;
      addMesh(root, new THREE.PlaneGeometry(panelWidth - 0.08, height - 0.25), panelMaterial, `Mesh panel ${index + 1}`, [x + panelWidth / 2, 0.15 + (height - 0.25) / 2, 0], { castShadow: false });
      roundedBox(root, [panelWidth - 0.06, 0.03, 0.03], [x + panelWidth / 2, height - 0.08, 0], materials.safetyYellow, 'Fence top rail', 0.006);
      roundedBox(root, [panelWidth - 0.06, 0.03, 0.03], [x + panelWidth / 2, 0.14, 0], materials.safetyYellow, 'Fence bottom rail', 0.006);
    }
    return { root, motions: {} };
  },
});
