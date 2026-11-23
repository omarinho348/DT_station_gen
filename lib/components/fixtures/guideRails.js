// Single-file guide rails over a belt conveyor: two rail pairs at a clear gap, on posts standing on
// the conveyor's side frames, keeping units in one lane (e.g. up to a row former). Port of the
// reference factory/TransferLines.js (createCanTransfer's SingleFileGuides). Mount `surface`:
// y = 0 is the conveyor's frame top (1 cm above a beltConveyor's belt); the posts stand on the
// frames `span` apart; origin at the middle of the rails.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

const BELOW = 0.01; // the belt is this far below the frame top
const RAIL_HEIGHTS = [0.06 - BELOW, 0.15 - BELOW]; // 6 and 15 cm above the belt, as the reference
const POST = 0.21 - BELOW;

defineComponent({
  type: 'guideRails',
  category: 'fixture',
  summary: 'Single-file guide rails over a belt conveyor, on posts on its side frames: units stay in one lane.',
  params: z.object({
    length: z.number().min(0.4).max(6).default(1.6).describe('Rail length along X (m)'),
    span: z.number().min(0.3).max(1.2).default(0.58).describe('Distance between the posts: the conveyor\'s side-frame spacing (m)'),
    gap: z.number().min(0.06).max(1.0).default(0.2).describe('Clear width between the rails (m); reference: a 0.19 m can + 5 mm each side'),
  }).refine((p) => p.gap + 0.03 < p.span, { message: 'the rails must fit inside the posts', path: ['gap'] }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-(p.span / 2 + 0.01), p.span / 2 + 0.01], height: POST }),
  mount: 'surface',
  motions: {},
  ops: [],
  build({ params: p, materials }) {
    const root = group(null, 'guideRails');
    const railZ = p.gap / 2 + 0.007;
    [-1, 1].forEach((side) => {
      RAIL_HEIGHTS.forEach((h, r) => roundedBox(root, [p.length, 0.03, 0.014], [0, h, side * railZ], materials.guide, `Single-file rail ${r + 1}`, 0.005));
      // Posts at both ends with an arm to each rail. (The reference hung its rails on arms reaching
      // past the frames to nothing, and its lower rail had no arms at all.)
      [-p.length / 2 + 0.1, p.length / 2 - 0.1].forEach((x) => {
        cylinder(root, 0.007, POST, [x, POST / 2, side * p.span / 2], materials.stainless, 'Rail post', { segments: 10 });
        RAIL_HEIGHTS.forEach((h) => box(root, [0.02, 0.012, p.span / 2 - railZ], [x, h, side * (p.span / 2 + railZ) / 2], materials.stainless, 'Rail arm'));
      });
    });
    return { root, motions: {} };
  },
});
