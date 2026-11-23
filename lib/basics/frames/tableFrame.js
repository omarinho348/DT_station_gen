// Basic frame: a machine table (a top on four legs with a lower brace frame), the base of a
// bench-top machine or a manual work place. Origin at the floor under the middle of the top.
//
// Mount point `top` (the middle of the work surface) and port `surface` there, where a unit can
// be set down and worked on.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, roundedBox, box } from '../../core/primitives.js';
import { frameColor, footPlate, mountPoint } from './common.js';

const TOP = 0.04; // top thickness
const LEG = 0.06;

defineComponent({
  type: 'tableFrame',
  category: 'frame',
  summary: 'Basic machine table: a top on four braced legs; a mount point and a work port on its surface.',
  params: z.object({
    length: z.number().min(0.4).max(3).default(1.2).describe('Along X (m)'),
    depth: z.number().min(0.3).max(2).default(0.7).describe('Along Z (m)'),
    height: z.number().min(0.4).max(1.2).default(0.86).describe('Work surface above the floor (m)'),
    color: frameColor('machineGrey'),
  }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-p.depth / 2, p.depth / 2], height: p.height }),
  mount: 'floor',
  ports: (p) => ({ surface: { position: [0, p.height, 0], direction: 'work', carries: 'unit' } }),
  anchors: ['top'],
  build({ params: p, materials }) {
    const root = group(null, 'tableFrame');
    const m = materials[p.color];
    const legH = p.height - TOP;
    const lx = p.length / 2 - LEG / 2 - 0.02;
    const lz = p.depth / 2 - LEG / 2 - 0.02;
    roundedBox(root, [p.length, TOP, p.depth], [0, p.height - TOP / 2, 0], materials.stainless, 'Table top', 0.005);
    for (const [i, [x, z]] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].entries()) {
      box(root, [LEG, legH, LEG], [x, legH / 2, z], m, `Leg ${i + 1}`);
      footPlate(root, x, z, LEG * 1.4, materials, `Foot ${i + 1}`);
    }
    // Lower brace frame, 0.15 m above the floor, joining the legs.
    const braceY = 0.15;
    box(root, [2 * lx, 0.04, 0.03], [0, braceY, -lz], m, 'Brace rear');
    box(root, [2 * lx, 0.04, 0.03], [0, braceY, lz], m, 'Brace front');
    box(root, [0.03, 0.04, 2 * lz], [-lx, braceY, 0], m, 'Brace left');
    box(root, [0.03, 0.04, 2 * lz], [lx, braceY, 0], m, 'Brace right');
    const top = mountPoint(root, 'Mount top', [0, p.height, 0]);
    return { root, motions: {}, anchors: { top } };
  },
});
