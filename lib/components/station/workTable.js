// Plain work table with a steel top. Origin at floor, centre of the table.
// Ported from the reference LineEquipment.createTable.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, roundedBox } from '../../core/primitives.js';

defineComponent({
  type: 'workTable',
  category: 'fixture',
  summary: 'Plain work table with a steel top, four legs and side rails.',
  params: z.object({
    length: z.number().min(0.5).max(3).default(1.2).describe('Length along X (m)'),
    width: z.number().min(0.4).max(1.5).default(0.7).describe('Width along Z (m)'),
    height: z.number().min(0.6).max(1.1).default(0.9).describe('Top height (m)'),
    top: z.enum(['stainless', 'brushed', 'aluminium', 'frameDark']).default('stainless').describe('Top finish'),
  }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-p.width / 2, p.width / 2], height: p.height }),
  mount: 'floor',
  ports: (p) => ({ top: { position: [0, p.height, 0], direction: 'work', carries: 'unit' } }),
  build({ params, materials }) {
    const { length, width, height, top } = params;
    const root = group(null, 'workTable');
    roundedBox(root, [length, 0.04, width], [0, height - 0.02, 0], materials[top], 'Table top', 0.006);
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      box(root, [0.05, height - 0.04, 0.05], [sx * (length / 2 - 0.06), (height - 0.04) / 2, sz * (width / 2 - 0.06)], materials.frame, 'Table leg');
    }));
    box(root, [length - 0.12, 0.04, 0.04], [0, 0.18, width / 2 - 0.06], materials.frame, 'Table rail');
    box(root, [length - 0.12, 0.04, 0.04], [0, 0.18, -width / 2 + 0.06], materials.frame, 'Table rail');
    return { root, motions: {} };
  },
});
