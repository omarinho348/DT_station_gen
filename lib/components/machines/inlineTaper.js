// Inline top case taper: a bridge over a case conveyor with a fixed taping head (tape roll, web,
// wipe rollers) at the height of the case tops; the case is conveyed under it and taped as it
// passes. Port of the reference station-2 PackingLineEquipment.js (createBoxConveyors' CaseTaper).
// Unlike `caseTaper` (a head that travels over a standing carton) the head stays put. Centred on
// the head; heights follow the belt height.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

const ROLLER = 0.028;
const ROLL = 0.09;
const HEAD_TOP = 0.2; // head (top bar) above the case top; the hanger takes over from here

defineComponent({
  type: 'inlineTaper',
  category: 'machine',
  summary: 'Inline top case taper: fixed taping head on a bridge over a case conveyor; cases are taped as they pass under it.',
  params: z.object({
    caseHeight: z.number().min(0.15).max(0.8).default(0.42).describe('Case top above the belt (m)'),
    beltWidth: z.number().min(0.2).max(1.0).default(0.52).describe('Width of the belt it bridges (m)'),
  }),
  footprint: (p, ctx) => {
    const colZ = p.beltWidth / 2 + 0.14;
    return { x: [-0.2, 0.14], z: [-(colZ + 0.11), colZ + 0.11], height: ctx.beltHeight + p.caseHeight + 0.42 + 0.05 };
  },
  mount: 'overConveyor',
  ports: (p, ctx) => ({ work: { position: [0, ctx.beltHeight, 0], direction: 'work', carries: 'case' } }),
  // Tape feed phase: one full range = one turn of the tape roll (2π · 0.09 m of tape), so ops can
  // scroll it with the case travel; the wipe rollers turn with it.
  motions: { feed: { range: [0, 1], wrap: true, travel: 2 * Math.PI * ROLL } },
  ops: [],
  build({ params, materials, beltHeight }) {
    const { caseHeight, beltWidth } = params;
    const top = beltHeight + caseHeight;
    const bridgeTop = top + 0.42;
    const colZ = beltWidth / 2 + 0.14;
    const root = group(null, 'inlineTaper');
    [-1, 1].forEach((side) => {
      roundedBox(root, [0.08, bridgeTop, 0.08], [0, bridgeTop / 2, side * colZ], materials.frame, 'Taper column', 0.012);
      roundedBox(root, [0.22, 0.02, 0.22], [0, 0.01, side * colZ], materials.brushed, 'Taper foot', 0.004);
    });
    roundedBox(root, [0.12, 0.1, colZ * 2 + 0.1], [0, bridgeTop, 0], materials.frame, 'Taper beam', 0.012);
    roundedBox(root, [0.04, bridgeTop - top - HEAD_TOP - 0.01, 0.04], [0, (bridgeTop + top + HEAD_TOP + 0.01) / 2, 0], materials.stainless, 'Head hanger', 0.006);

    // Taping head, origin on the case top. A side plate and a top bar carry the rollers, the roll
    // and the cover. (In the reference the cover, rollers and web touched neither each other nor
    // the hanger; only the tape roll did.)
    const head = group(root, 'Taping head', [0, top, 0]);
    roundedBox(head, [0.34, HEAD_TOP + 0.02, 0.012], [-0.03, (HEAD_TOP + 0.02) / 2, -0.04], materials.brushed, 'Side plate', 0.004);
    roundedBox(head, [0.34, 0.02, 0.16], [-0.03, HEAD_TOP + 0.01, 0.035], materials.brushed, 'Head top bar', 0.004);
    roundedBox(head, [0.34, 0.12, 0.08], [-0.03, 0.14, 0.07], materials.safetyYellow, 'Head cover', 0.015);
    const rollers = [-0.15, 0.1].map((x, i) => cylinder(head, ROLLER, 0.07, [x, ROLLER + 0.002, -0.005], materials.rubber, `Wipe roller ${i + 1}`, { axis: 'z', segments: 20 }));
    cylinder(head, 0.012, 0.045, [-0.05, 0.2 - ROLL + 0.09, -0.02], materials.stainless, 'Roll axle', { axis: 'z', segments: 12 });
    const roll = group(head, 'Tape roll', [-0.05, 0.2 - ROLL + 0.09, 0]);
    const tape = materials.cardboard.clone();
    tape.color.set(0xe1c083);
    tape.name = 'tape';
    cylinder(roll, ROLL, 0.05, [0, 0, 0], tape, 'Tape roll', { axis: 'z', segments: 32 });
    cylinder(roll, 0.04, 0.052, [0, 0, 0], materials.guide, 'Tape core', { axis: 'z', segments: 24 });
    box(roll, [0.03, 0.012, 0.054], [0.06, 0, 0], materials.frameDark, 'Roll index mark');
    box(head, [0.004, 0.17, 0.05], [0.11, 0.1, 0], tape, 'Tape web');

    return {
      root,
      motions: {
        feed(v) {
          const metres = v * 2 * Math.PI * ROLL;
          roll.rotation.z = -metres / ROLL;
          rollers.forEach((r) => { r.rotation.z = -metres / ROLLER; });
        },
      },
    };
  },
});
