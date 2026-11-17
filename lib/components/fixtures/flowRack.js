// Gravity flow rack with coloured stock bins: the supermarket's stock behind a kitting cell,
// replenished from the back and picked at the front (kanban). Ported from the reference
// KittingEquipment.js (createFlowRack). Centred on the origin; the PICK FACE is +Z (towards the
// line, which runs along z = 0 in front of equipment on −Z).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, roundedBox } from '../../core/primitives.js';

const UPRIGHT = 0.05;
const FIRST_SHELF = 0.45;
const SHELF_PITCH = 0.5;
const BIN_HEIGHT = 0.16;
const LIP = 0.015; // front stop the bins roll against
const BIN_COLORS = ['toteBlue', 'binYellow', 'binRed', 'binGreen']; // reference order

const rackHeight = (p) => FIRST_SHELF + (p.levels - 1) * SHELF_PITCH + 0.45; // 1.9 m at 3 levels

defineComponent({
  type: 'flowRack',
  category: 'buffer',
  summary: 'Gravity flow rack with sloped roller shelves and coloured stock bins; pick face towards +Z.',
  params: z.object({
    length: z.number().min(0.8).max(3).default(1.7).describe('Length along X (m)'),
    depth: z.number().min(0.4).max(1).default(0.7).describe('Depth along Z (m)'),
    levels: z.number().int().min(1).max(5).default(3).describe('Shelf levels'),
    bins: z.number().int().min(1).max(8).default(5).describe('Bins per level'),
    slope: z.number().min(0.05).max(0.2).default(0.12).describe('Shelf slope down to the pick face (rad)'),
  }),
  footprint: (p) => ({
    x: [-(p.length / 2 + UPRIGHT / 2), p.length / 2 + UPRIGHT / 2],
    z: [-(p.depth / 2 + UPRIGHT / 2), p.depth / 2 + UPRIGHT / 2],
    height: rackHeight(p),
  }),
  mount: 'floor',
  build({ params, materials }) {
    const { length, depth, levels, bins, slope } = params;
    const height = rackHeight(params);
    const root = group(null, 'flowRack');
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      roundedBox(root, [UPRIGHT, height, UPRIGHT], [sx * (length / 2), height / 2, sz * (depth / 2)], materials.machineBlue, 'Rack upright', 0.006);
    }));

    // Bins fill the space between the uprights and rest against the front lip.
    const pitch = (length - UPRIGHT) / bins;
    const binDepth = depth - 0.1;
    const binZ = depth / 2 - LIP - binDepth / 2;
    for (let level = 0; level < levels; level += 1) {
      const shelf = group(root, `Shelf ${level + 1}`, [0, FIRST_SHELF + level * SHELF_PITCH, 0]);
      // +rotation about X lowers +Z: the shelf slopes down to the pick face. (The reference
      // tilted it the other way, so its bins would have rolled away from the cell.)
      shelf.rotation.x = slope;
      box(shelf, [length, 0.02, depth], [0, 0, 0], materials.aluminium, 'Roller track');
      box(shelf, [length - UPRIGHT, 0.04, LIP], [0, 0.03, depth / 2 - LIP / 2], materials.machineBlue, 'Front stop');
      for (let index = 0; index < bins; index += 1) {
        const bx = -length / 2 + UPRIGHT / 2 + (index + 0.5) * pitch;
        const colour = materials[BIN_COLORS[(index + level) % BIN_COLORS.length]];
        roundedBox(shelf, [pitch - 0.03, BIN_HEIGHT, binDepth], [bx, 0.01 + BIN_HEIGHT / 2, binZ], colour, 'Stock bin', 0.008);
      }
    }
    return { root, motions: {} };
  },
});
