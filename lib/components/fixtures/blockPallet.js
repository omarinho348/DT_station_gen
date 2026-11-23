// Wooden block pallet: top deck boards on three stringers, which rest on nine blocks on three bottom
// boards. From the reference station-3/ProceduralPallet.js. (There the top deck floated 3 mm above
// the blocks; here every board rests on a stringer and every stringer on its blocks.) Port `top`:
// the deck surface loads are stacked on.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box } from '../../core/primitives.js';

defineComponent({
  type: 'blockPallet',
  category: 'fixture',
  summary: 'Wooden block pallet (deck boards, blocks, bottom boards) that cases are stacked on for dispatch.',
  params: z.object({
    length: z.number().min(0.6).max(2.2).default(1.2).describe('Length along X (m); up to 2.2 m (the reference station-3 pallet is 2.06 m)'),
    width: z.number().min(0.6).max(1.6).default(0.8).describe('Width along Z (m)'),
    height: z.number().min(0.1).max(0.2).default(0.144).describe('Height to the deck top (m)'),
  }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-p.width / 2, p.width / 2], height: p.height }),
  mount: 'floor',
  ports: (p) => ({ top: { position: [0, p.height, 0], direction: 'work', carries: 'case' } }),
  motions: {},
  build({ params, materials }) {
    const { length, width, height } = params;
    const root = group(null, 'blockPallet');
    const deck = Math.min(0.022, height * 0.16);
    const bottom = Math.max(0.018, deck * 0.85);
    const stringer = deck * 0.7;
    const blockHeight = height - deck - stringer - bottom;
    const boards = 7;
    const gap = 0.018;
    const boardWidth = (width - gap * (boards - 1)) / boards;
    for (let i = 0; i < boards; i += 1) {
      const z = -width / 2 + boardWidth / 2 + i * (boardWidth + gap);
      box(root, [length, deck, boardWidth], [0, height - deck / 2, z], i % 2 === 0 ? materials.wood : materials.woodDark, `Top deck board ${i + 1}`);
    }
    const bottomWidth = width * 0.22;
    [-width / 2 + bottomWidth / 2, 0, width / 2 - bottomWidth / 2].forEach((z, i) => {
      box(root, [length, bottom, bottomWidth], [0, bottom / 2, z], materials.woodDark, `Bottom board ${i + 1}`);
    });
    const bx = length * 0.14;
    const bz = width * 0.16;
    let n = 1;
    [-length / 2 + bx / 2, 0, length / 2 - bx / 2].forEach((x) => {
      [-width / 2 + bz / 2, 0, width / 2 - bz / 2].forEach((z) => {
        box(root, [bx, blockHeight, bz], [x, bottom + blockHeight / 2, z], materials.woodEnd, `Block ${n}`);
        n += 1;
      });
      // Stringer across the width on this row of blocks; every deck board rests on the three.
      box(root, [bx * 0.7, stringer, width], [x, height - deck - stringer / 2, 0], materials.woodDark, `Stringer ${(n - 1) / 3}`);
    });
    return { root, motions: {} };
  },
});
