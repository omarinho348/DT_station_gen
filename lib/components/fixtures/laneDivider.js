// Lane divider: a blade along the middle of a belt conveyor, hung from bridges standing on its side
// frames, so loose units travel in two lanes (e.g. 2 × 2 groups for a case packer). Port of the
// reference station-2 PackingLineEquipment.js (createInputConveyor's LaneDivider).
// Mount `surface`: y = 0 is the conveyor's frame top (1 cm above a belt conveyor's belt); the
// bridges stand on the frames, `span` apart; origin at the middle of the blade.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, roundedBox } from '../../core/primitives.js';

const BELOW = 0.01; // the belt is this far below the frame top (beltConveyor)
const BRIDGE_TOP = 0.5 - BELOW; // bridge beam centre: 0.5 m above the belt
const BLADE = { bottom: 0.025 - BELOW, height: 0.17 }; // blade from 2.5 cm above the belt

// Bridges spread along the blade; two land where the reference's did (30 % and 70 % of it).
const bridgeXs = (length) => {
  const count = Math.max(2, Math.round(length / 1.3));
  return Array.from({ length: count }, (_, i) => -length / 2 + ((i + 0.75) / (count + 0.5)) * length);
};

defineComponent({
  type: 'laneDivider',
  category: 'fixture',
  summary: 'Lane divider blade along the middle of a belt conveyor, hung from bridges on its side frames: units travel in two lanes.',
  params: z.object({
    length: z.number().min(0.6).max(6).default(2.66).describe('Blade length along X (m)'),
    span: z.number().min(0.3).max(1.2).default(0.58).describe('Distance between the bridge posts: the conveyor\'s side-frame spacing (m)'),
  }),
  footprint: (p) => {
    const xs = bridgeXs(p.length);
    return {
      x: [Math.min(-p.length / 2, xs[0] - 0.02), Math.max(p.length / 2, xs.at(-1) + 0.02)],
      z: [-(p.span / 2 + 0.02), p.span / 2 + 0.02],
      height: BRIDGE_TOP + 0.02,
    };
  },
  mount: 'surface',
  motions: {},
  ops: [],
  build({ params, materials }) {
    const { length, span } = params;
    const root = group(null, 'laneDivider');
    roundedBox(root, [length, BLADE.height, 0.012], [0, BLADE.bottom + BLADE.height / 2, 0], materials.stainless, 'Divider blade', 0.004);
    bridgeXs(length).forEach((x, i) => {
      const bridge = group(root, `Divider bridge ${i + 1}`, [x, 0, 0]);
      [-1, 1].forEach((side) => roundedBox(bridge, [0.04, BRIDGE_TOP + 0.02, 0.04], [0, (BRIDGE_TOP + 0.02) / 2, side * span / 2], materials.stainless, 'Bridge post', 0.006));
      roundedBox(bridge, [0.04, 0.04, span + 0.04], [0, BRIDGE_TOP, 0], materials.stainless, 'Bridge beam', 0.006);
      const bladeTop = BLADE.bottom + BLADE.height;
      roundedBox(bridge, [0.02, BRIDGE_TOP - bladeTop, 0.012], [0, (BRIDGE_TOP + bladeTop) / 2, 0], materials.stainless, 'Divider hanger', 0.003);
    });
    return { root, motions: {} };
  },
});
