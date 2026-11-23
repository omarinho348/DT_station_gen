// Basic frame: a portal (two posts and a cross beam) standing across the flow, the way a filler or
// labeller head is carried over a conveyor. Origin at the floor under the middle of the beam; the
// posts stand at z = ±span/2 (outside the clear width), the beam runs along Z.
//
// Mount points: `beam` (under the middle of the beam, for an axis or tool hanging down) and
// `beamTop` (on top of it, for a drive or a cable chain).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, roundedBox } from '../../core/primitives.js';
import { frameColor, footPlate, mountPoint } from './common.js';

defineComponent({
  type: 'portalFrame',
  category: 'frame',
  summary: 'Basic portal frame: two posts and a cross beam over the conveyor, with mount points under and on the beam.',
  params: z.object({
    span: z.number().min(0.4).max(3).default(0.9).describe('Clear width between the posts, across the flow (m)'),
    height: z.number().min(0.8).max(3).default(1.6).describe('Underside of the beam above the floor (m)'),
    section: z.number().min(0.06).max(0.2).default(0.1).describe('Post and beam section (m)'),
    color: frameColor('machineGrey'),
  }),
  footprint: (p) => {
    const half = p.span / 2 + p.section;
    const foot = p.section * 1.8 / 2;
    return { x: [-foot, foot], z: [-half - (foot - p.section / 2), half + (foot - p.section / 2)], height: p.height + p.section };
  },
  mount: 'floor',
  anchors: ['beam', 'beamTop'],
  build({ params: p, materials }) {
    const root = group(null, 'portalFrame');
    const m = materials[p.color];
    const s = p.section;
    const postZ = p.span / 2 + s / 2;
    for (const [side, z] of [['left', -postZ], ['right', postZ]]) {
      roundedBox(root, [s, p.height, s], [0, p.height / 2, z], m, `Post ${side}`, 0.006);
      footPlate(root, 0, z, s * 1.8, materials, `Foot plate ${side}`);
    }
    roundedBox(root, [s, s, p.span + 2 * s], [0, p.height + s / 2, 0], m, 'Cross beam', 0.006);
    const beam = mountPoint(root, 'Mount beam', [0, p.height, 0]);
    const beamTop = mountPoint(root, 'Mount beam top', [0, p.height + s, 0]);
    return { root, motions: {}, anchors: { beam, beamTop } };
  },
});
