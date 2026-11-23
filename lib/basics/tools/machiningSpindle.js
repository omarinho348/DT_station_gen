// Basic tool: a machining spindle (motor, spindle nose, collet and a cutter: drill or end mill).
// Origin at the TOOL POINT, the cutter tip; mounting face on top. Motion `spin` (radians, wraps;
// `angle` 2π per range) turns the collet and cutter.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, box } from '../../core/primitives.js';

const MOTOR = 0.16;
const NOSE = 0.05;
const COLLET = 0.03;

defineComponent({
  type: 'machiningSpindle',
  category: 'tool',
  summary: 'Basic machining spindle: motor, nose, collet and a drill or end-mill cutter that turns.',
  params: z.object({
    cutter: z.enum(['drill', 'endMill']).default('drill').describe('Cutter'),
    cutterLength: z.number().min(0.02).max(0.2).default(0.06).describe('Cutter length out of the collet (m)'),
    cutterDiameter: z.number().min(0.002).max(0.03).default(0.008).describe('Cutter diameter (m)'),
    motorRadius: z.number().min(0.03).max(0.1).default(0.05).describe('Motor radius (m)'),
  }),
  footprint: (p) => ({ x: [-p.motorRadius - 0.03, p.motorRadius + 0.03], z: [-p.motorRadius, p.motorRadius], height: p.cutterLength + COLLET + NOSE + MOTOR + 0.012 }),
  mount: 'tool',
  motions: { spin: { range: [0, 2 * Math.PI], default: 0, wrap: true, angle: 2 * Math.PI } },
  build({ params: p, materials }) {
    const root = group(null, 'machiningSpindle');
    const r = p.cutterDiameter / 2;
    const turning = group(root, 'Turning');
    if (p.cutter === 'drill') {
      cylinder(turning, r, p.cutterLength - r, [0, r + (p.cutterLength - r) / 2, 0], materials.chrome, 'Drill body', { segments: 12 });
      cylinder(turning, r, r, [0, r / 2, 0], materials.chrome, 'Drill point', { radiusBottom: 0.0002, segments: 12 });
      box(turning, [p.cutterDiameter * 1.02, p.cutterLength * 0.7, 0.0008], [0, p.cutterLength * 0.45, 0], materials.frameDark, 'Flute');
    } else {
      cylinder(turning, r, p.cutterLength, [0, p.cutterLength / 2, 0], materials.chrome, 'End mill', { segments: 12 });
      box(turning, [p.cutterDiameter * 1.02, p.cutterLength * 0.6, 0.0008], [0, p.cutterLength * 0.3, 0], materials.frameDark, 'Flute');
    }
    const y0 = p.cutterLength;
    cylinder(turning, Math.max(0.012, r + 0.006), COLLET, [0, y0 + COLLET / 2, 0], materials.stainless, 'Collet', { radiusBottom: Math.max(0.009, r + 0.004), segments: 16 });
    const y1 = y0 + COLLET;
    cylinder(root, p.motorRadius * 0.55, NOSE, [0, y1 + NOSE / 2, 0], materials.brushed, 'Spindle nose', { segments: 24 });
    const y2 = y1 + NOSE;
    cylinder(root, p.motorRadius, MOTOR, [0, y2 + MOTOR / 2, 0], materials.motor, 'Spindle motor', { segments: 28 });
    box(root, [0.03, MOTOR * 0.5, 0.04], [p.motorRadius + 0.015, y2 + MOTOR * 0.5, 0], materials.frameDark, 'Terminal box');
    box(root, [p.motorRadius * 1.6, 0.012, p.motorRadius * 1.6], [0, y2 + MOTOR + 0.006, 0], materials.stainless, 'Mounting plate');
    return { root, motions: { spin: (v) => { turning.rotation.y = v; } } };
  },
});
