// Tamp-pad label applicator: a column with a label printer and roll, and a pneumatic tamp that
// presses a label onto the product. Ported from the reference ST5 InspectionEquipment.js
// (createLabeller). Origin on the floor at the column; the tamp works towards −Z.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, roundedBox } from '../../core/primitives.js';

const COLUMN = 0.1;
const PAD = 0.02;

/** Tamp cylinder length from the stroke: long enough to hold the rod at both ends of travel. */
const bodyLength = (p) => p.stroke + 0.08;
const padFace = (p) => -(COLUMN / 2 + bodyLength(p) + PAD); // retracted pad face (z)

defineComponent({
  type: 'labelApplicator',
  category: 'machine',
  summary: 'Tamp-pad label applicator: column with label printer and roll, and a pneumatic tamp that applies the label.',
  params: z.object({
    applyHeight: z.number().min(0.6).max(1.8).default(1.25).describe('Label height (m)'),
    stroke: z.number().min(0.1).max(0.6).default(0.3).describe('Tamp stroke (m)'),
    padWidth: z.number().min(0.04).max(0.2).default(0.06).describe('Tamp pad width (m)'),
  }),
  footprint: (p) => ({ x: [-Math.max(0.12, p.padWidth / 2), Math.max(0.12, p.padWidth / 2)], z: [padFace(p) - p.stroke, 0.12], height: p.applyHeight + 0.3 }),
  mount: 'floor',
  // Where the label is: the retracted pad face; the `tamp` motion moves it `stroke` m along −Z.
  ports: (p) => ({ pad: { position: [0, p.applyHeight, padFace(p)], direction: 'work', carries: 'unit' } }),
  motions: (p) => ({ tamp: { range: [0, p.stroke], default: 0 } }),
  build({ params, materials }) {
    const { applyHeight: y, stroke } = params;
    const L = bodyLength(params);
    const root = group(null, 'labelApplicator');
    roundedBox(root, [0.24, 0.02, 0.24], [0, 0.01, 0], materials.frameDark, 'Labeller foot', 0.005);
    roundedBox(root, [COLUMN, y + 0.15, COLUMN], [0, (y + 0.15) / 2, 0], materials.frame, 'Labeller column', 0.008);
    roundedBox(root, [0.16, 0.2, 0.18], [0, y + 0.1, 0.02], materials.machineWhite, 'Label printer', 0.012);
    cylinder(root, 0.06, 0.04, [0, y + 0.24, 0.02], materials.machineGrey, 'Label roll', { axis: 'x', segments: 20 });
    // Tamp cylinder on the column's front face. (In the reference the rod hung from the column
    // alone, so when extended it left the column and floated.)
    cylinder(root, 0.025, L, [0, y, -(COLUMN / 2 + L / 2)], materials.machineGrey, 'Tamp cylinder', { axis: 'z', segments: 16 });
    const ram = group(root, 'TampRam', [0, y, 0]);
    const rodLength = stroke + 0.04; // its back end stays inside the cylinder at both ends of travel
    const rodFront = -(COLUMN / 2 + L);
    cylinder(ram, 0.012, rodLength, [0, 0, rodFront + rodLength / 2], materials.chrome, 'Tamp rod', { axis: 'z', segments: 12 });
    roundedBox(ram, [params.padWidth, params.padWidth * 0.625, PAD], [0, 0, rodFront - PAD / 2], materials.rubber, 'Tamp pad', 0.004);
    return { root, motions: { tamp: (v) => { ram.position.z = -v; } } };
  },
});
