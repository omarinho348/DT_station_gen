// Pop-up cross transfer: a row of wheels between a conveyor's strands that lifts the carrier off
// the belts and drives it sideways (onto a reject lane, a branch, a buffer). Ported from the
// reference ST5 InspectionEquipment.js (CrossTransfer). Origin on the floor at the transfer
// centre; the wheels roll along Z, so the product leaves sideways.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder } from '../../core/primitives.js';

const WHEEL_RADIUS = 0.018;
const WHEEL_TOP_LOWERED = -0.03 + WHEEL_RADIUS; // relative to the belt: just below it when lowered

defineComponent({
  type: 'crossTransfer',
  category: 'conveyor',
  summary: 'Pop-up cross transfer: wheels between the conveyor strands lift the product and drive it sideways.',
  params: z.object({
    span: z.number().min(0.3).max(1.6).default(0.8).describe('Wheel row length along X (m)'),
    wheels: z.number().int().min(2).max(9).default(5).describe('Wheels'),
    wheelLength: z.number().min(0.15).max(0.6).default(0.36).describe('Wheel length along Z (m)'),
    rise: z.number().min(0.01).max(0.06).default(0.03).describe('Lift (m)'),
  }),
  footprint: (p, ctx) => ({
    x: [-(p.span / 2 + 0.02), p.span / 2 + 0.02], // the wheel frame overhangs the end wheels by 2 cm
    z: [-Math.max(p.wheelLength / 2, 0.09), Math.max(p.wheelLength / 2, 0.09)],
    height: ctx.beltHeight + WHEEL_TOP_LOWERED + p.rise,
  }),
  mount: 'overConveyor',
  // Where the product is handed sideways: at belt height, leaving towards −Z.
  ports: (p, ctx) => ({ transfer: { position: [0, ctx.beltHeight, 0], direction: 'out', carries: 'unit' } }),
  motions: {
    raise: { range: [0, 1] }, // 0 below the belts, 1 lifted by `rise`
    spin: { range: [0, 1], wrap: true, travel: 2 * Math.PI * WHEEL_RADIUS, angle: 2 * Math.PI }, // wheel turn phase (0…1 = one full turn)
  },
  // What the wheels lift: a carrier attached here rises and lowers with them.
  anchors: ['carrier'],
  build({ params, materials, beltHeight }) {
    const { span, wheels, wheelLength, rise } = params;
    const root = group(null, 'crossTransfer');
    const wheelY = beltHeight - 0.03;
    // Lift: a pneumatic cylinder on a floor plate under the wheel frame. (The reference wheels
    // hung in the air between the strands, with no frame or lift under them.)
    const cylinderTop = wheelY - 0.12;
    box(root, [0.18, 0.012, 0.18], [0, 0.006, 0], materials.frameDark, 'Transfer base');
    cylinder(root, 0.04, cylinderTop - 0.012, [0, 0.012 + (cylinderTop - 0.012) / 2, 0], materials.machineGrey, 'Lift cylinder', { segments: 18 });
    const lift = group(root, 'Transfer frame');
    const frameTop = wheelY - WHEEL_RADIUS - 0.012;
    cylinder(lift, 0.015, frameTop - 0.03 - cylinderTop + 0.06, [0, cylinderTop - 0.06 + (frameTop - 0.03 - cylinderTop + 0.06) / 2, 0], materials.chrome, 'Lift rod', { segments: 12 });
    box(lift, [span + 0.04, 0.03, 0.06], [0, frameTop - 0.015, 0], materials.frame, 'Wheel frame');
    const pitch = span / (wheels - 1);
    const wheelMeshes = [];
    for (let i = 0; i < wheels; i += 1) {
      const x = -span / 2 + i * pitch;
      box(lift, [0.02, 0.012, 0.03], [x, frameTop + 0.006, 0], materials.frame, 'Wheel bearing');
      wheelMeshes.push(cylinder(lift, WHEEL_RADIUS, wheelLength, [x, wheelY, 0], materials.rubber, 'Cross transfer wheel', { axis: 'z', segments: 12 }));
    }
    const carrier = group(lift, 'Transfer carrier point', [0, beltHeight, 0]);
    return {
      root,
      anchors: { carrier },
      motions: {
        raise: (v) => { lift.position.y = v * rise; },
        spin: (v) => wheelMeshes.forEach((w) => { w.rotation.z = v * 2 * Math.PI; }),
      },
    };
  },
});
