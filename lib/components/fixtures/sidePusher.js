// Pneumatic side pusher beside a conveyor: a stand on the floor carries a cylinder whose plate
// pushes units across the belt (a row former shifting cans from one lane into two). Port of the
// reference factory/TransferLines.js (createCanTransfer's pushers). Origin on the floor on the
// belt's centre line under the plate; the pusher stands on +Z and pushes towards −Z (turn it 180°
// for the other side). Motion `face`: where the plate's pushing face is, measured from the belt
// centre line along +Z. Anchor `face`: the middle of the pushing face (ops push units with it).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

const STAND_Z = 0.78;
const BARREL = { z: 0.62, length: 0.34, radius: 0.04 };
const ROD = 0.5; // piston rod behind the plate
const ABOVE_BELT = 0.25; // cylinder axis above the belt

defineComponent({
  type: 'sidePusher',
  category: 'fixture',
  summary: 'Pneumatic side pusher on a floor stand beside a conveyor: its plate pushes units across the belt (row former).',
  params: z.object({
    plateLength: z.number().min(0.2).max(1.2).default(0.68).describe('Plate length along the belt (m)'),
  }),
  footprint: (p, ctx) => ({
    x: [-Math.max(p.plateLength / 2, 0.11), Math.max(p.plateLength / 2, 0.11)],
    z: [-0.05, STAND_Z + 0.11],
    height: ctx.beltHeight + ABOVE_BELT + 0.05,
  }),
  mount: 'besideConveyor',
  anchors: ['face'],
  // 0.25 = retracted beside a 0.52 m belt (reference); −0.04 = pushed across the centre line.
  motions: { face: { range: [-0.04, 0.3], default: 0.25 } },
  ops: [],
  build({ params, materials, beltHeight }) {
    const y = beltHeight + ABOVE_BELT;
    const root = group(null, 'sidePusher');
    // The stand reaches the cylinder's axis. (The reference's stopped 1 cm under the barrel.)
    roundedBox(root, [0.12, y, 0.12], [0, y / 2, STAND_Z], materials.frame, 'Pusher stand', 0.012);
    roundedBox(root, [0.22, 0.02, 0.22], [0, 0.01, STAND_Z], materials.brushed, 'Stand foot', 0.004);
    cylinder(root, BARREL.radius, BARREL.length, [0, y, BARREL.z], materials.aluminium, 'Cylinder barrel', { axis: 'z', segments: 20 });
    cylinder(root, 0.045, 0.03, [0, y, BARREL.z - BARREL.length / 2 + 0.015], materials.frameDark, 'Rod-end cap', { axis: 'z', segments: 20 });
    const plate = group(root, 'Pusher plate');
    // The rubber pad's surface is the pushing face, exactly at `face`; the plate is behind it.
    box(plate, [params.plateLength - 0.04, 0.08, 0.004], [0, y, 0.002], materials.rubber, 'Plate pad');
    roundedBox(plate, [params.plateLength, 0.1, 0.012], [0, y, 0.01], materials.safetyYellow, 'Plate', 0.004);
    cylinder(plate, 0.012, ROD, [0, y, 0.014 + ROD / 2], materials.chrome, 'Piston rod', { axis: 'z', segments: 12 });
    [-0.2, 0.2].filter((x) => Math.abs(x) < params.plateLength / 2 - 0.02).forEach((x) => cylinder(plate, 0.008, 0.36, [x, y, 0.19], materials.chrome, 'Guide rod', { axis: 'z', segments: 10 }));
    const face = group(plate, 'Pushing face', [0, y, 0]);
    return { root, anchors: { face }, motions: { face(v) { plate.position.z = v; } } };
  },
});
