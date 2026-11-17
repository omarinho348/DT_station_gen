// Case taper bridge: a beam on two posts behind the carton line; a carriage runs along it with
// an arm reaching over the line, and a tape head that lowers onto the carton top and travels
// along it (tape roll, wipe roller). Ported from the reference ST6 PackagingEquipment.js
// (createTaper). Origin on the floor under the tape head's line (the carton line's centre);
// the posts stand `reach` metres behind it (−Z).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

const POST = 0.08;
const HEAD = [0.14, 0.14, 0.1];
const WIPE_RADIUS = 0.02;

// Beam above the carton top: the raised head tucks just under the arm (0.3 m at the 0.13 m stroke).
const beamY = (p) => p.topHeight + p.stroke + 0.17;
const travel = (p) => p.span / 2 + 0.02; // the head parks just past the beam end (reference 0.68)

defineComponent({
  type: 'caseTaper',
  category: 'machine',
  summary: 'Case taper bridge: a tape head on a travelling arm lowers onto the carton top and tapes it shut.',
  params: z.object({
    span: z.number().min(0.6).max(2.5).default(1.32).describe('Beam length along X (m)'),
    topHeight: z.number().min(0.3).max(1.6).default(1.17).describe('Carton top height (m)'),
    reach: z.number().min(0.2).max(0.8).default(0.38).describe('Arm reach from the beam (m)'),
    stroke: z.number().min(0.05).max(0.3).default(0.13).describe('Head lowering (m)'),
  }),
  footprint: (p) => ({
    x: [-(travel(p) + HEAD[0] / 2), travel(p) + 0.08], // the tape roll stands 1 cm past the head's +X side
    z: [-(p.reach + 0.06), HEAD[2] / 2 + 0.01],
    height: beamY(p) + 0.06,
  }),
  mount: 'overConveyor',
  motions: (p) => ({
    x: { range: [-travel(p), travel(p)], default: travel(p) }, // head position along the line; parked at +X
    lower: { range: [0, 1] }, // 0 raised, 1 wipe roller on the carton top
  }),
  build({ params, materials }) {
    const { span, topHeight: topY, reach, stroke } = params;
    const by = beamY(params);
    const root = group(null, 'caseTaper');
    [-1, 1].forEach((side) => roundedBox(root, [POST, by, POST], [side * (span / 2 - 0.04), by / 2, -reach], materials.frame, 'Taper post', 0.008));
    box(root, [span, 0.08, 0.08], [0, by, -reach], materials.frame, 'Taper beam');

    const carriage = group(root, 'TaperCarriage');
    roundedBox(carriage, [0.1, 0.1, 0.12], [0, by, -reach], materials.machineGrey, 'Taper carriage', 0.008);
    box(carriage, [0.06, 0.05, reach], [0, by, -reach / 2], materials.machineGrey, 'Head arm');
    // Vertical slide the head runs on. (The reference lowered the whole arm, which then left the
    // beam and hung in the air.)
    const slideBottom = topY + 0.15;
    box(carriage, [0.03, by - slideBottom, 0.03], [0, (by + slideBottom) / 2, 0], materials.chrome, 'Head slide');

    const head = group(carriage, 'TapeHead');
    roundedBox(head, HEAD, [0, topY + 0.22, 0], materials.machineWhite, 'Tape head', 0.012);
    cylinder(head, 0.05, 0.05, [0.03, topY + 0.23, 0], materials.cableWhite, 'Tape roll', { axis: 'z', segments: 20 });
    const wipe = cylinder(head, WIPE_RADIUS, 0.06, [-0.05, topY + 0.15, 0], materials.rubber, 'Wipe roller', { axis: 'z', segments: 14 });
    // Raised, the wipe roller sits `stroke` above the carton top (0.13 m in the reference).
    head.position.y = stroke - 0.13;

    return {
      root,
      motions: {
        x: (v) => {
          carriage.position.x = v;
          wipe.rotation.z = -v / WIPE_RADIUS; // the roller rolls along the tape
        },
        lower: (v) => { head.position.y = stroke - 0.13 - v * stroke; },
      },
    };
  },
});
