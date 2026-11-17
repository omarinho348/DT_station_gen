// Long-part cradle: a stand with two V-saddle bars across it; each long part (rods, profiles,
// lead screws) lies in its own lane between a pair of lips on both bars. Ported from the
// reference KittingEquipment.js (the ST1 "LongPartCradle"). Origin at floor, centre.
// Lanes run along Z; their X positions are a list, because long parts differ in width.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box } from '../../core/primitives.js';
import { buildTable } from '../station/workTable.js';

const BAR = { height: 0.012, depth: 0.04 };
const LIP = { width: 0.008, height: 0.012 };

defineComponent({
  type: 'partCradle',
  category: 'fixture',
  summary: 'Long-part cradle: a stand with two V-saddle bars and one lane per part (rods, profiles, screws).',
  params: z.object({
    length: z.number().min(0.5).max(1.5).default(0.6).describe('Length along X (m)'),
    width: z.number().min(0.3).max(1).default(0.5).describe('Width along Z (m)'),
    height: z.number().min(0.6).max(1.1).default(0.75).describe('Stand height (m)'),
    lanes: z.array(z.number().min(-0.7).max(0.7)).min(1).max(10).default([-0.17, -0.08, 0, 0.06, 0.15]).describe('Lane X positions (m)'),
    laneWidth: z.number().min(0.02).max(0.12).default(0.06).describe('Gap between lane lips (m)'),
    saddleSpacing: z.number().min(0.1).max(0.9).default(0.3).describe('Distance between the saddle bars (m)'),
  }).superRefine((p, ctx) => {
    const limit = p.length / 2 - 0.02 - p.laneWidth / 2 - LIP.width;
    p.lanes.forEach((x, i) => {
      if (Math.abs(x) > limit + 1e-9) ctx.addIssue({ code: 'custom', path: ['lanes', i], message: `lane at ${x} m is off the saddle bars (|x| ≤ ${limit.toFixed(3)})` });
    });
    if (p.saddleSpacing > p.width - BAR.depth) ctx.addIssue({ code: 'custom', path: ['saddleSpacing'], message: 'saddle bars must stay on the stand top' });
  }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-p.width / 2, p.width / 2], height: p.height + BAR.height + LIP.height }),
  mount: 'floor',
  // One supply point per lane, on top of the saddle bars (where the part's underside rests).
  ports: (p) => Object.fromEntries(p.lanes.map((x, i) => [`lane${i + 1}`, { position: [x, p.height + BAR.height, 0], direction: 'out', carries: 'unit' }])),
  build({ params, materials }) {
    const { length, width, height, lanes, laneWidth, saddleSpacing } = params;
    const root = group(null, 'partCradle');
    buildTable(root, materials, { length, width, height, name: 'Cradle stand' });
    [-1, 1].forEach((side) => {
      const saddle = group(root, 'V-saddle bar', [0, height, side * saddleSpacing / 2]);
      box(saddle, [length - 0.04, BAR.height, BAR.depth], [0, BAR.height / 2, 0], materials.plasticBlack, 'Saddle bar');
      lanes.forEach((x) => [-1, 1].forEach((s) => {
        box(saddle, [LIP.width, LIP.height, BAR.depth], [x + s * (laneWidth / 2), BAR.height + LIP.height / 2, 0], materials.plasticBlack, 'Saddle lip');
      }));
    });
    return { root, motions: {} };
  },
});
