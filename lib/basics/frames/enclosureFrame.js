// Basic frame: a machine enclosure (corner posts, a roof, guard-glass side panels and end walls
// with a pass-through opening on each end), the housing of an inline machine the conveyor runs
// through. Origin at the floor under its centre; flow along +X through the openings.
//
// Ports `input` / `output` at the openings at belt height (from the build context). Mount point
// `roof` under the middle of the roof (for an axis or tool hanging inside).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, roundedBox } from '../../core/primitives.js';
import { frameColor, mountPoint } from './common.js';

const POST = 0.05;
const ROOF = 0.04;
const PANEL = 0.012;

defineComponent({
  type: 'enclosureFrame',
  category: 'frame',
  summary: 'Basic machine enclosure: corner posts, roof, guard-glass sides and end walls with a pass-through opening; ports at both openings.',
  params: z.object({
    length: z.number().min(0.5).max(4).default(1.4).describe('Along the flow, X (m)'),
    depth: z.number().min(0.5).max(3).default(1.0).describe('Across the flow, Z (m)'),
    height: z.number().min(1.0).max(3).default(2.0).describe('Roof top above the floor (m)'),
    openingWidth: z.number().min(0.2).max(2.5).default(0.5).describe('Pass-through opening width, across the flow (m)'),
    openingTop: z.number().min(0.5).max(2.8).default(1.3).describe('Top of the opening above the floor (it reaches down to the floor) (m)'),
    color: frameColor('machineWhite'),
  }).refine((p) => p.openingWidth <= p.depth - 2 * POST - 0.05, { message: 'the opening must leave at least 2.5 cm of wall each side', path: ['openingWidth'] })
    .refine((p) => p.openingTop <= p.height - ROOF - 0.1, { message: 'the opening must stay 10 cm below the roof', path: ['openingTop'] }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-p.depth / 2, p.depth / 2], height: p.height }),
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-p.length / 2, ctx.beltHeight, 0], direction: 'in', carries: 'unit' },
    output: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: 'unit' },
  }),
  anchors: ['roof'],
  build({ params: p, materials }) {
    const root = group(null, 'enclosureFrame');
    const m = materials[p.color];
    const hx = p.length / 2;
    const hz = p.depth / 2;
    const postH = p.height - ROOF;
    for (const [i, [x, z]] of [[-1, -1], [1, -1], [-1, 1], [1, 1]].entries()) {
      box(root, [POST, postH, POST], [x * (hx - POST / 2), postH / 2, z * (hz - POST / 2)], materials.frameDark, `Corner post ${i + 1}`);
    }
    roundedBox(root, [p.length, ROOF, p.depth], [0, p.height - ROOF / 2, 0], m, 'Roof', 0.006);
    // Side panels (along X): a solid plinth and guard glass above it.
    const plinth = 0.3;
    for (const [side, z] of [['rear', -(hz - POST / 2)], ['front', hz - POST / 2]]) {
      box(root, [p.length - 2 * POST, plinth, PANEL], [0, plinth / 2, z], m, `Side plinth ${side}`);
      box(root, [p.length - 2 * POST, postH - plinth, PANEL], [0, plinth + (postH - plinth) / 2, z], materials.guard, `Side glass ${side}`);
    }
    // End walls: a panel each side of the opening and a lintel over it.
    const wallW = hz - POST - p.openingWidth / 2;
    for (const [end, x] of [['in', -(hx - POST / 2)], ['out', hx - POST / 2]]) {
      for (const [side, s] of [['rear', -1], ['front', 1]]) {
        box(root, [PANEL, postH, wallW], [x, postH / 2, s * (p.openingWidth / 2 + wallW / 2)], m, `End wall ${end} ${side}`);
      }
      const lintelH = postH - p.openingTop;
      box(root, [PANEL, lintelH, p.openingWidth], [x, p.openingTop + lintelH / 2, 0], m, `Lintel ${end}`);
      box(root, [PANEL * 2, 0.03, p.openingWidth], [x, p.openingTop + 0.015, 0], materials.safetyYellow, `Opening trim ${end}`);
    }
    const roof = mountPoint(root, 'Mount roof', [0, p.height - ROOF, 0]);
    return { root, motions: {}, anchors: { roof } };
  },
});
