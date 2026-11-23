// Basic frame: a column behind the conveyor (on −Z, the equipment side) with an arm reaching
// across the flow towards +Z, the way a print head, a camera or a single nozzle is held over a
// belt from one side. Origin at the floor under the arm's tip; the column stands `reach` behind it.
//
// Mount points: `tip` (under the end of the arm, for a tool hanging down) and `armTop` (on top of
// the arm, half way along, for a drive or a valve block).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, roundedBox, box } from '../../core/primitives.js';
import { frameColor, mountPoint } from './common.js';

defineComponent({
  type: 'cantileverFrame',
  category: 'frame',
  summary: 'Basic cantilever: a column on the equipment side with an arm reaching across the conveyor; mount points under its tip and on the arm.',
  params: z.object({
    reach: z.number().min(0.3).max(2).default(0.8).describe('From the column axis to the tip, across the flow (m)'),
    height: z.number().min(0.6).max(3).default(1.5).describe('Underside of the arm above the floor (m)'),
    section: z.number().min(0.06).max(0.2).default(0.1).describe('Column and arm section (m)'),
    color: frameColor('machineGrey'),
  }),
  footprint: (p) => {
    const base = p.section * 1.5;
    return { x: [-base, base], z: [-p.reach - base, p.section / 2], height: p.height + p.section };
  },
  mount: 'floor',
  anchors: ['tip', 'armTop'],
  build({ params: p, materials }) {
    const root = group(null, 'cantileverFrame');
    const m = materials[p.color];
    const s = p.section;
    const colZ = -p.reach;
    box(root, [s * 3, 0.015, s * 3], [0, 0.0075, colZ], materials.stainless, 'Base plate');
    roundedBox(root, [s, p.height + s - 0.015, s], [0, 0.015 + (p.height + s - 0.015) / 2, colZ], m, 'Column', 0.006);
    // The arm runs from the column's back face to just past the tip.
    roundedBox(root, [s, s, p.reach + s], [0, p.height + s / 2, colZ + (p.reach + s) / 2 - s / 2], m, 'Arm', 0.006);
    // Gusset under the arm at the column.
    box(root, [s * 0.3, s * 1.5, s * 1.5], [0, p.height - s * 0.75, colZ + s * 1.25], m, 'Gusset');
    const tip = mountPoint(root, 'Mount tip', [0, p.height, 0]);
    const armTop = mountPoint(root, 'Mount arm top', [0, p.height + s, colZ / 2]);
    return { root, motions: {}, anchors: { tip, armTop } };
  },
});
