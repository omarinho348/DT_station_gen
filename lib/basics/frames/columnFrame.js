// Basic frame: a single column on a base plate, the stand of a camera, a light curtain, a
// screwdriver balancer or a cantilevered tool. Origin at the floor under the column's axis.
//
// Mount points: `top` (on the column's top cap) and `side` (on its +Z face at `mountHeight`,
// facing +Z, for an arm or a sensor reaching over the conveyor).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, roundedBox, box } from '../../core/primitives.js';
import { frameColor, mountPoint } from './common.js';

defineComponent({
  type: 'columnFrame',
  category: 'frame',
  summary: 'Basic column on a base plate, with mount points on its top and on its side at a set height.',
  params: z.object({
    height: z.number().min(0.4).max(3).default(1.5).describe('Column height (m)'),
    section: z.number().min(0.06).max(0.25).default(0.12).describe('Column section (m)'),
    mountHeight: z.number().min(0.2).max(3).default(1.2).describe('Height of the side mount point (m)'),
    color: frameColor('machineGrey'),
  }).refine((p) => p.mountHeight <= p.height, { message: 'mountHeight cannot be above the column top', path: ['mountHeight'] }),
  footprint: (p) => {
    const half = p.section * 1.25;
    return { x: [-half, half], z: [-half, half], height: p.height + 0.012 };
  },
  mount: 'floor',
  anchors: ['top', 'side'],
  build({ params: p, materials }) {
    const root = group(null, 'columnFrame');
    const m = materials[p.color];
    const s = p.section;
    box(root, [s * 2.5, 0.015, s * 2.5], [0, 0.0075, 0], materials.stainless, 'Base plate');
    roundedBox(root, [s, p.height - 0.015, s], [0, 0.015 + (p.height - 0.015) / 2, 0], m, 'Column', 0.006);
    box(root, [s * 1.1, 0.012, s * 1.1], [0, p.height + 0.006, 0], materials.stainless, 'Top cap');
    const top = mountPoint(root, 'Mount top', [0, p.height + 0.012, 0]);
    const side = mountPoint(root, 'Mount side', [0, p.mountHeight, s / 2]);
    return { root, motions: {}, anchors: { top, side } };
  },
});
