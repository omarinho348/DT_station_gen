// Twin-strand pallet conveyor, the standard transport of assembly lines: two narrow belts on
// aluminium profiles carry the work carrier by its edges. Runs along +X, centred on the origin.
// Ported from the reference LineEquipment.createPalletConveyor.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, roundedBox, cylinder, cylinderGeometry } from '../../core/primitives.js';

const BELT_TILE = 0.5; // belt texture repeats every 0.5 m; the `belt` motion is the phase within one tile
const PULLEY_RADIUS = 0.035;
const PULLEY_TURNS_PER_TILE = 2; // ≈ 0.5 m / (2π·0.035 m); whole turns so the phase can wrap 1 → 0

defineComponent({
  type: 'palletConveyor',
  category: 'conveyor',
  summary: 'Twin-strand pallet conveyor on aluminium profiles, with optional work stop, lift-and-locate unit and return line.',
  params: z.object({
    length: z.number().min(0.8).max(12).default(4.4).describe('Length (m)'),
    strandZ: z.number().min(0.15).max(0.5).default(0.24).describe('Strand offset from centre (m)'),
    strandWidth: z.number().min(0.04).max(0.1).default(0.06).describe('Belt width (m)'),
    workStop: z.boolean().default(true).describe('Stop and lift-and-locate at x = 0'),
    carrierLength: z.number().min(0.4).max(1.6).default(1.2).describe('Carrier length (m)'),
    returnLine: z.boolean().default(true).describe('Return line underneath'),
    drive: z.boolean().default(true).describe('Drive motor'),
  }).refine((p) => !p.workStop || p.carrierLength <= p.length - 0.12, {
    message: 'carrierLength must be at least 0.12 m shorter than length (room for the stop pin)',
    path: ['carrierLength'],
  }),
  footprint: (p, ctx) => ({
    x: [-p.length / 2, p.length / 2],
    z: [-(p.strandZ + 0.17), p.strandZ + p.strandWidth / 2 + 0.03],
    height: ctx.beltHeight + 0.05, // raised stop pin
  }),
  mount: 'floor',
  ports: (p, ctx) => ({
    input: { position: [-p.length / 2, ctx.beltHeight, 0], direction: 'in', carries: 'pallet' },
    ...(p.workStop ? { work: { position: [0, ctx.beltHeight, 0], direction: 'work', carries: 'pallet' } } : {}),
    output: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: 'pallet' },
  }),
  motions: {
    belt: { range: [0, 1] }, // phase of the belt within one texture tile (ops wrap it as carriers travel)
    stop: { range: [0, 1] }, // 0 = pin retracted below the carrier, 1 = raised in its path
    locate: { range: [0, 1] }, // 0 = plate lowered, 1 = carrier lifted off the belts onto the pins
  },
  ops: [],
  build({ params, materials, beltHeight }) {
    const { length, strandZ, strandWidth, workStop, carrierLength, returnLine, drive } = params;
    const half = length / 2;
    const root = group(null, 'palletConveyor');

    // Own belt material: its texture offset is this conveyor's belt motion.
    const beltMaterial = materials.belt.clone();
    beltMaterial.map = materials.belt.map.clone();
    beltMaterial.map.repeat.set(length / BELT_TILE, 0.25);
    beltMaterial.map.needsUpdate = true;

    const pulleys = [];
    [-1, 1].forEach((side) => {
      const z = side * strandZ;
      roundedBox(root, [length, 0.08, 0.045], [0, beltHeight - 0.05, z + side * 0.012], materials.aluminium, 'Strand profile', 0.005);
      box(root, [length - 0.02, 0.006, strandWidth], [0, beltHeight - 0.003, z], beltMaterial, 'Strand belt');
      box(root, [length, 0.03, 0.01], [0, beltHeight + 0.012, z + side * (strandWidth / 2 + 0.012)], materials.guide, 'Side guide');
      [-1, 1].forEach((endSide) => {
        pulleys.push(addMesh(root, cylinderGeometry(PULLEY_RADIUS, strandWidth + 0.01, { axis: 'z', segments: 20 }), materials.beltReturn, 'Pulley', [endSide * (half - PULLEY_RADIUS), beltHeight - PULLEY_RADIUS, z]));
      });
    });

    // Cross ties and legs.
    const legCount = Math.max(2, Math.ceil(length / 1.4) + 1);
    for (let index = 0; index < legCount; index += 1) {
      const x = -half + 0.12 + (index * (length - 0.24)) / (legCount - 1);
      box(root, [0.05, 0.05, strandZ * 2 + 0.06], [x, beltHeight - 0.11, 0], materials.aluminium, 'Cross tie');
      [-1, 1].forEach((side) => {
        roundedBox(root, [0.05, beltHeight - 0.14, 0.05], [x, (beltHeight - 0.14) / 2 + 0.03, side * (strandZ + 0.012)], materials.aluminium, 'Leg', 0.005);
        cylinder(root, 0.035, 0.012, [x, 0.006, side * (strandZ + 0.012)], materials.rubber, 'Levelling foot', { segments: 16 });
        // Threaded stem between foot and leg (the reference leg started 18 mm above the foot).
        cylinder(root, 0.01, 0.03, [x, 0.025, side * (strandZ + 0.012)], materials.stainless, 'Levelling stem', { segments: 10 });
      });
      box(root, [0.04, 0.04, strandZ * 2], [x, 0.16, 0], materials.aluminium, 'Lower tie');
    }

    if (returnLine) {
      [-1, 1].forEach((side) => {
        box(root, [length, 0.05, 0.035], [0, 0.32, side * strandZ], materials.aluminium, 'Return strand profile');
        box(root, [length - 0.02, 0.005, 0.04], [0, 0.347, side * strandZ], materials.beltReturn, 'Return belt');
      });
    }

    if (drive) {
      const motor = group(root, 'DriveMotor', [half - 0.2, beltHeight - 0.13, -strandZ - 0.12]);
      cylinder(motor, 0.045, 0.16, [0, 0, 0], materials.motor, 'Motor', { axis: 'x', segments: 20 });
      roundedBox(motor, [0.1, 0.1, 0.09], [0.12, 0, 0.02], materials.motor, 'Gearbox', 0.01);
      // Bracket to the strand profile (the reference motor hung 4 cm off the frame).
      box(motor, [0.12, 0.1, 0.03], [0.12, 0, 0.075], materials.aluminium, 'Motor bracket');
    }

    // Pneumatic stop pin just ahead of the work position, and the lift-and-locate plate.
    // Both cylinders hang from cross brackets under the strand profiles; the reference had no
    // mounts (they only touched a cross tie by chance at some lengths).
    const underProfiles = beltHeight - 0.1; // bracket centre, its top touches the profiles
    let setStop = () => {};
    let setLocate = () => {};
    if (workStop) {
      const stopRoot = group(root, 'CarrierStop', [carrierLength / 2 + 0.03, 0, 0]);
      box(stopRoot, [0.05, 0.03, strandZ * 2], [0, underProfiles, 0], materials.aluminium, 'Stop bracket');
      cylinder(stopRoot, 0.03, 0.14, [0, beltHeight - 0.13, 0], materials.stainless, 'Stop cylinder', { segments: 16 });
      const pin = roundedBox(stopRoot, [0.03, 0.06, 0.08], [0, beltHeight - 0.03, 0], materials.safetyYellow, 'Stop pin', 0.004);
      // Piston rod under the pin, so the raised pin stays joined to its cylinder.
      cylinder(pin, 0.008, 0.06, [0, -0.045, 0], materials.chrome, 'Stop rod', { segments: 10 });
      setStop = (raised) => { pin.position.y = beltHeight - 0.045 + raised * 0.06; };

      const locate = group(root, 'LiftAndLocate', [0, 0, 0]);
      box(locate, [0.05, 0.03, strandZ * 2], [0, underProfiles, 0], materials.aluminium, 'Locate bracket');
      cylinder(locate, 0.035, 0.18, [0, beltHeight - 0.19, 0], materials.stainless, 'Lift cylinder', { segments: 16 });
      const plate = group(locate, 'LocatePlate', [0, 0, 0]);
      // Plate spans both index pins (the reference plate was 0.6 m with pins at ±0.55 m).
      box(plate, [carrierLength - 0.04, 0.014, 0.3], [0, beltHeight - 0.03, 0], materials.frameDark, 'Lift plate');
      cylinder(plate, 0.012, 0.08, [0, beltHeight - 0.077, 0], materials.chrome, 'Lift rod', { segments: 10 });
      [-1, 1].forEach((side) => cylinder(plate, 0.008, 0.04, [side * (carrierLength / 2 - 0.05), beltHeight - 0.005, 0], materials.chrome, 'Index pin', { segments: 10 }));
      setLocate = (raised) => { plate.position.y = -0.03 + raised * 0.03; };
    }

    return {
      root,
      motions: {
        belt(phase) {
          beltMaterial.map.offset.x = -phase;
          const angle = -phase * PULLEY_TURNS_PER_TILE * 2 * Math.PI;
          pulleys.forEach((pulley) => { pulley.rotation.z = angle; });
        },
        stop: setStop,
        locate: setLocate,
      },
    };
  },
});
