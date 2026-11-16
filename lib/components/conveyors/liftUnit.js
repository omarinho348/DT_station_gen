// Lift unit at a line end: a yellow portal frame that carries carriers between the conveyor
// and the return line below. Ported from the reference LineEquipment.createLiftUnit, plus
// carriage sleeves on the columns that show the lift travel (the reference frame was static).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, roundedBox } from '../../core/primitives.js';
import { CONVENTIONS } from '../../core/conventions.js';

const COLUMN = 0.06;
const SLEEVE = [0.09, 0.08, 0.09];

defineComponent({
  type: 'liftUnit',
  category: 'conveyor',
  summary: 'Yellow portal lift unit that moves carriers between the conveyor and the return line below.',
  params: z.object({
    span: z.number().min(0.8).max(2).default(1.32).describe('Column spacing along X (m)'),
    strandZ: z.number().min(0.15).max(0.5).default(0.24).describe('Conveyor strand offset (m)'),
    drop: z.number().min(0.2).max(0.7).default(CONVENTIONS.lift.drop).describe('Travel down to the return line (m)'),
  }),
  footprint: (p, ctx) => {
    const zOut = p.strandZ + 0.11 + SLEEVE[2] / 2;
    return { x: [-p.span / 2 - SLEEVE[0] / 2, p.span / 2 + SLEEVE[0] / 2], z: [-zOut, zOut], height: ctx.beltHeight + 0.175 };
  },
  mount: 'overConveyor',
  ports: (p, ctx) => ({
    top: { position: [0, ctx.beltHeight, 0], direction: 'in', carries: 'pallet' },
    bottom: { position: [0, ctx.beltHeight - p.drop, 0], direction: 'out', carries: 'pallet' },
  }),
  motions: {
    level: { range: [0, 1], default: 1 }, // 0 = down at the return line, 1 = up at belt height
  },
  build({ params, materials, beltHeight }) {
    const { span, strandZ, drop } = params;
    const root = group(null, 'liftUnit');
    const height = beltHeight + 0.15;
    const sleeves = [];
    [-1, 1].forEach((side) => {
      const z = side * (strandZ + 0.11);
      [-span / 2, span / 2].forEach((x) => {
        roundedBox(root, [COLUMN, height, COLUMN], [x, height / 2, z], materials.safetyYellow, 'Lift column', 0.006);
        sleeves.push(roundedBox(root, SLEEVE, [x, beltHeight, z], materials.frameDark, 'Lift carriage', 0.008));
      });
      box(root, [span + COLUMN, 0.05, 0.05], [0, height, z], materials.safetyYellow, 'Lift header');
    });
    return {
      root,
      motions: {
        level(v) {
          const y = beltHeight - drop * (1 - v);
          sleeves.forEach((s) => { s.position.y = y; });
        },
      },
    };
  },
});
