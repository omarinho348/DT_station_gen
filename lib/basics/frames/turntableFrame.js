// Basic frame: a rotary indexing table (a drum base and a turning plate with nests), the heart of a
// dial machine where units go round from station to station. Origin at the floor under the axis.
//
// Motion `angle` (radians, wraps): the plate's turn. Mount points: `plate` (the middle of the
// plate, turning with it) and `nest1 … nestN` (on the plate at `nestRadius`, nest 1 on +X at
// angle 0, the rest counter-clockwise seen from above), turning with it. Port `load` is where nest 1
// stands at angle 0 (the place units are set on and taken off).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, box } from '../../core/primitives.js';
import { frameColor, mountPoint } from './common.js';

const PLATE = 0.03;

const nestAngle = (i, n) => (2 * Math.PI * i) / n;

defineComponent({
  type: 'turntableFrame',
  category: 'frame',
  summary: 'Basic rotary indexing table: a drum base and a turning plate with evenly spaced nests; mount points on the plate and each nest.',
  params: z.object({
    radius: z.number().min(0.25).max(1.5).default(0.6).describe('Plate radius (m)'),
    height: z.number().min(0.4).max(1.2).default(0.86).describe('Plate top above the floor (m)'),
    nests: z.number().int().min(2).max(12).default(6).describe('Nests on the plate'),
    nestRadius: z.number().min(0.15).max(1.4).default(0.45).describe('Nest centres from the axis (m)'),
    color: frameColor('machineBlue'),
  }).refine((p) => p.nestRadius <= p.radius - 0.1, { message: 'nests must sit at least 10 cm inside the plate edge', path: ['nestRadius'] }),
  footprint: (p) => ({ x: [-p.radius, p.radius], z: [-p.radius, p.radius], height: p.height + 0.01 }),
  mount: 'floor',
  ports: (p) => ({ load: { position: [p.nestRadius, p.height + 0.01, 0], direction: 'work', carries: 'unit' } }),
  motions: { angle: { range: [0, 2 * Math.PI], default: 0, wrap: true, angle: 2 * Math.PI } },
  anchors: (p) => ['plate', ...Array.from({ length: p.nests }, (_, i) => `nest${i + 1}`)],
  build({ params: p, materials }) {
    const root = group(null, 'turntableFrame');
    const drumH = p.height - PLATE - 0.04;
    const drumR = Math.max(0.15, p.radius * 0.7);
    cylinder(root, drumR + 0.04, 0.02, [0, 0.01, 0], materials.stainless, 'Base ring', { segments: 48 });
    cylinder(root, drumR, drumH - 0.02, [0, 0.02 + (drumH - 0.02) / 2, 0], materials[p.color], 'Drum', { segments: 48 });
    cylinder(root, drumR * 0.6, 0.04, [0, drumH + 0.02, 0], materials.motor, 'Index drive hub', { segments: 32 });
    const turning = group(root, 'Turning plate', [0, drumH + 0.04, 0]);
    cylinder(turning, p.radius, PLATE, [0, PLATE / 2, 0], materials.machineGrey, 'Plate', { segments: 64 });
    const nests = {};
    for (let i = 0; i < p.nests; i += 1) {
      const a = nestAngle(i, p.nests);
      const x = Math.cos(a) * p.nestRadius;
      const z = -Math.sin(a) * p.nestRadius; // counter-clockwise seen from above (+Y)
      const pad = box(turning, [0.12, 0.01, 0.12], [x, PLATE + 0.005, z], materials.safetyYellow, `Nest ${i + 1} pad`);
      pad.rotation.y = a;
      nests[`nest${i + 1}`] = mountPoint(turning, `Mount nest ${i + 1}`, [x, PLATE + 0.01, z], a);
    }
    const plate = mountPoint(turning, 'Mount plate', [0, PLATE, 0]);
    const set = (value) => { turning.rotation.y = value; };
    return { root, motions: { angle: set }, anchors: { plate, ...nests } };
  },
});
