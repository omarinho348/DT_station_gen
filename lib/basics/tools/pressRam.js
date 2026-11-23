// Basic tool: a press (a cylinder body, a ram rod and a pressing head) that presses, punches,
// crimps or stakes. Origin at the TOOL POINT, the head's face with the ram up; mounting face on top.
// Motion `extend` (metres the head has come down); mount point `face` on the head's face (Y up),
// moving with it.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, box, roundedBox } from '../../core/primitives.js';
import { mountPoint } from '../frames/common.js';

const HEAD = 0.03;
const ROD_SHOWN = 0.03; // rod visible between the body and the head with the ram up

defineComponent({
  type: 'pressRam',
  category: 'tool',
  summary: 'Basic press: cylinder body, ram rod and a pressing head that comes down by its stroke; a mount point on the head face.',
  params: z.object({
    stroke: z.number().min(0.01).max(0.4).default(0.08).describe('Ram travel (m)'),
    bore: z.number().min(0.03).max(0.2).default(0.08).describe('Cylinder bore (m)'),
    headSize: z.number().min(0.02).max(0.4).default(0.1).describe('Head face, square (m)'),
  }),
  footprint: (p) => {
    const half = Math.max(p.bore * 0.75, p.headSize / 2);
    return { x: [-half, half], z: [-half, half], height: HEAD + ROD_SHOWN + p.stroke + 0.2 + 0.015, bottom: -p.stroke };
  },
  mount: 'tool',
  anchors: ['face'],
  motions: (p) => ({ extend: { range: [0, p.stroke], default: 0 } }),
  build({ params: p, materials }) {
    const root = group(null, 'pressRam');
    const bodyLen = p.stroke + 0.2;
    const bodyY = HEAD + ROD_SHOWN;
    roundedBox(root, [p.bore * 1.5, bodyLen, p.bore * 1.5], [0, bodyY + bodyLen / 2, 0], materials.machineGrey, 'Cylinder body', 0.006);
    box(root, [p.bore * 1.5, 0.015, p.bore * 1.5], [0, bodyY + bodyLen + 0.0075, 0], materials.stainless, 'Mounting plate');
    // The ram: the rod's upper end stays inside the body over the whole stroke.
    const ram = group(root, 'Ram');
    cylinder(ram, p.bore * 0.22, ROD_SHOWN + p.stroke + 0.05, [0, HEAD + (ROD_SHOWN + p.stroke + 0.05) / 2, 0], materials.chrome, 'Ram rod', { segments: 16 });
    box(ram, [p.headSize, HEAD, p.headSize], [0, HEAD / 2, 0], materials.frameDark, 'Press head');
    const face = mountPoint(ram, 'Mount face', [0, 0, 0]);
    return { root, motions: { extend: (v) => { ram.position.y = -v; } }, anchors: { face } };
  },
});
