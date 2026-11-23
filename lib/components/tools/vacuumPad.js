// Vacuum pad gripper for cases: tool changer, aluminium pad frame and six suction cups, with a
// vacuum lamp. Origin at the tool point (the centre of the cup faces); the tool extends up to its
// mounting face at VACUUM_PAD_HEIGHT. Used on the palletizer robots (buildVacuumPad) and as a tool
// component of its own.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const CHANGER = 0.08;
const FRAME = 0.05;
const CUP = 0.04;
export const VACUUM_PAD_HEIGHT = CUP + FRAME + CHANGER; // tool point to mounting face

/** Builds the pad under `parent` (origin = tool point, mounting face up). Returns { setVacuum(on) }. */
export function buildVacuumPad(parent, materials, { padLength = 0.5, padWidth = 0.34, name = 'Vacuum pad' } = {}) {
  const root = group(parent, name);
  cylinder(root, 0.08, CHANGER, [0, CUP + FRAME + CHANGER / 2, 0], materials.frameDark, 'Tool changer', { segments: 20 });
  const frameY = CUP + FRAME / 2;
  roundedBox(root, [padLength, FRAME, padWidth], [0, frameY, 0], materials.aluminium, 'Vacuum pad frame', 0.008);
  const xs = [-1, 0, 1].map((i) => i * (padLength / 2 - 0.06));
  const zs = [-1, 1].map((i) => i * (padWidth / 2 - 0.05));
  xs.forEach((x) => zs.forEach((zz) => cylinder(root, 0.035, CUP, [x, CUP / 2, zz], materials.rubber, 'Suction cup', { radiusBottom: 0.04, segments: 16 })));
  const lamp = createLampMaterial(0x2ecc59);
  cylinder(root, 0.014, 0.02, [padLength / 2 - 0.03, frameY + FRAME / 2 + 0.01, 0], lamp, 'Vacuum lamp', { segments: 12 });
  return { root, setVacuum: (on) => setLamp(lamp, on) };
}

defineComponent({
  type: 'vacuumPad',
  category: 'tool',
  summary: 'Vacuum pad gripper for cases (six suction cups, vacuum lamp); origin at the centre of the cup faces.',
  params: z.object({
    padLength: z.number().min(0.2).max(0.9).default(0.5).describe('Pad length along X (m)'),
    padWidth: z.number().min(0.18).max(0.6).default(0.34).describe('Pad width along Z (m)'),
  }),
  footprint: (p) => ({ x: [-p.padLength / 2, p.padLength / 2], z: [-p.padWidth / 2, p.padWidth / 2], height: VACUUM_PAD_HEIGHT }),
  mount: 'tool',
  motions: { grip: { range: [0, 1], default: 0 } }, // vacuum: 0 off, 1 on
  build({ params, materials }) {
    const root = group(null, 'vacuumPad');
    const pad = buildVacuumPad(root, materials, params);
    return { root, motions: { grip: (v) => pad.setVacuum(v >= 0.5) } };
  },
});
