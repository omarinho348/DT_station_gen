// Flat-belt product conveyor: side frames, carry and return belt, head / tail drums on shafts with
// bearing housings, return rollers, legs with levelling feet and bracing, optional adjustable side
// guides and an optional gear motor at the discharge end. Port of the reference station-1
// OilConveyor.js (createBeltConveyor). Centred on the origin, flow along +X; the belt top is at the
// line's belt height.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder, cylinderGeometry, roundedBox } from '../../core/primitives.js';

const BELT_TILE = 0.5; // belt texture repeats every 0.5 m; the `belt` motion is the phase within one tile
const DRUM_RADIUS = 0.045;
const DRUM_TURNS_PER_TILE = 2; // ≈ 0.5 m / (2π·0.045 m) = 1.77; whole turns so the phase can wrap 1 → 0
const RETURN_RADIUS = 0.025;
const RETURN_TURNS_PER_TILE = 3; // ≈ 0.5 m / (2π·0.025 m) = 3.18
const GUIDE_HEIGHTS = [0.06, 0.15]; // guide rails above the belt
const GUIDE_POST = 0.21;
const MOTOR_DEPTH = 0.18; // the motor's fan cover reaches this far out from the front frame
const MOTOR_OVERHANG = 0.025; // the gearbox stands this far past the discharge end (as in the reference)
const FRAME_PROUD = 0.01; // side frames stand 1 cm above the belt

const frameZOf = (p) => p.beltWidth / 2 + 0.03;
const legXs = (length) => {
  const count = Math.max(2, Math.ceil(length / 1.6) + 1);
  return Array.from({ length: count }, (_, i) => -length / 2 + 0.2 + (i * (length - 0.4)) / (count - 1));
};

defineComponent({
  type: 'beltConveyor',
  category: 'conveyor',
  summary: 'Flat-belt conveyor for loose units (cans, bottles, cases): drums, return rollers, legs, optional side guides and gear motor.',
  params: z.object({
    length: z.number().min(0.8).max(12).default(4).describe('Length along X (m)'),
    beltWidth: z.number().min(0.15).max(1.1).default(0.34).describe('Belt width (m)'),
    guides: z.boolean().default(true).describe('Adjustable side guides'),
    guideGap: z.number().min(0.08).max(0.95).default(0.22).describe('Clear width between the side guides (m)'),
    drive: z.boolean().default(true).describe('Gear motor at the discharge (+X) end'),
    carries: z.enum(['unit', 'batch', 'case']).default('unit').describe('What flows on it'),
  }).refine((p) => p.guideGap <= p.beltWidth + 0.02, { message: 'guideGap must not exceed the belt width + 2 cm', path: ['guideGap'] }),
  footprint: (p, ctx) => {
    const frameZ = frameZOf(p);
    return {
      x: [-p.length / 2, p.length / 2 + (p.drive ? MOTOR_OVERHANG : 0)],
      z: [-(frameZ + 0.045), frameZ + (p.drive ? MOTOR_DEPTH : 0.045)],
      height: ctx.beltHeight + (p.guides ? GUIDE_POST : FRAME_PROUD),
    };
  },
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-p.length / 2, ctx.beltHeight, 0], direction: 'in', carries: p.carries },
    output: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: p.carries },
  }),
  motions: { belt: { range: [0, 1], wrap: true, travel: BELT_TILE } }, // phase of the belt within one texture tile
  ops: [],
  build({ params, materials, beltHeight }) {
    const { length, beltWidth, guides, guideGap, drive } = params;
    const half = length / 2;
    const frameZ = frameZOf(params);
    const guideZ = guideGap / 2 + 0.007; // rail centre (rails are 14 mm thick)
    const root = group(null, 'beltConveyor');

    // Own belt material: its texture offset is this conveyor's belt motion.
    const beltMaterial = materials.belt.clone();
    beltMaterial.map = materials.belt.map.clone();
    beltMaterial.map.repeat.set((length - 0.1) / BELT_TILE, 1);
    beltMaterial.map.needsUpdate = true;
    beltMaterial.name = 'belt (own)';

    [-1, 1].forEach((side) => {
      roundedBox(root, [length, 0.14, 0.035], [0, beltHeight - 0.06, side * frameZ], materials.aluminium, `Side frame ${side > 0 ? 'front' : 'rear'}`, 0.006);
    });
    box(root, [length - 0.1, 0.012, beltWidth], [0, beltHeight - 0.006, 0], beltMaterial, 'Belt carry side');
    box(root, [length - 0.1, 0.01, beltWidth], [0, beltHeight - 0.095, 0], materials.beltReturn, 'Belt return side');

    // Drums turn on shafts carried by bearing housings on the frames. (The reference drums had
    // hubs beside the frames but no shaft, so nothing held them.) The head shaft reaches the
    // gearbox when there is a drive.
    const drums = [];
    [-1, 1].forEach((side) => {
      const x = side * (half - 0.05);
      const y = beltHeight - DRUM_RADIUS;
      const drum = addMesh(root, cylinderGeometry(DRUM_RADIUS, beltWidth, { axis: 'z', segments: 28 }), materials.beltReturn, side > 0 ? 'Head drum' : 'Tail drum', [x, y, 0]);
      drums.push(drum);
      const front = frameZ + (drive && side > 0 ? 0.08 : 0.04);
      const back = frameZ + 0.04;
      // Shaft and hubs turn with the drum (hub keys make the rotation readable).
      addMesh(drum, cylinderGeometry(0.012, front + back, { axis: 'z', segments: 12 }), materials.stainless, 'Drum shaft', [0, 0, (front - back) / 2]);
      [-1, 1].forEach((hubSide) => {
        addMesh(drum, cylinderGeometry(0.022, 0.012, { axis: 'z', segments: 20 }), materials.stainless, 'Hub', [0, 0, hubSide * (frameZ + 0.022)]);
        box(drum, [0.03, 0.006, 0.006], [0.008, 0, hubSide * (frameZ + 0.03)], materials.frameDark, 'Hub key');
      });
      roundedBox(root, [0.07, 0.07, 0.025], [x, y, frameZ + 0.03], materials.frameDark, 'Bearing housing front', 0.008);
      roundedBox(root, [0.07, 0.07, 0.025], [x, y, -frameZ - 0.03], materials.frameDark, 'Bearing housing rear', 0.008);
    });

    const returnRollers = [];
    const returnCount = Math.max(2, Math.floor(length / 0.9));
    for (let i = 0; i < returnCount; i += 1) {
      const x = -half + 0.35 + (i * (length - 0.7)) / Math.max(returnCount - 1, 1);
      // Rollers span the frames (the reference's were 2.5 mm short of them on each side).
      returnRollers.push(addMesh(root, cylinderGeometry(RETURN_RADIUS, frameZ * 2, { axis: 'z', segments: 16 }), materials.stainless, `Return roller ${i + 1}`, [x, beltHeight - 0.125, 0]));
    }

    // Legs with levelling feet and bracing.
    const legHeight = beltHeight - 0.13;
    const xs = legXs(length);
    xs.forEach((x, i) => {
      [-1, 1].forEach((side) => {
        roundedBox(root, [0.05, legHeight - 0.06, 0.05], [x, 0.06 + (legHeight - 0.06) / 2, side * frameZ], materials.aluminium, `Leg ${i + 1}`, 0.006);
        cylinder(root, 0.012, 0.05, [x, 0.04, side * frameZ], materials.stainless, `Levelling screw ${i + 1}`, { segments: 12 });
        cylinder(root, 0.04, 0.014, [x, 0.007, side * frameZ], materials.rubber, `Levelling foot ${i + 1}`, { segments: 20 });
      });
      roundedBox(root, [0.04, 0.04, frameZ * 2], [x, 0.3, 0], materials.aluminium, `Cross brace ${i + 1}`, 0.005);
    });
    [-1, 1].forEach((side) => {
      roundedBox(root, [length - 0.4, 0.04, 0.04], [0, 0.3, side * frameZ], materials.aluminium, 'Longitudinal brace', 0.005);
    });

    // Adjustable side guides keep units on the belt centre line.
    if (guides) {
      const g = group(root, 'Side guides');
      const bracketCount = Math.max(2, Math.ceil(length / 0.8));
      [-1, 1].forEach((side) => {
        GUIDE_HEIGHTS.forEach((h, r) => {
          roundedBox(g, [length - 0.12, 0.03, 0.014], [0, beltHeight + h, side * guideZ], materials.guide, `Guide rail ${r + 1}`, 0.005);
        });
        for (let i = 0; i < bracketCount; i += 1) {
          const x = -half + 0.15 + (i * (length - 0.3)) / (bracketCount - 1);
          cylinder(g, 0.007, GUIDE_POST, [x, beltHeight + GUIDE_POST / 2, side * (frameZ + 0.006)], materials.stainless, 'Guide post', { segments: 10 });
          GUIDE_HEIGHTS.forEach((h) => {
            // Arm from the post to the rail.
            const inner = guideZ;
            const outer = frameZ + 0.006;
            box(g, [0.02, 0.012, outer - inner], [x, beltHeight + h, side * (outer + inner) / 2], materials.stainless, 'Guide arm');
          });
        }
      });
    }

    if (drive) {
      const motor = group(root, 'Gear motor', [half - 0.05, beltHeight - DRUM_RADIUS, frameZ + 0.11]);
      roundedBox(motor, [0.15, 0.15, 0.11], [0, 0, 0], materials.motor, 'Gearbox', 0.02);
      cylinder(motor, 0.065, 0.26, [-0.2, 0, 0], materials.motor, 'Motor', { axis: 'x', segments: 28 });
      cylinder(motor, 0.067, 0.05, [-0.355, 0, 0], materials.frameDark, 'Fan cover', { axis: 'x', segments: 28 });
      roundedBox(motor, [0.08, 0.05, 0.08], [-0.18, 0.085, 0], materials.motor, 'Terminal box', 0.01);
    }

    return {
      root,
      motions: {
        belt(phase) {
          beltMaterial.map.offset.x = -phase;
          drums.forEach((d) => { d.rotation.z = -phase * DRUM_TURNS_PER_TILE * 2 * Math.PI; });
          returnRollers.forEach((r) => { r.rotation.z = phase * RETURN_TURNS_PER_TILE * 2 * Math.PI; });
        },
      },
    };
  },
});
