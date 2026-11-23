// Basic transport: a turntable transfer (a short roller section on a turning base) that passes a
// unit straight on or turns it 90° onto a branch: to a reject lane, a parallel station, a side
// buffer. Origin at the floor under the turning axis.
//
// Motions: `turn` (radians, −π/2 … π/2; at +π/2 the section's outfeed points to −Z, the rear /
// equipment side, at −π/2 to +Z, the front / walkway side) and `rollers` (turn phase). Ports:
// `input` (−X), `output` (+X), `toRear` (−Z) and `toFront` (+Z), at belt height.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, box } from '../../core/primitives.js';
import { buildRollerBed, ROLLER_MOTION, FRAME } from './rollerBed.js';
import { frameColor } from '../frames/common.js';

const radiusOf = (p) => Math.hypot(p.length / 2, p.width / 2 + FRAME.width / 2);

defineComponent({
  type: 'turntableTransfer',
  category: 'transport',
  summary: 'Basic turntable transfer: a roller section on a turning base that passes units straight on or turns them 90° to a branch.',
  params: z.object({
    length: z.number().min(0.4).max(1.6).default(0.7).describe('Roller section length (m)'),
    width: z.number().min(0.3).max(1.2).default(0.5).describe('Roller section width (m)'),
    color: frameColor('machineBlue'),
  }),
  footprint: (p, ctx) => {
    const r = radiusOf(p);
    return { x: [-r, r], z: [-r, r], height: ctx.beltHeight };
  },
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-p.length / 2, ctx.beltHeight, 0], direction: 'in', carries: 'unit' },
    output: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: 'unit' },
    toRear: { position: [0, ctx.beltHeight, -p.length / 2], direction: 'out', carries: 'unit' },
    toFront: { position: [0, ctx.beltHeight, p.length / 2], direction: 'out', carries: 'unit' },
  }),
  motions: { turn: { range: [-Math.PI / 2, Math.PI / 2], default: 0 }, rollers: ROLLER_MOTION },
  build({ params: p, materials, beltHeight }) {
    const root = group(null, 'turntableTransfer');
    const drumTop = beltHeight - 0.15;
    const drumR = Math.min(p.length, p.width) * 0.35;
    cylinder(root, drumR + 0.05, 0.02, [0, 0.01, 0], materials.stainless, 'Base plate', { segments: 32 });
    cylinder(root, drumR, drumTop - 0.02, [0, 0.02 + (drumTop - 0.02) / 2, 0], materials[p.color], 'Turning drive', { segments: 32 });
    const turning = group(root, 'Turning section', [0, drumTop, 0]);
    cylinder(turning, drumR * 0.9, 0.025, [0, 0.0125, 0], materials.frameDark, 'Slewing ring', { segments: 32 });
    box(turning, [p.length * 0.8, 0.015, p.width], [0, 0.025 + 0.0075, 0], materials.frameDark, 'Section base');
    const bed = group(turning, 'Roller section', [0, beltHeight - drumTop, 0]);
    // Brackets from the section base up into the side frames.
    for (const side of [-1, 1]) box(turning, [p.length * 0.6, 0.11, 0.03], [0, 0.04 + 0.055, side * p.width / 2], materials.frameDark, `Section bracket ${side > 0 ? 'front' : 'rear'}`);
    const rollers = buildRollerBed(bed, materials, { length: p.length, width: p.width, frameMaterial: materials[p.color], name: 'Section' });
    return { root, motions: { turn: (v) => { turning.rotation.y = v; }, rollers: rollers.setPhase } };
  },
});
