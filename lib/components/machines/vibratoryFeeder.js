// Vibratory bowl feeder: a stainless bowl on its drive, an escapement that singles out parts,
// and an optional feed hose that carries them on (screws to an automatic screwdriver, caps,
// clips, pills…). Ported from the reference ST2 FrameAssemblyEquipment.js
// (createScrewPresenter: three of these on a bench, one per screw size).
// Origin: centre of the drive's underside, on the surface it stands on (a bench). Sizes scale
// with the bowl diameter; the reference bowl is 0.26 m.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

const REF_RADIUS = 0.13;
const HOSE_RADIUS = 0.006;

/** Reference geometry scaled by s = bowl radius / 0.13. */
function layout(p) {
  const r = p.bowlDiameter / 2;
  const s = r / REF_RADIUS;
  return {
    r,
    s,
    bowlHeight: 0.1 * s,
    escapement: { size: [0.05 * s, 0.02 * s, 0.12 * s], at: [0.11 * s, 0.11 * s, 0.04 * s] },
    hose: { x: 0.12 * s, z: 0.08 * s, bottom: 0.1 * s },
  };
}

defineComponent({
  type: 'vibratoryFeeder',
  category: 'machine',
  summary: 'Vibratory bowl feeder with escapement and optional feed hose; singles out small parts such as screws.',
  params: z.object({
    bowlDiameter: z.number().min(0.15).max(0.6).default(0.26).describe('Bowl diameter (m)'),
    hoseLength: z.number().min(0).max(2).default(1.2).describe('Feed hose length, 0 = none (m)'),
  }),
  footprint: (p) => {
    const L = layout(p);
    return {
      x: [-L.r, L.escapement.at[0] + L.escapement.size[0] / 2],
      z: [-L.r, L.r],
      height: Math.max(L.escapement.at[1] + L.escapement.size[1] / 2, p.hoseLength > 0 ? L.hose.bottom + p.hoseLength : 0),
    };
  },
  mount: 'surface',
  // Where singled parts leave: the hose end, or the escapement's tip when there is no hose.
  ports: (p) => {
    const L = layout(p);
    const position = p.hoseLength > 0
      ? [L.hose.x, L.hose.bottom + p.hoseLength, L.hose.z]
      : [L.escapement.at[0] + L.escapement.size[0] / 2, L.escapement.at[1], L.escapement.at[2]];
    return { outlet: { position, direction: 'out', carries: 'unit' } };
  },
  build({ params, materials }) {
    const L = layout(params);
    const root = group(null, 'vibratoryFeeder');
    roundedBox(root, [0.16 * L.s, 0.08 * L.s, 0.14 * L.s], [0, 0.04 * L.s, 0], materials.machineGrey, 'Feeder drive', 0.01 * L.s);
    cylinder(root, L.r, L.bowlHeight, [0, L.bowlHeight / 2, 0], materials.stainless, 'Feeder bowl', { segments: 28, radiusBottom: 0.09 * L.s });
    box(root, L.escapement.size, L.escapement.at, materials.stainless, 'Escapement');
    if (params.hoseLength > 0) {
      cylinder(root, HOSE_RADIUS, params.hoseLength, [L.hose.x, L.hose.bottom + params.hoseLength / 2, L.hose.z], materials.guide, 'Feed hose', { segments: 8 });
    }
    return { root, motions: {} };
  },
});
