// Basic transport: a gravity roller chute, sloping down along +X: units roll from the higher input
// to the output at belt height without a drive (between machines at different heights, into a
// reject bin, down to a packing table). Origin at the floor under the middle of the chute.
//
// Ports `input` (at belt height + `drop`) and `output` (at belt height). Motion `rollers` (turn
// phase, so a transfer can roll them with the unit).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box } from '../../core/primitives.js';
import { buildRollerBed, ROLLER_MOTION } from './rollerBed.js';
import { frameColor } from '../frames/common.js';

const GUIDE = 0.05; // side guides above the rollers

defineComponent({
  type: 'gravityChute',
  category: 'transport',
  summary: 'Basic gravity roller chute sloping down along the flow: units roll from the higher input to the output, no drive.',
  params: z.object({
    length: z.number().min(0.6).max(4).default(1.5).describe('Length along X, horizontal (m)'),
    width: z.number().min(0.3).max(1.2).default(0.5).describe('Between the side frames (m)'),
    drop: z.number().min(0.05).max(1.0).default(0.2).describe('Input above output (m)'),
    color: frameColor('machineGrey'),
  }).refine((p) => p.drop <= 0.4 * p.length, { message: 'too steep: drop at most 40 % of the length (about 22°)', path: ['drop'] }),
  footprint: (p, ctx) => ({
    x: [-p.length / 2 - 0.06, p.length / 2 + 0.06], // frame corners of the tilted bed
    z: [-p.width / 2 - 0.04, p.width / 2 + 0.04],
    height: ctx.beltHeight + p.drop + GUIDE + 0.03,
  }),
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-p.length / 2, ctx.beltHeight + p.drop, 0], direction: 'in', carries: 'unit' },
    output: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: 'unit' },
  }),
  motions: { rollers: ROLLER_MOTION },
  build({ params: p, materials, beltHeight }) {
    const root = group(null, 'gravityChute');
    const m = materials[p.color];
    const slope = Math.atan2(p.drop, p.length);
    const bedLength = Math.hypot(p.length, p.drop);
    const bed = group(root, 'Sloped bed', [0, beltHeight + p.drop / 2, 0]);
    bed.rotation.z = -slope; // −X end up
    const rollers = buildRollerBed(bed, materials, { length: bedLength, width: p.width, frameMaterial: m, name: 'Chute' });
    for (const side of [-1, 1]) {
      box(bed, [bedLength, GUIDE, 0.012], [0, GUIDE / 2 - 0.01, side * (p.width / 2 + 0.019)], materials.guide, `Side guide ${side > 0 ? 'front' : 'rear'}`);
    }
    // Legs: vertical, up into the frames, at the ends and in the middle of long chutes.
    const surfaceAt = (x) => beltHeight + p.drop / 2 - (x * p.drop) / p.length;
    const xs = p.length > 1.6 ? [-p.length / 2 + 0.12, 0, p.length / 2 - 0.12] : [-p.length / 2 + 0.12, p.length / 2 - 0.12];
    for (const [i, x] of xs.entries()) {
      const top = surfaceAt(x) - 0.08;
      for (const side of [-1, 1]) box(root, [0.045, top, 0.045], [x, top / 2, side * p.width / 2], materials.frame, `Leg ${i + 1} ${side > 0 ? 'front' : 'rear'}`);
    }
    return { root, motions: { rollers: rollers.setPhase } };
  },
});
