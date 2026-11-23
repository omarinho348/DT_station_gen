// Basic buffer: an accumulating roller lane with a pop-up stop at the end of every slot, holding up
// to `slots` units queued one behind the other (a buffer between two stations, a waiting lane).
// Origin at the floor under the middle of the lane; flow along +X; roller tops at belt height.
//
// Ports `input` / `output` at the lane ends and `slot1 … slotN` (work) at each slot's middle, slot 1
// first in flow. Motions: `rollers` (turn phase) and `stop1 … stopN` (down / up; stop i holds the
// unit in slot i, up by default).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box } from '../../core/primitives.js';
import { buildRollerBed, crossBar, ROLLER_MOTION } from '../transport/rollerBed.js';
import { frameColor } from '../frames/common.js';

const STOP_UP = 0.04; // stop top above the rollers when up
const STOP_DOWN = -0.03; // below them when down

const lengthOf = (p) => p.slots * p.pitch;
const slotX = (p, i) => -lengthOf(p) / 2 + (i - 0.5) * p.pitch; // slot i's middle (1-based)
const stopX = (p, i) => -lengthOf(p) / 2 + i * p.pitch - 0.03; // just inside the slot's downstream end

defineComponent({
  type: 'bufferLane',
  category: 'buffer',
  summary: 'Basic buffer lane: accumulating rollers with a pop-up stop per slot, holding several units queued between stations.',
  params: z.object({
    slots: z.number().int().min(2).max(10).default(4).describe('Units it holds'),
    pitch: z.number().min(0.2).max(1.5).default(0.5).describe('Slot length along X (m)'),
    width: z.number().min(0.3).max(1.2).default(0.5).describe('Between the side frames (m)'),
    color: frameColor('machineGrey'),
  }),
  footprint: (p, ctx) => ({ x: [-lengthOf(p) / 2, lengthOf(p) / 2], z: [-p.width / 2 - 0.025, p.width / 2 + 0.025], height: ctx.beltHeight + STOP_UP }),
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-lengthOf(p) / 2, ctx.beltHeight, 0], direction: 'in', carries: 'unit' },
    output: { position: [lengthOf(p) / 2, ctx.beltHeight, 0], direction: 'out', carries: 'unit' },
    ...Object.fromEntries(Array.from({ length: p.slots }, (_, k) => [`slot${k + 1}`, { position: [slotX(p, k + 1), ctx.beltHeight, 0], direction: 'work', carries: 'unit' }])),
  }),
  motions: (p) => ({
    rollers: ROLLER_MOTION,
    ...Object.fromEntries(Array.from({ length: p.slots }, (_, k) => [`stop${k + 1}`, { values: ['down', 'up'], default: 'up' }])),
  }),
  build({ params: p, materials, beltHeight }) {
    const root = group(null, 'bufferLane');
    const L = lengthOf(p);
    const bed = group(root, 'Lane bed', [0, beltHeight, 0]);
    const rollers = buildRollerBed(bed, materials, { length: L, width: p.width, frameMaterial: materials[p.color], name: 'Lane' });
    const motions = { rollers: rollers.setPhase };
    for (let i = 1; i <= p.slots; i += 1) {
      crossBar(bed, materials, { x: stopX(p, i), width: p.width, name: `Stop bar ${i}` });
      // The stop: a block in a guide on the cross bar, rising between two rollers.
      const stop = group(bed, `Stop ${i}`, [stopX(p, i), 0, 0]);
      const blockH = 0.12;
      box(stop, [0.025, blockH, p.width * 0.4], [0, -blockH / 2, 0], materials.safetyYellow, `Stop block ${i}`);
      const set = (v) => { stop.position.y = v === 'up' ? STOP_UP : STOP_DOWN; };
      set('up');
      motions[`stop${i}`] = set;
    }
    // Legs at the ends and every ~1.2 m.
    const n = Math.max(2, Math.ceil(L / 1.2) + 1);
    for (let j = 0; j < n; j += 1) {
      const x = -L / 2 + 0.08 + ((L - 0.16) * j) / (n - 1);
      const legH = beltHeight - 0.08;
      for (const side of [-1, 1]) box(root, [0.045, legH, 0.045], [x, legH / 2, side * p.width / 2], materials.frame, `Leg ${j + 1} ${side > 0 ? 'front' : 'rear'}`);
    }
    return { root, motions };
  },
});
