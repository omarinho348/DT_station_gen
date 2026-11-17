// Part nest: a stand whose top locates a part (or a stack of parts) for a robot to pick.
// Ported from the reference KittingEquipment.js, where ST1 has two of them:
//   guides 'cornerPosts' – four tall corner posts holding a stack (the bed nest)
//   guides 'locators'    – four flat locating blocks under a single part (the base-frame nest)
// Origin at floor, centre. Guides sit at (±guideX, ±guideZ).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box } from '../../core/primitives.js';
import { buildTable } from '../station/workTable.js';

const POST = 0.02;
const LOCATOR = { size: 0.044, height: 0.008 };

const guideHalf = (p) => (p.guides === 'cornerPosts' ? POST : LOCATOR.size) / 2;

defineComponent({
  type: 'partNest',
  category: 'fixture',
  summary: 'Part nest on a stand: corner posts for a stack of parts, or flat locators under a single part.',
  params: z.object({
    length: z.number().min(0.2).max(1).default(0.34).describe('Length along X (m)'),
    width: z.number().min(0.2).max(1).default(0.34).describe('Width along Z (m)'),
    height: z.number().min(0.6).max(1.1).default(0.72).describe('Stand height (m)'),
    guides: z.enum(['cornerPosts', 'locators']).default('cornerPosts').describe('Guides'),
    guideX: z.number().min(0.05).max(0.45).default(0.13).describe('Guide offset along X (m)'),
    guideZ: z.number().min(0.05).max(0.45).default(0.13).describe('Guide offset along Z (m)'),
    postHeight: z.number().min(0.05).max(0.4).default(0.2).describe('Corner post height (m)'),
  }).superRefine((p, ctx) => {
    const g = guideHalf(p);
    if (p.guideX + g > p.length / 2 + 1e-9) ctx.addIssue({ code: 'custom', path: ['guideX'], message: 'guides must stay on the stand top' });
    if (p.guideZ + g > p.width / 2 + 1e-9) ctx.addIssue({ code: 'custom', path: ['guideZ'], message: 'guides must stay on the stand top' });
  }),
  footprint: (p) => ({
    x: [-p.length / 2, p.length / 2],
    z: [-p.width / 2, p.width / 2],
    height: p.height + (p.guides === 'cornerPosts' ? p.postHeight : LOCATOR.height),
  }),
  mount: 'floor',
  // Where the (lowest) part rests: the stand top, or the top of the locators.
  ports: (p) => ({ seat: { position: [0, p.height + (p.guides === 'locators' ? LOCATOR.height : 0), 0], direction: 'out', carries: 'unit' } }),
  build({ params, materials }) {
    const { length, width, height, guides, guideX, guideZ, postHeight } = params;
    const root = group(null, 'partNest');
    buildTable(root, materials, { length, width, height, name: 'Nest stand' });
    const top = group(root, 'Nest guides', [0, height, 0]);
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      if (guides === 'cornerPosts') {
        box(top, [POST, postHeight, POST], [sx * guideX, postHeight / 2, sz * guideZ], materials.safetyYellow, 'Nest corner post');
      } else {
        box(top, [LOCATOR.size, LOCATOR.height, LOCATOR.size], [sx * guideX, LOCATOR.height / 2, sz * guideZ], materials.plasticBlack, 'Nest locator');
      }
    }));
    return { root, motions: {} };
  },
});
