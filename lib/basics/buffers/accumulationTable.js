// Basic buffer: a rotary accumulation table (a turning disc inside a guard rail, a fixed centre
// cone), where units gather when the line downstream stops and are fed back as it runs again.
// Origin at the floor under the axis; disc top at belt height.
//
// Ports `input` (−X edge) and `output` (+X edge), at belt height. Motion `spin` (radians, wraps;
// `travel` = the metres a unit on the ring at 3/4 of the radius moves per turn, so a transfer op
// can turn it with the units it carries round).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, box } from '../../core/primitives.js';
import { frameColor } from '../frames/common.js';

const DISC = 0.03;
const RAIL = 0.08; // guard rail height above the disc
const RAIL_GAP = 0.03; // rail outside the disc edge
const CONE = 0.1; // fixed centre cone height above the disc

defineComponent({
  type: 'accumulationTable',
  category: 'buffer',
  summary: 'Basic rotary accumulation table: a turning disc inside a guard rail where units gather and are fed back to the line.',
  params: z.object({
    radius: z.number().min(0.3).max(1.5).default(0.6).describe('Disc radius (m)'),
    openingWidth: z.number().min(0.1).max(0.8).default(0.25).describe('Gap in the rail at the input and output (m)'),
    color: frameColor('machineGrey'),
  }).refine((p) => p.openingWidth <= p.radius, { message: 'the rail openings cannot be wider than the radius', path: ['openingWidth'] }),
  footprint: (p, ctx) => {
    const r = p.radius + RAIL_GAP + 0.01;
    return { x: [-r, r], z: [-r, r], height: ctx.beltHeight + Math.max(RAIL, CONE) };
  },
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-p.radius, ctx.beltHeight, 0], direction: 'in', carries: 'unit' },
    output: { position: [p.radius, ctx.beltHeight, 0], direction: 'out', carries: 'unit' },
  }),
  motions: (p) => ({ spin: { range: [0, 2 * Math.PI], default: 0, wrap: true, angle: 2 * Math.PI, travel: 2 * Math.PI * p.radius * 0.75 } }),
  build({ params: p, materials, beltHeight }) {
    const root = group(null, 'accumulationTable');
    const top = beltHeight - DISC; // underside of the disc
    const baseR = p.radius * 0.45;
    cylinder(root, baseR + 0.05, 0.02, [0, 0.01, 0], materials.stainless, 'Base plate', { segments: 32 });
    cylinder(root, baseR, top - 0.02, [0, 0.02 + (top - 0.02) / 2, 0], materials[p.color], 'Pedestal', { segments: 32 });
    const disc = group(root, 'Turning disc', [0, top, 0]);
    cylinder(disc, p.radius, DISC, [0, DISC / 2, 0], materials.stainless, 'Disc', { segments: 64 });
    for (let i = 0; i < 4; i += 1) {
      const a = (i * Math.PI) / 2;
      const mark = box(disc, [p.radius * 0.5, 0.002, 0.02], [Math.cos(a) * p.radius * 0.6, DISC + 0.001, -Math.sin(a) * p.radius * 0.6], materials.frameDark, `Disc mark ${i + 1}`);
      mark.rotation.y = a;
    }
    // Fixed centre cone, on a post through the disc's hub.
    cylinder(root, p.radius * 0.25, CONE, [0, beltHeight + CONE / 2, 0], materials[p.color], 'Centre cone', { radiusBottom: p.radius * 0.3, segments: 32 });
    // Guard rail round the disc on posts from the pedestal's base plate ring; gaps at ±X.
    const railR = p.radius + RAIL_GAP;
    const gap = Math.asin(Math.min(1, (p.openingWidth / 2 + 0.01) / railR)); // half-angle of each opening (1 cm clear of the rail's ends)
    const span = Math.PI - 2 * gap; // each rail arc
    for (const [k, from] of [gap, Math.PI + gap].entries()) {
      for (let j = 0; j < 4; j += 1) {
        const a = from + (span * (j + 0.5)) / 4; // posts only under the arcs, never in an opening
        box(root, [0.02, beltHeight + RAIL - 0.005, 0.02], [Math.cos(a) * railR, (beltHeight + RAIL - 0.005) / 2, -Math.sin(a) * railR], materials.frame, `Rail post ${k * 4 + j + 1}`);
      }
    }
    // Two rail arcs, each from just past one opening to just before the other (as short segments).
    const segs = 24;
    for (const [k, from] of [gap, Math.PI + gap].entries()) {
      for (let j = 0; j < segs; j += 1) {
        const a0 = from + (span * j) / segs;
        const a1 = from + (span * (j + 1)) / segs;
        const am = (a0 + a1) / 2;
        const len = 2 * railR * Math.sin((a1 - a0) / 2) + 0.004;
        const seg = box(root, [0.012, 0.03, len], [Math.cos(am) * railR, beltHeight + RAIL - 0.015, -Math.sin(am) * railR], materials.guide, `Guard rail ${k + 1}`);
        seg.rotation.y = am;
      }
    }
    return { root, motions: { spin: (v) => { disc.rotation.y = v; } } };
  },
});
