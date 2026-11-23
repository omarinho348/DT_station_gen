// Basic axis: a vertical slide (a Z axis in machine terms): a slide body hanging from its mounting
// face and a ram moving down out of it, the way a pick head or a press tool is lowered onto a unit.
//
// Basic-block mounting: origin at the MOUNTING FACE, the top of the slide body; everything hangs
// below it. Mount point `ram` at the lower end of the ram (Y up), where a tool's mounting face
// goes; motion `extend` (metres the ram has come down, 0 = up).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, roundedBox, cylinder } from '../../core/primitives.js';
import { frameColor, mountPoint } from '../frames/common.js';

const RAM = 0.05; // ram section

defineComponent({
  type: 'verticalAxis',
  category: 'axis',
  summary: 'Basic vertical slide (Z axis): body hanging from its mounting face, a ram moving down out of it; a mount point at the ram end.',
  params: z.object({
    stroke: z.number().min(0.05).max(1.5).default(0.4).describe('Ram travel down (m)'),
    bodyLength: z.number().min(0.15).max(1.6).default(0.5).describe('Slide body length (m)'),
    color: frameColor('machineGrey'),
  }).refine((p) => p.stroke <= p.bodyLength - 0.05, { message: 'the stroke must be at least 5 cm shorter than the body (the ram stays guided)', path: ['stroke'] }),
  footprint: (p) => ({ x: [-0.06, 0.06], z: [-0.06, 0.12], // the drive motor sticks out on +Z
    height: 0.001, bottom: -(p.bodyLength + p.stroke + 0.02) }),
  mount: 'surface',
  anchors: ['ram'],
  motions: (p) => ({ extend: { range: [0, p.stroke], default: 0 } }),
  build({ params: p, materials }) {
    const root = group(null, 'verticalAxis');
    const L = p.bodyLength;
    box(root, [0.12, 0.012, 0.12], [0, -0.006, 0], materials.stainless, 'Mounting plate');
    roundedBox(root, [0.09, L - 0.012, 0.09], [0, -0.012 - (L - 0.012) / 2, 0], materials[p.color], 'Slide body', 0.004);
    cylinder(root, 0.03, 0.1, [0, -0.06, 0.07], materials.motor, 'Drive motor', { axis: 'z', segments: 18 });
    // The ram: its upper part stays inside the body; it reaches 0.02 m below the body when up.
    const ram = group(root, 'Ram', [0, -L - 0.02, 0]);
    box(ram, [RAM, L, RAM], [0, L / 2, 0], materials.stainless, 'Ram bar');
    box(ram, [0.08, 0.012, 0.08], [0, 0.006, 0], materials.aluminium, 'Ram flange');
    const mount = mountPoint(ram, 'Mount ram', [0, 0, 0]);
    return { root, motions: { extend: (v) => { ram.position.y = -L - 0.02 - v; } }, anchors: { ram: mount } };
  },
});
