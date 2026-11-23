// Fixed end stop across a belt conveyor: a yellow bar with a rubber bumper on two posts standing on
// the side frames; units accumulate against it while the belt slips under them. Port of the
// reference station-2 PackingLineEquipment.js (createInputConveyor's EndStop).
// Mount `surface`: y = 0 is the conveyor's frame top, the posts stand on the frames `span` apart.
// Origin at the stop face (x = 0), where the leading face of the first unit comes to rest.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, roundedBox } from '../../core/primitives.js';

const BELOW = 0.01; // the belt is this far below the frame top (beltConveyor)
const BUMPER = 0.004;
const BAR = 0.016;

defineComponent({
  type: 'beltEndStop',
  category: 'fixture',
  summary: 'Fixed end stop across a belt conveyor (bar with rubber bumper on posts on the frames): units accumulate against it.',
  params: z.object({
    span: z.number().min(0.3).max(1.2).default(0.58).describe('Distance between the posts: the conveyor\'s side-frame spacing (m)'),
  }),
  footprint: (p) => ({ x: [0, BUMPER + BAR + 0.03], z: [-(p.span / 2 + 0.02), p.span / 2 + 0.02], height: 0.16 }),
  mount: 'surface',
  // stop: the stop face at belt height (frame-top frame: the belt is 1 cm below y = 0).
  ports: { stop: { position: [0, -BELOW, 0], direction: 'work', carries: 'unit' } },
  motions: {},
  ops: [],
  build({ params, materials }) {
    const { span } = params;
    const root = group(null, 'beltEndStop');
    const barY = 0.08 - BELOW; // bar centre 8 cm above the belt, as the reference
    box(root, [BUMPER, 0.08, span - 0.06], [BUMPER / 2, barY, 0], materials.rubber, 'Stop bumper');
    // The bar reaches the posts. (The reference's stopped 2 cm short of them, on nothing.)
    roundedBox(root, [BAR, 0.1, span], [BUMPER + BAR / 2, barY, 0], materials.safetyYellow, 'Stop bar', 0.004);
    [-1, 1].forEach((side) => roundedBox(root, [0.04, 0.16, 0.04], [BUMPER + BAR / 2 + 0.01, 0.08, side * span / 2], materials.stainless, 'Stop post', 0.006));
    return { root, motions: {} };
  },
});
