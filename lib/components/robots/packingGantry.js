// Two-axis Cartesian packing gantry: a carriage travels along Z on twin beams between two
// conveyors, a mast lowers the gripper head, and the head carries a grid of pneumatic handle
// grippers on pitch-change rails, so a group picked at conveyor-lane spacing is set down at case
// spacing. Port of the reference station-2 PickAndPlaceRobot.js. Centred on the origin; the gantry
// frame stands at x = 0 and spans z ∈ ±columnZ.
//
// Each gripper's origin is the point it holds (a jerry can's handle-grip centre), and an anchor
// (grip1 … gripN, rear row first, then front, each along +X), so ops can carry items on it.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const BEAM_X = 0.26; // beam centre lines at x ±0.26
const MAST = 1.25;
const CARRIAGE_HALF_Z = 0.17;
const FINGER = { open: 0.09, closed: 0.047 }; // gap between the finger plates (m)

const gripXsOf = (p) => Array.from({ length: p.columns }, (_, i) => Math.round((i - (p.columns - 1) / 2) * p.columnPitch * 1e9) / 1e9);
const plateHalfXOf = (p) => Math.max(0.3, (Math.max(...gripXsOf(p).map(Math.abs)) + 0.1));
const yRangeOf = (p) => [p.beamY - 1.6, p.beamY - 0.4]; // the mast stays in its guide; the head stays under the carriage
const zLimitOf = (p) => p.columnZ - 0.09 - CARRIAGE_HALF_Z; // carriage against the end stops

defineComponent({
  type: 'packingGantry',
  category: 'robot',
  summary: 'Two-axis packing gantry: carriage along Z between conveyors, vertical mast, grid of handle grippers with pitch change (pick at lane spacing, place at case spacing).',
  params: z.object({
    columnZ: z.number().min(0.8).max(2.5).default(1.65).describe('Half the Z span between the column pairs (m)'),
    beamY: z.number().min(2.0).max(3.2).default(2.45).describe('Beam centre height (m)'),
    columns: z.number().int().min(1).max(4).default(2).describe('Grippers per row, along X'),
    columnPitch: z.number().min(0.12).max(0.5).default(0.28).describe('Distance between grippers along X (m)'),
    rows: z.number().int().min(1).max(2).default(2).describe('Gripper rows along Z (2: pitch-change pair)'),
  }),
  footprint: (p) => {
    const halfX = Math.max(BEAM_X + 0.13, BEAM_X + 0.08, plateHalfXOf(p));
    return {
      x: [-halfX, halfX],
      z: [-(p.columnZ + 0.13), p.columnZ + 0.13],
      height: yRangeOf(p)[1] + 0.2 + MAST, // the mast sticks up out of the carriage when raised
    };
  },
  mount: 'floor',
  anchors: (p) => Array.from({ length: p.rows * p.columns }, (_, i) => `grip${i + 1}`),
  motions: (p) => ({
    z: { range: [-zLimitOf(p), zLimitOf(p)], default: 0 }, // carriage along Z (m)
    y: { range: yRangeOf(p), default: yRangeOf(p)[1] }, // gripper origin height (m)
    pitch: { range: [0.11, 0.36], default: 0.26 }, // row spacing along Z, centre to centre (m)
    grip: { range: [FINGER.closed, FINGER.open], default: FINGER.open }, // gap between the fingers (m)
    beacon: { values: ['off', 'run', 'wait', 'alarm'], default: 'off' },
  }),
  ops: [],
  build({ params, materials }) {
    const { columnZ, beamY, rows } = params;
    const gripXs = gripXsOf(params);
    const plateHalfX = plateHalfXOf(params);
    const root = group(null, 'packingGantry');

    // Frame: four columns, ties, the two Z beams with linear rails.
    const frame = group(root, 'Gantry frame');
    const postTop = beamY - 0.09;
    [-1, 1].forEach((sz) => {
      [-1, 1].forEach((sx) => {
        roundedBox(frame, [0.12, postTop, 0.12], [sx * BEAM_X, postTop / 2, sz * columnZ], materials.frame, 'Column', 0.015);
        roundedBox(frame, [0.26, 0.02, 0.26], [sx * BEAM_X, 0.01, sz * columnZ], materials.brushed, 'Column base plate', 0.004);
      });
      roundedBox(frame, [BEAM_X * 2 + 0.12, 0.1, 0.12], [0, postTop - 0.05, sz * columnZ], materials.frame, 'End tie', 0.012);
      roundedBox(frame, [BEAM_X * 2, 0.08, 0.08], [0, 0.45, sz * columnZ], materials.frame, 'Lower tie', 0.01);
      // End stop across both beams. (The reference's stood between the beams on nothing.)
      roundedBox(frame, [BEAM_X * 2 + 0.12, 0.06, 0.08], [0, beamY + 0.12, sz * (columnZ - 0.05)], materials.safetyYellow, 'End stop', 0.01);
    });
    [-1, 1].forEach((sx) => {
      roundedBox(frame, [0.12, 0.18, columnZ * 2 + 0.12], [sx * BEAM_X, beamY, 0], materials.aluminium, sx > 0 ? 'Z beam right' : 'Z beam left', 0.012);
      roundedBox(frame, [0.03, 0.02, columnZ * 2], [sx * (BEAM_X - 0.045), beamY + 0.1, 0], materials.chrome, 'Linear rail', 0.004);
    });
    roundedBox(frame, [0.09, 0.05, columnZ * 1.1], [BEAM_X, beamY + 0.115, columnZ * 0.42], materials.plasticBlack, 'Cable carrier', 0.012);

    // Status beacon on the right beam: one lamp, recoloured per mode.
    const lamp = createLampMaterial(0xf2a516);
    cylinder(frame, 0.012, 0.12, [BEAM_X, beamY + 0.15, -columnZ], materials.stainless, 'Beacon pole', { segments: 10 });
    cylinder(frame, 0.04, 0.08, [BEAM_X, beamY + 0.25, -columnZ], lamp, 'Beacon lamp', { segments: 24 });
    const BEACON = { off: [0xf2a516, false], run: [0x2ecc59, true], wait: [0xf2a516, true], alarm: [0xe23a2e, true] };

    // Carriage on the beams.
    const carriage = group(root, 'Carriage', [0, beamY, 0]);
    roundedBox(carriage, [BEAM_X * 2 + 0.16, 0.04, CARRIAGE_HALF_Z * 2], [0, 0.13, 0], materials.brushed, 'Carriage plate', 0.01);
    [-1, 1].forEach((sx) => roundedBox(carriage, [0.08, 0.05, 0.14], [sx * (BEAM_X - 0.045), 0.115, 0], materials.frameDark, 'Rail block', 0.008));
    // Servos stand on the carriage plate, clear of the mast. (The reference's hovered 2 cm above the
    // plate, touching only the raised mast.)
    cylinder(carriage, 0.07, 0.2, [0.14, 0.25, 0.08], materials.frameDark, 'Z servo motor', { segments: 24 });
    cylinder(carriage, 0.065, 0.2, [-0.14, 0.25, 0.08], materials.frameDark, 'Y servo motor', { segments: 24 });
    roundedBox(carriage, [0.2, 0.3, 0.2], [0, 0, 0], materials.brushed, 'Vertical guide housing', 0.02);

    // Vertical axis: the mast slides through the carriage housing; the head hangs below it.
    const vertical = group(root, 'Vertical axis', [0, yRangeOf(params)[1], 0]);
    roundedBox(vertical, [0.12, MAST, 0.12], [0, 0.2 + MAST / 2, 0], materials.aluminium, 'Mast profile', 0.012);
    roundedBox(vertical, [0.02, MAST, 0.04], [0.07, 0.2 + MAST / 2, 0], materials.chrome, 'Mast rail', 0.004);
    const head = group(vertical, 'Gripper head');
    roundedBox(head, [plateHalfX * 2, 0.04, 0.46], [0, 0.2, 0], materials.stainless, 'Head plate', 0.012);
    roundedBox(head, [0.18, 0.04, 0.18], [0, 0.22, 0], materials.brushed, 'Mast flange', 0.01);
    cylinder(head, 0.035, 0.12, [Math.min(0.25, plateHalfX - 0.05), 0.24 + 0.04, 0.12], materials.frameDark, 'Pitch servo', { segments: 20 });
    // One pitch rail per gripper column, under the plate. (The reference's two rails sat 6 cm
    // beside the grippers and 5 mm above their carriages, so the grippers hung on nothing.)
    gripXs.forEach((gx) => roundedBox(head, [0.03, 0.02, 0.44], [gx, 0.17, 0], materials.chrome, 'Pitch rail', 0.004));

    // Grippers: rear row then front row, each along +X.
    const rowSides = rows === 2 ? [-1, 1] : [0];
    const grippers = [];
    rowSides.forEach((row) => gripXs.forEach((gx) => {
      const unit = group(head, `Gripper ${grippers.length + 1}`, [gx, 0, 0]);
      roundedBox(unit, [0.07, 0.05, 0.1], [0, 0.08, 0], materials.aluminium, 'Gripper body', 0.01);
      roundedBox(unit, [0.05, 0.06, 0.06], [0, 0.135, 0], materials.frameDark, 'Rail carriage', 0.008);
      cylinder(unit, 0.005, 0.03, [0.03, 0.09, 0.03], materials.airLine, 'Air fitting', { axis: 'x', segments: 10 });
      const fingers = [-1, 1].map((side) => {
        const finger = group(unit, side > 0 ? 'Finger front' : 'Finger rear', [0, 0, side * FINGER.open / 2]);
        roundedBox(finger, [0.05, 0.075, 0.008], [0, 0.0175, 0], materials.stainless, 'Finger plate', 0.003);
        box(finger, [0.05, 0.005, 0.006], [0, -0.017, -side * 0.007], materials.rubber, 'Finger lip'); // hooks under the handle
        return { finger, side };
      });
      grippers.push({ unit, row, fingers });
    }));

    let zNow = 0;
    return {
      root,
      anchors: Object.fromEntries(grippers.map((g, i) => [`grip${i + 1}`, g.unit])),
      motions: {
        z(v) { zNow = v; carriage.position.z = v; vertical.position.z = v; },
        y(v) { vertical.position.y = v; vertical.position.z = zNow; },
        pitch(v) { grippers.forEach((g) => { g.unit.position.z = g.row * v / 2; }); },
        grip(gap) { grippers.forEach((g) => g.fingers.forEach(({ finger, side }) => { finger.position.z = side * gap / 2; })); },
        beacon(mode) {
          const [color, on] = BEACON[mode];
          lamp.userData.baseColor.set(color);
          lamp.emissive.set(color);
          setLamp(lamp, on, 1.6);
        },
      },
    };
  },
});
