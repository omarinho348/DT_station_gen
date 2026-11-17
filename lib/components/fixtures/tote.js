// Open-top plastic tote for small parts (line-side supermarket, kitting). Ported from the
// reference KittingEquipment.js (createTote). Size is the INSIDE of the tote.
// Origin: centre of the tote's underside, so it rests on whatever it is placed on (mount
// 'surface'). The reference put the origin on the inside floor; that point is the `inside` port.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box } from '../../core/primitives.js';

const WALL = 0.006;
const FLOOR = 0.006;

defineComponent({
  type: 'tote',
  category: 'fixture',
  summary: 'Open-top plastic tote for small parts; size is the inside, rests on a table or shelf.',
  params: z.object({
    width: z.number().min(0.08).max(0.6).default(0.2).describe('Inside width along X (m)'),
    depth: z.number().min(0.08).max(0.6).default(0.11).describe('Inside depth along Z (m)'),
    height: z.number().min(0.04).max(0.3).default(0.08).describe('Wall height (m)'),
    color: z.enum(['toteBlue', 'binYellow', 'binRed', 'binGreen', 'machineGrey']).default('toteBlue').describe('Colour'),
  }),
  footprint: (p) => ({
    x: [-(p.width / 2 + WALL), p.width / 2 + WALL],
    z: [-(p.depth / 2 + WALL), p.depth / 2 + WALL],
    height: p.height,
  }),
  mount: 'surface',
  // Parts are placed on the inside floor.
  ports: () => ({ inside: { position: [0, FLOOR, 0], direction: 'work', carries: 'unit' } }),
  build({ params, materials }) {
    const { width: w, depth: d, height } = params;
    const material = materials[params.color];
    const root = group(null, 'tote');
    box(root, [w + WALL * 2, FLOOR, d + WALL * 2], [0, FLOOR / 2, 0], material, 'Tote floor');
    [-1, 1].forEach((side) => {
      box(root, [w + WALL * 2, height, WALL], [0, height / 2, side * (d / 2 + WALL / 2)], material, 'Tote wall');
      box(root, [WALL, height, d], [side * (w / 2 + WALL / 2), height / 2, 0], material, 'Tote wall');
    });
    return { root, motions: {} };
  },
});
