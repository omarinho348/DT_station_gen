// Basic axis: a linear axis (an aluminium profile with a carriage on a rail, belt or ball-screw
// driven), along local X. Turn it about Y to run along Z.
//
// Basic-block mounting (Phase 6): an axis's origin is its MOUNTING FACE, the middle of the profile's
// back. Standing (default) the profile rises from it and the carriage rides on top; hung
// (`hang: true`, under a beam) the profile hangs below it and the carriage rides underneath.
// Mount point `carriage` on the carriage's free face (Y up either way), moving with motion
// `travel` (metres, carriage centre from the middle of the stroke).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, roundedBox, cylinder } from '../../core/primitives.js';
import { frameColor, mountPoint } from '../frames/common.js';

const CARRIAGE = 0.16; // carriage length along X
const CAP = 0.04; // end cap / motor block length
const CARRIAGE_H = 0.04;

defineComponent({
  type: 'linearAxis',
  category: 'axis',
  summary: 'Basic linear axis: profile with a carriage on a rail and a drive motor; standing or hung; a mount point on the carriage.',
  params: z.object({
    stroke: z.number().min(0.1).max(4).default(0.8).describe('Carriage travel (m)'),
    section: z.number().min(0.05).max(0.2).default(0.08).describe('Profile height and width (m)'),
    hang: z.boolean().default(false).describe('Hung under a beam: profile and carriage below the mounting face'),
    color: frameColor('machineGrey'),
  }),
  footprint: (p) => {
    const half = p.stroke / 2 + CARRIAGE / 2 + CAP + 0.12; // the motor sits past the +X cap
    const w = Math.max(p.section * 1.05, CARRIAGE * 0.9) / 2; // end caps or carriage
    const depth = p.section + CARRIAGE_H;
    return p.hang
      ? { x: [-half, half], z: [-w, w], height: 0.001, bottom: -depth }
      : { x: [-half, half], z: [-w, w], height: depth };
  },
  mount: 'surface',
  anchors: ['carriage'],
  motions: (p) => ({ travel: { range: [-p.stroke / 2, p.stroke / 2], default: 0 } }),
  build({ params: p, materials }) {
    const root = group(null, 'linearAxis');
    // Built standing, then flipped about X when hung (the mount point is turned back to Y up).
    const body = group(root, 'Axis body');
    if (p.hang) body.rotation.x = Math.PI;
    const s = p.section;
    const len = p.stroke + CARRIAGE + 2 * CAP;
    roundedBox(body, [len - 2 * CAP, s, s], [0, s / 2, 0], materials[p.color], 'Profile', 0.004);
    box(body, [len - 2 * CAP, 0.008, s * 0.4], [0, s + 0.004, 0], materials.stainless, 'Rail');
    for (const [side, x] of [['drive', len / 2 - CAP / 2], ['idler', -len / 2 + CAP / 2]]) {
      box(body, [CAP, s * 1.05, s * 1.05], [x, s * 1.05 / 2, 0], materials.frameDark, `End cap ${side}`);
    }
    cylinder(body, s * 0.35, 0.12, [len / 2 + 0.06, s / 2, 0], materials.motor, 'Drive motor', { axis: 'x', segments: 20 });
    const carriage = group(body, 'Carriage', [0, s, 0]);
    roundedBox(carriage, [CARRIAGE, CARRIAGE_H, CARRIAGE * 0.9], [0, CARRIAGE_H / 2, 0], materials.aluminium, 'Carriage plate', 0.004);
    const mount = mountPoint(carriage, 'Mount carriage', [0, CARRIAGE_H, 0]);
    if (p.hang) mount.rotation.x = Math.PI; // Y up again
    return { root, motions: { travel: (v) => { carriage.position.x = v; } }, anchors: { carriage: mount } };
  },
});
