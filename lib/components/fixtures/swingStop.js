// Swing-arm stop on one side frame of a conveyor: a pneumatic rotary actuator swings a yellow blade
// across the belt to hold a case at a position, and swings it clear (along the frame, pointing
// downstream) to release it. Port of the reference station-2 PackingLineEquipment.js (BoxStop).
// Mount `surface`: y = 0 is the frame top, z = 0 the frame's centre line; the blade reaches `reach`
// across the belt towards +Z (place it on the rear frame) and the stop face is at x = 0.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

const ARM_Y = 0.095; // blade centre: 10.5 cm above the belt, as the reference
const BLADE = 0.012;

defineComponent({
  type: 'swingStop',
  category: 'fixture',
  summary: 'Swing-arm stop on a conveyor side frame: a blade swings across the belt to hold a case, and clear to release it.',
  params: z.object({
    reach: z.number().min(0.15).max(0.8).default(0.32).describe('Blade length across the belt (m)'),
  }),
  footprint: (p) => ({ x: [-0.04, Math.max(0.04 + BLADE, p.reach + 0.01)], z: [-0.04, p.reach + 0.01], height: 0.19 }),
  mount: 'surface',
  ports: { stop: { position: [0, -0.01, 0], direction: 'work', carries: 'case' } }, // stop face at belt height
  motions: { open: { range: [0, 1] } }, // 0 = blade across the belt, 1 = swung clear
  ops: [],
  build({ params, materials }) {
    const { reach } = params;
    const root = group(null, 'swingStop');
    // The bracket stands on the frame. (The reference's hung beside it, 2 cm off.)
    const pivot = [BLADE / 2 + 0.004, 0, 0]; // so the bumper face is the stop face, x = 0
    roundedBox(root, [0.08, 0.06, 0.08], [pivot[0], 0.03, 0], materials.frame, 'Stop bracket', 0.01);
    cylinder(root, 0.03, 0.13, [pivot[0], 0.06 + 0.065, 0], materials.aluminium, 'Swing actuator', { segments: 20 });
    const arm = group(root, 'Stop arm', [pivot[0], ARM_Y, 0]);
    roundedBox(arm, [BLADE, 0.045, reach], [0, 0, reach / 2], materials.safetyYellow, 'Stop blade', 0.004);
    box(arm, [0.004, 0.035, reach - 0.04], [-BLADE / 2 - 0.002, 0, reach / 2 + 0.02], materials.rubber, 'Blade bumper');
    return {
      root,
      motions: { open(v) { arm.rotation.y = (Math.PI / 2) * v; } },
    };
  },
});
