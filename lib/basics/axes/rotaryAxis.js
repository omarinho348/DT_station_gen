// Basic axis: a rotary actuator (a servo housing with a turning flange), turning what is mounted on
// it about its vertical axis: a wrist under a slide, a small index table on a frame.
//
// Basic-block mounting: origin at the MOUNTING FACE. Standing (default) the housing sits on it with
// the flange on top; hung (`hang: true`) it hangs below with the flange underneath. Mount point
// `flange` on the flange's free face (Y up either way), turning with motion `angle` (radians).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, box } from '../../core/primitives.js';
import { frameColor, mountPoint } from '../frames/common.js';

const FLANGE = 0.02;

defineComponent({
  type: 'rotaryAxis',
  category: 'axis',
  summary: 'Basic rotary actuator: housing and a turning flange, standing or hung; a mount point on the flange that turns with it.',
  params: z.object({
    radius: z.number().min(0.04).max(0.4).default(0.08).describe('Housing radius (m)'),
    height: z.number().min(0.04).max(0.4).default(0.1).describe('Housing height (m)'),
    hang: z.boolean().default(false).describe('Hung: housing and flange below the mounting face'),
    color: frameColor('machineGrey'),
  }),
  footprint: (p) => {
    const r = p.radius + 0.012; // the connector block stands 1 cm proud of the housing
    const total = p.height + FLANGE + 0.004; // the index mark on the flange
    return p.hang ? { x: [-r, r], z: [-r, r], height: 0.001, bottom: -total } : { x: [-r, r], z: [-r, r], height: total };
  },
  mount: 'surface',
  anchors: ['flange'],
  motions: { angle: { range: [-Math.PI, Math.PI], default: 0, wrap: true, angle: 2 * Math.PI } },
  build({ params: p, materials }) {
    const root = group(null, 'rotaryAxis');
    const body = group(root, 'Rotary body');
    if (p.hang) body.rotation.x = Math.PI;
    cylinder(body, p.radius, p.height, [0, p.height / 2, 0], materials[p.color], 'Housing', { segments: 32 });
    box(body, [p.radius * 0.6, p.height * 0.6, 0.02], [0, p.height / 2, p.radius + 0.0], materials.frameDark, 'Connector block');
    const turning = group(body, 'Turning flange', [0, p.height, 0]);
    cylinder(turning, p.radius * 0.8, FLANGE, [0, FLANGE / 2, 0], materials.aluminium, 'Flange', { segments: 32 });
    box(turning, [p.radius * 0.5, 0.004, 0.01], [p.radius * 0.45, FLANGE + 0.002, 0], materials.safetyYellow, 'Index mark');
    const mount = mountPoint(turning, 'Mount flange', [0, FLANGE, 0]);
    if (p.hang) mount.rotation.x = Math.PI;
    // Hung, the body is upside down: turn the flange the other way so a positive angle is
    // counter-clockwise seen from above either way.
    const sense = p.hang ? -1 : 1;
    return { root, motions: { angle: (v) => { turning.rotation.y = sense * v; } }, anchors: { flange: mount } };
  },
});
