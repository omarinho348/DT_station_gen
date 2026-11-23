// Basic tool: a tamp label head (label roll, peel plate and a tamp pad that pushes the label onto
// the unit). Origin at the TOOL POINT, the tamp pad face with the pad up; mounting face on top.
// Motions: `tamp` (metres the pad has come down) and `label` (none / loaded: a label on the pad).
// Mount point `pad` on the pad face (Y up), moving with it: where a label sits until applied.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, roundedBox, box } from '../../core/primitives.js';
import { mountPoint } from '../frames/common.js';

const PAD = 0.02;
const bodyOf = (p) => Math.max(0.16, 2 * p.stroke + 0.06); // holds the tamp rods over the whole stroke
const rodOf = (p) => 0.03 + 2 * p.stroke + 0.03; // from the pad; its top stays in the body

defineComponent({
  type: 'labelHead',
  category: 'tool',
  summary: 'Basic tamp label head: label roll, peel plate and a tamp pad that pushes a label down onto the unit.',
  params: z.object({
    stroke: z.number().min(0.02).max(0.3).default(0.1).describe('Tamp travel (m)'),
    labelWidth: z.number().min(0.03).max(0.2).default(0.08).describe('Label width, along X (m)'),
    labelLength: z.number().min(0.03).max(0.2).default(0.1).describe('Label length, along Z (m)'),
  }),
  footprint: (p) => {
    const hx = Math.max(p.labelWidth / 2 + 0.01, 0.06);
    return { x: [-hx, hx + 0.13], z: [-Math.max(p.labelLength / 2 + 0.01, 0.06), Math.max(p.labelLength / 2 + 0.01, 0.06)], height: PAD + 0.03 + p.stroke + bodyOf(p) + 0.012, bottom: -p.stroke - 0.001 }; // the label lies 0.5 mm under the pad
  },
  mount: 'tool',
  anchors: ['pad'],
  motions: (p) => ({ tamp: { range: [0, p.stroke], default: 0 }, label: { values: ['none', 'loaded'] } }),
  build({ params: p, materials }) {
    const root = group(null, 'labelHead');
    const bodyY = PAD + 0.03 + p.stroke;
    const BODY = bodyOf(p);
    roundedBox(root, [0.12, BODY, 0.12], [0, bodyY + BODY / 2, 0], materials.machineWhite, 'Head body', 0.008);
    box(root, [0.12, 0.012, 0.12], [0, bodyY + BODY + 0.006, 0], materials.stainless, 'Mounting plate');
    // Label roll and peel plate on the +X side.
    cylinder(root, 0.055, 0.05, [0.115, bodyY + BODY * 0.6, 0], materials.machineWhite, 'Label roll', { axis: 'z', segments: 24 });
    cylinder(root, 0.02, 0.052, [0.115, bodyY + BODY * 0.6, 0], materials.frameDark, 'Roll core', { axis: 'z', segments: 16 });
    box(root, [0.07, 0.006, 0.07], [0.095, bodyY + 0.003, 0], materials.stainless, 'Peel plate');
    // The tamp: rods up into the body, a pad below.
    const tamp = group(root, 'Tamp');
    for (const side of [-1, 1]) {
      cylinder(tamp, 0.006, rodOf(p), [0, PAD + rodOf(p) / 2, side * 0.012], materials.chrome, `Tamp rod ${side > 0 ? 'front' : 'rear'}`, { segments: 10 });
    }
    roundedBox(tamp, [p.labelWidth + 0.01, PAD, p.labelLength + 0.01], [0, PAD / 2, 0], materials.frameDark, 'Tamp pad', 0.004);
    const pad = mountPoint(tamp, 'Mount pad', [0, 0, 0]);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(p.labelWidth, p.labelLength).rotateX(Math.PI / 2), materials.machineWhite);
    label.name = 'Label on pad';
    label.position.y = -0.0005;
    tamp.add(label);
    return {
      root,
      motions: {
        tamp: (v) => { tamp.position.y = -v; },
        label: (v) => { label.visible = v === 'loaded'; },
      },
      anchors: { pad },
    };
  },
});
