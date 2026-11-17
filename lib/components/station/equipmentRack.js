// Equipment rack: a dark cabinet with rack-mounted units on its front (test instruments,
// controllers, power supplies). Ported from the reference ST4 CalibrationEquipment.js
// ("Test rack" behind the enclosure). Origin at floor, centre; the front faces +Z.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, roundedBox } from '../../core/primitives.js';

const FIRST_UNIT = 0.5;

defineComponent({
  type: 'equipmentRack',
  category: 'station',
  summary: 'Equipment rack cabinet with rack-mounted units on the front (instruments, controllers, power).',
  params: z.object({
    width: z.number().min(0.4).max(1.2).default(0.6).describe('Width (m)'),
    height: z.number().min(1).max(2.4).default(1.8).describe('Height (m)'),
    depth: z.number().min(0.3).max(1).default(0.5).describe('Depth (m)'),
    units: z.number().int().min(0).max(10).default(5).describe('Rack units shown'),
  }),
  footprint: (p) => ({ x: [-p.width / 2, p.width / 2], z: [-p.depth / 2, p.depth / 2 + 0.01], height: p.height }),
  mount: 'floor',
  build({ params, materials }) {
    const { width, height, depth, units } = params;
    const root = group(null, 'equipmentRack');
    roundedBox(root, [width, height, depth], [0, height / 2, 0], materials.darkPanel, 'Rack cabinet', 0.02);
    // Reference: 5 units 0.25 m apart from 0.5 m; closer together when more fit a shorter rack.
    // The top unit stays at least 0.3 m under the cabinet top (1.5 m on the 1.8 m reference rack).
    const pitch = units > 1 ? Math.min(0.25, (height - 0.3 - FIRST_UNIT) / (units - 1)) : 0.25;
    const unitHeight = Math.min(0.06, pitch * 0.8);
    for (let i = 0; i < units; i += 1) {
      box(root, [width - 0.1, unitHeight, 0.01], [0, FIRST_UNIT + i * pitch, depth / 2 + 0.005], materials.machineGrey, 'Rack unit');
    }
    return { root, motions: {} };
  },
});
